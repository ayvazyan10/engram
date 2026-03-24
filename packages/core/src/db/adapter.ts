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
  };
}

function runSqliteMigrations(sqlite: any): void {
  // v0.2.0: namespace column
  const hasNamespace = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('memories') WHERE name='namespace'"
  ).get() as { cnt: number };
  if (hasNamespace.cnt === 0) {
    sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
    sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  }

  // v0.3.0: embedding_model column
  const hasEmbeddingModel = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM pragma_table_info('memories') WHERE name='embedding_model'"
  ).get() as { cnt: number };
  if (hasEmbeddingModel.cnt === 0) {
    sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');
  }

  // v0.4.0: webhooks table
  const hasWebhooks = sqlite.prepare(
    "SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='webhooks'"
  ).get() as { cnt: number };
  if (hasWebhooks.cnt === 0) {
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
  };

  return connection;
}

function runPostgresMigrations(pool: any): void {
  // Ensure tables exist (PostgreSQL uses different syntax)
  pool.query(`
    -- Add namespace column if missing
    DO $$ BEGIN
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS namespace TEXT;
    EXCEPTION WHEN undefined_table THEN NULL; END $$;

    -- Add embedding_model column if missing
    DO $$ BEGIN
      ALTER TABLE memories ADD COLUMN IF NOT EXISTS embedding_model TEXT;
    EXCEPTION WHEN undefined_table THEN NULL; END $$;

    -- Create webhooks table if missing
    CREATE TABLE IF NOT EXISTS webhooks (
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
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks (active);

    -- Create namespace index if missing
    CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace);
  `).catch(() => {
    // Tables may not exist yet on first run — drizzle migrations handle initial schema
  });

  // Try to enable pgvector
  pool.query('CREATE EXTENSION IF NOT EXISTS vector').catch(() => {
    // pgvector not installed — that's okay, we'll use in-memory search
  });
}

export { schema };
