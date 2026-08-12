import { and, eq, inArray, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import type { Memory, NewMemory, NewMemoryConnection, RelationshipType } from '../db/schema.js';
import { embed, packFP16 } from '../embedding/Embedder.js';

export interface StoreSemanticInput {
  concept: string;
  content: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  importance?: number;
  confidence?: number;
  /** Namespace to scope this memory to. Defaults to the instance namespace. */
  namespace?: string;
  /** Auto-link to existing concepts by relationship */
  relatesTo?: Array<{ conceptId: string; relationship: RelationshipType; strength?: number }>;
}

/**
 * SemanticMemory — stores facts, knowledge, and concepts in a knowledge graph.
 *
 * Analogous to the temporal and parietal lobes: knows what things are,
 * how they relate, and maintains a web of interconnected knowledge.
 */
export class SemanticMemory {
  /**
   * @param namespace Scopes writes and reads. NeuralBrain passes its own
   *   namespace so `brain.semantic` cannot leak across tenants — these getters
   *   previously spanned every namespace.
   */
  constructor(
    private readonly namespace?: string,
    namespaceMode?: 'none' | 'filter' | 'isolated',
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

  async store(input: StoreSemanticInput): Promise<Memory> {
    const db = getDb();
    const now = new Date().toISOString();

    const fullText = `${input.concept}: ${input.content}`;
    const embedding = await embed(fullText);
    const embeddingBuf = packFP16(embedding);

    const record: NewMemory = {
      id: uuidv4(),
      type: 'semantic',
      content: input.content,
      concept: input.concept,
      embedding: embeddingBuf,
      embeddingDim: embedding.length,
      importance: input.importance ?? 0.7, // semantic memories are generally more important
      confidence: input.confidence ?? 1.0,
      namespace: this.storeNamespace(input.namespace),
      tags: JSON.stringify(input.tags ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    };

    const connections: NewMemoryConnection[] = (input.relatesTo ?? []).map((rel) => ({
      id: uuidv4(),
      sourceId: record.id!,
      targetId: rel.conceptId,
      relationship: rel.relationship,
      strength: rel.strength ?? 1.0,
      bidirectional: rel.relationship === 'relates_to',
      metadata: '{}',
      createdAt: now,
    }));

    if (this.namespaceMode === 'isolated' && connections.length > 0) {
      const targetIds = connections.map((connection) => connection.targetId);
      const targets = await db.select({ id: schema.memories.id, namespace: schema.memories.namespace })
        .from(schema.memories)
        .where(inArray(schema.memories.id, targetIds));
      if (targets.length !== new Set(targetIds).size || targets.some((target) => target.namespace !== this.namespace)) {
        throw new Error('cannot link memories across isolated namespaces');
      }
    }

    // Atomic. targetId is a NOT NULL foreign key, so a caller-supplied
    // relatesTo.conceptId that does not reference an existing memory used to
    // throw AFTER the memory row was already committed: store() rejected while
    // leaving an orphaned, edge-less memory behind, and a retry then created a
    // duplicate. Embedding happens above because the callback must stay sync.
    db.transaction((tx) => {
      tx.insert(schema.memories).values(record).run();
      if (connections.length > 0) {
        tx.insert(schema.memoryConnections).values(connections).run();
      }
    });

    const [inserted] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, record.id!))
      .limit(1);

    return inserted!;
  }

  async getByConcept(concept: string): Promise<Memory | undefined> {
    const db = getDb();
    const conditions = [
      eq(schema.memories.type, 'semantic'),
      eq(schema.memories.concept, concept),
      isNull(schema.memories.archivedAt),
    ];
    if (this.namespaceMode !== 'none' && this.namespace) conditions.push(eq(schema.memories.namespace, this.namespace));

    const [record] = await db
      .select()
      .from(schema.memories)
      .where(and(...conditions))
      .limit(1);
    return record;
  }

  async update(id: string, updates: { content?: string; confidence?: number; importance?: number }): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();

    const updateData: Partial<NewMemory> = {
      updatedAt: now,
    };

    if (updates.content !== undefined) {
      updateData.content = updates.content;

      // Re-embed with the SAME template store() uses (`concept: content`).
      // Embedding the bare content desynced the vector from every sibling — and
      // from the record's own original vector — so a concept-bearing query
      // scored the freshest fact lower than stale ones.
      const [existing] = await db
        .select({ concept: schema.memories.concept, namespace: schema.memories.namespace })
        .from(schema.memories)
        .where(eq(schema.memories.id, id))
        .limit(1);

      if (!existing || (this.namespaceMode === 'isolated' && existing.namespace !== this.namespace)) {
        throw new Error(`Memory ${id} not found`);
      }

      const embeddable = existing.concept
        ? `${existing.concept}: ${updates.content}`
        : updates.content;

      const embedding = await embed(embeddable);
      updateData.embedding = packFP16(embedding);
      updateData.embeddingDim = embedding.length;
    }
    if (updates.confidence !== undefined) updateData.confidence = updates.confidence;
    if (updates.importance !== undefined) updateData.importance = updates.importance;

    if (updates.content === undefined && this.namespaceMode === 'isolated') {
      const [existing] = await db.select({ namespace: schema.memories.namespace })
        .from(schema.memories).where(eq(schema.memories.id, id)).limit(1);
      if (!existing || existing.namespace !== this.namespace) throw new Error(`Memory ${id} not found`);
    }

    await db.update(schema.memories).set(updateData).where(eq(schema.memories.id, id));
  }
}
