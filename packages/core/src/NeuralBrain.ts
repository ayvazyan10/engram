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

import fs from 'fs';
import { and, eq, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { closeDb, getDb, schema } from './db/index.js';
import type { Memory, MemoryType, NewMemory, NewMemoryConnection, NewSession, RelationshipType } from './db/schema.js';
import {
  EMBEDDING_DIMENSION, embed, embedBatch, packFP16, unpackFP16,
  getEmbeddingModelId, getModelDimension, switchEmbeddingModel,
} from './embedding/Embedder.js';
import { KnowledgeGraph } from './graph/KnowledgeGraph.js';
import { EpisodicMemory } from './memory/EpisodicMemory.js';
import { ProceduralMemory } from './memory/ProceduralMemory.js';
import { SemanticMemory } from './memory/SemanticMemory.js';
import { DecayEngine } from './lifecycle/DecayEngine.js';
import type { DecaySweepResult } from './lifecycle/DecayEngine.js';
import type { DecayPolicyConfig } from './lifecycle/DecayPolicy.js';
import { mergePolicy } from './lifecycle/DecayPolicy.js';
import { ContradictionDetector } from './lifecycle/ContradictionDetector.js';
import type {
  ContradictionCheckResult,
  ContradictionConfig,
  Contradiction,
  ResolutionStrategy,
} from './lifecycle/ContradictionDetector.js';
import { DEFAULT_CONTRADICTION_CONFIG } from './lifecycle/ContradictionDetector.js';
import { WebhookManager } from './webhooks/WebhookManager.js';
import type { WebhookEvent, WebhookSubscription, WebhookDeliveryResult } from './webhooks/WebhookManager.js';
import { PluginRegistry } from './plugins/PluginRegistry.js';
import type { EngramPlugin, PluginInfo } from './plugins/PluginRegistry.js';
import { ContextAssembler } from './retrieval/ContextAssembler.js';
import type { RecallOptions, RecallResult, RecallChunk, RecallStreamComplete } from './retrieval/ContextAssembler.js';
import { VectorSearch } from './retrieval/VectorSearch.js';

/**
 * Extract a short concept label (2–5 words) from memory content.
 * Simple heuristic: strips filler, takes the most distinctive phrase.
 */
function extractConcept(content: string): string | null {
  // Strip "User:" / "Assistant:" prefixes
  let text = content.replace(/^(User|Assistant):\s*/gi, '').trim();
  // If very short or just punctuation/emoji, skip
  if (text.length < 5 || !/[a-zA-Zа-яА-ЯёЁ]{3,}/.test(text)) return null;
  // Take first sentence or up to 60 chars
  const firstSentence = text.split(/[.!?\n]/)[0]?.trim() ?? text;
  const label = firstSentence.slice(0, 60).trim();
  // Truncate to ~5 words
  const words = label.split(/\s+/).slice(0, 5).join(' ');
  return words.length >= 3 ? words : null;
}

export interface BrainConfig {
  /** Path to SQLite database file. Defaults to ./engram.db */
  dbPath?: string;
  /** Default source tag for stored memories */
  defaultSource?: string;
  /** Memory decay and garbage collection policy */
  decayPolicy?: Partial<DecayPolicyConfig>;
  /** Optional namespace for memory isolation. When set, all operations are scoped to this namespace. */
  namespace?: string;
  /** Contradiction detection configuration */
  contradictionConfig?: Partial<ContradictionConfig>;
  /** Path to persist the vector index for fast startup. Defaults to {dbPath}.index */
  indexPath?: string;
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
  /** Override the brain's default namespace for this specific memory */
  namespace?: string;
}

export interface StoreResult {
  /** The stored memory */
  memory: Memory;
  /** Contradiction check results (empty if detection is disabled) */
  contradictions: ContradictionCheckResult;
}

export interface EmbeddingStatus {
  /** Currently active embedding model */
  currentModel: string;
  /** Dimension of the current model's embeddings */
  currentDimension: number;
  /** Total memories with embeddings */
  totalEmbedded: number;
  /** Memories embedded with the current model */
  currentModelCount: number;
  /** Memories embedded with a different (stale) model */
  staleCount: number;
  /** Memories with no model ID recorded (legacy) */
  legacyCount: number;
  /** Whether a re-embedding is needed */
  needsReEmbed: boolean;
}

export interface ReEmbedProgress {
  /** Total memories to re-embed */
  total: number;
  /** Memories processed so far */
  processed: number;
  /** Memories that failed to re-embed */
  failed: number;
  /** IDs that failed */
  failedIds: string[];
  /** Duration in milliseconds */
  durationMs: number;
}

export interface IndexStatus {
  /** How the index was loaded on last init */
  loadedFrom: 'disk' | 'database' | 'not_loaded';
  /** Number of entries in the vector index */
  entryCount: number;
  /** Embedding dimension */
  dimension: number;
  /** Path to the persisted index file (if configured) */
  indexPath: string | null;
  /** Whether a persisted index file exists on disk */
  indexFileExists: boolean;
  /** How many memories were added incrementally (0 if full rebuild) */
  incrementalCount: number;
  /** Init duration in milliseconds */
  initDurationMs: number;
}

export interface TagInfo {
  tag: string;
  count: number;
}

export interface Collection {
  name: string;
  prefix: string;
  tags: TagInfo[];
  totalMemories: number;
}

export interface SearchOptions {
  topK?: number;
  threshold?: number;
  types?: MemoryType[];
  sources?: string[];
  /** If true, search across all namespaces (only meaningful when brain has a namespace configured) */
  crossNamespace?: boolean;
}

export interface MemoryStats {
  total: number;
  byType: Record<MemoryType, number>;
  bySource: Record<string, number>;
  indexSize: number;
  graphNodes: number;
  graphEdges: number;
  /** Active namespace, or null for shared pool */
  namespace: string | null;
}

export class NeuralBrain {
  private config: BrainConfig;
  private vectorSearch: VectorSearch;
  private graph: KnowledgeGraph;
  private assembler: ContextAssembler;
  private decayEngine: DecayEngine;
  private contradictionDetector: ContradictionDetector;
  private webhookManager: WebhookManager;
  private pluginRegistry: PluginRegistry;

  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly procedural: ProceduralMemory;

  private initialized = false;
  private indexStatus: IndexStatus = {
    loadedFrom: 'not_loaded',
    entryCount: 0,
    dimension: EMBEDDING_DIMENSION,
    indexPath: null,
    indexFileExists: false,
    incrementalCount: 0,
    initDurationMs: 0,
  };

  constructor(config: BrainConfig = {}) {
    this.config = config;
    this.vectorSearch = new VectorSearch(EMBEDDING_DIMENSION);
    this.graph = new KnowledgeGraph();
    this.assembler = new ContextAssembler(this.vectorSearch, this.graph, config.namespace);
    this.decayEngine = new DecayEngine(mergePolicy(config.decayPolicy ?? {}));
    this.contradictionDetector = new ContradictionDetector(config.contradictionConfig ?? {});
    this.webhookManager = new WebhookManager();
    this.pluginRegistry = new PluginRegistry();
    this.episodic = new EpisodicMemory();
    this.semantic = new SemanticMemory();
    this.procedural = new ProceduralMemory();
  }

  /**
   * Initialize the brain: connect to DB, load vector index and graph.
   * Must be called before any other method.
   *
   * If a persisted index exists on disk, loads it and only adds new memories
   * incrementally. Otherwise, does a full rebuild from the database.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    const initStart = Date.now();

    const db = getDb(this.config.dbPath);
    const indexPath = this.resolveIndexPath();

    // Try loading persisted vector index from disk
    let cachedIds: Set<string> | null = null;
    if (indexPath) {
      this.indexStatus.indexPath = indexPath;
      this.indexStatus.indexFileExists = fs.existsSync(indexPath);

      if (this.indexStatus.indexFileExists) {
        try {
          const meta = this.vectorSearch.loadFromDisk(indexPath);
          if (meta) {
            cachedIds = meta.ids;
            this.indexStatus.loadedFrom = 'disk';
            this.indexStatus.entryCount = meta.entryCount;
          }
        } catch {
          // Corrupt or incompatible index — fall through to full rebuild
          cachedIds = null;
          this.vectorSearch.clear();
        }
      }
    }

    // Load all non-archived memories
    const allMemories = await db
      .select()
      .from(schema.memories)
      .where(isNull(schema.memories.archivedAt));

    let incrementalCount = 0;

    for (const memory of allMemories) {
      // Vector index: skip if already loaded from disk cache
      if (memory.embedding) {
        const alreadyCached = cachedIds?.has(memory.id) ?? false;
        if (!alreadyCached) {
          const vec = unpackFP16(Buffer.from(memory.embedding as ArrayBuffer));
          this.vectorSearch.upsert({
            id: memory.id,
            vector: vec,
            type: memory.type as MemoryType,
            namespace: memory.namespace ?? undefined,
          });
          incrementalCount++;
        }
      }

      // Graph always rebuilds (it's fast — just node/edge refs)
      this.graph.addNode({
        id: memory.id,
        type: memory.type as MemoryType,
        concept: memory.concept ?? undefined,
      });
    }

    // Remove entries from cache that no longer exist in DB (archived/deleted since last save)
    if (cachedIds) {
      const activeIds = new Set(allMemories.map((m) => m.id));
      for (const id of cachedIds) {
        if (!activeIds.has(id)) {
          this.vectorSearch.remove(id);
        }
      }
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

    // Update status
    if (!cachedIds) {
      this.indexStatus.loadedFrom = 'database';
    }
    this.indexStatus.entryCount = this.vectorSearch.size;
    this.indexStatus.incrementalCount = incrementalCount;
    this.indexStatus.initDurationMs = Date.now() - initStart;

    this.initialized = true;

    // Fire plugin onStartup hooks
    void this.pluginRegistry.runHook('onStartup', {
      entryCount: this.vectorSearch.size,
      loadedFrom: this.indexStatus.loadedFrom,
      initDurationMs: this.indexStatus.initDurationMs,
    });
  }

  /**
   * Store a new memory.
   */
  async store(input: StoreInput): Promise<StoreResult> {
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
      embeddingModel: getEmbeddingModelId(),
      importance: input.importance ?? (type === 'semantic' ? 0.7 : 0.5),
      source,
      sessionId: input.sessionId ?? null,
      eventAt: (input.eventAt ?? new Date()).toISOString(),
      namespace: input.namespace ?? this.config.namespace ?? null,
      tags: JSON.stringify(input.tags ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.memories).values(record);

    // Update in-memory index
    this.vectorSearch.upsert({ id: record.id!, vector: embedding, type, namespace: record.namespace });
    this.graph.addNode({ id: record.id!, type, concept: record.concept ?? undefined });

    // ── Auto-link: find similar memories and create graph edges ──
    // This builds the neural network organically — every new memory
    // connects to its most similar neighbors.
    try {
      const similar = this.vectorSearch.search(embedding, 4, 0.5);
      // Exclude self
      const neighbors = similar.filter((s) => s.id !== record.id);
      if (neighbors.length > 0) {
        const edges: NewMemoryConnection[] = neighbors.slice(0, 3).map((n) => ({
          id: uuidv4(),
          sourceId: record.id!,
          targetId: n.id,
          relationship: 'relates_to' as RelationshipType,
          strength: Math.round(n.similarity * 100) / 100,
          bidirectional: true,
          metadata: '{}',
          createdAt: now,
        }));

        await db.insert(schema.memoryConnections).values(edges);

        for (const edge of edges) {
          this.graph.addEdge({
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            relationship: edge.relationship as RelationshipType,
            strength: edge.strength ?? 1.0,
            bidirectional: true,
          });
        }
      }
    } catch {
      // Auto-link is best-effort — don't fail the store
    }

    // ── Auto-concept: extract a short topic label if none provided ──
    if (!record.concept) {
      try {
        const label = extractConcept(input.content);
        if (label) {
          record.concept = label;
          await db
            .update(schema.memories)
            .set({ concept: label, updatedAt: now })
            .where(eq(schema.memories.id, record.id!));
          this.graph.addNode({ id: record.id!, type, concept: label });
        }
      } catch {
        // Concept extraction is best-effort
      }
    }

    // ── Contradiction detection ──
    let contradictionResult: ContradictionCheckResult = {
      hasContradictions: false,
      contradictions: [],
      candidatesChecked: 0,
      latencyMs: 0,
    };

    try {
      contradictionResult = await this.contradictionDetector.check(
        input.content,
        embedding,
        record.id!,
        this.vectorSearch,
        record.namespace,
      );

      // Create 'contradicts' graph edges for detected contradictions
      if (contradictionResult.hasContradictions) {
        for (const c of contradictionResult.contradictions) {
          const edgeId = uuidv4();
          const edge: NewMemoryConnection = {
            id: edgeId,
            sourceId: c.newMemoryId,
            targetId: c.existingMemoryId,
            relationship: 'contradicts' as RelationshipType,
            strength: c.confidence,
            bidirectional: true,
            metadata: JSON.stringify({
              signals: c.signals.map((s) => s.type),
              suggestedStrategy: c.suggestedStrategy,
            }),
            createdAt: now,
          };

          await db.insert(schema.memoryConnections).values(edge);
          this.graph.addEdge({
            sourceId: edge.sourceId,
            targetId: edge.targetId,
            relationship: 'contradicts',
            strength: edge.strength ?? 1.0,
            bidirectional: true,
          });
        }

        // Auto-resolve if enabled
        if (this.contradictionDetector.getConfig().autoResolve) {
          await this.autoResolveContradictions(contradictionResult.contradictions, record.id!);
        }
      }
    } catch {
      // Contradiction detection is best-effort — don't fail the store
    }

    const [inserted] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, record.id!))
      .limit(1);

    // ── Fire webhooks ──
    this.webhookManager.fire('stored', {
      id: inserted!.id,
      type: inserted!.type,
      source: inserted!.source,
      importance: inserted!.importance,
    });

    if (contradictionResult.hasContradictions) {
      this.webhookManager.fire('contradiction', {
        memoryId: inserted!.id,
        contradictions: contradictionResult.contradictions.map((c) => ({
          existingMemoryId: c.existingMemoryId,
          confidence: c.confidence,
          suggestedStrategy: c.suggestedStrategy,
        })),
      });
    }

    // Fire plugin hooks
    void this.pluginRegistry.runHook('onStore', {
      memory: inserted!,
      contradictions: contradictionResult.contradictions.length,
    });

    return { memory: inserted!, contradictions: contradictionResult };
  }

  /**
   * Recall the most relevant context for a query.
   * Returns a formatted string ready to inject into an AI prompt.
   */
  async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    this.assertInitialized();
    const result = await this.assembler.recall(query, options);

    void this.pluginRegistry.runHook('onRecall', {
      query,
      memoriesUsed: result.memories.length,
      latencyMs: result.latencyMs,
      context: result.context,
    });

    return result;
  }

  /**
   * Streaming recall — yields memories progressively as they're found.
   * High-confidence vector results first, then graph-expanded neighbors, then final context.
   */
  async *recallStream(
    query: string,
    options?: RecallOptions
  ): AsyncGenerator<RecallChunk | RecallStreamComplete> {
    this.assertInitialized();
    yield* this.assembler.recallStream(query, options);
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
      options.types,
      this.config.namespace,
      options.crossNamespace
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
      // Namespace filtering (defense in depth — vector search already filters)
      if (this.config.namespace && !options.crossNamespace && m.namespace !== this.config.namespace) continue;
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

    this.webhookManager.fire('forgotten', { id });
    void this.pluginRegistry.runHook('onForget', { memoryId: id });
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

    const statsConditions = [isNull(schema.memories.archivedAt)];
    if (this.config.namespace) {
      statsConditions.push(eq(schema.memories.namespace, this.config.namespace));
    }

    const all = await db
      .select()
      .from(schema.memories)
      .where(and(...statsConditions));

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
      namespace: this.config.namespace ?? null,
    };
  }

  /**
   * Consolidate episodic memories into semantic summaries.
   *
   * Like sleep consolidation in the human brain: clusters of similar
   * episodic memories are merged into a single semantic fact. The
   * original episodes are archived (not deleted).
   *
   * @param minClusterSize Minimum episodes to form a cluster (default: 3)
   * @param threshold Similarity threshold for clustering (default: 0.6)
   * @returns Array of newly created semantic memories
   */
  async consolidate(minClusterSize = 3, threshold = 0.6): Promise<Memory[]> {
    this.assertInitialized();
    const db = getDb();

    // Get all episodic memories (scoped by namespace if configured)
    const consolidateConditions = [eq(schema.memories.type, 'episodic'), isNull(schema.memories.archivedAt)];
    if (this.config.namespace) {
      consolidateConditions.push(eq(schema.memories.namespace, this.config.namespace));
    }
    const episodes = await db
      .select()
      .from(schema.memories)
      .where(and(...consolidateConditions));

    if (episodes.length < minClusterSize) return [];

    // Cluster by vector similarity using greedy approach
    const used = new Set<string>();
    const clusters: Memory[][] = [];

    for (const ep of episodes) {
      if (used.has(ep.id)) continue;
      if (!ep.embedding) continue;

      const vec = unpackFP16(Buffer.from(ep.embedding as ArrayBuffer));
      const similar = this.vectorSearch.search(vec, 10, threshold, ['episodic']);
      const cluster = similar
        .filter((s) => !used.has(s.id) && s.id !== ep.id)
        .map((s) => episodes.find((e) => e.id === s.id)!)
        .filter(Boolean);

      cluster.unshift(ep);

      if (cluster.length >= minClusterSize) {
        for (const m of cluster) used.add(m.id);
        clusters.push(cluster);
      }
    }

    // For each cluster, create a semantic summary
    const results: Memory[] = [];

    for (const cluster of clusters) {
      // Build summary from cluster contents
      const contents = cluster.map((m) => m.content).join('\n');
      // Take the most common concept or first meaningful phrase
      const concepts = cluster.map((m) => m.concept).filter(Boolean);
      const concept = concepts[0] ?? extractConcept(contents) ?? 'Consolidated memory';

      // Average importance, slightly boosted (consolidation = importance)
      const avgImportance = cluster.reduce((s, m) => s + (m.importance ?? 0.5), 0) / cluster.length;
      const importance = Math.min(1, avgImportance + 0.1);

      // Summarize: keep unique lines, deduplicate
      const lines = contents.split('\n').filter((l) => l.trim().length > 5);
      const uniqueLines = [...new Set(lines)].slice(0, 10);
      const summary = uniqueLines.join('\n');

      // Store as semantic memory
      const { memory: semantic } = await this.store({
        content: summary,
        type: 'semantic',
        concept,
        importance,
        source: 'consolidation',
        tags: ['consolidated'],
        metadata: { episodeCount: cluster.length, episodeIds: cluster.map((m) => m.id) },
      });

      // Archive the original episodes
      for (const ep of cluster) {
        await this.forget(ep.id);
      }

      results.push(semantic);
    }

    if (results.length > 0) {
      this.webhookManager.fire('consolidated', {
        count: results.length,
        ids: results.map((m) => m.id),
      });
    }

    return results;
  }

  /**
   * Run a memory decay sweep — evaluate all memories and archive stale ones.
   * Optionally triggers auto-consolidation of old episodic memories.
   *
   * @param dryRun  If true, compute what would happen without modifying data
   */
  async runDecaySweep(dryRun = false): Promise<DecaySweepResult> {
    this.assertInitialized();

    const result = await this.decayEngine.sweep(
      (id) => this.forget(id),
      dryRun,
      this.config.namespace
    );

    // Auto-consolidation
    if (!dryRun) {
      const newIds = await this.decayEngine.autoConsolidate(
        async (minClusterSize, threshold) => {
          const consolidated = await this.consolidate(minClusterSize, threshold);
          return consolidated.map((m) => ({ id: m.id }));
        }
      );
      result.consolidatedCount = newIds.length;
      result.newSemanticIds = newIds;
    }

    if (result.archivedCount > 0 || result.consolidatedCount > 0) {
      this.webhookManager.fire('decayed', {
        scannedCount: result.scannedCount,
        archivedCount: result.archivedCount,
        decayedCount: result.decayedCount,
        consolidatedCount: result.consolidatedCount,
        durationMs: result.durationMs,
      });
    }

    void this.pluginRegistry.runHook('onDecay', {
      scannedCount: result.scannedCount,
      archivedCount: result.archivedCount,
      decayedCount: result.decayedCount,
      consolidatedCount: result.consolidatedCount,
      durationMs: result.durationMs,
    });

    return result;
  }

  /** Get the active namespace, or undefined for shared pool. */
  getNamespace(): string | undefined {
    return this.config.namespace;
  }

  /** Get the current decay policy configuration. */
  getDecayPolicy(): DecayPolicyConfig {
    return this.decayEngine.getPolicy();
  }

  /** Update the decay policy at runtime. */
  updateDecayPolicy(partial: Partial<DecayPolicyConfig>): void {
    const current = this.decayEngine.getPolicy();
    this.decayEngine.updatePolicy(mergePolicy({ ...current, ...partial }));
  }

  // ─── Tagging & Collections ───────────────────────────────────────────────

  /**
   * Get a tag cloud — all unique tags with their memory counts.
   */
  async getTags(): Promise<TagInfo[]> {
    this.assertInitialized();
    const db = getDb();

    const conditions = [isNull(schema.memories.archivedAt)];
    if (this.config.namespace) {
      conditions.push(eq(schema.memories.namespace, this.config.namespace));
    }

    const all = await db
      .select({ tags: schema.memories.tags })
      .from(schema.memories)
      .where(and(...conditions));

    const counts = new Map<string, number>();
    for (const row of all) {
      const tags: string[] = JSON.parse(row.tags);
      for (const tag of tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }

    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get all memories that have a specific tag.
   */
  async getByTag(tag: string, limit = 50, offset = 0): Promise<Memory[]> {
    this.assertInitialized();
    const db = getDb();

    const conditions = [isNull(schema.memories.archivedAt)];
    if (this.config.namespace) {
      conditions.push(eq(schema.memories.namespace, this.config.namespace));
    }

    const all = await db
      .select()
      .from(schema.memories)
      .where(and(...conditions));

    // Filter by tag in the JSON array
    const filtered = all.filter((m) => {
      const tags: string[] = JSON.parse(m.tags);
      return tags.includes(tag);
    });

    return filtered.slice(offset, offset + limit);
  }

  /**
   * Add a tag to a memory.
   */
  async addTag(memoryId: string, tag: string): Promise<string[]> {
    this.assertInitialized();
    const db = getDb();

    const [memory] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, memoryId))
      .limit(1);

    if (!memory) throw new Error(`Memory ${memoryId} not found`);

    const tags: string[] = JSON.parse(memory.tags);
    if (tags.includes(tag)) return tags; // already has it

    tags.push(tag);
    await db
      .update(schema.memories)
      .set({ tags: JSON.stringify(tags), updatedAt: new Date().toISOString() })
      .where(eq(schema.memories.id, memoryId));

    return tags;
  }

  /**
   * Remove a tag from a memory.
   */
  async removeTag(memoryId: string, tag: string): Promise<string[]> {
    this.assertInitialized();
    const db = getDb();

    const [memory] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, memoryId))
      .limit(1);

    if (!memory) throw new Error(`Memory ${memoryId} not found`);

    const tags: string[] = JSON.parse(memory.tags);
    const filtered = tags.filter((t) => t !== tag);

    await db
      .update(schema.memories)
      .set({ tags: JSON.stringify(filtered), updatedAt: new Date().toISOString() })
      .where(eq(schema.memories.id, memoryId));

    return filtered;
  }

  /**
   * Get collections — groups tags by prefix (e.g. "project:foo", "topic:bar").
   * Tags without a prefix go into a "default" collection.
   */
  async getCollections(): Promise<Collection[]> {
    const allTags = await this.getTags();

    const collections = new Map<string, { prefix: string; tags: TagInfo[]; total: number }>();

    for (const tagInfo of allTags) {
      const colonIdx = tagInfo.tag.indexOf(':');
      const prefix = colonIdx > 0 ? tagInfo.tag.slice(0, colonIdx) : 'default';
      const entry = collections.get(prefix) ?? { prefix, tags: [], total: 0 };
      entry.tags.push(tagInfo);
      entry.total += tagInfo.count;
      collections.set(prefix, entry);
    }

    return [...collections.values()]
      .map((c) => ({ name: c.prefix, prefix: c.prefix, tags: c.tags, totalMemories: c.total }))
      .sort((a, b) => b.totalMemories - a.totalMemories);
  }

  // ─── Embedding Management ────────────────────────────────────────────────

  /**
   * Get the status of embeddings — how many are current vs stale.
   */
  async embeddingStatus(): Promise<EmbeddingStatus> {
    this.assertInitialized();
    const db = getDb();
    const currentModel = getEmbeddingModelId();

    const all = await db
      .select()
      .from(schema.memories)
      .where(isNull(schema.memories.archivedAt));

    let totalEmbedded = 0;
    let currentModelCount = 0;
    let staleCount = 0;
    let legacyCount = 0;

    for (const m of all) {
      if (!m.embedding) continue;
      totalEmbedded++;
      if (!m.embeddingModel) {
        legacyCount++;
      } else if (m.embeddingModel === currentModel) {
        currentModelCount++;
      } else {
        staleCount++;
      }
    }

    return {
      currentModel,
      currentDimension: getModelDimension(),
      totalEmbedded,
      currentModelCount,
      staleCount,
      legacyCount,
      needsReEmbed: staleCount > 0 || legacyCount > 0,
    };
  }

  /**
   * Re-embed all memories (or only stale/legacy ones) with the current model.
   *
   * @param onlyStale  If true, only re-embed memories with a different or missing model ID. Default: true.
   * @param batchSize  Number of memories to process per batch. Default: 32.
   * @param onProgress Optional callback fired after each batch.
   */
  async reEmbed(
    onlyStale = true,
    batchSize = 32,
    onProgress?: (progress: ReEmbedProgress) => void,
  ): Promise<ReEmbedProgress> {
    this.assertInitialized();
    const start = Date.now();
    const db = getDb();
    const currentModel = getEmbeddingModelId();
    const currentDim = getModelDimension();

    // Select memories to re-embed
    const all = await db
      .select()
      .from(schema.memories)
      .where(isNull(schema.memories.archivedAt));

    const toReEmbed = onlyStale
      ? all.filter((m) => m.embedding && m.embeddingModel !== currentModel)
      : all.filter((m) => m.embedding);

    const progress: ReEmbedProgress = {
      total: toReEmbed.length,
      processed: 0,
      failed: 0,
      failedIds: [],
      durationMs: 0,
    };

    // Process in batches
    for (let i = 0; i < toReEmbed.length; i += batchSize) {
      const batch = toReEmbed.slice(i, i + batchSize);
      const contents = batch.map((m) => m.content);

      try {
        const embeddings = await embedBatch(contents);

        for (let j = 0; j < batch.length; j++) {
          const memory = batch[j]!;
          const newEmbedding = embeddings[j]!;
          const embeddingBuf = packFP16(newEmbedding);

          try {
            await db
              .update(schema.memories)
              .set({
                embedding: embeddingBuf,
                embeddingDim: currentDim,
                embeddingModel: currentModel,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(schema.memories.id, memory.id));

            // Update in-memory vector index
            this.vectorSearch.upsert({
              id: memory.id,
              vector: newEmbedding,
              type: memory.type as MemoryType,
              namespace: memory.namespace ?? undefined,
            });

            progress.processed++;
          } catch {
            progress.failed++;
            progress.failedIds.push(memory.id);
          }
        }
      } catch {
        // Entire batch failed
        for (const m of batch) {
          progress.failed++;
          progress.failedIds.push(m.id);
        }
      }

      progress.durationMs = Date.now() - start;
      onProgress?.(progress);
    }

    progress.durationMs = Date.now() - start;
    return progress;
  }

  /**
   * Backfill legacy memories that have no embeddingModel recorded.
   * Tags them with the current model ID without re-embedding (assumes same model).
   */
  async backfillEmbeddingModel(): Promise<number> {
    this.assertInitialized();
    const db = getDb();
    const currentModel = getEmbeddingModelId();

    const result = await db
      .update(schema.memories)
      .set({ embeddingModel: currentModel })
      .where(
        and(
          isNull(schema.memories.archivedAt),
          isNull(schema.memories.embeddingModel),
        )
      );

    // Drizzle SQLite doesn't return affected count directly, so count manually
    const remaining = await db
      .select()
      .from(schema.memories)
      .where(
        and(
          isNull(schema.memories.archivedAt),
          isNull(schema.memories.embeddingModel),
        )
      );

    // All that didn't match = were updated
    return remaining.length === 0 ? -1 : 0; // -1 signals "all done"
  }

  /** Get the currently active embedding model ID. */
  getEmbeddingModel(): string {
    return getEmbeddingModelId();
  }

  // ─── Contradiction Detection ──────────────────────────────────────────────

  /**
   * Check a specific memory for contradictions against the existing memory store.
   */
  async checkContradictions(memoryId: string): Promise<ContradictionCheckResult> {
    this.assertInitialized();
    const db = getDb();

    const [memory] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, memoryId))
      .limit(1);

    if (!memory) throw new Error(`Memory ${memoryId} not found`);
    if (!memory.embedding) throw new Error(`Memory ${memoryId} has no embedding`);

    const vec = unpackFP16(Buffer.from(memory.embedding as ArrayBuffer));
    return this.contradictionDetector.check(
      memory.content,
      vec,
      memory.id,
      this.vectorSearch,
      memory.namespace,
    );
  }

  /**
   * Get all unresolved contradictions (memories linked by 'contradicts' edges).
   */
  async getContradictions(namespace?: string): Promise<Array<{
    edge: { id: string; sourceId: string; targetId: string; strength: number; metadata: string };
    source: Memory;
    target: Memory;
  }>> {
    this.assertInitialized();
    const db = getDb();

    const edges = await db
      .select()
      .from(schema.memoryConnections)
      .where(eq(schema.memoryConnections.relationship, 'contradicts'));

    const results: Array<{
      edge: { id: string; sourceId: string; targetId: string; strength: number; metadata: string };
      source: Memory;
      target: Memory;
    }> = [];

    for (const edge of edges) {
      const [source] = await db
        .select()
        .from(schema.memories)
        .where(and(eq(schema.memories.id, edge.sourceId), isNull(schema.memories.archivedAt)))
        .limit(1);

      const [target] = await db
        .select()
        .from(schema.memories)
        .where(and(eq(schema.memories.id, edge.targetId), isNull(schema.memories.archivedAt)))
        .limit(1);

      // Only include if both memories are still active
      if (!source || !target) continue;

      // Namespace filtering
      const ns = namespace ?? this.config.namespace;
      if (ns && source.namespace !== ns && target.namespace !== ns) continue;

      results.push({
        edge: {
          id: edge.id,
          sourceId: edge.sourceId,
          targetId: edge.targetId,
          strength: edge.strength,
          metadata: edge.metadata,
        },
        source,
        target,
      });
    }

    return results;
  }

  /**
   * Resolve a contradiction between two memories.
   *
   * @param sourceId  ID of one memory in the contradiction pair
   * @param targetId  ID of the other memory
   * @param strategy  How to resolve it
   */
  async resolveContradiction(
    sourceId: string,
    targetId: string,
    strategy: ResolutionStrategy
  ): Promise<{ resolved: boolean; archivedId?: string; keptId?: string }> {
    this.assertInitialized();
    const db = getDb();

    const [source] = await db.select().from(schema.memories).where(eq(schema.memories.id, sourceId)).limit(1);
    const [target] = await db.select().from(schema.memories).where(eq(schema.memories.id, targetId)).limit(1);

    if (!source || !target) {
      return { resolved: false };
    }

    let archivedId: string | undefined;
    let keptId: string | undefined;

    switch (strategy) {
      case 'keep_newest': {
        const sourceTime = new Date(source.createdAt).getTime();
        const targetTime = new Date(target.createdAt).getTime();
        const [newer, older] = sourceTime >= targetTime ? [source, target] : [target, source];
        await this.forget(older.id);
        archivedId = older.id;
        keptId = newer.id;
        break;
      }

      case 'keep_oldest': {
        const sourceTime = new Date(source.createdAt).getTime();
        const targetTime = new Date(target.createdAt).getTime();
        const [newer, older] = sourceTime >= targetTime ? [source, target] : [target, source];
        await this.forget(newer.id);
        archivedId = newer.id;
        keptId = older.id;
        break;
      }

      case 'keep_important': {
        const sImp = source.importance ?? 0.5;
        const tImp = target.importance ?? 0.5;
        if (sImp >= tImp) {
          await this.forget(target.id);
          archivedId = target.id;
          keptId = source.id;
        } else {
          await this.forget(source.id);
          archivedId = source.id;
          keptId = target.id;
        }
        break;
      }

      case 'keep_both':
        // Just keep both — the contradicts edge remains as documentation
        keptId = sourceId;
        break;

      case 'manual':
        // No action — flag for human review
        return { resolved: false };
    }

    // Remove the contradicts edge after resolution (unless keep_both)
    if (strategy !== 'keep_both') {
      await db
        .delete(schema.memoryConnections)
        .where(
          and(
            eq(schema.memoryConnections.sourceId, sourceId),
            eq(schema.memoryConnections.targetId, targetId),
            eq(schema.memoryConnections.relationship, 'contradicts')
          )
        );
      // Also check reverse direction
      await db
        .delete(schema.memoryConnections)
        .where(
          and(
            eq(schema.memoryConnections.sourceId, targetId),
            eq(schema.memoryConnections.targetId, sourceId),
            eq(schema.memoryConnections.relationship, 'contradicts')
          )
        );
    }

    return { resolved: true, archivedId, keptId };
  }

  /**
   * Auto-resolve contradictions using the suggested strategies.
   */
  private async autoResolveContradictions(contradictions: Contradiction[], newMemoryId: string): Promise<void> {
    for (const c of contradictions) {
      await this.resolveContradiction(c.newMemoryId, c.existingMemoryId, c.suggestedStrategy);
    }
  }

  /** Get the current contradiction detection config. */
  getContradictionConfig(): ContradictionConfig {
    return this.contradictionDetector.getConfig();
  }

  /** Update contradiction detection config at runtime. */
  updateContradictionConfig(partial: Partial<ContradictionConfig>): void {
    this.contradictionDetector.updateConfig(partial);
  }

  // ─── Plugins ─────────────────────────────────────────────────────────────

  /** Register a plugin. */
  registerPlugin(plugin: EngramPlugin): void {
    this.pluginRegistry.register(plugin);
  }

  /** Unregister a plugin by ID. */
  unregisterPlugin(id: string): boolean {
    return this.pluginRegistry.unregister(id);
  }

  /** List all registered plugins. */
  listPlugins(): PluginInfo[] {
    return this.pluginRegistry.list();
  }

  /** Get the plugin registry for direct access. */
  getPluginRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }

  // ─── Webhooks ────────────────────────────────────────────────────────────

  /** Get the webhook manager for direct access. */
  getWebhookManager(): WebhookManager {
    return this.webhookManager;
  }

  /** Gracefully shut down — saves index to disk (if configured) and closes DB. */
  shutdown(): void {
    // Fire plugin onShutdown hooks (sync — we can't await in shutdown)
    void this.pluginRegistry.runHook('onShutdown', {
      entryCount: this.vectorSearch.size,
    });

    // Persist vector index before closing
    const indexPath = this.resolveIndexPath();
    if (indexPath && this.initialized) {
      try {
        this.vectorSearch.saveToDisk(indexPath);
      } catch {
        // Best-effort — don't crash on save failure
      }
    }
    closeDb();
    this.initialized = false;
  }

  /** Force save the vector index to disk now. */
  saveIndex(): void {
    this.assertInitialized();
    const indexPath = this.resolveIndexPath();
    if (!indexPath) throw new Error('No index path configured. Set indexPath in BrainConfig or ENGRAM_INDEX_PATH env var.');
    this.vectorSearch.saveToDisk(indexPath);
    this.indexStatus.indexFileExists = true;
  }

  /** Force a full index rebuild from the database (discards cached index). */
  async rebuildIndex(): Promise<IndexStatus> {
    this.assertInitialized();
    const start = Date.now();
    const db = getDb();

    this.vectorSearch.clear();

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
          namespace: memory.namespace ?? undefined,
        });
      }
    }

    this.indexStatus.loadedFrom = 'database';
    this.indexStatus.entryCount = this.vectorSearch.size;
    this.indexStatus.incrementalCount = 0;
    this.indexStatus.initDurationMs = Date.now() - start;

    // Auto-save if path configured
    const indexPath = this.resolveIndexPath();
    if (indexPath) {
      this.vectorSearch.saveToDisk(indexPath);
      this.indexStatus.indexFileExists = true;
    }

    return { ...this.indexStatus };
  }

  /** Get the current index status. */
  getIndexStatus(): IndexStatus {
    return { ...this.indexStatus };
  }

  /** Resolve the index file path from config or env. */
  private resolveIndexPath(): string | null {
    return (
      this.config.indexPath ??
      process.env['ENGRAM_INDEX_PATH'] ??
      (this.config.dbPath ? this.config.dbPath + '.index' : null)
    );
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('NeuralBrain not initialized. Call brain.initialize() first.');
    }
  }
}
