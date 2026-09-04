import type { FastifyPluginAsync } from 'fastify';
import { brain, realtime, notifySyncWrite } from '../index.js';
import { isMemoryNotFound } from '../lib/notFound.js';
import { strictObjectBody } from '../lib/strictBody.js';

export const contradictionRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/contradictions — list all unresolved contradictions
  app.get<{ Querystring: { limit?: number } }>('/contradictions', {
    schema: {
      tags: ['contradictions'],
      summary: 'List unresolved contradictions',
      querystring: {
        type: 'object',
        properties: {
          // Bounded: an established brain can hold thousands of contradicts
          // edges, and returning all of them made the dashboard flag nearly
          // every neuron.
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
        },
      },
    },
    handler: async (req) => {
      const contradictions = await brain.getContradictions(undefined, req.query.limit ?? 200);
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
        return await brain.checkContradictions(req.params.id);
      } catch (err: unknown) {
        // Every failure used to become a 404 carrying the raw message — an
        // embedder fault or a DB error was reported as "not found", and the
        // message went straight to the client. Only a genuinely missing
        // memory is a 404; anything else is a 500 the error handler logs.
        if (!isMemoryNotFound(err)) throw err;
        reply.code(404);
        return { error: 'Memory not found' };
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
        notifySyncWrite();
        realtime?.emit('memory:contradiction_resolved', {
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
      defaultStrategy?: 'keep_newest' | 'keep_oldest' | 'keep_important' | 'keep_both' | 'manual';
      autoResolve?: boolean;
    };
  }>('/contradictions/config', {
    schema: {
      tags: ['contradictions'],
      summary: 'Update contradiction detection configuration',
      // `additionalProperties: false` (and `minProperties`) for the same
      // reason as the decay policy and the reflection config: the handler
      // merges the body into the live config, so an unknown key was persisted
      // verbatim. Fastify's ajv runs with removeAdditional, so without this
      // the key would be dropped silently and the caller would believe it took.
      body: {
        type: 'object',
        additionalProperties: false,
        minProperties: 1,
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
    preValidation: strictObjectBody([
      'enabled',
      'similarityThreshold',
      'confidenceThreshold',
      'maxCandidates',
      'defaultStrategy',
      'autoResolve',
    ]),
    handler: async (req) => {
      // No cast: the schema above and the Body type now describe the same
      // shape, so the body is already a valid partial config.
      brain.updateContradictionConfig(req.body);
      return brain.getContradictionConfig();
    },
  });
};
