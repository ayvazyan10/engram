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
  if (result.winner !== 'remote') return { applied: false, conflict: true };

  db.update(schema.memories).set(result.merged).where(eq(schema.memories.id, remote.id)).run();
  return { applied: true, conflict: true };
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
