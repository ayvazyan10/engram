/**
 * @engram-ai-memory/core — The Brain
 *
 * Main entry point. Create a NeuralBrain instance and use it to store
 * and recall memories from any AI system.
 */

export { NeuralBrain } from './NeuralBrain.js';
export type { BrainConfig, NamespaceMode, StoreInput, StoreResult, SearchOptions, SearchHit, EmbeddingStatus, ReEmbedProgress, IndexStatus, TagInfo, Collection } from './NeuralBrain.js';

// Memory type classes
export { EpisodicMemory } from './memory/EpisodicMemory.js';
export { SemanticMemory } from './memory/SemanticMemory.js';
export { ProceduralMemory } from './memory/ProceduralMemory.js';

// Retrieval
export { ContextAssembler } from './retrieval/ContextAssembler.js';
export type { RecallOptions, RecallResult, RecalledMemory, RecallChunk, RecallStreamComplete, RecallPhase } from './retrieval/ContextAssembler.js';
export { VectorSearch } from './retrieval/VectorSearch.js';
export {
  scoreMemory,
  computeImportanceAfterAccess,
  decayImportance,
  recencyScore,
  computeRetentionScore,
} from './retrieval/ImportanceScorer.js';
export type { RetentionInput } from './retrieval/ImportanceScorer.js';

// Lifecycle (decay & garbage collection)
export { DecayEngine } from './lifecycle/DecayEngine.js';
export type { DecaySweepResult } from './lifecycle/DecayEngine.js';
export { DEFAULT_DECAY_POLICY, DEFAULT_PROTECTION_RULES, mergePolicy } from './lifecycle/DecayPolicy.js';
export type { DecayPolicyConfig, ConsolidationConfig, ProtectionRule } from './lifecycle/DecayPolicy.js';

// Environment configuration — the one place blank/NaN/unknown-enum are decided
export {
  EnvConfigError,
  readEnvString,
  requireConfiguredEnv,
  readEnvNumber,
  readEnvNumberOr,
  readEnvEnum,
} from './lifecycle/envConfig.js';
export type { EnvSource, EnvNumberSpec } from './lifecycle/envConfig.js';

// Contradiction detection
export { ContradictionDetector, DEFAULT_CONTRADICTION_CONFIG } from './lifecycle/ContradictionDetector.js';
export type {
  Contradiction,
  ContradictionSignal,
  ContradictionCheckResult,
  ContradictionConfig,
  ResolutionStrategy,
} from './lifecycle/ContradictionDetector.js';

// Graph
export { KnowledgeGraph } from './graph/KnowledgeGraph.js';
export { upsertConnection, upsertConnections } from './graph/connectionStore.js';

// Embedder
export {
  embed, embedBatch, packFP16, unpackFP16, EMBEDDING_DIMENSION,
  getEmbeddingModelId, getModelDimension, getEmbeddingDimension, switchEmbeddingModel, MODEL_DIMENSIONS,
} from './embedding/Embedder.js';

// DB types
export type {
  Memory,
  NewMemory,
  MemoryType,
  RelationshipType,
  MemoryConnection,
  Session,
  ContextAssembly,
} from './db/schema.js';

// Plugins
export { PluginRegistry } from './plugins/index.js';
export type {
  EngramPlugin, PluginHooks, PluginInfo,
  StoreHookContext, RecallHookContext, ForgetHookContext,
  DecayHookContext, StartupHookContext, ShutdownHookContext,
  ReflectHookContext,
} from './plugins/index.js';

// Webhooks
export { WebhookManager, ALL_EVENTS } from './webhooks/index.js';
export { assertSafeWebhookUrl, isPrivateAddress, UnsafeWebhookUrlError } from './webhooks/urlGuard.js';
export type { HostResolver, UrlGuardOptions } from './webhooks/urlGuard.js';
export type { WebhookEvent, WebhookPayload, WebhookSubscription, WebhookDeliveryResult } from './webhooks/index.js';

// Reflection
export { ReflectionEngine, DEFAULT_REFLECTION_CONFIG } from './reflection/index.js';
export type {
  ReflectionType,
  ReflectionConfig,
  ReflectionResult,
  ReflectionTask,
  ReflectionStats,
  ReflectionStatus,
} from './reflection/index.js';

// DB client
export { getDb, closeDb, schema, getDatabaseDialect, getDatabaseConnection } from './db/index.js';
export type { DatabaseDialect, AdapterConfig, DatabaseConnection } from './db/index.js';

// Sync (multi-device) — Phase 0 foundation
export { getDeviceId, resetDeviceId } from './sync/deviceId.js';

// Sync — Postgres replication target (Phase 1)
export {
  pgMemories, pgMemoryConnections, pgSessions,
  createPgSyncConnection, validateSyncUrl, redactSyncUrl,
  runPgSyncMigrations,
} from './db/pg/index.js';
export type {
  PgMemory, NewPgMemory,
  PgMemoryConnection, NewPgMemoryConnection,
  PgSession, NewPgSession,
  PgSyncConnection,
} from './db/pg/index.js';

// Sync — Engine (Phase 2)
export { SyncEngine, PgSyncClient, computeSyncId, compareLWW, shouldApplyPulledRow } from './sync/index.js';
export type {
  SyncConfig, SyncStatus, SyncResult,
  MergeResult, CursorState,
  PushBatch, PullBatch, PgSyncClientOptions,
} from './sync/index.js';

// Sync — End-to-end encryption (Phase 3)
export { EncryptionManager, EncryptionError, isEncrypted } from './sync/index.js';
export type { EncryptableRow } from './sync/index.js';
