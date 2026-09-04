/**
 * What `forget` is allowed to claim.
 *
 * The handler used to loop `await brain.forget(id)` over whatever it was given
 * and answer `{"archived": ids.length}`. Outside isolated mode `brain.forget`
 * on an unknown id resolves without doing anything, so a mistyped or
 * hallucinated id came back as "Archived 1 memory(ies)" — and the `forgotten`
 * webhook and the `onForget` plugin hook fired for a memory that never existed.
 *
 * Existence is checked against the knowledge graph node every stored memory
 * has: `getNode` answers for memories written by any process (the graph is
 * loaded from the database on initialize) and answers `undefined` once a memory
 * has been archived, which is exactly the question `forget` needs answered.
 */

/** The one capability this module needs from the brain. */
export interface MemoryPresence {
  getGraph(): { getNode(id: string): unknown };
}

export interface IdPartition {
  /** Ids naming a live memory, de-duplicated, in the order given. */
  readonly existing: readonly string[];
  /** Ids naming nothing, de-duplicated, in the order given. */
  readonly missing: readonly string[];
}

/**
 * Split requested ids into the ones that name a live memory and the ones that
 * do not.
 *
 * Duplicates collapse: asking twice for the same id archives one memory, and
 * counting it twice would overstate the result exactly as the old code did.
 */
export function partitionByExistence(brain: MemoryPresence, ids: readonly string[]): IdPartition {
  const graph = brain.getGraph();
  const existing: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    if (graph.getNode(id) === undefined) missing.push(id);
    else existing.push(id);
  }

  return { existing, missing };
}

export interface ForgetReport {
  readonly archived: number;
  readonly notFound: readonly string[];
  readonly reason: string;
  readonly message: string;
}

/** The response body, worded so the count and the ids agree with what happened. */
export function forgetReport(partition: IdPartition, reason: string | undefined): ForgetReport {
  const archived = partition.existing.length;
  const missing = partition.missing;

  const message = missing.length === 0
    ? `Archived ${archived} memory(ies)`
    : `Archived ${archived} memory(ies); ${missing.length} id(s) not found: ${missing.join(', ')}`;

  return {
    archived,
    notFound: missing,
    reason: reason ?? 'not specified',
    message,
  };
}

/**
 * True when the caller asked for something that was not there. The tool result
 * is flagged `isError` in that case: a client that cannot tell a hit from a miss
 * will keep telling the user a memory is gone when it is not.
 */
export function hasMissingIds(partition: IdPartition): boolean {
  return partition.missing.length > 0;
}
