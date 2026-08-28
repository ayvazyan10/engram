/**
 * PostgreSQL sync schema — mirrors the synced subset of the SQLite schema
 * (see `../schema.ts`) for the multi-device SyncEngine (Phase 2).
 *
 * This is NOT the primary application schema. `NeuralBrain` and all engine
 * code keep running on SQLite; nothing here is wired into the core query
 * paths. These tables exist purely as the shared replication target that a
 * future `SyncEngine` pushes to / pulls from.
 *
 * Column names are kept byte-for-byte identical to the SQLite schema's DB
 * column names (snake_case) so sync can do straightforward row copying
 * without a translation layer. Two tables are intentionally NOT mirrored
 * here: `context_assemblies` (local recall audit log, no cross-device
 * value) and `webhooks` (bound to one machine). `local_meta` and
 * `sync_state` are local-only bookkeeping and never synced either.
 *
 * Every mirrored table adds one column beyond its SQLite counterpart:
 * `server_updated_at`, a Postgres-clock timestamp that the sync pull query
 * cursors on. It is distinct from `updated_at` (the device's own clock,
 * used for last-write-wins conflict resolution) specifically to avoid any
 * dependency on clock sync between devices — see `../pg/migrate.ts` for
 * the trigger that maintains it.
 */

import {
  boolean,
  customType,
  index,
  integer,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ─── custom types ──────────────────────────────────────────────────────────

/**
 * BYTEA column mapped to/from Node's `Buffer`. The `pg` driver already
 * returns bytea values as `Buffer` and accepts `Buffer` on write, so no
 * `toDriver`/`fromDriver` mapping functions are needed here — this just
 * gives Drizzle the right SQL type and TS type.
 */
const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ─── memories ────────────────────────────────────────────────────────────────
// Mirrors SQLite's `memories` table (see ../schema.ts).

export const pgMemories = pgTable(
  'memories',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['episodic', 'semantic', 'procedural'] }).notNull(),
    content: text('content').notNull(),
    summary: text('summary'),

    // Vector embedding (FP16-packed Float32[dim]), byte-identical to the
    // SQLite blob.
    embedding: bytea('embedding'),
    embeddingDim: integer('embedding_dim').default(384).notNull(),
    embeddingModel: text('embedding_model'),

    importance: real('importance').default(0.5).notNull(),
    confidence: real('confidence').default(1.0).notNull(),

    accessCount: integer('access_count').default(0).notNull(),
    lastAccessedAt: text('last_accessed_at'),

    eventAt: text('event_at'),
    sessionId: text('session_id'),
    source: text('source'),

    concept: text('concept'),

    triggerPattern: text('trigger_pattern'),
    actionPattern: text('action_pattern'),

    namespace: text('namespace'),

    metadata: text('metadata').default('{}').notNull(),
    tags: text('tags').default('[]').notNull(),

    // Device clocks, copied verbatim from the SQLite row that produced
    // them — never defaulted here, sync always supplies these explicitly.
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at'),

    deviceId: text('device_id'),

    // Postgres clock — the sync pull cursor. Maintained by the
    // `engram_touch_server_updated_at` trigger (see ./migrate.ts), never
    // written directly by clients.
    serverUpdatedAt: timestamp('server_updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    serverUpdatedIdx: index('idx_pg_memories_server_updated_at').on(t.serverUpdatedAt),
    namespaceIdx: index('idx_pg_memories_namespace').on(t.namespace),
  })
);

export type PgMemory = typeof pgMemories.$inferSelect;
export type NewPgMemory = typeof pgMemories.$inferInsert;

// ─── memory_connections ───────────────────────────────────────────────────────
// Mirrors SQLite's `memory_connections` table.

export const pgMemoryConnections = pgTable(
  'memory_connections',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => pgMemories.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => pgMemories.id, { onDelete: 'cascade' }),
    relationship: text('relationship', {
      enum: ['is_a', 'has_property', 'causes', 'relates_to', 'contradicts', 'part_of', 'follows'],
    }).notNull(),
    strength: real('strength').default(1.0).notNull(),
    bidirectional: boolean('bidirectional').default(false).notNull(),
    metadata: text('metadata').default('{}').notNull(),
    createdAt: text('created_at').notNull(),

    // Tombstone — hard deletes on a SQLite replica can't otherwise be
    // detected by peers.
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    deviceId: text('device_id'),

    serverUpdatedAt: timestamp('server_updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniquePair: uniqueIndex('idx_pg_connections_unique_pair').on(
      t.sourceId,
      t.targetId,
      t.relationship
    ),
    // Not requested explicitly, but the same pull-cursor query
    // (`WHERE server_updated_at > :cursor`) runs against this table too —
    // an unindexed scan here would defeat the purpose of the memories index.
    serverUpdatedIdx: index('idx_pg_connections_server_updated_at').on(t.serverUpdatedAt),
  })
);

export type PgMemoryConnection = typeof pgMemoryConnections.$inferSelect;
export type NewPgMemoryConnection = typeof pgMemoryConnections.$inferInsert;

// ─── sessions ─────────────────────────────────────────────────────────────────
// Mirrors SQLite's `sessions` table.

export const pgSessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(),
    context: text('context'),
    namespace: text('namespace'),
    startedAt: text('started_at').notNull(),
    endedAt: text('ended_at'),

    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'),
    deviceId: text('device_id'),

    serverUpdatedAt: timestamp('server_updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    serverUpdatedIdx: index('idx_pg_sessions_server_updated_at').on(t.serverUpdatedAt),
  })
);

export type PgSession = typeof pgSessions.$inferSelect;
export type NewPgSession = typeof pgSessions.$inferInsert;

// ─── sync_metadata ──────────────────────────────────────────────────────────

/**
 * Key-value metadata for the sync database — stores the encryption salt
 * and sentinel used by E2E encryption (Phase 6).
 */
export const pgSyncMetadata = pgTable('sync_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type PgSyncMetadata = typeof pgSyncMetadata.$inferSelect;
export type NewPgSyncMetadata = typeof pgSyncMetadata.$inferInsert;
