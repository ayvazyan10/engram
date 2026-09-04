/**
 * Single-flight guard for whole-store operations.
 *
 * `re-embed`, `index/rebuild`, `consolidate`, `decay` and `sync/trigger` each
 * walk or rewrite the entire store, and nothing stopped two of them running at
 * once. The worst pairing is two concurrent POST /api/index/rebuild: the
 * handler clears the vector index before repopulating it, so the second call's
 * `clear()` lands in the middle of the first call's upserts and the index ends
 * up missing whatever the first had already written.
 *
 * The guard is process-wide because the resources it protects — the brain
 * singleton, its vector index, the SQLite file — are process-wide too. It is
 * not a lock across processes; two engram servers over one database still need
 * the database's own transactions, which is a separate concern.
 */

/** Operations that must never overlap with themselves. */
export type ExclusiveOperation =
  | 'consolidate'
  | 'decay'
  | 'embeddings-backfill'
  | 'index-rebuild'
  | 'index-save'
  | 're-embed'
  | 'sync-trigger';

/**
 * A second attempt at an operation that is already running.
 *
 * `statusCode` is what Fastify's error handling reads, so a route can simply
 * let this propagate and the caller sees 409 rather than a 500.
 */
export class OperationInProgressError extends Error {
  readonly statusCode = 409;

  constructor(readonly operation: ExclusiveOperation) {
    super(`Operation '${operation}' is already in progress. Retry once it finishes.`);
    this.name = 'OperationInProgressError';
  }
}

const running = new Set<ExclusiveOperation>();

/** Whether an operation is currently running. Exported for status endpoints. */
export function isRunning(operation: ExclusiveOperation): boolean {
  return running.has(operation);
}

/**
 * Run `fn` unless the same operation is already in flight.
 *
 * The claim happens synchronously, before the first await inside `fn`, so two
 * requests that arrive in the same tick cannot both see an empty set.
 */
export async function runExclusive<T>(
  operation: ExclusiveOperation,
  fn: () => Promise<T>
): Promise<T> {
  if (running.has(operation)) throw new OperationInProgressError(operation);
  running.add(operation);
  try {
    return await fn();
  } finally {
    running.delete(operation);
  }
}
