/**
 * Applies the Postgres sync schema migrations (drizzle-kit generated SQL
 * under ./migrations, see drizzle.pg.config.ts) and then recreates the
 * `server_updated_at` triggers that drizzle-kit itself can't express as
 * table/column/index DDL.
 *
 * Both steps run on every `createPgSyncConnection()` call, in every
 * process that connects — same lifecycle as `runSqliteMigrations` in
 * ../adapter.ts — so every statement here must stay idempotent and cheap
 * to no-op on repeat.
 *
 * `sync_metadata` used to be created here too, out of band, because the
 * drizzle snapshot didn't know about it. It is now part of the generated
 * migration set (see ./migrations/0001_square_the_professor.sql), so the
 * out-of-band CREATE is gone: two descriptions of one table is exactly the
 * drift this module kept re-introducing. The 0001 SQL is hand-edited to say
 * `CREATE TABLE IF NOT EXISTS`, which is what makes it safe on the databases
 * that already got the table the old way — that comment is load-bearing, not
 * decoration.
 *
 * The `server_updated_at` triggers stay out of band: drizzle-kit cannot
 * express a trigger, so there is nothing to converge them with.
 *
 * Neither this module nor its imports touch the `pg` package at load
 * time: `drizzle-orm/migrator` only reads the generated SQL files.
 * `db` and `pool` arrive pre-constructed from `./connection.ts`, which is
 * the only place that dynamically imports `pg`.
 */

import path from 'node:path';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import type { Pool, PoolClient } from 'pg';
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
  _db: NodePgDatabase<typeof pgSchema>,
  pool: Pool
): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    // A transaction-scoped lock also works through transaction poolers.
    // Drizzle's migrate() starts its own transaction after reading the journal.
    await client.query("SELECT pg_advisory_xact_lock(hashtext('engram.sync.migrations'))");
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
      await client.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)`);
      const journal = await client.query<{ created_at: string }>(
        'SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1'
      );
      const lastMigration = journal.rows[0];
      for (const migration of readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER })) {
        if (lastMigration && migration.folderMillis <= Number(lastMigration.created_at)) continue;
        for (const statement of migration.sql) await client.query(statement);
        await client.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)',
          [migration.hash, migration.folderMillis]);
      }
    } catch (err) {
      throw new Error(
        `PostgreSQL sync migration failed while applying migrations from "${MIGRATIONS_FOLDER}": ${errorMessage(err)}`
      );
    }
    await createServerUpdatedAtTriggers(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * `CREATE OR REPLACE FUNCTION` plus one `DROP TRIGGER IF EXISTS` /
 * `CREATE TRIGGER` pair per synced table. The pairs run in one transaction
 * on one client so concurrent writes cannot miss the timestamp trigger.
 */
async function createServerUpdatedAtTriggers(client: PoolClient): Promise<void> {
  try {
    await client.query(`
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
      // Transactional DROP + CREATE also supports PostgreSQL 12 and 13.
      await client.query(`DROP TRIGGER IF EXISTS ${triggerName} ON ${table};`);
      await client.query(`
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
