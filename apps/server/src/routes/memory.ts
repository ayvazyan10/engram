import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@engram-ai-memory/core';
import { eq, isNull, desc, and, or } from 'drizzle-orm';
import { brain, realtime, notifySyncWrite } from '../index.js';
import { mapWithConcurrency } from '../lib/concurrency.js';

/**
 * How many batched stores may embed at once. Override with
 * ENGRAM_BATCH_CONCURRENCY when the embedder is remote and latency-bound
 * rather than CPU-bound.
 */
const BATCH_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env['ENGRAM_BATCH_CONCURRENCY'] ?? '', 10) || 16
);

export const memoryRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/memory — store a memory
  app.post<{
    Body: {
      content: string;
      type?: 'episodic' | 'semantic' | 'procedural';
      source?: string;
      sessionId?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
      importance?: number;
      concept?: string;
      namespace?: string;
    };
  }>('/memory', {
    schema: {
      tags: ['memory'],
      summary: 'Store a new memory',
      body: {
        type: 'object',
        required: ['content'],
        properties: {
          // Empty content used to be accepted: a 201, a row, and an embedding
          // of the empty string that then matched nothing meaningfully.
          content: { type: 'string', minLength: 1 },
          type: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] },
          source: { type: 'string' },
          sessionId: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          importance: { type: 'number', minimum: 0, maximum: 1 },
          concept: { type: 'string' },
          namespace: { type: 'string' },
        },
      },
    },
    handler: async (req, reply) => {
      if (brain.getNamespaceMode() === 'isolated' && req.body.namespace && req.body.namespace !== brain.getNamespace()) {
        return reply.code(400).send({ error: 'namespace override is not allowed in isolated mode' });
      }
      const result = await brain.store(req.body);
      notifySyncWrite();
      // Broadcast the full record: the dashboard appends this straight into its
      // store, and a {id,type} stub left content undefined and crashed rendering.
      realtime?.emit('memory:stored', result.memory);
      if (result.contradictions.hasContradictions) {
        realtime?.emit('memory:contradiction', {
          memoryId: result.memory.id,
          contradictions: result.contradictions.contradictions,
        });
      }
      reply.code(201);
      return result;
    },
  });

  // POST /api/memory/batch — bulk store
  app.post<{
    Body: {
      memories: Array<{
        content: string;
        type?: string;
        source?: string;
        importance?: number;
        tags?: string[];
        concept?: string;
        namespace?: string;
      }>;
    };
  }>(
    '/memory/batch',
    {
      schema: {
        tags: ['memory'],
        summary: 'Bulk store memories (high throughput)',
        body: {
          type: 'object',
          required: ['memories'],
          properties: {
            memories: {
              type: 'array',
              // Bounded so a single request cannot pin the event loop and fan
              // out an unbounded number of background webhook deliveries.
              maxItems: 1000,
              items: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string', minLength: 1 },
                  type: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] },
                  source: { type: 'string' },
                  importance: { type: 'number', minimum: 0, maximum: 1 },
                  tags: { type: 'array', items: { type: 'string' } },
                  concept: { type: 'string' },
                  namespace: { type: 'string' },
                },
              },
            },
          },
        },
      },
      handler: async (req, reply) => {
        if (brain.getNamespaceMode() === 'isolated' && req.body.memories.some((memory) =>
          memory.namespace && memory.namespace !== brain.getNamespace()
        )) {
          return reply.code(400).send({ error: 'namespace override is not allowed in isolated mode' });
        }
        const start = Date.now();
        // Bounded fan-out, not Promise.all over the whole array: every store
        // embeds its text, so 1000 items meant 1000 concurrent embedder calls
        // and no gap for the event loop to serve anything else. Order is
        // preserved because the response returns `ids` positionally.
        const results = await mapWithConcurrency(
          req.body.memories,
          BATCH_CONCURRENCY,
          // Forward every documented per-item field. Only content and type were
          // passed through, so importance/source/tags/concept/namespace were
          // silently dropped for batched writes.
          (m) =>
            brain.store({
              content: m.content,
              type: (m.type as 'episodic' | 'semantic' | 'procedural') ?? 'episodic',
              source: m.source,
              importance: m.importance,
              tags: m.tags,
              concept: m.concept,
              namespace: m.namespace,
            })
        );
        notifySyncWrite();
        reply.code(201);
        return {
          count: results.length,
          latencyMs: Date.now() - start,
          ids: results.map((r) => r.memory.id),
          contradictions: results.filter((r) => r.contradictions.hasContradictions).length,
        };
      },
    }
  );

  // GET /api/memory — list memories
  app.get<{ Querystring: { type?: string; source?: string; limit?: number; offset?: number } }>(
    '/memory',
    {
      schema: {
        tags: ['memory'],
        summary: 'List memories',
        querystring: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] },
            source: { type: 'string' },
            // A `maximum` alone is only half a bound. SQLite reads LIMIT -1 as
            // "no limit", so ?limit=-1 returned the whole table — every row
            // carrying its FP16 embedding as a JSON byte array — and a
            // negative OFFSET is a syntax error, i.e. a 500.
            limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
            offset: { type: 'integer', default: 0, minimum: 0 },
          },
        },
      },
      handler: async (req) => {
        const db = getDb();
        const { type, source, limit = 50, offset = 0 } = req.query;

        const conditions = [isNull(schema.memories.archivedAt)];
        if (type) conditions.push(eq(schema.memories.type, type as 'episodic' | 'semantic' | 'procedural'));
        if (source) conditions.push(eq(schema.memories.source, source));
        // Scope to brain's namespace if configured
        const ns = brain.getNamespace();
        if (ns) conditions.push(eq(schema.memories.namespace, ns));

        const memories = await db
          .select()
          .from(schema.memories)
          .where(and(...conditions))
          .orderBy(desc(schema.memories.createdAt))
          .limit(limit)
          .offset(offset);

        return { count: memories.length, memories };
      },
    }
  );

  // GET /api/memory/:id — get by ID
  app.get<{ Params: { id: string } }>('/memory/:id', {
    schema: { tags: ['memory'], summary: 'Get memory by ID' },
    handler: async (req, reply) => {
      const db = getDb();
      const [memory] = await db
        .select()
        .from(schema.memories)
        .where(eq(schema.memories.id, req.params.id))
        .limit(1);

      if (!memory || !brain.canAccessNamespace(memory.namespace)) {
        reply.code(404);
        return { error: 'Memory not found' };
      }
      return memory;
    },
  });

  // DELETE /api/memory/:id — archive (soft delete)
  app.delete<{ Params: { id: string } }>('/memory/:id', {
    schema: { tags: ['memory'], summary: 'Archive (soft-delete) a memory' },
    handler: async (req, reply) => {
      const db = getDb();
      // brain.forget() checks existence only in isolated mode, so deleting an
      // id that was never stored answered 204 and still fired a 'forgotten'
      // webhook and an onForget plugin hook — subscribers saw archives of
      // memories that never existed. Already-archived rows are excluded too,
      // so a second DELETE is a 404 rather than a second phantom event.
      const [memory] = await db
        .select({ namespace: schema.memories.namespace })
        .from(schema.memories)
        .where(and(eq(schema.memories.id, req.params.id), isNull(schema.memories.archivedAt)))
        .limit(1);

      if (!memory || !brain.canAccessNamespace(memory.namespace)) {
        reply.code(404);
        return { error: 'Memory not found' };
      }

      await brain.forget(req.params.id);
      notifySyncWrite();
      reply.code(204);
      return undefined;
    },
  });

  // GET /api/sessions — list sessions
  app.get('/sessions', {
    schema: { tags: ['memory'], summary: 'List sessions' },
    handler: async () => {
      const db = getDb();
      const namespace = brain.getNamespace();
      // Sessions predate the namespace column, so every row written before the
      // upgrade carries NULL. Isolated mode must not show them; filter mode is
      // soft scoping and hiding a user's own history would look like data loss.
      const scope = !namespace
        ? undefined
        : brain.getNamespaceMode() === 'isolated'
          ? eq(schema.sessions.namespace, namespace)
          : or(eq(schema.sessions.namespace, namespace), isNull(schema.sessions.namespace));
      return db.select().from(schema.sessions)
        .where(scope)
        .orderBy(desc(schema.sessions.startedAt)).limit(100);
    },
  });

  // POST /api/sessions — create session
  app.post<{ Body: { source: string; context?: Record<string, unknown> } }>('/sessions', {
    schema: {
      tags: ['memory'],
      summary: 'Create a new session',
      body: {
        type: 'object',
        required: ['source'],
        properties: {
          source: { type: 'string' },
          context: { type: 'object' },
        },
      },
    },
    handler: async (req, reply) => {
      const id = await brain.createSession(req.body.source, req.body.context);
      notifySyncWrite();
      reply.code(201);
      return { id };
    },
  });
};
