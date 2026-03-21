/**
 * NeuralBrain — unified API for storing and recalling memories.
 *
 * This is the primary class that integration adapters (MCP, REST, Ollama, OpenClaw)
 * should instantiate and use.
 *
 * Usage:
 *   const brain = new NeuralBrain();
 *   await brain.initialize();
 *   await brain.store({ content: "User prefers TypeScript", type: "semantic" });
 *   const ctx = await brain.recall("what language does the user prefer?");
 */

import { and, eq, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { closeDb, getDb, schema } from './db/index.js';
import type { Memory, MemoryType, NewMemory, NewSession, RelationshipType } from './db/schema.js';
import { EMBEDDING_DIMENSION, embed, packFP16, unpackFP16 } from './embedding/Embedder.js';
import { KnowledgeGraph } from './graph/KnowledgeGraph.js';
import { EpisodicMemory } from './memory/EpisodicMemory.js';
import { ProceduralMemory } from './memory/ProceduralMemory.js';
import { SemanticMemory } from './memory/SemanticMemory.js';
import { ContextAssembler } from './retrieval/ContextAssembler.js';
import type { RecallOptions, RecallResult } from './retrieval/ContextAssembler.js';
import { VectorSearch } from './retrieval/VectorSearch.js';

export interface BrainConfig {
  /** Path to SQLite database file. Defaults to ./neuralcore.db */
  dbPath?: string;
  /** Default source tag for stored memories */
  defaultSource?: string;
}

export interface StoreInput {
  content: string;
  type?: MemoryType;
  source?: string;
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  importance?: number;
  /** For episodic: when the event occurred */
  eventAt?: Date;
  /** For semantic: concept label */
  concept?: string;
  /** For procedural: trigger condition */
  triggerPattern?: string;
  /** For procedural: action to take */
  actionPattern?: string;
}

export interface SearchOptions {
  topK?: number;
  threshold?: number;
  types?: MemoryType[];
  sources?: string[];
}

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  bySource: Record<string, number>;
  indexSize: number;
  graphNodes: number;
  graphEdges: number;
}

export class NeuralBrain {
  private config: BrainConfig;
  private vectorSearch: VectorSearch;
  private graph: KnowledgeGraph;
  private assembler: ContextAssembler;

  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly procedural: ProceduralMemory;

  private initialized = false;

  constructor(config: BrainConfig = {}) {
    this.config = config;
    this.vectorSearch = new VectorSearch(EMBEDDING_DIMENSION);
    this.graph = new KnowledgeGraph();
    this.assembler = new ContextAssembler(this.vectorSearch, this.graph);
    this.episodic = new EpisodicMemory();
    this.semantic = new SemanticMemory();
    this.procedural = new ProceduralMemory();
  }

  /**
   * Initialize the brain: connect to DB, load vector index and graph.
   * Must be called before any other method.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    const db = getDb(this.config.dbPath);

    // Load all non-archived memories into vector index
    const allMemories = await db
      .select()
      .from(schema.memories)
      .where(isNull(schema.memories.archivedAt));

    for (const memory of allMemories) {
      if (memory.embedding) {
        const vec = unpackFP16(Buffer.from(memory.embedding as ArrayBuffer));
        this.vectorSearch.upsert({
          id: memory.id,
          vector: vec,
          type: memory.type as MemoryType,
        });
      }

      this.graph.addNode({
        id: memory.id,
        type: memory.type as MemoryType,
        concept: memory.concept ?? undefined,
      });
    }

    // Load all edges into graph
    const allConnections = await db.select().from(schema.memoryConnections);
    for (const conn of allConnections) {
      this.graph.addEdge({
        sourceId: conn.sourceId,
        targetId: conn.targetId,
        relationship: conn.relationship as RelationshipType,
        strength: conn.strength,
        bidirectional: Boolean(conn.bidirectional),
      });
    }

    this.initialized = true;
  }

  /**
   * Store a new memory.
   */
  async store(input: StoreInput): Promise<Memory> {
    this.assertInitialized();

    const db = getDb();
    const type = input.type ?? 'episodic';
    const source = input.source ?? this.config.defaultSource ?? null;
    const now = new Date().toISOString();

    const embedding = await embed(input.content);
    const embeddingBuf = packFP16(embedding);

    const record: NewMemory = {
      id: uuidv4(),
      type,
      content: input.content,
      concept: input.concept ?? null,
      triggerPattern: input.triggerPattern ?? null,
      actionPattern: input.actionPattern ?? null,
      embedding: embeddingBuf,
      embeddingDim: embedding.length,
      importance: input.importance ?? (type === 'semantic' ? 0.7 : 0.5),
      source,
      sessionId: input.sessionId ?? null,
      eventAt: (input.eventAt ?? new Date()).toISOString(),
      tags: JSON.stringify(input.tags ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.memories).values(record);

    // Update in-memory index
    this.vectorSearch.upsert({ id: record.id!, vector: embedding, type });
    this.graph.addNode({ id: record.id!, type, concept: record.concept ?? undefined });

    const [inserted] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, record.id!))
      .limit(1);

    return inserted!;
  }

  /**
   * Recall the most relevant context for a query.
   * Returns a formatted string ready to inject into an AI prompt.
   */
  async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    this.assertInitialized();
    return this.assembler.recall(query, options);
  }

  /**
   * Semantic search across memories.
   */
  async search(query: string, options: SearchOptions = {}): Promise<Memory[]> {
    this.assertInitialized();

    const queryVec = await embed(query);
    const results = this.vectorSearch.search(
      queryVec,
      options.topK ?? 10,
      options.threshold ?? 0.3,
      options.types
    );

    const db = getDb();
    const memories: Memory[] = [];

    for (const result of results) {
      const [m] = await db
        .select()
        .from(schema.memories)
        .where(and(eq(schema.memories.id, result.id), isNull(schema.memories.archivedAt)))
        .limit(1);

      if (!m) continue;
      if (options.sources && m.source && !options.sources.includes(m.source)) continue;
      memories.push(m);
    }

    return memories;
  }

  /**
   * Archive (soft-delete) a memory by ID.
   */
  async forget(id: string): Promise<void> {
    this.assertInitialized();
    const db = getDb();
    await db
      .update(schema.memories)
      .set({ archivedAt: new Date().toISOString() })
      .where(eq(schema.memories.id, id));

    this.vectorSearch.remove(id);
    this.graph.removeNode(id);
  }

  /**
   * Create a new session.
   */
  async createSession(source: string, context?: Record<string, unknown>): Promise<string> {
    const db = getDb();
    const session: NewSession = {
      id: uuidv4(),
      source,
      context: context ? JSON.stringify(context) : null,
    };
    await db.insert(schema.sessions).values(session);
    return session.id;
  }

  /**
   * End a session.
   */
  async endSession(sessionId: string): Promise<void> {
    const db = getDb();
    await db
      .update(schema.sessions)
      .set({ endedAt: new Date().toISOString() })
      .where(eq(schema.sessions.id, sessionId));
  }

  /**
   * Get statistics about the brain's current state.
   */
  async stats(): Promise<MemoryStats> {
    this.assertInitialized();
    const db = getDb();

    const all = await db
      .select()
      .from(schema.memories)
      .where(isNull(schema.memories.archivedAt));

    const byType: Record<MemoryType, number> = { episodic: 0, semantic: 0, procedural: 0 };
    const bySource: Record<string, number> = {};

    for (const m of all) {
      byType[m.type as MemoryType]++;
      if (m.source) {
        bySource[m.source] = (bySource[m.source] ?? 0) + 1;
      }
    }

    return {
      total: all.length,
      byType,
      bySource,
      indexSize: this.vectorSearch.size,
      graphNodes: this.graph.nodeCount,
      graphEdges: this.graph.edgeCount,
    };
  }

  /** Gracefully shut down (close DB connection). */
  shutdown(): void {
    closeDb();
    this.initialized = false;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('NeuralBrain not initialized. Call brain.initialize() first.');
    }
  }
}
