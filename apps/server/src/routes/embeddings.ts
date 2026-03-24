import type { FastifyPluginAsync } from 'fastify';
import { brain, io } from '../index.js';

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

      const result = await brain.reEmbed(onlyStale, batchSize, (progress) => {
        io?.emit('embedding:progress', progress);
      });

      io?.emit('embedding:complete', result);

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
      await brain.backfillEmbeddingModel();
      const status = await brain.embeddingStatus();
      return {
        ...status,
        message: `Backfilled legacy memories with model: ${status.currentModel}`,
      };
    },
  });
};
