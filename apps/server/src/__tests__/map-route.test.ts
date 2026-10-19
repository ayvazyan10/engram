import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { DecayEngine, getDb, packFP16, schema } from '@engram-ai-memory/core';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { MapPayload } from '../routes/map.js';
import { cleanupTestDb } from '../test-helpers/cleanupTestDb.js';
import { isRunning, runExclusive } from '../lib/exclusive.js';
import { tiersFor } from '../security/rateLimit.js';

const dbPath = path.join(os.tmpdir(), `engram-map-${process.pid}-${Date.now()}.db`);
let app: FastifyInstance;
let brain: typeof import('../index.js')['brain'];
let buildApp: typeof import('../index.js')['buildApp'];

beforeAll(async () => {
  process.env['ENGRAM_DB_PATH'] = dbPath;
  process.env['ENGRAM_DECAY_INTERVAL'] = '0';
  process.env['ENGRAM_API_KEY'] = 'map-test-key';
  process.env['ENGRAM_NAMESPACE_MODE'] = 'none';
  delete process.env['ENGRAM_NAMESPACE'];
  ({ brain, buildApp } = await import('../index.js'));
  await brain.initialize();
});
beforeEach(async () => {
  await app?.close();
  vi.restoreAllMocks();
  getDb().delete(schema.memoryConnections).run();
  getDb().delete(schema.memories).run();
  app = await buildApp();
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await brain?.shutdown();
  cleanupTestDb(dbPath);
  delete process.env['ENGRAM_API_KEY'];
});

const headers = { 'x-api-key': 'map-test-key' };
function request(url = '/api/map') { return app.inject({ method: 'GET', url, headers }); }
async function ready(query = ''): Promise<MapPayload> {
  for (let i = 0; i < 1000; i++) {
    const response = await request(`/api/map${query}`);
    if (response.statusCode !== 503) {
      expect(response.statusCode, response.body).toBe(200);
      return response.json();
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('map never became ready');
}
function seed(count: number, offset = 0, namespace: string | null = null, dimensions = 12, neighbours = 1) {
  const now = new Date().toISOString();
  getDb().transaction((tx) => {
    for (let i = offset; i < offset + count; i++) {
      const vector = Float32Array.from({ length: dimensions }, (_, d) => Math.sin(i * 1.731 + d * 0.77) + Math.cos(i * d * 0.13));
      tx.insert(schema.memories).values({
        id: `m${String(i).padStart(5, '0')}`, type: 'semantic', content: `Memory ${i}`,
        concept: `topic ${i % 5}`, tags: JSON.stringify(i === 0 ? ['pinned', 'database'] : ['database']),
        source: i === 1 ? 'reflection' : 'test', namespace,
        importance: 0.7, createdAt: now, updatedAt: now,
        embedding: packFP16(vector), embeddingDim: dimensions, embeddingModel: brain.getEmbeddingModel(),
      }).run();
      for (let step = 1; step <= neighbours && i - step >= offset; step++) tx.insert(schema.memoryConnections).values({
        id: step === 1 ? `e${i}` : `e${i}-${step}`, sourceId: `m${String(i - step).padStart(5, '0')}`, targetId: `m${String(i).padStart(5, '0')}`,
        relationship: 'relates_to', strength: 0.8, createdAt: now, updatedAt: now,
      }).run();
    }
  });
}

describe('Atlas map routes', () => {
  it('returns 503 during first compute, then the empty fallback shape', async () => {
    const first = await request();
    expect(first.statusCode).toBe(503);
    expect(first.json()).toEqual({ error: 'map not ready', retryAfterMs: 250 });
    const empty = await ready();
    expect(empty).toMatchObject({ method: 'fallback', nodes: [], regions: [], explainedVariance: [0, 0] });
    expect(typeof empty.fingerprint).toBe('string');
    expect(typeof empty.computeMs).toBe('number');
  });

  it('returns the contract, core retention/protection, links and automatic names', async () => {
    seed(30);
    getDb().insert(schema.memoryConnections).values({
      id: 'contradiction', sourceId: 'm00000', targetId: 'm00001', relationship: 'contradicts', strength: 0.9,
    }).run();
    const body = await ready();
    expect(body.method).toBe('pca2+knn');
    expect(body.nodes).toHaveLength(30);
    expect(body.explainedVariance).toHaveLength(2);
    const node = body.nodes[0]!;
    expect(Object.keys(node).sort()).toEqual([
      'id', 'x', 'y', 'type', 'importance', 'retention', 'protected', 'createdAt', 'lastAccessedAt',
      'namespace', 'source', 'isReflection', 'regionId', 'degree', 'contradictCount', 'label',
    ].sort());
    const memory = getDb().select().from(schema.memories).where(eq(schema.memories.id, node.id)).get()!;
    expect(node.retention).toBeCloseTo(new DecayEngine(brain.getDecayPolicy()).computeRetention(memory), 5);
    expect(node.protected).toBe(true);
    expect(node.contradictCount).toBe(1);
    expect(node.degree).toBe(2);
    expect(body.nodes[1]!.isReflection).toBe(true);
    for (const region of body.regions) {
      expect(region.name).toBe(region.autoName);
      expect(region.topTags).toContain('database');
      expect(body.nodes.some((n) => n.id === region.id && n.regionId === region.id)).toBe(true);
      expect(region.count).toBe(body.nodes.filter((n) => n.regionId === region.id).length);
    }
    for (const n of body.nodes) {
      expect(Math.abs(n.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(n.y)).toBeLessThanOrEqual(1);
    }
  });

  it('caches unchanged coordinates; inserts at the centroid until cumulative 10% count change', async () => {
    seed(30);
    const first = await ready();
    const cached = await ready();
    expect(cached.generatedAt).toBe(first.generatedAt);
    expect(cached.nodes.map(({ id, x, y }) => ({ id, x, y }))).toEqual(first.nodes.map(({ id, x, y }) => ({ id, x, y })));
    seed(1, 30);
    getDb().insert(schema.memoryConnections).values({ id: 'insert-link', sourceId: 'm00030', targetId: 'm00000', relationship: 'relates_to', strength: 0.8 }).run();
    const next = await ready();
    for (let i = 0; i < 30; i++) {
      expect(next.nodes[i]!.x).toBe(first.nodes[i]!.x);
      expect(next.nodes[i]!.y).toBe(first.nodes[i]!.y);
    }
    expect(next.nodes[30]!.x).toBe(first.nodes[0]!.x);
    expect(next.fingerprint).not.toBe(first.fingerprint);
    seed(2, 31);
    const recomputed = await ready();
    expect(recomputed.nodes).toHaveLength(33);
    expect(recomputed.nodes.slice(0, 30).some((n, i) => Math.abs(n.x - next.nodes[i]!.x) > 1e-8)).toBe(true);
  });

  it('intersects namespace/global filters with brain visibility and excludes hidden edges', async () => {
    seed(10, 0, 'alpha'); seed(10, 10, 'beta'); seed(10, 20);
    expect((await ready('?namespace=alpha')).nodes.map((n) => n.namespace)).toEqual(Array(10).fill('alpha'));
    expect((await ready('?global=true')).nodes.every((n) => n.namespace === null)).toBe(true);
    expect((await ready('?namespace=alpha&global=true')).nodes).toEqual([]);
    vi.spyOn(brain, 'getNamespace').mockReturnValue('alpha');
    vi.spyOn(brain, 'getNamespaceMode').mockReturnValue('isolated');
    vi.spyOn(brain, 'canAccessNamespace').mockImplementation((ns) => ns === 'alpha');
    const scoped = await ready();
    expect(scoped.nodes).toHaveLength(10);
    expect((await ready('?namespace=beta')).nodes).toEqual([]);
    expect((await ready('?global=true')).nodes).toEqual([]);
    expect(scoped.regions.reduce((sum, r) => sum + r.count, 0)).toBe(10);
  });

  it('rebuilds explicitly, rejects overlapping work, and excludes archived/tombstoned rows', async () => {
    seed(30);
    const first = await ready();
    getDb().update(schema.memories).set({ archivedAt: new Date().toISOString() }).where(eq(schema.memories.id, 'm00001')).run();
    getDb().update(schema.memoryConnections).set({ deletedAt: new Date().toISOString() }).where(eq(schema.memoryConnections.id, 'e3')).run();
    const response = await app.inject({ method: 'POST', url: '/api/map/rebuild', headers });
    expect(response.statusCode, response.body).toBe(204);
    const next = await ready();
    expect(next.nodes).toHaveLength(29);
    expect(next.nodes.some((n) => n.id === 'm00001')).toBe(false);
    expect(next.nodes.find((n) => n.id === 'm00002')!.degree).toBe(0);
    expect(next.generatedAt).not.toBe(first.generatedAt);
    await runExclusive('map', async () => {
      const conflict = await app.inject({ method: 'POST', url: '/api/map/rebuild', headers });
      expect(conflict.statusCode).toBe(409);
    });
    expect(isRunning('map')).toBe(false);
  });

  it('refreshes protection and retention when decay policy changes without moving nodes', async () => {
    seed(10);
    getDb().update(schema.memories).set({ createdAt: '2025-01-01T00:00:00Z' }).run();
    const first = await ready();
    const policy = brain.getDecayPolicy();
    vi.spyOn(brain, 'getDecayPolicy').mockReturnValue({ ...policy, halfLifeDays: 3650, protectionRules: [] });
    const next = await ready();
    expect(next.nodes[0]!.protected).toBe(false);
    expect(next.nodes[0]!.retention).toBeGreaterThan(first.nodes[0]!.retention);
    expect(next.nodes[0]!.x).toBe(first.nodes[0]!.x);
    expect(next.generatedAt).toBe(first.generatedAt);
  });

  it('uses auth, strict validation and the whole-store rebuild rate tier', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/map' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/map/rebuild' })).statusCode).toBe(401);
    for (const query of ['?typo=x', '?global=false', '?namespace=a&namespace=b']) {
      expect((await request(`/api/map${query}`)).statusCode).toBe(400);
    }
    for (const payload of [{ surprise: true }, [], 'bad']) {
      expect((await app.inject({ method: 'POST', url: '/api/map/rebuild', headers: { ...headers, 'content-type': 'application/json' }, payload: JSON.stringify(payload) })).statusCode).toBe(400);
    }
    expect(tiersFor('POST', '/api/map/rebuild')).toContain('whole-store');
    expect(tiersFor('GET', '/api/map')).toEqual(['global']);
  });

  it('computes 5,000 synthetic 384-dimensional memories within the CPU budget', async () => {
    seed(5000, 0, null, 384, 3);
    const cpu = process.cpuUsage();
    const started = performance.now();
    const response = await app.inject({ method: 'POST', url: '/api/map/rebuild', headers });
    expect(response.statusCode, response.body).toBe(204);
    const body = await ready();
    const elapsed = performance.now() - started;
    const used = process.cpuUsage(cpu);
    const cpuMs = (used.user + used.system) / 1000;
    console.info(`Atlas 5000×384: ${cpuMs.toFixed(1)} ms CPU, ${elapsed.toFixed(1)} ms wall, ${body.computeMs.toFixed(1)} ms layout`);
    expect(body.nodes).toHaveLength(5000);
    expect(body.method).toBe('pca2+knn');
    // The budget is ~2 s CPU (1.5 s measured on an idle desktop), logged above.
    // The assertion only guards against a regression in kind: shared CI
    // runners and v8 coverage (test:coverage, about 4x) make 2 s flaky.
    const coverage = process.env.npm_lifecycle_event === 'test:coverage';
    expect(cpuMs).toBeLessThan(coverage ? 20_000 : 6_000);
  });
});
