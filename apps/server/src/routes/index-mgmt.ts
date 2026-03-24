import type { FastifyPluginAsync } from 'fastify';
import { brain } from '../index.js';

export const indexRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/index/status — vector index status
  app.get('/index/status', {
    schema: {
      tags: ['index'],
      summary: 'Get vector index status — how it was loaded, entry count, persistence info',
    },
    handler: async () => {
      return brain.getIndexStatus();
    },
  });

  // POST /api/index/rebuild — force full index rebuild from DB
  app.post('/index/rebuild', {
    schema: {
      tags: ['index'],
      summary: 'Force a full vector index rebuild from the database. Discards any cached index.',
    },
    handler: async () => {
      const status = await brain.rebuildIndex();
      return {
        ...status,
        message: `Index rebuilt: ${status.entryCount} entries in ${status.initDurationMs}ms`,
      };
    },
  });

  // POST /api/index/save — force save index to disk now
  app.post('/index/save', {
    schema: {
      tags: ['index'],
      summary: 'Force save the vector index to disk immediately',
    },
    handler: async (req, reply) => {
      try {
        brain.saveIndex();
        const status = brain.getIndexStatus();
        return {
          ...status,
          message: `Index saved to ${status.indexPath}`,
        };
      } catch (err: unknown) {
        reply.code(400);
        return { error: (err as Error).message };
      }
    },
  });
};
