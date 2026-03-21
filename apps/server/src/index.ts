import Fastify from 'fastify';
import { NeuralBrain } from '@neural-core/core';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

import { healthRoutes } from './routes/health.js';
import { memoryRoutes } from './routes/memory.js';
import { searchRoutes } from './routes/search.js';
import { graphRoutes } from './routes/graph.js';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';

// Shared brain instance (initialized once)
export const brain = new NeuralBrain({
  dbPath: process.env['NEURAL_CORE_DB_PATH'],
  defaultSource: 'rest-api',
});

// Shared Socket.io instance
export let io: SocketIOServer;

async function start() {
  // Initialize brain
  console.info('Initializing NeuralCore brain...');
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
      info: { title: 'NeuralCore API', description: 'Universal AI Brain REST API', version: '0.1.0' },
      tags: [
        { name: 'memory', description: 'Memory CRUD operations' },
        { name: 'search', description: 'Semantic search and recall' },
        { name: 'graph', description: 'Knowledge graph queries' },
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

  // Create HTTP server for Socket.io
  const httpServer = createServer(app.server);

  io = new SocketIOServer(httpServer, {
    cors: { origin: '*' },
  });

  const neuralNs = io.of('/neural');
  neuralNs.on('connection', (socket) => {
    console.info(`WebSocket connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.info(`WebSocket disconnected: ${socket.id}`);
    });
  });

  // Start
  await app.ready();
  httpServer.listen(PORT, HOST, () => {
    console.info(`NeuralCore API running at http://${HOST}:${PORT}`);
    console.info(`Swagger docs: http://${HOST}:${PORT}/docs`);
    console.info(`WebSocket: ws://${HOST}:${PORT}/neural`);
  });
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
