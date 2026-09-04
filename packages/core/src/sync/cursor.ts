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

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Everything in a connection URL that identifies *which* database this is,
 * with the password left out on purpose.
 *
 * Scheme and host are lowercased (both are case-insensitive by spec). The
 * username and database name are NOT: Postgres compares those
 * case-sensitively, so `/DB` and `/db` are genuinely different databases and
 * must not collapse onto one cursor row. Query parameters are dropped —
 * `?sslmode=require` vs `?sslmode=disable` is the same sync target reached
 * two ways, not two targets.
 */
function syncIdentity(url: string): string {
  const parsed = new URL(url.trim());
  const scheme = parsed.protocol.toLowerCase();
  const host = parsed.hostname.toLowerCase();
  const port = parsed.port;
  const user = decodeURIComponent(parsed.username);
  const database = decodeURIComponent(parsed.pathname);
  return `${scheme}//${user}@${host}:${port}${database}`;
}

/** `url` with the password removed, for URLs `new URL()` cannot parse. */
function stripPassword(url: string): string {
  return url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/[^:@/]*):[^@/]*@/, '$1@');
}

/**
 * Compute a stable ID for a sync target from the NON-SECRET parts of its
 * connection URL — scheme, user, host, port and database name.
 *
 * The password is deliberately excluded, and this is the whole point. The
 * previous implementation hashed the entire URL, which turned
 * `sync_state.id` into an offline-crackable password hash: a single
 * unsalted SHA-256 round whose only unknown is the password, when the host,
 * user and database name are all sitting in the CLI config next to it.
 * Anyone holding a copy of `engram.db` — a backup, a stolen laptop — could
 * brute-force the Postgres password out of it, and the old
 * `.toLowerCase()` shrank the search space further by collapsing the
 * password's case.
 *
 * Two URLs that differ only by password now share one id. That is correct:
 * they address the same database, so they should share one cursor row.
 *
 * Existing rows keyed by the old scheme are moved across by
 * `migrateLegacySyncState`, so no device silently loses its cursor.
 */
export function computeSyncId(url: string): string {
  try {
    return sha256Hex(syncIdentity(url));
  } catch {
    // Not a parseable URL. Still never hash the password — a malformed
    // connection string is exactly the case where a naive fallback would
    // reintroduce the offline oracle this function exists to remove.
    return sha256Hex(stripPassword(url.trim()));
  }
}

/**
 * The pre-fix sync id: SHA-256 of the whole lowercased URL, password
 * included. Kept only so `migrateLegacySyncState` can find and retire rows
 * written under it — never used for new writes.
 */
function legacySyncId(url: string): string {
  return sha256Hex(url.trim().toLowerCase());
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

/**
 * Re-key a `sync_state` row written before `computeSyncId` stopped hashing
 * the password (see there for why it stopped).
 *
 * Without this the row simply stops being found: `readCursor` returns null,
 * which reads as "never synced" and silently triggers a full re-push and
 * re-pull of the entire database on the next cycle. Correct, thanks to the
 * idempotent LWW upserts, but expensive and alarming — and it would also
 * throw away `last_error` and the embedding-model guard.
 *
 * Idempotent and safe to call on every `SyncEngine` construction: it is one
 * primary-key lookup once the migration has happened, and it never
 * overwrites a row that already exists under the new id.
 */
export function migrateLegacySyncState(
  db: BetterSQLite3Database<typeof schema>,
  url: string,
): void {
  const newId = computeSyncId(url);
  const oldId = legacySyncId(url);
  if (newId === oldId) return;

  db.transaction((tx) => {
    const legacy = selectRawRow(tx, oldId);
    if (!legacy) return;

    // A row under the new id wins — it is the live one. The legacy row is
    // then just a leftover and gets dropped either way.
    const current = selectRawRow(tx, newId);
    if (!current) {
      tx.insert(schema.syncState).values({ ...legacy, id: newId }).onConflictDoNothing().run();
    }
    tx.delete(schema.syncState).where(eq(schema.syncState.id, oldId)).run();
  });
}

/**
 * Create or update the cursor state.
 *
 * Only the fields actually present in `updates` are written. That is a
 * correctness requirement, not an optimization: this used to read the row,
 * merge in memory, and write every column back, and Engram routinely runs
 * the MCP server's auto-sync and an `engram cloud sync` invocation against
 * one database file. Two such writers interleaving around the read lost
 * whichever field the other had just committed — a stale `last_push_at`
 * re-pushes rows (harmless) but a stale `pull_cursor` was luck rather than
 * design. One statement that names only the touched columns cannot lose an
 * update it never read.
 *
 * `deviceId` and `createdAt` are supplied for the INSERT branch (both are
 * NOT NULL) but are left out of the conflict branch unless the caller asked
 * for them, so an existing row keeps its original values.
 */
export function writeCursor(
  db: BetterSQLite3Database<typeof schema>,
  syncId: string,
  updates: Partial<Omit<CursorState, 'syncId'>>,
): void {
  const set: Partial<typeof schema.syncState.$inferInsert> = {};
  if (updates.deviceId !== undefined) set.deviceId = updates.deviceId;
  if (updates.pullCursor !== undefined) set.pullCursor = updates.pullCursor;
  if (updates.lastPushAt !== undefined) set.lastPushAt = updates.lastPushAt;
  if (updates.lastSyncAt !== undefined) set.lastSyncAt = updates.lastSyncAt;
  if (updates.lastError !== undefined) set.lastError = updates.lastError;
  if (updates.embeddingModel !== undefined) set.embeddingModel = updates.embeddingModel;

  const insert: typeof schema.syncState.$inferInsert = {
    id: syncId,
    deviceId: updates.deviceId ?? getDeviceId(),
    pullCursor: updates.pullCursor ?? null,
    lastPushAt: updates.lastPushAt ?? null,
    lastSyncAt: updates.lastSyncAt ?? null,
    lastError: updates.lastError ?? null,
    embeddingModel: updates.embeddingModel ?? null,
    createdAt: new Date().toISOString(),
  };

  const statement = db.insert(schema.syncState).values(insert);

  // Drizzle rejects an empty `set`, and "update nothing" is exactly what a
  // no-field call means anyway.
  if (Object.keys(set).length === 0) {
    statement.onConflictDoNothing().run();
    return;
  }
  statement.onConflictDoUpdate({ target: schema.syncState.id, set }).run();
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
