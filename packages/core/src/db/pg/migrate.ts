/**
 * Applies the Postgres sync schema migrations (drizzle-kit generated SQL
 * under ./migrations, see drizzle.pg.config.ts) and then (re)creates the
 * `server_updated_at` triggers that drizzle-kit itself can't express as
 * table/column/index DDL.
 *
 * Both steps run on every `createPgSyncConnection()` call, in every
 * process that connects — same lifecycle as `runSqliteMigrations` in
 * ../adapter.ts — so every statement here must stay idempotent and cheap
 * to no-op on repeat.
 *
 * Neither this module nor its imports touch the `pg` package at load
 * time: `drizzle-orm/node-postgres/migrator` only reads SQL files and
 * drives `db.dialect.migrate(...)`, it never imports the driver itself.
 * `db` and `pool` arrive pre-constructed from `./connection.ts`, which is
 * the only place that dynamically imports `pg`.
 */

import path from 'node:path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import * as pgSchema from './schema.js';

const MIGRATIONS_FOLDER = path.join(__dirname, 'migrations');

/** Synced tables, one `server_updated_at` trigger each. */
const SYNCED_TABLES = ['memories', 'memory_connections', 'sessions'] as const;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Runs pending drizzle-kit migrations against `db`, then ensures the
 * `server_updated_at` trigger exists on every synced table. Throws with a
 * message that names what failed (migration run, trigger function, or a
 * specific table's trigger) — but never includes connection details, since
 * neither `db` nor `pool` carry the raw connection string by the time they
 * reach this function.
 */
export async function runPgSyncMigrations(
  db: NodePgDatabase<typeof pgSchema>,
  pool: Pool
): Promise<void> {
  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (err) {
    throw new Error(
      `PostgreSQL sync migration failed while applying migrations from "${MIGRATIONS_FOLDER}": ${errorMessage(err)}`
    );
  }

  await createServerUpdatedAtTriggers(pool);
  await createSyncMetadataTable(pool);
}

/**
 * `CREATE OR REPLACE FUNCTION` plus one `DROP TRIGGER IF EXISTS` /
 * `CREATE TRIGGER` pair per synced table. All idempotent, and each
 * statement runs as its own `pool.query()` call so a failure names exactly
 * which one broke instead of rolling back an implicit multi-statement
 * transaction silently.
 */
async function createServerUpdatedAtTriggers(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION engram_touch_server_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.server_updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
  } catch (err) {
    throw new Error(
      `PostgreSQL sync migration failed creating engram_touch_server_updated_at(): ${errorMessage(err)}`
    );
  }

  for (const table of SYNCED_TABLES) {
    const triggerName = `trg_${table}_server_updated_at`;
    try {
      // DROP + CREATE (rather than Postgres 14+'s CREATE OR REPLACE
      // TRIGGER) keeps this working on any supported Postgres version.
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table};`);
      await pool.query(`
        CREATE TRIGGER ${triggerName}
          BEFORE UPDATE ON ${table}
          FOR EACH ROW
          EXECUTE FUNCTION engram_touch_server_updated_at();
      `);
    } catch (err) {
      throw new Error(
        `PostgreSQL sync migration failed creating trigger "${triggerName}" on "${table}": ${errorMessage(err)}`
      );
    }
  }
}

/**
 * Creates the `sync_metadata` key-value table if it doesn't already exist.
 * Stores the encryption salt and sentinel used by E2E encryption (Phase 6).
 * Idempotent — this runs on every connect alongside the rest of this module.
 */
async function createSyncMetadataTable(pool: Pool): Promise<void> {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS sync_metadata (
        key            TEXT PRIMARY KEY,
        value          TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  } catch (err) {
    throw new Error(
      `PostgreSQL sync migration failed creating "sync_metadata" table: ${errorMessage(err)}`
    );
  }
}
