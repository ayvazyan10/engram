import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { StoreResult } from '../../../../packages/core/src/NeuralBrain.ts';
import { getDb, schema } from '../../../../packages/core/src/db/index.ts';

vi.mock('@engram-ai-memory/core', () => import('../../../../packages/core/src/index.ts'));
vi.mock('../../../../packages/core/src/embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../packages/core/src/embedding/Embedder.ts')>(),
  embed: async () => new Float32Array(384).fill(1),
  embedBatch: async (texts: string[]) => texts.map(() => new Float32Array(384).fill(1)),
}));

const directory = mkdtempSync(join(tmpdir(), 'engram-rest-dedup-'));
let app: FastifyInstance;
let brain: typeof import('../index.ts')['brain'];

beforeAll(async () => {
  vi.stubEnv('ENGRAM_DB_PATH', join(directory, 'test.db'));
  vi.stubEnv('ENGRAM_SYNC_URL', '');
  vi.stubEnv('ENGRAM_DECAY_INTERVAL', '0');
  vi.stubEnv('ENGRAM_DEDUP_THRESHOLD', '0.97');
  vi.stubEnv('ENGRAM_NAMESPACE_MODE', 'none');
  const mod = await import('../index.ts');
  brain = mod.brain;
  await brain.initialize();
  app = await mod.buildApp();
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('exposes deduplicated and the existing memory in POST /api/memory', async () => {
  const request = {
    method: 'POST' as const, url: '/api/memory',
    payload: { content: 'The service uses TypeScript', type: 'semantic' },
  };
  const first = await app.inject(request);
  const second = await app.inject(request);
  expect(first.statusCode).toBe(201);
  expect(first.json().deduplicated).toBe(false);
  expect(second.statusCode).toBe(201);
  expect(second.json()).toMatchObject({
    memory: { id: first.json().memory.id }, deduplicated: true,
  });
});

it('POST /api/memory/batch delegates once and preserves fields and positional ids', async () => {
  const storeBatch = vi.spyOn(brain, 'storeBatch');
  const memories = [
    { content: 'Batch service listens on port 4901', type: 'episodic', source: 'import', importance: 0.9,
      tags: ['batch'], concept: 'Batch service' },
    { content: 'Batch service listens on port 4902', type: 'episodic' },
  ];
  try {
    const response = await app.inject({ method: 'POST', url: '/api/memory/batch', payload: { memories } });
    expect(response.statusCode).toBe(201);
    expect(storeBatch).toHaveBeenCalledExactlyOnceWith(memories);
    const results: StoreResult[] = await storeBatch.mock.results[0]!.value;
    expect(response.json()).toEqual({
      count: 2, latencyMs: expect.any(Number), ids: results.map((result) => result.memory.id),
      contradictions: results.filter((result) => result.contradictions.hasContradictions).length,
    });
    expect(results[0]!.memory).toMatchObject({ source: 'import', importance: 0.9, tags: '["batch"]', concept: 'Batch service' });
  } finally {
    storeBatch.mockRestore();
  }
});

it('POST /api/memory/batch accepts empty batches and retains validation and the 1000 item limit', async () => {
  const empty = await app.inject({ method: 'POST', url: '/api/memory/batch', payload: { memories: [] } });
  expect(empty.statusCode).toBe(201);
  expect(empty.json()).toMatchObject({ count: 0, ids: [], contradictions: 0 });
  for (const memories of [
    [{ content: '' }], [{ content: 'Invalid importance', importance: 2 }],
    Array.from({ length: 1001 }, () => ({ content: 'Too many' })),
  ]) {
    const response = await app.inject({ method: 'POST', url: '/api/memory/batch', payload: { memories } });
    expect(response.statusCode).toBe(400);
  }
});

it('GET /api/memory ANDs exact namespace and global filters with existing filters', async () => {
  expect(brain.getNamespaceMode()).toBe('none');
  const source = 'namespace-list';
  // none-mode writes discard the namespace by design, so set the column directly.
  const a = await brain.episodic.store({ content: 'Project A memory', source });
  const b = await brain.episodic.store({ content: 'Project B memory', source });
  const global = await brain.episodic.store({ content: 'Global memory', source });
  await getDb().update(schema.memories).set({ namespace: 'A' }).where(eq(schema.memories.id, a.id));
  await getDb().update(schema.memories).set({ namespace: 'B' }).where(eq(schema.memories.id, b.id));
  for (const [query, expected] of [
    ['', [{ id: a.id, namespace: 'A' }, { id: b.id, namespace: 'B' }, { id: global.id, namespace: null }]],
    ['&namespace=A', [{ id: a.id, namespace: 'A' }]],
    ['&global=true', [{ id: global.id, namespace: null }]],
    ['&namespace=A&global=true', []],
    ['&namespace=a', []],
    ['&namespace=A&type=semantic', []],
  ] as const) {
    const response = await app.inject({ method: 'GET', url: `/api/memory?source=${source}${query}` });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      count: expected.length,
      memories: expect.arrayContaining(expected.map((memory) => expect.objectContaining({
        id: memory.id, namespace: memory.namespace,
      }))),
    });
  }
});

it('GET /api/memory validates namespace filters with the existing query schema', async () => {
  for (const query of ['global=false', 'global=1', 'global=', 'global=TRUE', 'namespce=A']) {
    const response = await app.inject({ method: 'GET', url: `/api/memory?${query}` });
    expect(response.statusCode).toBe(400);
  }
});

it('GET /api/stats passes through namespace counts and the database path', async () => {
  const stats = await brain.stats();
  const response = await app.inject({ method: 'GET', url: '/api/stats' });
  expect(response.statusCode).toBe(200);
  expect(stats.byNamespace.length).toBeGreaterThan(0);
  expect(response.json()).toMatchObject({
    byNamespace: stats.byNamespace,
    dbPath: join(directory, 'test.db'),
  });
});

it('PATCH delegates to core and returns the updated memory for a prefix', async () => {
  const memory = await brain.episodic.store({ content: 'Old fact' });
  const update = vi.spyOn(brain, 'updateMemory');
  const payload = { content: 'Corrected fact', importance: 0.8, tags: ['fixed'], concept: 'Fact' };
  try {
    const response = await app.inject({ method: 'PATCH', url: `/api/memory/${memory.id.slice(0, 8)}`, payload });
    expect(response.statusCode).toBe(200);
    expect(update).toHaveBeenCalledWith(memory.id.slice(0, 8), payload);
    expect(response.json()).toMatchObject({ ...payload, id: memory.id, tags: '["fixed"]' });
  } finally {
    update.mockRestore();
  }
});

it('PATCH returns the same 404 body for ambiguous, missing, short, and archived ids', async () => {
  const memory = await brain.episodic.store({ content: 'Prefix collision' });
  for (const id of ['12345678-1111-4111-8111-111111111111', '12345678-2222-4222-8222-222222222222']) {
    getDb().insert(schema.memories).values({ ...memory, id }).run();
  }
  await brain.forget(memory.id);
  for (const id of ['12345678', '1234567', 'missing-id', memory.id, memory.id.slice(0, 8)]) {
    const response = await app.inject({ method: 'PATCH', url: `/api/memory/${id}`, payload: { content: 'Changed' } });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: 'Memory not found' });
  }
});

it('PATCH preserves validation failures', async () => {
  const memory = await brain.episodic.store({ content: 'Validation' });
  for (const payload of [{ importance: 2 }, { content: '' }]) {
    const response = await app.inject({ method: 'PATCH', url: `/api/memory/${memory.id}`, payload });
    expect(response.statusCode).toBe(400);
  }
});
