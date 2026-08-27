/**
 * Integration tests for the Postgres sync schema, run against a real
 * PostgreSQL instance — never mocked, since the whole point is to catch
 * things a mock can't: BYTEA byte-fidelity, FK cascade behavior, unique
 * constraint violations, and the `server_updated_at` trigger actually
 * firing inside Postgres.
 *
 * Three ways this suite gets a database, in priority order:
 *
 *  1. `TEST_PG_URL` is set (CI: a `postgres:16-alpine` service container
 *     already running alongside the job) — connect directly, no Docker
 *     needed from this process.
 *  2. No `TEST_PG_URL`, but `docker info` succeeds — spin up our own
 *     `postgres:16-alpine` via testcontainers.
 *  3. Neither — the whole suite is skipped. Same if `SKIP_PG_TESTS` is set,
 *     regardless of what's available, so it stays an explicit opt-out.
 *
 * This file is self-contained: it doesn't depend on any other test file's
 * setup and can run in isolation.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { createPgSyncConnection, type PgSyncConnection } from '../connection.js';
import { pgMemories, pgMemoryConnections, pgSessions } from '../schema.js';
import type { NewPgMemory, NewPgMemoryConnection, NewPgSession } from '../schema.js';

// ─── availability detection ────────────────────────────────────────────────

function isDockerAvailable(): boolean {
  try {
    execSync('docker info', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const TEST_PG_URL = process.env['TEST_PG_URL'];
const SKIP_REQUESTED = Boolean(process.env['SKIP_PG_TESTS']);
const DOCKER_AVAILABLE = TEST_PG_URL ? true : isDockerAvailable();

const shouldRunPgTests = !SKIP_REQUESTED && (Boolean(TEST_PG_URL) || DOCKER_AVAILABLE);
const describeWithPg = shouldRunPgTests ? describe : describe.skip;

if (!shouldRunPgTests) {
  // eslint-disable-next-line no-console
  console.info(
    `[pg-roundtrip.test.ts] skipping: ${
      SKIP_REQUESTED ? 'SKIP_PG_TESTS is set' : 'Docker is unavailable and TEST_PG_URL is not set'
    }`
  );
}

// ─── small helpers ──────────────────────────────────────────────────────────

/** `noUncheckedIndexedAccess` makes `rows[0]` possibly-undefined; this
 * asserts (and narrows) that a query actually returned something. */
function firstRow<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) {
    throw new Error('expected at least one row, got none');
  }
  return row;
}

function buildMinimalMemory(id: string, overrides: Partial<NewPgMemory> = {}): NewPgMemory {
  const now = new Date().toISOString();
  return {
    id,
    type: 'episodic',
    content: `content for ${id}`,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function sleepPastClockTick(): Promise<void> {
  // now() resolution is microseconds, but give it a comfortable margin so
  // "strictly newer" assertions aren't flaky under CI scheduling jitter.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

// ─── suite ──────────────────────────────────────────────────────────────────

describeWithPg('PostgreSQL sync schema — round-trip integration', () => {
  let pgContainer: StartedPostgreSqlContainer | undefined;
  let conn: PgSyncConnection;
  /** The URL used to open `conn` — kept around so the idempotency and
   * reconnect tests can open additional connections to the same database
   * without reaching into `conn.pool`'s internals. */
  let connectionUrl: string;
  /** Set once by the "all columns populated" memory test, checked again by
   * the reconnect test at the very end to confirm data actually persists. */
  let persistedMemoryId: string | undefined;

  beforeAll(async () => {
    process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';

    if (TEST_PG_URL) {
      connectionUrl = TEST_PG_URL;
    } else {
      pgContainer = await new PostgreSqlContainer('postgres:16-alpine').withStartupTimeout(60000).start();
      connectionUrl = `${pgContainer.getConnectionUri()}?sslmode=disable`;
    }

    conn = await createPgSyncConnection(connectionUrl);
  }, 120000);

  afterAll(async () => {
    // Clean up test data so other PG test suites sharing the same TEST_PG_URL
    // database don't fail on stale rows (e.g. embedding_model values that
    // trip SyncEngine's compatibility check).
    if (conn) {
      await conn.pool.query('DELETE FROM memory_connections').catch(() => {});
      await conn.pool.query('DELETE FROM sessions').catch(() => {});
      await conn.pool.query('DELETE FROM memories').catch(() => {});
    }
    await conn?.close();
    await pgContainer?.stop();
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
  });

  // ─── schema idempotency ───────────────────────────────────────────────────

  describe('schema creation', () => {
    it('is idempotent: connecting again against the same database does not fail', async () => {
      const secondConn = await createPgSyncConnection(connectionUrl);
      try {
        const rows = await secondConn.db.select().from(pgSessions).limit(1);
        expect(Array.isArray(rows)).toBe(true);
      } finally {
        await secondConn.close();
      }
    });
  });

  // ─── memories ─────────────────────────────────────────────────────────────

  describe('memories round-trip', () => {
    it('writes and reads back a memory with every column populated, byte-identical', async () => {
      const id = randomUUID();
      const embedding = Buffer.from(new Float32Array([0.1, 0.2, 0.3, -0.5, 1.25]).buffer);

      const record: NewPgMemory = {
        id,
        type: 'semantic',
        content: 'The Eiffel Tower is in Paris.',
        summary: 'Eiffel Tower location fact',
        embedding,
        embeddingDim: 5,
        embeddingModel: 'text-embedding-3-small',
        importance: 0.5,
        confidence: 0.75,
        accessCount: 3,
        lastAccessedAt: '2026-08-20T10:00:00.000Z',
        eventAt: '2026-08-19T09:00:00.000Z',
        sessionId: 'session-abc',
        source: 'user-input',
        concept: 'geography',
        triggerPattern: 'when discussing landmarks',
        actionPattern: 'mention the Eiffel Tower',
        namespace: 'work',
        metadata: JSON.stringify({ foo: 'bar' }),
        tags: JSON.stringify(['landmark', 'france']),
        createdAt: '2026-08-19T09:00:00.000Z',
        updatedAt: '2026-08-19T09:30:00.000Z',
        archivedAt: '2026-08-21T00:00:00.000Z',
        deviceId: 'device-1',
      };

      await conn.db.insert(pgMemories).values(record);
      const rows = await conn.db.select().from(pgMemories).where(eq(pgMemories.id, id));
      const row = firstRow(rows);

      expect(row.id).toBe(id);
      expect(row.type).toBe('semantic');
      expect(row.content).toBe(record.content);
      expect(row.summary).toBe(record.summary);
      expect(row.embedding).not.toBeNull();
      expect(Buffer.compare(row.embedding as Buffer, embedding)).toBe(0);
      expect(row.embeddingDim).toBe(5);
      expect(row.embeddingModel).toBe(record.embeddingModel);
      expect(row.importance).toBeCloseTo(0.5, 5);
      expect(row.confidence).toBeCloseTo(0.75, 5);
      expect(row.accessCount).toBe(3);
      expect(row.lastAccessedAt).toBe(record.lastAccessedAt);
      expect(row.eventAt).toBe(record.eventAt);
      expect(row.sessionId).toBe(record.sessionId);
      expect(row.source).toBe(record.source);
      expect(row.concept).toBe(record.concept);
      expect(row.triggerPattern).toBe(record.triggerPattern);
      expect(row.actionPattern).toBe(record.actionPattern);
      expect(row.namespace).toBe(record.namespace);
      expect(row.metadata).toBe(record.metadata);
      expect(row.tags).toBe(record.tags);
      expect(row.createdAt).toBe(record.createdAt);
      expect(row.updatedAt).toBe(record.updatedAt);
      expect(row.archivedAt).toBe(record.archivedAt);
      expect(row.deviceId).toBe(record.deviceId);
      expect(row.serverUpdatedAt).toBeInstanceOf(Date);

      persistedMemoryId = id;
    });

    it('stores a null embedding as null, not an empty buffer', async () => {
      const id = randomUUID();
      await conn.db.insert(pgMemories).values(
        buildMinimalMemory(id, {
          type: 'episodic',
          embedding: null,
        })
      );

      const rows = await conn.db.select().from(pgMemories).where(eq(pgMemories.id, id));
      const row = firstRow(rows);
      expect(row.embedding).toBeNull();
    });
  });

  // ─── memory_connections ───────────────────────────────────────────────────

  describe('memory_connections round-trip', () => {
    it('writes and reads back a connection with every column populated', async () => {
      const sourceId = randomUUID();
      const targetId = randomUUID();
      const connectionId = randomUUID();

      await conn.db
        .insert(pgMemories)
        .values([buildMinimalMemory(sourceId), buildMinimalMemory(targetId)]);

      const record: NewPgMemoryConnection = {
        id: connectionId,
        sourceId,
        targetId,
        relationship: 'relates_to',
        strength: 0.8,
        bidirectional: true,
        metadata: JSON.stringify({ note: 'linked during test' }),
        createdAt: '2026-08-19T09:00:00.000Z',
        updatedAt: '2026-08-19T09:05:00.000Z',
        deletedAt: '2026-08-25T12:00:00.000Z',
        deviceId: 'device-2',
      };

      await conn.db.insert(pgMemoryConnections).values(record);
      const rows = await conn.db
        .select()
        .from(pgMemoryConnections)
        .where(eq(pgMemoryConnections.id, connectionId));
      const row = firstRow(rows);

      expect(row.sourceId).toBe(sourceId);
      expect(row.targetId).toBe(targetId);
      expect(row.relationship).toBe('relates_to');
      expect(row.strength).toBeCloseTo(0.8, 5);
      expect(row.bidirectional).toBe(true);
      expect(row.metadata).toBe(record.metadata);
      expect(row.createdAt).toBe(record.createdAt);
      expect(row.updatedAt).toBe(record.updatedAt);
      expect(row.deletedAt).toBe(record.deletedAt);
      expect(row.deviceId).toBe(record.deviceId);
      expect(row.serverUpdatedAt).toBeInstanceOf(Date);
    });

    it('rejects a duplicate (sourceId, targetId, relationship) triple', async () => {
      const sourceId = randomUUID();
      const targetId = randomUUID();

      await conn.db
        .insert(pgMemories)
        .values([buildMinimalMemory(sourceId), buildMinimalMemory(targetId)]);

      const now = new Date().toISOString();
      const shared = {
        sourceId,
        targetId,
        relationship: 'causes' as const,
        createdAt: now,
      };

      await conn.db.insert(pgMemoryConnections).values({ id: randomUUID(), ...shared });

      await expect(
        conn.db.insert(pgMemoryConnections).values({ id: randomUUID(), ...shared })
      ).rejects.toThrow(/duplicate key|unique constraint/i);
    });

    it('cascades deletes from memories to their connections', async () => {
      const sourceId = randomUUID();
      const targetId = randomUUID();
      const connectionId = randomUUID();

      await conn.db
        .insert(pgMemories)
        .values([buildMinimalMemory(sourceId), buildMinimalMemory(targetId)]);
      await conn.db.insert(pgMemoryConnections).values({
        id: connectionId,
        sourceId,
        targetId,
        relationship: 'follows',
        createdAt: new Date().toISOString(),
      });

      await conn.db.delete(pgMemories).where(eq(pgMemories.id, sourceId));

      const rows = await conn.db
        .select()
        .from(pgMemoryConnections)
        .where(eq(pgMemoryConnections.id, connectionId));
      expect(rows).toHaveLength(0);
    });
  });

  // ─── sessions ─────────────────────────────────────────────────────────────

  describe('sessions round-trip', () => {
    it('writes and reads back a session with every column populated', async () => {
      const id = randomUUID();
      const record: NewPgSession = {
        id,
        source: 'cli',
        context: JSON.stringify({ project: 'neuralCore' }),
        namespace: 'work',
        startedAt: '2026-08-19T09:00:00.000Z',
        endedAt: '2026-08-19T09:45:00.000Z',
        updatedAt: '2026-08-19T09:45:00.000Z',
        deletedAt: '2026-08-26T00:00:00.000Z',
        deviceId: 'device-3',
      };

      await conn.db.insert(pgSessions).values(record);
      const rows = await conn.db.select().from(pgSessions).where(eq(pgSessions.id, id));
      const row = firstRow(rows);

      expect(row.source).toBe(record.source);
      expect(row.context).toBe(record.context);
      expect(row.namespace).toBe(record.namespace);
      expect(row.startedAt).toBe(record.startedAt);
      expect(row.endedAt).toBe(record.endedAt);
      expect(row.updatedAt).toBe(record.updatedAt);
      expect(row.deletedAt).toBe(record.deletedAt);
      expect(row.deviceId).toBe(record.deviceId);
      expect(row.serverUpdatedAt).toBeInstanceOf(Date);
    });
  });

  // ─── server_updated_at trigger ────────────────────────────────────────────

  describe('server_updated_at trigger', () => {
    it('fires on UPDATE for memories', async () => {
      const id = randomUUID();
      await conn.db.insert(pgMemories).values(buildMinimalMemory(id));
      const before = firstRow(await conn.db.select().from(pgMemories).where(eq(pgMemories.id, id)));

      await sleepPastClockTick();
      await conn.db.update(pgMemories).set({ content: 'updated content' }).where(eq(pgMemories.id, id));
      const after = firstRow(await conn.db.select().from(pgMemories).where(eq(pgMemories.id, id)));

      expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(before.serverUpdatedAt.getTime());
    });

    it('fires on UPDATE for memory_connections', async () => {
      const sourceId = randomUUID();
      const targetId = randomUUID();
      const connectionId = randomUUID();
      await conn.db
        .insert(pgMemories)
        .values([buildMinimalMemory(sourceId), buildMinimalMemory(targetId)]);
      await conn.db.insert(pgMemoryConnections).values({
        id: connectionId,
        sourceId,
        targetId,
        relationship: 'part_of',
        createdAt: new Date().toISOString(),
      });
      const before = firstRow(
        await conn.db.select().from(pgMemoryConnections).where(eq(pgMemoryConnections.id, connectionId))
      );

      await sleepPastClockTick();
      await conn.db
        .update(pgMemoryConnections)
        .set({ strength: 0.42 })
        .where(eq(pgMemoryConnections.id, connectionId));
      const after = firstRow(
        await conn.db.select().from(pgMemoryConnections).where(eq(pgMemoryConnections.id, connectionId))
      );

      expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(before.serverUpdatedAt.getTime());
    });

    it('fires on UPDATE for sessions', async () => {
      const id = randomUUID();
      await conn.db.insert(pgSessions).values({
        id,
        source: 'cli',
        startedAt: new Date().toISOString(),
      });
      const before = firstRow(await conn.db.select().from(pgSessions).where(eq(pgSessions.id, id)));

      await sleepPastClockTick();
      await conn.db
        .update(pgSessions)
        .set({ endedAt: new Date().toISOString() })
        .where(eq(pgSessions.id, id));
      const after = firstRow(await conn.db.select().from(pgSessions).where(eq(pgSessions.id, id)));

      expect(after.serverUpdatedAt.getTime()).toBeGreaterThan(before.serverUpdatedAt.getTime());
    });
  });

  // ─── reconnect ────────────────────────────────────────────────────────────
  // Kept last: it closes the shared connection and replaces it, so any test
  // added after this one would run against the reopened connection anyway,
  // but ordering it last keeps the intent obvious.

  describe('reconnecting to the same database', () => {
    it('closing and reopening the connection re-runs migrations without error and data persists', async () => {
      expect(persistedMemoryId).toBeDefined();

      await conn.close();
      conn = await createPgSyncConnection(connectionUrl);

      const rows = await conn.db
        .select()
        .from(pgMemories)
        .where(eq(pgMemories.id, persistedMemoryId as string));
      const row = firstRow(rows);
      expect(row.content).toBe('The Eiffel Tower is in Paris.');
    });
  });
});
