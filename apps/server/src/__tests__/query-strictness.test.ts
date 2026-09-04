/**
 * Unknown query parameters are refused, not stripped.
 *
 * `GET /api/graph/edges` declared `additionalProperties: false` and did
 * nothing with it: Fastify's ajv runs with `removeAdditional`, so an unknown
 * key is deleted from `req.query` before the handler sees it and the caller is
 * answered 200. `?bogus=1` on that route returned the full edge set against a
 * live server. `/api/analytics` was given a `strictQueryString` preValidation
 * hook for exactly this last round; the schema alone was never the enforcement.
 *
 * The failure mode is a quiet wrong answer rather than an error: `?minStrenght=0.9`
 * is one letter from `minStrength`, and the response looked like a filtered
 * edge set while being the unfiltered one. Every GET route with a query schema
 * is held to the same rule here, so the next one added cannot inherit the hole.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const dbPath = path.join(os.tmpdir(), `engram-query-strictness-${process.pid}.db`);

let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';

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
});

describe('GET /api/graph/edges', () => {
  it('answers a known parameter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/graph/edges?minStrength=0.5' });
    expect(res.statusCode).toBe(200);
    expect(res.json().minStrength).toBe(0.5);
  });

  it('refuses an unknown parameter instead of silently dropping it', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/graph/edges?bogus=1' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Unknown query parameter: bogus.');
  });

  it('refuses a near-miss typo of a real parameter — the case that reads as a filter', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/graph/edges?minStrenght=0.9' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('minStrenght');
    expect(res.json().message).toContain('Allowed: minStrength, limit.');
  });

  it('names every unknown parameter, not just the first', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/graph/edges?a=1&b=2' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Unknown query parameters: a, b.');
  });
});

/**
 * Every other GET route carrying a query schema. These did not declare
 * `additionalProperties: false`, so unlike /api/graph/edges they were not
 * claiming a strictness they lacked — but the quiet-wrong-answer failure is
 * identical (`?limt=5` reads as a page size and is answered with the default),
 * and the guard is the same one line.
 */
describe.each([
  ['/api/memory', '/api/memory?limit=5', 'type, source, limit, offset'],
  ['/api/tags/:tag', '/api/tags/anything?limit=5', 'limit, offset'],
  ['/api/contradictions', '/api/contradictions?limit=5', 'limit'],
  ['/api/reflections', '/api/reflections?limit=5', 'limit, type'],
  ['/api/webhooks', '/api/webhooks?activeOnly=true', 'activeOnly'],
  ['/api/analytics', '/api/analytics?days=7', 'days'],
])('%s', (_route, validUrl, allowed) => {
  it('accepts its documented parameters', async () => {
    const res = await app.inject({ method: 'GET', url: validUrl });
    expect(res.statusCode).toBe(200);
  });

  it('refuses an unknown parameter', async () => {
    const separator = validUrl.includes('?') ? '&' : '?';
    const res = await app.inject({ method: 'GET', url: `${validUrl}${separator}bogus=1` });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Unknown query parameter: bogus.');
    expect(res.json().message).toContain(`Allowed: ${allowed}.`);
  });
});

describe('GET /api/graph/:id', () => {
  it('refuses an unknown parameter', async () => {
    const stored = await app.inject({
      method: 'POST',
      url: '/api/memory',
      payload: { content: 'A node to hang a strictness check on', type: 'semantic' },
    });
    const id = stored.json().memory.id as string;

    expect((await app.inject({ method: 'GET', url: `/api/graph/${id}?depth=1` })).statusCode).toBe(200);

    const res = await app.inject({ method: 'GET', url: `/api/graph/${id}?dept=1` });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Allowed: depth.');
  });
});

describe('GET /api/recall/stream', () => {
  it('refuses an unknown parameter before opening the event stream', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recall/stream?query=hello&topK=3' });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toContain('Unknown query parameter: topK.');
  });
});
