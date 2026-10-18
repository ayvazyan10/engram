import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NeuralBrain } from './NeuralBrain.ts';
import type { StoreInput, StoreResult } from './NeuralBrain.ts';
import { getDb, schema } from './db/index.ts';
import { embed, embedBatch } from './embedding/Embedder.ts';
import { getDeviceId } from './sync/deviceId.ts';

const ids = vi.hoisted(() => ({ next: 0 }));
vi.mock('uuid', () => ({ v4: () => `00000000-0000-4000-8000-${String(++ids.next).padStart(12, '0')}` }));
vi.mock('./embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./embedding/Embedder.ts')>(),
  embed: vi.fn(),
  embedBatch: vi.fn(),
}));

let brain: NeuralBrain;
let directory: string;

function vector(text: string): Float32Array {
  const result = new Float32Array(384);
  result[0] = text.includes('trip') ? 0.8 : text.includes('Deploy') ? 0 : 1;
  result[1] = Math.sqrt(1 - result[0]! ** 2);
  return result;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'engram-batch-'));
  vi.stubEnv('ENGRAM_DEDUP_THRESHOLD', '0.97');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
  vi.mocked(embed).mockReset().mockImplementation(async (text) => vector(text));
  vi.mocked(embedBatch).mockReset().mockImplementation(async (texts) => texts.map(vector));
  brain = new NeuralBrain({ dbPath: join(directory, 'loop.db'), namespaceMode: 'filter' });
  await brain.initialize();
});

afterEach(() => {
  brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

async function capture(inputs: StoreInput[], batch: boolean) {
  getDeviceId();
  ids.next = 0;
  const webhook = vi.spyOn(brain.getWebhookManager(), 'fire');
  const plugin = vi.spyOn(brain.getPluginRegistry(), 'runHook');
  const results: StoreResult[] = [];
  if (batch) results.push(...await brain.storeBatch(inputs));
  else for (const input of inputs) results.push(await brain.store(input));
  return {
    results: results.map((result) => ({
      ...result, contradictions: { ...result.contradictions, latencyMs: 0 },
    })),
    memories: getDb().select().from(schema.memories).all(),
    links: getDb().select().from(schema.memoryConnections).all(),
    indexed: [...brain.getVectorSearch().getIds()],
    webhooks: [...webhook.mock.calls],
    plugins: [...plugin.mock.calls],
  };
}

it.each([false, true])('matches sequential stores, including hooks and auto-resolution=%s', async (autoResolve) => {
  const inputs: StoreInput[] = [
    { content: 'The service listens on port 4901', type: 'semantic', tags: ['api'], importance: 0.4 },
    { content: 'The service listens on port 4901', type: 'semantic', tags: ['backend'], importance: 0.7 },
    { content: 'The service listens on port 4902', type: 'semantic', concept: 'Port' },
    { content: 'A trip to Paris', sessionId: 'session', metadata: { city: 'Paris' }, source: 'test' },
    { content: 'Ship code', type: 'procedural', triggerPattern: 'Ready', actionPattern: 'Deploy', namespace: 'work' },
  ];
  const original = structuredClone(inputs);
  brain.updateContradictionConfig({ autoResolve, defaultStrategy: 'keep_oldest' });
  const sequential = await capture(inputs, false);
  expect(embed).toHaveBeenCalledTimes(inputs.length);
  const texts = vi.mocked(embed).mock.calls.map(([text]) => text);
  brain.shutdown();
  brain = new NeuralBrain({ dbPath: join(directory, 'batch.db'), namespaceMode: 'filter' });
  await brain.initialize();
  brain.updateContradictionConfig({ autoResolve, defaultStrategy: 'keep_oldest' });
  vi.mocked(embed).mockClear();
  const batched = await capture(inputs, true);
  expect(batched).toEqual(sequential);
  expect(batched.results[1]).toMatchObject({
    deduplicated: true, memory: { id: batched.results[0]!.memory.id, tags: '["api","backend"]', importance: 0.7 },
  });
  expect(batched.results[2]!.contradictions.hasContradictions).toBe(true);
  expect(batched.results[2]!.discarded ?? false).toBe(autoResolve);
  expect(batched.links.some((link) => link.relationship === 'relates_to')).toBe(true);
  expect(batched.links.some((link) => link.relationship === 'contradicts')).toBe(true);
  expect(embedBatch).toHaveBeenCalledExactlyOnceWith(texts);
  expect(embed).not.toHaveBeenCalled();
  expect(inputs).toEqual(original);
});

it('does not embed or write an empty batch', async () => {
  expect(await brain.storeBatch([])).toEqual([]);
  expect(embedBatch).not.toHaveBeenCalled();
  expect(embed).not.toHaveBeenCalled();
  expect(getDb().select().from(schema.memories).all()).toHaveLength(0);
});

it('propagates embedding failures without writing records', async () => {
  vi.mocked(embedBatch).mockRejectedValueOnce(new Error('Embedding failed'));
  await expect(brain.storeBatch([{ content: 'First' }, { content: 'Second' }])).rejects.toThrow('Embedding failed');
  expect(getDb().select().from(schema.memories).all()).toHaveLength(0);
  expect(embed).not.toHaveBeenCalled();
});

it('preserves sequential validation and stops after the first invalid record', async () => {
  await expect(brain.storeBatch([
    { content: 'Valid record' }, { content: 'Invalid record', importance: 2 }, { content: 'Never stored' },
  ])).rejects.toThrow('importance');
  expect(getDb().select().from(schema.memories).all().map((memory) => memory.content)).toEqual(['Valid record']);
  expect(embedBatch).toHaveBeenCalledTimes(1);
  expect(embed).not.toHaveBeenCalled();
});

it('enforces isolated namespaces through the shared store path', async () => {
  brain.shutdown();
  brain = new NeuralBrain({ dbPath: join(directory, 'isolated.db'), namespaceMode: 'isolated', namespace: 'local' });
  await brain.initialize();
  await expect(brain.storeBatch([{ content: 'Foreign record', namespace: 'foreign' }]))
    .rejects.toThrow('namespace override is not allowed in isolated mode');
  expect(getDb().select().from(schema.memories).all()).toHaveLength(0);
});
