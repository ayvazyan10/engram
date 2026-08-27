/**
 * Local SQLite reads for the push side of sync: paged "what changed since
 * this cursor" queries against the three synced tables, plus the same
 * query used (unpaged, once) by `SyncEngine.status()` to estimate the
 * pending-push backlog.
 */

import { gt } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import type { Memory, MemoryConnection, Session } from '../db/schema.js';

export type SyncDb = BetterSQLite3Database<typeof schema>;

export function selectMemoriesBatch(db: SyncDb, cursor: string | null, batchSize: number): Memory[] {
  return db
    .select()
    .from(schema.memories)
    .where(cursor !== null ? gt(schema.memories.updatedAt, cursor) : undefined)
    .orderBy(schema.memories.updatedAt)
    .limit(batchSize)
    .all();
}

export function selectConnectionsBatch(
  db: SyncDb,
  cursor: string | null,
  batchSize: number
): MemoryConnection[] {
  return db
    .select()
    .from(schema.memoryConnections)
    .where(cursor !== null ? gt(schema.memoryConnections.updatedAt, cursor) : undefined)
    .orderBy(schema.memoryConnections.updatedAt)
    .limit(batchSize)
    .all();
}

export function selectSessionsBatch(db: SyncDb, cursor: string | null, batchSize: number): Session[] {
  return db
    .select()
    .from(schema.sessions)
    .where(cursor !== null ? gt(schema.sessions.updatedAt, cursor) : undefined)
    .orderBy(schema.sessions.updatedAt)
    .limit(batchSize)
    .all();
}

/**
 * Estimated count of not-yet-pushed rows across all three tables, for
 * `SyncEngine.status()`. A bounded scan (one page per table) rather than a
 * true `COUNT(*)` — status is a light, occasional call, and a genuinely
 * huge backlog still reads as "a lot" at `batchSize`-ish.
 */
export function countPendingPush(db: SyncDb, lastPushAt: string | null, batchSize: number): number {
  const count = (rows: { updatedAt: string | null }[]): number =>
    lastPushAt === null
      ? rows.length
      : rows.filter((r) => r.updatedAt !== null && r.updatedAt > lastPushAt).length;

  return (
    count(selectMemoriesBatch(db, lastPushAt, batchSize)) +
    count(selectConnectionsBatch(db, lastPushAt, batchSize)) +
    count(selectSessionsBatch(db, lastPushAt, batchSize))
  );
}
