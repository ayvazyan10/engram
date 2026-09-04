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

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
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
import { PgSyncClient } from '../PgSyncClient.js';
import { EncryptionManager, type EncryptableRow } from '../encryption.js';
import { computeSyncId, readCursor } from '../cursor.js';
import { drainPullBatches } from '../syncLoops.js';
import { deriveKey, encryptField, generateSalt, isEncrypted } from '../crypto.js';
import type { FieldBinding } from '../crypto.js';

/** Binding for a `memories.content` value — see `crypto.ts`'s `FieldBinding`. */
function memoryContentBinding(id: string): FieldBinding {
  return { table: 'memories', id, column: 'content' };
}

// ─── availability guard + database isolation ────────────────────────────────
//
// This suite needs a Postgres database to itself, for two reasons that both
// showed up as order-dependent flakes:
//
//  1. It establishes E2E encryption metadata (`encryption_salt` /
//     `encryption_sentinel` in `sync_metadata`). Once those exist, a
//     `SyncEngine` built WITHOUT a passphrase correctly refuses to connect
//     (see `SyncEngine.initializeEncryption`) — so any leftover from an
//     encryption test, or from a previous aborted run, makes the plaintext
//     convergence tests below fail with "this sync database has end-to-end
//     encryption enabled".
//  2. It blanket-clears the three synced tables between tests, and
//     `db/pg/__tests__/pg-roundtrip.test.ts` does the same on the same
//     database from a parallel worker.
//
// So: create a private database per run, and fall back to the shared one if
// the role can't CREATE DATABASE. The `resetServerState` hooks below keep
// reason (1) impossible on either path; only reason (2) needs the private
// database.

const BASE_PG_URL =
  process.env['TEST_PG_URL'] ??
  'postgres://postgres:engram_test_pass@localhost:5432/engram_sync_test?sslmode=disable';
const SKIP_REQUESTED = Boolean(process.env['SKIP_PG_TESTS']);

/** `url` with its database swapped for `name`. */
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

let pgAvailable = false;
let isolatedDbName: string | null = null;
let resolvedPgUrl = BASE_PG_URL;

try {
  const { Pool } = await import('pg');
  const admin = new Pool({ connectionString: BASE_PG_URL, connectionTimeoutMillis: 3000 });
  await admin.query('SELECT 1');
  pgAvailable = true;

  // Identifier is built here, never from input — only [a-z0-9_].
  const candidate = `engram_sync_test_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  try {
    await admin.query(`CREATE DATABASE "${candidate}"`);
    isolatedDbName = candidate;
    resolvedPgUrl = withDatabase(BASE_PG_URL, candidate);
  } catch {
    // No CREATEDB privilege (or the server disallows it) — share the base
    // database. Still correct, just not immune to a parallel suite.
  }
  await admin.end();
} catch {
  // unavailable — describeWithPg below skips the whole suite
}

const PG_URL = resolvedPgUrl;

const shouldRun = !SKIP_REQUESTED && pgAvailable;
const describeWithPg = shouldRun ? describe : describe.skip;

/** Drops the private database created above, if there is one. */
async function dropIsolatedDatabase(): Promise<void> {
  if (isolatedDbName === null) return;
  const { Pool } = await import('pg');
  const admin = new Pool({ connectionString: BASE_PG_URL, connectionTimeoutMillis: 3000 });
  try {
    // FORCE (PG 13+) terminates any connection this suite failed to close,
    // so a leaked pool can't leave the database behind.
    await admin.query(`DROP DATABASE IF EXISTS "${isolatedDbName}" WITH (FORCE)`);
  } catch (err) {
    console.warn(`[sync-engine.test.ts] could not drop ${isolatedDbName}: ${String(err)}`);
  } finally {
    await admin.end();
  }
}

if (!shouldRun) {
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

/** Activates `device`, then runs one full `sync()` as that device, optionally with E2E encryption. */
async function syncAsDevice(
  device: Device,
  options: { syncUrl?: string; encryptionKey?: string } = {}
): Promise<SyncResult> {
  activateDevice(device);
  const engine = new SyncEngine({
    syncUrl: options.syncUrl ?? PG_URL,
    mode: 'manual',
    encryptionKey: options.encryptionKey,
  });
  try {
    return await engine.sync();
  } finally {
    await engine.dispose();
  }
}


/** Inserts one session row directly into the currently active local SQLite db. */
function insertSession(overrides: Partial<schema.NewSession> & { id: string; deviceId: string }): void {
  const now = new Date().toISOString();
  getDb()
    .insert(schema.sessions)
    .values({ source: 'test-client', startedAt: now, updatedAt: now, ...overrides })
    .run();
}

/** Inserts one connection row directly into the currently active local SQLite db. */
function insertConnection(
  overrides: Partial<schema.NewMemoryConnection> & {
    id: string;
    sourceId: string;
    targetId: string;
    deviceId: string;
  }
): void {
  const now = new Date().toISOString();
  getDb()
    .insert(schema.memoryConnections)
    .values({
      relationship: 'relates_to',
      strength: 1.0,
      bidirectional: false,
      metadata: '{}',
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .run();
}

/** The pull cursor device `d` has persisted for this suite's Postgres target. */
function pullCursorOf(d: Device): string | null {
  activateDevice(d);
  return readCursor(getDb(), computeSyncId(PG_URL))?.pullCursor ?? null;
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
    await resetServerState();
    await pgConn.close();
    await dropIsolatedDatabase();
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
  });

  // Clearing BEFORE each test, not only after, is what makes this suite
  // order-independent: an `afterEach` can be skipped entirely (a previous
  // run killed mid-suite) or abandoned partway (an earlier statement
  // throwing), and either leaves `sync_metadata` populated — at which point
  // the next passphrase-less test trips SyncEngine's encrypted-store guard.
  beforeEach(async () => {
    await resetServerState();
  });

  afterEach(async () => {
    await resetServerState();

    closeDatabase();
    delete process.env['ENGRAM_DB_PATH'];
    _resetMemoizedDeviceIdForTests();
    for (const device of activeDevices.splice(0)) {
      cleanupTestDb(device.dbPath);
      fs.rmSync(device.dir, { recursive: true, force: true });
    }
  });

  /**
   * Clears every row this suite can create on the server, atomically.
   *
   * One multi-statement simple query is one implicit transaction, so this
   * either clears everything or nothing — it can never half-succeed and
   * leave the encryption salt behind after the memory rows are already
   * gone, which is the exact state that made a later plaintext test fail.
   */
  async function resetServerState(): Promise<void> {
    await pgConn.pool.query(
      'DELETE FROM memory_connections; DELETE FROM sessions; DELETE FROM memories; DELETE FROM sync_metadata;'
    );
  }

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

  it('MAX-merges access_count even when the pusher LOSES last-write-wins on content', async () => {
    // The GREATEST() merge used to sit inside `DO UPDATE SET ... WHERE <lww>`,
    // so a pusher that lost the content comparison had its whole assignment
    // list suppressed — counters included. A device that had read a memory
    // 25 times handed that over to whichever device happened to have the
    // newer edit.
    const a = device();
    const b = device();
    const older = '2026-04-01T00:00:00.000Z';
    const newer = '2026-04-01T00:05:00.000Z';

    const deviceIdA = activateDevice(a);
    insertMemory({
      id: 'mem-loser', deviceId: deviceIdA, content: 'content from A',
      accessCount: 3, createdAt: older, updatedAt: newer,
    });
    await syncAsDevice(a);

    const deviceIdB = activateDevice(b);
    insertMemory({
      id: 'mem-loser', deviceId: deviceIdB, content: 'content from B',
      accessCount: 25, lastAccessedAt: '2026-04-02T00:00:00.000Z',
      createdAt: older, updatedAt: older,
    });
    await syncAsDevice(b); // loses LWW on content, but still owns the higher count

    const onServer = await pgConn.pool.query<{ access_count: number; content: string; last_accessed_at: string | null }>(
      'SELECT access_count, content, last_accessed_at FROM memories WHERE id = $1',
      ['mem-loser']
    );
    expect(onServer.rows[0]?.content).toBe('content from A'); // LWW still decides content
    expect(onServer.rows[0]?.access_count).toBe(25); // but the counter is MAX'd
    expect(onServer.rows[0]?.last_accessed_at).toBe('2026-04-02T00:00:00.000Z');
  });

  it('applies the MAX-merged counters on pull even when the LOCAL row wins last-write-wins', async () => {
    // `applyPulledMemory` returned early on a local win and threw away the
    // merged counters `resolveMemoryConflict` had already computed, so a
    // peer's higher count never landed locally.
    const a = device();
    const b = device();
    const older = '2026-04-10T00:00:00.000Z';
    const newer = '2026-04-10T00:05:00.000Z';

    const deviceIdA = activateDevice(a);
    insertMemory({
      id: 'mem-local-wins', deviceId: deviceIdA, content: 'old content, many reads',
      accessCount: 99, lastAccessedAt: '2026-04-11T00:00:00.000Z',
      createdAt: older, updatedAt: older,
    });
    await syncAsDevice(a);

    const deviceIdB = activateDevice(b);
    insertMemory({
      id: 'mem-local-wins', deviceId: deviceIdB, content: 'new content, few reads',
      accessCount: 1, createdAt: older, updatedAt: newer,
    });

    // Pull only: B's local row is newer, so it wins content — but it must
    // still take A's higher counter.
    activateDevice(b);
    const engine = new SyncEngine({ syncUrl: PG_URL, mode: 'manual' });
    try {
      await engine.pull();
    } finally {
      await engine.dispose();
    }

    activateDevice(b);
    const merged = readMemory('mem-local-wins');
    expect(merged?.content).toBe('new content, few reads'); // local still wins content
    expect(merged?.accessCount).toBe(99);
    expect(merged?.lastAccessedAt).toBe('2026-04-11T00:00:00.000Z');
    // and the merge must not look like an edit, or the row re-enters the
    // push queue on every cycle from now on
    expect(merged?.updatedAt).toBe(newer);
  });

  it('teaches the pushing device the merged counter it would otherwise never pull back', async () => {
    // A device that wins LWW stamps the row with its own device_id, and its
    // own next pull filters that row out as an echo — so the push RETURNING
    // is the only point at which it can learn the server-side merge.
    const a = device();
    const b = device();
    const older = '2026-04-20T00:00:00.000Z';
    const newer = '2026-04-20T00:05:00.000Z';

    const deviceIdA = activateDevice(a);
    insertMemory({
      id: 'mem-writeback', deviceId: deviceIdA, content: 'from A',
      accessCount: 42, createdAt: older, updatedAt: older,
    });
    await syncAsDevice(a);

    const deviceIdB = activateDevice(b);
    insertMemory({
      id: 'mem-writeback', deviceId: deviceIdB, content: 'from B',
      accessCount: 2, createdAt: older, updatedAt: newer,
    });
    await syncAsDevice(b); // B wins LWW on content; server MAXes the count to 42

    activateDevice(b);
    const local = readMemory('mem-writeback');
    expect(local?.content).toBe('from B');
    expect(local?.accessCount).toBe(42);
    expect(local?.updatedAt).toBe(newer); // still not an edit
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

  // ─── 8. E2E encryption (Phase 6) ─────────────────────────────────────────
  // Runs in the same describe block as the tests above (rather than a
  // separate file) deliberately: it shares this suite's live Postgres
  // fixture and blanket-truncating before/after hooks, which only stay
  // correct if every test touching them runs sequentially in one worker —
  // splitting into another file would let Vitest schedule it in a second
  // worker and race the shared tables against this file's own tests.

  describe('E2E encryption (Phase 6)', () => {
    it('encrypts memory content/summary before push, and a second device with the same passphrase decrypts it back on pull', async () => {
      const passphrase = 'correct horse battery staple';
      const a = device();
      const b = device();

      const deviceIdA = activateDevice(a);
      insertMemory({
        id: 'mem-enc-1',
        deviceId: deviceIdA,
        content: 'sensitive content from A',
        summary: 'sensitive summary from A',
      });

      const pushResult = await syncAsDevice(a, { encryptionKey: passphrase });
      expect(pushResult.pushed.memories).toBe(1);

      const raw = await pgConn.pool.query<{ content: string; summary: string | null }>(
        'SELECT content, summary FROM memories WHERE id = $1',
        ['mem-enc-1']
      );
      const rawContent = raw.rows[0]?.content;
      const rawSummary = raw.rows[0]?.summary;
      expect(rawContent).toBeDefined();
      expect(rawContent).not.toBe('sensitive content from A');
      expect(rawContent ? isEncrypted(rawContent) : false).toBe(true);
      expect(rawSummary).not.toBe('sensitive summary from A');
      expect(rawSummary ? isEncrypted(rawSummary) : false).toBe(true);

      const pullResult = await syncAsDevice(b, { encryptionKey: passphrase });
      expect(pullResult.pulled.memories).toBe(1);

      activateDevice(b);
      const local = readMemory('mem-enc-1');
      expect(local?.content).toBe('sensitive content from A');
      expect(local?.summary).toBe('sensitive summary from A');
    });

    it('rejects a device that syncs with the wrong passphrase once a passphrase is already established', async () => {
      const a = device();
      const b = device();

      const deviceIdA = activateDevice(a);
      insertMemory({ id: 'mem-guarded', deviceId: deviceIdA, content: 'guarded content' });
      await syncAsDevice(a, { encryptionKey: 'the-real-passphrase' });

      await expect(syncAsDevice(b, { encryptionKey: 'a-completely-wrong-passphrase' })).rejects.toThrow(
        /passphrase/i
      );
    });

    it('skips a memory row that cannot be decrypted under the current key, without aborting the rest of the sync', async () => {
      const passphrase = 'correct horse battery staple';
      const a = device();
      const b = device();

      const deviceIdA = activateDevice(a);
      insertMemory({ id: 'mem-ok', deviceId: deviceIdA, content: 'decryptable content' });
      // Establishes the salt/sentinel on PG for `passphrase`.
      await syncAsDevice(a, { encryptionKey: passphrase });

      // Simulate a row whose ciphertext was produced under a different key
      // (corrupted data, or a leftover row from before a passphrase change)
      // — insert it directly on Postgres so it never goes through this
      // session's EncryptionManager.
      const bogusKey = await deriveKey('a-totally-different-key', generateSalt());
      const now = new Date().toISOString();
      await pgConn.pool.query(
        `INSERT INTO memories (id, type, content, created_at, updated_at, device_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          'mem-corrupted',
          'semantic',
          encryptField('unrecoverable content', bogusKey, memoryContentBinding('mem-corrupted')),
          now,
          now,
          deviceIdA,
        ]
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const pullResult = await syncAsDevice(b, { encryptionKey: passphrase });
        expect(pullResult.pulled.memories).toBe(1); // only mem-ok, mem-corrupted was skipped
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('mem-corrupted'));
      } finally {
        warnSpy.mockRestore();
      }

      activateDevice(b);
      expect(readMemory('mem-ok')?.content).toBe('decryptable content');
      expect(readMemory('mem-corrupted')).toBeUndefined();
    });

    // ─── D4: bootstrap atomicity, against real Postgres ──────────────────

    it('leaves one salt and one usable key when several devices bootstrap at once', async () => {
      const client = new PgSyncClient({ db: pgConn.db, pool: pgConn.pool });
      const managers = Array.from({ length: 5 }, () => new EncryptionManager(client));

      await Promise.all(managers.map((m) => m.initialize('shared passphrase')));

      const salts = await pgConn.pool.query(
        `SELECT DISTINCT value FROM sync_metadata WHERE key = 'encryption_salt'`
      );
      expect(salts.rowCount).toBe(1);

      // Every bootstrapper must hold the key derived from that one salt,
      // not from the salt it happened to generate itself.
      const row: EncryptableRow = {
        id: 'mem-shared-bootstrap', content: 'shared secret', summary: null, metadata: null,
        tags: null, embedding: null, concept: null, triggerPattern: null, actionPattern: null,
      };
      const encrypted = managers[0]!.encryptRow(row);
      for (const other of managers.slice(1)) {
        expect(other.decryptRow(encrypted)).toEqual(row);
      }

      await expect(new EncryptionManager(client).initialize('shared passphrase')).resolves.toBeUndefined();
    });

    it('recovers from a bootstrap killed between the salt write and the sentinel write', async () => {
      // Exactly the half-written state a SIGKILL used to leave behind.
      await pgConn.pool.query(
        `INSERT INTO sync_metadata (key, value) VALUES ('encryption_salt', $1)`,
        [generateSalt().toString('hex')]
      );

      const client = new PgSyncClient({ db: pgConn.db, pool: pgConn.pool });
      await expect(new EncryptionManager(client).initialize('a passphrase')).resolves.toBeUndefined();

      const sentinel = await pgConn.pool.query(
        `SELECT value FROM sync_metadata WHERE key = 'encryption_sentinel'`
      );
      expect(sentinel.rowCount).toBe(1);
    });

    // ─── D5: a client with no passphrase must not downgrade the store ────

    it('refuses to sync a passphrase-less client against a database that has encryption established', async () => {
      const a = device();
      const b = device();

      const deviceIdA = activateDevice(a);
      insertMemory({ id: 'mem-secret', deviceId: deviceIdA, content: 'secret content from A' });
      await syncAsDevice(a, { encryptionKey: 'the-real-passphrase' });

      const deviceIdB = activateDevice(b);
      insertMemory({ id: 'mem-plain-b', deviceId: deviceIdB, content: 'plaintext content from B' });

      await expect(syncAsDevice(b)).rejects.toThrow(/ENGRAM_SYNC_ENCRYPTION_KEY/);

      // A's ciphertext must still be ciphertext, and B must not have pushed
      // anything at all.
      const raw = await pgConn.pool.query<{ id: string; content: string }>(
        'SELECT id, content FROM memories ORDER BY id'
      );
      expect(raw.rows.map((r) => r.id)).toEqual(['mem-secret']);
      expect(isEncrypted(raw.rows[0]!.content)).toBe(true);
    });

    it('applies a legacy plaintext row instead of dropping it as undecryptable', async () => {
      const passphrase = 'correct horse battery staple';
      const b = device();

      // Exactly what a client running without ENGRAM_SYNC_ENCRYPTION_KEY
      // left behind: plaintext strings AND a plaintext embedding, which has
      // no `enc:v1:` marker of its own to distinguish it by.
      const now = new Date().toISOString();
      await pgConn.pool.query(
        `INSERT INTO memories (id, type, content, summary, embedding, metadata, tags,
                               created_at, updated_at, device_id)
         VALUES ($1, 'semantic', $2, $3, $4, '{}', '[]', $5, $5, 'device-legacy')`,
        [
          'mem-legacy-plain',
          'legacy plaintext content',
          'legacy plaintext summary',
          Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
          now,
        ]
      );

      const result = await syncAsDevice(b, { encryptionKey: passphrase });
      expect(result.pulled.memories).toBe(1);

      activateDevice(b);
      const local = readMemory('mem-legacy-plain');
      expect(local?.content).toBe('legacy plaintext content');
      expect(local?.summary).toBe('legacy plaintext summary');
      expect(local?.embedding?.equals(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]))).toBe(true);
    });

    it('holds the pull cursor before a row it cannot decrypt', async () => {
      const passphrase = 'correct horse battery staple';
      const a = device();
      const b = device();

      const deviceIdA = activateDevice(a);
      insertMemory({ id: 'mem-ok-2', deviceId: deviceIdA, content: 'decryptable content' });
      await syncAsDevice(a, { encryptionKey: passphrase });

      const bogusKey = await deriveKey('a-totally-different-key', generateSalt());
      const now = new Date().toISOString();
      await pgConn.pool.query(
        `INSERT INTO memories (id, type, content, created_at, updated_at, device_id)
         VALUES ($1, 'semantic', $2, $3, $3, $4)`,
        [
          'mem-corrupted-2',
          encryptField('unrecoverable', bogusKey, memoryContentBinding('mem-corrupted-2')),
          now,
          deviceIdA,
        ]
      );

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await syncAsDevice(b, { encryptionKey: passphrase });
      } finally {
        warnSpy.mockRestore();
      }

      // Skipping the row while advancing the cursor past it loses it for
      // good once it ages out of the 5-minute overlap window.
      expect(pullCursorOf(b)).toBeNull();
    });

    // ─── D6: every user-content column, not just content/summary ─────────

    it('encrypts concept, trigger/action patterns, session context and connection metadata', async () => {
      const passphrase = 'correct horse battery staple';
      const a = device();
      const b = device();

      const deviceIdA = activateDevice(a);
      insertSession({
        id: 'sess-1',
        deviceId: deviceIdA,
        source: 'claude-code',
        namespace: 'work',
        context: JSON.stringify({ cwd: '/home/secret-project' }),
      });
      insertMemory({
        id: 'mem-proc',
        deviceId: deviceIdA,
        type: 'procedural',
        content: 'procedure body',
        concept: 'deploying the billing service',
        triggerPattern: 'when the user says deploy billing',
        actionPattern: 'run ./scripts/deploy-billing.sh --prod',
        sessionId: 'sess-1',
        source: 'claude-code',
        namespace: 'work',
      });
      insertMemory({ id: 'mem-proc-2', deviceId: deviceIdA, content: 'second memory' });
      insertConnection({
        id: 'conn-1',
        sourceId: 'mem-proc',
        targetId: 'mem-proc-2',
        deviceId: deviceIdA,
        relationship: 'relates_to',
        metadata: JSON.stringify({ note: 'derived from the billing runbook' }),
      });

      await syncAsDevice(a, { encryptionKey: passphrase });

      const mem = await pgConn.pool.query<{
        concept: string; trigger_pattern: string; action_pattern: string;
        namespace: string; session_id: string; source: string;
      }>(
        `SELECT concept, trigger_pattern, action_pattern, namespace, session_id, source
         FROM memories WHERE id = 'mem-proc'`
      );
      const row = mem.rows[0]!;
      expect(isEncrypted(row.concept)).toBe(true);
      expect(isEncrypted(row.trigger_pattern)).toBe(true);
      expect(isEncrypted(row.action_pattern)).toBe(true);
      // Filter/cursor columns must stay readable or sync itself breaks.
      expect(row.namespace).toBe('work');
      expect(row.session_id).toBe('sess-1');
      expect(row.source).toBe('claude-code');

      const sess = await pgConn.pool.query<{ context: string; source: string; namespace: string }>(
        `SELECT context, source, namespace FROM sessions WHERE id = 'sess-1'`
      );
      expect(isEncrypted(sess.rows[0]!.context)).toBe(true);
      expect(sess.rows[0]!.source).toBe('claude-code');
      expect(sess.rows[0]!.namespace).toBe('work');

      const conn = await pgConn.pool.query<{ metadata: string; relationship: string }>(
        `SELECT metadata, relationship FROM memory_connections WHERE id = 'conn-1'`
      );
      expect(isEncrypted(conn.rows[0]!.metadata)).toBe(true);
      expect(conn.rows[0]!.relationship).toBe('relates_to');

      // …and a peer with the same passphrase gets all of it back.
      await syncAsDevice(b, { encryptionKey: passphrase });
      activateDevice(b);
      const pulled = readMemory('mem-proc');
      expect(pulled?.concept).toBe('deploying the billing service');
      expect(pulled?.triggerPattern).toBe('when the user says deploy billing');
      expect(pulled?.actionPattern).toBe('run ./scripts/deploy-billing.sh --prod');

      const pulledSession = getDb()
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, 'sess-1'))
        .get();
      expect(pulledSession?.context).toBe(JSON.stringify({ cwd: '/home/secret-project' }));

      const pulledConn = getDb()
        .select()
        .from(schema.memoryConnections)
        .where(eq(schema.memoryConnections.id, 'conn-1'))
        .get();
      expect(pulledConn?.metadata).toBe(JSON.stringify({ note: 'derived from the billing runbook' }));
    });
  });

  // ─── 9. pull pagination across a same-timestamp group (D3) ───────────────

  describe('pull pagination', () => {
    it('delivers every row of a server_updated_at group larger than one page', async () => {
      // A single INSERT runs in one transaction, and the
      // `engram_touch_server_updated_at` trigger stamps `now()` — the
      // transaction clock — so all 1200 rows land on ONE distinct
      // `server_updated_at`, exactly the shape a bulk migration produces.
      const now = new Date().toISOString();
      await pgConn.pool.query(
        `INSERT INTO memories (id, type, content, created_at, updated_at, device_id)
         SELECT 'mem-bulk-' || lpad(i::text, 5, '0'), 'semantic', 'bulk ' || i, $1, $1, 'device-elsewhere'
         FROM generate_series(1, 1200) AS i`,
        [now]
      );

      const distinct = await pgConn.pool.query<{ count: string }>(
        'SELECT count(DISTINCT server_updated_at)::text AS count FROM memories'
      );
      expect(distinct.rows[0]?.count).toBe('1');

      const client = new PgSyncClient({ db: pgConn.db, pool: pgConn.pool, batchSize: 500 });
      const seen = new Set<string>();
      const result = await drainPullBatches<{ id: string }>(
        (ts, id) =>
          client.pullMemories(ts, id, 'device-me').then((b) => ({
            rows: b.memories,
            maxServerUpdatedAt: b.maxServerUpdatedAt,
            lastId: b.lastId,
            hasMore: b.hasMore,
          })),
        () => true,
        (row) => {
          seen.add(row.id);
          return { applied: true, conflict: false };
        },
        null
      );

      expect(seen.size).toBe(1200);
      expect(result.applied).toBe(1200);
    });
  });
});
