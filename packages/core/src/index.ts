/**
 * @engram/core — The Brain
 *
 * Main entry point. Create a NeuralBrain instance and use it to store
 * and recall memories from any AI system.
 */

export { NeuralBrain } from './NeuralBrain.js';
export type { BrainConfig, StoreInput, SearchOptions } from './NeuralBrain.js';

// Memory type classes
export { EpisodicMemory } from './memory/EpisodicMemory.js';
export { SemanticMemory } from './memory/SemanticMemory.js';
export { ProceduralMemory } from './memory/ProceduralMemory.js';

// Retrieval
export { ContextAssembler } from './retrieval/ContextAssembler.js';
export type { RecallOptions, RecallResult, RecalledMemory } from './retrieval/ContextAssembler.js';
export { VectorSearch } from './retrieval/VectorSearch.js';
export { scoreMemory, computeImportanceAfterAccess, decayImportance } from './retrieval/ImportanceScorer.js';

// Graph
export { KnowledgeGraph } from './graph/KnowledgeGraph.js';

// Embedder
export { embed, embedBatch, packFP16, unpackFP16, EMBEDDING_DIMENSION } from './embedding/Embedder.js';

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

// DB client
export { getDb, closeDb, schema } from './db/index.js';
