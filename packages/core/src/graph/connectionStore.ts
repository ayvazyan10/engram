/**
 * Insert-or-resurrect helper for `memory_connections` rows.
 *
 * `idx_connections_unique_pair` (source_id, target_id, relationship) has no
 * knowledge of `deleted_at` — a tombstoned edge still occupies that slot in
 * the unique index. Once hard deletes were replaced with tombstones (see
 * NeuralBrain's `archiveAtomic` / `resolveContradiction`), naively
 * re-inserting the exact same edge later (a device re-syncing a connection it
 * had previously forgotten, a retried write, etc.) would hit a UNIQUE
 * constraint violation instead of succeeding.
 *
 * `upsertConnection` closes that gap: if the slot is occupied by a tombstone,
 * it clears the tombstone and refreshes the row instead of inserting a
 * duplicate. If the slot is occupied by a LIVE row, it falls through to a
 * plain insert — preserving the pre-existing behavior of throwing the same
 * UNIQUE constraint violation a genuine duplicate always threw.
 *
 * Synchronous by necessity: called both directly against `db` and from
 * inside `db.transaction()` callbacks, which better-sqlite3 runs
 * synchronously — no `await` is allowed in that callback.
 */

import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '../db/index.js';
import type { NewMemoryConnection } from '../db/schema.js';

/** Either the top-level drizzle db or a `db.transaction()` callback's `tx`. */
type ConnectionWriter = Pick<ReturnType<typeof getDb>, 'select' | 'insert' | 'update'>;

/**
 * Insert one `memory_connections` row, resurrecting a tombstoned row that
 * occupies the same (source_id, target_id, relationship) slot instead of
 * throwing.
 */
export function upsertConnection(db: ConnectionWriter, connection: NewMemoryConnection): void {
  const existing = db
    .select({ id: schema.memoryConnections.id, deletedAt: schema.memoryConnections.deletedAt })
    .from(schema.memoryConnections)
    .where(
      and(
        eq(schema.memoryConnections.sourceId, connection.sourceId),
        eq(schema.memoryConnections.targetId, connection.targetId),
        eq(schema.memoryConnections.relationship, connection.relationship)
      )
    )
    .get();

  // No row occupies the slot, or a LIVE row already does: insert as before.
  // A live duplicate hits the same UNIQUE violation it always did — that
  // behavior is intentionally unchanged here.
  if (!existing || !existing.deletedAt) {
    db.insert(schema.memoryConnections).values(connection).run();
    return;
  }

  // A tombstoned row occupies the slot: resurrect it with the new edge's
  // data rather than leaving stale strength/metadata from before it was
  // deleted.
  db.update(schema.memoryConnections)
    .set({
      strength: connection.strength ?? 1.0,
      bidirectional: connection.bidirectional ?? false,
      metadata: connection.metadata ?? '{}',
      deletedAt: null,
      updatedAt: connection.updatedAt ?? new Date().toISOString(),
      deviceId: connection.deviceId ?? null,
    })
    .where(eq(schema.memoryConnections.id, existing.id))
    .run();
}

/** Batch form of {@link upsertConnection}. */
export function upsertConnections(db: ConnectionWriter, connections: NewMemoryConnection[]): void {
  for (const connection of connections) {
    upsertConnection(db, connection);
  }
}
