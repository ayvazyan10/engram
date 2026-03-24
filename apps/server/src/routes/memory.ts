import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@engram/core';
import { eq, isNull, desc, and } from 'drizzle-orm';
import { brain, io } from '../index.js';

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
          content: { type: 'string' },
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
      const result = await brain.store(req.body);
      io?.emit('memory:stored', { id: result.memory.id, type: result.memory.type });
      if (result.contradictions.hasContradictions) {
        io?.emit('memory:contradiction', {
          memoryId: result.memory.id,
          contradictions: result.contradictions.contradictions,
        });
      }
      reply.code(201);
      return result;
    },
  });

  // POST /api/memory/batch — bulk store
  app.post<{ Body: { memories: Array<{ content: string; type?: string }> } }>(
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
              items: {
                type: 'object',
                required: ['content'],
                properties: {
                  content: { type: 'string' },
                  type: { type: 'string' },
                  source: { type: 'string' },
                  importance: { type: 'number' },
                },
              },
            },
          },
        },
      },
      handler: async (req, reply) => {
        const start = Date.now();
        const results = await Promise.all(
          req.body.memories.map((m) =>
            brain.store({
              content: m.content,
              type: (m.type as 'episodic' | 'semantic' | 'procedural') ?? 'episodic',
            })
          )
        );
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
            limit: { type: 'integer', default: 50, maximum: 200 },
            offset: { type: 'integer', default: 0 },
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

      if (!memory) {
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
      await brain.forget(req.params.id);
      reply.code(204);
    },
  });

  // GET /api/sessions — list sessions
  app.get('/sessions', {
    schema: { tags: ['memory'], summary: 'List sessions' },
    handler: async () => {
      const db = getDb();
      return db.select().from(schema.sessions).orderBy(desc(schema.sessions.startedAt)).limit(100);
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
      reply.code(201);
      return { id };
    },
  });
};
