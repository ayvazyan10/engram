/**
 * Edge cases in the ENGRAM_API_KEY onRequest hook.
 *
 * Two of them were reachable with a single character of input:
 *
 *   GET /api/health?x=1  -> 401, because the exemption compared the RAW
 *                           request target ('/api/health?x=1') against the
 *                           literal '/api/health'. Any probe that adds a
 *                           cache-buster broke.
 *   GET /docs/json       -> 200 without a key, serving the complete OpenAPI
 *                           description of every route and body shape.
 *
 * The static-bundle and SPA-fallback exemptions are deliberate and covered by
 * static-auth.test.ts — nothing here may narrow them.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const TEST_API_KEY = 'api-key-edges-8f31c0';
const dbPath = path.join(os.tmpdir(), `engram-api-key-edges-${process.pid}.db`);

let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];

beforeAll(async () => {
  vi.resetModules();
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';
  process.env['ENGRAM_API_KEY'] = TEST_API_KEY;

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
  delete process.env['ENGRAM_API_KEY'];
});

describe('the health exemption is a path, not a string', () => {
  it('exempts /api/health with a query string', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health?x=1' });
    expect(res.statusCode).toBe(200);
  });

  it('still exempts the bare path', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });

  it('does not exempt anything that merely starts with it', async () => {
    // A prefix test would have opened /api/healthcheck-ish paths too.
    const res = await app.inject({ method: 'GET', url: '/api/memory?limit=1' });
    expect(res.statusCode).toBe(401);
  });
});

describe('the OpenAPI document is gated with the API', () => {
  it('rejects /docs/json without a key', async () => {
    expect((await app.inject({ method: 'GET', url: '/docs/json' })).statusCode).toBe(401);
  });

  it('rejects /docs/yaml without a key', async () => {
    expect((await app.inject({ method: 'GET', url: '/docs/yaml' })).statusCode).toBe(401);
  });

  it('serves /docs/json with the key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/docs/json',
      headers: { 'x-api-key': TEST_API_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('openapi');
  });

  it('still serves the Swagger UI shell so a key can be entered in it', async () => {
    // Same reason the dashboard shell is exempt: a browser cannot attach a
    // header to a top-level navigation.
    const res = await app.inject({ method: 'GET', url: '/docs' });
    expect(res.statusCode).not.toBe(401);
  });
});

describe('accepted key transports are unchanged', () => {
  it('accepts x-api-key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory',
      headers: { 'x-api-key': TEST_API_KEY },
    });
    expect(res.statusCode).toBe(200);
  });

  it('accepts an Authorization bearer token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('rejects a wrong key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory',
      headers: { 'x-api-key': 'not-the-key' },
    });
    expect(res.statusCode).toBe(401);
  });
});
