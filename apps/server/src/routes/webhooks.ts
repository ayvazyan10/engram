import type { FastifyPluginAsync } from 'fastify';
import { brain } from '../index.js';
import type { WebhookEvent } from '@engram/core';

export const webhookRoutes: FastifyPluginAsync = async (app) => {
  const mgr = brain.getWebhookManager();

  // GET /api/webhooks — list all webhook subscriptions
  app.get('/webhooks', {
    schema: {
      tags: ['webhooks'],
      summary: 'List all webhook subscriptions',
      querystring: {
        type: 'object',
        properties: {
          activeOnly: { type: 'boolean', default: false },
        },
      },
    },
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
              enum: ['stored', 'forgotten', 'decayed', 'consolidated', 'contradiction'],
            },
          },
          secret: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    handler: async (req, reply) => {
      const hook = await mgr.subscribe(req.body);
      reply.code(201);
      return hook;
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
    handler: async (req) => {
      const result = await mgr.sendTest(req.params.id);
      return result;
    },
  });
};
