/**
 * Host allowlist (DNS-rebinding defense) and baseline response headers.
 *
 * The WebSocket half of the rebinding defense was closed last round with an
 * Origin allowlist in `allowRequest`. Origin cannot close the REST half:
 * `isAllowedOrigin(undefined)` returns true for the non-browser clients that
 * send no Origin, and a same-origin browser GET sends none either — so a page
 * at http://attacker.example:4901 whose A record flips to 127.0.0.1 could
 * `fetch('/api/memory')` and be served. Its Host header, however, still says
 * `attacker.example`.
 *
 * The header set is the second half: the dashboard HTML is served from the
 * same origin as the API with no CSP, no nosniff, no framing and no referrer
 * policy at all.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';
import { hostnameOf, isAllowedHost, readHostPolicy } from '../security/hostGuard.js';

const dbPath = path.join(os.tmpdir(), `engram-server-posture-${Date.now()}.db`);
const dashboardIndex = path.resolve(__dirname, '..', '..', '..', '..', 'apps', 'web', 'dist', 'index.html');

let app: FastifyInstance;
let buildApp: typeof import('../index.js')['buildApp'];
let brain: typeof import('../index.js')['brain'];

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';
  delete process.env['ENGRAM_ALLOWED_HOSTS'];

  const mod = await import('../index.js');
  brain = mod.brain;
  buildApp = mod.buildApp;
  await brain.initialize();
  app = await buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  try { brain?.shutdown(); } catch { /* best effort */ }
  cleanupTestDb(dbPath);
  delete process.env['ENGRAM_ALLOWED_HOSTS'];
});

function withHost(host: string, url = '/api/health') {
  return app.inject({ method: 'GET', url, headers: { host } });
}

describe('Host header allowlist', () => {
  it('allows localhost, which is what the local-first default and the container probe use', async () => {
    expect((await withHost('localhost:4901')).statusCode).toBe(200);
    expect((await withHost('localhost')).statusCode).toBe(200);
  });

  it('allows any IP literal — an address has no name to rebind', async () => {
    expect((await withHost('127.0.0.1:4901')).statusCode).toBe(200);
    expect((await withHost('192.168.1.5:4901')).statusCode).toBe(200);
    expect((await withHost('[::1]:4901')).statusCode).toBe(200);
  });

  it('refuses an attacker-controlled hostname pointed at loopback', async () => {
    const res = await withHost('attacker.example:4901');
    expect(res.statusCode).toBe(403);
    expect((await withHost('attacker.example')).statusCode).toBe(403);
  });

  it('still serves the dashboard shell under any Host', async () => {
    // Gating the HTML would recreate the problem the static exemption fixed:
    // a browser cannot attach anything to a top-level navigation. The shell
    // carries no data — every read and write lives under /api/.
    const res = await withHost('attacker.example:4901', '/');
    expect(res.statusCode).not.toBe(403);
  });

  it('accepts a named host once ENGRAM_ALLOWED_HOSTS lists it', async () => {
    process.env['ENGRAM_ALLOWED_HOSTS'] = 'engram.example.com, api';
    const configured = await buildApp();
    await configured.ready();
    try {
      const ok = await configured.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: 'engram.example.com' },
      });
      expect(ok.statusCode).toBe(200);

      const proxied = await configured.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: 'api:4901' },
      });
      expect(proxied.statusCode).toBe(200);

      const denied = await configured.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: 'attacker.example' },
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      await configured.close();
      delete process.env['ENGRAM_ALLOWED_HOSTS'];
    }
  });

  it('can be turned off entirely with ENGRAM_ALLOWED_HOSTS=*', async () => {
    process.env['ENGRAM_ALLOWED_HOSTS'] = '*';
    const open = await buildApp();
    await open.ready();
    try {
      const res = await open.inject({
        method: 'GET',
        url: '/api/health',
        headers: { host: 'anything.example' },
      });
      expect(res.statusCode).toBe(200);
    } finally {
      await open.close();
      delete process.env['ENGRAM_ALLOWED_HOSTS'];
    }
  });
});

describe('security response headers', () => {
  it('sets the baseline headers on an API response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
  });

  it('sets them on the dashboard HTML too', async () => {
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });

  it('does not need unsafe-eval or inline scripts', async () => {
    const csp = String((await app.inject({ method: 'GET', url: '/' })).headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain("'unsafe-inline'; script-src");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('allows the blob: worker bootstrap the 3D text labels need', async () => {
    // troika-three-text calls importScripts() on a blob URL it builds at
    // runtime, and importScripts is governed by script-src rather than
    // worker-src. Without blob: here every label in the graph silently vanishes
    // under this server while still rendering under the Vite dev server, which
    // sends no CSP at all — which is exactly what was happening.
    const csp = String((await app.inject({ method: 'GET', url: '/' })).headers['content-security-policy']);
    const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src'));
    expect(scriptSrc).toBe("script-src 'self' blob:");
    expect(csp).toContain('worker-src');
  });

  it('permits every external origin the built dashboard actually loads', async () => {
    // The policy is only worth shipping if the page still works under it. The
    // built index.html is the ground truth for what it fetches.
    if (!fs.existsSync(dashboardIndex)) return;

    const html = fs.readFileSync(dashboardIndex, 'utf8');
    const origins = new Set(
      [...html.matchAll(/https:\/\/[a-z0-9.-]+/gi)].map((m) => m[0])
    );

    const csp = String((await app.inject({ method: 'GET', url: '/' })).headers['content-security-policy']);
    for (const origin of origins) {
      expect(csp, `CSP must allow ${origin}, which index.html references`).toContain(origin);
    }
  });

  it('permits the font CDN the 3D text labels fetch from at runtime', async () => {
    // index.html does not name it: troika-three-text (via the react-three
    // bundle) fetches its unicode font index from cdn.jsdelivr.net the first
    // time a label needs a glyph outside the bundled font. Blocking it costs
    // no security and silently breaks the canvas, so it is allowlisted.
    // `grep -o 'https://cdn.jsdelivr.net[^"]*' apps/web/dist/assets/*.js`
    const csp = String((await app.inject({ method: 'GET', url: '/' })).headers['content-security-policy']);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/cdn\.jsdelivr\.net/);
  });

  it('sends no HSTS by default — the server speaks plain HTTP', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.headers['strict-transport-security']).toBeUndefined();
  });
});

// `inject` always synthesises a Host header from the URL, so the missing- and
// malformed-header paths are only reachable at the function level.
describe('isAllowedHost', () => {
  const policy = readHostPolicy({} as NodeJS.ProcessEnv);

  it('refuses a request carrying no Host at all', () => {
    expect(isAllowedHost(undefined, policy)).toBe(false);
    expect(isAllowedHost('', policy)).toBe(false);
    expect(isAllowedHost('   ', policy)).toBe(false);
  });

  it('strips the port and normalises case before matching', () => {
    expect(hostnameOf('LocalHost:4901')).toBe('localhost');
    expect(hostnameOf('[::1]:4901')).toBe('::1');
    expect(hostnameOf('::1')).toBe('::1');
    expect(hostnameOf('example.com')).toBe('example.com');
  });

  it('accepts *.localhost, which RFC 6761 reserves for loopback', () => {
    expect(isAllowedHost('engram.localhost:4901', policy)).toBe(true);
  });

  it('does not let a suffix trick past the allowlist', () => {
    const configured = readHostPolicy({ ENGRAM_ALLOWED_HOSTS: 'engram.example.com' } as NodeJS.ProcessEnv);
    expect(isAllowedHost('engram.example.com', configured)).toBe(true);
    expect(isAllowedHost('evil-engram.example.com', configured)).toBe(false);
    expect(isAllowedHost('engram.example.com.evil.test', configured)).toBe(false);
  });
});
