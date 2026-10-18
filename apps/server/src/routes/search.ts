import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { OutgoingHttpHeaders } from 'node:http';
import { brain, realtime } from '../index.js';
import type { MemoryType } from '@engram-ai-memory/core';
import { strictQueryString } from '../lib/strictBody.js';

const filterProperties = {
  since: { type: 'string', format: 'date-time' },
  until: { type: 'string', format: 'date-time' },
  tags: { type: 'array', items: { type: 'string' } },
};

// Body filters must have the advertised types before AJV can coerce them.
async function validateFilterBody(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const body = req.body as { since?: unknown; until?: unknown; tags?: unknown } | null;
  if (!body || typeof body !== 'object') return;
  const invalidDateType = [body.since, body.until].some((value) => value !== undefined && typeof value !== 'string');
  const invalidTags = body.tags !== undefined
    && (!Array.isArray(body.tags) || !body.tags.every((tag: unknown) => typeof tag === 'string'));
  if (invalidDateType || invalidTags) {
    return reply.code(400).send({
      error: 'Bad Request', message: 'since/until must be date-time strings and tags must be an array of strings.',
    });
  }
}

export const searchRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/search — semantic search
  app.post<{
    Body: {
      query: string;
      topK?: number;
      threshold?: number;
      types?: MemoryType[];
      sources?: string[];
      since?: string;
      until?: string;
      tags?: string[];
      crossNamespace?: boolean;
    };
  }>('/search', {
    schema: {
      tags: ['search'],
      summary: 'Semantic search across memories',
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1 },
          // A floor as well as a ceiling: VectorSearch slices with
          // `slice(0, topK)`, and a negative topK makes that return everything
          // above the threshold — the cap of 50 silently became "no cap".
          topK: { type: 'integer', default: 10, minimum: 1, maximum: 50 },
          threshold: { type: 'number', default: 0.3, minimum: 0, maximum: 1 },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] },
          },
          sources: { type: 'array', items: { type: 'string' } },
          ...filterProperties,
          crossNamespace: { type: 'boolean', default: false },
        },
      },
    },
    preValidation: validateFilterBody,
    handler: async (req, reply) => {
      if (brain.getNamespaceMode() === 'isolated' && req.body.crossNamespace) {
        return reply.code(400).send({ error: 'cross-namespace access is not allowed in isolated mode' });
      }
      const start = Date.now();
      const memories = await brain.search(req.body.query, {
        topK: req.body.topK ?? 10,
        threshold: req.body.threshold ?? 0.3,
        types: req.body.types,
        sources: req.body.sources,
        since: req.body.since,
        until: req.body.until,
        tags: req.body.tags,
        crossNamespace: req.body.crossNamespace,
      });
      return {
        count: memories.length,
        latencyMs: Date.now() - start,
        results: memories,
      };
    },
  });

  // POST /api/recall — assemble working memory context
  app.post<{
    Body: {
      query: string;
      maxTokens?: number;
      types?: MemoryType[];
      sources?: string[];
      sessionId?: string;
      since?: string;
      until?: string;
      tags?: string[];
      crossNamespace?: boolean;
    };
  }>('/recall', {
    schema: {
      tags: ['search'],
      summary: 'Assemble working memory context for AI injection',
      body: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string', minLength: 1 },
          // Unbounded in both directions while the SSE twin below was already
          // 1..32000. A negative maxTokens disabled context truncation
          // entirely, so one recall could return the whole store.
          maxTokens: { type: 'integer', default: 2000, minimum: 1, maximum: 32000 },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] },
          },
          sources: { type: 'array', items: { type: 'string' } },
          sessionId: { type: 'string' },
          ...filterProperties,
          crossNamespace: { type: 'boolean', default: false },
        },
      },
    },
    preValidation: validateFilterBody,
    handler: async (req, reply) => {
      if (brain.getNamespaceMode() === 'isolated' && req.body.crossNamespace) {
        return reply.code(400).send({ error: 'cross-namespace access is not allowed in isolated mode' });
      }
      const result = await brain.recall(req.body.query, {
        maxTokens: req.body.maxTokens ?? 2000,
        types: req.body.types,
        sources: req.body.sources,
        since: req.body.since,
        until: req.body.until,
        tags: req.body.tags,
        sessionId: req.body.sessionId,
        source: 'rest-api',
        crossNamespace: req.body.crossNamespace,
      });
      return result;
    },
  });

  // GET /api/recall/stream — Server-Sent Events streaming recall
  app.get<{
    Querystring: {
      query: string;
      maxTokens?: number;
      types?: string;
      sources?: string;
      since?: string;
      until?: string;
      tags?: string[];
      crossNamespace?: boolean;
    };
  }>('/recall/stream', {
    schema: {
      tags: ['search'],
      summary: 'Streaming recall via Server-Sent Events — memories arrive progressively',
      querystring: {
        type: 'object',
        additionalProperties: false,
        required: ['query'],
        properties: {
          query: { type: 'string' },
          maxTokens: { type: 'integer', minimum: 1, maximum: 32000, default: 2000 },
          types: { type: 'string', description: 'Comma-separated memory types' },
          sources: { type: 'string', description: 'Comma-separated sources' },
          ...filterProperties,
          crossNamespace: { type: 'boolean', default: false },
        },
      },
    },
    // Fastify's ajv runs with removeAdditional, so `additionalProperties: false`
    // above documents the contract without enforcing it — an unknown key is
    // stripped in silence and the caller is answered 200 for a request that was
    // plainly a typo. This is what enforces it; see lib/strictBody.ts.
    preValidation: strictQueryString(['query', 'maxTokens', 'types', 'sources', 'since', 'until', 'tags', 'crossNamespace']),
    handler: async (req, reply) => {
      const { query, maxTokens, types, sources, since, until, tags, crossNamespace } = req.query;

      if (brain.getNamespaceMode() === 'isolated' && crossNamespace) {
        return reply.code(400).send({ error: 'cross-namespace access is not allowed in isolated mode' });
      }

      // Take ownership of the stream while preserving headers queued by hooks.
      reply.hijack();
      reply.raw.writeHead(200, {
        ...reply.getHeaders() as OutgoingHttpHeaders,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const parsedTypes = types
        ? (types.split(',').map((t) => t.trim()) as MemoryType[])
        : undefined;
      const parsedSources = sources
        ? sources.split(',').map((s) => s.trim())
        : undefined;

      const stream = brain.recallStream(query, {
        maxTokens: maxTokens ?? 2000,
        types: parsedTypes,
        sources: parsedSources,
        since,
        until,
        tags,
        source: 'rest-api-stream',
        crossNamespace,
      });

      // Headers are already sent, so Fastify can no longer produce an error
      // response — surface failures as an SSE error frame and always end the
      // stream. Stop generating as soon as the client goes away, otherwise the
      // generator keeps querying and writing into a dead socket.
      let clientGone = false;
      req.raw.on('close', () => {
        clientGone = true;
      });

      try {
        for await (const chunk of stream) {
          if (clientGone) break;

          const data = JSON.stringify(chunk);
          reply.raw.write(`event: ${chunk.phase}\ndata: ${data}\n\n`);

          // Also emit on WebSocket
          if (chunk.phase !== 'complete') {
            realtime?.emit('recall:chunk', chunk);
          } else {
            realtime?.emit('recall:complete', chunk);
          }
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        if (!clientGone) {
          reply.raw.write(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`);
        }
        req.log.error({ err }, 'recall stream failed');
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
    },
  });
};
