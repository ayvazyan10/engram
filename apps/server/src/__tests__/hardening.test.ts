/**
 * Input validation, status codes and response hygiene for the HTTP surface.
 *
 * Every case here was reproduced against a live server before the fix:
 *
 *   POST /api/memory/bulk/archive (no body)  -> 500 "Cannot destructure ..."
 *   POST /api/memory/bulk/archive {"ids":"abc"} -> 200 archived:3 (per character)
 *   GET  /api/memory?limit=-1                -> 200, whole table (SQLite LIMIT -1)
 *   GET  /api/memory?limit=-1&offset=-1      -> 500 SQLITE_ERROR
 *   POST /api/search {"topK":-1}             -> 200, every match above threshold
 *   GET  /api/reflections?limit=abc          -> 200, all rows (raw parseInt -> NaN)
 *   POST /api/recall {"maxTokens":-5}        -> 200, truncation disabled
 *   PUT  /api/reflection/config '"a string"' -> 200, config gained "0":"a" keys
 *   POST /api/memory/<unknown>/tags          -> 500 instead of 404
 *   DELETE /api/memory/<unknown>             -> 204 plus a phantom 'forgotten'
 *   POST /api/connections (duplicate)        -> 500 leaking the UNIQUE constraint
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';

const dbPath = path.join(os.tmpdir(), `engram-server-hardening-${Date.now()}.db`);

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
    payload: { content, type: 'semantic', source: 'hardening-test', importance: 0.6, ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().memory.id as string;
}

// ─── A1: bulk archive body schema ────────────────────────────────────────────

describe('POST /api/memory/bulk/archive', () => {
  it('rejects a missing body instead of 500ing on the destructure', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/memory/bulk/archive' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a string `ids` instead of iterating its characters', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/bulk/archive',
      payload: { ids: 'abc' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a numeric `ids`', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/bulk/archive',
      payload: { ids: 12 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('bounds the id array like every other bulk endpoint', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/bulk/archive',
      payload: { ids: Array.from({ length: 1001 }, (_, i) => `id-${i}`) },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects unknown keys', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/bulk/archive',
      payload: { ids: ['a'], somethingElse: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it('counts nothing for ids that do not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/bulk/archive',
      payload: { ids: ['nope-1', 'nope-2'] },
    });
    expect(res.statusCode).toBe(200);
    // Previously 200 {"archived":2} — brain.forget() only checks existence in
    // isolated mode, so two phantom 'forgotten' webhooks fired as well.
    expect(res.json()).toEqual({ archived: 0, total: 2 });
  });

  it('archives the ids that do exist', async () => {
    const id = await store('Bulk archive target');
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/bulk/archive',
      payload: { ids: [id, 'nope-3'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ archived: 1, total: 2 });

    const list = await app.inject({ method: 'GET', url: '/api/memory?limit=200' });
    expect(list.json().memories.some((m: { id: string }) => m.id === id)).toBe(false);
  });
});

// ─── A2: lower bounds on pagination and size caps ────────────────────────────

describe('pagination and size caps have a floor, not just a ceiling', () => {
  it('rejects a negative list limit (SQLite reads LIMIT -1 as unlimited)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memory?limit=-1' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a negative offset instead of 500ing on the SQL', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/memory?limit=-1&offset=-1' });
    expect(res.statusCode).toBe(400);
  });

  it('rejects a negative limit/offset on the tag listing', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/tags/x?limit=-1' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/tags/x?offset=-1' })).statusCode).toBe(400);
  });

  it('rejects a negative topK on search', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/search',
      payload: { query: 'anything', topK: -1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('bounds maxTokens on POST /api/recall the way the SSE twin already did', async () => {
    const low = await app.inject({
      method: 'POST',
      url: '/api/recall',
      payload: { query: 'anything', maxTokens: -5 },
    });
    expect(low.statusCode).toBe(400);

    const high = await app.inject({
      method: 'POST',
      url: '/api/recall',
      payload: { query: 'anything', maxTokens: 999999 },
    });
    expect(high.statusCode).toBe(400);
  });

  it('validates the reflections limit instead of parseInt-ing it raw', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/reflections?limit=abc' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/reflections?limit=-1' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/reflections?limit=100000' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/reflections?type=nope' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'GET', url: '/api/reflections?limit=5' })).statusCode).toBe(200);
  });

  it('rejects a graph depth below 1', async () => {
    const id = await store('Graph depth floor');
    expect((await app.inject({ method: 'GET', url: `/api/graph/${id}?depth=0` })).statusCode).toBe(400);
  });
});

// ─── A3: webhook secrets are write-only over REST ────────────────────────────

describe('webhook secrets never appear in a response', () => {
  const SECRET = 'SUPERSECRET-HMAC-KEY';
  let hookId: string;

  it('does not echo the secret on create', async () => {
    process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'] = 'true';
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/webhooks',
        payload: { url: 'http://127.0.0.1:9998/hook', events: ['stored'], secret: SECRET },
      });
      expect(res.statusCode).toBe(201);
      expect(res.body).not.toContain(SECRET);
      expect(res.json().hasSecret).toBe(true);
      hookId = res.json().id as string;
    } finally {
      delete process.env['ENGRAM_WEBHOOK_ALLOW_PRIVATE'];
    }
  });

  it('does not return the secret from the list endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/webhooks' });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(SECRET);
  });

  it('does not return the secret from the single-webhook endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/webhooks/${hookId}` });
    expect(res.statusCode).toBe(200);
    expect(res.body).not.toContain(SECRET);
    expect(res.json().hasSecret).toBe(true);
  });
});

// ─── A5: internal detail stays server-side ───────────────────────────────────

describe('responses do not carry internal detail', () => {
  it('does not return the index file path', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/index/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('indexPath');
    // The absolute path used to be handed out verbatim: "/home/<user>/.engram/..."
    expect(res.body).not.toMatch(/\/home\/|\/Users\/|C:\\\\/);
  });

  it('does not put a filesystem path in the index/save message', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/index/save' });
    expect([200, 400]).toContain(res.statusCode);
    expect(res.body).not.toMatch(/\/home\/|\/Users\/|C:\\\\/);
  });

  it('does not leak the SQL constraint text when a connection already exists', async () => {
    const a = await store('Duplicate connection source');
    const b = await store('Duplicate connection target');
    const payload = { sourceId: a, targetId: b, relationship: 'relates_to', strength: 1 };

    const first = await app.inject({ method: 'POST', url: '/api/connections', payload });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: 'POST', url: '/api/connections', payload });
    // A9: a duplicate is a conflict, not a server fault.
    expect(second.statusCode).toBe(409);
    expect(second.body).not.toMatch(/UNIQUE constraint/i);
  });
});

// ─── A7: config endpoints reject arbitrary bodies ────────────────────────────

describe('PUT /api/reflection/config', () => {
  it('rejects a bare JSON string instead of spreading its characters', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/reflection/config',
      headers: { 'content-type': 'application/json' },
      payload: '"just a string"',
    });
    expect(res.statusCode).toBe(400);

    const after = await app.inject({ method: 'GET', url: '/api/reflection/config' });
    expect(after.json()).not.toHaveProperty('0');
  });

  it('rejects wrong types and unknown keys', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/reflection/config',
      payload: { enabled: 'yes', storeCountThreshold: -1, whatever: 'x' },
    });
    expect(res.statusCode).toBe(400);

    const after = await app.inject({ method: 'GET', url: '/api/reflection/config' });
    expect(after.json()).not.toHaveProperty('whatever');
    expect(after.json().enabled).toBe(true);
  });

  it('rejects a non-array `types` that would throw inside the engine', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/reflection/config',
      payload: { types: 5 },
    });
    expect(res.statusCode).toBe(400);
  });

  it('still applies a valid update', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/reflection/config',
      payload: { storeCountThreshold: 25 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().storeCountThreshold).toBe(25);
  });

  it('leaves the scheduler in a usable state after a rejected update', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/reflection/status' });
    expect(res.statusCode).toBe(200);
    expect(typeof res.json().due).toBe('boolean');
  });
});

describe('PUT /api/contradictions/config', () => {
  it('rejects unknown keys', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/contradictions/config',
      payload: { enabled: true, whatever: 'x' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('still applies a valid update', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/contradictions/config',
      payload: { maxCandidates: 7 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().maxCandidates).toBe(7);
  });
});

// ─── A9: status codes and phantom events ─────────────────────────────────────

describe('status codes match what actually happened', () => {
  it('404s when tagging a memory that does not exist', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/no-such-memory/tags',
      payload: { tag: 'x' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('404s when untagging a memory that does not exist', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/memory/no-such-memory/tags/x' });
    expect(res.statusCode).toBe(404);
  });

  it('404s on DELETE of an unknown memory rather than firing a phantom forgotten event', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/memory/no-such-memory' });
    expect(res.statusCode).toBe(404);
  });

  it('still 204s on DELETE of a real memory', async () => {
    const id = await store('Delete me for real');
    const res = await app.inject({ method: 'DELETE', url: `/api/memory/${id}` });
    expect(res.statusCode).toBe(204);
  });

  it('404s on a second DELETE of the same memory', async () => {
    const id = await store('Delete me twice');
    expect((await app.inject({ method: 'DELETE', url: `/api/memory/${id}` })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url: `/api/memory/${id}` })).statusCode).toBe(404);
  });

  it('rejects empty content instead of embedding the empty string', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/memory', payload: { content: '' } });
    expect(res.statusCode).toBe(400);
  });

  it('rejects empty content in a batch too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/memory/batch',
      payload: { memories: [{ content: '' }] },
    });
    expect(res.statusCode).toBe(400);
  });

  it('404s when testing a webhook that does not exist', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/webhooks/no-such-hook/test' });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/contradictions/check/:id', () => {
  it('runs the handler for a real memory', async () => {
    const id = await store('The API listens on port 4901');
    const res = await app.inject({ method: 'POST', url: `/api/contradictions/check/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveProperty('hasContradictions');
  });

  it('404s for an unknown memory', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/contradictions/check/no-such-memory' });
    expect(res.statusCode).toBe(404);
  });
});

// ─── A4: whole-store operations refuse to interleave ─────────────────────────

describe('whole-store operations are single-flight', () => {
  it('rejects a second index rebuild while one is running', async () => {
    // rebuildIndex() clears the vector index before repopulating it, so two
    // overlapping calls interleave a clear() with the other's upserts.
    const [first, second] = await Promise.all([
      app.inject({ method: 'POST', url: '/api/index/rebuild' }),
      app.inject({ method: 'POST', url: '/api/index/rebuild' }),
    ]);

    const codes = [first.statusCode, second.statusCode].sort();
    expect(codes).toEqual([200, 409]);
  });

  it('allows the next rebuild once the first has finished', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/index/rebuild' });
    expect(res.statusCode).toBe(200);
  });
});
