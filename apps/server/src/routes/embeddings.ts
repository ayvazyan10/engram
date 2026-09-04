import type { FastifyPluginAsync } from 'fastify';
import { brain, realtime, notifySyncWrite } from '../index.js';
import { runExclusive } from '../lib/exclusive.js';

export const embeddingRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/embeddings/status — embedding model status and stale counts
  app.get('/embeddings/status', {
    schema: {
      tags: ['embeddings'],
      summary: 'Get embedding model status — current model, stale/legacy counts, re-embed needed',
    },
    handler: async () => {
      return brain.embeddingStatus();
    },
  });

  // POST /api/embeddings/re-embed — trigger re-embedding pipeline
  app.post<{
    Body: {
      onlyStale?: boolean;
      batchSize?: number;
    };
  }>('/embeddings/re-embed', {
    schema: {
      tags: ['embeddings'],
      summary: 'Re-embed memories with the current model. Long-running for large stores.',
      body: {
        type: 'object',
        properties: {
          onlyStale: { type: 'boolean', default: true },
          batchSize: { type: 'integer', default: 32, minimum: 1, maximum: 100 },
        },
      },
    },
    handler: async (req) => {
      const { onlyStale = true, batchSize = 32 } = req.body ?? {};

      // Single-flight: re-embedding walks the whole store and rewrites every
      // vector, so two overlapping passes fight over the same rows and burn
      // the embedder twice for no benefit.
      const result = await runExclusive('re-embed', () =>
        brain.reEmbed(onlyStale, batchSize, (progress) => {
          realtime?.emit('embedding:progress', progress);
        })
      );
      if (result.processed > 0) notifySyncWrite();

      realtime?.emit('embedding:complete', result);

      return {
        ...result,
        model: brain.getEmbeddingModel(),
        message: result.failed > 0
          ? `Re-embedded ${result.processed} memories (${result.failed} failed) in ${result.durationMs}ms`
          : `Re-embedded ${result.processed} memories in ${result.durationMs}ms`,
      };
    },
  });

  // POST /api/embeddings/backfill — tag legacy memories with current model ID
  app.post('/embeddings/backfill', {
    schema: {
      tags: ['embeddings'],
      summary: 'Tag legacy memories (no model ID) with the current model, without re-embedding',
    },
    handler: async () => {
      const backfilled = await runExclusive('embeddings-backfill', () =>
        brain.backfillEmbeddingModel()
      );
      if (backfilled > 0) notifySyncWrite();
      const status = await brain.embeddingStatus();
      return {
        ...status,
        message: `Backfilled legacy memories with model: ${status.currentModel}`,
      };
    },
  });
};
