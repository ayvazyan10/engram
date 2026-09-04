import { and, desc, eq, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import type { Memory, NewMemory } from '../db/schema.js';
import { embed, getEmbeddingModelId, packFP16, unpackFP16 } from '../embedding/Embedder.js';
import { getDeviceId } from '../sync/deviceId.js';
import type { MemoryIndexSink } from './MemoryIndexSink.js';

/**
 * Cosine similarity between two embedding vectors of the SAME length.
 *
 * Equal length is a precondition, not a detail to paper over. Iterating
 * Math.min(a.length, b.length) scored a 384-dim rule left behind by a previous
 * embedding model against the first 384 components of a 768-dim query — noise,
 * and noise confident enough to clear a similarity threshold, with no throw and
 * no skip. VectorSearch.upsert refuses the same mismatch for the same reason.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(
      `Vector dimension mismatch: cannot compare a ${a.length}-dim vector with a ${b.length}-dim one`
    );
  }
  const len = a.length;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface StoreProceduralInput {
  /** Description of when this pattern/skill applies */
  triggerPattern: string;
  /** Description of what to do */
  actionPattern: string;
  /** Human-readable description of the skill */
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  confidence?: number;
  /** Namespace to scope this memory to. Defaults to the instance namespace. */
  namespace?: string;
}

/**
 * ProceduralMemory — stores patterns, skills, and "when X do Y" rules.
 *
 * Analogous to the basal ganglia: remembers how to do things, what has worked
 * before, and applies learned patterns to new situations.
 */
export class ProceduralMemory {
  /**
   * @param namespace Scopes writes and reads. NeuralBrain passes its own
   *   namespace so `brain.procedural` cannot leak across tenants.
   * @param indexSink Receives every committed row so it reaches the brain's
   *   vector index and graph. Without it a memory written here is stored but
   *   unsearchable — see MemoryIndexSink.
   */
  constructor(
    private readonly namespace?: string,
    namespaceMode?: 'none' | 'filter' | 'isolated',
    private readonly indexSink?: MemoryIndexSink,
  ) {
    this.namespaceMode = namespaceMode ?? (namespace ? 'filter' : 'none');
    if (this.namespaceMode === 'isolated' && !namespace) throw new Error('namespace is required in isolated mode');
  }

  private readonly namespaceMode: 'none' | 'filter' | 'isolated';

  private storeNamespace(requested?: string): string | null {
    if (this.namespaceMode === 'none') return null;
    if (this.namespaceMode === 'isolated' && requested && requested !== this.namespace) {
      throw new Error('namespace override is not allowed in isolated mode');
    }
    return this.namespaceMode === 'isolated' ? this.namespace! : requested ?? this.namespace ?? null;
  }

  async store(input: StoreProceduralInput): Promise<Memory> {
    const db = getDb();
    const now = new Date().toISOString();

    // Embed both trigger and action for better retrieval
    const embeddableText = `${input.triggerPattern} → ${input.actionPattern}. ${input.content}`;
    const embedding = await embed(embeddableText);
    const embeddingBuf = packFP16(embedding);

    const record: NewMemory = {
      id: uuidv4(),
      type: 'procedural',
      content: input.content,
      triggerPattern: input.triggerPattern,
      actionPattern: input.actionPattern,
      embedding: embeddingBuf,
      embeddingDim: embedding.length,
      embeddingModel: getEmbeddingModelId(),
      importance: 0.6,
      confidence: input.confidence ?? 1.0,
      namespace: this.storeNamespace(input.namespace),
      tags: JSON.stringify(input.tags ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
      deviceId: getDeviceId(),
    };

    await db.insert(schema.memories).values(record);

    // Index and graph only after the durable write succeeded, so in-memory
    // state can never run ahead of the database.
    await this.indexSink?.onMemoryWritten({
      id: record.id!,
      type: 'procedural',
      namespace: record.namespace ?? null,
      vector: embedding,
    });

    const [inserted] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, record.id!))
      .limit(1);

    return inserted!;
  }

  /**
   * Retrieve procedural rules whose trigger matches the given situation.
   *
   * Ranks by embedding similarity between the query and the stored
   * "trigger → action" text. Previously this ignored `triggerQuery` entirely
   * and returned the top-20 procedural memories by importance, so callers got
   * unrelated rules back.
   */
  async getByTrigger(triggerQuery: string, minSimilarity = 0.3, limit = 20): Promise<Memory[]> {
    const query = triggerQuery.trim();
    if (!query) return [];

    const db = getDb();
    const conditions = [
      eq(schema.memories.type, 'procedural'),
      isNull(schema.memories.archivedAt),
    ];
    if (this.namespaceMode !== 'none' && this.namespace) conditions.push(eq(schema.memories.namespace, this.namespace));

    const candidates = await db
      .select()
      .from(schema.memories)
      .where(and(...conditions))
      .orderBy(desc(schema.memories.importance));

    if (candidates.length === 0) return [];

    const queryVec = await embed(query);

    const ranked: Array<{ memory: Memory; similarity: number }> = [];
    for (const memory of candidates) {
      if (!memory.embedding) continue;
      const vec = unpackFP16(Buffer.from(memory.embedding as ArrayBuffer));
      // A rule embedded by another model cannot be compared to this query.
      // Skipped rather than fatal, exactly as the vector index treats the same
      // row: it stays stored and readable, and re_embed brings it back into
      // matching. Returning it on a prefix score would be worse than missing it.
      if (vec.length !== queryVec.length) continue;
      const similarity = cosineSimilarity(queryVec, vec);
      if (similarity >= minSimilarity) ranked.push({ memory, similarity });
    }
    ranked.sort((a, b) => b.similarity - a.similarity);

    return ranked.slice(0, limit).map((r) => r.memory);
  }

  async updateConfidence(id: string, newConfidence: number): Promise<void> {
    const db = getDb();
    await db
      .update(schema.memories)
      .set({ confidence: newConfidence, updatedAt: new Date().toISOString(), deviceId: getDeviceId() })
      .where(eq(schema.memories.id, id));
  }
}
