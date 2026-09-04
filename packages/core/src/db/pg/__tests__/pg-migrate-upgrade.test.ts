/**
 * Upgrade tests for `runPgSyncMigrations` against a sync database that was
 * written by an EARLIER release — not a fresh one.
 *
 * The trap this file exists to catch: `sync_metadata` used to be created out
 * of band by `createSyncMetadataTable()` in ../migrate.ts, with
 * `CREATE TABLE IF NOT EXISTS`, while the drizzle snapshot knew nothing
 * about it. The moment the table entered the generated migration set,
 * drizzle-kit emitted a plain `CREATE TABLE "sync_metadata"` (drizzle-kit
 * never emits IF NOT EXISTS), and `migrate()` — which runs BEFORE any of the
 * out-of-band DDL — hit `relation "sync_metadata" already exists` on every
 * database that had ever connected with an older build. That is the
 * `applies the new migration to a database that already has an out-of-band
 * sync_metadata` case below.
 *
 * "Written by an earlier release" is reconstructed honestly rather than by
 * hand-forging drizzle bookkeeping: the migrator is run against a temp copy
 * of the real migrations folder whose journal has been truncated to `0000`,
 * then the old out-of-band DDL is applied verbatim. That produces exactly the
 * `__drizzle_migrations` contents a released build leaves behind, hash and
 * all.
 *
 * Needs a real PostgreSQL — same availability rules as the sibling
 * pg-roundtrip suite (`TEST_PG_URL`, else Docker, else skip). Each run gets
 * its own throwaway database so nothing here can collide with a suite
 * running in a parallel worker.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool as PgPool } from 'pg';

import { runPgSyncMigrations } from '../migrate.js';
import * as pgSchema from '../schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.join(__dirname, '..', 'migrations');

/** The exact DDL the old `createSyncMetadataTable()` ran on every connect. */
const LEGACY_SYNC_METADATA_DDL = `
  CREATE TABLE IF NOT EXISTS sync_metadata (
    key            TEXT PRIMARY KEY,
    value          TEXT NOT NULL,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
  );
`;

// ─── availability ───────────────────────────────────────────────────────────

const BASE_PG_URL =
  process.env['TEST_PG_URL'] ??
  'postgres://postgres:engram_test_pass@localhost:5432/engram_test?sslmode=disable';
const SKIP_REQUESTED = Boolean(process.env['SKIP_PG_TESTS']);

let pgAvailable = false;
try {
  const { Pool } = await import('pg');
  const admin = new Pool({ connectionString: BASE_PG_URL, connectionTimeoutMillis: 3000 });
  await admin.query('SELECT 1');
  await admin.end();
  pgAvailable = true;
} catch {
  // unavailable — the suite skips below
}

const shouldRun = !SKIP_REQUESTED && pgAvailable;
const describeWithPg = shouldRun ? describe : describe.skip;

if (!shouldRun) {
  console.info(
    `[pg-migrate-upgrade.test.ts] skipping: ${
      SKIP_REQUESTED ? 'SKIP_PG_TESTS is set' : `PostgreSQL is unavailable at ${BASE_PG_URL}`
    }`
  );
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** `url` with its database name swapped for `name`. */
function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

interface RawConnection {
  db: NodePgDatabase<typeof pgSchema>;
  pool: PgPool;
}

/**
 * A pool + drizzle handle that has NOT run any migration — unlike
 * `createPgSyncConnection`, which migrates on open and would therefore
 * destroy the "old release" state these tests need to construct.
 */
async function openRaw(url: string): Promise<RawConnection> {
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 10000 });
  pool.on('error', () => {
    /* a dropped idle client must not crash the test process */
  });
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const db = drizzle(pool, { schema: pgSchema }) as unknown as NodePgDatabase<typeof pgSchema>;
  return { db, pool };
}

/**
 * A copy of the real migrations folder whose journal stops at `0000`, so the
 * migrator applies exactly what the previous release applied. Returns the
 * temp folder path; the caller deletes it.
 */
function migrationsFolderTruncatedTo0000(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engram-pg-migrations-0000-'));
  fs.cpSync(MIGRATIONS_FOLDER, dir, { recursive: true });

  const journalPath = path.join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(fs.readFileSync(journalPath, 'utf-8')) as {
    entries: Array<{ idx: number }>;
  };
  const truncated = { ...journal, entries: journal.entries.filter((e) => e.idx === 0) };
  fs.writeFileSync(journalPath, JSON.stringify(truncated, null, 2));

  return dir;
}

/** Column names of `table`, as reported by Postgres itself. */
async function columnNames(pool: PgPool, table: string): Promise<string[]> {
  const { rows } = await pool.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1
      ORDER BY ordinal_position`,
    [table]
  );
  return rows.map((r) => r.column_name);
}

/** How many drizzle migrations this database has recorded as applied. */
async function appliedMigrationCount(pool: PgPool): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT count(*)::text AS count FROM drizzle.__drizzle_migrations'
  );
  return Number(rows[0]?.count ?? '0');
}

// ─── suite ──────────────────────────────────────────────────────────────────

describeWithPg('runPgSyncMigrations — upgrading a database written by an earlier release', () => {
  let dbName: string;
  let dbUrl: string;
  let conn: RawConnection;

  beforeAll(async () => {
    process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] = 'true';

    // Identifier is built here, never from input — only [a-z0-9_].
    dbName = `engram_pg_upgrade_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: BASE_PG_URL, connectionTimeoutMillis: 3000 });
    await admin.query(`CREATE DATABASE "${dbName}"`);
    await admin.end();

    dbUrl = withDatabase(BASE_PG_URL, dbName);
    conn = await openRaw(dbUrl);

    // ── reconstruct the previous release's on-disk state ──
    const legacyFolder = migrationsFolderTruncatedTo0000();
    try {
      const { migrate } = await import('drizzle-orm/node-postgres/migrator');
      await migrate(conn.db, { migrationsFolder: legacyFolder });
    } finally {
      fs.rmSync(legacyFolder, { recursive: true, force: true });
    }
    await conn.pool.query(LEGACY_SYNC_METADATA_DDL);
  }, 120000);

  afterAll(async () => {
    await conn?.pool.end().catch(() => {});
    const { Pool } = await import('pg');
    const admin = new Pool({ connectionString: BASE_PG_URL, connectionTimeoutMillis: 3000 });
    try {
      // FORCE (PG 13+) terminates any connection this suite failed to close.
      await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    } catch (err) {
      console.warn(`[pg-migrate-upgrade.test.ts] could not drop ${dbName}: ${String(err)}`);
    } finally {
      await admin.end();
    }
    delete process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'];
  });

  it('starts from the exact state an earlier release leaves: 0000 recorded, sync_metadata already present', async () => {
    expect(await appliedMigrationCount(conn.pool)).toBe(1);
    expect(await columnNames(conn.pool, 'sync_metadata')).toEqual([
      'key',
      'value',
      'created_at',
      'updated_at',
    ]);
  });

  it('applies the new migration to a database that already has an out-of-band sync_metadata', async () => {
    // Rows written before the upgrade must survive it — a CREATE that
    // "worked" by dropping and recreating the table would lose the
    // encryption salt and lock every device out of its own data.
    await conn.pool.query(
      `INSERT INTO sync_metadata (key, value) VALUES ('encryption_salt', 'pre-upgrade-salt')`
    );

    // Values written while the columns were still float4 are ALREADY narrowed
    // on disk; widening the column cannot recover what was rounded away. This
    // asserts that plainly rather than pretending the ALTER is a repair.
    const now = new Date().toISOString();
    await conn.pool.query(
      `INSERT INTO memories (id, type, content, importance, confidence, created_at, updated_at)
       VALUES ('legacy-float4', 'semantic', 'stored while importance was real', 0.123456789012345, 0.7, $1, $1)`,
      [now]
    );

    await expect(runPgSyncMigrations(conn.db, conn.pool)).resolves.toBeUndefined();

    expect(await appliedMigrationCount(conn.pool)).toBe(2);

    const { rows } = await conn.pool.query<{ value: string }>(
      `SELECT value FROM sync_metadata WHERE key = 'encryption_salt'`
    );
    expect(rows[0]?.value).toBe('pre-upgrade-salt');
  });

  it('widens importance/confidence/strength to double precision', async () => {
    const { rows } = await conn.pool.query<{ table_name: string; data_type: string }>(
      `SELECT table_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (   (table_name = 'memories' AND column_name IN ('importance', 'confidence'))
               OR (table_name = 'memory_connections' AND column_name = 'strength'))`
    );
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.data_type).toBe('double precision');
    }
  });

  it('leaves already-narrowed values narrowed — the ALTER widens the column, not the data', async () => {
    const { rows } = await conn.pool.query<{ importance: number }>(
      `SELECT importance FROM memories WHERE id = 'legacy-float4'`
    );
    // Rounded to float4 on the way in; the widened column just stores that
    // rounded double now. Only a re-push from a device restores full
    // precision.
    expect(rows[0]?.importance).not.toBe(0.123456789012345);
    expect(rows[0]?.importance).toBeCloseTo(0.123456789012345, 6);

    // A value written AFTER the upgrade keeps every digit.
    const now = new Date().toISOString();
    await conn.pool.query(
      `INSERT INTO memories (id, type, content, importance, confidence, created_at, updated_at)
       VALUES ('post-upgrade-float8', 'semantic', 'stored after the widening', 0.123456789012345, 0.7, $1, $1)`,
      [now]
    );
    const after = await conn.pool.query<{ importance: number }>(
      `SELECT importance FROM memories WHERE id = 'post-upgrade-float8'`
    );
    expect(after.rows[0]?.importance).toBe(0.123456789012345);
  });

  it('creates the S7 hot-path indexes', async () => {
    const { rows } = await conn.pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE schemaname = 'public'`
    );
    const names = rows.map((r) => r.indexname);
    expect(names).toContain('idx_pg_memories_device_id');
    expect(names).toContain('idx_pg_connections_target_id');
  });

  it('is idempotent: running it again on the upgraded database is a no-op', async () => {
    await expect(runPgSyncMigrations(conn.db, conn.pool)).resolves.toBeUndefined();
    expect(await appliedMigrationCount(conn.pool)).toBe(2);
  });
});
