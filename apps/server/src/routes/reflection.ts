import type { FastifyPluginAsync } from 'fastify';
import { brain, io } from '../index.js';

export const reflectionRoutes: FastifyPluginAsync = async (app) => {
  // POST /api/reflect — trigger a reflection cycle
  app.post('/reflect', {
    schema: {
      tags: ['reflection'],
      summary: 'Trigger a memory reflection cycle using the configured LLM',
    },
    handler: async (_req, reply) => {
      const llm = brain.getLLMProvider();
      const available = await llm.isAvailable();
      if (!available) {
        reply.code(503);
        return { error: 'LLM provider not available. Configure ENGRAM_LLM_PROVIDER.' };
      }

      const results = await brain.reflect();

      if (results.length > 0) {
        const neuralNs = io?.of('/neural');
        neuralNs?.emit('memory:reflected', {
          count: results.length,
          types: results.map((r) => r.type),
        });
      }

      return {
        count: results.length,
        reflections: results.map((r) => ({
          type: r.type,
          insight: r.insight,
          confidence: r.confidence,
          relatedMemoryIds: r.relatedMemoryIds,
        })),
      };
    },
  });

  // GET /api/reflections — list stored reflection insights
  app.get<{ Querystring: { limit?: string; type?: string } }>('/reflections', {
    schema: {
      tags: ['reflection'],
      summary: 'List stored reflection insights',
    },
    handler: async (req) => {
      const limit = parseInt(req.query.limit ?? '20', 10);
      const reflections = await brain.getReflections(limit);

      let filtered = reflections;
      if (req.query.type) {
        filtered = reflections.filter((m) => {
          const meta = JSON.parse(m.metadata ?? '{}');
          return meta.reflectionType === req.query.type;
        });
      }

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

  // GET /api/llm/status — LLM provider health check
  app.get('/llm/status', {
    schema: {
      tags: ['reflection'],
      summary: 'Check LLM provider availability and configuration',
    },
    handler: async () => {
      const llm = brain.getLLMProvider();
      const available = await llm.isAvailable();
      return {
        provider: llm.id,
        model: llm.getModel(),
        contextWindow: llm.getContextWindow(),
        available,
      };
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
