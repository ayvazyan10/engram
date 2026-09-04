/**
 * Coverage for the management/introspection routes — contradictions,
 * embeddings, index, plugins, tags and the lifecycle endpoints on health.
 *
 * These had no tests at all, so a broken handler would only surface in
 * production.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const dbPath = path.join(os.tmpdir(), `engram-server-mgmt-${Date.now()}.db`);

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

async function store(content: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/memory',
    payload: { content, type: 'semantic', source: 'mgmt-test', importance: 0.6, ...extra },
  });
  return res.json().memory.id as string;
}

describe('contradictions', () => {
  it('lists contradictions', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/contradictions' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('contradictions');
  });

  it('checks a specific memory', async () => {
    // This used to call GET on a route registered as POST and accept
    // [200, 404], so it passed on the router's own 404 without the handler
    // ever running — a test that could not fail.
    const id = await store('The API listens on port 4901');
    const res = await app.inject({ method: 'POST', url: `/api/contradictions/check/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('hasContradictions');
  });

  it('404s when checking a memory that does not exist', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/contradictions/check/no-such-memory' });
    expect(res.statusCode).toBe(404);
  });

  it('exposes and updates detector config', async () => {
    const get = await app.inject({ method: 'GET', url: '/api/contradictions/config' });
    expect(get.statusCode).toBe(200);

    const put = await app.inject({
      method: 'PUT',
      url: '/api/contradictions/config',
      payload: { enabled: true, similarityThreshold: 0.7 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().similarityThreshold).toBeCloseTo(0.7, 5);
  });
});

describe('embeddings', () => {
  it('reports embedding status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/embeddings/status' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toHaveProperty('currentModel');
    expect(body).toHaveProperty('currentDimension');
    // Regression guard: the dimension must come from the ACTIVE model.
    expect(body.currentDimension).toBeGreaterThan(0);
  });

  it('runs a backfill without error', async () => {
    await store('Backfill target memory');
    const res = await app.inject({ method: 'POST', url: '/api/embeddings/backfill' });
    expect(res.statusCode).toBe(200);
  });
});

describe('index management', () => {
  it('reports index status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/index/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('entryCount');
  });

  it('saves and rebuilds the index', async () => {
    await store('Index rebuild target');

    const save = await app.inject({ method: 'POST', url: '/api/index/save' });
    expect(save.statusCode).toBe(200);

    const rebuild = await app.inject({ method: 'POST', url: '/api/index/rebuild' });
    expect(rebuild.statusCode).toBe(200);
  });
});

describe('plugins', () => {
  it('lists registered plugins', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/plugins' });
    expect(res.statusCode).toBe(200);
  });

  it('404s for an unknown plugin', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/plugins/no-such-plugin' });
    expect(res.statusCode).toBe(404);
  });
});

describe('tags & collections', () => {
  it('lists the tag cloud', async () => {
    await store('Tagged memory', { tags: ['project:alpha', 'lang:ts'] });

    const res = await app.inject({ method: 'GET', url: '/api/tags' });
    expect(res.statusCode).toBe(200);
  });

  it('lists prefix-based collections', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/collections' });
    expect(res.statusCode).toBe(200);
  });
});

describe('lifecycle', () => {
  it('exposes and updates the decay policy', async () => {
    const get = await app.inject({ method: 'GET', url: '/api/decay/policy' });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toHaveProperty('halfLifeDays');

    const put = await app.inject({
      method: 'PUT',
      url: '/api/decay/policy',
      payload: { halfLifeDays: 14 },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().halfLifeDays).toBe(14);
  });

  it('runs a decay sweep in dry-run mode', async () => {
    // dryRun is a body field, not a querystring.
    const res = await app.inject({ method: 'POST', url: '/api/decay', payload: { dryRun: true } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('scannedCount');
  });

  it('runs consolidation', async () => {
    for (let i = 0; i < 3; i++) {
      await store(`The nightly job finished successfully run ${i}`, { type: 'episodic' });
    }
    const res = await app.inject({ method: 'POST', url: '/api/consolidate', payload: {} });
    expect(res.statusCode).toBe(200);
  });
});
