import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import type { FastifyInstance } from 'fastify';
import { getDb, schema } from '@engram-ai-memory/core';
import { sql } from 'drizzle-orm';
import { tiersFor } from '../security/rateLimit.js';

// Built core is CommonJS; spy on its require() export so the real dist path
// uses deterministic embeddings without replacing core with source modules.
const embedder: typeof import('../../../../packages/core/dist/embedding/Embedder.js') =
  createRequire(import.meta.url)('../../../../packages/core/dist/embedding/Embedder.js');

const directory = mkdtempSync(join(tmpdir(), 'engram-rest-filters-'));
const filters = { since: '2026-01-01T00:00:00Z', until: '2026-01-31T23:59:59Z', tags: ['project', 'release'] };
let app: FastifyInstance;
let brain: typeof import('../index.ts')['brain'];
let matchingId: string;
let projectId: string;
const globalIds: string[] = [];

beforeAll(async () => {
  vi.spyOn(embedder, 'embed').mockImplementation(async () => new Float32Array(384).fill(1));
  vi.stubEnv('ENGRAM_DB_PATH', join(directory, 'test.db'));
  vi.stubEnv('ENGRAM_SYNC_URL', '');
  vi.stubEnv('ENGRAM_DECAY_INTERVAL', '0');
  vi.stubEnv('ENGRAM_NAMESPACE_MODE', 'filter');
  vi.stubEnv('ENGRAM_NAMESPACE', '');
  const mod = await import('../index.ts');
  brain = mod.brain;
  await brain.initialize();
  for (const [content, date, tags] of [
    ['Before', '2025-12-31', filters.tags],
    ['After', '2026-02-01', filters.tags],
    ['One tag', '2026-01-15', ['project']],
    ['Matching', '2026-01-15', filters.tags],
  ] as const) {
    const memory = await brain.episodic.store({ content, eventAt: new Date(`${date}T00:00:00Z`), tags: [...tags] });
    globalIds.push(memory.id);
    if (content === 'Matching') matchingId = memory.id;
  }
  projectId = (await brain.episodic.store({ content: 'Project API', namespace: '/code/api' })).id;
  await brain.episodic.store({ content: 'Project web', namespace: '/code/web' });
  app = await mod.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/search project filters', () => {
  it('returns only the exact namespace requested', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/search', payload: { query: 'query', namespace: '/code/api' } });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ count: 1, results: [{ id: projectId, namespace: '/code/api' }] });
  });

  it('returns only NULL namespaces for global=true', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/search', payload: { query: 'query', global: true } });
    expect(response.statusCode).toBe(200);
    expect(response.json().results.map((memory: { id: string }) => memory.id).sort()).toEqual([...globalIds].sort());
    expect(response.json().results.every((memory: { namespace: string | null }) => memory.namespace === null)).toBe(true);
  });

  it.each(['/code/api', ''])('rejects namespace=%j combined with global=true', async (namespace) => {
    const response = await app.inject({ method: 'POST', url: '/api/search', payload: { query: 'query', namespace, global: true } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: 'Bad Request', message: 'namespace and global cannot be used together.' });
  });

  it.each([{ namespace: null }, { namespace: 1 }, { global: false }, { global: 'true' }, { global: 1 }])(
    'rejects invalid project filters: %j', async (invalid) => {
      const response = await app.inject({ method: 'POST', url: '/api/search', payload: { query: 'query', ...invalid } });
      expect(response.statusCode).toBe(400);
    },
  );
});

describe.each(['/api/search', '/api/recall', '/api/recall/explain'])('POST %s filters', (url) => {
  it('accepts and applies the date window and all tags', async () => {
    const response = await app.inject({ method: 'POST', url, payload: { query: 'query', ...filters } });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect((body.results ?? body.memories ?? body.items).map((memory: { id: string }) => memory.id)).toEqual([matchingId]);
  });

  it.each([{ since: 'yesterday' }, { until: '2026-01-15' }, { tags: 'project' }, { tags: [1] }, { since: [filters.since] }])(
    'rejects invalid filters: %j', async (invalid) => {
      const response = await app.inject({ method: 'POST', url, payload: { query: 'query', ...invalid } });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: 'Bad Request' });
    },
  );
});

it('applies filters before emitting any SSE memories', async () => {
  const query = new URLSearchParams({ query: 'query', since: filters.since, until: filters.until });
  for (const tag of filters.tags) query.append('tags', tag);
  const response = await app.inject({ method: 'GET', url: `/api/recall/stream?${query}` });
  expect(response.statusCode).toBe(200);
  const chunks = response.body.split('\n').filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)));
  expect(chunks.filter((chunk) => chunk.memory).map((chunk) => chunk.memory.id)).toEqual([matchingId]);
  expect(chunks.at(-1)).toMatchObject({ phase: 'complete', memories: [{ id: matchingId }] });
});

it('rejects malformed SSE dates before opening the stream', async () => {
  const response = await app.inject({ method: 'GET', url: '/api/recall/stream?query=query&since=yesterday' });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ error: 'Bad Request' });
});

describe('POST /api/recall/explain', () => {
  const url = '/api/recall/explain';

  it('returns exact recall context and leaves access statistics and audit rows unchanged', async () => {
    const db = getDb();
    const before = db.select().from(schema.memories).all();
    const audits = db.select().from(schema.contextAssemblies).all();
    const changes = db.get(sql`SELECT total_changes() AS n`);
    const hook = vi.spyOn(brain.getPluginRegistry(), 'runHook');
    const response = await app.inject({ method: 'POST', url, payload: { query: 'query', ...filters } });
    expect(response.statusCode).toBe(200);
    const explanation = response.json();
    expect(explanation).toMatchObject({
      budget: { maxTokens: 2000, usedTokens: 2 }, candidates: 1,
      items: [{ id: matchingId, rank: 1, position: 1, section: 'events', via: 'vector', chars: 8, tokens: 2, included: true }],
    });
    expect(explanation.context.slice(explanation.items[0].offset)).toMatch(/^• \[/);
    expect(db.select().from(schema.memories).all()).toEqual(before);
    expect(db.select().from(schema.contextAssemblies).all()).toEqual(audits);
    expect(db.get(sql`SELECT total_changes() AS n`)).toEqual(changes);
    expect(hook).not.toHaveBeenCalled();
    hook.mockRestore();
    const recall = await app.inject({ method: 'POST', url: '/api/recall', payload: { query: 'query', ...filters } });
    expect(explanation.context).toBe(recall.json().context);
  });

  it('supports exact project and global scope, combined with type and source filters', async () => {
    const project = await app.inject({ method: 'POST', url, payload: { query: 'query', namespace: '/code/api', types: ['episodic'] } });
    expect(project.statusCode).toBe(200);
    expect(project.json().items.map((item: { id: string }) => item.id)).toEqual([projectId]);
    const global = await app.inject({ method: 'POST', url, payload: { query: 'query', global: true } });
    expect(global.statusCode).toBe(200);
    expect(global.json().items.map((item: { id: string }) => item.id).sort()).toEqual([...globalIds].sort());
    const empty = await app.inject({ method: 'POST', url, payload: { query: 'query', types: ['semantic'] } });
    expect(empty.json()).toMatchObject({ context: '', items: [], candidates: 0, budget: { maxTokens: 2000, usedTokens: 0 } });
    // Source-null records retain recall's existing pass-through semantics.
    const source = await app.inject({ method: 'POST', url, payload: { query: 'query', sources: ['missing'], ...filters } });
    expect(source.json().items.map((item: { id: string }) => item.id)).toEqual([matchingId]);
  });

  it('reports budget omissions and rejects isolated cross-namespace requests', async () => {
    const response = await app.inject({ method: 'POST', url, payload: { query: 'query', maxTokens: 1 } });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.some((item: { reason?: string }) => item.reason === 'over_budget')).toBe(true);
    const mode = vi.spyOn(brain, 'getNamespaceMode').mockReturnValue('isolated');
    try {
      const rejected = await app.inject({ method: 'POST', url, payload: { query: 'query', crossNamespace: true } });
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().error).toMatch(/cross-namespace/);
    } finally {
      mode.mockRestore();
    }
  });

  it.each([
    {}, { query: '' }, { query: 12 }, { query: null }, { query: ['query'] },
    { maxTokens: 0 }, { maxTokens: 32001 }, { maxTokens: 1.5 }, { maxTokens: '20' },
    { unknown: true }, { types: 'semantic' }, { types: ['unknown'] }, { types: [1] },
    { sources: 'source' }, { sources: [1] }, { namespace: null }, { namespace: 1 },
    { global: false }, { global: 'true' }, { namespace: '/code/api', global: true },
    { namespace: '', global: true }, { crossNamespace: 'true' },
  ])('rejects malformed bodies %j', async (invalid) => {
    const payload = Object.keys(invalid).length === 0 ? {} : { query: 'query', ...invalid };
    const response = await app.inject({ method: 'POST', url, payload });
    expect(response.statusCode).toBe(400);
  });

  it('shares recall’s heavy rate-limit tier and budget', async () => {
    expect(tiersFor('POST', url)).toEqual(tiersFor('POST', '/api/recall'));
    vi.stubEnv('ENGRAM_RATE_LIMIT_HEAVY_MAX', '1');
    const limitedApp = await (await import('../index.ts')).buildApp();
    try {
      const first = await limitedApp.inject({ method: 'POST', url, payload: { query: 'query' } });
      expect(first.statusCode).toBe(200);
      const second = await limitedApp.inject({ method: 'POST', url: '/api/recall', payload: { query: 'query' } });
      expect(second.statusCode).toBe(429);
      expect(second.json().message).toContain("'heavy'");
    } finally {
      await limitedApp.close();
      vi.stubEnv('ENGRAM_RATE_LIMIT_HEAVY_MAX', undefined);
    }
  });
});
