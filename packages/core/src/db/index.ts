/**
 * Database client — backwards-compatible wrapper over the adapter layer.
 *
 * getDb() and closeDb() maintain the same API as before.
 * Internally they delegate to the DatabaseAdapter which supports
 * both SQLite (default) and PostgreSQL (opt-in).
 */

import { getDatabase, closeDatabase, getDialect, schema } from './adapter.js';
import type { DatabaseDialect, AdapterConfig, DatabaseConnection } from './adapter.js';

export type { Memory, NewMemory, MemoryType, RelationshipType, MemoryConnection, NewMemoryConnection, Session, NewSession, ContextAssembly, NewContextAssembly, Webhook, NewWebhook } from './schema.js';

// Re-export the drizzle type for backwards compat
// Both SQLite and PostgreSQL drizzle instances expose the same query API
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
type DrizzleDb = BetterSQLite3Database<typeof schema>;

/**
 * Get the drizzle ORM instance.
 *
 * @param dbPath Optional SQLite path (backwards compat). Ignored in PostgreSQL mode.
 */
export function getDb(dbPath?: string): DrizzleDb {
  const conn = getDatabase(dbPath);
  return conn.db as DrizzleDb;
}

/**
 * Close the database connection.
 */
export function closeDb(): void {
  closeDatabase();
}

/**
 * Get the current database dialect.
 */
export function getDatabaseDialect(): DatabaseDialect {
  return getDialect();
}

/**
 * Get the full database connection with metadata.
 */
export function getDatabaseConnection(config?: AdapterConfig): DatabaseConnection {
  return getDatabase(config);
}

export { schema, getDatabase, closeDatabase, getDialect };
export type { DatabaseDialect, AdapterConfig, DatabaseConnection };
