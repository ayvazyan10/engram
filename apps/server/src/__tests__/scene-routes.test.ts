/**
 * GET /api/graph/layout and GET /api/graph/edges — the two endpoints the 3D
 * dashboard is rebuilt on.
 *
 * What these pin down: the layout is cached and invalidated by the memory set
 * rather than by the clock; it says `fallback` out loud when it cannot project;
 * every coordinate lands inside the declared box; the static `/graph/layout`
 * path is not swallowed by `/graph/:id`; and the edge endpoint reports what it
 * is NOT returning, which is the whole reason it exists — the client used to
 * drop 99.6% of the graph in silence.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import os from 'os';
import type { FastifyInstance } from 'fastify';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';
import { WORLD_HALF_EXTENT } from '../routes/scene.js';

const dbPath = path.join(os.tmpdir(), `engram-scene-test-${Date.now()}.db`);

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
    payload: { content, type: 'semantic', source: 'scene-test', importance: 0.6, ...extra },
  });
  expect(res.statusCode).toBe(201);
  return res.json().memory.id as string;
}

async function layout() {
  const res = await app.inject({ method: 'GET', url: '/api/graph/layout' });
  expect(res.statusCode).toBe(200);
  return res.json();
}

async function edges(query = '') {
  const res = await app.inject({ method: 'GET', url: `/api/graph/edges${query}` });
  expect(res.statusCode).toBe(200);
  return res.json();
}

// The order of these blocks matters: the fallback case only exists while the
// store is smaller than a 3-component fit needs.
describe('GET /api/graph/layout — a store too small to project', () => {
  it('says so instead of pretending, and still places every node', async () => {
    const empty = await layout();
    expect(empty.method).toBe('fallback');
    expect(empty.count).toBe(0);
    expect(empty.nodes).toEqual([]);

    await store('a single lonely memory');
    const one = await layout();
    expect(one.method).toBe('fallback');
    expect(one.count).toBe(1);
    expect(one.projected).toBe(0);
    expect(one.unprojected).toBe(1);
    expect(one.nodes[0].projected).toBe(false);
    // A placeholder is still a real, finite, in-frame position.
    for (const axis of ['x', 'y', 'z'] as const) {
      expect(Number.isFinite(one.nodes[0][axis])).toBe(true);
      expect(Math.abs(one.nodes[0][axis])).toBeLessThanOrEqual(WORLD_HALF_EXTENT * 1.2);
    }
  });
});

describe('GET /api/graph/layout — a store it can project', () => {
  const ids: string[] = [];

  beforeAll(async () => {
    for (const text of [
      'PostgreSQL connection pooling and prepared statements',
      'Postgres vacuum, autovacuum and bloat in large tables',
      'React hooks: useMemo, useCallback and render churn',
      'React server components and streaming SSR boundaries',
      'Sourdough starter hydration and bulk fermentation time',
      'Baking bread at high altitude needs less yeast',
    ]) {
      ids.push(await store(text));
    }
  });

  it('projects every memory into the declared world box', async () => {
    const body = await layout();
    expect(body.method).toBe('pca3');
    expect(body.halfExtent).toBe(WORLD_HALF_EXTENT);
    expect(body.count).toBe(body.nodes.length);
    expect(body.projected).toBe(body.count);
    expect(body.unprojected).toBe(0);
    expect(body.explainedVariance).toHaveLength(3);
    expect(body.embeddingModel).toBeTruthy();

    for (const node of body.nodes) {
      expect(node.projected).toBe(true);
      for (const axis of ['x', 'y', 'z'] as const) {
        expect(Number.isFinite(node[axis])).toBe(true);
        expect(Math.abs(node[axis])).toBeLessThanOrEqual(WORLD_HALF_EXTENT + 1e-9);
      }
    }
  });

  it('carries the fields the renderer needs but the old layout threw away', async () => {
    const body = await layout();
    const node = body.nodes.find((n: { id: string }) => n.id === ids[0]);
    expect(node).toBeDefined();
    expect(node.type).toBe('semantic');
    expect(typeof node.label).toBe('string');
    expect(node.label.length).toBeGreaterThan(0);
    expect(typeof node.importance).toBe('number');
    expect(typeof node.accessCount).toBe('number');
    expect(typeof node.createdAt).toBe('string');
    expect('lastAccessedAt' in node).toBe(true);
    expect(node.source).toBe('scene-test');
  });

  it('is deterministic and cached — the same store gives byte-identical coordinates', async () => {
    const first = await layout();
    const second = await layout();
    expect(second.fingerprint).toBe(first.fingerprint);
    // Same generatedAt proves the second call was served from cache rather
    // than re-running a PCA over the whole store.
    expect(second.generatedAt).toBe(first.generatedAt);
    expect(second.nodes).toEqual(first.nodes);
  });

  it('invalidates the cache when the memory set changes, and only then', async () => {
    const before = await layout();
    await store('an entirely unrelated new memory about tide tables');
    const after = await layout();

    expect(after.fingerprint).not.toBe(before.fingerprint);
    expect(after.count).toBe(before.count + 1);
    expect(after.generatedAt).not.toBe(before.generatedAt);
  });

  it('drops an archived memory from the scene', async () => {
    const doomed = await store('this memory is about to be archived');
    expect((await layout()).nodes.some((n: { id: string }) => n.id === doomed)).toBe(true);

    const del = await app.inject({ method: 'DELETE', url: `/api/memory/${doomed}` });
    expect(del.statusCode).toBe(204);
    expect((await layout()).nodes.some((n: { id: string }) => n.id === doomed)).toBe(false);
  });

  it('serves the layout, not the /graph/:id handler', async () => {
    const body = await layout();
    // A parametric match would have answered 404 {"error":"Memory not found"}.
    expect(body.error).toBeUndefined();
    expect(body.method).toBe('pca3');
  });
});

describe('GET /api/graph/edges', () => {
  let strong = '';
  let weak = '';

  beforeAll(async () => {
    const [a, b, c] = [
      await store('edge endpoint alpha'),
      await store('edge endpoint beta'),
      await store('edge endpoint gamma'),
    ];
    const link = async (sourceId: string, targetId: string, strength: number) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/connections',
        payload: { sourceId, targetId, relationship: 'relates_to', strength },
      });
      expect(res.statusCode).toBe(201);
      return res.json().id as string;
    };
    strong = await link(a, b, 0.95);
    weak = await link(b, c, 0.2);
  });

  it('returns edges strongest first, with totals that account for what is missing', async () => {
    const body = await edges();
    expect(body.returned).toBe(body.edges.length);
    expect(body.total).toBeGreaterThanOrEqual(2);
    // Rows in the table, including any onto memories the scene cannot show.
    expect(body.stored).toBeGreaterThanOrEqual(body.total);
    expect(body.truncated).toBe(false);

    const ids = body.edges.map((e: { id: string }) => e.id);
    expect(ids).toContain(strong);
    expect(ids).toContain(weak);

    const strengths = body.edges.map((e: { strength: number }) => e.strength);
    expect([...strengths].sort((x: number, y: number) => y - x)).toEqual(strengths);
    for (const edge of body.edges) {
      expect(edge.sourceId).not.toBe(edge.targetId);
      expect(typeof edge.relationship).toBe('string');
    }
  });

  it('filters by minStrength and reports the filter it applied', async () => {
    const body = await edges('?minStrength=0.9');
    expect(body.minStrength).toBe(0.9);
    const ids = body.edges.map((e: { id: string }) => e.id);
    expect(ids).toContain(strong);
    expect(ids).not.toContain(weak);
    // The unfiltered total is still reported, so the UI can say "N of M".
    expect(body.total).toBeGreaterThan(body.matching);
  });

  it('flags a truncated response rather than silently returning a slice', async () => {
    const body = await edges('?limit=1');
    expect(body.returned).toBe(1);
    expect(body.truncated).toBe(true);
    expect(body.total).toBeGreaterThan(1);
    // The one edge kept is the strongest, not an arbitrary row.
    expect(body.edges[0].id).toBe(strong);
  });

  it('excludes an edge whose endpoint was archived, without losing it from `stored`', async () => {
    const orphan = await store('about to lose an endpoint');
    // Taken AFTER the store: a new memory can pick up auto-links of its own,
    // and this test is about the edge it creates explicitly below.
    const before = await edges();
    const other = before.edges[0].sourceId as string;
    const created = await app.inject({
      method: 'POST',
      url: '/api/connections',
      payload: { sourceId: other, targetId: orphan, relationship: 'relates_to', strength: 0.5 },
    });
    expect(created.statusCode).toBe(201);
    const createdId = created.json().id as string;

    const linked = await edges();
    expect(linked.total).toBe(before.total + 1);
    expect(linked.edges.some((e: { id: string }) => e.id === createdId)).toBe(true);

    // Archived directly, not through DELETE /api/memory: `forget()` tombstones
    // the memory's connection rows too, whereas the decay sweep archives rows
    // and leaves their edges behind — which is why the live store has 5,393
    // connection rows pointing at memories that no longer have a node.
    const { getDb, schema } = await import('@engram-ai-memory/core');
    const { eq } = await import('drizzle-orm');
    const now = new Date().toISOString();
    await getDb()
      .update(schema.memories)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(schema.memories.id, orphan));

    const after = await edges();
    // The edge is no longer renderable — there is no node to draw it to — but
    // it is still a row in the table, and `stored` still counts it.
    expect(after.edges.some((e: { id: string }) => e.id === createdId)).toBe(false);
    expect(after.total).toBeLessThan(linked.total);
    expect(after.stored).toBe(linked.stored);
    expect(after.stored).toBeGreaterThan(after.total);
  });

  it('refuses out-of-range query parameters', async () => {
    for (const query of ['?minStrength=2', '?minStrength=-1', '?limit=0', '?limit=99999', '?limit=abc']) {
      const res = await app.inject({ method: 'GET', url: `/api/graph/edges${query}` });
      expect(res.statusCode, query).toBe(400);
    }
  });
});
