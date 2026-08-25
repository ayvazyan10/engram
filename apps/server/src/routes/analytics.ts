import type { FastifyPluginAsync } from 'fastify';
import { getDb, getDeviceId, schema, embed, packFP16 } from '@engram-ai-memory/core';
import type { MemoryType } from '@engram-ai-memory/core';
import { isNull, and, eq, sql, gte, desc } from 'drizzle-orm';
import { brain } from '../index.js';

export const analyticsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { days?: string } }>('/analytics', {
    schema: {
      tags: ['analytics'],
      summary: 'Aggregated memory analytics: growth, activity heatmap, top concepts',
      // Without bounds, ?days=abc produced NaN and the Date math threw a 500.
      querystring: {
        type: 'object',
        properties: {
          days: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
        },
      },
    },
    handler: async (req) => {
      const db = getDb();
      const days = parseInt(req.query.days ?? '30', 10);
      const since = new Date(Date.now() - days * 86400000).toISOString();

      const ns = brain.getNamespace();
      const nsCond = ns ? eq(schema.memories.namespace, ns) : undefined;
      const baseWhere = nsCond
        ? and(isNull(schema.memories.archivedAt), nsCond)
        : isNull(schema.memories.archivedAt);

      const [totalRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(schema.memories)
        .where(baseWhere);

      const byType = await db
        .select({
          type: schema.memories.type,
          count: sql<number>`count(*)`,
        })
        .from(schema.memories)
        .where(baseWhere)
        .groupBy(schema.memories.type);

      const bySource = await db
        .select({
          source: schema.memories.source,
          count: sql<number>`count(*)`,
        })
        .from(schema.memories)
        .where(baseWhere)
        .groupBy(schema.memories.source);

      const recentWhere = nsCond
        ? and(isNull(schema.memories.archivedAt), nsCond, gte(schema.memories.createdAt, since))
        : and(isNull(schema.memories.archivedAt), gte(schema.memories.createdAt, since));

      const dailyGrowth = await db
        .select({
          date: sql<string>`date(${schema.memories.createdAt})`,
          count: sql<number>`count(*)`,
        })
        .from(schema.memories)
        .where(recentWhere)
        .groupBy(sql`date(${schema.memories.createdAt})`)
        .orderBy(sql`date(${schema.memories.createdAt})`);

      const hourlyActivity = await db
        .select({
          hour: sql<number>`cast(strftime('%H', ${schema.memories.createdAt}) as integer)`,
          dayOfWeek: sql<number>`cast(strftime('%w', ${schema.memories.createdAt}) as integer)`,
          count: sql<number>`count(*)`,
        })
        .from(schema.memories)
        .where(recentWhere)
        .groupBy(
          sql`cast(strftime('%H', ${schema.memories.createdAt}) as integer)`,
          sql`cast(strftime('%w', ${schema.memories.createdAt}) as integer)`
        );

      const topConcepts = await db
        .select({
          concept: schema.memories.concept,
          count: sql<number>`count(*)`,
          avgImportance: sql<number>`avg(${schema.memories.importance})`,
        })
        .from(schema.memories)
        .where(and(baseWhere, sql`${schema.memories.concept} is not null`))
        .groupBy(schema.memories.concept)
        .orderBy(desc(sql`count(*)`))
        .limit(20);

      const avgImportance = await db
        .select({ avg: sql<number>`avg(${schema.memories.importance})` })
        .from(schema.memories)
        .where(baseWhere);

      return {
        total: totalRow?.count ?? 0,
        avgImportance: avgImportance[0]?.avg ?? 0,
        byType: Object.fromEntries(byType.map((r) => [r.type, r.count])),
        bySource: Object.fromEntries(bySource.map((r) => [r.source ?? 'unknown', r.count])),
        dailyGrowth,
        hourlyActivity,
        topConcepts,
      };
    },
  });

  app.patch<{
    Params: { id: string };
    Body: { content?: string; importance?: number; tags?: string[]; concept?: string };
  }>('/memory/:id', {
    schema: {
      tags: ['memory'],
      summary: 'Inline edit a memory (content, importance, tags, concept)',
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', minLength: 1 },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          tags: { type: 'array', items: { type: 'string' } },
          concept: { type: 'string' },
        },
      },
    },
    handler: async (req, reply) => {
      const db = getDb();
      const { id } = req.params;
      const { content, importance, tags, concept } = req.body;

      const [existing] = await db
        .select()
        .from(schema.memories)
        .where(eq(schema.memories.id, id))
        .limit(1);

      if (!existing || !brain.canAccessNamespace(existing.namespace)) {
        reply.code(404);
        return { error: 'Memory not found' };
      }

      const updates: Record<string, unknown> = {
        updatedAt: new Date().toISOString(),
        deviceId: getDeviceId(),
      };
      if (content !== undefined) updates['content'] = content;
      if (importance !== undefined) updates['importance'] = importance;
      if (tags !== undefined) updates['tags'] = JSON.stringify(tags);
      if (concept !== undefined) updates['concept'] = concept;

      // Editing content invalidates the stored vector. Without re-embedding, the
      // persisted embedding and the in-memory index keep describing the OLD text,
      // so search silently returns the wrong rows (and survives restart).
      let newVector: Float32Array | null = null;
      if (content !== undefined && content !== existing.content) {
        const embeddableText = existing.concept
          ? `${concept ?? existing.concept}: ${content}`
          : content;
        newVector = await embed(embeddableText);
        updates['embedding'] = packFP16(newVector);
        updates['embeddingDim'] = newVector.length;
      }

      await db
        .update(schema.memories)
        .set(updates)
        .where(eq(schema.memories.id, id));

      if (newVector) {
        brain.getVectorSearch().upsert({
          id,
          vector: newVector,
          type: existing.type as MemoryType,
          namespace: existing.namespace ?? undefined,
        });
      }

      const [updated] = await db
        .select()
        .from(schema.memories)
        .where(eq(schema.memories.id, id))
        .limit(1);

      return updated;
    },
  });

  app.post<{ Body: { ids: string[]; tag: string } }>('/memory/bulk/tag', {
    schema: {
      tags: ['memory'],
      summary: 'Add a tag to multiple memories at once',
      body: {
        type: 'object',
        required: ['ids', 'tag'],
        properties: {
          // Bounded: this loops one query per id, so an unbounded array is a
          // trivial resource-exhaustion vector.
          ids: { type: 'array', maxItems: 1000, items: { type: 'string' } },
          tag: { type: 'string', minLength: 1 },
        },
      },
    },
    handler: async (req) => {
      const db = getDb();
      const { ids, tag } = req.body;
      let modified = 0;
      // Hoisted out of the loop: one device id for the whole batch, and a
      // single db.insert (inside getDeviceId's first-call path) instead of one
      // per row.
      const deviceId = getDeviceId();

      for (const id of ids) {
        const [mem] = await db
          .select()
          .from(schema.memories)
          .where(eq(schema.memories.id, id))
          .limit(1);
        if (!mem || !brain.canAccessNamespace(mem.namespace)) continue;

        const existing: string[] = JSON.parse(mem.tags ?? '[]');
        if (!existing.includes(tag)) {
          existing.push(tag);
          await db
            .update(schema.memories)
            .set({ tags: JSON.stringify(existing), updatedAt: new Date().toISOString(), deviceId })
            .where(eq(schema.memories.id, id));
          modified++;
        }
      }

      return { modified, total: ids.length };
    },
  });

  app.post<{ Body: { ids: string[] } }>('/memory/bulk/archive', {
    schema: {
      tags: ['memory'],
      summary: 'Archive multiple memories at once',
    },
    handler: async (req) => {
      const { ids } = req.body;
      let archived = 0;

      for (const id of ids) {
        try {
          await brain.forget(id);
          archived++;
        } catch {
          // skip missing
        }
      }

      return { archived, total: ids.length };
    },
  });
};
