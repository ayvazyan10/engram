import { and, eq, isNull } from 'drizzle-orm';
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
      tags: JSON.stringify(input.tags ?? []),
      metadata: JSON.stringify(input.metadata ?? {}),
      createdAt: now,
      updatedAt: now,
    };

    await db.insert(schema.memories).values(record);

    // Create relationship edges if specified
    if (input.relatesTo && input.relatesTo.length > 0) {
      const connections: NewMemoryConnection[] = input.relatesTo.map((rel) => ({
        id: uuidv4(),
        sourceId: record.id!,
        targetId: rel.conceptId,
        relationship: rel.relationship,
        strength: rel.strength ?? 1.0,
        bidirectional: rel.relationship === 'relates_to',
        metadata: '{}',
        createdAt: now,
      }));

      await db.insert(schema.memoryConnections).values(connections);
    }

    const [inserted] = await db
      .select()
      .from(schema.memories)
      .where(eq(schema.memories.id, record.id!))
      .limit(1);

    return inserted!;
  }

  async getByConcept(concept: string): Promise<Memory | undefined> {
    const db = getDb();
    const [record] = await db
      .select()
      .from(schema.memories)
      .where(
        and(
          eq(schema.memories.type, 'semantic'),
          eq(schema.memories.concept, concept),
          isNull(schema.memories.archivedAt)
        )
      )
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
      // Re-embed on content change
      const embedding = await embed(updates.content);
      updateData.embedding = packFP16(embedding);
    }
    if (updates.confidence !== undefined) updateData.confidence = updates.confidence;
    if (updates.importance !== undefined) updateData.importance = updates.importance;

    await db.update(schema.memories).set(updateData).where(eq(schema.memories.id, id));
  }
}
