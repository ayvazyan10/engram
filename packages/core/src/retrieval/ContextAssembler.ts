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

import { eq } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import type { Memory, MemoryType } from '../db/schema.js';
import { embed, packFP16, unpackFP16 } from '../embedding/Embedder.js';
import { KnowledgeGraph } from '../graph/KnowledgeGraph.js';
import { scoreMemory } from './ImportanceScorer.js';
import { VectorSearch } from './VectorSearch.js';

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
    private readonly graph: KnowledgeGraph
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
    } = options;

    const db = getDb();

    // Step 1: Embed the query
    const queryVec = await embed(query);

    // Step 2: Vector search
    const vectorResults = this.vectorSearch.search(queryVec, topK, threshold, types);
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

    // Fetch in batches of 50
    for (let i = 0; i < idList.length; i += 50) {
      const batch = idList.slice(i, i + 50);
      for (const id of batch) {
        const [record] = await db
          .select()
          .from(schema.memories)
          .where(eq(schema.memories.id, id))
          .limit(1);
        if (record && !record.archivedAt) {
          // Apply source filter
          if (sources && record.source && !sources.includes(record.source)) continue;
          records.push(record);
        }
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
      const charLen = item.record.content.length;
      if (totalChars + charLen > maxChars) break;
      selected.push(item);
      totalChars += charLen;
    }

    // Update access counts in DB (fire and forget)
    const now = new Date().toISOString();
    for (const { record } of selected) {
      void db
        .update(schema.memories)
        .set({
          accessCount: record.accessCount + 1,
          lastAccessedAt: now,
        })
        .where(eq(schema.memories.id, record.id));
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
      latencyMs,
    };

    void db.insert(schema.contextAssemblies).values(assemblyLog);

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
