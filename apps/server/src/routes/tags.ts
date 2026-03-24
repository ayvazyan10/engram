import type { FastifyPluginAsync } from 'fastify';
import { brain } from '../index.js';

export const tagRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/tags — tag cloud with counts
  app.get('/tags', {
    schema: {
      tags: ['tags'],
      summary: 'Get tag cloud — all unique tags with memory counts',
    },
    handler: async () => {
      const tags = await brain.getTags();
      return { count: tags.length, tags };
    },
  });

  // GET /api/tags/:tag — memories by tag
  app.get<{
    Params: { tag: string };
    Querystring: { limit?: number; offset?: number };
  }>('/tags/:tag', {
    schema: {
      tags: ['tags'],
      summary: 'Get all memories with a specific tag',
      querystring: {
        type: 'object',
        properties: {
          limit: { type: 'integer', default: 50, maximum: 200 },
          offset: { type: 'integer', default: 0 },
        },
      },
    },
    handler: async (req) => {
      const memories = await brain.getByTag(
        req.params.tag,
        req.query.limit ?? 50,
        req.query.offset ?? 0,
      );
      return { tag: req.params.tag, count: memories.length, memories };
    },
  });

  // GET /api/collections — tags grouped by prefix
  app.get('/collections', {
    schema: {
      tags: ['tags'],
      summary: 'Get collections — tags grouped by prefix (e.g. project:, topic:)',
    },
    handler: async () => {
      const collections = await brain.getCollections();
      return { count: collections.length, collections };
    },
  });

  // POST /api/memory/:id/tags — add a tag to a memory
  app.post<{
    Params: { id: string };
    Body: { tag: string };
  }>('/memory/:id/tags', {
    schema: {
      tags: ['tags'],
      summary: 'Add a tag to a memory',
      body: {
        type: 'object',
        required: ['tag'],
        properties: {
          tag: { type: 'string' },
        },
      },
    },
    handler: async (req) => {
      const tags = await brain.addTag(req.params.id, req.body.tag);
      return { id: req.params.id, tags };
    },
  });

  // DELETE /api/memory/:id/tags/:tag — remove a tag from a memory
  app.delete<{
    Params: { id: string; tag: string };
  }>('/memory/:id/tags/:tag', {
    schema: {
      tags: ['tags'],
      summary: 'Remove a tag from a memory',
    },
    handler: async (req, reply) => {
      const tags = await brain.removeTag(req.params.id, req.params.tag);
      return { id: req.params.id, tags };
    },
  });
};
