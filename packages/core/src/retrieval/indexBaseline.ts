/**
 * Staleness check for the in-memory vector index.
 *
 * `PRAGMA data_version` (db/adapter.ts) moves only for commits made on ANOTHER
 * connection. That asymmetry is useful — a brain's own `store()` already
 * indexed its row, so there is nothing to reconcile — but it is not the whole
 * picture: `SyncEngine` applies every pulled row through `getDb()`, the very
 * connection the brain reads with, so the pragma stays put for exactly the
 * writes that leave the index behind. Built on the pragma alone, the post-pull
 * `onIndexRebuildNeeded -> syncIndexFromStore()` hook reconciled nothing and
 * pulled memories stayed unsearchable until the process restarted.
 *
 * This module supplies the two pieces of the replacement:
 *
 *  - `readChangeCounters` — the O(1) pair. `PRAGMA data_version` covers the
 *    other connections, SQLite's `total_changes()` covers this one. Between them
 *    nothing can commit unseen, so when both hold still there is provably
 *    nothing to do and a read costs microseconds, as the pragma alone used to.
 *  - `readStoreBaseline` — a fingerprint of the live rows (count + newest
 *    `updated_at`), for deciding whether a counter that DID move actually
 *    touched a memory. `total_changes()` fires for every row this process
 *    writes anywhere — session rows, webhook rows, recall access stats — and
 *    reconciling on each of those would be far worse than the bug being fixed.
 *    One aggregate over an indexed column, against the full id scan a reconcile
 *    costs.
 */

import { and, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDataVersion, getDb, schema } from '../db/index.js';

type Db = ReturnType<typeof getDb>;

/** The two O(1) change counters, each blind to what the other sees. */
export interface ChangeCounters {
  /**
   * `PRAGMA data_version` — moves only for commits by OTHER connections.
   * Null when the backend cannot report one, which means "unknown".
   */
  dataVersion: number | null;
  /**
   * SQLite `total_changes()` — rows inserted, updated or deleted by THIS
   * connection since it was opened, and therefore the only thing that sees a
   * sync pull (SyncEngine writes through `getDb()`). Null if unavailable.
   *
   * Monotonic for the life of a connection but meaningless across a reopen,
   * which is why a claim records the connection it was read from.
   */
  localChanges: number | null;
}

/** Read both counters. Cheap enough for every read path — no table is scanned. */
export function readChangeCounters(db: Db): ChangeCounters {
  let localChanges: number | null = null;
  try {
    const row = db.get(sql`select total_changes() as changes`) as { changes: number } | undefined;
    localChanges = typeof row?.changes === 'number' ? row.changes : null;
  } catch {
    // Not SQLite, or the statement is unsupported: "unknown", never "unchanged".
    localChanges = null;
  }
  return { dataVersion: getDataVersion(), localChanges };
}

/**
 * Whether both counters are known and identical — the only case in which a
 * caller may skip the fingerprint entirely. An unknown counter on either side
 * is never treated as unchanged.
 */
export function countersMatch(claimed: ChangeCounters | null, current: ChangeCounters): boolean {
  if (!claimed) return false;
  if (claimed.dataVersion === null || claimed.localChanges === null) return false;
  return claimed.dataVersion === current.dataVersion && claimed.localChanges === current.localChanges;
}

/**
 * Whether two readings are the same, an unknown counter included.
 *
 * This answers a different question from `countersMatch`: not "may I skip the
 * work" but "did anything commit between these two readings" — a caller pairing
 * counters with a fingerprint needs to know that nothing moved while it was
 * measuring, and an unavailable counter that is still unavailable has not moved.
 */
export function sameCounters(a: ChangeCounters, b: ChangeCounters): boolean {
  return a.dataVersion === b.dataVersion && a.localChanges === b.localChanges;
}

/** Fingerprint of the live memory rows the index is expected to mirror. */
export interface StoreBaseline {
  /** Live (non-archived) rows in scope. */
  rowCount: number;
  /** Newest `updated_at` among them, or null when there are none. */
  maxUpdatedAt: string | null;
}

/**
 * Read the fingerprint for the rows matching `conditions`.
 *
 * Callers MUST pass the same predicate the reconcile uses, or a change inside
 * the reconcile's scope can hide behind a fingerprint taken over a different
 * one.
 */
export async function readStoreBaseline(db: Db, conditions: SQL[]): Promise<StoreBaseline> {
  const [row] = await db
    .select({
      rowCount: sql<number>`count(*)`,
      maxUpdatedAt: sql<string | null>`max(${schema.memories.updatedAt})`,
    })
    .from(schema.memories)
    .where(and(...conditions));

  return {
    rowCount: Number(row?.rowCount ?? 0),
    maxUpdatedAt: row?.maxUpdatedAt ?? null,
  };
}

/**
 * Whether the store still looks exactly as it did when `claimed` was recorded.
 *
 * A null `claimed` means nothing has been claimed yet — treated as changed, so
 * the first check always reconciles rather than assuming an empty index is
 * right.
 *
 * The one change this cannot see is an edit that leaves both the row count and
 * the newest `updated_at` where they were — a hand-written UPDATE, or a sync
 * pull applying a remote edit whose timestamp is older than some other local
 * row. `PRAGMA data_version` still catches the first from another connection;
 * for the second the counters say something moved and this says no memory did,
 * which is why callers reconcile on any external commit rather than trusting
 * this alone.
 */
export function baselineMatches(claimed: StoreBaseline | null, current: StoreBaseline): boolean {
  return (
    claimed !== null &&
    claimed.rowCount === current.rowCount &&
    claimed.maxUpdatedAt === current.maxUpdatedAt
  );
}
