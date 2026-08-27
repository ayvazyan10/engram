/**
 * Phase 2 integration tests for `SyncEngine` — the multi-device sync
 * orchestrator. Run against a REAL local PostgreSQL (never mocked) and real
 * temp SQLite databases for two simulated devices, "A" and "B", since the
 * whole point is convergence behavior that a mock can't exercise honestly:
 * LWW conflict resolution, access_count MAX'ing, tombstone propagation, and
 * the embedding-model compatibility guard.
 *
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` (section 5, Phase 2) for
 * the acceptance criteria this file implements.
 *
 * Simulating two devices means two separate SQLite databases sharing one
 * process. `getDeviceId()` memoizes its result at module scope, so switching
 * "the active device" means: close the current db, point `ENGRAM_DB_PATH`
 * at the other device's file, reset the device-id memo, and reopen — see
 * `activateDevice()` below. `SyncEngine` picks up both `getDb()` and
 * `getDeviceId()` at construction time, so it must always be constructed
 * (or re-synced) right after activating the device it should act as.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { eq } from 'drizzle-orm';

import { getDb, closeDatabase } from '../../db/index.js';
import * as schema from '../../db/schema.js';
import type { NewMemory } from '../../db/schema.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';
import { getDeviceId, _resetMemoizedDeviceIdForTests } from '../deviceId.js';
import { getEmbeddingModelId } from '../../embedding/Embedder.js';
import { createPgSyncConnection, type PgSyncConnection } from '../../db/pg/connection.js';
import { SyncEngine, type SyncResult } from '../SyncEngine.js';

// ─── availability guard ─────────────────────────────────────────────────────

const PG_URL =
  process.env['TEST_PG_URL'] ??
  'postgres://postgres:engram_test_pass@localhost:5432/engram_sync_test?sslmode=disable';
const SKIP_REQUESTED = Boolean(process.env['SKIP_PG_TESTS']);

let pgAvailable = false;
try {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: PG_URL, connectionTimeoutMillis: 3000 });
  await pool.query('SELECT 1');
  await pool.end();
  pgAvailable = true;
} catch {
  // unavailable — describeWithPg below skips the whole suite
}

const shouldRun = !SKIP_REQUESTED && pgAvailable;
const describeWithPg = shouldRun ? describe : describe.skip;

if (!shouldRun) {
  // eslint-disable-next-line no-console
  console.info(
    `[sync-engine.test.ts] skipping: ${
      SKIP_REQUESTED ? 'SKIP_PG_TESTS is set' : `PostgreSQL is unavailable at ${PG_URL}`
    }`
  );
}

// ─── device simulation helpers ──────────────────────────────────────────────

interface Device {
  dir: string;
  dbPath: string;
}

/** Creates a fresh temp directory + SQLite path for one simulated device. */
function createDevice(): Device {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-sync-engine-test-'));
  return { dir, dbPath: path.join(dir, 'test.db') };
}

/**
 * Makes `device` the "current" database for every subsequent `getDb()` /
 * `getDeviceId()` call in this process, and returns its (freshly
 * read-or-generated) device id.
 */
function activateDevice(device: Device): string {
  closeDatabase();
  process.env['ENGRAM_DB_PATH'] = device.dbPath;
  _resetMemoizedDeviceIdForTests();
  getDb();
  return getDeviceId();
}

/** Inserts one memory row directly into the currently active local SQLite db. */
function insertMemory(overrides: Partial<NewMemory> & { id: string; deviceId: string }): void {
  const now = new Date().toISOString();
  const row: NewMemory = {
    type: 'semantic',
    content: `content for ${overrides.id}`,
    embeddingDim: 384,
    importance: 0.5,
    confidence: 1.0,
    accessCount: 0,
    metadata: '{}',
    tags: '[]',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
  getDb().insert(schema.memories).values(row).run();
}

function readMemory(id: string): schema.Memory | undefined {
  return getDb().select().from(schema.memories).where(eq(schema.memories.id, id)).get();
}

/** Activates `device`, then runs one full `sync()` as that device. */
async function syncAsDevice(device: Device, syncUrl: string = PG_URL): Promise<SyncResult> {
  activateDevice(device);
  const engine = new SyncEngine({ syncUrl, mode: 'manual' });
  try {
    return await engine.sync();
  } finally {
    await engine.dispose();
  }
}

// ─── suite ──────────────────────────────────────────────────────────────────

describeWithPg('SyncEngine — multi-device convergence (Phase 2)', () => {
  let pgConn: PgSyncConnection;
  const activeDevices: Device[] = [];

  beforeAll(async () => {
    process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';
    pgConn = await createPgSyncConnection(PG_URL);
  });

  afterAll(async () => {
    await pgConn.pool.query('DELETE FROM memory_connections');
    await pgConn.pool.query('DELETE FROM sessions');
    await pgConn.pool.query('DELETE FROM memories');
    await pgConn.close();
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
  });

  afterEach(async () => {
    await pgConn.pool.query('DELETE FROM memory_connections');
    await pgConn.pool.query('DELETE FROM sessions');
    await pgConn.pool.query('DELETE FROM memories');

    closeDatabase();
    delete process.env['ENGRAM_DB_PATH'];
    _resetMemoizedDeviceIdForTests();
    for (const device of activeDevices.splice(0)) {
      cleanupTestDb(device.dbPath);
      fs.rmSync(device.dir, { recursive: true, force: true });
    }
  });

  function device(): Device {
    const d = createDevice();
    activeDevices.push(d);
    return d;
  }

  // ─── 1. convergence ─────────────────────────────────────────────────────

  it('converges two devices to the same 5 memories after push + pull', async () => {
    const a = device();
    const b = device();

    const deviceIdA = activateDevice(a);
    insertMemory({ id: 'mem-a1', deviceId: deviceIdA, content: 'a1' });
    insertMemory({ id: 'mem-a2', deviceId: deviceIdA, content: 'a2' });
    insertMemory({ id: 'mem-a3', deviceId: deviceIdA, content: 'a3' });
    await syncAsDevice(a); // push A's 3, pull nothing yet

    const deviceIdB = activateDevice(b);
    insertMemory({ id: 'mem-b1', deviceId: deviceIdB, content: 'b1' });
    insertMemory({ id: 'mem-b2', deviceId: deviceIdB, content: 'b2' });
    await syncAsDevice(b); // push B's 2, pull A's 3 already on PG

    await syncAsDevice(a); // pull B's 2

    const allIds = ['mem-a1', 'mem-a2', 'mem-a3', 'mem-b1', 'mem-b2'];

    activateDevice(a);
    for (const id of allIds) {
      expect(readMemory(id), `device A missing ${id}`).toBeDefined();
    }

    activateDevice(b);
    for (const id of allIds) {
      expect(readMemory(id), `device B missing ${id}`).toBeDefined();
    }
  });

  // ─── 2. idempotency ─────────────────────────────────────────────────────

  it('running sync() repeatedly with no changes creates no duplicates and reports 0/0/0', async () => {
    const a = device();
    const deviceIdA = activateDevice(a);
    insertMemory({ id: 'mem-stable', deviceId: deviceIdA, content: 'stable content' });

    const first = await syncAsDevice(a);
    expect(first.pushed.memories).toBe(1);

    const results: SyncResult[] = [];
    for (let i = 0; i < 5; i++) {
      results.push(await syncAsDevice(a));
    }

    for (const result of results) {
      expect(result.pushed).toEqual({ memories: 0, connections: 0, sessions: 0 });
      expect(result.pulled).toEqual({ memories: 0, connections: 0, sessions: 0 });
      expect(result.conflicts).toBe(0);
    }

    activateDevice(a);
    const row = readMemory('mem-stable');
    expect(row?.content).toBe('stable content');

    const remoteRows = await pgConn.pool.query('SELECT id FROM memories WHERE id = $1', ['mem-stable']);
    expect(remoteRows.rowCount).toBe(1);
  });

  // ─── 3. offline write, then sync once reachable ────────────────────────

  it('a local write survives with no PG connection, then reaches PG once the connection is fixed', async () => {
    const a = device();
    const deviceIdA = activateDevice(a);
    insertMemory({ id: 'mem-offline', deviceId: deviceIdA, content: 'written while offline' });

    // Local write is durable on its own — no sync involved yet.
    expect(readMemory('mem-offline')?.content).toBe('written while offline');

    const badUrl = 'postgres://postgres:wrong_password_xyz@localhost:5432/engram_sync_test?sslmode=disable';
    activateDevice(a);
    const badEngine = new SyncEngine({ syncUrl: badUrl, mode: 'manual' });
    try {
      await expect(badEngine.sync()).rejects.toThrow();
    } finally {
      await badEngine.dispose();
    }

    // The bad sync must not have corrupted the local row.
    activateDevice(a);
    expect(readMemory('mem-offline')?.content).toBe('written while offline');

    const result = await syncAsDevice(a);
    expect(result.pushed.memories).toBe(1);

    const remoteRows = await pgConn.pool.query<{ content: string }>(
      'SELECT content FROM memories WHERE id = $1',
      ['mem-offline']
    );
    expect(remoteRows.rowCount).toBe(1);
    expect(remoteRows.rows[0]?.content).toBe('written while offline');
  });

  // ─── 4. conflict: later updatedAt wins on both devices ─────────────────

  it('resolves a simultaneous edit by last-write-wins and converges both devices', async () => {
    const a = device();
    const b = device();
    const t1 = '2026-01-01T00:00:00.000Z';
    const t2 = '2026-01-01T00:05:00.000Z'; // strictly later than t1

    const deviceIdA = activateDevice(a);
    insertMemory({
      id: 'mem-conflict',
      deviceId: deviceIdA,
      content: 'edited on A',
      createdAt: t1,
      updatedAt: t1,
    });
    await syncAsDevice(a);

    const deviceIdB = activateDevice(b);
    insertMemory({
      id: 'mem-conflict',
      deviceId: deviceIdB,
      content: 'edited on B',
      createdAt: t1,
      updatedAt: t2,
    });
    const bResult = await syncAsDevice(b);
    expect(bResult.pushed.memories).toBe(1);

    // A's second sync pulls B's newer edit and must resolve in B's favor.
    const aResult = await syncAsDevice(a);
    expect(aResult.pulled.memories).toBe(1);
    expect(aResult.conflicts).toBe(1);

    activateDevice(a);
    expect(readMemory('mem-conflict')?.content).toBe('edited on B');

    activateDevice(b);
    expect(readMemory('mem-conflict')?.content).toBe('edited on B');
  });

  // ─── 5. deletion (archive) propagates ───────────────────────────────────

  it('propagates an archive (soft delete) on device A to device B', async () => {
    const a = device();
    const b = device();
    const t1 = '2026-02-01T00:00:00.000Z';
    const t2 = '2026-02-01T00:10:00.000Z';

    const deviceIdA = activateDevice(a);
    insertMemory({
      id: 'mem-to-delete',
      deviceId: deviceIdA,
      content: 'will be archived',
      createdAt: t1,
      updatedAt: t1,
    });
    await syncAsDevice(a);

    activateDevice(b);
    await syncAsDevice(b); // B pulls the memory before it's archived
    activateDevice(b);
    expect(readMemory('mem-to-delete')).toBeDefined();
    expect(readMemory('mem-to-delete')?.archivedAt).toBeNull();

    // Archiving must bump updatedAt too — that's what both the push upsert's
    // LWW guard and the pull-side conflict comparison key off of.
    activateDevice(a);
    getDb()
      .update(schema.memories)
      .set({ archivedAt: t2, updatedAt: t2 })
      .where(eq(schema.memories.id, 'mem-to-delete'))
      .run();
    const aResult = await syncAsDevice(a);
    expect(aResult.pushed.memories).toBe(1);

    const bResult = await syncAsDevice(b);
    expect(bResult.pulled.memories).toBe(1);

    activateDevice(b);
    expect(readMemory('mem-to-delete')?.archivedAt).toBe(t2);
  });

  // ─── 6. access_count converges to MAX, not LWW ──────────────────────────

  it('keeps access_count at the MAX across devices even when the higher count loses LWW on content', async () => {
    const a = device();
    const b = device();
    const t1 = '2026-03-01T00:00:00.000Z';
    const t2 = '2026-03-01T00:05:00.000Z'; // later than t1 — wins content LWW

    const deviceIdA = activateDevice(a);
    insertMemory({
      id: 'mem-counter',
      deviceId: deviceIdA,
      content: 'content from A',
      accessCount: 10,
      createdAt: t1,
      updatedAt: t1,
    });
    await syncAsDevice(a);

    const deviceIdB = activateDevice(b);
    insertMemory({
      id: 'mem-counter',
      deviceId: deviceIdB,
      content: 'content from B',
      accessCount: 3,
      createdAt: t1,
      updatedAt: t2,
    });
    await syncAsDevice(b); // pushes access_count=3, but PG GREATEST()s it to 10

    const afterBPush = await pgConn.pool.query<{ access_count: number; content: string }>(
      'SELECT access_count, content FROM memories WHERE id = $1',
      ['mem-counter']
    );
    expect(afterBPush.rows[0]?.access_count).toBe(10);
    expect(afterBPush.rows[0]?.content).toBe('content from B');

    // A pulls B's newer, higher-access_count-preserving row.
    const aResult = await syncAsDevice(a);
    expect(aResult.pulled.memories).toBe(1);

    activateDevice(a);
    const merged = readMemory('mem-counter');
    expect(merged?.content).toBe('content from B'); // later updatedAt wins content
    expect(merged?.accessCount).toBe(10); // access_count is MAX'd, never overwritten down
  });

  // ─── 7. incompatible embedding model stops sync ─────────────────────────

  it('refuses to sync when the remote embedding model differs from the local one', async () => {
    const localModel = getEmbeddingModelId();
    const remoteModel = `${localModel}-incompatible`;
    const now = new Date().toISOString();

    await pgConn.pool.query(
      `INSERT INTO memories (id, type, content, embedding_model, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ['mem-remote-model', 'semantic', 'seeded directly on PG', remoteModel, now, now]
    );

    const a = device();
    activateDevice(a);
    const engine = new SyncEngine({ syncUrl: PG_URL, mode: 'manual' });
    try {
      await expect(engine.sync()).rejects.toThrow(/Embedding model mismatch/);
    } finally {
      await engine.dispose();
    }
  });
});
