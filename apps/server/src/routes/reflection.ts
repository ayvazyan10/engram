import type { FastifyPluginAsync } from 'fastify';
import type { ReflectionType } from '@engram-ai-memory/core';
import { brain } from '../index.js';

export const reflectionRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/reflections — list stored reflection insights
  app.get<{ Querystring: { limit?: string; type?: string } }>('/reflections', {
    schema: {
      tags: ['reflection'],
      summary: 'List stored reflection insights',
    },
    handler: async (req) => {
      const limit = parseInt(req.query.limit ?? '20', 10);
      // Filter by type in SQL so LIMIT is applied after the filter.
      const filtered = await brain.getReflections(limit, req.query.type as ReflectionType | undefined);

      return {
        count: filtered.length,
        reflections: filtered.map((m) => ({
          id: m.id,
          type: JSON.parse(m.metadata ?? '{}').reflectionType ?? 'unknown',
          content: m.content,
          importance: m.importance,
          confidence: JSON.parse(m.metadata ?? '{}').confidence,
          tags: JSON.parse(m.tags ?? '[]'),
          createdAt: m.createdAt,
        })),
      };
    },
  });

  // GET /api/reflection/status — reflection scheduling state.
  // Reflection itself runs on the AI connected via MCP (request_reflection /
  // store_reflection); the server has no LLM and never generates insights.
  app.get('/reflection/status', {
    schema: {
      tags: ['reflection'],
      summary: 'Get reflection scheduling state (enabled, due, counter, threshold)',
    },
    handler: async () => {
      return brain.getReflectionEngine().getStatus();
    },
  });

  // GET /api/reflection/config — get reflection engine config
  app.get('/reflection/config', {
    schema: {
      tags: ['reflection'],
      summary: 'Get the reflection engine configuration',
    },
    handler: async () => {
      return brain.getReflectionEngine().getConfig();
    },
  });

  // PUT /api/reflection/config — update reflection engine config
  app.put<{ Body: Record<string, unknown> }>('/reflection/config', {
    schema: {
      tags: ['reflection'],
      summary: 'Update the reflection engine configuration',
    },
    handler: async (req) => {
      brain.getReflectionEngine().updateConfig(req.body as Record<string, unknown>);
      return brain.getReflectionEngine().getConfig();
    },
  });
};
