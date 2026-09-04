/**
 * Generic push/pull draining loops shared by `SyncEngine`'s three synced
 * tables (memories, memory_connections, sessions). Pure, dependency-free
 * except for the callbacks passed in — no direct DB or network access, so
 * these are trivial to reason about and test in isolation from the rest of
 * the sync machinery.
 */

/** Result of applying one pulled row locally. */
export interface ApplyOutcome {
  applied: boolean;
  conflict: boolean;
}

/** Later of two nullable, lexicographically-sortable ISO strings. `null` loses. */
export function maxNullable(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

/**
 * Composite push cursor: `updated_at` plus the row id that timestamp was
 * last seen on. The persisted cursor (`sync_state.last_push_at`) is a bare
 * timestamp, so `id` is `null` on the first page of a drain and non-null
 * only while paging inside one drain.
 */
export interface PushCursor {
  ts: string;
  id: string | null;
}

/**
 * Drains one table's local push queue in `batchSize` pages, starting from
 * `startCursor`. Stops on a partial page, or if the cursor fails to advance
 * (an all-null `updatedAt` tail) — the latter would otherwise loop forever.
 *
 * Pages resume on `(updated_at, id)`, not on `updated_at` alone. A bare
 * `> updated_at` boundary silently drops every remaining row that shares the
 * page's final timestamp, and bulk writers produce exactly that shape:
 * `DecayEngine.sweep` computes `new Date()` once and stamps every decayed
 * row with it, so a sweep larger than one page loses its tail. The pull side
 * already cursors this way (`drainPullBatches`).
 */
export async function drainPushBatches<T>(
  select: (cursor: PushCursor | null) => T[],
  push: (rows: T[]) => Promise<number>,
  getUpdatedAt: (row: T) => string | null,
  getId: (row: T) => string,
  startCursor: string | null,
  batchSize: number
): Promise<{ count: number; maxUpdatedAt: string | null }> {
  let cursor: PushCursor | null = startCursor === null ? null : { ts: startCursor, id: null };
  let maxUpdatedAt = startCursor;
  let count = 0;

  for (;;) {
    const rows = select(cursor);
    if (rows.length === 0) break;

    count += await push(rows);
    for (const row of rows) {
      maxUpdatedAt = maxNullable(maxUpdatedAt, getUpdatedAt(row));
    }
    if (rows.length < batchSize) break;

    const last = rows[rows.length - 1];
    const lastUpdatedAt = last ? getUpdatedAt(last) : null;
    // A null `updated_at` sorts first and gives nothing to resume from
    // (pre-Phase-0 connections/sessions rows) — stop rather than re-select
    // the same page forever.
    if (last === undefined || lastUpdatedAt === null) break;

    const next: PushCursor = { ts: lastUpdatedAt, id: getId(last) };
    if (cursor !== null && cursor.ts === next.ts && cursor.id === next.id) break;
    cursor = next;
  }

  return { count, maxUpdatedAt };
}

/** Composite pull cursor: timestamp + row id for deterministic pagination. */
export interface PullCursor {
  ts: string;
  id: string | null;
}

/** One server-side page of pulled rows, plus the cursor state it advances to. */
export interface PullPage<TRow> {
  rows: TRow[];
  /** Highest `server_updated_at` in the page, at full precision. */
  maxServerUpdatedAt: string | null;
  /** `id` of the page's last row — the `(ts, id)` tiebreak. */
  lastId: string | null;
  hasMore: boolean;
  /**
   * Set when the page held a row that could not be decrypted. The cursor
   * must not move past such a row (see `./syncCrypto.ts`), so the drain
   * stops here and `SyncEngine` leaves the persisted pull cursor alone.
   */
  blocked?: boolean;
}

/**
 * Drains one table's remote pull queue in server-side pages, applying each
 * row locally as it arrives via `apply`. `shouldApply` filters out rows
 * that shouldn't be written locally at all (e.g. an echo of our own push).
 *
 * Uses a composite cursor `(server_updated_at, id)` so the cursor always
 * advances even when many rows share the same timestamp (e.g. a bulk
 * migration). The stored cursor (in SyncEngine) remains a plain ISO
 * timestamp — only the intra-drain loop uses the composite.
 */
export async function drainPullBatches<TRow>(
  pull: (cursorTs: string | null, cursorId: string | null) => Promise<PullPage<TRow>>,
  shouldApply: (row: TRow) => boolean,
  apply: (row: TRow) => ApplyOutcome,
  startCursor: string | null
): Promise<{
  applied: number;
  conflicts: number;
  maxServerUpdatedAt: string | null;
  blocked: boolean;
}> {
  let cursorTs = startCursor;
  let cursorId: string | null = null;
  let maxServerUpdatedAt: string | null = null;
  let applied = 0;
  let conflicts = 0;
  let blocked = false;

  for (;;) {
    const batch = await pull(cursorTs, cursorId);
    for (const row of batch.rows) {
      if (!shouldApply(row)) continue;
      const outcome = apply(row);
      if (outcome.applied) applied++;
      if (outcome.conflict) conflicts++;
    }
    if (batch.blocked === true) {
      blocked = true;
      break;
    }

    if (batch.maxServerUpdatedAt !== null) {
      maxServerUpdatedAt = batch.maxServerUpdatedAt;
      const prevTs: string | null = cursorTs;
      const prevId: string | null = cursorId;
      cursorTs = batch.maxServerUpdatedAt;
      cursorId = batch.lastId;

      // Safety: if the composite cursor didn't advance, stop to prevent an
      // infinite loop (e.g. all batch rows have the same ts AND the same id,
      // which shouldn't happen with a proper PK, but guard anyway).
      if (cursorTs === prevTs && cursorId === prevId) break;
    }
    if (!batch.hasMore) break;
  }

  return { applied, conflicts, maxServerUpdatedAt, blocked };
}
