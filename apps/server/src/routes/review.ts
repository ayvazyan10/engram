import type { FastifyPluginAsync } from 'fastify';
import { getDb, schema } from '@engram-ai-memory/core';
import { and, inArray, isNull } from 'drizzle-orm';
import { brain } from '../index.js';
import { strictObjectBody, strictQueryString } from '../lib/strictBody.js';
import { dismissalKey, itemKey, readDismissals, reviewReader, type DismissQueue, type Scope } from '../lib/review/queues.js';

export const reviewRoutes: FastifyPluginAsync = async (app) => {
  const read = reviewReader();
  const scopeProperties = { namespace: { type: 'string' }, global: { type: 'string', enum: ['true'] } };
  app.get<{ Querystring: Scope }>('/review/summary', {
    schema: {
      tags: ['review'], summary: 'Count the Review queues',
      querystring: { type: 'object', additionalProperties: false, properties: scopeProperties },
    },
    preValidation: strictQueryString(['namespace', 'global']),
    handler: async (req) => {
      const queues = await read(req.query);
      return {
        contradictions: await brain.getContradictionCount(req.query.namespace, req.query.global === 'true'), duplicates: queues.duplicates.length,
        fading: queues.fading.length, secrets: queues.secrets.length, fingerprint: queues.fingerprint,
      };
    },
  });
  app.get<{ Params: { queue: string }; Querystring: Scope & { limit?: number; offset?: number } }>('/review/:queue', {
    schema: {
      tags: ['review'], summary: 'List a Review queue',
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { ...scopeProperties, limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }, offset: { type: 'integer', minimum: 0, default: 0 } },
      },
    },
    preValidation: strictQueryString(['namespace', 'global', 'limit', 'offset']),
    handler: async (req, reply) => {
      const queue = req.params.queue;
      if (queue !== 'contradictions' && queue !== 'duplicates' && queue !== 'fading' && queue !== 'secrets') {
        return reply.code(404).send({ error: 'Review queue not found' });
      }
      const items = (await read(req.query))[queue];
      const { offset = 0, limit = 50 } = req.query;
      const total = queue === 'contradictions'
        ? await brain.getContradictionCount(req.query.namespace, req.query.global === 'true') : items.length;
      return { total, items: items.slice(offset, offset + limit) };
    },
  });
  app.post<{ Body: { queue: DismissQueue; ids: string[] } }>('/review/dismiss', {
    schema: {
      tags: ['review'], summary: 'Persist a device-local Review dismissal',
      body: {
        type: 'object', additionalProperties: false, required: ['queue', 'ids'],
        properties: {
          queue: { type: 'string', enum: ['duplicates', 'fading', 'secrets'] },
          ids: { type: 'array', minItems: 1, maxItems: 2, uniqueItems: true, items: { type: 'string', minLength: 1 } },
        },
      },
    },
    preValidation: strictObjectBody(['queue', 'ids'], ['ids']),
    handler: async (req, reply) => {
      const { queue, ids } = req.body;
      if (ids.length !== (queue === 'duplicates' ? 2 : 1)) return reply.code(400).send({ error: 'Wrong number of ids for queue' });
      const db = getDb();
      const rows = db.select().from(schema.memories).where(and(inArray(schema.memories.id, ids), isNull(schema.memories.archivedAt))).all();
      if (rows.length !== ids.length || rows.some((row) => !brain.canAccessNamespace(row.namespace) || (brain.getNamespace() && row.namespace !== brain.getNamespace()))) {
        return reply.code(404).send({ error: 'Memory not found' });
      }
      // Synchronous read/modify/write: no request can interleave and lose another dismissal.
      const value = JSON.stringify([...new Set([...readDismissals(), itemKey(queue, ids)])]);
      db.insert(schema.localMeta).values({ key: dismissalKey, value })
        .onConflictDoUpdate({ target: schema.localMeta.key, set: { value } }).run();
      return reply.code(204).send();
    },
  });
};
