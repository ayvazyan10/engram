import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { getDb, schema } from '../../../../packages/core/src/db/index.ts';

vi.mock('@engram-ai-memory/core', () => import('../../../../packages/core/src/index.ts'));
vi.mock('../../../../packages/core/src/embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../packages/core/src/embedding/Embedder.ts')>(),
  embed: async () => new Float32Array(384).fill(1),
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
