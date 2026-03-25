import type { FastifyPluginAsync } from 'fastify';
import { brain, io } from '../index.js';
import type { MemoryType } from '@engram-ai-memory/core';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/search — semantic search
  app.post<{
    Body: {
      query: string;
      topK?: number;
      threshold?: number;
      types?: MemoryType[];
      sources?: string[];
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
          query: { type: 'string' },
          topK: { type: 'integer', default: 10, maximum: 50 },
          threshold: { type: 'number', default: 0.3, minimum: 0, maximum: 1 },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] },
          },
          sources: { type: 'array', items: { type: 'string' } },
          crossNamespace: { type: 'boolean', default: false },
        },
      },
    },
    handler: async (req) => {
      const start = Date.now();
      const memories = await brain.search(req.body.query, {
        topK: req.body.topK ?? 10,
        threshold: req.body.threshold ?? 0.3,
        types: req.body.types,
        sources: req.body.sources,
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
          query: { type: 'string' },
          maxTokens: { type: 'integer', default: 2000 },
          types: {
            type: 'array',
            items: { type: 'string', enum: ['episodic', 'semantic', 'procedural'] },
          },
          sources: { type: 'array', items: { type: 'string' } },
          sessionId: { type: 'string' },
          crossNamespace: { type: 'boolean', default: false },
        },
      },
    },
    handler: async (req) => {
      const result = await brain.recall(req.body.query, {
        maxTokens: req.body.maxTokens ?? 2000,
        types: req.body.types,
        sources: req.body.sources,
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
      crossNamespace?: boolean;
    };
  }>('/recall/stream', {
    schema: {
      tags: ['search'],
      summary: 'Streaming recall via Server-Sent Events — memories arrive progressively',
      querystring: {
        type: 'object',
        required: ['query'],
        properties: {
          query: { type: 'string' },
          maxTokens: { type: 'integer', default: 2000 },
          types: { type: 'string', description: 'Comma-separated memory types' },
          sources: { type: 'string', description: 'Comma-separated sources' },
          crossNamespace: { type: 'boolean', default: false },
        },
      },
    },
    handler: async (req, reply) => {
      const { query, maxTokens, types, sources, crossNamespace } = req.query;

      // Set SSE headers
      reply.raw.writeHead(200, {
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
        source: 'rest-api-stream',
        crossNamespace,
      });

      for await (const chunk of stream) {
        const data = JSON.stringify(chunk);
        reply.raw.write(`event: ${chunk.phase}\ndata: ${data}\n\n`);

        // Also emit on WebSocket
        if (chunk.phase !== 'complete') {
          io?.emit('recall:chunk', chunk);
        } else {
          io?.emit('recall:complete', chunk);
        }
      }

      reply.raw.end();
    },
  });
};
