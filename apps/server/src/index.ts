import Fastify from 'fastify';
import { NeuralBrain } from '@engram-ai-memory/core';
import type { NamespaceMode } from '@engram-ai-memory/core';
import { Server as SocketIOServer } from 'socket.io';
import type { Namespace } from 'socket.io';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { timingSafeEqual } from 'crypto';
// Read the real release version instead of hardcoding it. This package has no
// "type":"module", so tsc emits CommonJS here and __dirname is available;
// ../package.json resolves from both src/ during dev and dist/ in the image.
export const VERSION: string = (
  JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8')) as { version: string }
).version;

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
import { reflectionRoutes } from './routes/reflection.js';
import { analyticsRoutes } from './routes/analytics.js';

const PORT = parseInt(process.env['PORT'] ?? '4901', 10);
const HOST = process.env['HOST'] ?? '127.0.0.1';

/**
 * Browser origins allowed to call the API.
 *
 * Reflecting the caller's Origin (the previous `origin: true`) defeats the
 * same-origin policy that is the only thing protecting an unauthenticated
 * loopback service — any page the user visited could read and delete every
 * memory. Override with a comma-separated ENGRAM_ALLOWED_ORIGINS.
 */
const ALLOWED_ORIGINS = (process.env['ENGRAM_ALLOWED_ORIGINS'] ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

const DEFAULT_ORIGINS = [
  `http://localhost:${PORT}`,
  `http://127.0.0.1:${PORT}`,
  'http://localhost:4902', // dashboard container
  'http://127.0.0.1:4902',
  'http://localhost:5173', // vite dev server
  'http://127.0.0.1:5173',
];

const originAllowlist = ALLOWED_ORIGINS.length > 0 ? ALLOWED_ORIGINS : DEFAULT_ORIGINS;

/** Optional shared secret. When unset the API stays open (local-first default). */
const API_KEY = process.env['ENGRAM_API_KEY'];

function isAllowedOrigin(origin: string | undefined): boolean {
  // Non-browser clients (CLI, MCP, curl) send no Origin header.
  if (!origin) return true;
  return originAllowlist.includes(origin);
}

/** Constant-time comparison so the key cannot be recovered by timing. */
function secretsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
const DECAY_INTERVAL = parseInt(process.env['ENGRAM_DECAY_INTERVAL'] ?? '', 10);
const DECAY_THRESHOLD = parseFloat(process.env['ENGRAM_DECAY_THRESHOLD'] ?? '');
// `||`, not `??`: an empty ENGRAM_NAMESPACE_MODE — what a host templating an
// unset optional field passes — would otherwise reach the validation below and
// abort startup.
const namespaceMode = (
  process.env['ENGRAM_NAMESPACE_MODE'] || (process.env['ENGRAM_NAMESPACE'] ? 'filter' : 'none')
) as NamespaceMode;
if (!['none', 'filter', 'isolated'].includes(namespaceMode)) {
  throw new Error('ENGRAM_NAMESPACE_MODE must be one of: none, filter, isolated');
}

// Shared brain instance (initialized once)
export const brain = new NeuralBrain({
  dbPath: process.env['ENGRAM_DB_PATH'],
  defaultSource: 'rest-api',
  namespaceMode,
  namespace: process.env['ENGRAM_NAMESPACE'] || undefined,
  decayPolicy: {
    ...(Number.isFinite(DECAY_INTERVAL) ? { decayIntervalMs: DECAY_INTERVAL } : {}),
    ...(Number.isFinite(DECAY_THRESHOLD) ? { archiveThreshold: DECAY_THRESHOLD } : {}),
  },
});

// Shared Socket.io instance
export let io: SocketIOServer;

/**
 * The '/neural' namespace the dashboard connects to. All route broadcasts must
 * go through this — emitting on the default namespace silently reaches nobody.
 */
export let realtime: Namespace | undefined;

/**
 * Build the fully-configured Fastify instance WITHOUT listening.
 *
 * Separated from start() so tests can drive every route through `app.inject()`
 * — previously all registration happened inside start(), so nothing was
 * reachable without binding a real port.
 *
 * The caller is responsible for `brain.initialize()`.
 */
export async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: { level: 'warn' } });

  // CORS — explicit allowlist, no credentials (the API uses no cookies).
  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin ?? undefined)),
    credentials: false,
  });

  // Optional API-key auth. Enabled only when ENGRAM_API_KEY is set, so the
  // local-first default is unchanged; health stays open for container probes.
  if (API_KEY) {
    app.addHook('onRequest', async (req, reply) => {
      if (req.url === '/api/health' || req.url.startsWith('/docs')) return;

      const header = req.headers['authorization'];
      const bearer = typeof header === 'string' && header.startsWith('Bearer ')
        ? header.slice(7)
        : undefined;
      const provided = (req.headers['x-api-key'] as string | undefined) ?? bearer;

      if (!provided || !secretsMatch(provided, API_KEY)) {
        reply.code(401).send({ error: 'Unauthorized' });
      }
    });
    console.info('API key authentication: enabled');
  }

  // Swagger
  await app.register(swagger, {
    openapi: {
      info: { title: 'Engram API', description: 'Universal AI Brain REST API', version: VERSION },
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
        { name: 'reflection', description: 'Memory reflection and LLM-powered insights' },
        { name: 'analytics', description: 'Aggregated memory analytics and management' },
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
  await app.register(reflectionRoutes, { prefix: '/api' });
  await app.register(analyticsRoutes, { prefix: '/api' });

  // ─── Serve 3D dashboard (if built) ──────────────────────────────────────
  const dashboardPath = path.resolve(__dirname, '..', '..', '..', 'apps', 'web', 'dist');
  if (fs.existsSync(path.join(dashboardPath, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: dashboardPath,
      prefix: '/',
      decorateReply: false,
      wildcard: false,
    });

    // SPA fallback — serve index.html for non-API, non-static routes.
    // @fastify/static is registered with `decorateReply: false`, so
    // `reply.sendFile` is unavailable; read the file directly instead.
    const indexPath = path.join(dashboardPath, 'index.html');
    app.setNotFoundHandler(async (req, reply) => {
      if (req.url.startsWith('/api/') || req.url.startsWith('/docs')) {
        return reply.code(404).send({ error: 'Not Found', statusCode: 404 });
      }
      try {
        const data = await fs.promises.readFile(indexPath);
        return reply.header('Content-Type', 'text/html').send(data);
      } catch {
        return reply.code(404).send({ error: 'Not Found', statusCode: 404 });
      }
    });

    console.info(`Dashboard: http://${HOST}:${PORT}`);
  }

  return app;
}

async function start() {
  // Initialize brain
  console.info('Initializing Engram brain...');
  await brain.initialize();
  console.info('Brain initialized.');

  const app = await buildApp();

  // Start Fastify — it creates and owns the HTTP server
  await app.listen({ port: PORT, host: HOST });
  console.info(`Engram running at http://${HOST}:${PORT}`);
  console.info(`  API:       http://${HOST}:${PORT}/api`);
  console.info(`  Swagger:   http://${HOST}:${PORT}/docs`);

  // Attach Socket.io to Fastify's underlying HTTP server
  io = new SocketIOServer(app.server, {
    // Same allowlist as the REST API — '*' let any page open a socket and read
    // every broadcast memory event.
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin ?? undefined)),
      credentials: false,
    },
  });

  // Routes must emit on the SAME namespace the dashboard connects to.
  // Namespaces are isolated, so the previous top-level io.emit() calls were
  // broadcast on '/' and never reached the client on '/neural'.
  realtime = io.of('/neural');
  const neuralNs = realtime;
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
let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.info(`Received ${signal}, shutting down...`);
  try {
    await brain.shutdown();
  } catch (err: unknown) {
    console.error('[engram] shutdown failed:', err);
  }
  process.exit(0);
}

// Only wire process-level handlers and boot the server when this module is the
// entrypoint. Tests import buildApp() from here and must not get a listening
// server, signal handlers or a decay timer as a side effect.
if (require.main === module) {
  // Process-level safety net. Many background paths (webhook dispatch, plugin
  // hooks, SSE streams, decay sweeps) are intentionally fire-and-forget; without
  // these handlers a single stray rejection terminated the whole memory backend.
  // We log and keep serving rather than exiting — losing the service is worse
  // than the failed background task.
  process.on('unhandledRejection', (reason: unknown) => {
    console.error('[engram] unhandled promise rejection:', reason);
  });

  process.on('uncaughtException', (err: unknown) => {
    console.error('[engram] uncaught exception:', err);
  });

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  start().catch((err: unknown) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
