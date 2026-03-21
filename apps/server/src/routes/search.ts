import type { FastifyPluginAsync } from 'fastify';
import { brain } from '../index.js';
import type { MemoryType } from '@engram/core';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/search — semantic search
  app.post<{
    Body: {
      query: string;
      topK?: number;
      threshold?: number;
      types?: MemoryType[];
      sources?: string[];
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
      });
      return result;
    },
  });
};
