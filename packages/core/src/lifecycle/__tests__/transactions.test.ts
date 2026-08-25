/**
 * Atomicity tests for the multi-write brain operations.
 *
 * store(), consolidate()+forget() and resolveContradiction() each performed
 * several independent awaited writes, so a failure part-way through left
 * partial state. These verify the writes now land together, and that the
 * in-memory index/graph are only advanced after the durable write.
 *
 * Note the constraint being relied on: DrizzleDb is a BetterSQLite3Database, so
 * db.transaction() takes a SYNCHRONOUS callback. Async work (embedding) has to
 * happen outside it — these tests exist partly to catch a future refactor that
 * sneaks an await back inside.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { and, eq, isNull, or } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { getDb, closeDb, schema } from '../../db/index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8',
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-tx-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.close();
  return dbPath;
}

describe('transaction mechanism', () => {
  let dbPath: string;

  beforeEach(() => { dbPath = createTestDb(); });
  afterEach(async () => {
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('rolls back every statement when one fails', async () => {
    // The production code above relies on this guarantee. Codified here so a
    // future driver or dialect change (async transactions, PostgreSQL) cannot
    // silently turn "atomic" into "sequential".
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const db = getDb();
    const before = (await db.select().from(schema.memories)).length;
    const now = new Date().toISOString();

    expect(() => {
      db.transaction((tx) => {
        tx.insert(schema.memories).values({
          id: 'rollback-probe',
          type: 'semantic',
          content: 'This row must not survive',
          embeddingDim: 384,
          importance: 0.5,
          confidence: 1,
          accessCount: 0,
          metadata: '{}',
          tags: '[]',
          createdAt: now,
          updatedAt: now,
        }).run();

        // targetId is a NOT NULL foreign key — this throws.
        tx.insert(schema.memoryConnections).values({
          id: 'rollback-edge',
          sourceId: 'rollback-probe',
          targetId: 'no-such-memory',
          relationship: 'relates_to',
          strength: 1,
          bidirectional: false,
          metadata: '{}',
          createdAt: now,
        }).run();
      });
    }).toThrow();

    const after = await db.select().from(schema.memories);
    expect(after.length).toBe(before);
    expect(after.some((r) => r.id === 'rollback-probe')).toBe(false);
  });
});

describe('store() atomicity', () => {
  let dbPath: string;

  beforeEach(() => { dbPath = createTestDb(); });
  afterEach(async () => {
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('writes the memory and its auto-link edges together', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    // Two similar memories so the third auto-links to them.
    await brain.store({ content: 'TypeScript generics enable reusable abstractions', type: 'semantic', importance: 0.6 });
    await brain.store({ content: 'TypeScript generics keep code type-safe', type: 'semantic', importance: 0.6 });
    const { memory } = await brain.store({ content: 'TypeScript generics are powerful', type: 'semantic', importance: 0.6 });

    const db = getDb();
    const edges = await db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.sourceId, memory.id));

    expect(edges.length).toBeGreaterThan(0);

    // Every edge must point at a row that actually exists — an edge written
    // outside the memory's transaction could reference a missing endpoint.
    const rows = await db.select().from(schema.memories);
    const ids = new Set(rows.map((r) => r.id));
    for (const e of edges) {
      expect(ids.has(e.targetId), `edge target ${e.targetId} must exist`).toBe(true);
    }
  });

  it('sets the auto-extracted concept in the insert, not a follow-up update', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const { memory } = await brain.store({
      content: 'The deployment pipeline runs on GitHub Actions every night',
      type: 'episodic',
    });

    const db = getDb();
    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));

    expect(row!.concept).toBeTruthy();
    // createdAt === updatedAt proves no second write touched the row.
    expect(row!.updatedAt).toBe(row!.createdAt);
  });

  it('keeps the vector index consistent with the stored rows', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    for (let i = 0; i < 4; i++) {
      await brain.store({ content: `Indexed memory number ${i}`, type: 'semantic', importance: 0.6 });
    }

    const stats = await brain.stats();
    const db = getDb();
    const rows = await db.select().from(schema.memories);

    expect(stats.indexSize).toBe(rows.length);
  });
});

describe('forget() and consolidate() atomicity', () => {
  let dbPath: string;

  beforeEach(() => { dbPath = createTestDb(); });
  afterEach(async () => {
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('forget() archives the row and tombstones its edges in one step', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    await brain.store({ content: 'Redis is an in-memory data store', type: 'semantic', importance: 0.6 });
    const { memory } = await brain.store({ content: 'Redis is used for caching', type: 'semantic', importance: 0.6 });

    const db = getDb();
    const before = await db
      .select()
      .from(schema.memoryConnections)
      .where(or(eq(schema.memoryConnections.sourceId, memory.id), eq(schema.memoryConnections.targetId, memory.id)));
    expect(before.length).toBeGreaterThan(0);

    await brain.forget(memory.id);

    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(row!.archivedAt).toBeTruthy();
    // The archival itself must be visible to a `WHERE updated_at > cursor`
    // sync query, or the deletion would never propagate to another device.
    expect(row!.updatedAt).toBe(row!.archivedAt);

    // Tombstoned, not hard-deleted: the rows still physically exist with
    // deleted_at set...
    const after = await db
      .select()
      .from(schema.memoryConnections)
      .where(or(eq(schema.memoryConnections.sourceId, memory.id), eq(schema.memoryConnections.targetId, memory.id)));
    expect(after.length).toBe(before.length);
    for (const edge of after) {
      expect(edge.deletedAt).toBeTruthy();
    }

    // ...but no longer appear to any live (deleted_at IS NULL) read.
    const live = after.filter((e) => e.deletedAt === null);
    expect(live).toHaveLength(0);
  });

  it('consolidate() archives the whole cluster, never a partial one', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const { memory } = await brain.store({
        content: 'The nightly backup job completed successfully',
        type: 'episodic',
        source: 'unit-test',
      });
      ids.push(memory.id);
    }

    const created = await brain.consolidate(3, 0.8);
    expect(created.length).toBeGreaterThan(0);

    const db = getDb();
    const rows = await db.select().from(schema.memories);
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Every clustered episode referenced by the summary must be archived —
    // archiving them one-by-one could leave some live.
    const summaryMeta = JSON.parse(created[0]!.metadata ?? '{}') as { episodeIds?: string[] };
    expect(summaryMeta.episodeIds?.length).toBeGreaterThanOrEqual(3);

    for (const id of summaryMeta.episodeIds ?? []) {
      expect(byId.get(id)?.archivedAt, `episode ${id} should be archived`).toBeTruthy();
    }

    // ...and no LIVE edge may survive pointing at an archived episode —
    // tombstoned edges pointing at them are expected (archiveAtomic tombstones
    // rather than deletes) and checked separately below.
    const liveEdges = await db
      .select()
      .from(schema.memoryConnections)
      .where(isNull(schema.memoryConnections.deletedAt));
    for (const e of liveEdges) {
      expect(byId.get(e.sourceId)?.archivedAt ?? null).toBeNull();
      expect(byId.get(e.targetId)?.archivedAt ?? null).toBeNull();
    }

    // Every edge that touched an archived episode must be tombstoned, not
    // gone — a hard delete can't be represented in a sync cursor query.
    const allEdges = await db.select().from(schema.memoryConnections);
    for (const e of allEdges) {
      const touchesArchived = byId.get(e.sourceId)?.archivedAt || byId.get(e.targetId)?.archivedAt;
      if (touchesArchived) {
        expect(e.deletedAt).toBeTruthy();
      }
    }
  });
});

describe('resolveContradiction() atomicity', () => {
  let dbPath: string;

  beforeEach(() => { dbPath = createTestDb(); });
  afterEach(async () => {
    await closeDb();
    cleanupTestDb(dbPath);
  });

  it('archives the loser and tombstones the contradicts edge together', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const a = await brain.store({ content: 'The API listens on port 4901', type: 'semantic', importance: 0.6 });
    const b = await brain.store({ content: 'The API listens on port 3001', type: 'semantic', importance: 0.6 });

    const db = getDb();
    // Create the contradicts edge explicitly so the test does not depend on the
    // detector's heuristics firing.
    await db.insert(schema.memoryConnections).values({
      id: 'contradiction-edge-1',
      sourceId: b.memory.id,
      targetId: a.memory.id,
      relationship: 'contradicts',
      strength: 0.9,
      bidirectional: true,
      metadata: '{}',
      createdAt: new Date().toISOString(),
    });

    const result = await brain.resolveContradiction(b.memory.id, a.memory.id, 'keep_oldest');
    expect(result.resolved).toBe(true);
    expect(result.archivedId).toBe(b.memory.id);
    expect(result.keptId).toBe(a.memory.id);

    const [loser] = await db.select().from(schema.memories).where(eq(schema.memories.id, b.memory.id));
    expect(loser!.archivedAt).toBeTruthy();
    expect(loser!.updatedAt).toBe(loser!.archivedAt);

    const [winner] = await db.select().from(schema.memories).where(eq(schema.memories.id, a.memory.id));
    expect(winner!.archivedAt).toBeNull();

    // The contradicts edge must be tombstoned, not gone — it used to be
    // deleted by two separate statements after the archive, so a failure
    // between them left a resolved contradiction still reporting itself. It
    // still physically exists (a hard delete can't propagate through sync)
    // but no longer shows up in a live read.
    const remaining = await db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.relationship, 'contradicts'));
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.deletedAt).toBeTruthy();

    const live = await db
      .select()
      .from(schema.memoryConnections)
      .where(
        and(
          eq(schema.memoryConnections.relationship, 'contradicts'),
          isNull(schema.memoryConnections.deletedAt)
        )
      );
    expect(live).toHaveLength(0);
  });

  it('keep_both leaves both memories and the edge intact', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const a = await brain.store({ content: 'Cache TTL is 60 seconds', type: 'semantic', importance: 0.6 });
    const b = await brain.store({ content: 'Cache TTL is 300 seconds', type: 'semantic', importance: 0.6 });

    const db = getDb();
    await db.insert(schema.memoryConnections).values({
      id: 'contradiction-edge-2',
      sourceId: b.memory.id,
      targetId: a.memory.id,
      relationship: 'contradicts',
      strength: 0.9,
      bidirectional: false,
      metadata: '{}',
      createdAt: new Date().toISOString(),
    });

    const result = await brain.resolveContradiction(b.memory.id, a.memory.id, 'keep_both');
    expect(result.resolved).toBe(true);
    expect(result.archivedId).toBeUndefined();

    const rows = await db.select().from(schema.memories);
    expect(rows.every((r) => r.archivedAt === null)).toBe(true);

    const edges = await db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.relationship, 'contradicts'));
    expect(edges).toHaveLength(1);
  });
});
