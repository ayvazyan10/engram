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
 * Drains one table's local push queue in `batchSize` pages, starting from
 * `startCursor`. Stops on a partial page, or if the cursor fails to advance
 * (an all-null `updatedAt` tail) — the latter would otherwise loop forever.
 */
export async function drainPushBatches<T>(
  select: (cursor: string | null) => T[],
  push: (rows: T[]) => Promise<number>,
  getUpdatedAt: (row: T) => string | null,
  startCursor: string | null,
  batchSize: number
): Promise<{ count: number; maxUpdatedAt: string | null }> {
  let cursor = startCursor;
  let maxUpdatedAt = startCursor;
  let count = 0;

  for (;;) {
    const rows = select(cursor);
    if (rows.length === 0) break;

    count += await push(rows);
    for (const row of rows) {
      maxUpdatedAt = maxNullable(maxUpdatedAt, getUpdatedAt(row));
    }

    const last = rows[rows.length - 1];
    const lastUpdatedAt = last ? getUpdatedAt(last) : null;
    if (rows.length < batchSize || lastUpdatedAt === null || lastUpdatedAt === cursor) {
      break;
    }
    cursor = lastUpdatedAt;
  }

  return { count, maxUpdatedAt };
}

/**
 * Drains one table's remote pull queue in server-side pages, applying each
 * row locally as it arrives via `apply`. `shouldApply` filters out rows
 * that shouldn't be written locally at all (e.g. an echo of our own push).
 */
export async function drainPullBatches<TRow>(
  pull: (cursor: string | null) => Promise<{ rows: TRow[]; maxServerUpdatedAt: string | null; hasMore: boolean }>,
  shouldApply: (row: TRow) => boolean,
  apply: (row: TRow) => ApplyOutcome,
  startCursor: string | null
): Promise<{ applied: number; conflicts: number; maxServerUpdatedAt: string | null }> {
  let cursor = startCursor;
  let maxServerUpdatedAt: string | null = null;
  let applied = 0;
  let conflicts = 0;

  for (;;) {
    const batch = await pull(cursor);
    for (const row of batch.rows) {
      if (!shouldApply(row)) continue;
      const outcome = apply(row);
      if (outcome.applied) applied++;
      if (outcome.conflict) conflicts++;
    }

    if (batch.maxServerUpdatedAt !== null) {
      maxServerUpdatedAt = batch.maxServerUpdatedAt;
      cursor = batch.maxServerUpdatedAt;
    }
    if (!batch.hasMore) break;
  }

  return { applied, conflicts, maxServerUpdatedAt };
}
