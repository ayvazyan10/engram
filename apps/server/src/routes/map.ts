import { createHash } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import { DecayEngine, getDb, schema, unpackFP16 } from '@engram-ai-memory/core';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { brain } from '../index.js';
import { isRunning, runExclusive } from '../lib/exclusive.js';
import { strictObjectBody, strictQueryString } from '../lib/strictBody.js';
import { insertPoints, project, type Projection } from '../lib/map/project.js';
import { regionGroups } from '../lib/map/regions.js';
import { regionNames } from '../lib/map/names.js';
import { memoryFingerprint } from './scene.js';

type Memory = typeof schema.memories.$inferSelect;
type Edge = typeof schema.memoryConnections.$inferSelect;
type Scope = { namespace?: string; global?: 'true' };
export interface MapNode {
  id: string; x: number; y: number; type: Memory['type']; importance: number;
  retention: number; protected: boolean; createdAt: string; lastAccessedAt: string | null;
  namespace: string | null; source: string | null; isReflection: boolean;
  regionId: string; degree: number; contradictCount: number; label: string;
}
export interface Region {
  id: string; name: string; autoName: string; count: number; x: number; y: number;
  reflectionShare: number; contradictions: number; newThisWeek: number; topTags: string[];
}
export interface MapPayload {
  fingerprint: string; generatedAt: string; computeMs: number;
  method: 'pca2+knn' | 'fallback'; explainedVariance: readonly [number, number];
  embeddingModel: string | null; nodes: MapNode[]; regions: Region[];
}
interface Snapshot {
  fingerprint: string; rows: Memory[]; edges: Edge[];
}
interface CachedMap {
  snapshot: Snapshot; projection: Projection; fullCount: number;
  groups: { id: string; members: number[] }[]; generatedAt: string; computeMs: number;
}

async function snapshot(scope: Scope): Promise<Snapshot> {
  const db = getDb();
  const conditions = [isNull(schema.memories.archivedAt)];
  if (scope.namespace !== undefined) conditions.push(eq(schema.memories.namespace, scope.namespace));
  if (scope.global === 'true') conditions.push(isNull(schema.memories.namespace));
  const namespace = brain.getNamespace();
  if (namespace) conditions.push(eq(schema.memories.namespace, namespace));
  const rows = db.select().from(schema.memories).where(and(...conditions)).orderBy(asc(schema.memories.id))
    .all().filter((row) => brain.canAccessNamespace(row.namespace));
  const visible = new Set(rows.map((row) => row.id));
  const ids = db.select({ id: schema.memories.id }).from(schema.memories).where(and(...conditions));
  const edges = db.select().from(schema.memoryConnections).where(and(
    isNull(schema.memoryConnections.deletedAt),
    inArray(schema.memoryConnections.sourceId, ids), inArray(schema.memoryConnections.targetId, ids)
  )).orderBy(asc(schema.memoryConnections.id)).all()
    .filter((e) => e.sourceId !== e.targetId && visible.has(e.sourceId) && visible.has(e.targetId));
  // Keep the scene fingerprint, strengthened for same-timestamp writes, link
  // changes, and embedding backfills. Only this cheap read runs on cache hits.
  const hash = createHash('sha256');
  for (const { embedding, ...row } of rows) {
    hash.update(JSON.stringify(row));
    if (embedding) hash.update(embedding);
  }
  hash.update(JSON.stringify(edges));
  return { rows, edges, fingerprint: `${await memoryFingerprint(conditions)}:${hash.digest('hex')}` };
}

async function compute(input: Snapshot, previous?: CachedMap, force = false): Promise<CachedMap> {
  const started = performance.now();
  const links = input.edges.filter((e) => e.relationship === 'relates_to' && e.strength >= 0.5);
  const full = force || !previous || Math.abs(input.rows.length - previous.fullCount) >= Math.max(1, previous.fullCount * 0.1);
  const projection = full ? await project(input.rows.map((row) => {
    let vector: Float32Array | null = null;
    if (row.embedding && row.embeddingModel === brain.getEmbeddingModel()) {
      const unpacked = unpackFP16(row.embedding);
      if (unpacked.length === row.embeddingDim && unpacked.length && unpacked.every(Number.isFinite)) vector = unpacked;
    }
    return { id: row.id, vector };
  }), links, previous?.projection.points) : {
    ...previous!.projection,
    points: insertPoints(input.rows.map((r) => r.id), links, previous!.projection.points),
  };
  const groups = regionGroups(projection.points, links);
  // Preserve the previous medoid ID between full runs when it is still a member.
  if (!full && previous) {
    const oldIds = new Set(previous.groups.map((g) => g.id));
    for (const group of groups) {
      const survivor = group.members.map((i) => input.rows[i]!.id).find((id) => oldIds.has(id));
      if (survivor) group.id = survivor;
    }
  }
  return {
    snapshot: input, projection, groups, fullCount: full ? input.rows.length : previous!.fullCount,
    generatedAt: new Date().toISOString(), computeMs: performance.now() - started,
  };
}

function payload(cache: CachedMap): MapPayload {
  const { snapshot: { rows, edges }, projection, groups } = cache;
  const now = new Date();
  const decay = new DecayEngine(brain.getDecayPolicy());
  const tags = rows.map((row) => JSON.parse(row.tags) as string[]);
  const names = regionNames(rows.map((r, i) => ({ tags: tags[i]!, concept: r.concept })), groups.map((g) => g.members));
  const nodes: MapNode[] = rows.map((row, i) => ({
    ...projection.points[i]!, type: row.type, importance: row.importance,
    retention: decay.computeRetention(row, now), protected: decay.isProtected(row),
    createdAt: row.createdAt, lastAccessedAt: row.lastAccessedAt, namespace: row.namespace, source: row.source,
    isReflection: row.source === 'reflection' || tags[i]!.some((tag) => tag.startsWith('reflection')),
    regionId: '', degree: 0, contradictCount: 0,
    label: (row.concept ?? row.content).replace(/\s+/g, ' ').trim().slice(0, 80),
  }));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const edge of edges) {
    for (const id of [edge.sourceId, edge.targetId]) {
      const node = byId.get(id)!;
      node.degree++;
      if (edge.relationship === 'contradicts') node.contradictCount++;
    }
  }
  const weekAgo = now.getTime() - 7 * 86400000;
  const regions: Region[] = groups.map((group, i) => {
    let x = 0, y = 0, reflections = 0, newThisWeek = 0;
    for (const index of group.members) {
      const node = nodes[index]!;
      node.regionId = group.id; x += node.x; y += node.y;
      if (node.isReflection) reflections++;
      if (Date.parse(node.createdAt) >= weekAgo) newThisWeek++;
    }
    const { name, topTags } = names[i]!;
    return {
      id: group.id, name, autoName: name, topTags, count: group.members.length,
      x: x / group.members.length, y: y / group.members.length,
      reflectionShare: reflections / group.members.length, newThisWeek, contradictions: 0,
    };
  });
  const regionsById = new Map(regions.map((r) => [r.id, r]));
  for (const edge of edges) if (edge.relationship === 'contradicts') {
    // Each incident contradiction counts once per region, including cross-region pairs.
    const ids = new Set([byId.get(edge.sourceId)!.regionId, byId.get(edge.targetId)!.regionId]);
    for (const id of ids) regionsById.get(id)!.contradictions++;
  }
  return {
    fingerprint: cache.snapshot.fingerprint, generatedAt: cache.generatedAt, computeMs: cache.computeMs,
    method: projection.method, explainedVariance: projection.explainedVariance,
    embeddingModel: brain.getEmbeddingModel(), nodes, regions,
  };
}

const querystring = {
  type: 'object', additionalProperties: false,
  properties: { namespace: { type: 'string' }, global: { type: 'string', enum: ['true'] } },
};

export const mapRoutes: FastifyPluginAsync = async (app) => {
  // Per app and project scope. Nothing is persisted, including region names.
  const caches = new Map<string, CachedMap>();
  const pending = new Map<string, Promise<void>>();
  const failures = new Map<string, unknown>();
  const keyFor = (scope: Scope) => JSON.stringify([brain.getNamespaceMode(), brain.getNamespace(), scope.namespace, scope.global]);
  const start = (key: string, input: Snapshot, force = false) => {
    failures.delete(key);
    const work = runExclusive('map', async () => {
      caches.set(key, await compute(input, caches.get(key), force));
    });
    pending.set(key, work);
    void work.catch((error: unknown) => {
      failures.set(key, error);
      app.log.error(error, 'Map compute failed');
    }).finally(() => pending.delete(key));
    return work;
  };
  app.addHook('onClose', async () => { await Promise.allSettled(pending.values()); });

  app.get<{ Querystring: Scope }>('/map', {
    schema: { tags: ['map'], summary: 'Get the Atlas memory map', querystring },
    preValidation: strictQueryString(['namespace', 'global']),
    handler: async (req, reply) => {
      const key = keyFor(req.query);
      if (failures.has(key)) throw failures.get(key);
      const cached = caches.get(key);
      if (!cached && pending.has(key)) return reply.code(503).send({ error: 'map not ready', retryAfterMs: 250 });
      if (pending.has(key)) await pending.get(key);
      const input = await snapshot(req.query);
      const current = caches.get(key);
      if (current?.snapshot.fingerprint === input.fingerprint) return payload(current);
      if (isRunning('map')) return reply.code(503).send({ error: 'map not ready', retryAfterMs: 250 });
      const work = start(key, input);
      if (!current) return reply.code(503).send({ error: 'map not ready', retryAfterMs: 250 });
      await work;
      return payload(caches.get(key)!);
    },
  });
  app.post<{ Querystring: Scope }>('/map/rebuild', {
    schema: {
      tags: ['map'], summary: 'Rebuild the Atlas map for this project scope', querystring,
      body: { type: 'object', additionalProperties: false, properties: {} },
    },
    preValidation: [strictQueryString(['namespace', 'global']), async (req) => {
      if (req.body === undefined) req.body = {};
    }, strictObjectBody([])],
    handler: async (req, reply) => {
      const key = keyFor(req.query);
      // Claim before reading inputs so two rebuilds cannot race their snapshots.
      await runExclusive('map', async () => {
        failures.delete(key);
        const result = compute(await snapshot(req.query), caches.get(key), true);
        const work = result.then((cache) => { caches.set(key, cache); });
        pending.set(key, work);
        try { await work; } finally { pending.delete(key); }
      });
      return reply.code(204).send();
    },
  });
};
