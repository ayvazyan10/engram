/**
 * Database Adapter — abstraction layer for SQLite and PostgreSQL.
 *
 * SQLite is the default (zero config, embedded).
 * PostgreSQL is opt-in via ENGRAM_DATABASE=postgresql + DATABASE_URL.
 *
 * Both adapters expose the same drizzle ORM interface so NeuralBrain
 * and all routes work identically regardless of backend.
 */

import { sql } from 'drizzle-orm';
import path from 'path';
import * as schema from './schema.js';

export type DatabaseDialect = 'sqlite' | 'postgresql';

export interface AdapterConfig {
  /** Database dialect. Default: 'sqlite' */
  dialect?: DatabaseDialect;
  /** SQLite: path to .db file. Default: ./engram.db */
  sqlitePath?: string;
  /** PostgreSQL: connection URL. Required when dialect is 'postgresql' */
  postgresUrl?: string;
}

export interface DatabaseConnection {
  /** The drizzle ORM instance (works the same for both dialects) */
  db: any;
  /** Which dialect is active */
  dialect: DatabaseDialect;
  /** Close the connection */
  close: () => void;
  /** Whether pgvector is available (PostgreSQL only) */
  hasPgVector: boolean;
  /** Force WAL checkpoint so reads see external writes (SQLite only, no-op on PG) */
  walCheckpoint: () => void;
  /**
   * A counter that changes whenever ANOTHER connection commits, and never for
   * this connection's own writes (SQLite `PRAGMA data_version`).
   *
   * That asymmetry is exactly what callers holding derived in-memory state need:
   * their own writes already updated it, so only a change here means somebody
   * else's data has arrived and the derived state is stale.
   *
   * Returns null when the backend cannot report it (PostgreSQL), meaning
   * "unknown" — callers must not read that as "nothing changed".
   */
  dataVersion: () => number | null;
}

// Singleton
let _connection: DatabaseConnection | null = null;

/**
 * Resolve config from explicit options, env vars, and defaults.
 */
function resolveConfig(config?: AdapterConfig): Required<AdapterConfig> {
  const dialect: DatabaseDialect =
    (config?.dialect ?? process.env['ENGRAM_DATABASE'] ?? 'sqlite') as DatabaseDialect;

  const sqlitePath =
    config?.sqlitePath ??
    process.env['ENGRAM_DB_PATH'] ??
    path.join(process.cwd(), 'engram.db');

  const postgresUrl =
    config?.postgresUrl ??
    process.env['DATABASE_URL'] ??
    '';

  return { dialect, sqlitePath, postgresUrl };
}

/**
 * Get or create the database connection.
 *
 * For backwards compatibility, accepts an optional dbPath string
 * (same as the old getDb signature) which maps to SQLite.
 */
export function getDatabase(configOrPath?: AdapterConfig | string): DatabaseConnection {
  if (_connection) return _connection;

  const config: AdapterConfig | undefined =
    typeof configOrPath === 'string'
      ? { sqlitePath: configOrPath }
      : configOrPath;

  const resolved = resolveConfig(config);

  if (resolved.dialect === 'postgresql') {
    _connection = createPostgresConnection(resolved.postgresUrl);
  } else {
    _connection = createSqliteConnection(resolved.sqlitePath);
  }

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
 * Get the current dialect without creating a connection.
 */
export function getDialect(): DatabaseDialect {
  if (_connection) return _connection.dialect;
  return (process.env['ENGRAM_DATABASE'] ?? 'sqlite') as DatabaseDialect;
}

// ─── SQLite Adapter ──────────────────────────────────────────────────────────

function createSqliteConnection(dbPath: string): DatabaseConnection {
  // Dynamic import to avoid loading better-sqlite3 when using PostgreSQL
  const Database = require('better-sqlite3');
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
    dialect: 'sqlite',
    close: () => {
      sqlite.close();
    },
    hasPgVector: false,
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

/** Whether `column` exists on `table` in this SQLite database. */
function columnExists(sqlite: any, table: string, column: string): boolean {
  const row = sqlite
    .prepare('SELECT COUNT(*) as cnt FROM pragma_table_info(?) WHERE name = ?')
    .get(table, column) as { cnt: number };
  return row.cnt > 0;
}

/** Whether `table` exists in this SQLite database. */
function tableExists(sqlite: any, table: string): boolean {
  const row = sqlite
    .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { cnt: number };
  return row.cnt > 0;
}

/** Whether `index` exists in this SQLite database. */
function indexExists(sqlite: any, index: string): boolean {
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
function addColumnIfMissing(sqlite: any, table: string, column: string, type: string): void {
  if (!columnExists(sqlite, table, column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

function runSqliteMigrations(sqlite: any): void {
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

// ─── PostgreSQL Adapter ──────────────────────────────────────────────────────

function createPostgresConnection(url: string): DatabaseConnection {
  if (!url) {
    throw new Error(
      'ENGRAM_DATABASE=postgresql requires DATABASE_URL to be set.\n' +
      'Example: DATABASE_URL=postgresql://user:pass@localhost:5432/engram'
    );
  }

  let pg: any;
  let drizzlePg: any;
  try {
    pg = require('pg');
    drizzlePg = require('drizzle-orm/node-postgres');
  } catch {
    throw new Error(
      'PostgreSQL support requires the "pg" package.\n' +
      'Install it: pnpm add pg @types/pg'
    );
  }

  // The PostgreSQL backend has no schema of its own: the Drizzle schema is
  // sqliteTable-only and drizzle.config targets dialect 'sqlite', so no PG
  // migrations are generated and the base tables are never created. Previously
  // this function returned a healthy-looking connection that failed on the very
  // first store with `relation "memories" does not exist` — refuse loudly
  // instead of handing back something known-broken.
  if (process.env['ENGRAM_PG_SCHEMA_READY'] !== 'true') {
    throw new Error(
      [
        'PostgreSQL backend is not implemented yet.',
        '',
        'Engram ships no PostgreSQL migrations — the Drizzle schema is SQLite-only',
        '(sqliteTable) and drizzle.config.ts targets dialect "sqlite", so the',
        'memories / memory_connections / sessions / context_assemblies tables are',
        'never created. Connecting would appear to succeed and then fail on the',
        'first store with: relation "memories" does not exist.',
        '',
        'Use the default SQLite backend (unset ENGRAM_DATABASE), or — if you have',
        'provisioned a compatible PostgreSQL schema yourself — set',
        'ENGRAM_PG_SCHEMA_READY=true to proceed at your own risk.',
      ].join('\n')
    );
  }

  const pool = new pg.Pool({ connectionString: url });
  const db = drizzlePg.drizzle(pool, { schema });

  // Check for pgvector extension (async — we'll set it after first query)
  let hasPgVector = false;
  pool.query("SELECT 1 FROM pg_extension WHERE extname = 'vector'")
    .then((res: any) => {
      hasPgVector = res.rows.length > 0;
    })
    .catch(() => {
      // pgvector not available
    });

  // Run PostgreSQL migrations
  runPostgresMigrations(pool);

  const connection: DatabaseConnection = {
    db,
    dialect: 'postgresql',
    close: () => {
      pool.end();
    },
    get hasPgVector() { return hasPgVector; },
    walCheckpoint: () => {},
    // No cheap equivalent of PRAGMA data_version here. Reporting "unknown"
    // rather than a fabricated constant keeps callers from concluding that
    // nothing has changed.
    dataVersion: () => null,
  };

  return connection;
}

function runPostgresMigrations(pool: any): void {
  // Each statement runs on its own. Previously these were a single
  // multi-statement query, so the trailing CREATE INDEX failing on a fresh
  // database aborted the implicit transaction and rolled back everything before
  // it — invisibly, because the whole thing was wrapped in `.catch(() => {})`.
  const statements = [
    `DO $$ BEGIN
       ALTER TABLE memories ADD COLUMN IF NOT EXISTS namespace TEXT;
     EXCEPTION WHEN undefined_table THEN NULL; END $$`,
    `DO $$ BEGIN
       ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_model TEXT;
     EXCEPTION WHEN undefined_table THEN NULL; END $$`,
    `CREATE TABLE IF NOT EXISTS webhooks (
       id TEXT PRIMARY KEY,
       url TEXT NOT NULL,
       secret TEXT,
       events TEXT NOT NULL DEFAULT '[]',
       active BOOLEAN NOT NULL DEFAULT true,
       description TEXT,
       metadata TEXT NOT NULL DEFAULT '{}',
       created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
       last_triggered_at TEXT,
       fail_count INTEGER NOT NULL DEFAULT 0
     )`,
    `CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks (active)`,
    `CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)`,
  ];

  for (const sql of statements) {
    pool.query(sql).catch((err: unknown) => {
      // Surface the failure instead of discarding it.
      const label = sql.trim().split('\n')[0]?.slice(0, 60);
      console.error(`[engram] PostgreSQL migration failed (${label}...):`, err);
    });
  }

  // Try to enable pgvector
  pool.query('CREATE EXTENSION IF NOT EXISTS vector').catch(() => {
    // pgvector not installed — that's okay, we'll use in-memory search
  });
}

export { schema };
