import type { FastifyPluginAsync } from 'fastify';
import { brain, io } from '../index.js';

export const contradictionRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/contradictions — list all unresolved contradictions
  app.get('/contradictions', {
    schema: {
      tags: ['contradictions'],
      summary: 'List all unresolved contradictions',
    },
    handler: async () => {
      const contradictions = await brain.getContradictions();
      return {
        count: contradictions.length,
        contradictions: contradictions.map((c) => ({
          edgeId: c.edge.id,
          confidence: c.edge.strength,
          metadata: JSON.parse(c.edge.metadata || '{}'),
          source: {
            id: c.source.id,
            content: c.source.content,
            type: c.source.type,
            importance: c.source.importance,
            createdAt: c.source.createdAt,
          },
          target: {
            id: c.target.id,
            content: c.target.content,
            type: c.target.type,
            importance: c.target.importance,
            createdAt: c.target.createdAt,
          },
        })),
      };
    },
  });

  // POST /api/contradictions/check/:id — check a specific memory for contradictions
  app.post<{ Params: { id: string } }>('/contradictions/check/:id', {
    schema: {
      tags: ['contradictions'],
      summary: 'Check a specific memory for contradictions',
    },
    handler: async (req, reply) => {
      try {
        const result = await brain.checkContradictions(req.params.id);
        return result;
      } catch (err: unknown) {
        reply.code(404);
        return { error: (err as Error).message };
      }
    },
  });

  // POST /api/contradictions/resolve — resolve a contradiction
  app.post<{
    Body: {
      sourceId: string;
      targetId: string;
      strategy: 'keep_newest' | 'keep_oldest' | 'keep_important' | 'keep_both' | 'manual';
    };
  }>('/contradictions/resolve', {
    schema: {
      tags: ['contradictions'],
      summary: 'Resolve a contradiction between two memories',
      body: {
        type: 'object',
        required: ['sourceId', 'targetId', 'strategy'],
        properties: {
          sourceId: { type: 'string' },
          targetId: { type: 'string' },
          strategy: {
            type: 'string',
            enum: ['keep_newest', 'keep_oldest', 'keep_important', 'keep_both', 'manual'],
          },
        },
      },
    },
    handler: async (req) => {
      const result = await brain.resolveContradiction(
        req.body.sourceId,
        req.body.targetId,
        req.body.strategy,
      );

      if (result.resolved) {
        io?.emit('memory:contradiction_resolved', {
          sourceId: req.body.sourceId,
          targetId: req.body.targetId,
          strategy: req.body.strategy,
          archivedId: result.archivedId,
          keptId: result.keptId,
        });
      }

      return result;
    },
  });

  // GET /api/contradictions/config — get current contradiction detection config
  app.get('/contradictions/config', {
    schema: {
      tags: ['contradictions'],
      summary: 'Get contradiction detection configuration',
    },
    handler: async () => {
      return brain.getContradictionConfig();
    },
  });

  // PUT /api/contradictions/config — update contradiction detection config
  app.put<{
    Body: {
      enabled?: boolean;
      similarityThreshold?: number;
      confidenceThreshold?: number;
      maxCandidates?: number;
      defaultStrategy?: string;
      autoResolve?: boolean;
    };
  }>('/contradictions/config', {
    schema: {
      tags: ['contradictions'],
      summary: 'Update contradiction detection configuration',
      body: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          similarityThreshold: { type: 'number', minimum: 0, maximum: 1 },
          confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 },
          maxCandidates: { type: 'integer', minimum: 1, maximum: 50 },
          defaultStrategy: {
            type: 'string',
            enum: ['keep_newest', 'keep_oldest', 'keep_important', 'keep_both', 'manual'],
          },
          autoResolve: { type: 'boolean' },
        },
      },
    },
    handler: async (req) => {
      brain.updateContradictionConfig(req.body as any);
      return brain.getContradictionConfig();
    },
  });
};
