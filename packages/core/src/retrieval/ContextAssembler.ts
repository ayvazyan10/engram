/**
 * ContextAssembler — assembles "working memory" for an AI query.
 *
 * The 7-step recall algorithm:
 * 1. Embed the query
 * 2. Vector search across all memory types, optionally fused with BM25
 * 3. Graph traversal: expand to connected memories (depth 2)
 * 4. Importance scoring: combine similarity + recency + importance + access freq
 * 5. Rank and deduplicate
 * 6. Truncate to maxTokens
 * 7. Log to context_assemblies
 */

import { and, inArray, isNull, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import type { Memory, MemoryType } from '../db/schema.js';
import { embed, getEmbeddingModelId, packFP16, unpackFP16 } from '../embedding/Embedder.js';
import { KnowledgeGraph } from '../graph/KnowledgeGraph.js';
import { scoreMemory } from './ImportanceScorer.js';
import { cosineSimilarity, VectorSearch, type SearchResult } from './VectorSearch.js';
import { hybridSearch } from './HybridSearch.js';

/** Phase of the streaming recall pipeline */
export type RecallPhase = 'vector' | 'graph' | 'complete';

/** A single chunk emitted during streaming recall */
export interface RecallChunk {
  /** Phase that produced this chunk */
  phase: RecallPhase;
  /** The memory with its scores */
  memory: RecalledMemory;
  /** Running total of memories yielded so far */
  rank: number;
  /** Partial context string assembled so far (updated each chunk) */
  contextSoFar: string;
}

/** Final event emitted when streaming recall completes */
export interface RecallStreamComplete {
  phase: 'complete';
  /** Full assembled context */
  context: string;
  /** All memories in final scored order */
  memories: RecallResult['memories'];
  /** Total latency */
  latencyMs: number;
}

export interface RecallOptions {
  /** Maximum number of tokens to include in assembled context (approx 4 chars/token) */
  maxTokens?: number;
  /** Update access statistics and log the recall (default: true). */
  touch?: boolean;
  /** Filter by source system */
  sources?: string[];
  /** Filter by memory type */
  types?: MemoryType[];
  /** Inclusive lower bound on eventAt, falling back to createdAt. */
  since?: string;
  /** Inclusive upper bound on eventAt, falling back to createdAt. */
  until?: string;
  /** Every supplied tag must be present. */
  tags?: string[];
  /** Minimum similarity threshold for vector search */
  threshold?: number;
  /** Number of initial vector search candidates */
  topK?: number;
  /** Depth for graph expansion */
  graphDepth?: number;
  /** Source tag for logging */
  source?: string;
  /** Session ID for logging */
  sessionId?: string;
  /** If true, recall across all namespaces regardless of brain's namespace setting */
  crossNamespace?: boolean;
  /** Narrow to an exact project without widening the brain's access scope. */
  namespace?: string;
  /** Narrow to memories whose namespace is NULL. */
  global?: true;
}

export interface RecalledMemory {
  id: string;
  type: MemoryType;
  content: string;
  summary: string | null;
  score: number;
  similarity: number;
  source: string | null;
}

export interface RecallResult {
  /** Formatted context string ready for injection into AI prompt */
  context: string;
  /** Raw memories used, with scores */
  memories: Array<RecalledMemory & { createdAt: string }>;
  /** Time taken in milliseconds */
  latencyMs: number;
}

export interface RouteItem {
  id: string;
  /** One-based score order, including omitted candidates. */
  rank: number;
  /** One-based context order; null when omitted. */
  position: number | null;
  /** Zero-based UTF-16 offset of the bullet in context; null when omitted. */
  offset: number | null;
  section: 'knowledge' | 'patterns' | 'events';
  type: MemoryType;
  source: string | null;
  via: 'vector' | 'graph';
  similarity: number;
  score: number;
  /** Summary/content length used by recall's budget, excluding formatting. */
  chars: number;
  tokens: number;
  included: boolean;
  reason?: 'over_budget';
}

export interface RecallExplanation {
  context: string;
  latencyMs: number;
  budget: { maxTokens: number; usedTokens: number };
  items: RouteItem[];
  /** Number of scored candidates after filters, before budget/topK selection. */
  candidates: number;
}

export interface RecallPlan extends RecallExplanation {
  memories: RecallResult['memories'];
  query: string;
  queryVec: Float32Array;
  options: RecallOptions;
  startTime: number;
  /** Preserve recall's no-audit fast path when retrieval found no candidates. */
  hasCandidates: boolean;
  selected: Array<{ record: Memory; score: number; similarity: number }>;
}

export const FILTER_CANDIDATE_MULTIPLIER = 4;

export function hasRecallFilters(options: RecallOptions): boolean {
  return options.since !== undefined || options.until !== undefined || options.tags !== undefined
    || options.sources !== undefined || options.types !== undefined
    || options.namespace !== undefined || options.global === true;
}

/** Shared by search, recall, and both streaming phases. */
export function matchesMemoryFilters(memory: Memory, options: RecallOptions): boolean {
  if (options.namespace !== undefined && memory.namespace !== options.namespace) return false;
  if (options.global === true && memory.namespace !== null) return false;
  const effectiveDate = new Date(memory.eventAt ?? memory.createdAt).getTime();
  if (options.since !== undefined && effectiveDate < new Date(options.since).getTime()) return false;
  if (options.until !== undefined && effectiveDate > new Date(options.until).getTime()) return false;
  if (options.tags?.length) {
    const tags: string[] = JSON.parse(memory.tags);
    if (!options.tags.every((tag) => tags.includes(tag))) return false;
  }
  return true;
}

export class ContextAssembler {
  constructor(
    private readonly vectorSearch: VectorSearch,
    private readonly graph: KnowledgeGraph,
    private readonly namespace?: string,
    private readonly includeGlobal = false,
    private readonly hybridSearch = false
  ) {}

  async recall(query: string, options: RecallOptions = {}): Promise<RecallResult> {
    return this.commit(await this.plan(query, options));
  }

  private matchesScope(record: Memory, options: RecallOptions): boolean {
    if (!matchesMemoryFilters(record, options)) return false;
    if (options.sources && !options.sources.includes(record.source ?? '')) return false;
    if (options.types && !options.types.includes(record.type)) return false;
    return options.crossNamespace === true || (this.namespace === undefined && !this.includeGlobal)
      || record.namespace === this.namespace || (this.includeGlobal && record.namespace === null);
  }

  /** Select, rank, budget and format using reads and embedding only. */
  async plan(query: string, options: RecallOptions = {}): Promise<RecallPlan> {
    const startTime = Date.now();
    const {
      maxTokens = 2000,
      types,
      threshold = 0.3,
      topK = 20,
      graphDepth = 2,
      crossNamespace,
    } = options;

    const db = getDb();

    // Step 1: Embed the query
    const model = getEmbeddingModelId();
    const queryVec = await embed(query);
    this.vectorSearch.assertModel(model);

    // Step 2: Retrieval (namespace-scoped when configured)
    const filtered = hasRecallFilters(options);
    const candidateLimit = filtered ? topK * FILTER_CANDIDATE_MULTIPLIER : topK;
    const exactNamespace = options.namespace !== undefined || options.global === true;
    const namespace = options.global === true ? null : options.namespace ?? this.namespace;
    const includeGlobal = !exactNamespace && this.includeGlobal;
    const vectorResults: Array<SearchResult & { relevance?: number }> = this.hybridSearch
      ? hybridSearch(this.vectorSearch, query, queryVec, candidateLimit, threshold, types,
        namespace, !exactNamespace && crossNamespace, includeGlobal)
      : this.vectorSearch.search(queryVec, candidateLimit, threshold, types,
        namespace === undefined && includeGlobal ? null : namespace,
        !exactNamespace && crossNamespace, includeGlobal);
    const entries = this.vectorSearch.entriesById();
    const candidateIds = new Set(vectorResults.map((r) => r.id));

    // Step 3: Graph expansion
    const graphNeighbors = this.graph.expand(
      vectorResults.slice(0, 10).map((r) => r.id),
      graphDepth
    );
    for (const neighbor of graphNeighbors) {
      candidateIds.add(neighbor.id);
    }

    // Step 4: Load memory records from DB
    const idList = [...candidateIds];
    const records: Memory[] = [];

    // Fetch in batches of 50 — one query per batch, not one per id.
    for (let i = 0; i < idList.length; i += 50) {
      const batch = idList.slice(i, i + 50);
      const rows = await db
        .select()
        .from(schema.memories)
        .where(inArray(schema.memories.id, batch));

      for (const record of rows) {
        if (record.archivedAt || record.embeddingModel !== model) continue;
        if (this.matchesScope(record, options)) records.push(record);
      }
    }

    // Step 4 cont: Score each memory
    const scored = records.flatMap((record) => {
      const vectorResult = vectorResults.find((r) => r.id === record.id);
      const entry = entries.get(record.id);
      const similarity = vectorResult?.similarity ?? (entry
        ? cosineSimilarity(queryVec, entry.vector, queryVec.length) : 0);
      if (!vectorResult && (!entry || similarity < threshold)) return [];

      const score = scoreMemory({
        similarity: vectorResult?.relevance ?? similarity,
        createdAt: record.createdAt,
        lastAccessedAt: null,
        importance: record.importance,
        accessCount: record.accessCount,
      });

      return [{ record, score, similarity }];
    });

    // Step 5: Sort by score, deduplicate
    scored.sort((a, b) => b.score - a.score);

    // Step 6: Truncate to maxTokens (approx 4 chars per token)
    const maxChars = maxTokens * 4;
    let totalChars = 0;
    const selected: typeof scored = [];
    const selectedTexts = new Set<string>();
    const overBudget = new Set<string>();

    for (const item of scored) {
      if (filtered && selected.length >= topK) break;
      const text = (item.record.summary ?? item.record.content).trim();
      if (selectedTexts.has(text)) continue;
      // formatContext emits `summary ?? content`, so budget against what is
      // actually rendered. Skip (not break) oversized entries so smaller,
      // lower-ranked memories can still fill the budget, and always admit the
      // top-scored memory so recall never returns an empty context.
      const charLen = (item.record.summary ?? item.record.content).length;
      if (selected.length > 0 && totalChars + charLen > maxChars) {
        overBudget.add(item.record.id);
        continue;
      }
      selected.push(item);
      selectedTexts.add(text);
      totalChars += charLen;
    }

    const selectedIds = new Set(selected.map(({ record }) => record.id));
    const vectorIds = new Set(vectorResults.map(({ id }) => id));
    const items: RouteItem[] = scored.map(({ record, score, similarity }, index) => {
      const chars = (record.summary ?? record.content).length;
      return {
        id: record.id,
        rank: index + 1,
        position: null,
        offset: null,
        section: record.type === 'semantic' ? 'knowledge' : record.type === 'procedural' ? 'patterns' : 'events',
        type: record.type as MemoryType,
        source: record.source,
        via: vectorIds.has(record.id) ? 'vector' : 'graph',
        similarity,
        score,
        chars,
        tokens: Math.ceil(chars / 4),
        included: selectedIds.has(record.id),
        ...(overBudget.has(record.id) ? { reason: 'over_budget' as const } : {}),
      };
    });
    const context = formatContext(selected.map((s) => s.record), new Map(items.map((item) => [item.id, item])));

    return {
      context,
      memories: selected.map((s) => ({
        id: s.record.id,
        createdAt: s.record.createdAt,
        type: s.record.type as MemoryType,
        content: s.record.content,
        summary: s.record.summary,
        score: s.score,
        similarity: s.similarity,
        source: s.record.source,
      })),
      latencyMs: Date.now() - startTime,
      budget: { maxTokens, usedTokens: Math.ceil(totalChars / 4) },
      items,
      candidates: scored.length,
      query,
      queryVec,
      options,
      startTime,
      hasCandidates: candidateIds.size > 0,
      selected,
    };
  }

  /** Persist the access statistics and audit row for a completed plan. */
  async commit(plan: RecallPlan): Promise<RecallResult> {
    const { options, selected } = plan;
    if (!plan.hasCandidates) return { context: plan.context, memories: plan.memories, latencyMs: plan.latencyMs };

    // A stream may have paused after any chunk. Check visibility in the same
    // transaction as the audit so a concurrent forget cannot be logged again.
    return getDb().transaction((tx) => {
      const rows = tx.select().from(schema.memories).where(and(
        inArray(schema.memories.id, selected.map(({ record }) => record.id)),
        isNull(schema.memories.archivedAt),
      )).all().filter((row) => this.matchesScope(row, options));
      const liveIds = new Set(rows.map((row) => row.id));
      const memories = plan.memories.filter((m) => liveIds.has(m.id));
      const context = memories.length === selected.length ? plan.context
        : formatContext(selected.filter(({ record }) => liveIds.has(record.id)).map(({ record }) => record));
      if (options.touch === false) return { context, memories, latencyMs: plan.latencyMs };

      const now = new Date().toISOString();
      const accessed = rows.filter((row) => !this.includeGlobal || row.namespace === this.namespace || row.namespace === null);
      if (accessed.length > 0) {
        // Access counts merge independently of the sync revision.
        tx.update(schema.memories).set({
          accessCount: sql`${schema.memories.accessCount} + 1`,
          lastAccessedAt: now,
        }).where(inArray(schema.memories.id, accessed.map((row) => row.id))).run();
      }

      const latencyMs = Date.now() - plan.startTime;
      tx.insert(schema.contextAssemblies).values({
        id: uuidv4(),
        query: plan.query,
        queryEmbedding: packFP16(plan.queryVec),
        assembledContext: JSON.stringify(memories.map(({ id, score, type }) => ({ memoryId: id, score, type }))),
        source: options.source ?? null,
        sessionId: options.sessionId ?? null,
        namespace: this.namespace ?? null,
        latencyMs,
        createdAt: now,
      }).run();
      return { context, memories, latencyMs };
    }, { behavior: options.touch === false ? 'deferred' : 'immediate' });
  }

  /**
   * Streaming recall — yields memories selected and budgeted by plan().
   *
   * Phase 1 (vector): Selected vector search results, in score order.
   * Phase 2 (graph): Selected graph-expanded neighbors, in score order.
   * Phase 3 (complete): Commit the plan and yield the full assembled context.
   *
   * @param query The recall query
   * @param options Standard recall options
   * @yields RecallChunk for each memory, then RecallStreamComplete
   */
  async *recallStream(
    query: string,
    options: RecallOptions = {}
  ): AsyncGenerator<RecallChunk | RecallStreamComplete> {
    const plan = await this.plan(query, options);
    const origins = new Map(plan.items.map(({ id, via }) => [id, via]));
    const yielded: Memory[] = [];

    for (const phase of ['vector', 'graph'] as const) {
      for (const [index, { record }] of plan.selected.entries()) {
        if (origins.get(record.id) !== phase) continue;
        yielded.push(record);
        yield {
          phase,
          memory: plan.memories[index]!,
          rank: yielded.length,
          contextSoFar: formatContext(yielded),
        };
      }
    }

    yield { phase: 'complete', ...await this.commit(plan) };
  }
}

function formatContext(memories: Memory[], items?: Map<string, RouteItem>): string {
  if (memories.length === 0) return '';

  const sections: string[] = ['[NEURAL MEMORY CONTEXT]'];
  let position = 0;
  const appendMemory = (memory: Memory, line: string): void => {
    const item = items?.get(memory.id);
    if (item) {
      item.position = ++position;
      item.offset = sections.join('\n').length + 1;
    }
    sections.push(line);
  };

  const episodic = memories.filter((m) => m.type === 'episodic');
  const semantic = memories.filter((m) => m.type === 'semantic');
  const procedural = memories.filter((m) => m.type === 'procedural');

  if (semantic.length > 0) {
    sections.push('\n[KNOWLEDGE]');
    for (const m of semantic) {
      appendMemory(m, `• [${m.id.slice(0, 8)} · ${m.createdAt.slice(0, 10)}] ${m.summary ?? m.content}`);
    }
  }

  if (procedural.length > 0) {
    sections.push('\n[PATTERNS & SKILLS]');
    for (const m of procedural) {
      appendMemory(m, `• [${m.id.slice(0, 8)} · ${m.createdAt.slice(0, 10)}] ${m.summary ?? m.content}`);
    }
  }

  if (episodic.length > 0) {
    sections.push('\n[PAST EVENTS & CONVERSATIONS]');
    for (const m of episodic) {
      const when = (m.eventAt ?? m.createdAt).slice(0, 10);
      const src = m.source ? `[${m.source}] ` : '';
      appendMemory(m, `• [${m.id.slice(0, 8)} · ${when}] ${src}${m.summary ?? m.content}`);
    }
  }

  sections.push('\n[END MEMORY CONTEXT]');
  return sections.join('\n');
}

export { unpackFP16 };
