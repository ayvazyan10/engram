/**
 * NeuralBrain — unified API for storing and recalling memories.
 *
 * This is the primary class that integration adapters (MCP, REST, Ollama)
 * should instantiate and use.
 *
 * Usage:
 *   const brain = new NeuralBrain();
 *   await brain.initialize();
 *   await brain.store({ content: "User prefers TypeScript", type: "semantic" });
 *   const ctx = await brain.recall("what language does the user prefer?");
 */

import fs from 'fs';
import { createHash } from 'crypto';
import { and, desc, eq, inArray, isNull, like, lt, or } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { closeDb, getDataVersion, getDb, schema, walCheckpoint } from './db/index.js';
import type { Memory, MemoryType, NewMemory, NewMemoryConnection, NewSession, RelationshipType } from './db/schema.js';
import {
  EMBEDDING_DIMENSION, embed, embedBatch, packFP16, unpackFP16,
  getEmbeddingModelId, getModelDimension, getEmbeddingDimension, switchEmbeddingModel,
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
import { ReflectionEngine } from './reflection/ReflectionEngine.js';
import type { ReflectionConfig, ReflectionTask, ReflectionType } from './reflection/ReflectionEngine.js';

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

export type NamespaceMode = 'none' | 'filter' | 'isolated';

export interface BrainConfig {
  /** Path to SQLite database file. Defaults to ./engram.db */
  dbPath?: string;
  /** Default source tag for stored memories */
  defaultSource?: string;
  /** Memory decay and garbage collection policy */
  decayPolicy?: Partial<DecayPolicyConfig>;
  /**
   * Namespace behavior. Defaults to `none`.
   * - none: ignore namespace values and use one shared memory pool
   * - filter: optional namespace filtering with per-request overrides
   * - isolated: require one fixed namespace and reject overrides/cross-namespace access
   */
  namespaceMode?: NamespaceMode;
  /** Namespace used by `filter` and `isolated` modes. */
  namespace?: string;
  /** Contradiction detection configuration */
  contradictionConfig?: Partial<ContradictionConfig>;
  /** Path to persist the vector index for fast startup. Defaults to {dbPath}.index */
  indexPath?: string;
  /** Reflection engine configuration */
  reflection?: Partial<ReflectionConfig>;
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
  /**
   * True when contradiction auto-resolution archived this memory immediately
   * (keep_oldest / keep_important). The returned record is already archived and
   * will never be recalled — no 'stored' event is fired for it.
   */
  discarded?: boolean;
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
  /**
   * Number of entries in the vector index right now.
   *
   * Live, not a snapshot from init: two processes over one database reported
   * different counts for the same file because each kept answering with what it
   * had loaded at startup.
   */
  entryCount: number;
  /** Embedding dimension */
  dimension: number;
  /** Path to the persisted index file (if configured) */
  indexPath: string | null;
  /** Whether a persisted index file exists on disk */
  indexFileExists: boolean;
  /** How many memories were added incrementally at init (0 if full rebuild) */
  incrementalCount: number;
  /** Init duration in milliseconds */
  initDurationMs: number;
  /** How many reconciles pulled in work committed by another process */
  externalSyncCount: number;
  /** Entries added by those reconciles since init */
  externalAdded: number;
  /** Entries dropped by those reconciles since init */
  externalRemoved: number;
  /**
   * Memories those reconciles could not index because their vector came from a
   * different embedding model. Non-zero means `re_embed` is due — the memories
   * exist and are readable, but no search will surface them.
   */
  externalSkipped: number;
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

/** A search result: the stored memory plus its cosine similarity to the query. */
export type SearchHit = Memory & { score: number };

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
  /** Active namespace behavior. */
  namespaceMode: NamespaceMode;
}

export class NeuralBrain {
  private config: BrainConfig;
  private readonly namespaceMode: NamespaceMode;
  private readonly activeNamespace?: string;
  private vectorSearch: VectorSearch;
  private graph: KnowledgeGraph;
  private assembler: ContextAssembler;
  private decayEngine: DecayEngine;
  private contradictionDetector: ContradictionDetector;
  private webhookManager: WebhookManager;
  private pluginRegistry: PluginRegistry;
  private reflectionEngine: ReflectionEngine;

  readonly episodic: EpisodicMemory;
  readonly semantic: SemanticMemory;
  readonly procedural: ProceduralMemory;

  private initialized = false;
  private indexStatus: IndexStatus = {
    loadedFrom: 'not_loaded',
    entryCount: 0,
    dimension: getEmbeddingDimension(),
    indexPath: null,
    indexFileExists: false,
    incrementalCount: 0,
    initDurationMs: 0,
    externalSyncCount: 0,
    externalAdded: 0,
    externalRemoved: 0,
    externalSkipped: 0,
  };

  /**
   * Database data-version observed at the last reconcile. See
   * syncIndexFromStore — this is how a write by another process is noticed.
   */
  private lastDataVersion: number | null = null;

  /**
   * In-flight reconcile, shared by concurrent readers so a burst of requests
   * triggers one pass rather than one per request.
   */
  private pendingSync: Promise<number> | null = null;

  constructor(config: BrainConfig = {}) {
    // Backwards compatibility: before namespaceMode existed, providing a
    // namespace enabled filtering. Keep that behavior for existing callers,
    // while an entirely unconfigured brain still defaults to `none`.
    const namespaceMode = config.namespaceMode ?? (config.namespace?.trim() ? 'filter' : 'none');
    if (!['none', 'filter', 'isolated'].includes(namespaceMode)) {
      throw new Error('namespaceMode must be one of: none, filter, isolated');
    }
    this.namespaceMode = namespaceMode;
    if (this.namespaceMode === 'isolated' && !config.namespace?.trim()) {
      throw new Error('namespace is required when namespaceMode is "isolated"');
    }
    this.activeNamespace = this.namespaceMode === 'none' ? undefined : config.namespace?.trim() || undefined;
    this.config = { ...config, namespaceMode: this.namespaceMode, namespace: this.activeNamespace };
    // Use the ACTIVE model's dimension, not the frozen module constant, so a
    // configured model switch cannot leave the index sized for the default. The
    // model id travels into the saved index so a cache from another model is
    // refused on load instead of scoring against incomparable vectors.
    this.vectorSearch = new VectorSearch(getEmbeddingDimension(), getEmbeddingModelId());
    this.graph = new KnowledgeGraph();
    this.assembler = new ContextAssembler(this.vectorSearch, this.graph, this.activeNamespace);
    this.decayEngine = new DecayEngine(mergePolicy(config.decayPolicy ?? {}));
    this.contradictionDetector = new ContradictionDetector(config.contradictionConfig ?? {});
    this.webhookManager = new WebhookManager();
    this.pluginRegistry = new PluginRegistry();
    this.reflectionEngine = new ReflectionEngine(config.reflection);
    // Pass the namespace down: these classes are public (brain.episodic etc.)
    // and previously wrote to the shared null-namespace pool while their getters
    // read across every tenant.
    this.episodic = new EpisodicMemory(this.activeNamespace, this.namespaceMode);
    this.semantic = new SemanticMemory(this.activeNamespace, this.namespaceMode);
    this.procedural = new ProceduralMemory(this.activeNamespace, this.namespaceMode);
  }

  private resolveStoreNamespace(requested?: string): string | null {
    if (this.namespaceMode === 'none') return null;
    if (this.namespaceMode === 'isolated') {
      if (requested && requested !== this.activeNamespace) {
        throw new Error('namespace override is not allowed in isolated mode');
      }
      return this.activeNamespace!;
    }
    return requested ?? this.activeNamespace ?? null;
  }

  private resolveCrossNamespace(requested?: boolean): boolean {
    if (requested && this.namespaceMode === 'isolated') {
      throw new Error('cross-namespace access is not allowed in isolated mode');
    }
    return this.namespaceMode === 'filter' && requested === true;
  }

  /** Whether a database row is visible to this brain instance. */
  canAccessNamespace(namespace: string | null | undefined): boolean {
    return this.namespaceMode !== 'isolated' || namespace === this.activeNamespace;
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

    // Isolated instances keep only their own tenant in memory. Filter mode keeps
    // the full index because its explicit crossNamespace option needs it.
    const initConditions = [isNull(schema.memories.archivedAt)];
    if (this.namespaceMode === 'isolated') {
      initConditions.push(eq(schema.memories.namespace, this.activeNamespace!));
    }
    const allMemories = await db
      .select()
      .from(schema.memories)
      .where(and(...initConditions));

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
    const activeIds = new Set(allMemories.map((memory) => memory.id));
    const loadedConnections = await db.select().from(schema.memoryConnections);
    const allConnections = this.namespaceMode === 'isolated'
      ? loadedConnections.filter((connection) =>
          activeIds.has(connection.sourceId) && activeIds.has(connection.targetId))
      : loadedConnections;
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

    // Baseline for cross-process reconciles: the index now matches what the
    // database held at this moment, so only commits after it need catching up.
    this.lastDataVersion = getDataVersion();

    this.initialized = true;

    // Fire plugin onStartup hooks
    void this.pluginRegistry.runHook('onStartup', {
      entryCount: this.vectorSearch.size,
      loadedFrom: this.indexStatus.loadedFrom,
      initDurationMs: this.indexStatus.initDurationMs,
    });
  }

  /**
   * Reconcile the in-memory vector index with memories committed by OTHER
   * processes, and report how many entries changed.
   *
   * Engram routinely runs several processes — REST server, MCP server, CLI —
   * against one SQLite file, each holding its own index built at startup. A
   * memory stored through one of them landed in SQLite immediately but stayed
   * unfindable everywhere else until that process restarted: `stats()` counted
   * it (that reads the database) while `search()` could not see it (that reads
   * the index).
   *
   * Detection is `PRAGMA data_version`, which changes only for commits by other
   * connections — so this brain's own writes, already indexed by store(), cost
   * nothing here. When it has not moved, the check is a pragma read and no
   * query runs at all.
   *
   * Idempotent and safe to call on any read path.
   */
  async syncIndexFromStore(): Promise<number> {
    if (!this.initialized) return 0;

    // Join an in-flight pass before looking at the version. Checked the other
    // way round, a second reader would see the version the running reconcile
    // has already claimed, conclude there was nothing to do, and search a
    // half-reconciled index.
    if (this.pendingSync) return this.pendingSync;

    const version = getDataVersion();
    // null means the backend cannot report it (PostgreSQL). Reconciling on
    // every read would cost a full id scan per query, so we stay with the
    // startup index — the same behaviour as before this method existed.
    if (version === null || version === this.lastDataVersion) return 0;

    this.pendingSync = this.reconcileIndex(version).finally(() => {
      this.pendingSync = null;
    });
    return this.pendingSync;
  }

  /** The reconcile itself — see syncIndexFromStore for why and when. */
  private async reconcileIndex(version: number): Promise<number> {
    const db = getDb();

    // Claim the version before reading. A commit that lands mid-reconcile then
    // leaves a version we have not recorded, so the next read tries again —
    // whereas claiming it afterwards would mark that commit as already handled.
    this.lastDataVersion = version;

    const liveConditions = [isNull(schema.memories.archivedAt)];
    if (this.namespaceMode === 'isolated') {
      liveConditions.push(eq(schema.memories.namespace, this.activeNamespace!));
    }
    const liveRows = await db
      .select({ id: schema.memories.id })
      .from(schema.memories)
      .where(and(...liveConditions));

    const live = new Set(liveRows.map((r) => r.id));
    const indexed = this.vectorSearch.getIds();

    let removed = 0;
    for (const id of indexed) {
      if (!live.has(id)) {
        this.vectorSearch.remove(id);
        this.graph.removeNode(id);
        removed++;
      }
    }

    const missing = [...live].filter((id) => !indexed.has(id));
    let added = 0;
    let skipped = 0;

    // Chunked: SQLite caps variables per statement, and a process that has been
    // idle for a while can come back to thousands of new memories.
    const CHUNK = 400;
    for (let i = 0; i < missing.length; i += CHUNK) {
      const rows = await db
        .select()
        .from(schema.memories)
        .where(inArray(schema.memories.id, missing.slice(i, i + CHUNK)));

      for (const memory of rows) {
        if (memory.embedding) {
          try {
            this.vectorSearch.upsert({
              id: memory.id,
              vector: unpackFP16(Buffer.from(memory.embedding as ArrayBuffer)),
              type: memory.type as MemoryType,
              namespace: memory.namespace ?? undefined,
            });
            added++;
          } catch {
            // A vector from another embedding model: upsert rejects the
            // dimension. Skipping keeps one incompatible row from throwing out
            // of every search — the count below is what makes that visible
            // rather than silent, and re_embed is the way to clear it.
            skipped++;
          }
        }
        this.graph.addNode({
          id: memory.id,
          type: memory.type as MemoryType,
          concept: memory.concept ?? undefined,
        });
      }
    }

    // Edges touching the newly arrived nodes, so graph expansion during recall
    // sees them rather than treating them as isolated. Only edges with a new
    // endpoint are fetched: addEdge appends without deduplicating, so replaying
    // edges between two already-known nodes would double them. Edges created
    // externally between two nodes this process already had are therefore
    // missed until restart — a narrower gap than the one being closed here, and
    // one that costs a full adjacency rebuild to close.
    if (missing.length > 0) {
      for (let i = 0; i < missing.length; i += CHUNK) {
        const slice = missing.slice(i, i + CHUNK);
        const edges = await db
          .select()
          .from(schema.memoryConnections)
          .where(
            or(
              inArray(schema.memoryConnections.sourceId, slice),
              inArray(schema.memoryConnections.targetId, slice)
            )
          );

        for (const conn of edges) {
          this.graph.addEdge({
            sourceId: conn.sourceId,
            targetId: conn.targetId,
            relationship: conn.relationship as RelationshipType,
            strength: conn.strength,
            bidirectional: Boolean(conn.bidirectional),
          });
        }
      }
    }

    const changed = added + removed;
    if (changed > 0 || skipped > 0) {
      this.indexStatus.externalSyncCount++;
      this.indexStatus.externalAdded += added;
      this.indexStatus.externalRemoved += removed;
      this.indexStatus.externalSkipped += skipped;
    }

    return changed;
  }

  private defaultImportance(type: string, source: string | null): number {
    const aiClient = source === 'claude-code' || source === 'ollama';
    if (type === 'semantic') return aiClient ? 0.85 : 0.7;
    if (type === 'procedural') return aiClient ? 0.8 : 0.5;
    return aiClient ? 0.75 : 0.5;
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
      importance: input.importance ?? this.defaultImportance(type, source),
      source,
      sessionId: input.sessionId ?? null,
      eventAt: (input.eventAt ?? new Date()).toISOString(),
      namespace: this.resolveStoreNamespace(input.namespace),
      tags: JSON.stringify(input.tags ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    };

    // ── Auto-concept: derive the topic label BEFORE the insert, so the row is
    // written once instead of insert-then-update.
    if (!record.concept) {
      try {
        record.concept = extractConcept(input.content);
      } catch {
        // Concept extraction is best-effort
      }
    }

    // ── Auto-link: pick the most similar neighbours to connect to.
    // This builds the neural network organically — every new memory connects to
    // its closest neighbours. The new memory is not in the index yet, so it
    // cannot match itself.
    let edges: NewMemoryConnection[] = [];
    try {
      // Namespace-scoped: the shared in-memory index holds every tenant's
      // vectors, so an unscoped search created cross-namespace graph edges.
      const similar = this.vectorSearch.search(embedding, 4, 0.5, undefined, record.namespace ?? undefined);
      edges = similar
        .filter((s) => s.id !== record.id)
        .slice(0, 3)
        .map((n) => ({
          id: uuidv4(),
          sourceId: record.id!,
          targetId: n.id,
          relationship: 'relates_to' as RelationshipType,
          strength: Math.round(n.similarity * 100) / 100,
          bidirectional: true,
          metadata: '{}',
          createdAt: now,
        }));
    } catch {
      // Auto-link is best-effort — don't fail the store
      edges = [];
    }

    // Atomic: the memory row and its auto-link edges land together or not at
    // all. They used to be separate awaited statements, so a crash between them
    // left a memory with no edges, and an edge insert that hit the targetId
    // foreign key threw only after the row was already committed.
    //
    // The callback MUST stay synchronous — better-sqlite3 transactions do not
    // await, so every async step (embedding) happens above.
    db.transaction((tx) => {
      tx.insert(schema.memories).values(record).run();
      if (edges.length > 0) {
        tx.insert(schema.memoryConnections).values(edges).run();
      }
    });

    // In-memory state is updated only after the durable write succeeded —
    // previously the index and graph were advanced before the edges were
    // written, so a failure left them ahead of the database.
    this.vectorSearch.upsert({ id: record.id!, vector: embedding, type, namespace: record.namespace });
    this.graph.addNode({ id: record.id!, type, concept: record.concept ?? undefined });
    for (const edge of edges) {
      this.graph.addEdge({
        sourceId: edge.sourceId,
        targetId: edge.targetId,
        relationship: edge.relationship as RelationshipType,
        strength: edge.strength ?? 1.0,
        bidirectional: true,
      });
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

    // Auto-resolution can discard the memory we just created: keep_oldest /
    // keep_important forget() the newest row, which is always this one. Because
    // forget is a soft-delete the row still reads back, so store() used to
    // report success, fire a 'stored' webhook alongside 'forgotten', and hand
    // back an id that can never be recalled.
    if (inserted!.archivedAt) {
      return { memory: inserted!, contradictions: contradictionResult, discarded: true };
    }

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

    // Count the store toward reflection. When it becomes due, the connected AI
    // picks it up via getReflectionTasks() (request_reflection) — Engram runs no
    // LLM of its own.
    if (inserted!.source !== 'reflection') {
      this.reflectionEngine.notifyStore();
    }

    return { memory: inserted!, contradictions: contradictionResult };
  }

  /**
   * Recall the most relevant context for a query.
   * Returns a formatted string ready to inject into an AI prompt.
   */
  async recall(query: string, options?: RecallOptions): Promise<RecallResult> {
    this.assertInitialized();
    await this.syncIndexFromStore();
    const result = await this.assembler.recall(query, {
      ...options,
      crossNamespace: this.resolveCrossNamespace(options?.crossNamespace),
    });

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
    await this.syncIndexFromStore();
    yield* this.assembler.recallStream(query, {
      ...options,
      crossNamespace: this.resolveCrossNamespace(options?.crossNamespace),
    });
  }

  /**
   * Semantic search across memories.
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchHit[]> {
    this.assertInitialized();
    await this.syncIndexFromStore();

    const queryVec = await embed(query);
    const crossNamespace = this.resolveCrossNamespace(options.crossNamespace);
    const results = this.vectorSearch.search(
      queryVec,
      options.topK ?? 10,
      options.threshold ?? 0.3,
      options.types,
      this.activeNamespace,
      crossNamespace
    );

    const db = getDb();

    // One query for all hits instead of one per result.
    const ids = results.map((r) => r.id);
    const rows = ids.length
      ? await db
          .select()
          .from(schema.memories)
          .where(and(inArray(schema.memories.id, ids), isNull(schema.memories.archivedAt)))
      : [];
    const byId = new Map(rows.map((r) => [r.id, r]));

    // Iterate `results` (not `rows`) so similarity ordering is preserved.
    const hits: SearchHit[] = [];
    for (const result of results) {
      const m = byId.get(result.id);
      if (!m) continue;
      if (options.sources && m.source && !options.sources.includes(m.source)) continue;
      // Namespace filtering (defense in depth — vector search already filters)
      if (this.activeNamespace && !crossNamespace && m.namespace !== this.activeNamespace) continue;
      // The similarity was computed and then thrown away, so every consumer that
      // wanted to show a relevance score rendered 0.
      hits.push({ ...m, score: result.similarity });
    }

    return hits;
  }

  /**
   * Archive (soft-delete) a memory by ID.
   */
  /**
   * Archive memories and prune their edges in ONE transaction.
   *
   * Soft-deleting a memory and deleting its connections are two writes; done
   * separately, a failure between them leaves archived rows whose edges are
   * still reloaded into the graph at startup. Batching also turns an N-memory
   * archive (consolidation) into two statements instead of 2N.
   *
   * Synchronous by necessity — better-sqlite3 transactions do not await.
   * In-memory state and events are the caller's responsibility, so they only
   * run after this returns.
   */
  private archiveAtomic(ids: string[]): void {
    if (ids.length === 0) return;
    const db = getDb();
    const archivedAt = new Date().toISOString();

    db.transaction((tx) => {
      tx.update(schema.memories)
        .set({ archivedAt })
        .where(inArray(schema.memories.id, ids))
        .run();

      tx.delete(schema.memoryConnections)
        .where(
          or(
            inArray(schema.memoryConnections.sourceId, ids),
            inArray(schema.memoryConnections.targetId, ids)
          )
        )
        .run();
    });
  }

  async forget(id: string): Promise<void> {
    this.assertInitialized();

    if (this.namespaceMode === 'isolated') {
      const db = getDb();
      const [memory] = await db.select({ namespace: schema.memories.namespace })
        .from(schema.memories)
        .where(eq(schema.memories.id, id))
        .limit(1);
      if (!memory || !this.canAccessNamespace(memory.namespace)) {
        throw new Error(`Memory not found: ${id}`);
      }
    }

    this.archiveAtomic([id]);

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
      namespace: this.activeNamespace ?? null,
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
      .where(this.activeNamespace
        ? and(eq(schema.sessions.id, sessionId), eq(schema.sessions.namespace, this.activeNamespace))
        : eq(schema.sessions.id, sessionId));
  }

  /**
   * Get statistics about the brain's current state.
   */
  async stats(): Promise<MemoryStats> {
    this.assertInitialized();
    walCheckpoint();
    // Otherwise total (read from the database) and indexSize (read from memory)
    // disagree whenever another process has written.
    await this.syncIndexFromStore();
    const db = getDb();

    const statsConditions = [isNull(schema.memories.archivedAt)];
    if (this.activeNamespace) {
      statsConditions.push(eq(schema.memories.namespace, this.activeNamespace));
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
      namespace: this.activeNamespace ?? null,
      namespaceMode: this.namespaceMode,
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
   * @param olderThanIso Only consider episodes created before this timestamp.
   *   Auto-consolidation passes its minEpisodicAgeMs cutoff here; without it,
   *   brand-new memories were clustered and archived immediately.
   * @returns Array of newly created semantic memories
   */
  async consolidate(minClusterSize = 3, threshold = 0.6, olderThanIso?: string): Promise<Memory[]> {
    this.assertInitialized();
    const db = getDb();

    // Get all episodic memories (scoped by namespace if configured)
    const consolidateConditions = [eq(schema.memories.type, 'episodic'), isNull(schema.memories.archivedAt)];
    if (this.activeNamespace) {
      consolidateConditions.push(eq(schema.memories.namespace, this.activeNamespace));
    }
    if (olderThanIso) {
      consolidateConditions.push(lt(schema.memories.createdAt, olderThanIso));
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
      // Scope to the namespace, otherwise foreign-namespace episodes consume
      // the top-10 slots and are then discarded, silently shrinking clusters.
      const similar = this.vectorSearch.search(vec, 10, threshold, ['episodic'], this.activeNamespace);
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
      const contents = cluster.map((m) => m.content);
      const concepts = cluster.map((m) => m.concept).filter(Boolean);
      const concept = concepts[0] ?? extractConcept(contents.join('\n')) ?? 'Consolidated memory';

      const avgImportance = cluster.reduce((s, m) => s + (m.importance ?? 0.5), 0) / cluster.length;
      const importance = Math.min(1, avgImportance + 0.1);

      const summary = this.summarizeCluster(contents);

      const { memory: semantic } = await this.store({
        content: summary,
        type: 'semantic',
        concept,
        importance,
        source: 'consolidation',
        tags: ['consolidated'],
        metadata: { episodeCount: cluster.length, episodeIds: cluster.map((m) => m.id) },
      });

      // Archive the whole cluster in ONE transaction. Calling forget() per
      // episode meant a failure mid-loop left the cluster half-archived: a
      // summary plus some still-live episodes AND some already gone.
      //
      // Note the remaining boundary: the summary is created by store() above
      // (which must be async to embed), so a crash between the two leaves the
      // summary with its episodes still live — duplicated information, but
      // nothing lost. Full atomicity would mean bypassing store() and losing
      // its auto-link and contradiction handling.
      const clusterIds = cluster.map((m) => m.id);
      this.archiveAtomic(clusterIds);

      for (const ep of cluster) {
        this.vectorSearch.remove(ep.id);
        this.graph.removeNode(ep.id);
        this.webhookManager.fire('forgotten', { id: ep.id });
        void this.pluginRegistry.runHook('onForget', { memoryId: ep.id });
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
   * Summarize a cluster of memory contents via deterministic text dedup.
   * Engram runs no LLM; richer summarization is left to the AI connected to it.
   */
  private summarizeCluster(contents: string[]): string {
    const lines = contents.join('\n').split('\n').filter((l) => l.trim().length > 5);
    return [...new Set(lines)].slice(0, 10).join('\n');
  }

  /** Get the reflection engine instance */
  getReflectionEngine(): ReflectionEngine {
    return this.reflectionEngine;
  }

  /**
   * Get the in-memory vector index. Callers that write an embedding directly to
   * the DB must upsert here too, or search will keep using the stale vector.
   */
  getVectorSearch(): VectorSearch {
    return this.vectorSearch;
  }

  /**
   * Get the in-memory knowledge graph. Callers that insert a connection row
   * directly must add the edge here too — recall traverses this graph, which is
   * only loaded from the DB at startup.
   */
  getGraph(): KnowledgeGraph {
    return this.graph;
  }

  /**
   * Build reflection tasks for the AI connected to Engram to reason over.
   * Engram selects and summarizes the memories and returns prompts; the AI
   * produces the insights and writes them back via {@link storeReflection}.
   * Clears the pending flag once tasks are handed out.
   */
  async getReflectionTasks(): Promise<ReflectionTask[]> {
    this.assertInitialized();
    const db = getDb();

    const conditions = [isNull(schema.memories.archivedAt)];
    if (this.activeNamespace) {
      conditions.push(eq(schema.memories.namespace, this.activeNamespace));
    }

    const memories = await db
      .select()
      .from(schema.memories)
      .where(and(...conditions))
      // Newest first — a bare orderBy is ASC, which fed the reflection prompt
      // the OLDEST memories while claiming they were "the most recent".
      .orderBy(desc(schema.memories.updatedAt))
      .limit(this.reflectionEngine.getConfig().maxMemoriesToAnalyze);

    const tasks = this.reflectionEngine.buildTasks(memories);
    if (tasks.length > 0) this.reflectionEngine.clearPending();
    return tasks;
  }

  /**
   * Store an insight produced by the connected AI as a semantic memory tagged
   * `reflection:<type>`. Returns null when the insight is empty or NO_INSIGHT.
   */
  async storeReflection(input: {
    type: ReflectionType;
    insight: string;
    relatedMemoryIds?: string[];
    confidence?: number;
  }): Promise<Memory | null> {
    this.assertInitialized();

    const result = this.reflectionEngine.buildResult(
      input.type,
      input.insight,
      input.relatedMemoryIds ?? [],
      input.confidence,
    );
    if (!result) return null;

    const { memory } = await this.store({
      content: result.insight,
      type: 'semantic',
      source: 'reflection',
      tags: ['reflection', `reflection:${result.type}`],
      importance: Math.min(0.9, 0.6 + result.confidence * 0.3),
      metadata: {
        reflectionType: result.type,
        confidence: result.confidence,
        relatedMemoryIds: result.relatedMemoryIds,
      },
    });

    this.reflectionEngine.clearPending();

    this.webhookManager.fire('reflected', {
      count: 1,
      types: [result.type],
    });

    void this.pluginRegistry.runHook('onReflect', {
      insights: 1,
      types: [result.type],
    });

    return memory;
  }

  /**
   * Get stored reflection insights, newest first.
   *
   * @param limit Maximum rows to return
   * @param type  Optional reflection type. Filtered in SQL so LIMIT applies
   *   AFTER the filter — filtering the limited rows in memory could return
   *   zero results while matching reflections existed.
   */
  async getReflections(limit = 20, type?: ReflectionType): Promise<Memory[]> {
    this.assertInitialized();
    const db = getDb();

    const conditions = [
      eq(schema.memories.source, 'reflection'),
      isNull(schema.memories.archivedAt),
    ];
    if (this.activeNamespace) {
      conditions.push(eq(schema.memories.namespace, this.activeNamespace));
    }
    if (type) {
      conditions.push(like(schema.memories.tags, `%"reflection:${type}"%`));
    }

    return db
      .select()
      .from(schema.memories)
      .where(and(...conditions))
      .orderBy(desc(schema.memories.createdAt))
      .limit(limit);
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
      this.activeNamespace
    );

    // Auto-consolidation
    if (!dryRun) {
      const newIds = await this.decayEngine.autoConsolidate(
        async (minClusterSize, threshold, olderThanIso) => {
          const consolidated = await this.consolidate(minClusterSize, threshold, olderThanIso);
          return consolidated.map((m) => ({ id: m.id }));
        },
        this.activeNamespace
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

    // Mark reflection due after a decay sweep if configured; the connected AI
    // picks it up via getReflectionTasks() (request_reflection).
    if (!dryRun) {
      this.reflectionEngine.notifyDecay();
    }

    return result;
  }

  /** Get the active namespace, or undefined for shared pool. */
  getNamespace(): string | undefined {
    return this.activeNamespace;
  }

  /** Get the configured namespace behavior. */
  getNamespaceMode(): NamespaceMode {
    return this.namespaceMode;
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
    if (this.activeNamespace) {
      conditions.push(eq(schema.memories.namespace, this.activeNamespace));
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
    if (this.activeNamespace) {
      conditions.push(eq(schema.memories.namespace, this.activeNamespace));
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

    if (!memory || !this.canAccessNamespace(memory.namespace)) throw new Error(`Memory ${memoryId} not found`);

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

    if (!memory || !this.canAccessNamespace(memory.namespace)) throw new Error(`Memory ${memoryId} not found`);

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

    const embeddingConditions = [isNull(schema.memories.archivedAt)];
    if (this.activeNamespace) embeddingConditions.push(eq(schema.memories.namespace, this.activeNamespace));
    const all = await db
      .select()
      .from(schema.memories)
      .where(and(...embeddingConditions));

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

    // Re-embedding under a different model produces different-length vectors.
    // Resize (and clear) the index first — upsert now rejects mismatches rather
    // than silently corrupting similarity.
    if (currentDim !== this.vectorSearch.dimension) {
      this.vectorSearch.setDimension(currentDim);
    }

    // Record the model the vectors about to be written belong to, so the saved
    // index is rejected later if the active model changes again. Two models can
    // share a dimension, which the resize above would not catch.
    if (currentModel !== this.vectorSearch.embeddingModel) {
      this.vectorSearch.setModelId(currentModel);
    }

    // Select memories to re-embed
    const reEmbedConditions = [isNull(schema.memories.archivedAt)];
    if (this.activeNamespace) reEmbedConditions.push(eq(schema.memories.namespace, this.activeNamespace));
    const all = await db
      .select()
      .from(schema.memories)
      .where(and(...reEmbedConditions));

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

    // Persist the refreshed vectors now. Until shutdown writes them, the cached
    // index on disk still holds the pre-re-embed vectors, and deserialize() only
    // validates dimension — so a restart (or another process saving its own
    // index over this file) would silently resurrect them.
    //
    // Checking the path first (as shutdown and rebuildIndex do) keeps the catch
    // narrow: it covers a failed write, not a store that simply runs without
    // persistence.
    if (progress.processed > 0 && this.resolveIndexPath()) {
      try {
        await this.saveIndexAsync();
      } catch {
        // Best-effort — a full disk or a read-only path must not fail a
        // re-embed that already succeeded. SQLite and the in-memory index hold
        // the correct vectors; shutdown will retry the write.
      }
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
          ...(this.activeNamespace ? [eq(schema.memories.namespace, this.activeNamespace)] : []),
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
          ...(this.activeNamespace ? [eq(schema.memories.namespace, this.activeNamespace)] : []),
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

    if (!memory || !this.canAccessNamespace(memory.namespace)) throw new Error(`Memory ${memoryId} not found`);
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
  async getContradictions(namespace?: string, limit?: number): Promise<Array<{
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

    // Load every referenced memory in ONE query instead of two per edge. The
    // previous 1+2N pattern kept getting slower as the contradicts set grew,
    // and most of those rows were then discarded as archived/out-of-namespace.
    const referencedIds = [...new Set(edges.flatMap((e) => [e.sourceId, e.targetId]))];
    const activeMemories = referencedIds.length
      ? await db
          .select()
          .from(schema.memories)
          .where(and(inArray(schema.memories.id, referencedIds), isNull(schema.memories.archivedAt)))
      : [];
    const byId = new Map(activeMemories.map((m) => [m.id, m]));

    for (const edge of edges) {
      const source = byId.get(edge.sourceId);
      const target = byId.get(edge.targetId);

      // Only include if both memories are still active
      if (!source || !target) continue;

      // Namespace filtering
      const ns = this.namespaceMode === 'none' ? undefined : namespace ?? this.activeNamespace;
      if (this.namespaceMode === 'isolated' &&
          (!this.canAccessNamespace(source.namespace) || !this.canAccessNamespace(target.namespace))) continue;
      if (this.namespaceMode === 'filter' && ns && source.namespace !== ns && target.namespace !== ns) continue;

      if (limit !== undefined && results.length >= limit) break;

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

    if (!source || !target ||
        !this.canAccessNamespace(source.namespace) || !this.canAccessNamespace(target.namespace)) {
      return { resolved: false };
    }

    let archivedId: string | undefined;
    let keptId: string | undefined;

    switch (strategy) {
      case 'keep_newest': {
        const sourceTime = new Date(source.createdAt).getTime();
        const targetTime = new Date(target.createdAt).getTime();
        const [newer, older] = sourceTime >= targetTime ? [source, target] : [target, source];
        archivedId = older.id;
        keptId = newer.id;
        break;
      }

      case 'keep_oldest': {
        const sourceTime = new Date(source.createdAt).getTime();
        const targetTime = new Date(target.createdAt).getTime();
        const [newer, older] = sourceTime >= targetTime ? [source, target] : [target, source];
        archivedId = newer.id;
        keptId = older.id;
        break;
      }

      case 'keep_important': {
        const sImp = source.importance ?? 0.5;
        const tImp = target.importance ?? 0.5;
        if (sImp >= tImp) {
          archivedId = target.id;
          keptId = source.id;
        } else {
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

    // Everything the resolution writes — archiving the loser, pruning its edges,
    // and dropping the contradicts edge in both directions — happens in ONE
    // transaction. Previously forget() archived the loser and then two separate
    // deletes removed the edge, so a failure in between left a resolved
    // contradiction that still reported itself as unresolved.
    if (strategy !== 'keep_both') {
      db.transaction((tx) => {
        if (archivedId) {
          tx.update(schema.memories)
            .set({ archivedAt: new Date().toISOString() })
            .where(eq(schema.memories.id, archivedId))
            .run();

          tx.delete(schema.memoryConnections)
            .where(
              or(
                eq(schema.memoryConnections.sourceId, archivedId),
                eq(schema.memoryConnections.targetId, archivedId)
              )
            )
            .run();
        }

        // Drop the contradicts edge in both directions. Archiving already prunes
        // any edge touching the loser, but this also covers the case where no
        // memory was archived.
        for (const [a, b] of [[sourceId, targetId], [targetId, sourceId]] as const) {
          tx.delete(schema.memoryConnections)
            .where(
              and(
                eq(schema.memoryConnections.sourceId, a),
                eq(schema.memoryConnections.targetId, b),
                eq(schema.memoryConnections.relationship, 'contradicts')
              )
            )
            .run();
        }
      });

      // In-memory state and events only after the durable write succeeded.
      if (archivedId) {
        this.vectorSearch.remove(archivedId);
        this.graph.removeNode(archivedId);
        this.webhookManager.fire('forgotten', { id: archivedId });
        void this.pluginRegistry.runHook('onForget', { memoryId: archivedId });
      }
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

  /**
   * Force save the vector index to disk now, blocking until the write completes.
   *
   * Prefer saveIndexAsync from request handlers and other async paths — the write
   * is proportional to the entire index, not to what changed.
   */
  saveIndex(): void {
    this.assertInitialized();
    const indexPath = this.resolveIndexPath();
    if (!indexPath) throw new Error('No index path configured. Set indexPath in BrainConfig or ENGRAM_INDEX_PATH env var.');
    this.vectorSearch.saveToDisk(indexPath);
    this.indexStatus.indexFileExists = true;
  }

  /** Force save the vector index to disk without blocking the event loop. */
  async saveIndexAsync(): Promise<void> {
    this.assertInitialized();
    const indexPath = this.resolveIndexPath();
    if (!indexPath) throw new Error('No index path configured. Set indexPath in BrainConfig or ENGRAM_INDEX_PATH env var.');
    await this.vectorSearch.saveToDiskAsync(indexPath);
    this.indexStatus.indexFileExists = true;
  }

  /** Force a full index rebuild from the database (discards cached index). */
  async rebuildIndex(): Promise<IndexStatus> {
    this.assertInitialized();
    const start = Date.now();
    const db = getDb();

    this.vectorSearch.clear();

    const rebuildConditions = [isNull(schema.memories.archivedAt)];
    if (this.namespaceMode === 'isolated') {
      rebuildConditions.push(eq(schema.memories.namespace, this.activeNamespace!));
    }
    const allMemories = await db
      .select()
      .from(schema.memories)
      .where(and(...rebuildConditions));

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
      await this.vectorSearch.saveToDiskAsync(indexPath);
      this.indexStatus.indexFileExists = true;
    }

    return { ...this.indexStatus };
  }

  /** Get the current index status. */
  /**
   * Current index status.
   *
   * `entryCount` and `dimension` are read from the live index rather than
   * replayed from init, so this never reports a count the index stopped having.
   * The reported count is still only as fresh as the last reconcile — await
   * syncIndexFromStore() first for a caller that needs it exact.
   */
  getIndexStatus(): IndexStatus {
    return {
      ...this.indexStatus,
      entryCount: this.vectorSearch.size,
      dimension: this.vectorSearch.dimension,
    };
  }

  /** Resolve the index file path from config or env. */
  private resolveIndexPath(): string | null {
    const basePath = (
      this.config.indexPath ??
      process.env['ENGRAM_INDEX_PATH'] ??
      (this.config.dbPath ? this.config.dbPath + '.index' : null)
    );
    if (!basePath || this.namespaceMode !== 'isolated') return basePath;
    const scope = createHash('sha256').update(this.activeNamespace!).digest('hex').slice(0, 12);
    return `${basePath}.${scope}`;
  }

  private assertInitialized(): void {
    if (!this.initialized) {
      throw new Error('NeuralBrain not initialized. Call brain.initialize() first.');
    }
  }
}
