import Fastify from 'fastify';
import {
  NeuralBrain, SyncEngine, redactSyncUrl,
  readEnvString, readEnvNumber, readEnvNumberOr, readEnvEnum, requireConfiguredEnv,
} from '@engram-ai-memory/core';
import type { NamespaceMode } from '@engram-ai-memory/core';
import { Server as SocketIOServer } from 'socket.io';
import type { Namespace } from 'socket.io';
import type { Server as HttpServer } from 'http';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { timingSafeEqual } from 'crypto';
import { installErrorHandler } from './lib/errorHandler.js';
import { pathnameOf } from './lib/requestPath.js';
import { installHostGuard, readHostPolicy } from './security/hostGuard.js';
import { installRateLimit, readRateLimitConfig } from './security/rateLimit.js';
import { installSecurityHeaders, readSecurityHeaderPolicy } from './security/securityHeaders.js';
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
import { sceneRoutes } from './routes/scene.js';
import { contradictionRoutes } from './routes/contradictions.js';
import { embeddingRoutes } from './routes/embeddings.js';
import { indexRoutes } from './routes/index-mgmt.js';
import { webhookRoutes } from './routes/webhooks.js';
import { tagRoutes } from './routes/tags.js';
import { pluginRoutes } from './routes/plugins.js';
import { reflectionRoutes } from './routes/reflection.js';
import { analyticsRoutes } from './routes/analytics.js';
import { syncRoutes } from './routes/sync.js';

/**
 * Where the API listens.
 *
 * Both read through the shared env helpers rather than `parseInt(x ?? d)` and
 * `x ?? d`. A blank HOST — what a host templating an untouched optional field
 * passes — is `''`, and `listen({ host: '' })` binds every interface, which is
 * the same defect the Ollama proxy's ENGRAM_PROXY_HOST had; blank now means
 * unset and the loopback default stands. A malformed PORT was `NaN`, which
 * survives `??` and reaches listen() as a request for an arbitrary port.
 */
const PORT = readEnvNumber(process.env, 'PORT', { min: 0, max: 65535 }) ?? 4901;
const HOST = readEnvString(process.env, 'HOST') ?? '127.0.0.1';

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

/**
 * Optional shared secret. When UNSET the API stays open (local-first default).
 *
 * Set-but-empty is refused rather than treated as unset. `if (API_KEY)` is
 * false for '', so `ENGRAM_API_KEY=""` — exactly what a host templating an
 * unset optional field produces — turned authentication off while every
 * config file and dashboard still said a key was configured. Unset means "no
 * auth wanted"; empty means "auth wanted, value lost", and only one of those
 * is safe to guess at.
 */
const API_KEY = requireConfiguredEnv(
  process.env,
  'ENGRAM_API_KEY',
  'Unset it to run without authentication (the local-first default), or give ' +
    'it a real value — an empty value used to disable authentication silently.'
);

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
/**
 * Decay tuning. Knobs, not controls: a malformed value warns on stderr and
 * leaves the engine's own default in place rather than aborting startup. The
 * previous `Number.isFinite` guard reached the same outcome but said nothing,
 * so a typo looked exactly like not having set the variable at all.
 */
const DECAY_INTERVAL = readEnvNumberOr(process.env, 'ENGRAM_DECAY_INTERVAL', undefined, { min: 0 });
const DECAY_THRESHOLD = readEnvNumberOr(
  process.env, 'ENGRAM_DECAY_THRESHOLD', undefined, { min: 0, max: 1, integer: false }
);
// Blank means unset — what a host templating an untouched optional field
// passes — so it falls back to the namespace-derived default rather than
// reaching the enum check and aborting startup. An unrecognised value still
// aborts, which is what readEnvEnum does.
const NAMESPACE = readEnvString(process.env, 'ENGRAM_NAMESPACE');
const namespaceMode: NamespaceMode =
  readEnvEnum(process.env, 'ENGRAM_NAMESPACE_MODE', ['none', 'filter', 'isolated'] as const) ??
  (NAMESPACE ? 'filter' : 'none');

/**
 * Cloud sync (Phase 3). Unset ENGRAM_SYNC_URL means sync stays fully off —
 * no SyncEngine is constructed and every write path pays zero overhead.
 */
const SYNC_URL = readEnvString(process.env, 'ENGRAM_SYNC_URL');

/**
 * Sync mode and interval, validated the way the MCP server validates them
 * (packages/mcp/src/syncSettings.ts) — the same two variables answered to two
 * different standards until now.
 *
 * The mode was cast with `as`, so an unrecognised value reached SyncEngine
 * intact and `start()`'s `mode !== 'auto'` check turned the scheduler off:
 * a typo silently disabled sync instead of complaining. The interval went
 * through `parseInt` with nothing reading the result, and `NaN ?? default`
 * keeps the NaN because NaN is not nullish — `setInterval(NaN)` degenerates
 * into a timer firing about every millisecond, i.e. a loop against the user's
 * own Postgres. Both are startup errors now.
 */
const SYNC_MODE = readEnvEnum(process.env, 'ENGRAM_SYNC_MODE', ['auto', 'manual', 'off'] as const) ?? 'auto';
const SYNC_INTERVAL = readEnvNumber(process.env, 'ENGRAM_SYNC_INTERVAL', { min: 1 });

/**
 * Passphrase for E2E encryption of synced rows.
 *
 * Set-but-empty is refused rather than read as "no encryption configured" —
 * the same rule ENGRAM_API_KEY follows above, for the same reason. `''` is
 * falsy, so SyncEngine's `if (!encryptionKey)` took it as "never encrypt" and
 * pushed the whole store in the clear while the config that set the variable
 * still said encryption was on. Core refuses to push plaintext at a database
 * that already holds ciphertext, but a fresh sync target has no such history
 * to check against, and that is the case worth failing on. Unset still means
 * "no encryption wanted"; empty means "wanted, value lost".
 */
const SYNC_ENCRYPTION_KEY = requireConfiguredEnv(
  process.env,
  'ENGRAM_SYNC_ENCRYPTION_KEY',
  'Unset it to sync without end-to-end encryption, or give it the passphrase ' +
    'the sync database was encrypted with — an empty value used to sync in ' +
    'plaintext silently.'
);

// Shared brain instance (initialized once)
export const brain = new NeuralBrain({
  dbPath: readEnvString(process.env, 'ENGRAM_DB_PATH'),
  defaultSource: 'rest-api',
  namespaceMode,
  namespace: NAMESPACE,
  decayPolicy: {
    ...(DECAY_INTERVAL !== undefined ? { decayIntervalMs: DECAY_INTERVAL } : {}),
    ...(DECAY_THRESHOLD !== undefined ? { archiveThreshold: DECAY_THRESHOLD } : {}),
  },
});

// Shared Socket.io instance
export let io: SocketIOServer;

/**
 * The '/neural' namespace the dashboard connects to. All route broadcasts must
 * go through this — emitting on the default namespace silently reaches nobody.
 *
 * KNOWN LIMITATION — namespace scoping stops at the realtime surface.
 * Every emit here reaches every connected socket. In 'filter' mode a
 * POST /api/memory {"namespace":"other"} is broadcast to all of them, and
 * `recall:chunk` streams one caller's recall results to every listener.
 *
 * This is not an IDOR under the current model: there is exactly one shared
 * ENGRAM_API_KEY, so every socket is the same principal as every HTTP caller,
 * and anything it sees on the socket it could also fetch over /api/. It is
 * documented rather than fixed because scoping it properly needs a per-socket
 * namespace claim in the handshake and a room per namespace — which means a
 * matching change in the dashboard client, and a per-connection identity that
 * a single shared key cannot express. Multi-tenant deployments must not treat
 * '/neural' as a tenant boundary until both exist.
 */
export let realtime: Namespace | undefined;

/**
 * Shared SyncEngine instance. Stays null unless ENGRAM_SYNC_URL is configured
 * — see start(). Exported (not a private module symbol) so routes/sync.ts can
 * read status/trigger a sync the same way memory.ts reads `brain`/`realtime`.
 */
export let syncEngine: SyncEngine | null = null;

/** Route handlers call this after every write so 'auto' mode can debounce-sync it. */
export function notifySyncWrite(): void {
  syncEngine?.notifyWrite();
}

/**
 * Attach Socket.io to an already-listening HTTP server and wire up the
 * '/neural' namespace: auth middleware plus connect/disconnect logging.
 *
 * Split out from start() (rather than inlined there) so tests can attach
 * Socket.io to a Fastify instance they control — e.g. one listening on an
 * OS-assigned port — without pulling in the rest of start()'s side effects
 * (sync engine, decay timer, process signal handlers). Sets the module-level
 * `io`/`realtime` exports as a side effect, same as start() did inline.
 */
export function setupRealtime(server: HttpServer): Namespace {
  io = new SocketIOServer(server, {
    // The Origin allowlist has to be enforced HERE, in allowRequest.
    //
    // `cors` cannot refuse a socket: returning false from its origin callback
    // only makes the cors package omit the Access-Control-* headers and then
    // call next() — the handshake still completes. And browsers do not apply
    // CORS to WebSocket upgrades at all, so a disallowed page never even had
    // to care about the missing headers. Any page the user visited could open
    // a socket on '/neural' and read every broadcast memory event (content
    // included). allowRequest runs before any namespace or transport is set
    // up and aborts the engine.io handshake with a 403, for polling and
    // websocket alike, which is the one place the connection can be refused.
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (isAllowedOrigin(origin)) {
        callback(null, true);
        return;
      }
      console.warn(`WebSocket handshake refused: origin '${origin}' is not allowlisted`);
      callback('Forbidden origin', false);
    },
    // Kept for the polling transport's response headers on allowed origins.
    // This is a header policy, never an access control — see above.
    cors: {
      origin: (origin, cb) => cb(null, isAllowedOrigin(origin ?? undefined)),
      credentials: false,
    },
  });

  // Routes must emit on the SAME namespace the dashboard connects to.
  // Namespaces are isolated, so a top-level io.emit() call would broadcast
  // on '/' and never reach a client connected on '/neural'.
  realtime = io.of('/neural');
  const neuralNs = realtime;

  // ─── Socket.io auth (Phase 4, task 4.4) ─────────────────────────────────
  // When ENGRAM_API_KEY is set, require the same key for WebSocket connections.
  // The client passes it as `auth.token` in the socket handshake:
  //   io('/neural', { auth: { token: 'my-api-key' } })
  if (API_KEY) {
    neuralNs.use((socket, next) => {
      const token = socket.handshake.auth?.['token'] as string | undefined;
      if (!token || !secretsMatch(token, API_KEY)) {
        next(new Error('Unauthorized: invalid or missing API key'));
        return;
      }
      next();
    });
  }

  neuralNs.on('connection', (socket) => {
    console.info(`WebSocket connected: ${socket.id}`);
    socket.on('disconnect', () => {
      console.info(`WebSocket disconnected: ${socket.id}`);
    });
  });

  return neuralNs;
}

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

  // Sanitize 5xx bodies before anything can produce one. Fastify 5 ships no
  // error handler of its own, so an uncaught throw returned err.message and
  // err.code verbatim — see lib/errorHandler.ts.
  installErrorHandler(app);

  // Response headers for every reply, including the static bundle and the SPA
  // fallback — see security/securityHeaders.ts.
  installSecurityHeaders(app, readSecurityHeaderPolicy());

  // CORS — explicit allowlist, no credentials (the API uses no cookies).
  await app.register(cors, {
    origin: (origin, cb) => cb(null, isAllowedOrigin(origin ?? undefined)),
    credentials: false,
  });

  // Hook order below is deliberate: reject a rebound Host before spending a
  // rate-limit slot on it, and rate-limit before the key check so that a flood
  // of wrong-key requests is bounded too.
  //
  // Host allowlist — the REST half of the DNS-rebinding defense the WebSocket
  // half already had. See security/hostGuard.ts for why Origin cannot do this.
  installHostGuard(app, readHostPolicy());

  // Per-client request rate limiting on /api/*. See security/rateLimit.ts.
  installRateLimit(app, readRateLimitConfig());

  // Optional API-key auth. Enabled only when ENGRAM_API_KEY is set, so the
  // local-first default is unchanged; health stays open for container probes.
  //
  // Only /api/* is gated. Everything else — the dashboard's built static
  // bundle (@fastify/static, registered below) and its SPA fallback
  // (setNotFoundHandler, also below) — is exempt by construction. A browser
  // cannot attach X-API-Key to a top-level navigation, so if '/' required the
  // key, the page that would let a user ever supply one could never load in
  // the first place. Every real API route lives under /api/ (see the
  // app.register(...routes, { prefix: '/api' }) calls below), so this is not
  // an accidental narrowing of what's protected — and neither the static
  // plugin nor the SPA fallback take the request path as a file path to
  // read (the fallback always serves the same fixed index.html; the static
  // plugin does its own traversal handling), so this exemption cannot become
  // a way to read arbitrary files.
  if (API_KEY) {
    app.addHook('onRequest', async (req, reply) => {
      // Compare the PATH, not the raw request target. `req.url` carries the
      // query string, so the exact-match exemption below missed
      // `/api/health?x=1` — any probe with a cache-buster got a 401 — and a
      // prefix test on the raw URL is just as fragile.
      const pathname = pathnameOf(req.url);

      // The OpenAPI document describes every route, parameter and body shape
      // on the server. The Swagger UI shell itself stays open (a browser
      // cannot attach a key to a top-level navigation, same reason the
      // dashboard is exempt), but the machine-readable spec is gated with the
      // rest of the API surface.
      if (pathname === '/docs/json' || pathname === '/docs/yaml') {
        // fall through to the key check
      } else if (!pathname.startsWith('/api/')) {
        return;
      } else if (pathname === '/api/health') {
        return;
      }

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
        { name: 'sync', description: 'Cloud sync status and manual triggering' },
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
  await app.register(sceneRoutes, { prefix: '/api' });
  await app.register(contradictionRoutes, { prefix: '/api' });
  await app.register(embeddingRoutes, { prefix: '/api' });
  await app.register(indexRoutes, { prefix: '/api' });
  await app.register(webhookRoutes, { prefix: '/api' });
  await app.register(tagRoutes, { prefix: '/api' });
  await app.register(pluginRoutes, { prefix: '/api' });
  await app.register(reflectionRoutes, { prefix: '/api' });
  await app.register(analyticsRoutes, { prefix: '/api' });
  await app.register(syncRoutes, { prefix: '/api' });

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

/**
 * One tick of the auto-decay timer.
 *
 * Every failure path is contained here deliberately. The sweep runs against a
 * policy PUT /api/decay/policy can change at runtime, so a single bad policy
 * used to make it fail on every tick; and a synchronous throw escaping the
 * setInterval callback surfaces as a process-level uncaughtException, which
 * says nothing about which subsystem broke. Log it and leave the schedule
 * intact — the next tick picks up a corrected policy without a restart.
 */
function runScheduledDecaySweep(neuralNs: Namespace): void {
  try {
    void brain
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
        console.error('[engram] decay sweep failed, schedule continues:', err);
      });
  } catch (err: unknown) {
    console.error('[engram] decay sweep could not start, schedule continues:', err);
  }
}

async function start() {
  // Initialize brain
  console.info('Initializing Engram brain...');
  await brain.initialize();
  console.info('Brain initialized.');

  // ─── Cloud sync (Phase 3) ────────────────────────────────────────────────
  if (SYNC_URL) {
    syncEngine = new SyncEngine({
      syncUrl: SYNC_URL,
      mode: SYNC_MODE,
      // Omitted rather than passed as undefined, so SyncEngine's own documented
      // defaults apply instead of an explicit `undefined` overriding them.
      ...(SYNC_INTERVAL !== undefined ? { intervalMs: SYNC_INTERVAL } : {}),
      ...(SYNC_ENCRYPTION_KEY !== undefined ? { encryptionKey: SYNC_ENCRYPTION_KEY } : {}),
      // Wrapped so the callback's return type is exactly Promise<void> — the
      // count syncIndexFromStore() resolves with isn't needed here.
      onIndexRebuildNeeded: async () => {
        await brain.syncIndexFromStore();
      },
      onSyncError: (err) => {
        console.error(`[engram] Sync error: ${err.message}`);
      },
    });
    syncEngine.start();
    console.info(`[engram] Cloud sync enabled: ${redactSyncUrl(SYNC_URL)}`);
    if (SYNC_ENCRYPTION_KEY) {
      console.info('🔐 E2E encryption enabled for cloud sync');
    }
  }

  const app = await buildApp();

  // Start Fastify — it creates and owns the HTTP server
  await app.listen({ port: PORT, host: HOST });
  console.info(`Engram running at http://${HOST}:${PORT}`);
  console.info(`  API:       http://${HOST}:${PORT}/api`);
  console.info(`  Swagger:   http://${HOST}:${PORT}/docs`);

  // Attach Socket.io to Fastify's underlying HTTP server
  const neuralNs = setupRealtime(app.server);
  console.info(`WebSocket: ws://${HOST}:${PORT}/neural`);

  // ─── Auto-decay timer ────────────────────────────────────────────────────
  const decayPolicy = brain.getDecayPolicy();
  if (decayPolicy.decayIntervalMs > 0) {
    setInterval(() => runScheduledDecaySweep(neuralNs), decayPolicy.decayIntervalMs);
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
    if (syncEngine) {
      await syncEngine.dispose();
      syncEngine = null;
    }
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
