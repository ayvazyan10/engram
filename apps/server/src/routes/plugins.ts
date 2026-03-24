import type { FastifyPluginAsync } from 'fastify';
import { brain } from '../index.js';

export const pluginRoutes: FastifyPluginAsync = async (app) => {
  // GET /api/plugins — list all registered plugins
  app.get('/plugins', {
    schema: {
      tags: ['plugins'],
      summary: 'List all registered plugins with their hooks and metadata',
    },
    handler: async () => {
      const plugins = brain.listPlugins();
      return { count: plugins.length, plugins };
    },
  });

  // GET /api/plugins/:id — get a single plugin
  app.get<{ Params: { id: string } }>('/plugins/:id', {
    schema: {
      tags: ['plugins'],
      summary: 'Get a registered plugin by ID',
    },
    handler: async (req, reply) => {
      const plugins = brain.listPlugins();
      const plugin = plugins.find((p) => p.id === req.params.id);
      if (!plugin) {
        reply.code(404);
        return { error: 'Plugin not found' };
      }
      return plugin;
    },
  });

  // DELETE /api/plugins/:id — unregister a plugin
  app.delete<{ Params: { id: string } }>('/plugins/:id', {
    schema: {
      tags: ['plugins'],
      summary: 'Unregister a plugin by ID',
    },
    handler: async (req, reply) => {
      const removed = brain.unregisterPlugin(req.params.id);
      if (!removed) {
        reply.code(404);
        return { error: 'Plugin not found' };
      }
      reply.code(204);
      return;
    },
  });
};
