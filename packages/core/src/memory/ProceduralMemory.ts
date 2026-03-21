import { and, desc, eq, isNull } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';
import { getDb, schema } from '../db/index.js';
import type { Memory, NewMemory } from '../db/schema.js';
import { embed, packFP16 } from '../embedding/Embedder.js';

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
}

/**
 * ProceduralMemory — stores patterns, skills, and "when X do Y" rules.
 *
 * Analogous to the basal ganglia: remembers how to do things, what has worked
 * before, and applies learned patterns to new situations.
 */
export class ProceduralMemory {
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
      importance: 0.6,
      confidence: input.confidence ?? 1.0,
      tags: JSON.stringify(input.tags ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.memories).values(record);

    const [inserted] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, record.id!))
      .limit(1);

    return inserted!;
  }

  async getByTrigger(triggerQuery: string): Promise<Memory[]> {
    const db = getDb();
    return db
      .select()
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.type, 'procedural'),
          isNull(schema.memories.archivedAt)
        )
      )
      .orderBy(desc(schema.memories.importance))
      .limit(20);
  }

  async updateConfidence(id: string, newConfidence: number): Promise<void> {
    const db = getDb();
    await db
      .update(schema.memories)
      .set({ confidence: newConfidence, updatedAt: new Date().toISOString() })
      .where(eq(schema.memories.id, id));
  }
}
