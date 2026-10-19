import { createHash } from 'node:crypto';
import { DecayEngine, getDb, schema } from '@engram-ai-memory/core';
import { and, eq, getTableColumns, gte, inArray, isNull } from 'drizzle-orm';
import { brain } from '../../index.js';
import { redactField, scanSecrets, type Finding } from './secrets.js';

type Memory = typeof schema.memories.$inferSelect;
export type Scope = { namespace?: string; global?: 'true' };
export type DismissQueue = 'duplicates' | 'fading' | 'secrets';
export const dismissalKey = 'review.dismissed.v1';
export function itemKey(queue: DismissQueue, ids: string[]): string {
  return JSON.stringify([queue, ...[...ids].sort()]);
}
export function readDismissals(): string[] {
  const row = getDb().select().from(schema.localMeta).where(eq(schema.localMeta.key, dismissalKey)).get();
  return row ? JSON.parse(row.value) as string[] : [];
}

export function memoryLite(memory: Memory, findings = scanSecrets(memory)) {
  return {
    id: memory.id, type: memory.type, importance: memory.importance, createdAt: memory.createdAt,
    content: redactField(memory.content, findings.filter((f) => f.field === 'content')),
    concept: memory.concept === null ? null : redactField(memory.concept, findings.filter((f) => f.field === 'concept')),
    summary: memory.summary === null ? null : redactField(memory.summary, findings.filter((f) => f.field === 'summary')),
  };
}
type MemoryLite = ReturnType<typeof memoryLite>;
export interface PairItem {
  kind: 'pair'; a: MemoryLite; b: MemoryLite; edgeId: string; strength: number; sharedWordRatio: number;
}
export interface SingleItem {
  kind: 'single'; memory: MemoryLite; retention: number; reason: string; findings?: Finding[];
}
export interface ReviewSnapshot {
  fingerprint: string;
  contradictions: PairItem[]; duplicates: PairItem[]; fading: SingleItem[]; secrets: SingleItem[];
}

function pair(a: MemoryLite, b: MemoryLite, edge: { id: string; strength: number }): PairItem {
  const words = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
  const aw = words(a.content), bw = words(b.content);
  const shared = [...aw].filter((word) => bw.has(word)).length;
  const union = new Set([...aw, ...bw]).size;
  return { kind: 'pair', a, b, edgeId: edge.id, strength: edge.strength, sharedWordRatio: union ? shared / union : 0 };
}

/** One cache per app, bounded to its most recently requested scope. */
export function reviewReader() {
  let cached: ReviewSnapshot | undefined;
  return async (scope: Scope): Promise<ReviewSnapshot> => {
    const db = getDb();
    const conditions = [isNull(schema.memories.archivedAt)];
    if (scope.namespace !== undefined) conditions.push(eq(schema.memories.namespace, scope.namespace));
    if (scope.global === 'true') conditions.push(isNull(schema.memories.namespace));
    const namespace = brain.getNamespace();
    if (namespace) conditions.push(eq(schema.memories.namespace, namespace));
    const { embedding: _embedding, ...columns } = getTableColumns(schema.memories);
    const rows = db.select(columns).from(schema.memories).where(and(...conditions)).orderBy(schema.memories.id).all()
      .filter((row) => brain.canAccessNamespace(row.namespace)).map((row) => ({ ...row, embedding: null }));
    const visible = db.select({ id: schema.memories.id }).from(schema.memories).where(and(...conditions));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const edges = db.select().from(schema.memoryConnections).where(and(
      eq(schema.memoryConnections.relationship, 'relates_to'), gte(schema.memoryConnections.strength, 0.95),
      isNull(schema.memoryConnections.deletedAt), inArray(schema.memoryConnections.sourceId, visible),
      inArray(schema.memoryConnections.targetId, visible),
    )).orderBy(schema.memoryConnections.id).all().filter((e) => e.sourceId !== e.targetId && byId.has(e.sourceId) && byId.has(e.targetId));
    const contradictions = await brain.getContradictions(scope.namespace, undefined, 0, scope.global === 'true');
    const dismissed = new Set(readDismissals());
    const policy = brain.getDecayPolicy();
    const decay = new DecayEngine(policy);
    const now = new Date();
    // Retention and protection depend on time as well as policy. Include their
    // current values so a clock-only threshold crossing cannot leave a stale queue.
    const decayState = rows.map((row) => ({ retention: decay.computeRetention(row, now), protected: decay.isProtected(row) }));
    const fingerprint = createHash('sha256').update(JSON.stringify([
      rows, edges, contradictions.map((c) => c.edge), [...dismissed], policy.archiveThreshold,
      decayState.map((state) => [state.protected, state.retention < 2 * policy.archiveThreshold]),
    ])).digest('hex');
    if (cached?.fingerprint === fingerprint) {
      // Return current retention without rescanning text.
      const retention = new Map(rows.map((row, i) => [row.id, decayState[i]!.retention]));
      for (const item of [...cached.fading, ...cached.secrets]) item.retention = retention.get(item.memory.id)!;
      return cached;
    }
    const result: ReviewSnapshot = { fingerprint, contradictions: [], duplicates: [], fading: [], secrets: [] };
    const lite = new Map<string, MemoryLite>();
    for (const [i, row] of rows.entries()) {
      const findings = scanSecrets(row);
      const memory = memoryLite(row, findings);
      lite.set(row.id, memory);
      const { retention, protected: protectedMemory } = decayState[i]!;
      if (findings.length && !dismissed.has(itemKey('secrets', [row.id]))) {
        result.secrets.push({ kind: 'single', memory, retention, reason: 'possible-secret', findings });
      }
      if (!protectedMemory && row.importance >= 0.6 && retention < 2 * policy.archiveThreshold && !dismissed.has(itemKey('fading', [row.id]))) {
        result.fading.push({ kind: 'single', memory, retention, reason: 'fading-but-important' });
      }
    }
    result.fading.sort((a, b) => b.memory.importance - a.memory.importance || a.memory.id.localeCompare(b.memory.id));
    for (const edge of edges) {
      if (!dismissed.has(itemKey('duplicates', [edge.sourceId, edge.targetId]))) {
        result.duplicates.push(pair(lite.get(edge.sourceId)!, lite.get(edge.targetId)!, edge));
      }
    }
    for (const { edge, source, target } of contradictions) {
      if (lite.has(source.id) && lite.has(target.id)) result.contradictions.push(pair(lite.get(source.id)!, lite.get(target.id)!, edge));
    }
    cached = result;
    return result;
  };
}
