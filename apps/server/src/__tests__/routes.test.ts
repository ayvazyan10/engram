/**
 * Route-level tests driven through Fastify's `inject()` — no port binding.
 *
 * apps/server previously had no tests at all, while the audit found real
 * defects in these routes: missing input validation (500s on junk query
 * params), unbounded arrays, the graph endpoint ignoring `depth` and dropping
 * inbound edges, and PATCH rewriting content without re-embedding.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';

const dbPath = path.join(os.tmpdir(), `engram-server-test-${Date.now()}.db`);

let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];

beforeAll(async () => {
  // Must be set before importing the server module — the brain singleton reads
  // it at construction time.
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0'; // no background sweeps during tests

  const mod = await import('../index.js');
  brain = mod.brain;
  await brain.initialize();
  app = await mod.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  // shutdown() is synchronous.
  try { brain?.shutdown(); } catch { /* best effort */ }
  for (const suffix of ['', '-shm', '-wal', '-journal', '.index']) {
    try { fs.unlinkSync(dbPath + suffix); } catch {}
  }
});

/** Store a memory through the API and return its id. */
async function storeMemory(content: string, extra: Record<string, unknown> = {}): Promise<string> {
  const res = await app.inject({
    method: 'POST',
    url: '/api/memory',
    payload: { content, type: 'semantic', source: 'route-test', importance: 0.6, ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().memory.id as string;
}

describe('health & stats', () => {
  it('GET /api/health reports the real package version', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.status).toBe('ok');
    // Regression: this was hardcoded to '0.1.0' while packages were 0.3.0.
    expect(body.version).not.toBe('0.1.0');
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(typeof body.uptime).toBe('number');
  });

  it('GET /api/stats returns type breakdown', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('byType');
  });
});

describe('memory CRUD', () => {
  it('stores and reads back a memory', async () => {
    const id = await storeMemory('Fastify serves the Engram REST API');

    const res = await app.inject({ method: 'GET', url: `/api/memory/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().content).toContain('Fastify');
  });

  it('404s for an unknown id', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memory/no-such-id' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects importance outside 0..1', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory',
      payload: { content: 'bad importance', importance: 5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a body with no content', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/memory', payload: { type: 'semantic' } });
    expect(res.statusCode).toBe(400);
  });

  it('caps the list limit at 200 (the CLI export contract)', async () => {
    const ok = await app.inject({ method: 'GET', url: '/api/memory?limit=200' });
    expect(ok.statusCode).toBe(200);

    // `engram export` used to request limit=100000 and always got a 400.
    const tooBig = await app.inject({ method: 'GET', url: '/api/memory?limit=100000' });
    expect(tooBig.statusCode).toBe(400);
  });

  it('paginates with offset', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memory?limit=1&offset=0' });
    expect(res.statusCode).toBe(200);
    expect(res.json().memories).toHaveLength(1);
  });

  it('bounds the batch array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/batch',
      payload: { memories: Array.from({ length: 1001 }, (_, i) => ({ content: `m${i}` })) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('archives on DELETE', async () => {
    const id = await storeMemory('This memory will be archived');

    const del = await app.inject({ method: 'DELETE', url: `/api/memory/${id}` });
    expect(del.statusCode).toBe(204);

    const list = await app.inject({ method: 'GET', url: '/api/memory?limit=200' });
    expect(list.json().memories.some((m: { id: string }) => m.id === id)).toBe(false);
  });
});

describe('search & recall', () => {
  it('returns semantically related memories', async () => {
    await storeMemory('PostgreSQL uses multiversion concurrency control');

    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: { query: 'postgres concurrency', topK: 5, threshold: 0.1 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('results');
  });

  it('assembles a recall context', async () => {
    await storeMemory('The deployment pipeline runs on GitHub Actions');

    const res = await app.inject({
      method: 'POST',
      url: '/api/recall',
      payload: { query: 'deployment pipeline', maxTokens: 500 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('context');
  });

  it('rejects an out-of-range topK', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: { query: 'x', topK: 9999 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('bounds maxTokens on the streaming endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/recall/stream?query=x&maxTokens=999999' });
    expect(res.statusCode).toBe(400);
  });
});

describe('analytics', () => {
  it('validates the days querystring instead of 500ing', async () => {
    // Regression: unvalidated `days` produced NaN and threw "Invalid time value".
    const bad = await app.inject({ method: 'GET', url: '/api/analytics?days=abc' });
    expect(bad.statusCode).toBe(400);

    const tooMany = await app.inject({ method: 'GET', url: '/api/analytics?days=100000' });
    expect(tooMany.statusCode).toBe(400);

    const good = await app.inject({ method: 'GET', url: '/api/analytics?days=30' });
    expect(good.statusCode).toBe(200);
  });

  it('re-embeds on content edit so search follows the new text', async () => {
    const id = await storeMemory('The release train departs on Monday');

    const patch = await app.inject({
      method: 'PATCH',
      url: `/api/memory/${id}`,
      payload: { content: 'The release train departs on Friday' },
    });
    expect(patch.statusCode).toBe(200);
    expect(patch.json().content).toContain('Friday');

    // The stored vector must describe the NEW text, not the old one.
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: { query: 'release train departs on Friday', topK: 10, threshold: 0.1 },
    });
    const hit = res.json().results.find((m: { id: string }) => m.id === id);
    expect(hit, 'edited memory should be findable by its new content').toBeDefined();
  });

  it('rejects an out-of-range importance on PATCH', async () => {
    const id = await storeMemory('Importance bound check');
    const res = await app.inject({
      method: 'PATCH',
      url: `/api/memory/${id}`,
      payload: { importance: 42 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('bounds the bulk-tag id array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/bulk/tag',
      payload: { ids: Array.from({ length: 1001 }, (_, i) => `id-${i}`), tag: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('graph', () => {
  it('returns inbound edges and honours depth', async () => {
    const a = await storeMemory('Graph node A — origin of the link');
    const b = await storeMemory('Graph node B — middle of the chain');
    const c = await storeMemory('Graph node C — far end of the chain');

    for (const [source, target] of [[a, b], [b, c]] as const) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/connections',
        payload: { sourceId: source, targetId: target, relationship: 'relates_to', strength: 1 },
      });
      expect(res.statusCode).toBe(201);
    }

    // depth=1 from A reaches B.
    const d1 = await app.inject({ method: 'GET', url: `/api/graph/${a}?depth=1` });
    expect(d1.statusCode).toBe(200);
    const neighbours1 = d1.json().neighbors.map((n: { id: string }) => n.id);
    expect(neighbours1).toContain(b);

    // depth=2 must reach C — the handler used to ignore `depth` entirely.
    const d2 = await app.inject({ method: 'GET', url: `/api/graph/${a}?depth=2` });
    const neighbours2 = d2.json().neighbors.map((n: { id: string }) => n.id);
    expect(neighbours2).toContain(c);

    // Edges were only matched by sourceId, so B could not see its inbound A.
    const fromB = await app.inject({ method: 'GET', url: `/api/graph/${b}?depth=1` });
    const neighboursB = fromB.json().neighbors.map((n: { id: string }) => n.id);
    expect(neighboursB).toContain(a);

    // sourceId is part of the documented shape and the web client's type.
    expect(d1.json().connections[0]).toHaveProperty('sourceId');
  });

  it('404s for an unknown node', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/graph/no-such-node' });
    expect(res.statusCode).toBe(404);
  });

  it('rejects an unknown relationship', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { sourceId: 'a', targetId: 'b', relationship: 'not-a-relationship' },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('webhooks', () => {
  it('accepts the reflected event in the subscribe enum', async () => {
    // 'reflected' is fired by core but was missing from the REST enum. Use a
    // loopback URL with the guard opted out so this tests the enum, not DNS.
    process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = 'true';
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: { url: 'http://127.0.0.1:9999/hook', events: ['reflected'] },
      });
      expect(res.statusCode).toBe(201);
    } finally {
      delete process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'];
    }
  });

  it('rejects an unknown event name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'https://hooks.example.com/engram', events: ['not-an-event'] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 (not 500) for an SSRF-rejected webhook URL', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/webhooks',
      payload: { url: 'http://169.254.169.254/latest/meta-data/', events: ['stored'] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/private or loopback/i);
  });
});

describe('reflection', () => {
  it('reports scheduling status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reflection/status' });
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body).toHaveProperty('enabled');
    expect(body).toHaveProperty('due');
    expect(body).toHaveProperty('threshold');
  });

  it('lists stored reflections', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reflections?limit=5' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('reflections');
  });

  it('no longer exposes the removed generation endpoint', async () => {
    // POST /api/reflect was removed when reflection became AI-driven.
    const res = await app.inject({ method: 'POST', url: '/api/reflect' });
    expect(res.statusCode).toBe(404);
  });
});

describe('CORS', () => {
  it('does not reflect an arbitrary origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'https://evil.example.com' },
    });
    // Reflective CORS would echo the attacker's origin back here.
    expect(res.headers['access-control-allow-origin']).not.toBe('https://evil.example.com');
  });

  it('allows a configured dashboard origin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/health',
      headers: { origin: 'http://localhost:4902' },
    });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4902');
  });
});
