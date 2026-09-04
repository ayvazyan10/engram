/**
 * Static dashboard exemption from the ENGRAM_API_KEY hook.
 *
 * The onRequest hook that gates /api/* used to apply to every request,
 * including the dashboard's static bundle (@fastify/static, registered
 * around buildApp()'s dashboard block) and the SPA fallback
 * (setNotFoundHandler). A browser cannot attach X-API-Key to a top-level
 * navigation, so GET / returning 401 meant the page — and therefore any way
 * to ever submit the key — could never load once ENGRAM_API_KEY was set.
 *
 * The hook now exempts everything outside /api/* while every /api/* route
 * stays gated exactly as before.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const TEST_API_KEY = 'static-auth-test-key-4d2e9c';

describe('dashboard static assets are exempt from the API-key hook', () => {
  const dbPath = path.join(os.tmpdir(), `engram-static-auth-${process.pid}.db`);
  // Same resolution buildApp() uses (apps/server/src -> repo root -> apps/web/dist)
  // — one extra '..' since this file lives one directory deeper, in __tests__.
  const dashboardDist = path.resolve(__dirname, '..', '..', '..', '..', 'apps', 'web', 'dist');
  const indexPath = path.join(dashboardDist, 'index.html');
  const assetPath = path.join(dashboardDist, 'assets', 'app.js');
  let createdDist = false;

  let app: FastifyInstance;
  let brain: typeof import('../index.js')['brain'];

  beforeAll(async () => {
    // Guarantee the dashboard-serving branch is active regardless of whether
    // `pnpm --filter web build` happens to have run already in this
    // checkout — the behavior under test only exists when
    // apps/web/dist/index.html is present.
    if (!fs.existsSync(indexPath)) {
      createdDist = true;
      fs.mkdirSync(path.join(dashboardDist, 'assets'), { recursive: true });
      fs.writeFileSync(indexPath, '<!doctype html><html><body>Engram dashboard</body></html>');
      fs.writeFileSync(assetPath, '// test asset');
    }

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
    if (createdDist) {
      fs.rmSync(dashboardDist, { recursive: true, force: true });
    }
  });

  it('serves the dashboard shell at GET / with no key', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves the SPA fallback for a client-side route with no key', async () => {
    const res = await app.inject({ method: 'GET', url: '/some/client/route' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
  });

  it('serves a built static asset with no key', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/app.js' });
    expect(res.statusCode).toBe(200);
  });

  it('still rejects /api/memory with no key', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memory' });
    expect(res.statusCode).toBe(401);
  });

  it('still accepts /api/memory with the correct key', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/memory',
      headers: { 'x-api-key': TEST_API_KEY },
    });
    expect(res.statusCode).toBe(200);
  });

  it('still accepts /api/health with no key (container probes)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
  });

  it('never serves a real file outside the dashboard root through the exemption', async () => {
    const res = await app.inject({ method: 'GET', url: '/../package.json' });
    // Whatever @fastify/static or the SPA fallback does with a traversal
    // attempt, it must never come back with a real repository file — either
    // it's rejected outright, or normalized down to the dashboard root and
    // served as the fixed HTML shell.
    if (res.statusCode === 200) {
      expect(res.headers['content-type']).toMatch(/text\/html/);
    } else {
      expect(res.statusCode).toBeGreaterThanOrEqual(400);
    }
  });
});
