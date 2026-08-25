import { sql } from 'drizzle-orm';
import {
  blob,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ─── memories ────────────────────────────────────────────────────────────────
// Unified storage for all 3 memory types: episodic, semantic, procedural

export const memories = sqliteTable(
  'memories',
  {
    id: text('id').primaryKey(),
    type: text('type', { enum: ['episodic', 'semantic', 'procedural'] }).notNull(),
    content: text('content').notNull(),
    summary: text('summary'),

    // Vector embedding (FP16-packed Float32[dim])
    embedding: blob('embedding', { mode: 'buffer' }),
    embeddingDim: integer('embedding_dim').default(384).notNull(),
    embeddingModel: text('embedding_model'),  // model ID that generated this embedding

    // Importance & confidence scores (0.0–1.0)
    importance: real('importance').default(0.5).notNull(),
    confidence: real('confidence').default(1.0).notNull(),

    // Access tracking
    accessCount: integer('access_count').default(0).notNull(),
    lastAccessedAt: text('last_accessed_at'),

    // Episodic fields
    eventAt: text('event_at'),
    sessionId: text('session_id'),
    source: text('source'), // 'claude-code' | 'ollama' | custom client id

    // Semantic fields
    concept: text('concept'), // main concept label

    // Procedural fields
    triggerPattern: text('trigger_pattern'),
    actionPattern: text('action_pattern'),

    // Namespace isolation (optional — null means shared pool)
    namespace: text('namespace'),

    // Common
    metadata: text('metadata').default('{}').notNull(),
    tags: text('tags').default('[]').notNull(),

    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    updatedAt: text('updated_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    archivedAt: text('archived_at'), // soft delete

    // Multi-device sync (Phase 0 foundation — not yet populated by write paths)
    deviceId: text('device_id'), // device that last wrote this row (LWW tie-breaking)
  },
  (t) => ({
    typeIdx: index('idx_memories_type').on(t.type),
    sourceIdx: index('idx_memories_source').on(t.source),
    importanceIdx: index('idx_memories_importance').on(t.importance),
    sessionIdx: index('idx_memories_session').on(t.sessionId),
    conceptIdx: index('idx_memories_concept').on(t.concept),
    archivedIdx: index('idx_memories_archived').on(t.archivedAt),
    namespaceIdx: index('idx_memories_namespace').on(t.namespace),
    updatedAtIdx: index('idx_memories_updated_at').on(t.updatedAt), // sync push query: WHERE updated_at > cursor
  })
);

// ─── memory_connections ───────────────────────────────────────────────────────
// Knowledge graph edges between memories

export const memoryConnections = sqliteTable(
  'memory_connections',
  {
    id: text('id').primaryKey(),
    sourceId: text('source_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    targetId: text('target_id')
      .notNull()
      .references(() => memories.id, { onDelete: 'cascade' }),
    relationship: text('relationship', {
      enum: ['is_a', 'has_property', 'causes', 'relates_to', 'contradicts', 'part_of', 'follows'],
    }).notNull(),
    strength: real('strength').default(1.0).notNull(),
    bidirectional: integer('bidirectional', { mode: 'boolean' }).default(false).notNull(),
    metadata: text('metadata').default('{}').notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),

    // Multi-device sync (Phase 0 foundation — not yet populated by write paths)
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'), // tombstone — hard deletes can't be tracked across sync replicas
    deviceId: text('device_id'),
  },
  (t) => ({
    sourceIdx: index('idx_connections_source').on(t.sourceId),
    targetIdx: index('idx_connections_target').on(t.targetId),
    relIdx: index('idx_connections_relationship').on(t.relationship),
    uniquePair: uniqueIndex('idx_connections_unique_pair').on(
      t.sourceId,
      t.targetId,
      t.relationship
    ),
    deletedIdx: index('idx_connections_deleted_at').on(t.deletedAt),
    updatedIdx: index('idx_connections_updated_at').on(t.updatedAt),
  })
);

// ─── sessions ─────────────────────────────────────────────────────────────────
// Groups episodic memories by interaction/conversation

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    source: text('source').notNull(), // which system created this session
    context: text('context'), // session context/metadata (JSON)
    namespace: text('namespace'),
    startedAt: text('started_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    endedAt: text('ended_at'),

    // Multi-device sync (Phase 0 foundation — not yet populated by write paths)
    updatedAt: text('updated_at'),
    deletedAt: text('deleted_at'), // tombstone
    deviceId: text('device_id'),
  },
  (t) => ({
    sourceIdx: index('idx_sessions_source').on(t.source),
    startedIdx: index('idx_sessions_started').on(t.startedAt),
    namespaceIdx: index('idx_sessions_namespace').on(t.namespace),
    deletedIdx: index('idx_sessions_deleted_at').on(t.deletedAt),
  })
);

// ─── context_assemblies ───────────────────────────────────────────────────────
// Log of working memory assemblies (what context was retrieved for each query)

export const contextAssemblies = sqliteTable(
  'context_assemblies',
  {
    id: text('id').primaryKey(),
    query: text('query').notNull(),
    queryEmbedding: blob('query_embedding', { mode: 'buffer' }),
    assembledContext: text('assembled_context').notNull(), // JSON: [{memoryId, score, type}]
    source: text('source'),
    sessionId: text('session_id'),
    namespace: text('namespace'),
    latencyMs: integer('latency_ms'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => ({
    sourceIdx: index('idx_assemblies_source').on(t.source),
    sessionIdx: index('idx_assemblies_session').on(t.sessionId),
    namespaceIdx: index('idx_assemblies_namespace').on(t.namespace),
    createdIdx: index('idx_assemblies_created').on(t.createdAt),
  })
);

// ─── webhooks ────────────────────────────────────────────────────────────────
// HTTP callback subscriptions for memory events

export const webhooks = sqliteTable(
  'webhooks',
  {
    id: text('id').primaryKey(),
    url: text('url').notNull(),
    secret: text('secret'),  // optional shared secret for HMAC signing
    events: text('events').notNull(),  // JSON array: ["stored","forgotten","decayed","consolidated","contradiction"]
    active: integer('active', { mode: 'boolean' }).default(true).notNull(),
    description: text('description'),
    metadata: text('metadata').default('{}').notNull(),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    lastTriggeredAt: text('last_triggered_at'),
    failCount: integer('fail_count').default(0).notNull(),
  },
  (t) => ({
    activeIdx: index('idx_webhooks_active').on(t.active),
  })
);

// ─── local_meta ────────────────────────────────────────────────────────────────
// Device-local key/value store. Never synced — holds things like device_id
// that must stay unique per physical installation (see sync/deviceId.ts).

export const localMeta = sqliteTable('local_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ─── sync_state ──────────────────────────────────────────────────────────────
// One row per configured sync target (a Postgres URL). Bookkeeping for the
// (future) SyncEngine — never synced itself.

export const syncState = sqliteTable('sync_state', {
  id: text('id').primaryKey(), // sha256 of the normalized sync URL
  deviceId: text('device_id').notNull(),
  pullCursor: text('pull_cursor'), // server_updated_at of the last accepted row
  lastPushAt: text('last_push_at'),
  lastSyncAt: text('last_sync_at'),
  lastError: text('last_error'),
  embeddingModel: text('embedding_model'), // guards against incompatible embeddings
  createdAt: text('created_at').notNull(),
});

// ─── Type exports ─────────────────────────────────────────────────────────────

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;
export type MemoryType = 'episodic' | 'semantic' | 'procedural';
export type RelationshipType =
  | 'is_a'
  | 'has_property'
  | 'causes'
  | 'relates_to'
  | 'contradicts'
  | 'part_of'
  | 'follows';

export type MemoryConnection = typeof memoryConnections.$inferSelect;
export type NewMemoryConnection = typeof memoryConnections.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type ContextAssembly = typeof contextAssemblies.$inferSelect;
export type NewContextAssembly = typeof contextAssemblies.$inferInsert;

export type Webhook = typeof webhooks.$inferSelect;
export type NewWebhook = typeof webhooks.$inferInsert;

export type LocalMeta = typeof localMeta.$inferSelect;
export type NewLocalMeta = typeof localMeta.$inferInsert;

export type SyncState = typeof syncState.$inferSelect;
export type NewSyncState = typeof syncState.$inferInsert;
