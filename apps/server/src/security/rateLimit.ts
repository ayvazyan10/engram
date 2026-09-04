import type { FastifyInstance } from 'fastify';
import { pathnameOf } from '../lib/requestPath.js';

/**
 * Request rate limiting for /api/*.
 *
 * Nothing bounded how fast a caller could spend the server's CPU. One
 * POST /api/memory costs 185ms of wall time for 10 KB of content and 785ms for
 * 900 KB, because every store embeds its text; POST /api/memory/batch fans out
 * up to 1000 embeddings through a single Promise.all; and the whole-store
 * operations walk or rewrite every row. A single client could saturate the
 * process indefinitely with ordinary, valid requests.
 *
 * Implemented here rather than pulled in as a plugin: the limiter needs no
 * shared store (this is a single-process, local-first server), and adding a
 * dependency would mean touching the workspace lockfile, which is shared with
 * work happening in parallel. The algorithm is the same fixed window
 * @fastify/rate-limit uses by default.
 *
 * Three tiers, because the endpoints differ by two orders of magnitude in cost:
 *
 *   global      every /api/* request
 *   heavy       anything that embeds text or runs a search
 *   whole-store the full-store passes, which additionally hold a single-flight
 *               guard (see lib/exclusive.ts) — the limit is about how often a
 *               caller may kick one off, not about overlap
 *
 * Keyed by client address. There is no attempt to key by API key: under the
 * single-shared-key model every caller presents the same one, so it carries no
 * information a limiter could use.
 */

export type RateLimitTier = 'global' | 'heavy' | 'whole-store';

export interface RateLimitConfig {
  readonly windowMs: number;
  readonly max: Readonly<Record<RateLimitTier, number>>;
  readonly disabled: boolean;
}

/** Upper bound on tracked client keys, so the map cannot grow without limit. */
const MAX_TRACKED_KEYS = 20_000;

const DEFAULTS = {
  windowMs: 60_000,
  global: 1000,
  heavy: 300,
  wholeStore: 30,
} as const;

function intFromEnv(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function readRateLimitConfig(env: NodeJS.ProcessEnv = process.env): RateLimitConfig {
  return {
    windowMs: Math.max(1, intFromEnv(env['ENGRAM_RATE_LIMIT_WINDOW_MS'], DEFAULTS.windowMs)),
    max: {
      global: intFromEnv(env['ENGRAM_RATE_LIMIT_MAX'], DEFAULTS.global),
      heavy: intFromEnv(env['ENGRAM_RATE_LIMIT_HEAVY_MAX'], DEFAULTS.heavy),
      'whole-store': intFromEnv(env['ENGRAM_RATE_LIMIT_WHOLE_STORE_MAX'], DEFAULTS.wholeStore),
    },
    disabled: env['ENGRAM_RATE_LIMIT_DISABLED'] === 'true',
  };
}

/** Paths whose handler rewrites or walks the entire store. */
const WHOLE_STORE_PATHS: readonly string[] = [
  '/api/consolidate',
  '/api/decay',
  '/api/embeddings/backfill',
  '/api/embeddings/re-embed',
  '/api/index/rebuild',
  '/api/index/save',
  '/api/sync/trigger',
];

/** Paths that embed text or run a vector search on every call. */
const HEAVY_PATHS: readonly string[] = [
  '/api/memory',
  '/api/memory/batch',
  '/api/memory/bulk/archive',
  '/api/memory/bulk/tag',
  '/api/recall',
  '/api/recall/stream',
  '/api/search',
];

/**
 * Which tiers a request belongs to, most specific first. A request is checked
 * against every tier it matches, so a heavy call also consumes global budget.
 */
export function tiersFor(method: string, pathname: string): readonly RateLimitTier[] {
  if (WHOLE_STORE_PATHS.includes(pathname)) return ['whole-store', 'global'];

  // GET /api/memory is a plain list; only the writing/searching verbs are heavy.
  const isRead = method === 'GET' || method === 'HEAD';
  if (HEAVY_PATHS.includes(pathname) && (!isRead || pathname === '/api/recall/stream')) {
    return ['heavy', 'global'];
  }

  return ['global'];
}

interface Window {
  count: number;
  resetAt: number;
}

interface Decision {
  readonly allowed: boolean;
  readonly limit: number;
  readonly remaining: number;
  readonly resetAt: number;
}

/**
 * Fixed-window counters keyed by `tier:client`.
 *
 * State is per limiter instance (one per Fastify app) rather than module-level
 * so that a test — or an embedder building two apps — starts from a clean slate.
 */
export function createRateLimiter(config: RateLimitConfig) {
  const windows = new Map<string, Window>();

  function prune(now: number): void {
    for (const [key, window] of windows) {
      if (window.resetAt <= now) windows.delete(key);
    }
    // Still oversized after dropping everything expired: the process is under
    // a spray of distinct sources. Dropping the table costs those clients one
    // window of accounting, which is strictly better than growing forever.
    if (windows.size > MAX_TRACKED_KEYS) windows.clear();
  }

  return function check(tier: RateLimitTier, client: string, now = Date.now()): Decision {
    const limit = config.max[tier];
    if (limit <= 0) {
      return { allowed: true, limit: 0, remaining: 0, resetAt: now + config.windowMs };
    }

    if (windows.size >= MAX_TRACKED_KEYS) prune(now);

    const key = `${tier}:${client}`;
    const existing = windows.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      const fresh: Window = { count: 1, resetAt: now + config.windowMs };
      windows.set(key, fresh);
      return { allowed: true, limit, remaining: limit - 1, resetAt: fresh.resetAt };
    }

    existing.count += 1;
    const remaining = Math.max(0, limit - existing.count);
    return { allowed: existing.count <= limit, limit, remaining, resetAt: existing.resetAt };
  };
}

/**
 * Install the limiter on /api/*.
 *
 * Static assets and the SPA fallback are exempt: they are served from disk,
 * cost nothing measurable, and rate-limiting a page load would make the
 * dashboard flicker into errors while it fetches its own bundle.
 */
export function installRateLimit(app: FastifyInstance, config: RateLimitConfig): void {
  if (config.disabled) return;

  const check = createRateLimiter(config);

  app.addHook('onRequest', async (req, reply) => {
    const pathname = pathnameOf(req.url);
    if (!pathname.startsWith('/api/')) return;

    const client = req.ip || 'unknown';

    for (const tier of tiersFor(req.method, pathname)) {
      const decision = check(tier, client);
      if (decision.allowed) continue;

      const retryAfterSec = Math.max(1, Math.ceil((decision.resetAt - Date.now()) / 1000));
      req.log.warn({ tier, client, url: req.url }, 'rate limit exceeded');

      await reply
        .code(429)
        .header('Retry-After', String(retryAfterSec))
        .header('X-RateLimit-Limit', String(decision.limit))
        .header('X-RateLimit-Remaining', '0')
        .header('X-RateLimit-Reset', String(Math.ceil(decision.resetAt / 1000)))
        .send({
          error: 'Too Many Requests',
          message: `Rate limit exceeded for the '${tier}' tier. Retry in ${retryAfterSec}s.`,
        });
      return;
    }
  });
}
