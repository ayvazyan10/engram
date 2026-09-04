import type { FastifyPluginAsync } from 'fastify';
import { brain } from '../index.js';
import { UnsafeWebhookUrlError } from '@engram-ai-memory/core';
import type { WebhookEvent } from '@engram-ai-memory/core';
import { strictQueryString } from '../lib/strictBody.js';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const mgr = brain.getWebhookManager();

  // GET /api/webhooks — list all webhook subscriptions
  app.get('/webhooks', {
    schema: {
      tags: ['webhooks'],
      summary: 'List all webhook subscriptions',
      querystring: {
        type: 'object',
        additionalProperties: false,
        properties: {
          activeOnly: { type: 'boolean', default: false },
        },
      },
    },
    // Fastify's ajv runs with removeAdditional, so `additionalProperties: false`
    // above documents the contract without enforcing it — an unknown key is
    // stripped in silence and the caller is answered 200 for a request that was
    // plainly a typo. This is what enforces it; see lib/strictBody.ts.
    preValidation: strictQueryString(['activeOnly']),
    handler: async (req) => {
      const { activeOnly } = req.query as { activeOnly?: boolean };
      const hooks = await mgr.list(activeOnly);
      return { count: hooks.length, webhooks: hooks };
    },
  });

  // POST /api/webhooks — subscribe a new webhook
  app.post<{
    Body: {
      url: string;
      events: WebhookEvent[];
      secret?: string;
      description?: string;
    };
  }>('/webhooks', {
    schema: {
      tags: ['webhooks'],
      summary: 'Subscribe a new webhook',
      body: {
        type: 'object',
        required: ['url', 'events'],
        properties: {
          url: { type: 'string' },
          events: {
            type: 'array',
            items: {
              type: 'string',
              enum: ['stored', 'forgotten', 'decayed', 'consolidated', 'contradiction', 'reflected'],
            },
          },
          secret: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    handler: async (req, reply) => {
      try {
        const hook = await mgr.subscribe(req.body);
        reply.code(201);
        return hook;
      } catch (err: unknown) {
        // A rejected webhook URL is bad client input, not a server fault —
        // letting UnsafeWebhookUrlError escape produced a 500.
        if (err instanceof UnsafeWebhookUrlError) {
          reply.code(400);
          return { error: err.message };
        }
        throw err;
      }
    },
  });

  // GET /api/webhooks/:id — get a single webhook
  app.get<{ Params: { id: string } }>('/webhooks/:id', {
    schema: {
      tags: ['webhooks'],
      summary: 'Get a webhook subscription by ID',
    },
    handler: async (req, reply) => {
      const hook = await mgr.get(req.params.id);
      if (!hook) {
        reply.code(404);
        return { error: 'Webhook not found' };
      }
      return hook;
    },
  });

  // DELETE /api/webhooks/:id — unsubscribe
  app.delete<{ Params: { id: string } }>('/webhooks/:id', {
    schema: {
      tags: ['webhooks'],
      summary: 'Delete a webhook subscription',
    },
    handler: async (req, reply) => {
      await mgr.unsubscribe(req.params.id);
      reply.code(204);
    },
  });

  // POST /api/webhooks/:id/test — send a test event
  app.post<{ Params: { id: string } }>('/webhooks/:id/test', {
    schema: {
      tags: ['webhooks'],
      summary: 'Send a test event to a webhook',
    },
    handler: async (req, reply) => {
      const result = await mgr.sendTest(req.params.id);
      // sendTest() reports a missing webhook as a failed delivery, so an
      // unknown id answered 200 {"success":false,"error":"Webhook not found"}
      // — indistinguishable from a real endpoint that rejected the test.
      if (!result.success && result.error === 'Webhook not found') {
        reply.code(404);
        return { error: 'Webhook not found' };
      }
      return result;
    },
  });
};
