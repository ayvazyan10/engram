import Fastify from 'fastify';
import { NeuralBrain } from '@engram/core';
import { Server as SocketIOServer } from 'socket.io';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { healthRoutes } from './routes/health.js';
import { memoryRoutes } from './routes/memory.js';
import { searchRoutes } from './routes/search.js';
import { graphRoutes } from './routes/graph.js';
import { contradictionRoutes } from './routes/contradictions.js';
import { embeddingRoutes } from './routes/embeddings.js';
import { indexRoutes } from './routes/index-mgmt.js';
import { webhookRoutes } from './routes/webhooks.js';
import { tagRoutes } from './routes/tags.js';
import { pluginRoutes } from './routes/plugins.js';

const PORT = parseInt(process.env['PORT'] ?? '4901', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const DECAY_INTERVAL = parseInt(process.env['ENGRAM_DECAY_INTERVAL'] ?? '', 10);
const DECAY_THRESHOLD = parseFloat(process.env['ENGRAM_DECAY_THRESHOLD'] ?? '');

// Shared brain instance (initialized once)
export const brain = new NeuralBrain({
  dbPath: process.env['ENGRAM_DB_PATH'],
  defaultSource: 'rest-api',
  namespace: process.env['ENGRAM_NAMESPACE'] || undefined,
  decayPolicy: {
    ...(Number.isFinite(DECAY_INTERVAL) ? { decayIntervalMs: DECAY_INTERVAL } : {}),
    ...(Number.isFinite(DECAY_THRESHOLD) ? { archiveThreshold: DECAY_THRESHOLD } : {}),
  },
});

// Shared Socket.io instance
export let io: SocketIOServer;

async function start() {
  // Initialize brain
  console.info('Initializing Engram brain...');
  await brain.initialize();
  console.info('Brain initialized.');

  const app = Fastify({ logger: { level: 'warn' } });

  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
  });

  // Swagger
  await app.register(swagger, {
    openapi: {
      info: { title: 'Engram API', description: 'Universal AI Brain REST API', version: '0.1.0' },
      tags: [
        { name: 'memory', description: 'Memory CRUD operations' },
        { name: 'search', description: 'Semantic search and recall' },
        { name: 'graph', description: 'Knowledge graph queries' },
        { name: 'contradictions', description: 'Contradiction detection and resolution' },
        { name: 'embeddings', description: 'Embedding model management and re-embedding' },
        { name: 'index', description: 'Vector index persistence and management' },
        { name: 'webhooks', description: 'Webhook subscriptions for memory events' },
        { name: 'tags', description: 'Tagging and collections' },
        { name: 'plugins', description: 'Plugin registration and management' },
        { name: 'health', description: 'Health and status' },
      ],
    },
  });

  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Routes
  await app.register(healthRoutes, { prefix: '/api' });
  await app.register(memoryRoutes, { prefix: '/api' });
  await app.register(searchRoutes, { prefix: '/api' });
  await app.register(graphRoutes, { prefix: '/api' });
  await app.register(contradictionRoutes, { prefix: '/api' });
  await app.register(embeddingRoutes, { prefix: '/api' });
  await app.register(indexRoutes, { prefix: '/api' });
  await app.register(webhookRoutes, { prefix: '/api' });
  await app.register(tagRoutes, { prefix: '/api' });
  await app.register(pluginRoutes, { prefix: '/api' });

  // Start Fastify — it creates and owns the HTTP server
  await app.listen({ port: PORT, host: HOST });
  console.info(`Engram API running at http://${HOST}:${PORT}`);
  console.info(`Swagger docs: http://${HOST}:${PORT}/docs`);

  // Attach Socket.io to Fastify's underlying HTTP server
  io = new SocketIOServer(app.server, {
    cors: { origin: '*' },
  });

  const neuralNs = io.of('/neural');
  neuralNs.on('connection', (socket) => {
    console.info(`WebSocket connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.info(`WebSocket disconnected: ${socket.id}`);
    });
  });
  console.info(`WebSocket: ws://${HOST}:${PORT}/neural`);

  // ─── Auto-decay timer ────────────────────────────────────────────────────
  const decayPolicy = brain.getDecayPolicy();
  if (decayPolicy.decayIntervalMs > 0) {
    setInterval(() => {
      brain
        .runDecaySweep()
        .then((result) => {
          if (result.archivedCount > 0 || result.consolidatedCount > 0) {
            console.info(
              `Decay sweep: archived ${result.archivedCount}, decayed ${result.decayedCount}, consolidated ${result.consolidatedCount} (${result.durationMs}ms)`
            );
            neuralNs.emit('memory:decayed', result);
          }
        })
        .catch((err: unknown) => {
          console.error('Decay sweep failed:', err);
        });
    }, decayPolicy.decayIntervalMs);
    console.info(`Auto-decay enabled: every ${Math.round(decayPolicy.decayIntervalMs / 1000)}s`);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  brain.shutdown();
  process.exit(0);
});

start().catch((err: unknown) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
