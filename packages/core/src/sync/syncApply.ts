/**
 * Applying one pulled Postgres row to the local SQLite database: insert if
 * no local row exists, or resolve the conflict (`../sync/conflict.ts`) and
 * write the merged result if the remote side wins. Returns whether the row
 * was applied and whether it was a genuine conflict (a local row already
 * existed), so `SyncEngine` can aggregate `SyncResult.pulled` / `.conflicts`.
 */

import { deleteAssembliesForMemories } from '../db/index.js';
import { recordAppliedEdge, recordAppliedMemory } from '../retrieval/indexBaseline.js';
import { and, eq, lt, or, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import type {
  Memory, MemoryConnection, Session,
  NewMemory, NewMemoryConnection, NewSession,
} from '../db/schema.js';
import type { PgMemory, PgMemoryConnection, PgSession } from '../db/pg/schema.js';
import type { MergedAccessCounters } from './PgSyncClient.js';
import { resolveConnectionConflict, resolveMemoryConflict, resolveSessionConflict } from './conflict.js';
import type { ApplyOutcome } from './syncLoops.js';
import type { SyncDb } from './syncLocalReads.js';

function pgMemoryToNewMemory(remote: PgMemory): NewMemory {
  const { serverUpdatedAt: _serverUpdatedAt, ...rest } = remote;
  return rest;
}

function pgConnectionToNewConnection(remote: PgMemoryConnection): NewMemoryConnection {
  const { serverUpdatedAt: _serverUpdatedAt, ...rest } = remote;
  return rest;
}

function pgSessionToNewSession(remote: PgSession): NewSession {
  const { serverUpdatedAt: _serverUpdatedAt, ...rest } = remote;
  return rest;
}

/**
 * Write back the MAX-merged access bookkeeping when the LOCAL row won the
 * last-write-wins comparison.
 *
 * `resolveMemoryConflict` computes these on both branches on purpose:
 * `access_count` and `last_accessed_at` are merged with MAX, never
 * last-write-wins, because raw `col + 1` increments from two devices must
 * both survive. Returning early on a local win threw that merge away, so a
 * peer's higher counter never landed — which, together with the same gap on
 * the push side, is why no two devices ever agreed on `access_count` and the
 * importance scorer drifted apart with it.
 *
 * Deliberately does NOT touch `updated_at`: an access bump is not an edit,
 * and stamping it would put the row back in the push queue on every sync
 * cycle — the amplification the access-tracking design exists to avoid.
 * Writes nothing at all when neither counter actually moved.
 */
function mergeAccessCounters(db: SyncDb, local: Memory, merged: Partial<Memory>): void {
  const accessCount = merged.accessCount ?? local.accessCount;
  const lastAccessedAt =
    merged.lastAccessedAt === undefined ? local.lastAccessedAt : merged.lastAccessedAt;

  if (accessCount === local.accessCount && lastAccessedAt === local.lastAccessedAt) return;

  db.update(schema.memories)
    .set({ accessCount, lastAccessedAt })
    .where(eq(schema.memories.id, local.id))
    .run();
}

export function applyPulledMemory(db: SyncDb, remote: PgMemory): ApplyOutcome {
  const outcome = db.transaction((tx) => {
    const local: Memory | undefined = tx
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, remote.id))
      .get();

    if (!local) {
      const inserted = tx.insert(schema.memories).values(pgMemoryToNewMemory(remote)).onConflictDoNothing().run();
      return { applied: inserted.changes > 0, conflict: false };
    }

    const result = resolveMemoryConflict(local, remote);
    if (result.winner !== 'remote') {
      mergeAccessCounters(tx, local, result.merged);
      // Still not "applied": no content changed locally, so this must not
      // inflate `SyncResult.pulled` or trigger a vector-index rebuild.
      return { applied: false, conflict: true };
    }

    tx.update(schema.memories).set(result.merged).where(eq(schema.memories.id, remote.id)).run();
    if (local.archivedAt === null && remote.archivedAt !== null) {
      deleteAssembliesForMemories(tx, [remote.id]);
    }
    return { applied: true, conflict: true };
  }, { behavior: 'immediate' });
  if (outcome.applied) recordAppliedMemory(db, remote.id);
  return outcome;
}

/** Merge against the current counters, including recalls committed while a push was in flight. */
export function applyMergedAccessCounters(db: SyncDb, row: MergedAccessCounters): void {
  const { id, accessCount, lastAccessedAt } = schema.memories;
  const laterAccess = sql`${row.lastAccessedAt} > coalesce(${lastAccessedAt}, '')`;
  db.update(schema.memories)
    .set({
      accessCount: sql`max(${accessCount}, ${row.accessCount})`,
      lastAccessedAt: sql`case when ${laterAccess} then ${row.lastAccessedAt} else ${lastAccessedAt} end`,
    })
    .where(and(eq(id, row.id), or(lt(accessCount, row.accessCount), laterAccess)))
    .run();
}

export function applyPulledConnection(db: SyncDb, remote: PgMemoryConnection): ApplyOutcome {
  return db.transaction((tx) => {
    const local: MemoryConnection | undefined = tx
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.id, remote.id))
      .get();

    if (!local) {
      const inserted = tx.insert(schema.memoryConnections)
        .values(pgConnectionToNewConnection(remote))
        .onConflictDoNothing()
        .run();
      if (inserted.changes > 0) recordAppliedEdge(tx, remote.sourceId);
      return { applied: inserted.changes > 0, conflict: false };
    }

    const result = resolveConnectionConflict(local, remote);
    if (result.winner !== 'remote') return { applied: false, conflict: true };

    tx.update(schema.memoryConnections)
      .set(result.merged)
      .where(eq(schema.memoryConnections.id, remote.id))
      .run();
    recordAppliedEdge(tx, remote.sourceId, local.sourceId);
    return { applied: true, conflict: true };
  }, { behavior: 'immediate' });
}

export function applyPulledSession(db: SyncDb, remote: PgSession): ApplyOutcome {
  return db.transaction((tx) => {
    const local: Session | undefined = tx
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, remote.id))
      .get();

    if (!local) {
      const inserted = tx.insert(schema.sessions).values(pgSessionToNewSession(remote)).onConflictDoNothing().run();
      return { applied: inserted.changes > 0, conflict: false };
    }

    const result = resolveSessionConflict(local, remote);
    if (result.winner !== 'remote') return { applied: false, conflict: true };

    tx.update(schema.sessions).set(result.merged).where(eq(schema.sessions.id, remote.id)).run();
    return { applied: true, conflict: true };
  }, { behavior: 'immediate' });
}
