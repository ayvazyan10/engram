/**
 * PgSyncClient — Postgres-facing sync operations for Engram's multi-device
 * sync (Phase 2). Implements the push (LWW upsert) and pull (cursor-based
 * fetch) queries described in `.claude/PRPs/plans/postgres-cloud-sync.md`
 * (section 4, "Протокол синхронизации"). `SyncEngine` is the only caller —
 * this class has no local (SQLite) knowledge and no conflict-resolution
 * logic of its own; it just moves rows to and from Postgres.
 *
 * Push uses raw parameterized SQL via `pool.query()` rather than Drizzle's
 * `onConflictDoUpdate`, because the last-write-wins upsert needs a `WHERE`
 * clause gating the `DO UPDATE SET` itself, which Drizzle's query builder
 * doesn't expose. Table and column names embedded in the generated SQL text
 * always come from this file's own fixed constants below — never from
 * caller input — so only row *values* need parameterizing; there is no SQL
 * injection surface here despite the string-built query text.
 *
 * Pull has no such gap — a plain filtered SELECT — so it uses the Drizzle
 * query builder directly.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient, QueryResult } from 'pg';
import { and, asc, eq, getTableColumns, gt, isNull, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import * as pgSchema from '../db/pg/schema.js';
import { pgMemories, pgMemoryConnections, pgSessions } from '../db/pg/schema.js';
import type { PgMemory, PgMemoryConnection, PgSession } from '../db/pg/schema.js';
import type { Memory, MemoryConnection, Session } from '../db/schema.js';

const DEFAULT_BATCH_SIZE = 500;

export interface PushBatch {
  memories: Memory[];
  connections: MemoryConnection[];
  sessions: Session[];
}

export interface PullBatch {
  memories: PgMemory[];
  connections: PgMemoryConnection[];
  sessions: PgSession[];
  /** The highest `server_updated_at` in this batch, at Postgres's own
   *  microsecond precision (see the pull-cursor section below), to advance
   *  the cursor. */
  maxServerUpdatedAt: string | null;
  /** The `id` of the last row in this batch — used as a tie-breaker when multiple
   *  rows share the same `server_updated_at` so the cursor always advances. */
  lastId: string | null;
  /** Whether there are more rows to pull (this batch was a full page). */
  hasMore: boolean;
}

/** The MAX-merged access bookkeeping Postgres settled on for one pushed memory. */
export interface MergedAccessCounters {
  id: string;
  accessCount: number;
  lastAccessedAt: string | null;
}

/** Raw `RETURNING` shape for `pushMemoriesMerging`. */
interface MergedAccessRow {
  id: string;
  access_count: number;
  last_accessed_at: string | null;
}

export interface PushMemoriesResult {
  /** Rows the upsert actually wrote. */
  applied: number;
  /** Server-side merged counters for exactly those rows. */
  merged: MergedAccessCounters[];
}

export interface PgSyncClientOptions {
  db: NodePgDatabase<typeof pgSchema>;
  pool: Pool;
  /** Rows per push/pull page. Default 500. */
  batchSize?: number;
}

// ─── LWW upsert SQL builder ────────────────────────────────────────────────
// All three synced tables use `id` as their primary key and the same
// last-write-wins shape: newer `updated_at` wins; a tie is broken by the
// lexicographically greater `device_id`. `access_count` / `last_accessed_at`
// on `memories` are the one exception — those are MAX'd instead of LWW'd
// (see plan section 4, "Разрешение конфликтов").

interface UpsertSpec {
  table: string;
  /** Insert column list, in the exact order row values are supplied. */
  columns: string[];
  /** Columns combined with GREATEST(table.col, EXCLUDED.col) instead of a plain overwrite. */
  greatestColumns?: string[];
  /** Columns to read back from the rows the statement actually wrote. */
  returning?: string[];
}

/** Last-write-wins: newer `updated_at`, ties broken by the greater `device_id`. */
function lastWriteWins(table: string): string {
  return `(EXCLUDED.updated_at > ${table}.updated_at
           OR (EXCLUDED.updated_at = ${table}.updated_at
               AND EXCLUDED.device_id > ${table}.device_id))`;
}

/** NULL-safe "the incoming value is strictly greater than the stored one". */
function excludedIsGreater(table: string, column: string): string {
  return (
    `((${table}.${column} IS NULL AND EXCLUDED.${column} IS NOT NULL)` +
    ` OR EXCLUDED.${column} > ${table}.${column})`
  );
}

/**
 * The `ON CONFLICT` clause.
 *
 * A table with no MAX-merged columns is the simple case: one `WHERE` gate on
 * last-write-wins, and every column takes the incoming value when the gate
 * opens.
 *
 * `memories` is not that case. `access_count` / `last_accessed_at` are
 * MAX-merged rather than last-write-wins (see the banner above), and
 * `DO UPDATE SET ... WHERE <lww>` suppresses the whole assignment list when
 * the gate is shut — so a pusher that lost LWW also silently dropped its
 * counters, and a device that had read a memory a hundred times handed that
 * over to whichever device happened to have the newer edit. Every device
 * ended up with a different `access_count`, and the importance scorer
 * diverged with it.
 *
 * So the gate moves off the statement and onto the individual columns:
 * last-write-wins columns keep the stored value when they lose, the MAX
 * columns always merge, and the statement-level `WHERE` opens when EITHER
 * the LWW comparison passes OR a counter would actually advance. It has to
 * stay closed otherwise — the `server_updated_at` trigger fires on any
 * UPDATE, and a no-op write would tell every peer to re-pull the row.
 */
function conflictClause(table: string, columns: readonly string[], greatestColumns: readonly string[]): string {
  const lww = lastWriteWins(table);
  const merging = greatestColumns.length > 0;

  const assignments = columns
    .filter((column) => column !== 'id')
    .map((column) => {
      if (greatestColumns.includes(column)) {
        return `${column} = GREATEST(${table}.${column}, EXCLUDED.${column})`;
      }
      return merging
        ? `${column} = CASE WHEN ${lww} THEN EXCLUDED.${column} ELSE ${table}.${column} END`
        : `${column} = EXCLUDED.${column}`;
    })
    .join(',\n      ');

  const gate = merging
    ? [lww, ...greatestColumns.map((column) => excludedIsGreater(table, column))].join('\n       OR ')
    : lww;

  return `ON CONFLICT (id) DO UPDATE SET\n      ${assignments}\n    WHERE ${gate}`;
}

function buildUpsertQuery(spec: UpsertSpec, rows: readonly unknown[][]): { text: string; values: unknown[] } {
  const { table, columns, greatestColumns = [], returning = [] } = spec;
  const values: unknown[] = [];

  const valueRows = rows.map((row) => {
    const placeholders = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const text = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES ${valueRows.join(', ')}
    ${conflictClause(table, columns, greatestColumns)}
    ${returning.length > 0 ? `RETURNING ${returning.join(', ')}` : ''}
  `;

  return { text, values };
}

// ─── pull cursor ───────────────────────────────────────────────────────────
//
// `server_updated_at` is a Postgres `timestamptz`, so `now()` stamps it with
// MICROsecond resolution — but a JS `Date` (what the pg driver hands back)
// only holds milliseconds, and `Date.toISOString()` only emits three
// fractional digits. Round-tripping the cursor through a `Date` therefore
// truncates it, and a truncated cursor can never compare *equal* to the
// value it came from: the `AND server_updated_at = :cursor AND id > :lastId`
// half of the composite cursor below becomes dead code, and any group of
// rows sharing one `server_updated_at` that is larger than one page paginates
// forever over its own first page. So the cursor is carried as a
// microsecond-precision ISO string end to end: read out of Postgres with
// `to_char`, fed back in as a `timestamptz` literal. The extra digits are
// harmless to `new Date()` on the JS side (it truncates them), which keeps
// `pullCursorWithOverlap` working unchanged.

/** `to_char` pattern producing a microsecond-precision, `Date`-parseable ISO-8601 string. */
const CURSOR_TS_FORMAT = 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';

/** Full-precision text form of a `server_updated_at` column, for use as a cursor. */
function cursorText(column: PgColumn): SQL<string> {
  return sql<string>`to_char(${column} AT TIME ZONE 'UTC', ${CURSOR_TS_FORMAT})`;
}

/** Drops the cursor alias that `cursorText` adds, leaving just the table row. */
function stripCursor<T extends { cursorTs: string }>(row: T): Omit<T, 'cursorTs'> {
  const { cursorTs: _cursorTs, ...rest } = row;
  return rest;
}

/** The three columns every pull query filters on. */
interface PullColumns {
  id: PgColumn;
  serverUpdatedAt: PgColumn;
  deviceId: PgColumn;
}

/** `WHERE` clause for one page of the pull queue — see the pull banner below. */
function pullPageFilter(
  columns: PullColumns,
  cursorTs: string | null,
  cursorId: string | null,
  deviceId: string
): SQL | undefined {
  const notOurs = or(isNull(columns.deviceId), ne(columns.deviceId, deviceId));
  if (cursorTs === null) return notOurs;

  const cursor = sql`${cursorTs}::timestamptz`;
  const afterCursor =
    cursorId === null
      ? gt(columns.serverUpdatedAt, cursor)
      : or(
          gt(columns.serverUpdatedAt, cursor),
          and(eq(columns.serverUpdatedAt, cursor), gt(columns.id, cursorId))
        );

  return and(notOurs, afterCursor);
}

// ─── column lists (DB column names, snake_case) ────────────────────────────

const MEMORY_COLUMNS = [
  'id', 'type', 'content', 'summary', 'embedding', 'embedding_dim', 'embedding_model',
  'importance', 'confidence', 'access_count', 'last_accessed_at', 'event_at', 'session_id',
  'source', 'concept', 'trigger_pattern', 'action_pattern', 'namespace', 'metadata', 'tags',
  'created_at', 'updated_at', 'archived_at', 'device_id',
] as const;

const CONNECTION_COLUMNS = [
  'id', 'source_id', 'target_id', 'relationship', 'strength', 'bidirectional', 'metadata',
  'created_at', 'updated_at', 'deleted_at', 'device_id',
] as const;

const SESSION_COLUMNS = [
  'id', 'source', 'context', 'namespace', 'started_at', 'ended_at', 'updated_at', 'deleted_at',
  'device_id',
] as const;

// ─── sync metadata keys (E2E encryption, Phase 6) ──────────────────────────
// Owned here rather than in `./encryption.ts` because this is the layer that
// actually persists them, and `bootstrapEncryptionMeta` below needs both.

/** sync_metadata key holding the hex-encoded scrypt salt. */
const SALT_META_KEY = 'encryption_salt';
/** sync_metadata key holding the encrypted sentinel value. */
const SENTINEL_META_KEY = 'encryption_sentinel';
/**
 * sync_metadata key holding the KDF cost the sentinel — and therefore every
 * encrypted row — was built with. Absent on databases bootstrapped before
 * the cost was recorded; `bootstrapEncryptionMeta` fills it in with the
 * legacy cost for exactly those.
 */
const KDF_META_KEY = 'encryption_kdf';

/** Every key that marks a database as having E2E encryption established. */
const ENCRYPTION_META_KEYS = [SALT_META_KEY, SENTINEL_META_KEY, KDF_META_KEY];

/** What `insertMetaFirstWins` establishes, and whether we were the one to establish it. */
interface EstablishedMeta {
  value: string;
  /** True only when this call performed the INSERT rather than losing the conflict. */
  inserted: boolean;
}

/**
 * Insert a sync_metadata row only if the key is free, and return whichever
 * value ends up stored. The no-op `DO UPDATE SET value = sync_metadata.value`
 * (rather than `DO NOTHING`) is what makes `RETURNING` fire on the conflict
 * path too, so one round-trip covers both "we won" and "someone else did" —
 * and it takes the row lock that serializes a concurrent bootstrap.
 *
 * `xmax = 0` is the standard way to tell those two paths apart in an upsert:
 * a freshly inserted tuple has no deleting transaction, an updated one
 * carries the id of the transaction that superseded the old version. The
 * caller needs the distinction because "this database already had a salt"
 * is what identifies a database bootstrapped before KDF parameters were
 * recorded.
 */
async function insertMetaFirstWins(
  client: PoolClient,
  key: string,
  value: string
): Promise<EstablishedMeta> {
  const result = await client.query<{ value: string; inserted: boolean }>(
    `INSERT INTO sync_metadata (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = sync_metadata.value
     RETURNING value, (xmax = 0) AS inserted`,
    [key, value]
  );
  const stored = result.rows[0];
  if (stored === undefined) {
    throw new Error(`sync_metadata upsert for "${key}" returned no row`);
  }
  return { value: stored.value, inserted: stored.inserted };
}

/** Inputs to `PgSyncClient.bootstrapEncryptionMeta`. */
export interface EncryptionBootstrapRequest {
  /** Fresh random salt, offered only if this database has none yet. */
  candidateSaltHex: string;
  /** KDF parameters to establish on a database being bootstrapped right now. */
  freshKdfParams: string;
  /** KDF parameters to assume for a database that has a salt but no recorded ones. */
  legacyKdfParams: string;
  /** Derives the sentinel from whichever salt and parameters were actually established. */
  deriveSentinel: (saltHex: string, kdfParams: string) => Promise<string>;
}

/** What a database's encryption metadata actually is, after first-wins resolution. */
export interface EncryptionBootstrapResult {
  saltHex: string;
  kdfParams: string;
  sentinel: string;
}

export class PgSyncClient {
  private readonly db: NodePgDatabase<typeof pgSchema>;
  private readonly pool: Pool;
  private readonly batchSize: number;

  constructor(options: PgSyncClientOptions) {
    this.db = options.db;
    this.pool = options.pool;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  // ─── push ─────────────────────────────────────────────────────────────

  /**
   * Push local `memories` rows with an LWW upsert, returning the access
   * bookkeeping Postgres settled on for each row it wrote.
   *
   * The caller needs those values back because the MAX merge happens
   * server-side and the pusher would otherwise never learn its result: a
   * device that wins last-write-wins stamps the row with its own
   * `device_id`, and its own next pull filters that row out as an echo. So
   * without this the winner keeps its stale local `access_count` until some
   * *other* device happens to touch the row again — which for a memory
   * nobody edits twice is never.
   */
  async pushMemoriesMerging(rows: Memory[]): Promise<PushMemoriesResult> {
    if (rows.length === 0) return { applied: 0, merged: [] };

    const valueRows = rows.map((m) => [
      m.id, m.type, m.content, m.summary, m.embedding, m.embeddingDim, m.embeddingModel,
      m.importance, m.confidence, m.accessCount, m.lastAccessedAt, m.eventAt, m.sessionId,
      m.source, m.concept, m.triggerPattern, m.actionPattern, m.namespace, m.metadata, m.tags,
      m.createdAt, m.updatedAt, m.archivedAt, m.deviceId,
    ]);

    const { text, values } = buildUpsertQuery(
      {
        table: 'memories',
        columns: [...MEMORY_COLUMNS],
        greatestColumns: ['access_count', 'last_accessed_at'],
        returning: ['id', 'access_count', 'last_accessed_at'],
      },
      valueRows
    );

    const result = await this.pool.query<MergedAccessRow>(text, values);
    return {
      applied: result.rowCount ?? 0,
      merged: result.rows.map((row) => ({
        id: row.id,
        accessCount: row.access_count,
        lastAccessedAt: row.last_accessed_at,
      })),
    };
  }

  /** Push local `memories` rows with an LWW upsert. Returns the count actually applied. */
  async pushMemories(rows: Memory[]): Promise<number> {
    return (await this.pushMemoriesMerging(rows)).applied;
  }

  /** Push local `memory_connections` rows with an LWW upsert. Returns the count actually applied. */
  async pushConnections(rows: MemoryConnection[]): Promise<number> {
    if (rows.length === 0) return 0;

    const valueRows = rows.map((c) => [
      c.id, c.sourceId, c.targetId, c.relationship, c.strength, c.bidirectional, c.metadata,
      c.createdAt, c.updatedAt, c.deletedAt, c.deviceId,
    ]);

    const { text, values } = buildUpsertQuery(
      { table: 'memory_connections', columns: [...CONNECTION_COLUMNS] },
      valueRows
    );

    const result: QueryResult = await this.pool.query(text, values);
    return result.rowCount ?? 0;
  }

  /** Push local `sessions` rows with an LWW upsert. Returns the count actually applied. */
  async pushSessions(rows: Session[]): Promise<number> {
    if (rows.length === 0) return 0;

    const valueRows = rows.map((s) => [
      s.id, s.source, s.context, s.namespace, s.startedAt, s.endedAt, s.updatedAt, s.deletedAt,
      s.deviceId,
    ]);

    const { text, values } = buildUpsertQuery(
      { table: 'sessions', columns: [...SESSION_COLUMNS] },
      valueRows
    );

    const result: QueryResult = await this.pool.query(text, values);
    return result.rowCount ?? 0;
  }

  // ─── one-time backfill (post-connect) ────────────────────────────────

  /**
   * Stamps `device_id` onto any `memories` / `memory_connections` /
   * `sessions` rows that were written before per-row device attribution
   * existed (pre-sync era). A row with `device_id IS NULL` is never "ours"
   * to any device's pull filter (`isNull(...) OR ne(...)` in `pullMemories`
   * et al. always includes it), so it gets re-pulled — and re-applied —
   * every single sync cycle, which is the 100%-CPU bug this fixes.
   *
   * Called once per connection lifetime from `SyncEngine.ensureConnected()`
   * right after migrations run, never from the per-cycle sync path.
   * Idempotent: a no-op (no log, returns 0) once no NULL rows remain.
   */
  async backfillNullDeviceIds(deviceId: string): Promise<number> {
    const memories = await this.pool.query(
      'UPDATE memories SET device_id = $1 WHERE device_id IS NULL',
      [deviceId]
    );
    const connections = await this.pool.query(
      'UPDATE memory_connections SET device_id = $1 WHERE device_id IS NULL',
      [deviceId]
    );
    const sessions = await this.pool.query(
      'UPDATE sessions SET device_id = $1 WHERE device_id IS NULL',
      [deviceId]
    );

    const total = (memories.rowCount ?? 0) + (connections.rowCount ?? 0) + (sessions.rowCount ?? 0);
    if (total > 0) {
      console.warn(`[engram] Backfilled device_id on ${total} orphan row(s) from pre-sync era`);
    }
    return total;
  }

  // ─── pull ─────────────────────────────────────────────────────────────
  //
  // Every pull method excludes rows whose `device_id` equals `deviceId`
  // (echo of our own push) and rows that don't sort after the composite
  // cursor `(server_updated_at, id)`. `cursorTs === null` means "first
  // sync" — pull everything. A row with `device_id IS NULL` (pre-Phase-0)
  // is always included: `NULL != deviceId` is itself NULL/false in SQL, so a
  // plain `ne()` would silently exclude it — `isNull(...) OR ne(...)` covers
  // both cases explicitly.

  /** Pull `memories` rows newer than the cursor, excluding our own device's writes. */
  async pullMemories(cursorTs: string | null, cursorId: string | null, deviceId: string): Promise<PullBatch> {
    const rows = await this.db
      .select({ ...getTableColumns(pgMemories), cursorTs: cursorText(pgMemories.serverUpdatedAt) })
      .from(pgMemories)
      .where(pullPageFilter(pgMemories, cursorTs, cursorId, deviceId))
      .orderBy(asc(pgMemories.serverUpdatedAt), asc(pgMemories.id))
      .limit(this.batchSize);

    const last = rows.at(-1);
    return {
      memories: rows.map(stripCursor),
      connections: [],
      sessions: [],
      maxServerUpdatedAt: last ? last.cursorTs : null,
      lastId: last ? last.id : null,
      hasMore: rows.length === this.batchSize,
    };
  }

  /** Pull `memory_connections` rows newer than the cursor, excluding our own device's writes. */
  async pullConnections(cursorTs: string | null, cursorId: string | null, deviceId: string): Promise<PullBatch> {
    const rows = await this.db
      .select({
        ...getTableColumns(pgMemoryConnections),
        cursorTs: cursorText(pgMemoryConnections.serverUpdatedAt),
      })
      .from(pgMemoryConnections)
      .where(pullPageFilter(pgMemoryConnections, cursorTs, cursorId, deviceId))
      .orderBy(asc(pgMemoryConnections.serverUpdatedAt), asc(pgMemoryConnections.id))
      .limit(this.batchSize);

    const last = rows.at(-1);
    return {
      memories: [],
      connections: rows.map(stripCursor),
      sessions: [],
      maxServerUpdatedAt: last ? last.cursorTs : null,
      lastId: last ? last.id : null,
      hasMore: rows.length === this.batchSize,
    };
  }

  /** Pull `sessions` rows newer than the cursor, excluding our own device's writes. */
  async pullSessions(cursorTs: string | null, cursorId: string | null, deviceId: string): Promise<PullBatch> {
    const rows = await this.db
      .select({ ...getTableColumns(pgSessions), cursorTs: cursorText(pgSessions.serverUpdatedAt) })
      .from(pgSessions)
      .where(pullPageFilter(pgSessions, cursorTs, cursorId, deviceId))
      .orderBy(asc(pgSessions.serverUpdatedAt), asc(pgSessions.id))
      .limit(this.batchSize);

    const last = rows.at(-1);
    return {
      memories: [],
      connections: [],
      sessions: rows.map(stripCursor),
      maxServerUpdatedAt: last ? last.cursorTs : null,
      lastId: last ? last.id : null,
      hasMore: rows.length === this.batchSize,
    };
  }

  // ─── embedding model compatibility (2.4) ─────────────────────────────────

  /**
   * The most common non-null `embedding_model` across all remote memories,
   * or `null` if every row has a null model (empty database, or every row
   * was written before `NeuralBrain.store()` started stamping it — see plan
   * section 4). `null` means "unknown, assume compatible" to the caller.
   */
  async getRemoteEmbeddingModel(): Promise<string | null> {
    const result = await this.pool.query<{ embedding_model: string }>(
      `SELECT embedding_model
       FROM memories
       WHERE embedding_model IS NOT NULL
       GROUP BY embedding_model
       ORDER BY count(*) DESC
       LIMIT 1`
    );
    return result.rows[0]?.embedding_model ?? null;
  }

  // ─── sync metadata (E2E encryption, Phase 6) ─────────────────────────────

  /** Read a key-value pair from the sync_metadata table. */
  async getSyncMeta(key: string): Promise<string | null> {
    const result = await this.pool.query<{ value: string }>(
      'SELECT value FROM sync_metadata WHERE key = $1',
      [key]
    );
    return result.rows[0]?.value ?? null;
  }

  /** Upsert a key-value pair in the sync_metadata table. */
  async setSyncMeta(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO sync_metadata (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
      [key, value]
    );
  }

  /**
   * Whether this database has already had E2E encryption established on it.
   * `SyncEngine` uses this to refuse to sync a client that has no passphrase
   * configured against a store whose rows are ciphertext — see
   * `SyncEngine.initializeEncryption`.
   */
  async hasEncryptionMetadata(): Promise<boolean> {
    const result = await this.pool.query<{ present: boolean }>(
      'SELECT true AS present FROM sync_metadata WHERE key = ANY($1::text[]) LIMIT 1',
      [ENCRYPTION_META_KEYS]
    );
    return result.rows.length > 0;
  }

  /**
   * Overwrite the recorded KDF parameters. Only `EncryptionManager`'s
   * recovery path calls this, to correct a record that disagrees with the
   * sentinel it is supposed to describe — see there for how that happens.
   */
  async setEncryptionKdfParams(kdfParams: string): Promise<void> {
    await this.setSyncMeta(KDF_META_KEY, kdfParams);
  }

  /**
   * Atomically establish — or read back — the E2E encryption salt, KDF
   * parameters and sentinel (see `./encryption.ts` for what those are).
   *
   * All three rows are written first-wins inside ONE transaction, and
   * `deriveSentinel` is invoked on whichever salt and parameters actually
   * won. Three properties fall out of that, all of which the previous
   * read-then-upsert-then-derive-then-upsert sequence violated:
   *
   *  - Two devices bootstrapping at once cannot end up with one device's
   *    salt and the other's sentinel. The salt is immutable once committed,
   *    so both derive their key from the same bytes.
   *  - A process killed mid-bootstrap can never leave salt-present /
   *    sentinel-absent — a state that made every later `initialize()` on
   *    every device throw WRONG_PASSPHRASE forever, with the salt's presence
   *    stopping the setup branch from ever retrying.
   *  - An established salt is never silently replaced, which would strand
   *    every row already encrypted under it.
   *
   * The KDF parameters follow the salt, not the calling client's opinion: a
   * database whose salt was already there but has no recorded parameters was
   * bootstrapped before they existed, so it gets `legacyKdfParams` and keeps
   * deriving the key its sentinel and rows were built with. Only a database
   * whose salt we insert here gets `freshKdfParams`.
   *
   * `deriveSentinel` (scrypt, a few hundred ms) runs inside the transaction
   * on purpose: our uncommitted salt row blocks a racing bootstrapper for
   * exactly that window, which serializes the two instead of interleaving
   * them.
   */
  async bootstrapEncryptionMeta(
    request: EncryptionBootstrapRequest
  ): Promise<EncryptionBootstrapResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const salt = await insertMetaFirstWins(client, SALT_META_KEY, request.candidateSaltHex);
      const kdf = await insertMetaFirstWins(
        client,
        KDF_META_KEY,
        salt.inserted ? request.freshKdfParams : request.legacyKdfParams
      );
      const sentinel = await insertMetaFirstWins(
        client,
        SENTINEL_META_KEY,
        await request.deriveSentinel(salt.value, kdf.value)
      );
      await client.query('COMMIT');
      return { saltHex: salt.value, kdfParams: kdf.value, sentinel: sentinel.value };
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }
}
