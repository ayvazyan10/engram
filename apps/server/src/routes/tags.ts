import type { FastifyPluginAsync, FastifyReply } from 'fastify';
import { brain, notifySyncWrite } from '../index.js';
import { isMemoryNotFound } from '../lib/notFound.js';
import { strictQueryString } from '../lib/strictBody.js';

/**
 * Run a tag mutation, turning core's "memory not found" into a 404.
 *
 * Returns null when the memory is missing so the caller can send its own body;
 * any other failure is re-thrown and handled as a genuine 500.
 */
async function withMemory(
  reply: FastifyReply,
  run: () => Promise<string[]>
): Promise<string[] | null> {
  try {
    return await run();
  } catch (err: unknown) {
    if (!isMemoryNotFound(err)) throw err;
    reply.code(404);
    return null;
  }
}

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
        additionalProperties: false,
        properties: {
          // Floors as well as ceilings — see the note on GET /api/memory:
          // SQLite treats LIMIT -1 as unlimited and a negative OFFSET is a
          // syntax error.
          limit: { type: 'integer', default: 50, minimum: 1, maximum: 200 },
          offset: { type: 'integer', default: 0, minimum: 0 },
        },
      },
    },
    // Fastify's ajv runs with removeAdditional, so `additionalProperties: false`
    // above documents the contract without enforcing it — an unknown key is
    // stripped in silence and the caller is answered 200 for a request that was
    // plainly a typo. This is what enforces it; see lib/strictBody.ts.
    preValidation: strictQueryString(['limit', 'offset']),
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
    handler: async (req, reply) => {
      // addTag/removeTag throw `Memory <id> not found` for an unknown id or one
      // outside the namespace. Letting that escape produced a 500 for what is
      // plainly a 404 — the caller named a resource that does not exist.
      const tags = await withMemory(reply, () => brain.addTag(req.params.id, req.body.tag));
      if (tags === null) return { error: 'Memory not found' };
      notifySyncWrite();
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
      const tags = await withMemory(reply, () => brain.removeTag(req.params.id, req.params.tag));
      if (tags === null) return { error: 'Memory not found' };
      notifySyncWrite();
      return { id: req.params.id, tags };
    },
  });
};
