import type { FastifyPluginAsync } from 'fastify';
import type { ReflectionType } from '@engram-ai-memory/core';
import { brain } from '../index.js';
import { strictObjectBody } from '../lib/strictBody.js';

/** The reflection types the engine understands. Mirrors core's ReflectionType. */
const REFLECTION_TYPES = ['pattern', 'knowledge_gap', 'trend', 'contradiction_summary'] as const;

export const reflectionRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/reflections — list stored reflection insights
  app.get<{ Querystring: { limit?: number; type?: ReflectionType } }>('/reflections', {
    schema: {
      tags: ['reflection'],
      summary: 'List stored reflection insights',
      // This route had no schema at all and ran `parseInt(req.query.limit)`
      // raw: ?limit=abc produced NaN, which SQLite's LIMIT treats as no limit,
      // so the endpoint quietly returned every reflection ever stored. An
      // unknown ?type= reached the SQL filter as an unvalidated string.
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 20, minimum: 1, maximum: 200 },
          type: { type: 'string', enum: [...REFLECTION_TYPES] },
        },
      },
    },
    handler: async (req) => {
      // Filter by type in SQL so LIMIT is applied after the filter.
      const filtered = await brain.getReflections(req.query.limit ?? 20, req.query.type);

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
  app.put<{
    Body: {
      enabled?: boolean;
      storeCountThreshold?: number;
      triggerOnDecay?: boolean;
      types?: ReflectionType[];
      maxMemoriesToAnalyze?: number;
      minImportance?: number;
    };
  }>('/reflection/config', {
    schema: {
      tags: ['reflection'],
      summary: 'Update the reflection engine configuration',
      // Same treatment PUT /api/decay/policy got: a strict schema, because
      // updateConfig() does `{...this.config, ...partial}` and forwards
      // whatever it is handed. With no schema at all, a bare JSON string body
      // spread its characters into the config ("0":"j", "1":"u", ...);
      // {"storeCountThreshold":-1} left reflection permanently "due"; and
      // {"types":5} made getReflectionTasks throw on the next cycle.
      //
      // `additionalProperties: false` matters as much as the types: Fastify's
      // ajv runs with removeAdditional, so an unknown key would otherwise be
      // stripped in silence and the caller would think the update took.
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
        properties: {
          enabled: { type: 'boolean' },
          storeCountThreshold: { type: 'integer', minimum: 1, maximum: 1000000 },
          triggerOnDecay: { type: 'boolean' },
          types: {
            type: 'array',
            minItems: 1,
            uniqueItems: true,
            items: { type: 'string', enum: [...REFLECTION_TYPES] },
          },
          maxMemoriesToAnalyze: { type: 'integer', minimum: 1, maximum: 100000 },
          minImportance: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    preValidation: strictObjectBody([
      'enabled',
      'storeCountThreshold',
      'triggerOnDecay',
      'types',
      'maxMemoriesToAnalyze',
      'minImportance',
    ], ['types']),
    handler: async (req) => {
      brain.getReflectionEngine().updateConfig(req.body);
      return brain.getReflectionEngine().getConfig();
    },
  });
};
