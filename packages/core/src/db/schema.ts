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
    source: text('source'), // 'claude-code' | 'ollama' | 'openclaw' | ...

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
  },
  (t) => ({
    typeIdx: index('idx_memories_type').on(t.type),
    sourceIdx: index('idx_memories_source').on(t.source),
    importanceIdx: index('idx_memories_importance').on(t.importance),
    sessionIdx: index('idx_memories_session').on(t.sessionId),
    conceptIdx: index('idx_memories_concept').on(t.concept),
    archivedIdx: index('idx_memories_archived').on(t.archivedAt),
    namespaceIdx: index('idx_memories_namespace').on(t.namespace),
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
    startedAt: text('started_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    endedAt: text('ended_at'),
  },
  (t) => ({
    sourceIdx: index('idx_sessions_source').on(t.source),
    startedIdx: index('idx_sessions_started').on(t.startedAt),
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
    latencyMs: integer('latency_ms'),
    createdAt: text('created_at')
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
  },
  (t) => ({
    sourceIdx: index('idx_assemblies_source').on(t.source),
    sessionIdx: index('idx_assemblies_session').on(t.sessionId),
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
