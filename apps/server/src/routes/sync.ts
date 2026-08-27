import type { FastifyPluginAsync } from 'fastify';
import { syncEngine } from '../index.js';

/**
 * Cloud sync status and manual control (Phase 3). `syncEngine` is null
 * whenever ENGRAM_SYNC_URL is unset — both routes degrade to "not
 * configured" responses rather than 500ing in that case.
 */
export const syncRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/sync/status — current sync status
  app.get('/sync/status', {
    schema: {
      tags: ['sync'],
      summary: 'Get cloud sync status',
    },
    handler: async () => {
      if (!syncEngine) return { enabled: false };
      return { enabled: true, ...syncEngine.status() };
    },
  });

  // POST /api/sync/trigger — run one manual sync cycle (push then pull)
  app.post('/sync/trigger', {
    schema: {
      tags: ['sync'],
      summary: 'Run a manual sync cycle now',
    },
    handler: async (req, reply) => {
      if (!syncEngine) {
        reply.code(404);
        return { error: 'Cloud sync is not configured' };
      }
      try {
        const result = await syncEngine.sync();
        return { success: true, ...result };
      } catch (err: unknown) {
        reply.code(500);
        return { error: (err as Error).message };
      }
    },
  });
};
