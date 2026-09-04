/**
 * Parity guard between the two descriptions of the SQLite schema.
 *
 * There are two, and only one of them runs in production:
 *
 *  - `runSqliteMigrations()` in ../adapter.ts — the RUNTIME source of truth.
 *    Every process that opens the database runs it; it is what actually
 *    creates and upgrades tables on a user's machine.
 *  - `../schema.ts` + the drizzle-kit output in `../migrations/` — TOOLING
 *    only. Nothing at runtime applies those migrations (the sole
 *    `migrationsFolder` caller in this package is `db/pg/migrate.ts`, and it
 *    points at the Postgres folder), and they are not even published:
 *    package.json ships `files: ["dist"]` and the build copies only
 *    `src/db/pg/migrations` into `dist`.
 *
 * Because the tooling half never runs, it drifted for four releases without
 * anyone noticing: the committed snapshot was missing `device_id`,
 * `embedding_model`, `namespace` on `memories`, the sync columns on
 * `memory_connections`/`sessions`, and the `webhooks`, `local_meta` and
 * `sync_state` tables entirely. Type inference (`typeof memories.$inferSelect`
 * and friends) is derived from `schema.ts`, so a silent divergence there is a
 * lie the compiler happily believes.
 *
 * This suite makes the divergence impossible to reintroduce quietly: it
 * builds one database each way and compares them.
 *
 * Compared as SETS, not sequences. Column ORDER legitimately differs — the
 * runtime path appends columns via `ALTER TABLE` in the order history added
 * them, while drizzle emits them in declaration order — and that difference
 * is not a defect. Order IS asserted, strictly, by migration-v050.test.ts,
 * which compares two RUNTIME-built databases (fresh vs. upgraded) where
 * identical order is genuinely required.
 */

import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { getDatabaseConnection, closeDatabase } from '../index.js';
import { cleanupTestDb } from '../../test-helpers/cleanupTestDb.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.join(__dirname, '..', 'migrations');

/** Bookkeeping tables that exist in one path by construction, never both. */
const NOT_PART_OF_THE_SCHEMA = new Set(['__drizzle_migrations']);


/**
 * Primary keys that `runSqliteMigrations` declares without `NOT NULL` while
 * drizzle-kit always emits it. See the "NULLABLE PRIMARY KEYS" note in
 * `../adapter.ts` for why these cannot simply be tightened.
 *
 * Deliberately an explicit list, not a blanket "ignore notnull on any pk":
 * a NEW primary key that diverges still fails here. If adapter.ts is ever
 * tightened to declare these NOT NULL, both sides read 1 and this list can
 * simply be deleted.
 */
const PK_NOTNULL_DIVERGENCES = new Set([
  'webhooks.id',
  'local_meta.key',
  'sync_state.id',
]);

interface ColumnShape {
  name: string;
  type: string;
  notnull: number;
  pk: number;
  dflt: string | null;
}

/**
 * A default value comparable across the two paths.
 *
 * SQLite stores the literal DEFAULT text and hands it back verbatim, so two
 * spellings of one value read as different strings: drizzle writes
 * `CURRENT_TIMESTAMP` where the runtime DDL writes `(CURRENT_TIMESTAMP)`, and
 * drizzle writes the `true`/`false` keywords where the runtime DDL writes
 * `1`/`0`. Both pairs are the same value to SQLite (TRUE/FALSE have been
 * aliases for 1/0 since 3.23). Normalising them is not a weakening — a real
 * difference in the default still fails.
 */
function normalizeDefault(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let value = String(raw).trim();
  while (value.startsWith('(') && value.endsWith(')')) {
    value = value.slice(1, -1).trim();
  }
  const lowered = value.toLowerCase();
  if (lowered === 'true') return '1';
  if (lowered === 'false') return '0';
  return value;
}

function withDb<T>(dbPath: string, fn: (sqlite: Database.Database) => T): T {
  const sqlite = new Database(dbPath, { readonly: true });
  try {
    return fn(sqlite);
  } finally {
    sqlite.close();
  }
}

/** Table names, sorted, excluding sqlite internals and drizzle bookkeeping. */
function tableNames(dbPath: string): string[] {
  return withDb(dbPath, (sqlite) =>
    (
      sqlite
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as Array<{ name: string }>
    )
      .map((r) => r.name)
      .filter((n) => !NOT_PART_OF_THE_SCHEMA.has(n))
  );
}

/** Columns of `table` as a name-sorted set of comparable shapes. */
function columnShapes(dbPath: string, table: string): ColumnShape[] {
  return withDb(dbPath, (sqlite) =>
    (
      sqlite.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all() as Array<{
        name: string;
        type: string;
        notnull: number;
        pk: number;
        dflt_value: unknown;
      }>
    )
      .map((c) => ({
        name: c.name,
        type: c.type.toUpperCase(),
        notnull: PK_NOTNULL_DIVERGENCES.has(`${table}.${c.name}`) ? 1 : c.notnull,
        pk: c.pk,
        dflt: normalizeDefault(c.dflt_value),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  );
}

/**
 * Index names, sorted. `sqlite_autoindex_*` is excluded: SQLite invents those
 * for PRIMARY KEY / UNIQUE constraints and numbers them by creation order, so
 * their names carry no schema intent.
 */
function indexNames(dbPath: string): string[] {
  return withDb(dbPath, (sqlite) =>
    (
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
        .all() as Array<{ name: string }>
    )
      .map((r) => r.name)
      .filter((n) => !n.startsWith('sqlite_autoindex_') && !NOT_PART_OF_THE_SCHEMA.has(n))
  );
}

// ─── the two build paths ────────────────────────────────────────────────────

/** DB A — built by applying the checked-in drizzle-kit migrations. */
function buildFromDrizzleMigrations(dbPath: string): void {
  // Required at call time, matching ../adapter.ts: better-sqlite3 is a native
  // addon and drizzle's migrator pulls it in transitively.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle } = require('drizzle-orm/better-sqlite3');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { migrate } = require('drizzle-orm/better-sqlite3/migrator');

  const sqlite = new Database(dbPath);
  try {
    migrate(drizzle(sqlite), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    sqlite.close();
  }
}

/** DB B — built by the runtime path, i.e. `runSqliteMigrations`. */
function buildFromRuntimeMigrations(dbPath: string): void {
  getDatabaseConnection({ dialect: 'sqlite', sqlitePath: dbPath });
  closeDatabase();
}

function tempDbPath(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-schema-parity-'));
  return path.join(dir, `${label}.db`);
}

// ─── suite ──────────────────────────────────────────────────────────────────

describe('SQLite schema parity — drizzle migrations vs. runSqliteMigrations', () => {
  let drizzlePath = '';
  let runtimePath = '';

  afterEach(() => {
    closeDatabase();
    cleanupTestDb(drizzlePath);
    cleanupTestDb(runtimePath);
  });

  function buildBoth(): void {
    drizzlePath = tempDbPath('drizzle');
    runtimePath = tempDbPath('runtime');
    buildFromDrizzleMigrations(drizzlePath);
    buildFromRuntimeMigrations(runtimePath);
  }

  it('creates the same set of tables', () => {
    buildBoth();
    expect(tableNames(drizzlePath)).toEqual(tableNames(runtimePath));
  });

  it('creates the same columns, with the same type, nullability, primary key and default', () => {
    buildBoth();

    // Every table in ONE assertion: a per-table loop stops at the first
    // mismatch and hides the rest, which turns reconciling real drift into a
    // fix-run-repeat grind.
    const shapesByTable = (dbPath: string): Record<string, ColumnShape[]> =>
      Object.fromEntries(tableNames(dbPath).map((t) => [t, columnShapes(dbPath, t)]));

    expect(shapesByTable(drizzlePath)).toEqual(shapesByTable(runtimePath));
  });

  it('creates the same set of named indexes', () => {
    buildBoth();
    expect(indexNames(drizzlePath)).toEqual(indexNames(runtimePath));
  });
});
