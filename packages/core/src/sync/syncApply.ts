/**
 * Applying one pulled Postgres row to the local SQLite database: insert if
 * no local row exists, or resolve the conflict (`../sync/conflict.ts`) and
 * write the merged result if the remote side wins. Returns whether the row
 * was applied and whether it was a genuine conflict (a local row already
 * existed), so `SyncEngine` can aggregate `SyncResult.pulled` / `.conflicts`.
 */

import { eq } from 'drizzle-orm';
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
  const local: Memory | undefined = db
    .select()
    .from(schema.memories)
    .where(eq(schema.memories.id, remote.id))
    .get();

  if (!local) {
    db.insert(schema.memories).values(pgMemoryToNewMemory(remote)).onConflictDoNothing().run();
    return { applied: true, conflict: false };
  }

  const result = resolveMemoryConflict(local, remote);
  if (result.winner !== 'remote') {
    mergeAccessCounters(db, local, result.merged);
    // Still not "applied": no content changed locally, so this must not
    // inflate `SyncResult.pulled` or trigger a vector-index rebuild.
    return { applied: false, conflict: true };
  }

  db.update(schema.memories).set(result.merged).where(eq(schema.memories.id, remote.id)).run();
  return { applied: true, conflict: true };
}

/**
 * Fold the server's MAX-merged access bookkeeping back into the local rows we
 * just pushed.
 *
 * `pushed` is what we sent, so it is also what the local rows held a moment
 * ago — no re-read is needed to know whether the merge moved anything. Only
 * rows where it did are written, and `updated_at` is left alone for the same
 * reason as in `mergeAccessCounters`: this is bookkeeping, not an edit.
 */
export function applyMergedAccessCounters(
  db: SyncDb,
  pushed: readonly Memory[],
  merged: readonly MergedAccessCounters[]
): void {
  if (merged.length === 0) return;
  const before = new Map(pushed.map((row) => [row.id, row]));

  for (const row of merged) {
    const local = before.get(row.id);
    if (local === undefined) continue;
    if (local.accessCount === row.accessCount && local.lastAccessedAt === row.lastAccessedAt) continue;

    db.update(schema.memories)
      .set({ accessCount: row.accessCount, lastAccessedAt: row.lastAccessedAt })
      .where(eq(schema.memories.id, row.id))
      .run();
  }
}

export function applyPulledConnection(db: SyncDb, remote: PgMemoryConnection): ApplyOutcome {
  try {
    const local: MemoryConnection | undefined = db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.id, remote.id))
      .get();

    if (!local) {
      db.insert(schema.memoryConnections)
        .values(pgConnectionToNewConnection(remote))
        .onConflictDoNothing()
        .run();
      return { applied: true, conflict: false };
    }

    const result = resolveConnectionConflict(local, remote);
    if (result.winner !== 'remote') return { applied: false, conflict: true };

    db.update(schema.memoryConnections)
      .set(result.merged)
      .where(eq(schema.memoryConnections.id, remote.id))
      .run();
    return { applied: true, conflict: true };
  } catch {
    // Most likely a FK violation: the source/target memory hasn't landed
    // locally yet (its own batch hasn't been pulled this cycle, or it
    // belongs to a device that hasn't pushed it yet). Skip this row — it
    // stays inside the next pull's overlap window and is retried once the
    // dependency exists, rather than failing the whole sync.
    return { applied: false, conflict: false };
  }
}

export function applyPulledSession(db: SyncDb, remote: PgSession): ApplyOutcome {
  const local: Session | undefined = db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, remote.id))
    .get();

  if (!local) {
    db.insert(schema.sessions).values(pgSessionToNewSession(remote)).onConflictDoNothing().run();
    return { applied: true, conflict: false };
  }

  const result = resolveSessionConflict(local, remote);
  if (result.winner !== 'remote') return { applied: false, conflict: true };

  db.update(schema.sessions).set(result.merged).where(eq(schema.sessions.id, remote.id)).run();
  return { applied: true, conflict: true };
}
