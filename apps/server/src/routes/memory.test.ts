import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
