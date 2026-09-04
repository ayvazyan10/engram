/**
 * ContextAssembler — assembles "working memory" for an AI query.
 *
 * The 7-step recall algorithm:
 * 1. Embed the query
 * 2. Vector search across all memory types
 * 3. Graph traversal: expand to connected memories (depth 2)
 * 4. Importance scoring: combine similarity + recency + importance + access freq
 * 5. Rank and deduplicate
 * 6. Truncate to maxTokens
 * 7. Log to context_assemblies
 */

import { eq, inArray, sql } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import type { Memory, MemoryType } from '../db/schema.js';
import { embed, packFP16, unpackFP16 } from '../embedding/Embedder.js';
import { KnowledgeGraph } from '../graph/KnowledgeGraph.js';
import { scoreMemory } from './ImportanceScorer.js';
import { VectorSearch } from './VectorSearch.js';

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
  memories: RecalledMemory[];
  /** Total latency */
  latencyMs: number;
}

export interface RecallOptions {
  /** Maximum number of tokens to include in assembled context (approx 4 chars/token) */
  maxTokens?: number;
  /** Filter by source system */
  sources?: string[];
  /** Filter by memory type */
  types?: MemoryType[];
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
  memories: RecalledMemory[];
  /** Time taken in milliseconds */
  latencyMs: number;
}

export class ContextAssembler {
  constructor(
    private readonly vectorSearch: VectorSearch,
    private readonly graph: KnowledgeGraph,
    private readonly namespace?: string
  ) {}

  async recall(query: string, options: RecallOptions = {}): Promise<RecallResult> {
    const startTime = Date.now();
    const {
      maxTokens = 2000,
      sources,
      types,
      threshold = 0.3,
      topK = 20,
      graphDepth = 2,
      source,
      sessionId,
      crossNamespace,
    } = options;

    const db = getDb();

    // Step 1: Embed the query
    const queryVec = await embed(query);

    // Step 2: Vector search (namespace-scoped when configured)
    const vectorResults = this.vectorSearch.search(queryVec, topK, threshold, types, this.namespace, crossNamespace);
    const candidateIds = new Set(vectorResults.map((r) => r.id));

    // Step 3: Graph expansion
    const graphNeighbors = this.graph.expand(
      vectorResults.slice(0, 10).map((r) => r.id),
      graphDepth
    );
    for (const neighbor of graphNeighbors) {
      candidateIds.add(neighbor.id);
    }

    if (candidateIds.size === 0) {
      return {
        context: '',
        memories: [],
        latencyMs: Date.now() - startTime,
      };
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
        if (record.archivedAt) continue;
        // Apply source filter
        if (sources && record.source && !sources.includes(record.source)) continue;
        // Apply type filter. The vector search already honours `types`, but
        // graph expansion reaches memories it never scored, so without this the
        // documented "Filter by memory type" leaked neighbours of every other
        // type into the result — and rendered whole sections for them.
        if (types && !types.includes(record.type as MemoryType)) continue;
        // Apply namespace filter
        if (this.namespace && !crossNamespace && record.namespace !== this.namespace) continue;
        records.push(record);
      }
    }

    // Step 4 cont: Score each memory
    const scored = records.map((record) => {
      const vectorResult = vectorResults.find((r) => r.id === record.id);
      const similarity = vectorResult?.similarity ?? 0.1; // graph-expanded get lower base

      const score = scoreMemory({
        similarity,
        createdAt: record.createdAt,
        lastAccessedAt: record.lastAccessedAt,
        importance: record.importance,
        accessCount: record.accessCount,
      });

      return { record, score, similarity };
    });

    // Step 5: Sort by score, deduplicate
    scored.sort((a, b) => b.score - a.score);

    // Step 6: Truncate to maxTokens (approx 4 chars per token)
    const maxChars = maxTokens * 4;
    let totalChars = 0;
    const selected: typeof scored = [];

    for (const item of scored) {
      // formatContext emits `summary ?? content`, so budget against what is
      // actually rendered. Skip (not break) oversized entries so smaller,
      // lower-ranked memories can still fill the budget, and always admit the
      // top-scored memory so recall never returns an empty context.
      const charLen = (item.record.summary ?? item.record.content).length;
      if (selected.length > 0 && totalChars + charLen > maxChars) continue;
      selected.push(item);
      totalChars += charLen;
    }

    // Update access counts in DB. These must be awaited: drizzle query builders
    // are lazy, so a bare `void db.update(...)` never sends the statement. The
    // increment is done in SQL so concurrent recalls cannot clobber each other.
    //
    // Deliberately does NOT set `updatedAt` here. Bumping it on every recall
    // would push every recalled memory to the cloud on every agent turn —
    // dozens of rows per call. `access_count` is designed to be write-hot
    // (see the raw `+ 1` above) and gets its own MAX-merge sync rule in a
    // later phase instead of last-write-wins; do not "fix" this to bump
    // updatedAt without that rule in place.
    const now = new Date().toISOString();
    if (selected.length > 0) {
      await db
        .update(schema.memories)
        .set({
          accessCount: sql`${schema.memories.accessCount} + 1`,
          lastAccessedAt: now,
        })
        .where(inArray(schema.memories.id, selected.map((s) => s.record.id)));
    }

    // Format context
    const context = formatContext(selected.map((s) => s.record));

    const latencyMs = Date.now() - startTime;

    // Step 7: Log to context_assemblies
    const assemblyLog = {
      id: uuidv4(),
      query,
      queryEmbedding: packFP16(queryVec),
      assembledContext: JSON.stringify(
        selected.map((s) => ({
          memoryId: s.record.id,
          score: s.score,
          type: s.record.type,
        }))
      ),
      source: source ?? null,
      sessionId: sessionId ?? null,
      namespace: this.namespace ?? null,
      latencyMs,
      // Explicit ISO timestamp — the column's `CURRENT_TIMESTAMP` default
      // yields second-precision "2026-08-25 14:23:01" with no T/Z, breaking
      // any last-write-wins comparison against the millisecond ISO strings
      // every other write site produces.
      createdAt: now,
    };

    await db.insert(schema.contextAssemblies).values(assemblyLog);

    return {
      context,
      memories: selected.map((s) => ({
        id: s.record.id,
        type: s.record.type as MemoryType,
        content: s.record.content,
        summary: s.record.summary,
        score: s.score,
        similarity: s.similarity,
        source: s.record.source,
      })),
      latencyMs,
    };
  }

  /**
   * Streaming recall — yields memories progressively as they're found and scored.
   *
   * Phase 1 (vector): High-confidence vector search results, yielded immediately.
   * Phase 2 (graph): Graph-expanded neighbors, scored and yielded.
   * Phase 3 (complete): Final event with full assembled context.
   *
   * @param query The recall query
   * @param options Standard recall options
   * @yields RecallChunk for each memory, then RecallStreamComplete
   */
  async *recallStream(
    query: string,
    options: RecallOptions = {}
  ): AsyncGenerator<RecallChunk | RecallStreamComplete> {
    const startTime = Date.now();
    const {
      maxTokens = 2000,
      sources,
      types,
      threshold = 0.3,
      topK = 20,
      graphDepth = 2,
      source,
      sessionId,
      crossNamespace,
    } = options;

    const db = getDb();
    const maxChars = maxTokens * 4;
    let totalChars = 0;
    let rank = 0;

    // Track all yielded memories for final context and dedup
    const yieldedIds = new Set<string>();
    const allYielded: Array<{ record: Memory; score: number; similarity: number }> = [];

    // Step 1: Embed query
    const queryVec = await embed(query);

    // Step 2: Vector search — yield results immediately as Phase 1
    const vectorResults = this.vectorSearch.search(queryVec, topK, threshold, types, this.namespace, crossNamespace);

    for (const vr of vectorResults) {
      if (totalChars >= maxChars) break;

      const [record] = await db
        .select()
        .from(schema.memories)
        .where(eq(schema.memories.id, vr.id))
        .limit(1);

      if (!record || record.archivedAt) continue;
      if (sources && record.source && !sources.includes(record.source)) continue;
      if (types && !types.includes(record.type as MemoryType)) continue;
      if (this.namespace && !crossNamespace && record.namespace !== this.namespace) continue;

      const score = scoreMemory({
        similarity: vr.similarity,
        createdAt: record.createdAt,
        lastAccessedAt: record.lastAccessedAt,
        importance: record.importance,
        accessCount: record.accessCount,
      });

      yieldedIds.add(record.id);
      allYielded.push({ record, score, similarity: vr.similarity });
      totalChars += record.content.length;
      rank++;

      const recalled: RecalledMemory = {
        id: record.id,
        type: record.type as MemoryType,
        content: record.content,
        summary: record.summary,
        score,
        similarity: vr.similarity,
        source: record.source,
      };

      yield {
        phase: 'vector',
        memory: recalled,
        rank,
        contextSoFar: formatContext(allYielded.map((y) => y.record)),
      };
    }

    // Step 3: Graph expansion — yield new neighbors as Phase 2
    const graphNeighbors = this.graph.expand(
      vectorResults.slice(0, 10).map((r) => r.id),
      graphDepth
    );

    for (const neighbor of graphNeighbors) {
      if (yieldedIds.has(neighbor.id)) continue;
      if (totalChars >= maxChars) break;

      const [record] = await db
        .select()
        .from(schema.memories)
        .where(eq(schema.memories.id, neighbor.id))
        .limit(1);

      if (!record || record.archivedAt) continue;
      if (sources && record.source && !sources.includes(record.source)) continue;
      // See recall(): expansion reaches memories the vector search never
      // filtered, so the type filter has to be re-applied here.
      if (types && !types.includes(record.type as MemoryType)) continue;
      if (this.namespace && !crossNamespace && record.namespace !== this.namespace) continue;

      // Graph-expanded memories get a lower base similarity
      const similarity = 0.1;
      const score = scoreMemory({
        similarity,
        createdAt: record.createdAt,
        lastAccessedAt: record.lastAccessedAt,
        importance: record.importance,
        accessCount: record.accessCount,
      });

      yieldedIds.add(record.id);
      allYielded.push({ record, score, similarity });
      totalChars += record.content.length;
      rank++;

      const recalled: RecalledMemory = {
        id: record.id,
        type: record.type as MemoryType,
        content: record.content,
        summary: record.summary,
        score,
        similarity,
        source: record.source,
      };

      yield {
        phase: 'graph',
        memory: recalled,
        rank,
        contextSoFar: formatContext(allYielded.map((y) => y.record)),
      };
    }

    // Update access counts — awaited and incremented in SQL (see recall()).
    // Deliberately does NOT set `updatedAt` — see the comment in recall();
    // access_count is intentionally excluded from last-write-wins sync.
    const now = new Date().toISOString();
    if (allYielded.length > 0) {
      await db
        .update(schema.memories)
        .set({
          accessCount: sql`${schema.memories.accessCount} + 1`,
          lastAccessedAt: now,
        })
        .where(inArray(schema.memories.id, allYielded.map((y) => y.record.id)));
    }

    // Log to context_assemblies
    const latencyMs = Date.now() - startTime;
    await db.insert(schema.contextAssemblies).values({
      id: uuidv4(),
      query,
      queryEmbedding: packFP16(queryVec),
      assembledContext: JSON.stringify(
        allYielded.map((s) => ({
          memoryId: s.record.id,
          score: s.score,
          type: s.record.type,
        }))
      ),
      source: source ?? null,
      sessionId: sessionId ?? null,
      namespace: this.namespace ?? null,
      latencyMs,
      // See recall() — explicit ISO timestamp instead of the CURRENT_TIMESTAMP
      // column default, which is second-precision with no T/Z.
      createdAt: now,
    });

    // Final sort by score for the complete context
    allYielded.sort((a, b) => b.score - a.score);
    const finalContext = formatContext(allYielded.map((y) => y.record));

    // Phase 3: Complete
    yield {
      phase: 'complete',
      context: finalContext,
      memories: allYielded.map((y) => ({
        id: y.record.id,
        type: y.record.type as MemoryType,
        content: y.record.content,
        summary: y.record.summary,
        score: y.score,
        similarity: y.similarity,
        source: y.record.source,
      })),
      latencyMs,
    };
  }
}

function formatContext(memories: Memory[]): string {
  if (memories.length === 0) return '';

  const sections: string[] = ['[NEURAL MEMORY CONTEXT]'];

  const episodic = memories.filter((m) => m.type === 'episodic');
  const semantic = memories.filter((m) => m.type === 'semantic');
  const procedural = memories.filter((m) => m.type === 'procedural');

  if (semantic.length > 0) {
    sections.push('\n[KNOWLEDGE]');
    for (const m of semantic) {
      sections.push(`• ${m.summary ?? m.content}`);
    }
  }

  if (procedural.length > 0) {
    sections.push('\n[PATTERNS & SKILLS]');
    for (const m of procedural) {
      sections.push(`• ${m.summary ?? m.content}`);
    }
  }

  if (episodic.length > 0) {
    sections.push('\n[PAST EVENTS & CONVERSATIONS]');
    for (const m of episodic) {
      const when = m.eventAt ? new Date(m.eventAt).toLocaleDateString() : '';
      const src = m.source ? `[${m.source}]` : '';
      sections.push(`• ${when} ${src} ${m.summary ?? m.content}`.trim());
    }
  }

  sections.push('\n[END MEMORY CONTEXT]');
  return sections.join('\n');
}

export { unpackFP16 };
