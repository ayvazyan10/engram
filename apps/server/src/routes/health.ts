import type { FastifyPluginAsync } from 'fastify';
import { brain } from '../index.js';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/health', {
    schema: {
      tags: ['health'],
      summary: 'Health check',
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            version: { type: 'string' },
            uptime: { type: 'number' },
          },
        },
      },
    },
    handler: async () => ({
      status: 'ok',
      version: '0.1.0',
      uptime: process.uptime(),
    }),
  });

  app.get('/stats', {
    schema: {
      tags: ['health'],
      summary: 'Brain memory statistics',
    },
    handler: async () => brain.stats(),
  });
};
