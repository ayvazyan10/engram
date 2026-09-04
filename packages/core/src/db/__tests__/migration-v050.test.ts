/**
 * Tests for the v0.5.0 migration — multi-device sync schema foundation.
 *
 * Covers `.claude/PRPs/plans/postgres-cloud-sync.md` (Фаза 0) acceptance
 * criteria for the schema/migration layer only:
 *
 * 1. A fresh database gets every new column and both new tables.
 * 2. A database built with the OLD (pre-v0.5.0) schema gets upgraded in place.
 * 3. A fresh DB and an upgraded DB produce byte-identical `PRAGMA table_info`
 *    for every table (names, types, order) — this is the most important test:
 *    it is the guardrail against fresh-vs-migrated schema drift.
 * 4. The migration is idempotent — running it twice never throws or
 *    duplicates a column/table.
 * 5. `getDeviceId()` is stable, persisted, and a valid v4 UUID.
 * 6. A genuinely pre-v0.2.0 (v0.1.0) database — no namespace columns, no
 *    embedding_model, no webhooks table at all — comes out identical to a
 *    fresh database after running the ENTIRE incremental chain in one open.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { getDatabaseConnection, closeDatabase } from '../index.js';
import { getDeviceId, _resetMemoizedDeviceIdForTests } from '../../sync/deviceId.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// The FROZEN v0.1.0 schema, checked in under fixtures/. Deliberately not
// `../migrations/` — that folder is regenerated from schema.ts and therefore
// always describes the present, never the release this test needs to
// reconstruct. See the fixture's own header.
const V010_SCHEMA_SQL = fs.readFileSync(
  path.join(__dirname, 'fixtures/v010-schema.sql'),
  'utf-8'
);

/** Applies the frozen v0.1.0 DDL to an empty database file. */
function applyV010Schema(sqlite: Database.Database): void {
  for (const rawStmt of V010_SCHEMA_SQL.split('--> statement-breakpoint')) {
    const stmt = rawStmt.trim();
    if (stmt) sqlite.exec(stmt);
  }
}

// All tables that exist in any supported schema version, for the
// fresh-vs-upgraded equivalence sweep.
const ALL_TABLES = [
  'memories',
  'memory_connections',
  'sessions',
  'context_assemblies',
  'webhooks',
  'local_meta',
  'sync_state',
];

function tempDbPath(label: string): string {
  return path.join(__dirname, `test-v050-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
}

/**
 * Builds a database reflecting the real, pre-v0.5.0 schema (v0.4.0): the
 * frozen v0.1.0 baseline plus the v0.2.0/v0.3.0/v0.4.0 incremental ALTERs
 * that `runSqliteMigrations` applies at runtime.
 *
 * IMPORTANT: `namespace` is added here by ALTER, never inlined in the CREATE.
 * A genuinely pre-v0.2.0 database never had `namespace` on ANY table; it
 * arrived later via a runtime `ALTER TABLE`, which APPENDS the column. Real,
 * long-lived production databases confirm this (verified against a real
 * backup via scripts/verify-migration-against-real-db.mjs: `namespace` sits
 * at the END of both tables, not inline). Reproducing that ordering is the
 * whole point — the fresh-vs-upgraded equivalence assertions below compare
 * column order.
 */
function createV040Db(dbPath: string): void {
  const sqlite = new Database(dbPath);
  applyV010Schema(sqlite);

  // v0.2.0: namespace column, applied uniformly via ALTER (matches reality).
  sqlite.exec('ALTER TABLE memories ADD COLUMN namespace text');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_memories_namespace ON memories (namespace)');
  sqlite.exec('ALTER TABLE sessions ADD COLUMN namespace text');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_sessions_namespace ON sessions (namespace)');
  sqlite.exec('ALTER TABLE context_assemblies ADD COLUMN namespace text');
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_assemblies_namespace ON context_assemblies (namespace)');

  // v0.3.0: embedding_model column
  sqlite.exec('ALTER TABLE memories ADD COLUMN embedding_model text');

  // v0.4.0: webhooks table
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

  sqlite.close();
}

/**
 * Builds a database reflecting a genuine pre-v0.2.0 (v0.1.0) schema: NO
 * `namespace` column on ANY table, NO `embedding_model`, and NO `webhooks`
 * table — nothing past what shipped in the very first release. Opening this
 * through the adapter must run the entire incremental chain — v0.2.0 through
 * v0.5.0 — in one connection.
 */
function createV010Db(dbPath: string): void {
  const sqlite = new Database(dbPath);
  applyV010Schema(sqlite);
  sqlite.close();
}

function tableInfo(dbPath: string, table: string): unknown[] {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    return sqlite.prepare(`PRAGMA table_info(${table})`).all();
  } finally {
    sqlite.close();
  }
}

function tableExists(dbPath: string, table: string): boolean {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    const row = sqlite
      .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name=?")
      .get(table) as { cnt: number };
    return row.cnt > 0;
  } finally {
    sqlite.close();
  }
}

function columnNames(dbPath: string, table: string): string[] {
  return (tableInfo(dbPath, table) as Array<{ name: string }>).map((c) => c.name);
}

function indexColumns(dbPath: string, index: string): string[] | null {
  const sqlite = new Database(dbPath);
  try {
    const exists = sqlite
      .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='index' AND name=?")
      .get(index) as { cnt: number };
    if (exists.cnt === 0) return null;
    return (sqlite.prepare(`PRAGMA index_info(${JSON.stringify(index)})`).all() as Array<{
      name: string;
    }>).map((c) => c.name);
  } finally {
    sqlite.close();
  }
}

// ─── 1. Fresh database ──────────────────────────────────────────────────────

describe('v0.5.0 migration — fresh database', () => {
  let dbPath: string;

  afterEach(() => {
    closeDatabase();
    cleanupTestDb(dbPath);
  });

  it('creates every new column and both new tables', () => {
    dbPath = tempDbPath('fresh');
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
    closeDatabase();

    expect(columnNames(dbPath, 'memories')).toContain('device_id');
    expect(columnNames(dbPath, 'memory_connections')).toEqual(
      expect.arrayContaining(['updated_at', 'deleted_at', 'device_id'])
    );
    expect(columnNames(dbPath, 'sessions')).toEqual(
      expect.arrayContaining(['updated_at', 'deleted_at', 'device_id'])
    );

    expect(tableExists(dbPath, 'local_meta')).toBe(true);
    expect(tableExists(dbPath, 'sync_state')).toBe(true);
    expect(columnNames(dbPath, 'local_meta')).toEqual(['key', 'value']);
    expect(columnNames(dbPath, 'sync_state')).toEqual([
      'id',
      'device_id',
      'pull_cursor',
      'last_push_at',
      'last_sync_at',
      'last_error',
      'embedding_model',
      'created_at',
    ]);
  });
});

// ─── 2. Upgrade path ────────────────────────────────────────────────────────

describe('v0.5.0 migration — upgrade path', () => {
  let dbPath: string;

  afterEach(() => {
    closeDatabase();
    cleanupTestDb(dbPath);
  });

  it('adds every new column and table to a pre-v0.5.0 database', () => {
    dbPath = tempDbPath('upgrade');
    createV040Db(dbPath);

    // Confirm the new columns/tables genuinely don't exist yet.
    expect(columnNames(dbPath, 'memories')).not.toContain('device_id');
    expect(tableExists(dbPath, 'local_meta')).toBe(false);
    expect(tableExists(dbPath, 'sync_state')).toBe(false);

    // Opening through the adapter runs runSqliteMigrations, including v0.5.0.
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
    closeDatabase();

    expect(columnNames(dbPath, 'memories')).toContain('device_id');
    expect(columnNames(dbPath, 'memory_connections')).toEqual(
      expect.arrayContaining(['updated_at', 'deleted_at', 'device_id'])
    );
    expect(columnNames(dbPath, 'sessions')).toEqual(
      expect.arrayContaining(['updated_at', 'deleted_at', 'device_id'])
    );
    expect(tableExists(dbPath, 'local_meta')).toBe(true);
    expect(tableExists(dbPath, 'sync_state')).toBe(true);
  });
});


// ─── 2c. Sync push index ────────────────────────────────────────────────────
//
// The sync push query filters on `device_id` and pages on `(updated_at, id)`.
// The column ORDER is load-bearing, not cosmetic: leading with `device_id`
// lets SQLite seek straight into this device's own rows, while a two-column
// `(updated_at, id)` index makes it abandon the OR optimization for a full
// index scan. Assert the exact order so a well-meaning "simplification"
// can't silently regress it.

describe('v0.5.0 migration — sync push index', () => {
  let dbPath: string;

  afterEach(() => {
    closeDatabase();
    cleanupTestDb(dbPath);
  });

  const EXPECTED = ['device_id', 'updated_at', 'id'];

  it('creates the composite push index on all three synced tables in a fresh database', () => {
    dbPath = tempDbPath('push-index-fresh');
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
    closeDatabase();

    expect(indexColumns(dbPath, 'idx_memories_sync_push')).toEqual(EXPECTED);
    expect(indexColumns(dbPath, 'idx_connections_sync_push')).toEqual(EXPECTED);
    expect(indexColumns(dbPath, 'idx_sessions_sync_push')).toEqual(EXPECTED);
  });

  it('adds the composite push index to a pre-v0.5.0 database on open', () => {
    dbPath = tempDbPath('push-index-upgrade');
    createV040Db(dbPath);
    expect(indexColumns(dbPath, 'idx_memories_sync_push')).toBeNull();

    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
    closeDatabase();

    expect(indexColumns(dbPath, 'idx_memories_sync_push')).toEqual(EXPECTED);
    expect(indexColumns(dbPath, 'idx_connections_sync_push')).toEqual(EXPECTED);
    expect(indexColumns(dbPath, 'idx_sessions_sync_push')).toEqual(EXPECTED);
  });

  it('is the index SQLite actually picks for the push query', () => {
    dbPath = tempDbPath('push-index-plan');
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
    closeDatabase();

    const sqlite = new Database(dbPath);
    try {
      const plan = (
        sqlite
          .prepare(
            `EXPLAIN QUERY PLAN
             SELECT * FROM memories
             WHERE (device_id IS NULL OR device_id = ?)
               AND (updated_at > ? OR (updated_at = ? AND id > ?))
             ORDER BY updated_at, id LIMIT 500`
          )
          .all('dev', 'ts', 'ts', 'id') as Array<{ detail: string }>
      )
        .map((r) => r.detail)
        .join(' | ');
      expect(plan).toContain('idx_memories_sync_push');
    } finally {
      sqlite.close();
    }
  });
});

// ─── 2b. True v0.1.0 baseline ──────────────────────────────────────────────
//
// Section 2 only reconstructs v0.4.0 (namespace + embedding_model + webhooks
// already applied). Nothing above exercises a genuinely pre-v0.2.0 database —
// one with NO namespace columns, NO embedding_model, and NO webhooks table —
// through the ENTIRE incremental chain (v0.2.0 → v0.5.0) in a single
// connection open. This closes that gap.

describe('v0.5.0 migration — true v0.1.0 baseline through the full incremental chain', () => {
  let dbPath: string;
  let freshPath: string;

  afterEach(() => {
    closeDatabase();
    cleanupTestDb(dbPath);
    cleanupTestDb(freshPath);
  });

  it('upgrades a v0.1.0 database (no namespace/embedding_model/webhooks at all) to match a fresh database exactly', () => {
    dbPath = tempDbPath('v010-baseline');
    createV010Db(dbPath);

    // Confirm this reconstruction is genuinely pre-v0.2.0: no namespace
    // anywhere, no embedding_model, no webhooks table.
    expect(columnNames(dbPath, 'memories')).not.toContain('namespace');
    expect(columnNames(dbPath, 'memories')).not.toContain('embedding_model');
    expect(columnNames(dbPath, 'sessions')).not.toContain('namespace');
    expect(columnNames(dbPath, 'context_assemblies')).not.toContain('namespace');
    expect(tableExists(dbPath, 'webhooks')).toBe(false);
    expect(tableExists(dbPath, 'local_meta')).toBe(false);
    expect(tableExists(dbPath, 'sync_state')).toBe(false);

    // Opening through the adapter must run v0.2.0, v0.3.0, v0.4.0, and
    // v0.5.0 in sequence, all in this one connection open.
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
    closeDatabase();

    expect(columnNames(dbPath, 'memories')).toEqual(
      expect.arrayContaining(['namespace', 'embedding_model', 'device_id'])
    );
    expect(columnNames(dbPath, 'sessions')).toEqual(
      expect.arrayContaining(['namespace', 'updated_at', 'deleted_at', 'device_id'])
    );
    expect(columnNames(dbPath, 'context_assemblies')).toContain('namespace');
    expect(columnNames(dbPath, 'memory_connections')).toEqual(
      expect.arrayContaining(['updated_at', 'deleted_at', 'device_id'])
    );
    expect(tableExists(dbPath, 'webhooks')).toBe(true);
    expect(tableExists(dbPath, 'local_meta')).toBe(true);
    expect(tableExists(dbPath, 'sync_state')).toBe(true);

    // The real guardrail: byte-identical PRAGMA table_info against a fresh
    // database, for every table — same comparison as section 3, applied to
    // the true baseline instead of the v0.4.0 reconstruction.
    freshPath = tempDbPath('v010-baseline-fresh');
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: freshPath });
    closeDatabase();

    for (const table of ALL_TABLES) {
      const freshInfo = tableInfo(freshPath, table);
      const upgradedInfo = tableInfo(dbPath, table);
      expect(upgradedInfo, `table_info mismatch for "${table}"`).toEqual(freshInfo);
    }
  });
});

// ─── 3. Schema equivalence (fresh vs. upgraded) ────────────────────────────

describe('v0.5.0 migration — fresh vs. upgraded schema equivalence', () => {
  let freshPath: string;
  let upgradedPath: string;

  afterEach(() => {
    closeDatabase();
    cleanupTestDb(freshPath);
    cleanupTestDb(upgradedPath);
  });

  it('produces byte-identical PRAGMA table_info for every table', () => {
    freshPath = tempDbPath('equiv-fresh');
    upgradedPath = tempDbPath('equiv-upgraded');

    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: freshPath });
    closeDatabase();

    createV040Db(upgradedPath);
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: upgradedPath });
    closeDatabase();

    for (const table of ALL_TABLES) {
      const freshInfo = tableInfo(freshPath, table);
      const upgradedInfo = tableInfo(upgradedPath, table);
      expect(upgradedInfo, `table_info mismatch for "${table}"`).toEqual(freshInfo);
    }
  });
});

// ─── 4. Idempotency ─────────────────────────────────────────────────────────

describe('v0.5.0 migration — idempotency', () => {
  let dbPath: string;

  afterEach(() => {
    closeDatabase();
    cleanupTestDb(dbPath);
  });

  it('running the migration twice does not throw or duplicate columns/tables', () => {
    dbPath = tempDbPath('idempotent');
    createV040Db(dbPath);

    expect(() => getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath })).not.toThrow();
    closeDatabase();

    // Reopen the same file — forces runSqliteMigrations to run a second time.
    expect(() => getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath })).not.toThrow();
    closeDatabase();

    const memCols = columnNames(dbPath, 'memories');
    expect(memCols.filter((c) => c === 'device_id')).toHaveLength(1);

    const connCols = columnNames(dbPath, 'memory_connections');
    for (const col of ['updated_at', 'deleted_at', 'device_id']) {
      expect(connCols.filter((c) => c === col)).toHaveLength(1);
    }

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const localMetaCount = sqlite
        .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='local_meta'")
        .get() as { cnt: number };
      const syncStateCount = sqlite
        .prepare("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='table' AND name='sync_state'")
        .get() as { cnt: number };
      expect(localMetaCount.cnt).toBe(1);
      expect(syncStateCount.cnt).toBe(1);
    } finally {
      sqlite.close();
    }
  });
});

// ─── 5. getDeviceId ─────────────────────────────────────────────────────────

describe('getDeviceId', () => {
  let dbPath: string;

  afterEach(() => {
    closeDatabase();
    cleanupTestDb(dbPath);
    _resetMemoizedDeviceIdForTests();
  });

  it('generates a stable v4 UUID once, memoizes it, and persists it to local_meta', () => {
    dbPath = tempDbPath('device-id');
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });

    const id1 = getDeviceId();
    const id2 = getDeviceId();
    expect(id2).toBe(id1);
    expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);

    // Close and reopen the DB connection (new adapter singleton, same file).
    closeDatabase();
    getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
    const id3 = getDeviceId();
    expect(id3).toBe(id1);

    // Clear the in-process memo (simulating a fresh process) and confirm the
    // value is read back from disk rather than regenerated.
    _resetMemoizedDeviceIdForTests();
    const id4 = getDeviceId();
    expect(id4).toBe(id1);

    // Verify it was actually persisted to local_meta, independent of any
    // in-process cache.
    closeDatabase();
    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const row = sqlite.prepare("SELECT value FROM local_meta WHERE key = 'device_id'").get() as
        | { value: string }
        | undefined;
      expect(row?.value).toBe(id1);
    } finally {
      sqlite.close();
    }
  });

  it('generates different ids for different installations', () => {
    const dbPathA = tempDbPath('device-id-a');
    const dbPathB = tempDbPath('device-id-b');
    try {
      getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPathA });
      const idA = getDeviceId();

      closeDatabase();
      _resetMemoizedDeviceIdForTests();

      getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPathB });
      const idB = getDeviceId();

      expect(idB).not.toBe(idA);
    } finally {
      closeDatabase();
      cleanupTestDb(dbPathA);
      cleanupTestDb(dbPathB);
    }
  });
});
