/**
 * PostgreSQL sync connection — manages the (optional) connection pool used
 * by the future SyncEngine (Phase 2) to replicate data between local
 * SQLite and a shared Postgres database.
 *
 * `pg` is an optionalDependency of this package (see package.json): a
 * plain SQLite-only install never touches it. Both `pg` itself and
 * `drizzle-orm/node-postgres` — which requires `pg` at module load, so it
 * can't be imported statically either — are loaded via dynamic `import()`,
 * deferred until a caller actually asks to connect. Only *type* imports
 * from either module appear at the top of this file; those are erased by
 * the compiler and never touch the filesystem at runtime.
 */

import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool as PgPool } from 'pg';
import * as pgSchema from './schema.js';
import { runPgSyncMigrations } from './migrate.js';

export interface PgSyncConnection {
  db: NodePgDatabase<typeof pgSchema>;
  pool: PgPool;
  close(): Promise<void>;
}

const SSL_MODE_PATTERN = /[?&]sslmode=/i;

/**
 * Redacts the password portion of a Postgres connection string so it is
 * safe to include in logs and error messages. Falls back to a generic
 * placeholder — never the raw input — if the string can't be parsed as a
 * URL, since an unparseable string might itself be (or contain) the secret.
 */
export function redactSyncUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.password) {
      parsed.password = '***';
    }
    return parsed.toString();
  } catch {
    return '<unparseable-connection-string>';
  }
}

/**
 * Validates a sync connection string before it is ever used to open a
 * connection. Throws with a clear, actionable, password-free message on
 * any failure. Called by `createPgSyncConnection`, but also exported so
 * callers (e.g. `engram cloud connect`) can validate user input eagerly.
 */
export function validateSyncUrl(url: string): void {
  if (!url || url.trim().length === 0) {
    throw new Error(
      'ENGRAM_SYNC_URL is missing or empty. Cloud sync needs a PostgreSQL connection string, ' +
        'e.g. postgres://user:pass@host:5432/dbname?sslmode=require'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      'ENGRAM_SYNC_URL is not a valid URL. It must be a postgres:// or postgresql:// connection string.'
    );
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(
      `ENGRAM_SYNC_URL must use the postgres:// or postgresql:// scheme, got "${parsed.protocol}" ` +
        `(${redactSyncUrl(url)})`
    );
  }

  if (process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] === 'true') {
    return;
  }

  if (parsed.searchParams.get('sslmode') !== 'require') {
    throw new Error(
      [
        'ENGRAM_SYNC_URL must require TLS (add "?sslmode=require") — cloud sync sends memory',
        'content to a shared Postgres database, so encryption is mandatory by default.',
        'Set ENGRAM_SYNC_ALLOW_UNENCRYPTED=true to opt out (e.g. a trusted local Postgres).',
        `URL: ${redactSyncUrl(url)}`,
      ].join(' ')
    );
  }
}

/**
 * Appends `sslmode=require` to `url` if it isn't already present, unless
 * ENGRAM_SYNC_ALLOW_UNENCRYPTED=true. A convenience default, not a
 * substitute for `validateSyncUrl` — it just saves the common "forgot
 * sslmode" case from failing validation outright.
 */
function withDefaultSslMode(url: string): string {
  if (!url || process.env['ENGRAM_SYNC_ALLOW_UNENCRYPTED'] === 'true') {
    return url;
  }
  if (SSL_MODE_PATTERN.test(url)) {
    return url;
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}sslmode=require`;
}

/**
 * Opens a connection pool to the sync Postgres database, runs migrations,
 * and returns a ready-to-use PgSyncConnection.
 *
 * Connections are intentionally scarce (`max: 2`): managed free-tier
 * Postgres offerings (Neon, Supabase, Railway, ...) hand out very few
 * connections, and the sync engine only ever needs one or two at a time.
 */
export async function createPgSyncConnection(url: string): Promise<PgSyncConnection> {
  const connectionString = withDefaultSslMode(url);
  validateSyncUrl(connectionString);

  let pg: typeof import('pg');
  try {
    pg = await import('pg');
  } catch {
    throw new Error('Cloud sync requires the "pg" package. Install it: pnpm add pg');
  }
  const { Pool } = pg;

  const pool = new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
  });

  // node-postgres pools emit 'error' for problems on an already-idle
  // client (e.g. the server dropped the connection); without a listener
  // those crash the whole process as an unhandled 'error' event.
  pool.on('error', (err) => {
    console.error(`[engram] PostgreSQL sync pool error: ${(err as Error).message}`);
  });

  const { drizzle } = await import('drizzle-orm/node-postgres');
  // The dynamically-imported `drizzle-orm/node-postgres` module resolves to
  // a structurally-identical but nominally distinct `NodePgDatabase` type
  // from the one obtained via the static `import type` above (TS resolves
  // the same package under different module resolution modes for dynamic
  // vs. type-only imports), which trips the `dialect` protected-member
  // check even though this is the exact same class at runtime. `unknown`
  // is the documented escape hatch for that specific mismatch.
  const db = drizzle(pool, { schema: pgSchema }) as unknown as NodePgDatabase<typeof pgSchema>;

  try {
    await runPgSyncMigrations(db, pool);
  } catch (err) {
    await pool.end().catch(() => {});
    throw err;
  }

  return {
    db,
    pool,
    close: async () => {
      await pool.end();
    },
  };
}
