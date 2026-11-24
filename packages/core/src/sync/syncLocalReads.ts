/**
 * Local SQLite reads for the push side of sync: paged "what changed since
 * this cursor" queries against the three synced tables, plus bounded scans
 * without overlap for `SyncEngine.status()` to estimate the pending backlog.
 */

import { DEFAULT_DECAY_CONFLICT_WINDOW_MS } from '../lifecycle/DecayPolicy.js';
import { and, eq, gt, gte, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { SQLiteColumn } from 'drizzle-orm/sqlite-core';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import type { Memory, MemoryConnection, Session } from '../db/schema.js';
import type { PushCursor } from './syncLoops.js';

export type SyncDb = BetterSQLite3Database<typeof schema>;

/** The three columns every push query filters and orders on. */
interface PushColumns {
  id: SQLiteColumn;
  updatedAt: SQLiteColumn;
  deviceId: SQLiteColumn;
}

/**
 * `WHERE` clause for one page of the push queue.
 *
 * Two things beyond the obvious cursor comparison:
 *
 * 1. Only rows *this* device is responsible for are ever pushed. A row we
 *    pulled from a peer carries that peer's `device_id` **and** that peer's
 *    clock in `updated_at`; re-pushing it would feed a foreign timestamp
 *    into `sync_state.last_push_at`, and a peer whose clock runs ahead would
 *    park our cursor in the future — every subsequent local write would fall
 *    below it and never be selected again. `device_id IS NULL` rows predate
 *    device attribution but were written on this machine, so they are ours.
 *
 *    This makes the codebase's existing rule load-bearing: any local write
 *    that advances `updated_at` MUST also stamp `device_id = getDeviceId()`,
 *    or the edit becomes invisible to push. Every write path in
 *    `NeuralBrain`, `memory/`, `graph/` and `lifecycle/` does so today —
 *    treat that as a requirement when adding a new one, not a convention.
 *
 * 2. The boundary is `(updated_at, id)`, not `updated_at` alone, so a page
 *    that ends inside a group of rows sharing one timestamp resumes at the
 *    right place instead of skipping the rest of the group.
 */
function pushPageFilter(
  columns: PushColumns,
  cursor: PushCursor | null,
  deviceId: string,
  overlapMs: number | null
): SQL | undefined {
  const ours = or(isNull(columns.deviceId), eq(columns.deviceId, deviceId));
  if (cursor === null) return ours;

  // Overlap only the first page; subsequent pages use their exact (time, id)
  // boundary so a backdated group larger than one page still drains once.
  if (cursor.id === null) {
    // Status asks for a strict count. A scan includes the boundary, even
    // with a zero window: another writer can commit in the same millisecond.
    return and(ours, overlapMs === null ? gt(columns.updatedAt, cursor.ts) :
      gte(columns.updatedAt, new Date(Date.parse(cursor.ts) - overlapMs).toISOString()));
  }
  const afterCursor = or(
    gt(columns.updatedAt, cursor.ts),
    and(eq(columns.updatedAt, cursor.ts), gt(columns.id, cursor.id))
  );

  return and(ours, afterCursor);
}

export function selectMemoriesBatch(
  db: SyncDb,
  cursor: PushCursor | null,
  batchSize: number,
  deviceId: string,
  overlapMs: number | null = DEFAULT_DECAY_CONFLICT_WINDOW_MS
): Memory[] {
  const columns: PushColumns = {
    id: schema.memories.id,
    updatedAt: schema.memories.updatedAt,
    deviceId: schema.memories.deviceId,
  };
  return db
    .select()
    .from(schema.memories)
    .where(pushPageFilter(columns, cursor, deviceId, overlapMs))
    .orderBy(schema.memories.updatedAt, schema.memories.id)
    .limit(batchSize)
    .all();
}

export function selectConnectionsBatch(
  db: SyncDb,
  cursor: PushCursor | null,
  batchSize: number,
  deviceId: string,
  overlapMs: number | null = DEFAULT_DECAY_CONFLICT_WINDOW_MS
): MemoryConnection[] {
  const columns: PushColumns = {
    id: schema.memoryConnections.id,
    updatedAt: schema.memoryConnections.updatedAt,
    deviceId: schema.memoryConnections.deviceId,
  };
  return db
    .select()
    .from(schema.memoryConnections)
    .where(pushPageFilter(columns, cursor, deviceId, overlapMs))
    .orderBy(schema.memoryConnections.updatedAt, schema.memoryConnections.id)
    .limit(batchSize)
    .all();
}

export function selectSessionsBatch(
  db: SyncDb,
  cursor: PushCursor | null,
  batchSize: number,
  deviceId: string,
  overlapMs: number | null = DEFAULT_DECAY_CONFLICT_WINDOW_MS
): Session[] {
  const columns: PushColumns = {
    id: schema.sessions.id,
    updatedAt: schema.sessions.updatedAt,
    deviceId: schema.sessions.deviceId,
  };
  return db
    .select()
    .from(schema.sessions)
    .where(pushPageFilter(columns, cursor, deviceId, overlapMs))
    .orderBy(schema.sessions.updatedAt, schema.sessions.id)
    .limit(batchSize)
    .all();
}

/** Install bookkeeping only for databases using sync, and seed each target once. */
export function initializeAccessQueue(db: SyncDb, syncId: string): void {
  const seeded = `sync_access_seeded:${syncId}`;
  db.transaction((tx) => {
    if (tx.select({ key: schema.localMeta.key }).from(schema.localMeta)
      .where(eq(schema.localMeta.key, seeded)).get()) return;

    // Runs in the writer's transaction, including recalls in other processes.
    // Each pending value is the counter snapshot that must be acknowledged.
    tx.run(sql`CREATE TRIGGER IF NOT EXISTS sync_queue_memory_access
      AFTER UPDATE OF access_count, last_accessed_at ON memories
      WHEN NEW.access_count IS NOT OLD.access_count OR NEW.last_accessed_at IS NOT OLD.last_accessed_at
      BEGIN
        INSERT INTO local_meta (key, value)
        SELECT 'sync_access:' || id || ':' || NEW.id, json_array(NEW.access_count, NEW.last_accessed_at)
          FROM sync_state WHERE id IS NOT NULL
        ON CONFLICT(key) DO UPDATE SET value = excluded.value;
      END`);
    tx.run(sql`INSERT INTO local_meta (key, value)
      SELECT ${'sync_access:' + syncId + ':'} || id, json_array(access_count, last_accessed_at)
        FROM memories WHERE access_count > 0 OR last_accessed_at IS NOT NULL
      ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    tx.insert(schema.localMeta).values({ key: seeded, value: '1' }).run();
  }, { behavior: 'immediate' });
}

export function selectAccessCountersBatch(db: SyncDb, syncId: string, afterKey: string, batchSize: number) {
  const prefix = `sync_access:${syncId}:`;
  const { key, value } = schema.localMeta;
  return db.select({
    key, value,
    id: sql<string>`substr(${key}, ${prefix.length + 1})`,
    accessCount: sql<number>`json_extract(${value}, '$[0]')`,
    lastAccessedAt: sql<string | null>`json_extract(${value}, '$[1]')`,
  }).from(schema.localMeta)
    .where(and(sql`${key} GLOB ${prefix + '*'}`, gt(key, afterKey)))
    .orderBy(key).limit(batchSize).all();
}

/**
 * Estimated count of not-yet-pushed rows across all three tables, for
 * `SyncEngine.status()`. A bounded scan (one page per table) rather than a
 * true `COUNT(*)` — status is a light, occasional call, and a genuinely
 * huge backlog still reads as "a lot" at `batchSize`-ish.
 */
export function countPendingPush(
  db: SyncDb,
  lastPushAt: string | null,
  batchSize: number,
  deviceId: string
): number {
  const cursor: PushCursor | null = lastPushAt === null ? null : { ts: lastPushAt, id: null };

  return (
    selectMemoriesBatch(db, cursor, batchSize, deviceId, null).length +
    selectConnectionsBatch(db, cursor, batchSize, deviceId, null).length +
    selectSessionsBatch(db, cursor, batchSize, deviceId, null).length
  );
}
