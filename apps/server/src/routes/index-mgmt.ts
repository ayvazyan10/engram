import type { FastifyPluginAsync } from 'fastify';
import { brain } from '../index.js';
import { runExclusive } from '../lib/exclusive.js';

/**
 * The index status minus the on-disk location.
 *
 * `getIndexStatus()` carries `indexPath`, an absolute path — GET
 * /api/index/status answered with "/home/<user>/.engram/engram.db.index",
 * naming the account the service runs as and where its data lives. Nothing
 * outside the process can act on that path, so it is dropped here rather than
 * shortened; `indexFileName` keeps the one part that identifies WHICH index
 * without saying where it is.
 */
function serializeIndexStatus(status: ReturnType<typeof brain.getIndexStatus>) {
  const { indexPath, ...rest } = status;
  return {
    ...rest,
    persisted: indexPath !== null,
    indexFileName: indexPath === null ? null : indexPath.split(/[\\/]/).pop(),
  };
}

export const indexRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/index/status — vector index status
  app.get('/index/status', {
    schema: {
      tags: ['index'],
      summary: 'Get vector index status — how it was loaded, entry count, persistence info',
    },
    handler: async () => {
      // Reconcile first: without it this reported whatever this process loaded
      // at startup, so two engram processes over one database answered with
      // different entry counts for the same file.
      await brain.syncIndexFromStore();
      return serializeIndexStatus(brain.getIndexStatus());
    },
  });

  // POST /api/index/rebuild — force full index rebuild from DB
  app.post('/index/rebuild', {
    schema: {
      tags: ['index'],
      summary: 'Force a full vector index rebuild from the database. Discards any cached index.',
    },
    handler: async () => {
      // Single-flight: rebuildIndex() clears the index before repopulating it,
      // so two overlapping rebuilds interleave one's clear() with the other's
      // upserts and the index ends up short of whatever was written first.
      const status = await runExclusive('index-rebuild', () => brain.rebuildIndex());
      return {
        ...serializeIndexStatus(status),
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
        await runExclusive('index-save', () => brain.saveIndexAsync());
        const status = brain.getIndexStatus();
        return {
          ...serializeIndexStatus(status),
          // The old message interpolated status.indexPath, so the success
          // response leaked the same absolute path the status route did.
          message: 'Index saved',
        };
      } catch (err: unknown) {
        // runExclusive's 409 is a caller-visible conflict, not a save failure.
        if (err instanceof Error && 'statusCode' in err) throw err;
        // Anything else here is an I/O failure whose message names a path.
        req.log.error({ err }, 'index save failed');
        reply.code(400);
        return { error: 'Index could not be saved. See the server log for details.' };
      }
    },
  });
};
