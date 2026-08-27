/**
 * Sync cursor state — bookkeeping persisted in the local `sync_state` table
 * for one configured Postgres sync target. Exactly one row per target (see
 * `computeSyncId`); this table is device-local and is never itself synced
 * (see `db/schema.ts`).
 *
 * See `.claude/PRPs/plans/postgres-cloud-sync.md` (section 4) for the
 * push/pull protocol this cursor drives: `pullCursor` tracks Postgres's own
 * clock (`server_updated_at`), not any device's local clock, specifically so
 * pull progress never depends on clock sync between devices.
 */

import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { getDeviceId } from './deviceId.js';

/** Pull overlap window — see `pullCursorWithOverlap`. */
const PULL_OVERLAP_MS = 5 * 60 * 1000;

/**
 * Compute a stable ID for a sync target from its connection URL.
 * Uses SHA-256 of the normalized (lowercased, trimmed) URL.
 * The URL contains a password, but only the hash is stored.
 */
export function computeSyncId(url: string): string {
  const normalized = url.trim().toLowerCase();
  return createHash('sha256').update(normalized).digest('hex');
}

export interface CursorState {
  syncId: string;
  deviceId: string;
  pullCursor: string | null; // server_updated_at of last accepted row (ISO string)
  lastPushAt: string | null; // updated_at of last pushed row (ISO string)
  lastSyncAt: string | null; // timestamp of last successful sync cycle
  lastError: string | null; // last sync error message (password-redacted)
  embeddingModel: string | null; // guards against incompatible embeddings
}

function toCursorState(row: schema.SyncState): CursorState {
  return {
    syncId: row.id,
    deviceId: row.deviceId,
    pullCursor: row.pullCursor,
    lastPushAt: row.lastPushAt,
    lastSyncAt: row.lastSyncAt,
    lastError: row.lastError,
    embeddingModel: row.embeddingModel,
  };
}

function selectRawRow(
  db: BetterSQLite3Database<typeof schema>,
  syncId: string,
): schema.SyncState | undefined {
  return db.select().from(schema.syncState).where(eq(schema.syncState.id, syncId)).get();
}

/** Read the cursor state for a sync target. Returns null if never synced. */
export function readCursor(
  db: BetterSQLite3Database<typeof schema>,
  syncId: string,
): CursorState | null {
  const row = selectRawRow(db, syncId);
  return row ? toCursorState(row) : null;
}

/** Create or update the cursor state. */
export function writeCursor(
  db: BetterSQLite3Database<typeof schema>,
  syncId: string,
  updates: Partial<Omit<CursorState, 'syncId'>>,
): void {
  const existing = selectRawRow(db, syncId);
  const now = new Date().toISOString();

  const next: typeof schema.syncState.$inferInsert = {
    id: syncId,
    deviceId: updates.deviceId ?? existing?.deviceId ?? getDeviceId(),
    pullCursor: updates.pullCursor !== undefined ? updates.pullCursor : existing?.pullCursor ?? null,
    lastPushAt: updates.lastPushAt !== undefined ? updates.lastPushAt : existing?.lastPushAt ?? null,
    lastSyncAt: updates.lastSyncAt !== undefined ? updates.lastSyncAt : existing?.lastSyncAt ?? null,
    lastError: updates.lastError !== undefined ? updates.lastError : existing?.lastError ?? null,
    embeddingModel:
      updates.embeddingModel !== undefined ? updates.embeddingModel : existing?.embeddingModel ?? null,
    // Preserve the row's original creation time on update; only a brand-new
    // row gets "now".
    createdAt: existing?.createdAt ?? now,
  };

  db.insert(schema.syncState)
    .values(next)
    .onConflictDoUpdate({ target: schema.syncState.id, set: next })
    .run();
}

/**
 * Compute the pull overlap window — subtract 5 minutes from the cursor
 * to catch commits that started before but landed after our last read.
 */
export function pullCursorWithOverlap(cursor: string | null): string | null {
  if (cursor === null) {
    return null; // first sync — pull everything, nothing to overlap against
  }

  const parsed = new Date(cursor);
  if (Number.isNaN(parsed.getTime())) {
    // Malformed/unparseable cursor — nothing safe to subtract from. Treat as
    // "pull everything" rather than propagate an invalid timestamp string.
    return null;
  }

  return new Date(parsed.getTime() - PULL_OVERLAP_MS).toISOString();
}
