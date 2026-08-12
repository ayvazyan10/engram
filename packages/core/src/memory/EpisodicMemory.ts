import { and, desc, eq, gt, isNull, like } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import type { Memory, NewMemory } from '../db/schema.js';
import { embed, packFP16 } from '../embedding/Embedder.js';

export interface StoreEpisodicInput {
  content: string;
  source?: string;
  sessionId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  importance?: number;
  eventAt?: Date;
  /** Namespace to scope this memory to. Defaults to the instance namespace. */
  namespace?: string;
}

/**
 * EpisodicMemory — stores and retrieves time-stamped events and conversations.
 *
 * Analogous to the hippocampus: records what happened, when, and in what context.
 */
export class EpisodicMemory {
  /**
   * @param namespace Scopes writes and reads. NeuralBrain passes its own
   *   namespace so `brain.episodic` cannot leak across tenants — these getters
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

  async store(input: StoreEpisodicInput): Promise<Memory> {
    const db = getDb();
    const now = new Date().toISOString();

    const embedding = await embed(input.content);
    const embeddingBuf = packFP16(embedding);

    const record: NewMemory = {
      id: uuidv4(),
      type: 'episodic',
      content: input.content,
      embedding: embeddingBuf,
      embeddingDim: embedding.length,
      importance: input.importance ?? 0.5,
      source: input.source ?? null,
      sessionId: input.sessionId ?? null,
      eventAt: (input.eventAt ?? new Date()).toISOString(),
      namespace: this.storeNamespace(input.namespace),
      tags: JSON.stringify(input.tags ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.memories).values(record);

    const [inserted] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, record.id))
      .limit(1);

    return inserted!;
  }

  async getBySession(sessionId: string): Promise<Memory[]> {
    const db = getDb();
    return db
      .select()
      .from(schema.memories)
      .where(and(...this.scoped([
        eq(schema.memories.type, 'episodic'),
        eq(schema.memories.sessionId, sessionId),
        isNull(schema.memories.archivedAt),
      ])))
      .orderBy(desc(schema.memories.eventAt));
  }

  async getBySource(source: string, limit: number = 50): Promise<Memory[]> {
    const db = getDb();
    return db
      .select()
      .from(schema.memories)
      .where(and(...this.scoped([
        eq(schema.memories.type, 'episodic'),
        eq(schema.memories.source, source),
        isNull(schema.memories.archivedAt),
      ])))
      .orderBy(desc(schema.memories.createdAt))
      .limit(limit);
  }

  async getRecent(limit: number = 20, since?: Date): Promise<Memory[]> {
    const db = getDb();

    const conditions = this.scoped([
      eq(schema.memories.type, 'episodic'),
      isNull(schema.memories.archivedAt),
    ]);

    if (since) {
      conditions.push(gt(schema.memories.createdAt, since.toISOString()));
    }

    return db
      .select()
      .from(schema.memories)
      .where(and(...conditions))
      .orderBy(desc(schema.memories.createdAt))
      .limit(limit);
  }

  /** Append the namespace predicate when this instance is scoped. */
  private scoped<T>(conditions: T[]): T[] {
    return this.namespaceMode !== 'none' && this.namespace
      ? [...conditions, eq(schema.memories.namespace, this.namespace) as T]
      : conditions;
  }
}
