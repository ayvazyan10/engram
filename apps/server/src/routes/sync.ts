import type { FastifyPluginAsync } from 'fastify';
import { syncEngine } from '../index.js';
import { runExclusive } from '../lib/exclusive.js';

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
        // Single-flight: a sync cycle pushes and pulls the whole change set,
        // and two overlapping cycles re-send the same rows against each other.
        const result = await runExclusive('sync-trigger', () => syncEngine!.sync());
        return { success: true, ...result };
      } catch (err: unknown) {
        // The conflict from runExclusive is the caller's answer, not a failure.
        if (err instanceof Error && 'statusCode' in err) throw err;
        // A sync failure's message carries remote endpoint detail (and, when
        // the URL is malformed, credentials embedded in it). Log it, don't
        // reflect it.
        req.log.error({ err }, 'manual sync failed');
        reply.code(500);
        return { error: 'Sync failed. See the server log for details.' };
      }
    },
  });
};
