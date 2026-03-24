/**
 * @engram/core — The Brain
 *
 * Main entry point. Create a NeuralBrain instance and use it to store
 * and recall memories from any AI system.
 */

export { NeuralBrain } from './NeuralBrain.js';
export type { BrainConfig, StoreInput, StoreResult, SearchOptions, EmbeddingStatus, ReEmbedProgress, IndexStatus, TagInfo, Collection } from './NeuralBrain.js';

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

// Embedder
export {
  embed, embedBatch, packFP16, unpackFP16, EMBEDDING_DIMENSION,
  getEmbeddingModelId, getModelDimension, switchEmbeddingModel, MODEL_DIMENSIONS,
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
} from './plugins/index.js';

// Webhooks
export { WebhookManager, ALL_EVENTS } from './webhooks/index.js';
export type { WebhookEvent, WebhookPayload, WebhookSubscription, WebhookDeliveryResult } from './webhooks/index.js';

// DB client
export { getDb, closeDb, schema, getDatabaseDialect, getDatabaseConnection } from './db/index.js';
export type { DatabaseDialect, AdapterConfig, DatabaseConnection } from './db/index.js';
