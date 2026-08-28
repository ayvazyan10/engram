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
import type { Pool, QueryResult } from 'pg';
import { and, asc, eq, gt, gte, isNull, ne, or } from 'drizzle-orm';
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
  /** The highest server_updated_at seen in this batch, to advance the cursor. */
  maxServerUpdatedAt: string | null;
  /** The `id` of the last row in this batch — used as a tie-breaker when multiple
   *  rows share the same `server_updated_at` so the cursor always advances. */
  lastId: string | null;
  /** Whether there are more rows to pull (this batch was a full page). */
  hasMore: boolean;
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
}

function buildUpsertQuery(spec: UpsertSpec, rows: readonly unknown[][]): { text: string; values: unknown[] } {
  const { table, columns, greatestColumns = [] } = spec;
  const values: unknown[] = [];

  const valueRows = rows.map((row) => {
    const placeholders = row.map((value) => {
      values.push(value);
      return `$${values.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });

  const updateAssignments = columns
    .filter((column) => column !== 'id')
    .map((column) =>
      greatestColumns.includes(column)
        ? `${column} = GREATEST(${table}.${column}, EXCLUDED.${column})`
        : `${column} = EXCLUDED.${column}`
    )
    .join(',\n      ');

  const text = `
    INSERT INTO ${table} (${columns.join(', ')})
    VALUES ${valueRows.join(', ')}
    ON CONFLICT (id) DO UPDATE SET
      ${updateAssignments}
    WHERE EXCLUDED.updated_at > ${table}.updated_at
       OR (EXCLUDED.updated_at = ${table}.updated_at
           AND EXCLUDED.device_id > ${table}.device_id)
  `;

  return { text, values };
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

  /** Push local `memories` rows with an LWW upsert. Returns the count actually applied. */
  async pushMemories(rows: Memory[]): Promise<number> {
    if (rows.length === 0) return 0;

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
      },
      valueRows
    );

    const result: QueryResult = await this.pool.query(text, values);
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
  // (echo of our own push) and rows whose `server_updated_at` doesn't
  // exceed `cursorWithOverlap`. `cursorWithOverlap === null` means "first
  // sync" — pull everything. A row with `device_id IS NULL` (pre-Phase-0)
  // is always included: `NULL != deviceId` is itself NULL/false in SQL, so a
  // plain `ne()` would silently exclude it — `isNull(...) OR ne(...)` covers
  // both cases explicitly.

  /** Pull `memories` rows newer than the cursor, excluding our own device's writes.
   *  Uses a composite cursor `(server_updated_at, id)` so the cursor always
   *  advances even when many rows share the same timestamp. */
  async pullMemories(cursorTs: string | null, cursorId: string | null, deviceId: string): Promise<PullBatch> {
    const conditions = [or(isNull(pgMemories.deviceId), ne(pgMemories.deviceId, deviceId))];
    if (cursorTs !== null) {
      if (cursorId !== null) {
        // Composite cursor: (ts > cursorTs) OR (ts = cursorTs AND id > cursorId)
        conditions.push(or(
          gt(pgMemories.serverUpdatedAt, new Date(cursorTs)),
          and(eq(pgMemories.serverUpdatedAt, new Date(cursorTs)), gt(pgMemories.id, cursorId)),
        ));
      } else {
        conditions.push(gt(pgMemories.serverUpdatedAt, new Date(cursorTs)));
      }
    }

    const rows = await this.db
      .select()
      .from(pgMemories)
      .where(and(...conditions))
      .orderBy(asc(pgMemories.serverUpdatedAt), asc(pgMemories.id))
      .limit(this.batchSize);

    const last = rows.at(-1);
    return {
      memories: rows,
      connections: [],
      sessions: [],
      maxServerUpdatedAt: last ? last.serverUpdatedAt.toISOString() : null,
      lastId: last ? last.id : null,
      hasMore: rows.length === this.batchSize,
    };
  }

  /** Pull `memory_connections` rows newer than the cursor, excluding our own device's writes. */
  async pullConnections(cursorTs: string | null, cursorId: string | null, deviceId: string): Promise<PullBatch> {
    const conditions = [
      or(isNull(pgMemoryConnections.deviceId), ne(pgMemoryConnections.deviceId, deviceId)),
    ];
    if (cursorTs !== null) {
      if (cursorId !== null) {
        conditions.push(or(
          gt(pgMemoryConnections.serverUpdatedAt, new Date(cursorTs)),
          and(eq(pgMemoryConnections.serverUpdatedAt, new Date(cursorTs)), gt(pgMemoryConnections.id, cursorId)),
        ));
      } else {
        conditions.push(gt(pgMemoryConnections.serverUpdatedAt, new Date(cursorTs)));
      }
    }

    const rows = await this.db
      .select()
      .from(pgMemoryConnections)
      .where(and(...conditions))
      .orderBy(asc(pgMemoryConnections.serverUpdatedAt), asc(pgMemoryConnections.id))
      .limit(this.batchSize);

    const last = rows.at(-1);
    return {
      memories: [],
      connections: rows,
      sessions: [],
      maxServerUpdatedAt: last ? last.serverUpdatedAt.toISOString() : null,
      lastId: last ? last.id : null,
      hasMore: rows.length === this.batchSize,
    };
  }

  /** Pull `sessions` rows newer than the cursor, excluding our own device's writes. */
  async pullSessions(cursorTs: string | null, cursorId: string | null, deviceId: string): Promise<PullBatch> {
    const conditions = [or(isNull(pgSessions.deviceId), ne(pgSessions.deviceId, deviceId))];
    if (cursorTs !== null) {
      if (cursorId !== null) {
        conditions.push(or(
          gt(pgSessions.serverUpdatedAt, new Date(cursorTs)),
          and(eq(pgSessions.serverUpdatedAt, new Date(cursorTs)), gt(pgSessions.id, cursorId)),
        ));
      } else {
        conditions.push(gt(pgSessions.serverUpdatedAt, new Date(cursorTs)));
      }
    }

    const rows = await this.db
      .select()
      .from(pgSessions)
      .where(and(...conditions))
      .orderBy(asc(pgSessions.serverUpdatedAt), asc(pgSessions.id))
      .limit(this.batchSize);

    const last = rows.at(-1);
    return {
      memories: [],
      connections: [],
      sessions: rows,
      maxServerUpdatedAt: last ? last.serverUpdatedAt.toISOString() : null,
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
}
