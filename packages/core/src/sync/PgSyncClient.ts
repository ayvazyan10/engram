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
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';
import { and, asc, count, eq, getTableColumns, gt, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import * as pgSchema from '../db/pg/schema.js';
import { pgMemories, pgMemoryConnections, pgSessions } from '../db/pg/schema.js';
import type { PgMemory, PgMemoryConnection, PgSession } from '../db/pg/schema.js';
import type { Memory, MemoryConnection, Session } from '../db/schema.js';
import { embed, getEmbeddingModelId, memoryEmbeddingText, packFP16 } from '../embedding/Embedder.js';
import { EncryptionManager } from './encryption.js';

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
  embedding_model: string | null;
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
  /** The sync engine is exchanging plaintext and must refuse an encrypted store. */
  requireUnencrypted?: boolean;
}

// ─── LWW upsert SQL builder ────────────────────────────────────────────────
// All three synced tables use `id` as their primary key and the same
// last-write-wins shape: newer edit or tombstone wins; a tie is broken by the
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

/** Match conflict.ts: NULL sorts first, even below an empty non-NULL string. */
function lastWriteWins(table: string): string {
  const tombstone = table === 'memories' ? 'archived_at' : 'deleted_at';
  const version = (row: string): string => {
    const time = `GREATEST(${row}.updated_at COLLATE "C", ${row}.${tombstone})`;
    return `(${time} IS NOT NULL, COALESCE(${time}, ''),
             ${row}.device_id IS NOT NULL, COALESCE(${row}.device_id, '') COLLATE "C")`;
  };
  return `(${version('EXCLUDED')} > ${version(table)})`;
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

function assertPgText(table: string, id: unknown, column: string, value: unknown): void {
  if (typeof value === 'string' && value.includes('\0')) {
    throw new Error(`Cannot sync ${table} row ${JSON.stringify(id)}: ${column} contains a NUL character. ` +
      'Correct that field in SQLite and retry (see docs/CLOUD-SYNC.md).');
  }
}

function buildUpsertQuery(spec: UpsertSpec, rows: readonly unknown[][]): { text: string; values: unknown[] } {
  const { table, columns, greatestColumns = [], returning = [] } = spec;
  const values: unknown[] = [];

  const valueRows = rows.map((row) => {
    const placeholders = row.map((value, index) => {
      assertPgText(table, row[0], columns[index]!, value);
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
  deviceId: string,
  ownRows = false
): SQL | undefined {
  const owner = ownRows
    ? eq(columns.deviceId, deviceId)
    : or(isNull(columns.deviceId), ne(columns.deviceId, deviceId));
  if (cursorTs === null) return owner;

  const cursor = sql`${cursorTs}::timestamptz`;
  const afterCursor =
    cursorId === null
      ? gt(columns.serverUpdatedAt, cursor)
      : or(
          gt(columns.serverUpdatedAt, cursor),
          and(eq(columns.serverUpdatedAt, cursor), gt(columns.id, cursorId))
        );

  return and(owner, afterCursor);
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
const MODEL_META_KEY = 'embedding_model';

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
  client: Pool | PoolClient,
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
  private readonly requireUnencrypted: boolean;

  constructor(options: PgSyncClientOptions) {
    this.db = options.db;
    this.pool = options.pool;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.requireUnencrypted = options.requireUnencrypted ?? false;
  }

  // ─── push ─────────────────────────────────────────────────────────────

  private async writeBatch<T extends QueryResultRow>(text: string, values: unknown[], model?: string): Promise<QueryResult<T>> {
    if (!this.requireUnencrypted && model === undefined) return this.pool.query<T>(text, values);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
      // Bootstrap's first INSERT takes ROW EXCLUSIVE on this same table
      // until commit. SHARE also protects an empty metadata table.
      const needsClaim = model !== undefined && await this.getSyncMeta(MODEL_META_KEY, client) === null;
      await client.query(needsClaim ? 'LOCK TABLE sync_metadata IN SHARE ROW EXCLUSIVE MODE'
        : 'LOCK TABLE sync_metadata IN SHARE MODE');
      if (this.requireUnencrypted) await this.assertUnencrypted(client);
      if (model !== undefined) await this.assertEmbeddingModel(model, client);
      const result = await client.query<T>(text, values);
      if (model !== undefined) {
        // Check the LWW winner. After a fleet migration an older local model
        // can legitimately lose the upsert and then pull the migrated row.
        const mixed = result.rows.find((row) => row.embedding_model !== null && row.embedding_model !== model);
        if (mixed) throw new Error(`Embedding model mismatch for memory ${mixed.id}: expected "${model}", found "${mixed.embedding_model}".`);
      }
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

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
        returning: ['id', 'access_count', 'last_accessed_at', 'embedding_model'],
      },
      valueRows
    );

    const result = await this.writeBatch<MergedAccessRow>(text, values, getEmbeddingModelId());
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

  /** Merge recalls without resending content or changing its writer or edit timestamp. */
  async pushAccessCounters(rows: MergedAccessCounters[]): Promise<number> {
    if (rows.length === 0) return 0;
    for (const row of rows) {
      assertPgText('memories', row.id, 'id', row.id);
      assertPgText('memories', row.id, 'last_accessed_at', row.lastAccessedAt);
    }
    const result = await this.writeBatch(
      `UPDATE memories AS m SET access_count = greatest(m.access_count, a.access_count),
         last_accessed_at = greatest(m.last_accessed_at, a.last_accessed_at)
       FROM unnest($1::text[], $2::integer[], $3::text[]) AS a(id, access_count, last_accessed_at)
       WHERE m.id = a.id AND (m.access_count < a.access_count OR m.last_accessed_at < a.last_accessed_at
         OR (m.last_accessed_at IS NULL AND a.last_accessed_at IS NOT NULL))`,
      [rows.map((r) => r.id), rows.map((r) => r.accessCount), rows.map((r) => r.lastAccessedAt)]
    );
    return result.rowCount ?? 0;
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

    try {
      const result = await this.writeBatch(text, values);
      return result.rowCount ?? 0;
    } catch (error) {
      if (typeof error !== 'object' || error === null
        || !('code' in error) || error.code !== '23505'
        || !('constraint' in error) || error.constraint !== 'idx_pg_connections_unique_pair') throw error;
      // The failed statement is atomic. Retry its rows separately so only the
      // duplicate pair is skipped and id-based updates retain LWW semantics.
      if (rows.length === 1) return 0;
      let applied = 0;
      for (const row of rows) applied += await this.pushConnections([row]);
      return applied;
    }
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

    const result = await this.writeBatch(text, values);
    return result.rowCount ?? 0;
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

  /** Upper bound for the shared checkpoint, sampled before any table is scanned. */
  async getPullStartTime(): Promise<string> {
    const result = await this.pool.query<{ ts: string }>(
      "SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC', $1) AS ts", [CURSOR_TS_FORMAT]
    );
    return result.rows[0]!.ts;
  }

  /** Pull `memories` rows newer than the cursor, excluding our own device's writes. */
  async pullMemories(cursorTs: string | null, cursorId: string | null, deviceId: string): Promise<PullBatch> {
    const rows = await this.db
      .select({ ...getTableColumns(pgMemories), cursorTs: cursorText(pgMemories.serverUpdatedAt) })
      .from(pgMemories)
      .where(pullPageFilter(pgMemories, cursorTs, cursorId, deviceId))
      .orderBy(asc(pgMemories.serverUpdatedAt), asc(pgMemories.id))
      .limit(this.batchSize);

    if (this.requireUnencrypted) await this.assertUnencrypted();
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

  /** Peers can advance these counters while the content row still belongs to this device. */
  async pullOwnedAccessCounters(cursorTs: string | null, cursorId: string | null, deviceId: string) {
    const { id, accessCount, lastAccessedAt, serverUpdatedAt } = pgMemories;
    const rows = await this.db.select({ id, accessCount, lastAccessedAt, cursorTs: cursorText(serverUpdatedAt) })
      .from(pgMemories)
      .where(and(pullPageFilter(pgMemories, cursorTs, cursorId, deviceId, true),
        or(isNotNull(lastAccessedAt), gt(accessCount, 0))))
      .orderBy(asc(serverUpdatedAt), asc(id)).limit(this.batchSize);
    const last = rows.at(-1);
    return { rows, maxServerUpdatedAt: last?.cursorTs ?? null, lastId: last?.id ?? null,
      hasMore: rows.length === this.batchSize };
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

    if (this.requireUnencrypted) await this.assertUnencrypted();
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

    if (this.requireUnencrypted) await this.assertUnencrypted();
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

  /** First connection claims the model. Legacy targets take theirs from existing rows. */
  async assertEmbeddingModel(model: string, client: Pool | PoolClient = this.pool): Promise<void> {
    let claimed = await this.getSyncMeta(MODEL_META_KEY, client);
    if (claimed === null) {
      const existing = await this.getRemoteEmbeddingModel(client);
      claimed = (await insertMetaFirstWins(client, MODEL_META_KEY, existing ?? model)).value;
    }
    if (claimed !== model) {
      throw new Error(
        `Embedding model mismatch: local uses "${model}" but the sync database uses "${claimed}". ` +
          'Local re-embedding only updates SQLite. Use the remote model, or stop sync across the fleet ' +
          'and run "engram cloud migrate-model <source> <target>" to convert the shared database.'
      );
    }
  }

  /** Find the model of existing remote rows when bootstrapping a legacy target. */
  async getRemoteEmbeddingModel(client: Pool | PoolClient = this.pool): Promise<string | null> {
    const result = await client.query<{ embedding_model: string }>(
      'SELECT DISTINCT embedding_model FROM memories WHERE embedding_model IS NOT NULL LIMIT 2'
    );
    if (result.rows.length > 1) throw new Error('Embedding model mismatch: the sync database contains multiple models.');
    return result.rows[0]?.embedding_model ?? null;
  }

  /** Offline fleet migration. Regenerate the remote vectors on this device in one transaction. */
  async migrateEmbeddingModel(sourceModel: string, encryptionKey?: string): Promise<number> {
    const targetModel = getEmbeddingModelId();
    if (sourceModel === targetModel) throw new Error('Choose a different target embedding model.');

    let manager: EncryptionManager | null = null;
    if (encryptionKey && await this.hasEncryptionMetadata()) {
      manager = new EncryptionManager(this);
      await manager.initialize(encryptionKey);
    }

    return this.db.transaction(async (tx) => {
      // Serialize with encryption bootstrap and writers until coverage is verified.
      await tx.execute(sql`LOCK TABLE sync_metadata IN SHARE ROW EXCLUSIVE MODE`);
      if (!manager) {
        const { key } = pgSchema.pgSyncMetadata;
        const [encrypted] = await tx.select({ key }).from(pgSchema.pgSyncMetadata)
          .where(inArray(key, ENCRYPTION_META_KEYS)).limit(1);
        if (encrypted) throw new Error('Set ENGRAM_SYNC_ENCRYPTION_KEY to migrate this encrypted database.');
      }
      await tx.execute(sql`LOCK TABLE memories IN SHARE ROW EXCLUSIVE MODE`);
      const { embedding, embeddingModel, id } = pgMemories;
      const models = await tx.select({ model: embeddingModel, total: count() }).from(pgMemories)
        .where(or(isNotNull(embedding), isNotNull(embeddingModel))).groupBy(embeddingModel);
      const source = models[0];
      const [claim] = await tx.select().from(pgSchema.pgSyncMetadata).where(eq(pgSchema.pgSyncMetadata.key, MODEL_META_KEY));
      if (models.length > 1 || (claim && claim.value !== sourceModel) ||
          (source ? source.model : claim?.value) !== sourceModel) {
        throw new Error(`Expected every remote embedding to use "${sourceModel}". Check the source model.`);
      }

      let afterId: string | undefined;
      let migrated = 0;
      for (;;) {
        const rows: PgMemory[] = await tx.select().from(pgMemories)
          .where(and(eq(embeddingModel, sourceModel), afterId === undefined ? undefined : gt(id, afterId)))
          .orderBy(id).limit(this.batchSize);
        if (rows.length === 0) break;
        for (const row of rows) {
          const plain = manager ? manager.decryptRow(row) : row;
          const vector = await embed(memoryEmbeddingText({ ...plain, type: row.type }), targetModel);
          if (!vector.length) throw new Error(`Empty embedding for memory ${row.id}.`);
          const replacement = { ...plain, embedding: packFP16(vector) };
          const stored = manager ? manager.encryptRow(replacement) : replacement;
          // Every replica must pull this revision, including the original writer.
          const updatedAt = new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1,
            Date.parse(row.archivedAt ?? row.updatedAt) + 1)).toISOString();
          const result = await tx.update(pgMemories).set({
            content: stored.content, embedding: stored.embedding, embeddingDim: vector.length,
            embeddingModel: targetModel, updatedAt, deviceId: null,
          }).where(eq(id, row.id));
          migrated += result.rowCount ?? 0;
          afterId = row.id;
        }
      }
      if (migrated !== (source?.total ?? 0)) throw new Error('Incomplete remote embedding coverage. Migration aborted.');
      await tx.insert(pgSchema.pgSyncMetadata).values({ key: MODEL_META_KEY, value: targetModel })
        .onConflictDoUpdate({ target: pgSchema.pgSyncMetadata.key, set: { value: targetModel, updatedAt: sql`now()` } });
      return migrated;
    }, { isolationLevel: 'read committed' });
  }

  // ─── sync metadata (E2E encryption, Phase 6) ─────────────────────────────

  /** Read a key-value pair from the sync_metadata table. */
  async getSyncMeta(key: string, client: Pool | PoolClient = this.pool): Promise<string | null> {
    const result = await client.query<{ value: string }>(
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
  async hasEncryptionMetadata(client: Pool | PoolClient = this.pool): Promise<boolean> {
    const result = await client.query<{ present: boolean }>(
      'SELECT true AS present FROM sync_metadata WHERE key = ANY($1::text[]) LIMIT 1',
      [ENCRYPTION_META_KEYS]
    );
    return result.rows.length > 0;
  }

  async assertUnencrypted(client: Pool | PoolClient = this.pool): Promise<void> {
    if (await this.hasEncryptionMetadata(client)) {
      throw new Error(
        'This sync database has end-to-end encryption enabled, but this process has no ' +
          'passphrase configured. Set ENGRAM_SYNC_ENCRYPTION_KEY to the passphrase the ' +
          'database was encrypted with — syncing without it would overwrite encrypted rows ' +
          'with plaintext.'
      );
    }
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
