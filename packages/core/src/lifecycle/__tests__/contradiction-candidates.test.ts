import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { NeuralBrain } from '../../NeuralBrain.ts';
import { getDb, schema } from '../../db/index.ts';
import { ContradictionDetector } from '../ContradictionDetector.ts';

vi.mock('../../embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../embedding/Embedder.ts')>(),
  embed: async () => Float32Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0),
}));
let directory: string;
let brain: NeuralBrain;
beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'engram-candidates-'));
  brain = new NeuralBrain({ dbPath: join(directory, 'test.db'), contradictionConfig: { autoResolve: true } });
  await brain.initialize();
});
afterEach(() => {
  brain.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});
async function nominate() {
  const first = await brain.store({ content: 'The service listens on port 4901', source: 'test' });
  const second = await brain.store({ content: 'The service listens on port 4902', source: 'test' });
  expect(second.contradictions.hasContradictions).toBe(true);
  return { first, second };
}
function graphContradictions(id: string) {
  return brain.getGraph().getNeighbors(id).filter((edge) => edge.relationship === 'contradicts');
}
it('stores candidates without exposing them or auto-resolving, then confirms them', async () => {
  const webhook = vi.spyOn(brain.getWebhookManager(), 'fire');
  const { first, second } = await nominate();
  expect(await brain.getContradictions()).toEqual([]);
  expect(await brain.getContradictionCount()).toBe(0);
  expect(graphContradictions(first.memory.id)).toEqual([]);
  expect(getDb().select().from(schema.memories).all().every((row) => !row.archivedAt)).toBe(true);
  expect(webhook.mock.calls.some(([event]) => event === 'contradiction')).toBe(false);
  const [task] = await brain.getContradictionTasks();
  expect(task).toMatchObject({ source: { id: second.memory.id, content: second.memory.content,
    createdAt: second.memory.createdAt, source: 'test' }, target: { id: first.memory.id }, confidence: expect.any(Number) });
  expect(task!.signals.length).toBeGreaterThan(0);
  await brain.completeContradictionCheck(first.memory.id, second.memory.id, 'contradiction');
  expect(await brain.getContradictions()).toHaveLength(1);
  expect(await brain.getContradictionCount()).toBe(1);
  expect(await brain.getContradictionTasks()).toEqual([]);
  expect(graphContradictions(first.memory.id)).toHaveLength(1);
  expect(webhook.mock.calls.some(([event]) => event === 'contradiction')).toBe(true);
});
it('dismisses permanently, including repeat nominations in either direction', async () => {
  const { first, second } = await nominate();
  await brain.completeContradictionCheck(first.memory.id, second.memory.id, 'none');
  const row = getDb().select().from(schema.memoryConnections)
    .where(eq(schema.memoryConnections.relationship, 'contradicts')).get()!;
  expect(row.deletedAt).toBeTruthy();
  expect(JSON.parse(row.metadata).status).toBe('dismissed');
  for (const reverse of [false, true]) {
    vi.spyOn(ContradictionDetector.prototype, 'check').mockResolvedValueOnce({
      ...second.contradictions, contradictions: second.contradictions.contradictions.map((candidate) => ({
        ...candidate, newMemoryId: reverse ? first.memory.id : second.memory.id,
        existingMemoryId: reverse ? second.memory.id : first.memory.id,
      })),
    });
    const repeated = await brain.store({ content: `A different event ${reverse}`, type: 'episodic' });
    expect(repeated.contradictions.hasContradictions).toBe(false);
    expect(await brain.getContradictionTasks()).toEqual([]);
  }
  expect(await brain.getContradictions()).toEqual([]);
  expect(graphContradictions(first.memory.id)).toEqual([]);
  await expect(brain.completeContradictionCheck(first.memory.id, second.memory.id, 'contradiction'))
    .rejects.toThrow('candidate not found');
});
it.each(['{}', '{"status":null}', '{"status":"candidate"}', '{"status":"confirmed"}'])('loads only explicitly confirmed edges after restart: %s', async (metadata) => {
  const { first } = await nominate();
  getDb().update(schema.memoryConnections).set({ metadata })
    .where(eq(schema.memoryConnections.relationship, 'contradicts')).run();
  brain.shutdown();
  brain = new NeuralBrain({ dbPath: join(directory, 'test.db') });
  await brain.initialize();
  const confirmed = metadata.includes('confirmed');
  expect(graphContradictions(first.memory.id)).toHaveLength(confirmed ? 1 : 0);
  expect(await brain.getContradictions()).toHaveLength(confirmed ? 1 : 0);
  expect(await brain.getContradictionTasks()).toHaveLength(confirmed ? 0 : 1);
});
