/**
 * Barrel export for the Postgres sync module. Consumed by the future
 * SyncEngine (Phase 2) — nothing in `NeuralBrain` or the core query paths
 * imports from here.
 */

export { pgMemories, pgMemoryConnections, pgSessions } from './schema.js';
export type {
  PgMemory,
  NewPgMemory,
  PgMemoryConnection,
  NewPgMemoryConnection,
  PgSession,
  NewPgSession,
} from './schema.js';

export { createPgSyncConnection, validateSyncUrl, redactSyncUrl } from './connection.js';
export type { PgSyncConnection } from './connection.js';

export { runPgSyncMigrations } from './migrate.js';
