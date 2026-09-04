/**
 * Deciding which side of a contradiction survives — separated from the writes
 * that carry the decision out.
 *
 * Two things live here:
 *
 *   - `decideResolution` turns one strategy plus one pair of rows into "archive
 *     this, keep that". Pure, so the rule is readable on its own instead of
 *     buried in a transaction.
 *   - `planAutoResolution` decides a WHOLE auto-resolution pass at once, which
 *     is the part that cannot be done a pair at a time. Contradictions are
 *     resolved in a loop, and the strategies suggested for different pairs
 *     routinely disagree: one existing memory suggests keep_newest ("archive
 *     me, the newcomer supersedes me"), another suggests keep_oldest ("archive
 *     the newcomer, I stand"). Applied one after the other, both ran — the
 *     first archived an existing memory in favour of the newcomer, and the
 *     second then archived the newcomer, so the fact left the store with
 *     nothing standing in its place.
 *
 * The invariant the planner enforces is exactly that: a memory is archived only
 * if the memory it is archived IN FAVOUR OF survives the entire pass.
 */

import { and, eq, isNull, or } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { Memory } from '../db/schema.js';
import { getDeviceId } from '../sync/deviceId.js';
import type { Contradiction, ResolutionStrategy } from './ContradictionDetector.js';

/** Which side of a pair a strategy archives, and which it keeps. */
export interface ResolutionOutcome {
  /** The memory to archive, or undefined when the strategy archives nothing. */
  archivedId?: string;
  /** The memory the resolution stands on. */
  keptId?: string;
}

/** One resolution the caller should execute, in order. */
export interface PlannedResolution {
  sourceId: string;
  targetId: string;
  strategy: ResolutionStrategy;
}

/**
 * Work out what a strategy does to one pair of live memories.
 *
 * Returns null for `manual`, which deliberately decides nothing and leaves the
 * pair for a human.
 */
export function decideResolution(
  source: Memory,
  target: Memory,
  strategy: ResolutionStrategy,
): ResolutionOutcome | null {
  switch (strategy) {
    case 'keep_newest':
    case 'keep_oldest': {
      const sourceTime = new Date(source.createdAt).getTime();
      const targetTime = new Date(target.createdAt).getTime();
      const [newer, older] = sourceTime >= targetTime ? [source, target] : [target, source];
      return strategy === 'keep_newest'
        ? { archivedId: older.id, keptId: newer.id }
        : { archivedId: newer.id, keptId: older.id };
    }

    case 'keep_important': {
      const [kept, archived] = (source.importance ?? 0.5) >= (target.importance ?? 0.5)
        ? [source, target]
        : [target, source];
      return { archivedId: archived.id, keptId: kept.id };
    }

    case 'keep_both':
      // Nothing is archived; the pair is still resolved, so the caller
      // tombstones the contradicts edge rather than reporting it forever.
      return { keptId: source.id };

    case 'manual':
      return null;
  }
}

/**
 * Plan a whole auto-resolution pass.
 *
 * @param contradictions Detected pairs, in the order they should be applied.
 * @param memoriesById   Every memory named by those pairs, read once.
 */
export function planAutoResolution(
  contradictions: readonly Contradiction[],
  memoriesById: ReadonlyMap<string, Memory>,
): PlannedResolution[] {
  const candidates: Array<PlannedResolution & { outcome: ResolutionOutcome }> = [];

  for (const contradiction of contradictions) {
    const source = memoriesById.get(contradiction.newMemoryId);
    const target = memoriesById.get(contradiction.existingMemoryId);
    // An archived memory is not a party to a resolution: keeping it would
    // resolve the pair in favour of something already gone.
    if (!source || !target || source.archivedAt || target.archivedAt) continue;

    const outcome = decideResolution(source, target, contradiction.suggestedStrategy);
    if (!outcome) continue;

    candidates.push({
      sourceId: contradiction.newMemoryId,
      targetId: contradiction.existingMemoryId,
      strategy: contradiction.suggestedStrategy,
      outcome,
    });
  }

  const doomed = new Set(
    candidates
      .map((candidate) => candidate.outcome.archivedId)
      .filter((id): id is string => id !== undefined),
  );

  return candidates
    .filter(({ outcome }) => !(outcome.archivedId && outcome.keptId && doomed.has(outcome.keptId)))
    .map(({ sourceId, targetId, strategy }) => ({ sourceId, targetId, strategy }));
}

/**
 * Persist one resolution: archive the loser, prune every edge touching it, and
 * tombstone the contradicts edge in both directions — all in ONE transaction.
 *
 * Splitting these writes is what let a failure land between them, leaving a
 * resolved contradiction that still reported itself as unresolved. The
 * tombstone runs for every strategy, keep_both included: archiving already
 * tombstones any edge touching the loser, but a resolution that archives
 * nothing still has to stop the pair coming back from getContradictions().
 *
 * Synchronous by necessity — better-sqlite3 transactions do not await. The
 * caller updates in-memory state and fires events only after this returns.
 */
export function writeResolution(sourceId: string, targetId: string, archivedId?: string): void {
  const db = getDb();
  const resolvedAt = new Date().toISOString();
  const deviceId = getDeviceId();

  db.transaction((tx) => {
    if (archivedId) {
      tx.update(schema.memories)
        // updatedAt must move with archivedAt — see NeuralBrain.archiveAtomic
        // for why (a soft-delete invisible to a sync cursor never propagates).
        .set({ archivedAt: resolvedAt, updatedAt: resolvedAt, deviceId })
        .where(eq(schema.memories.id, archivedId))
        .run();

      tx.update(schema.memoryConnections)
        .set({ deletedAt: resolvedAt, updatedAt: resolvedAt, deviceId })
        .where(
          and(
            or(
              eq(schema.memoryConnections.sourceId, archivedId),
              eq(schema.memoryConnections.targetId, archivedId)
            ),
            isNull(schema.memoryConnections.deletedAt)
          )
        )
        .run();
    }

    for (const [a, b] of [[sourceId, targetId], [targetId, sourceId]] as const) {
      tx.update(schema.memoryConnections)
        .set({ deletedAt: resolvedAt, updatedAt: resolvedAt, deviceId })
        .where(
          and(
            eq(schema.memoryConnections.sourceId, a),
            eq(schema.memoryConnections.targetId, b),
            eq(schema.memoryConnections.relationship, 'contradicts'),
            isNull(schema.memoryConnections.deletedAt)
          )
        )
        .run();
    }
  });
}
