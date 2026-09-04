/**
 * Database Adapter — SQLite storage layer.
 *
 * SQLite is Engram's only supported primary backend (zero config, embedded).
 * PostgreSQL is not supported as a primary backend — for multi-device sync,
 * use ENGRAM_SYNC_URL instead (see docs/CLOUD-SYNC.md).
 */

import path from 'path';
import type { Database as SqliteHandle } from 'better-sqlite3';
import * as schema from './schema.js';

/** Database dialect. SQLite is the only supported primary backend. */
export type DatabaseDialect = 'sqlite';

export interface AdapterConfig {
  /** Database dialect. Only 'sqlite' is supported. Default: 'sqlite' */
  dialect?: DatabaseDialect;
  /** SQLite: path to .db file. Default: ./engram.db */
  sqlitePath?: string;
}

export interface DatabaseConnection {
  /**
   * The drizzle ORM instance.
   *
   * Deliberately `any`: naming drizzle's real type here
   * (`BetterSQLite3Database<typeof schema>`) would pin the schema generic
   * into the public surface of every consumer that holds a connection, and
   * the instance itself comes back from an untyped lazy `require` below.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
  db: any;
  /**
   * Path of the SQLite file backing this connection.
   *
   * Exposed because a database file's identity is not the same thing as the
   * installation's identity: `sync/deviceId.ts` fingerprints this path (with
   * the file's inode) to notice that `engram.db` has been copied onto a
   * second machine, which otherwise leaves two installations sharing one
   * `device_id` and silently exchanging nothing.
   */
  path: string;
  /** Close the connection */
  close: () => void;
  /** Force WAL checkpoint so reads see external writes */
  walCheckpoint: () => void;
  /**
   * A counter that changes whenever ANOTHER connection commits, and never for
   * this connection's own writes (SQLite `PRAGMA data_version`).
   *
   * That asymmetry is exactly what callers holding derived in-memory state need:
   * their own writes already updated it, so only a change here means somebody
   * else's data has arrived and the derived state is stale.
   *
   * Returns null when the backend cannot report it, meaning "unknown" —
   * callers must not read that as "nothing changed".
   */
  dataVersion: () => number | null;
}

// Singleton
let _connection: DatabaseConnection | null = null;

/**
 * A path only counts as configured when it is not blank.
 *
 * `??` is not enough here: hosts that template an unset optional config field
 * (the Claude Desktop extension's `db_path` among them) pass an EMPTY STRING
 * rather than omitting the variable, and better-sqlite3 reads '' as an
 * ANONYMOUS TEMPORARY DATABASE that is deleted when the connection closes —
 * so every write was reported as stored and silently discarded on exit.
 *
 * A non-blank value is returned byte-for-byte; only blank means "unset".
 */
function configuredPath(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

/**
 * Resolve config from explicit options, env vars, and defaults.
 */
function resolveConfig(config?: AdapterConfig): { sqlitePath: string } {
  const sqlitePath =
    configuredPath(config?.sqlitePath) ??
    configuredPath(process.env['ENGRAM_DB_PATH']) ??
    path.join(process.cwd(), 'engram.db');

  return { sqlitePath };
}

/**
 * Get or create the database connection.
 *
 * For backwards compatibility, accepts an optional dbPath string
 * (same as the old getDb signature) which maps to SQLite.
 */
export function getDatabase(configOrPath?: AdapterConfig | string): DatabaseConnection {
  if (_connection) return _connection;

  if (process.env['ENGRAM_DATABASE'] === 'postgresql') {
    throw new Error(
      [
        'PostgreSQL as a primary backend is not supported.',
        'For multi-device sync, use ENGRAM_SYNC_URL instead.',
        'See: https://github.com/AiondaDotCom/neuralCore/blob/master/docs/CLOUD-SYNC.md',
      ].join('\n')
    );
  }

  const config: AdapterConfig | undefined =
    typeof configOrPath === 'string'
      ? { sqlitePath: configOrPath }
      : configOrPath;

  const resolved = resolveConfig(config);

  _connection = createSqliteConnection(resolved.sqlitePath);

  return _connection;
}

/**
 * Close the active database connection.
 */
export function closeDatabase(): void {
  _connection?.close();
  _connection = null;
}

/**
 * Get the current dialect. SQLite is the only supported primary backend,
 * so this always returns 'sqlite'. Kept for backwards compatibility.
 */
export function getDialect(): DatabaseDialect {
  return 'sqlite';
}

// ─── SQLite Adapter ──────────────────────────────────────────────────────────

function createSqliteConnection(dbPath: string): DatabaseConnection {
  // Lazy, deliberately `require`: better-sqlite3 is a native addon and this
  // module is imported by every process that merely *talks about* a database.
  // Hoisting these to static imports would load the addon at import time
  // rather than at first connection, which is a behaviour change, not a
  // style one.
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
  const Database = require('better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
  const { drizzle } = require('drizzle-orm/better-sqlite3');

  const sqlite = new Database(dbPath);

  // Enable WAL mode for better write performance
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('cache_size = 10000');
  sqlite.pragma('foreign_keys = ON');
  // better-sqlite3 defaults to a 0ms busy timeout (immediate SQLITE_BUSY) on
  // lock contention. Engram routinely runs the REST server, the MCP server,
  // and the CLI against one shared file, so two processes can legitimately
  // write at the same instant (see getDeviceId()'s local_meta bootstrap for
  // one real example). Wait briefly for the other writer instead of failing
  // outright.
  sqlite.pragma('busy_timeout = 5000');

  // Auto-migrations for SQLite
  runSqliteMigrations(sqlite);

  const db = drizzle(sqlite, { schema });

  return {
    db,
    path: dbPath,
    close: () => {
      sqlite.close();
    },
    walCheckpoint: () => {
      sqlite.pragma('wal_checkpoint(PASSIVE)');
    },
    dataVersion: () => {
      const value = sqlite.pragma('data_version', { simple: true });
      return typeof value === 'number' ? value : null;
    },
  };
}

// ─── Migration helpers ──────────────────────────────────────────────────────
//
// `runSqliteMigrations` runs on EVERY connection open, in EVERY process that
// touches this database (REST server, MCP server, CLI), forever — so each
// existence check below must stay a single cheap read, and every DDL
// statement must be gated so it executes at most once per database file
// rather than re-running on every open.
//
// NULLABLE PRIMARY KEYS, deliberately left alone. `webhooks.id`,
// `local_meta.key` and `sync_state.id` are declared `TEXT PRIMARY KEY`
// without `NOT NULL`, and SQLite honours that literally: a non-STRICT rowid
// table genuinely accepts a NULL primary key. The v0.1.0-era tables above all
// say `NOT NULL`; these three were added later and did not.
//
// Tightening them looks like a one-word fix and is not. SQLite cannot add
// `NOT NULL` to an existing column, so every database that already has these
// tables keeps the loose declaration — and a fresh database would then stop
// matching an upgraded one, which is precisely the equivalence
// `__tests__/migration-v050.test.ts` pins byte-for-byte (it reconstructs a
// real v0.4.0 database, nullable `webhooks.id` and all). Closing this
// properly means rebuilding three tables on upgrade; until someone decides
// that is worth it, `__tests__/sqlite-schema-parity.test.ts` exempts exactly
// these three by name. Nothing in the codebase has ever written a NULL there.
//
// TIMESTAMP DEFAULTS. `DEFAULT (CURRENT_TIMESTAMP)` below produces SQLite's
// own format, `2026-01-01 12:00:00` — space-separated, no timezone, no
// milliseconds. Every timestamp Engram compares is compared as a STRING
// (sync's last-write-wins, the push cursor's `updated_at > ?`), and a
// space-separated value sorts BEFORE any ISO `2026-01-01T…Z` value on the
// same date, because ' ' < 'T'. A row stamped by the default would therefore
// read as older than every ISO row from the same day and could sit below the
// push cursor forever.
//
// This is documented rather than normalised, deliberately. Every writer in
// this repo stamps an explicit `new Date().toISOString()`, so the default is
// only ever reached by an external process writing to `engram.db` directly.
// Changing a column default in SQLite means rebuilding the table, and doing
// it for fresh databases only would break the fresh-vs-upgraded schema
// equivalence that `__tests__/migration-v050.test.ts` pins. If you add a
// write path here, stamp ISO-8601 explicitly — do not rely on the default.

/** Whether `column` exists on `table` in this SQLite database. */
function columnExists(sqlite: SqliteHandle, table: string, column: string): boolean {
  const row = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM pragma_table_info(?) WHERE name = ?')
    .get(table, column) as { cnt: number };
  return row.cnt > 0;
}

/** Whether `table` exists in this SQLite database. */
function tableExists(sqlite: SqliteHandle, table: string): boolean {
  const row = sqlite
    .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { cnt: number };
  return row.cnt > 0;
}

/** Whether `index` exists in this SQLite database. */
function indexExists(sqlite: SqliteHandle, index: string): boolean {
  const row = sqlite
    .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='index' AND name=?")
    .get(index) as { cnt: number };
  return row.cnt > 0;
}

/**
 * Adds `column` (as `type`) to `table` if it doesn't already exist. Always
 * additive/nullable — never changes an existing column's type, nullability,
 * or default. Safe and cheap to call unconditionally on every connection
 * open: it no-ops (one read, no write) once the column is present.
 */
function addColumnIfMissing(sqlite: SqliteHandle, table: string, column: string, type: string): void {
  if (!columnExists(sqlite, table, column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function runSqliteMigrations(sqlite: SqliteHandle): void {
  // v0.1.0: Create base tables if they don't exist (fresh database)
  if (!tableExists(sqlite, 'memories')) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        embedding BLOB,
        embedding_dim INTEGER NOT NULL DEFAULT 384,
        importance REAL NOT NULL DEFAULT 0.5,
        confidence REAL NOT NULL DEFAULT 1,
        access_count INTEGER NOT NULL DEFAULT 0,
        last_accessed_at TEXT,
        event_at TEXT,
        session_id TEXT,
        source TEXT,
        concept TEXT,
        trigger_pattern TEXT,
        action_pattern TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        archived_at TEXT,
        namespace TEXT,
        embedding_model TEXT,
        device_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_memories_type ON memories (type);
      CREATE INDEX IF NOT EXISTS idx_memories_source ON memories (source);
      CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories (importance);
      CREATE INDEX IF NOT EXISTS idx_memories_session ON memories (session_id);
      CREATE INDEX IF NOT EXISTS idx_memories_concept ON memories (concept);
      CREATE INDEX IF NOT EXISTS idx_memories_archived ON memories (archived_at);
      CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace);
      CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories (updated_at);
      CREATE INDEX IF NOT EXISTS idx_memories_sync_push ON memories (device_id, updated_at, id);

      CREATE TABLE IF NOT EXISTS memory_connections (
        id TEXT PRIMARY KEY NOT NULL,
        source_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        target_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
        relationship TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1,
        bidirectional INTEGER NOT NULL DEFAULT false,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        updated_at TEXT,
        deleted_at TEXT,
        device_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_connections_source ON memory_connections (source_id);
      CREATE INDEX IF NOT EXISTS idx_connections_target ON memory_connections (target_id);
      CREATE INDEX IF NOT EXISTS idx_connections_relationship ON memory_connections (relationship);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_connections_unique_pair ON memory_connections (source_id, target_id, relationship);
      CREATE INDEX IF NOT EXISTS idx_connections_deleted_at ON memory_connections (deleted_at);
      CREATE INDEX IF NOT EXISTS idx_connections_updated_at ON memory_connections (updated_at);
      CREATE INDEX IF NOT EXISTS idx_connections_sync_push ON memory_connections (device_id, updated_at, id);

      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY NOT NULL,
        source TEXT NOT NULL,
        context TEXT,
        started_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        ended_at TEXT,
        namespace TEXT,
        updated_at TEXT,
        deleted_at TEXT,
        device_id TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions (source);
      CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions (started_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON sessions (namespace);
      CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions (deleted_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_sync_push ON sessions (device_id, updated_at, id);

      CREATE TABLE IF NOT EXISTS context_assemblies (
        id TEXT PRIMARY KEY NOT NULL,
        query TEXT NOT NULL,
        query_embedding BLOB,
        assembled_context TEXT NOT NULL,
        source TEXT,
        session_id TEXT,
        latency_ms INTEGER,
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        namespace TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_assemblies_source ON context_assemblies (source);
      CREATE INDEX IF NOT EXISTS idx_assemblies_session ON context_assemblies (session_id);
      CREATE INDEX IF NOT EXISTS idx_assemblies_created ON context_assemblies (created_at);
      CREATE INDEX IF NOT EXISTS idx_assemblies_namespace ON context_assemblies (namespace);

      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        secret TEXT,
        events TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        last_triggered_at TEXT,
        fail_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks (active);

      CREATE TABLE IF NOT EXISTS local_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        pull_cursor TEXT,
        last_push_at TEXT,
        last_sync_at TEXT,
        last_error TEXT,
        embedding_model TEXT,
        created_at TEXT NOT NULL
      );
    `);
    return; // Fresh DB — no need for incremental migrations
  }

  // v0.2.0: namespace column
  const memoriesNamespaceIsNew = !columnExists(sqlite, 'memories', 'namespace');
  addColumnIfMissing(sqlite, 'memories', 'namespace', 'text');
  if (memoriesNamespaceIsNew) {
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  }

  const sessionsNamespaceIsNew = !columnExists(sqlite, 'sessions', 'namespace');
  addColumnIfMissing(sqlite, 'sessions', 'namespace', 'text');
  if (sessionsNamespaceIsNew) {
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON sessions (namespace)');
  }

  const assembliesNamespaceIsNew = !columnExists(sqlite, 'context_assemblies', 'namespace');
  addColumnIfMissing(sqlite, 'context_assemblies', 'namespace', 'text');
  if (assembliesNamespaceIsNew) {
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_assemblies_namespace ON context_assemblies (namespace)');
  }

  // v0.3.0: embedding_model column
  addColumnIfMissing(sqlite, 'memories', 'embedding_model', 'text');

  // v0.4.0: webhooks table
  if (!tableExists(sqlite, 'webhooks')) {
    sqlite.exec(`
      CREATE TABLE webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        secret TEXT,
        events TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        description TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
        last_triggered_at TEXT,
        fail_count INTEGER NOT NULL DEFAULT 0
      )
    `);
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks (active)');
  }

  // v0.5.0: multi-device sync foundation (schema only — see .claude/PRPs/plans/postgres-cloud-sync.md)
  addColumnIfMissing(sqlite, 'memories', 'device_id', 'text');

  // Needed by the future sync push query: WHERE updated_at > cursor. `updated_at`
  // itself has existed on `memories` since v0.1.0, so only the index is new
  // here — there's no "column just added" event to hang the CREATE INDEX off
  // of, so it's gated on the index's own existence instead, to keep this
  // running once per database file rather than on every connection open.
  if (!indexExists(sqlite, 'idx_memories_updated_at')) {
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories (updated_at)');
  }

  const connectionsUpdatedAtIsNew = !columnExists(sqlite, 'memory_connections', 'updated_at');
  addColumnIfMissing(sqlite, 'memory_connections', 'updated_at', 'text');
  if (connectionsUpdatedAtIsNew) {
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_connections_updated_at ON memory_connections (updated_at)');
  }

  const connectionsDeletedAtIsNew = !columnExists(sqlite, 'memory_connections', 'deleted_at');
  addColumnIfMissing(sqlite, 'memory_connections', 'deleted_at', 'text');
  if (connectionsDeletedAtIsNew) {
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_connections_deleted_at ON memory_connections (deleted_at)');
  }

  addColumnIfMissing(sqlite, 'memory_connections', 'device_id', 'text');

  addColumnIfMissing(sqlite, 'sessions', 'updated_at', 'text');

  const sessionsDeletedAtIsNew = !columnExists(sqlite, 'sessions', 'deleted_at');
  addColumnIfMissing(sqlite, 'sessions', 'deleted_at', 'text');
  if (sessionsDeletedAtIsNew) {
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_sessions_deleted_at ON sessions (deleted_at)');
  }

  addColumnIfMissing(sqlite, 'sessions', 'device_id', 'text');

  // The sync push query selects only rows this device owns and pages on a
  // composite boundary:
  //
  //   WHERE (device_id IS NULL OR device_id = ?)
  //     AND (updated_at > ? OR (updated_at = ? AND id > ?))
  //   ORDER BY updated_at, id LIMIT ?
  //
  // On `(updated_at)` alone SQLite can only seek by timestamp and then
  // discard every peer-written row it lands on, so a device that has pulled
  // a lot from its peers walks most of the table to fill one page. Leading
  // with `device_id` lets the MULTI-INDEX OR seek straight into this
  // device's own rows: measured at 19.3 ms -> 2.7 ms for one 500-row page of
  // a 200k-row table that is 90% peer-written.
  //
  // `(updated_at, id)` WITHOUT the device_id prefix is actively worse than
  // what we have — SQLite abandons the OR optimization for a full index scan
  // (~1000x slower in the same measurement) — so this must stay a
  // three-column index, not a two-column one.
  //
  // Gated on the index's own existence: `device_id` was added above and may
  // already have existed, so there is no "column just added" event to hang
  // this off, and it must not re-run on every connection open.
  for (const [indexName, table] of [
    ['idx_memories_sync_push', 'memories'],
    ['idx_connections_sync_push', 'memory_connections'],
    ['idx_sessions_sync_push', 'sessions'],
  ] as const) {
    if (!indexExists(sqlite, indexName)) {
      sqlite.exec(
        `CREATE INDEX IF NOT EXISTS ${indexName} ON ${table} (device_id, updated_at, id)`
      );
    }
  }

  if (!tableExists(sqlite, 'local_meta')) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS local_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  }

  if (!tableExists(sqlite, 'sync_state')) {
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        pull_cursor TEXT,
        last_push_at TEXT,
        last_sync_at TEXT,
        last_error TEXT,
        embedding_model TEXT,
        created_at TEXT NOT NULL
      )
    `);
  }
}

export { schema };
