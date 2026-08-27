/**
 * Database client — backwards-compatible wrapper over the adapter layer.
 *
 * getDb() and closeDb() maintain the same API as before.
 * Internally they delegate to the DatabaseAdapter, which uses SQLite as the
 * only supported primary backend.
 */

import { getDatabase, closeDatabase, getDialect, schema } from './adapter.js';
import type { DatabaseDialect, AdapterConfig, DatabaseConnection } from './adapter.js';

export type { Memory, NewMemory, MemoryType, RelationshipType, MemoryConnection, NewMemoryConnection, Session, NewSession, ContextAssembly, NewContextAssembly, Webhook, NewWebhook } from './schema.js';

// Re-export the drizzle type for backwards compat
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
type DrizzleDb = BetterSQLite3Database<typeof schema>;

/**
 * Get the drizzle ORM instance.
 *
 * @param dbPath Optional SQLite path (backwards compat).
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

/**
 * Force WAL checkpoint so the current connection sees external writes.
 * Safe to call any time — no-op if no connection exists.
 */
export function walCheckpoint(): void {
  try {
    const conn = getDatabase();
    conn.walCheckpoint();
  } catch {
    // No active connection — nothing to checkpoint
  }
}

/**
 * Counter that changes when another connection commits — see
 * DatabaseConnection.dataVersion. Returns null when unavailable (no
 * connection yet), which means "unknown", not "unchanged".
 */
export function getDataVersion(): number | null {
  try {
    return getDatabase().dataVersion();
  } catch {
    return null;
  }
}

export { schema, getDatabase, closeDatabase, getDialect };
export type { DatabaseDialect, AdapterConfig, DatabaseConnection };
