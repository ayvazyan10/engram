/**
 * Phase 0 sync-foundation tests (see .claude/PRPs/plans/postgres-cloud-sync.md,
 * "Фаза 0" and "Приложение А").
 *
 * Covers the write-path fixes that make a future `WHERE updated_at > cursor`
 * push query safe:
 *   1. forget()/consolidate()/resolveContradiction() strictly bump `updated_at`
 *      on the rows they archive — previously archiveAtomic and
 *      resolveContradiction set `archived_at` without moving `updated_at`, so
 *      a deletion would never propagate to another device.
 *   2. recall() must NOT bump `updated_at` (only `access_count`/
 *      `last_accessed_at`) — the inverse regression guard.
 *   3. Every timestamp written is millisecond ISO-8601 UTC, not the SQLite
 *      `CURRENT_TIMESTAMP` default (second precision, no T/Z).
 *   4. `device_id` is populated and consistent across tables in one process.
 *   5. A tombstoned memory_connections row is excluded from a freshly loaded
 *      graph, while the row itself still exists.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';

import { NeuralBrain } from '../../NeuralBrain.js';
import { getDb, closeDb, schema } from '../../db/index.js';
import { getDeviceId, _resetMemoizedDeviceIdForTests } from '../../sync/deviceId.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '../../db/migrations');

/**
 * The migration is resolved from the directory, not by filename: drizzle
 * renames the generated file every time it is regenerated, and a hard-coded
 * name turns that rename into an ENOENT in every suite at once.
 */
const MIGRATION_SQL = fs.readFileSync(
  path.join(
    MIGRATIONS_DIR,
    fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort()[0]!,
  ),
  'utf-8',
);

/** Millisecond ISO-8601 UTC, e.g. "2026-08-25T14:23:01.123Z". */
const ISO_MS_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-syncwrite-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const sql = stmt.trim();
    if (sql) sqlite.exec(sql);
  }
  sqlite.close();
  return dbPath;
}

/** A few milliseconds is enough to guarantee a distinct ISO timestamp. */
async function tick(ms = 5): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

describe('Phase 0 — updated_at, timestamps, device_id on write paths', () => {
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    _resetMemoizedDeviceIdForTests();
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(async () => {
    brain.shutdown();
    await closeDb();
    _resetMemoizedDeviceIdForTests();
    cleanupTestDb(dbPath);
  });

  it("forget() strictly increases the memory's updated_at", async () => {
    const { memory } = await brain.store({ content: 'Some fact to forget', type: 'semantic' });
    const beforeUpdatedAt = memory.updatedAt;

    await tick();
    await brain.forget(memory.id);

    const db = getDb();
    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(row!.archivedAt).toBeTruthy();
    expect(row!.updatedAt > beforeUpdatedAt).toBe(true);
    // The critical invariant: the archival is visible to `WHERE updated_at > cursor`.
    expect(row!.updatedAt).toBe(row!.archivedAt);
  });

  it('consolidate() strictly increases updated_at for every archived episode', async () => {
    const before = new Map<string, string>();
    for (let i = 0; i < 4; i++) {
      const { memory } = await brain.store({
        content: 'The nightly backup job completed successfully',
        type: 'episodic',
        source: 'unit-test',
      });
      before.set(memory.id, memory.updatedAt);
    }

    await tick();
    const created = await brain.consolidate(3, 0.8);
    expect(created.length).toBeGreaterThan(0);

    const summaryMeta = JSON.parse(created[0]!.metadata ?? '{}') as { episodeIds?: string[] };
    const episodeIds = summaryMeta.episodeIds ?? [];
    expect(episodeIds.length).toBeGreaterThanOrEqual(3);

    const db = getDb();
    for (const id of episodeIds) {
      const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, id));
      expect(row!.archivedAt).toBeTruthy();
      expect(row!.updatedAt > before.get(id)!).toBe(true);
    }
  });

  it('resolveContradiction() strictly increases updated_at of the archived loser', async () => {
    const a = await brain.store({ content: 'The API listens on port 4901', type: 'semantic' });
    const b = await brain.store({ content: 'The API listens on port 3001', type: 'semantic' });
    const beforeUpdatedAt = b.memory.updatedAt;

    await tick();
    const result = await brain.resolveContradiction(b.memory.id, a.memory.id, 'keep_oldest');
    expect(result.archivedId).toBe(b.memory.id);

    const db = getDb();
    const [loser] = await db.select().from(schema.memories).where(eq(schema.memories.id, b.memory.id));
    expect(loser!.updatedAt > beforeUpdatedAt).toBe(true);
    expect(loser!.updatedAt).toBe(loser!.archivedAt);
  });

  it('recall() does NOT change updated_at, but access_count still increments (inverse guard)', async () => {
    const { memory } = await brain.store({ content: 'Recall must not bump updated at', type: 'semantic' });
    const beforeUpdatedAt = memory.updatedAt;
    const beforeAccessCount = memory.accessCount;

    await tick();
    await brain.recall('Recall must not bump updated at');

    const db = getDb();
    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(row!.updatedAt).toBe(beforeUpdatedAt);
    expect(row!.accessCount).toBeGreaterThan(beforeAccessCount);
  });

  it('populates a consistent device_id across memories, sessions, and connections', async () => {
    const deviceId = getDeviceId();

    const a = await brain.store({ content: 'Device id memory A, about caching', type: 'semantic' });
    const b = await brain.store({ content: 'Device id memory B, also about caching', type: 'semantic' });
    const sessionId = await brain.createSession('test-source');

    const db = getDb();
    const [memA] = await db.select().from(schema.memories).where(eq(schema.memories.id, a.memory.id));
    const [memB] = await db.select().from(schema.memories).where(eq(schema.memories.id, b.memory.id));
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));

    expect(memA!.deviceId).toBe(deviceId);
    expect(memB!.deviceId).toBe(deviceId);
    expect(session!.deviceId).toBe(deviceId);

    const edges = await db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.sourceId, b.memory.id));
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges) {
      expect(edge.deviceId).toBe(deviceId);
    }
  });

  it('writes every timestamp in millisecond ISO-8601 UTC across memories, sessions, connections, and context_assemblies', async () => {
    const { memory } = await brain.store({ content: 'Timestamp format probe', type: 'semantic' });
    expect(memory.createdAt).toMatch(ISO_MS_UTC);
    expect(memory.updatedAt).toMatch(ISO_MS_UTC);

    const sessionId = await brain.createSession('test-source');
    await brain.endSession(sessionId);
    const db = getDb();
    const [session] = await db.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId));
    expect(session!.startedAt).toMatch(ISO_MS_UTC);
    expect(session!.updatedAt).toMatch(ISO_MS_UTC);
    expect(session!.endedAt).toMatch(ISO_MS_UTC);

    await brain.recall('Timestamp format probe');
    const [assembly] = await db
      .select()
      .from(schema.contextAssemblies)
      .where(eq(schema.contextAssemblies.query, 'Timestamp format probe'));
    expect(assembly!.createdAt).toMatch(ISO_MS_UTC);
    const [recalled] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(recalled!.lastAccessedAt).toMatch(ISO_MS_UTC);

    // A near-duplicate to force an auto-link edge, then forget() to exercise
    // archivedAt + the memory_connections tombstone in the same assertion pass.
    const second = await brain.store({ content: 'Timestamp format probe, a near duplicate', type: 'semantic' });
    const edgesBefore = await db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.sourceId, second.memory.id));

    await brain.forget(second.memory.id);

    const [archived] = await db.select().from(schema.memories).where(eq(schema.memories.id, second.memory.id));
    expect(archived!.archivedAt).toMatch(ISO_MS_UTC);
    expect(archived!.updatedAt).toMatch(ISO_MS_UTC);

    expect(edgesBefore.length).toBeGreaterThan(0);
    const [edge] = await db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.id, edgesBefore[0]!.id));
    expect(edge!.createdAt).toMatch(ISO_MS_UTC);
    expect(edge!.updatedAt).toMatch(ISO_MS_UTC);
    expect(edge!.deletedAt).toMatch(ISO_MS_UTC);
  });
});

describe('Phase 0 — tombstoned connections are excluded from a freshly loaded graph', () => {
  let dbPath: string;

  afterEach(async () => {
    await closeDb();
    _resetMemoizedDeviceIdForTests();
    cleanupTestDb(dbPath);
  });

  it('excludes a tombstoned edge on initialize(), while the row still physically exists', async () => {
    _resetMemoizedDeviceIdForTests();
    dbPath = createTestDb();
    const brain1 = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain1.initialize();

    // Deliberately unrelated content — store()'s own auto-link (similarity
    // >= 0.5) must NOT fire between these, or it would create its own edges
    // and confound the manually inserted ones this test is isolating.
    const a = await brain1.store({ content: 'Bananas are a yellow tropical fruit', type: 'semantic' });
    const b = await brain1.store({ content: 'Rockets use combustion to reach orbit', type: 'semantic' });
    const c = await brain1.store({ content: 'Octopuses have eight arms and three hearts', type: 'semantic' });

    const db = getDb();
    const now = new Date().toISOString();
    // A live edge (control) and an already-tombstoned edge. Neither has been
    // loaded into brain1's in-memory graph yet — only initialize()/reconcile
    // does that — so this isolates the read-path filter itself.
    await db.insert(schema.memoryConnections).values([
      {
        id: 'live-edge',
        sourceId: a.memory.id,
        targetId: c.memory.id,
        relationship: 'relates_to',
        strength: 1,
        bidirectional: true,
        metadata: '{}',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'tombstoned-edge',
        sourceId: a.memory.id,
        targetId: b.memory.id,
        relationship: 'relates_to',
        strength: 1,
        bidirectional: true,
        metadata: '{}',
        createdAt: now,
        updatedAt: now,
        deletedAt: now,
      },
    ]);

    brain1.shutdown();
    await closeDb();

    // A fresh brain instance over the same file — standing in for another
    // device/process picking the database back up (or this process restarting).
    const brain2 = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain2.initialize();

    const neighbors = brain2.getGraph().getNeighbors(a.memory.id);
    expect(neighbors.some((e) => e.targetId === b.memory.id)).toBe(false); // tombstoned — must not appear
    expect(neighbors.some((e) => e.targetId === c.memory.id)).toBe(true); // live control — must appear

    const rows = await getDb().select().from(schema.memoryConnections);
    const tombstoned = rows.find((r) => r.id === 'tombstoned-edge');
    expect(tombstoned).toBeDefined();
    expect(tombstoned!.deletedAt).toBeTruthy();

    brain2.shutdown();
  });
});

describe('Phase 0 — device_id stays coherent across UPDATE paths', () => {
  // `device_id` means "the device that last wrote this row" and is the
  // last-write-wins tie-breaker. These UPDATE paths correctly bump
  // `updated_at` but previously left `device_id` stale — verify each now
  // stamps the CURRENT device's id, not whatever wrote the row originally.
  let dbPath: string;
  let brain: NeuralBrain;

  beforeEach(async () => {
    _resetMemoizedDeviceIdForTests();
    dbPath = createTestDb();
    brain = new NeuralBrain({ dbPath, defaultSource: 'test' });
    await brain.initialize();
  });

  afterEach(async () => {
    brain.shutdown();
    await closeDb();
    _resetMemoizedDeviceIdForTests();
    cleanupTestDb(dbPath);
  });

  it('addTag() sets device_id', async () => {
    const { memory } = await brain.store({ content: 'A fact worth tagging', type: 'semantic' });
    const deviceId = getDeviceId();

    await brain.addTag(memory.id, 'tagged');

    const db = getDb();
    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(row!.deviceId).toBe(deviceId);
  });

  it('removeTag() sets device_id', async () => {
    const { memory } = await brain.store({ content: 'A fact worth untagging', type: 'semantic', tags: ['temp'] });
    const deviceId = getDeviceId();

    await brain.removeTag(memory.id, 'temp');

    const db = getDb();
    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(row!.deviceId).toBe(deviceId);
  });

  it('SemanticMemory.update() sets device_id', async () => {
    const concept = await brain.semantic.store({ concept: 'device-id-update-probe', content: 'original content' });
    const deviceId = getDeviceId();

    // Clobber it first so a false pass (deviceId happening to already be
    // correct from store()) can't hide a broken update() path.
    const db = getDb();
    await db.update(schema.memories).set({ deviceId: 'stale-device' }).where(eq(schema.memories.id, concept.id));

    await brain.semantic.update(concept.id, { importance: 0.9 });

    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, concept.id));
    expect(row!.deviceId).toBe(deviceId);
  });

  it('ProceduralMemory.updateConfidence() sets device_id', async () => {
    const rule = await brain.procedural.store({
      triggerPattern: 'when the build fails',
      actionPattern: 'run the build-error-resolver agent',
      content: 'Delegate build failures to the resolver agent',
    });
    const deviceId = getDeviceId();

    const db = getDb();
    await db.update(schema.memories).set({ deviceId: 'stale-device' }).where(eq(schema.memories.id, rule.id));

    await brain.procedural.updateConfidence(rule.id, 0.5);

    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, rule.id));
    expect(row!.deviceId).toBe(deviceId);
  });

  it("reEmbed()'s per-row update sets device_id", async () => {
    const { memory } = await brain.store({ content: 'Re-embed device id probe', type: 'semantic' });
    const deviceId = getDeviceId();

    // Simulate a row written by a different (or pre-fix) device, and force
    // reEmbed to process it regardless of model staleness via onlyStale=false.
    const db = getDb();
    await db.update(schema.memories).set({ deviceId: 'stale-device' }).where(eq(schema.memories.id, memory.id));

    const progress = await brain.reEmbed(false, 10);
    expect(progress.failed).toBe(0);

    const [row] = await db.select().from(schema.memories).where(eq(schema.memories.id, memory.id));
    expect(row!.deviceId).toBe(deviceId);
  });
});
