/**
 * Rate limiting on /api/*.
 *
 * Nothing bounded how fast a caller could spend the process's CPU. One
 * POST /api/memory measured 185ms of wall time for 10 KB of content and 785ms
 * for 900 KB, because every store embeds its text; POST /api/memory/batch fans
 * out up to 1000 embeddings through a single Promise.all. A single client
 * could keep the event loop busy indefinitely with entirely valid requests.
 *
 * The limits are configured very low here so the behaviour is exercised in a
 * handful of requests rather than a thousand.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';
import { createRateLimiter, tiersFor, readRateLimitConfig } from '../security/rateLimit.js';

const dbPath = path.join(os.tmpdir(), `engram-rate-limit-${process.pid}.db`);

let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];

beforeAll(async () => {
  vi.resetModules();
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';
  process.env['ENGRAM_RATE_LIMIT_MAX'] = '4';
  process.env['ENGRAM_RATE_LIMIT_WINDOW_MS'] = '60000';

  const mod = await import('../index.js');
  brain = mod.brain;
  await brain.initialize();
  app = await mod.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  try { brain?.shutdown(); } catch { /* best effort */ }
  cleanupTestDb(dbPath);
  delete process.env['ENGRAM_RATE_LIMIT_MAX'];
  delete process.env['ENGRAM_RATE_LIMIT_WINDOW_MS'];
});

describe('the /api/* limiter', () => {
  it('answers 429 with Retry-After once the window budget is spent', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) {
      codes.push((await app.inject({ method: 'GET', url: '/api/health' })).statusCode);
    }

    expect(codes.slice(0, 4)).toEqual([200, 200, 200, 200]);
    expect(codes.slice(4)).toEqual([429, 429]);

    const limited = await app.inject({ method: 'GET', url: '/api/health' });
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['x-ratelimit-limit']).toBe('4');
  });

  it('does not rate-limit the dashboard shell', async () => {
    // Static assets cost nothing measurable, and limiting them would make the
    // dashboard flicker into errors while it fetches its own bundle.
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: 'GET', url: '/' });
      expect(res.statusCode).not.toBe(429);
    }
  });
});

describe('tier classification', () => {
  it('puts whole-store passes in their own tier', () => {
    expect(tiersFor('POST', '/api/index/rebuild')).toEqual(['whole-store', 'global']);
    expect(tiersFor('POST', '/api/embeddings/re-embed')).toEqual(['whole-store', 'global']);
    expect(tiersFor('POST', '/api/sync/trigger')).toEqual(['whole-store', 'global']);
  });

  it('treats writes and searches as heavy but a plain listing as not', () => {
    expect(tiersFor('POST', '/api/memory')).toEqual(['heavy', 'global']);
    expect(tiersFor('POST', '/api/search')).toEqual(['heavy', 'global']);
    expect(tiersFor('GET', '/api/recall/stream')).toEqual(['heavy', 'global']);
    expect(tiersFor('GET', '/api/memory')).toEqual(['global']);
    expect(tiersFor('GET', '/api/stats')).toEqual(['global']);
  });
});

describe('the counter itself', () => {
  const config = readRateLimitConfig({
    ENGRAM_RATE_LIMIT_MAX: '2',
    ENGRAM_RATE_LIMIT_WINDOW_MS: '1000',
  } as NodeJS.ProcessEnv);

  it('counts per client, not globally', () => {
    const check = createRateLimiter(config);
    expect(check('global', 'a', 0).allowed).toBe(true);
    expect(check('global', 'a', 0).allowed).toBe(true);
    expect(check('global', 'a', 0).allowed).toBe(false);
    // A different client still has its full budget.
    expect(check('global', 'b', 0).allowed).toBe(true);
  });

  it('resets when the window rolls over', () => {
    const check = createRateLimiter(config);
    check('global', 'a', 0);
    check('global', 'a', 0);
    expect(check('global', 'a', 0).allowed).toBe(false);
    expect(check('global', 'a', 1001).allowed).toBe(true);
  });

  it('treats a max of 0 as "no limit for this tier"', () => {
    const off = readRateLimitConfig({ ENGRAM_RATE_LIMIT_MAX: '0' } as NodeJS.ProcessEnv);
    const check = createRateLimiter(off);
    for (let i = 0; i < 50; i++) expect(check('global', 'a', 0).allowed).toBe(true);
  });
});
