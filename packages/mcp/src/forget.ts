/**
 * What `forget` is allowed to claim.
 *
 * Resolve ids against live database rows through core, so full ids and short
 * prefixes share namespace checks and ambiguous prefixes count as missing.
 */

/** The one capability this module needs from the brain. */
export interface MemoryPresence {
  resolveMemoryId(id: string): string | undefined;
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
  const existing: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    const resolvedId = brain.resolveMemoryId(id);
    if (resolvedId === undefined) missing.push(id);
    else if (!existing.includes(resolvedId)) existing.push(resolvedId);
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
