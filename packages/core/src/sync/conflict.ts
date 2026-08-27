/**
 * Conflict resolution for Engram's multi-device sync — pure functions only.
 *
 * These functions decide, for one row that exists on both sides (a local
 * SQLite row and its Postgres counterpart with the same `id`), which version
 * survives and what the merged row should look like. They have NO side
 * effects: no database access, no I/O, no clock reads. `SyncEngine` (Phase
 * 2.1) is responsible for fetching the two rows and writing the result
 * wherever it needs to go — this module only decides.
 *
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` (section 4, "Разрешение
 * конфликтов") for the design this implements:
 *
 * 1. Last-Write-Wins by `updated_at`, compared lexicographically (the
 *    codebase's timestamps are normalized to sortable ISO-8601 — see plan
 *    item 0.5).
 * 2. Ties on `updated_at` are broken by `device_id`: the lexicographically
 *    GREATER id wins. Both devices compute this independently and always
 *    agree, without needing to talk to each other.
 * 3. `access_count` is MAX'd, never LWW'd — raw `col + 1` increments from
 *    two devices must both survive, not have one clobber the other.
 * 4. `last_accessed_at` is MAX'd for the same reason.
 * 5. Deletion vs. edit is resolved by folding the tombstone timestamp
 *    (`archived_at` for memories, `deleted_at` for connections/sessions)
 *    into the LWW comparison: the "effective timestamp" for a row is
 *    whichever of `updated_at` / tombstone is later. A deletion only wins
 *    if it is newer than the other side's edit.
 * 6. `null` loses: a `null` `updated_at` or `device_id` (rows written before
 *    Phase 0 populated these columns) is always outranked by any non-null
 *    value on the other side.
 */

import type { Memory, MemoryConnection, Session } from '../db/schema.js';
import type { PgMemory, PgMemoryConnection, PgSession } from '../db/pg/schema.js';

/** Which version won, plus the merged row to write. */
export interface MergeResult<T> {
  winner: 'local' | 'remote';
  merged: T;
  reason: string; // e.g. 'lww:updated_at', 'lww:device_id_tiebreak', 'max:access_count'
}

// ─── comparison primitives ─────────────────────────────────────────────────

/**
 * Compares two nullable strings for LWW purposes: `null` always loses to any
 * non-null value; two non-null values compare lexicographically; two `null`s
 * tie. Positive means `a` wins, negative means `b` wins, 0 is a tie.
 */
function compareNullableStrings(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (a > b) return 1;
  if (a < b) return -1;
  return 0;
}

/**
 * Last-Write-Wins comparison.
 * Returns positive if a wins, negative if b wins, 0 for tie.
 */
export function compareLWW(
  aUpdatedAt: string | null,
  aDeviceId: string | null,
  bUpdatedAt: string | null,
  bDeviceId: string | null,
): number {
  const byTimestamp = compareNullableStrings(aUpdatedAt, bUpdatedAt);
  if (byTimestamp !== 0) return byTimestamp;
  return compareNullableStrings(aDeviceId, bDeviceId);
}

/** Later of two nullable ISO timestamps. `null` loses to any non-null value. */
function maxTimestamp(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a >= b ? a : b;
}

// ─── memories ───────────────────────────────────────────────────────────────

function stripMemoryServerFields(row: PgMemory): Omit<PgMemory, 'serverUpdatedAt'> {
  const { serverUpdatedAt, ...rest } = row;
  void serverUpdatedAt; // PG-only column — never copied to a local SQLite row
  return rest;
}

/** Resolve a memory conflict between a local SQLite row and a remote PG row. */
export function resolveMemoryConflict(local: Memory, remote: PgMemory): MergeResult<Partial<Memory>> {
  const localEffective = maxTimestamp(local.updatedAt, local.archivedAt);
  const remoteEffective = maxTimestamp(remote.updatedAt, remote.archivedAt);

  const accessCount = Math.max(local.accessCount, remote.accessCount);
  const lastAccessedAt = maxTimestamp(local.lastAccessedAt, remote.lastAccessedAt);

  // Both sides agree on updated_at/archived_at AND device_id: the only thing
  // that could genuinely differ is access bookkeeping, which never bumps
  // updated_at (see plan item 0.6). Pick either side as the base — content
  // is otherwise identical — and just carry the MAX'd counters.
  if (localEffective === remoteEffective && local.deviceId === remote.deviceId) {
    return {
      winner: 'local',
      merged: { ...local, accessCount, lastAccessedAt },
      reason: 'max:access_count',
    };
  }

  const cmp = compareLWW(localEffective, local.deviceId, remoteEffective, remote.deviceId);
  const winner: 'local' | 'remote' = cmp > 0 ? 'local' : 'remote';
  const reason = localEffective === remoteEffective ? 'lww:device_id_tiebreak' : 'lww:updated_at';
  const winnerFields = winner === 'local' ? local : stripMemoryServerFields(remote);

  return {
    winner,
    merged: { ...winnerFields, accessCount, lastAccessedAt },
    reason,
  };
}

// ─── connections ────────────────────────────────────────────────────────────

function stripConnectionServerFields(
  row: PgMemoryConnection
): Omit<PgMemoryConnection, 'serverUpdatedAt'> {
  const { serverUpdatedAt, ...rest } = row;
  void serverUpdatedAt;
  return rest;
}

/** Resolve a connection conflict. */
export function resolveConnectionConflict(
  local: MemoryConnection,
  remote: PgMemoryConnection,
): MergeResult<Partial<MemoryConnection>> {
  const localEffective = maxTimestamp(local.updatedAt, local.deletedAt);
  const remoteEffective = maxTimestamp(remote.updatedAt, remote.deletedAt);

  if (localEffective === remoteEffective && local.deviceId === remote.deviceId) {
    return { winner: 'local', merged: { ...local }, reason: 'lww:tie' };
  }

  const cmp = compareLWW(localEffective, local.deviceId, remoteEffective, remote.deviceId);
  const winner: 'local' | 'remote' = cmp > 0 ? 'local' : 'remote';
  const reason = localEffective === remoteEffective ? 'lww:device_id_tiebreak' : 'lww:updated_at';
  const merged = winner === 'local' ? { ...local } : stripConnectionServerFields(remote);

  return { winner, merged, reason };
}

// ─── sessions ───────────────────────────────────────────────────────────────

function stripSessionServerFields(row: PgSession): Omit<PgSession, 'serverUpdatedAt'> {
  const { serverUpdatedAt, ...rest } = row;
  void serverUpdatedAt;
  return rest;
}

/** Resolve a session conflict. */
export function resolveSessionConflict(local: Session, remote: PgSession): MergeResult<Partial<Session>> {
  const localEffective = maxTimestamp(local.updatedAt, local.deletedAt);
  const remoteEffective = maxTimestamp(remote.updatedAt, remote.deletedAt);

  if (localEffective === remoteEffective && local.deviceId === remote.deviceId) {
    return { winner: 'local', merged: { ...local }, reason: 'lww:tie' };
  }

  const cmp = compareLWW(localEffective, local.deviceId, remoteEffective, remote.deviceId);
  const winner: 'local' | 'remote' = cmp > 0 ? 'local' : 'remote';
  const reason = localEffective === remoteEffective ? 'lww:device_id_tiebreak' : 'lww:updated_at';
  const merged = winner === 'local' ? { ...local } : stripSessionServerFields(remote);

  return { winner, merged, reason };
}

// ─── pull filtering ─────────────────────────────────────────────────────────

/**
 * Whether a pulled row should be applied locally.
 * Skip rows whose device_id matches ours (echo of our own push).
 */
export function shouldApplyPulledRow(remoteDeviceId: string | null, localDeviceId: string): boolean {
  if (remoteDeviceId === null) {
    // Pre-Phase-0 row that never got a device_id — origin unknown, apply it
    // rather than risk silently dropping a legitimate remote change.
    return true;
  }
  return remoteDeviceId !== localDeviceId;
}
