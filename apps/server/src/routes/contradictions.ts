import type { FastifyPluginAsync } from 'fastify';
import { brain, realtime, notifySyncWrite } from '../index.js';
import { isMemoryNotFound } from '../lib/notFound.js';
import { strictObjectBody, strictQueryString } from '../lib/strictBody.js';

type ResolutionInput = {
  sourceId: string;
  targetId: string;
  strategy: 'keep_newest' | 'keep_oldest' | 'keep_important' | 'keep_both' | 'manual';
};

const resolutionBody = {
  type: 'object',
  required: ['sourceId', 'targetId', 'strategy'],
  properties: {
    sourceId: { type: 'string', minLength: 1 },
    targetId: { type: 'string', minLength: 1 },
    strategy: { type: 'string', enum: ['keep_newest', 'keep_oldest', 'keep_important', 'keep_both', 'manual'] },
  },
};

export const contradictionRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/contradictions — list all unresolved contradictions
  app.get<{ Querystring: { limit?: number; offset?: number; namespace?: string; global?: 'true' } }>('/contradictions', {
    schema: {
      tags: ['contradictions'],
      summary: 'List unresolved contradictions',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          // Bounded: an established brain can hold thousands of contradicts
          // edges, and returning all of them made the dashboard flag nearly
          // every neuron.
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
          offset: { type: 'integer', minimum: 0, default: 0 },
          namespace: { type: 'string' },
          global: { type: 'string', enum: ['true'] },
        },
      },
    },
    // Fastify's ajv runs with removeAdditional, so `additionalProperties: false`
    // above documents the contract without enforcing it — an unknown key is
    // stripped in silence and the caller is answered 200 for a request that was
    // plainly a typo. This is what enforces it; see lib/strictBody.ts.
    preValidation: strictQueryString(['limit', 'offset', 'namespace', 'global']),
    handler: async (req) => {
      const { namespace, global, offset = 0, limit = 200 } = req.query;
      const contradictions = await brain.getContradictions(namespace, limit, offset, global === 'true');
      const total = await brain.getContradictionCount(namespace, global === 'true');
      return {
        count: contradictions.length,
        total,
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

  // Keep bulk and single resolution on the same core, sync and realtime path.
  const resolve = async (item: ResolutionInput) => {
    const result = await brain.resolveContradiction(item.sourceId, item.targetId, item.strategy);
    if (result.resolved) {
      notifySyncWrite();
      realtime?.emit('memory:contradiction_resolved', {
        sourceId: item.sourceId,
        targetId: item.targetId,
        strategy: item.strategy,
        archivedId: result.archivedId,
        keptId: result.keptId,
      });
    }
    return result;
  };

  // POST /api/contradictions/resolve — resolve a contradiction
  app.post<{ Body: ResolutionInput }>('/contradictions/resolve', {
    schema: {
      tags: ['contradictions'],
      summary: 'Resolve a contradiction between two memories',
      body: resolutionBody,
    },
    handler: async (req) => resolve(req.body),
  });

  app.post<{ Body: { items: ResolutionInput[] } }>('/contradictions/bulk/resolve', {
    schema: {
      tags: ['contradictions'],
      summary: 'Resolve up to 500 contradiction pairs',
      body: {
        type: 'object',
        required: ['items'],
        properties: {
          items: { type: 'array', minItems: 1, maxItems: 500, items: resolutionBody },
        },
      },
    },
    preValidation: strictObjectBody(['items'], ['items']),
    handler: async (req) => {
      const results: { ok: boolean; error?: string }[] = [];
      // Sequential, like bulk archive: each core call commits independently.
      for (const item of req.body.items) {
        try {
          const result = await resolve(item);
          results.push(result.resolved ? { ok: true } : { ok: false, error: 'Contradiction not resolved' });
        } catch (err: unknown) {
          const missing = isMemoryNotFound(err) || (err instanceof Error && err.message === 'Memory not found');
          if (!missing) req.log.warn({ err }, 'bulk contradiction resolution failed');
          results.push({ ok: false, error: missing ? 'Memory not found' : 'Failed to resolve contradiction' });
        }
      }
      const resolved = results.filter((result) => result.ok).length;
      return { results, summary: { total: results.length, resolved, failed: results.length - resolved } };
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
