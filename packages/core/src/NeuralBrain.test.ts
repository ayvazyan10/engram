import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { NeuralBrain } from './NeuralBrain.ts';
import { getDb, schema } from './db/index.ts';
import { embed, unpackFP16 } from './embedding/Embedder.ts';
import { getDeviceId } from './sync/deviceId.ts';

vi.mock('./embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('./embedding/Embedder.ts')>(),
  embed: vi.fn(),
}));

let brain: NeuralBrain;
let directory: string;

function vector(similarity = 1): Float32Array {
  const result = new Float32Array(384);
  result[0] = similarity;
  result[1] = Math.sqrt(1 - similarity ** 2);
  return result;
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'engram-dedup-'));
  vi.stubEnv('ENGRAM_DEDUP_THRESHOLD', '');
  vi.mocked(embed).mockReset().mockResolvedValue(vector());
  brain = new NeuralBrain({
    dbPath: join(directory, 'test.db'), namespaceMode: 'filter',
    contradictionConfig: { enabled: false },
  });
  await brain.initialize();
});

afterEach(() => {
  brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

it('deduplicates near-identical content, unions tags, and preserves the existing record', async () => {
  const first = await brain.store({ content: 'The service uses TypeScript', tags: ['api'], importance: 0.4 });
  getDb().update(schema.memories).set({ updatedAt: '2000-01-01', deviceId: 'old-device' })
    .where(eq(schema.memories.id, first.memory.id)).run();
  vi.mocked(embed).mockResolvedValue(vector(0.99));
  const second = await brain.store({
    content: 'The service uses TypeScript.', tags: ['api', 'backend'], importance: 0.9,
  });
  expect(second.deduplicated).toBe(true);
  expect(second.memory).toMatchObject({
    id: first.memory.id, content: first.memory.content, createdAt: first.memory.createdAt,
    importance: 0.9, deviceId: getDeviceId(),
  });
  expect(second.memory.updatedAt).not.toBe('2000-01-01');
  expect(JSON.parse(second.memory.tags)).toEqual(['api', 'backend']);
  expect(getDb().select().from(schema.memories).all()).toHaveLength(1);
  expect(getDb().select().from(schema.memoryConnections).all()).toHaveLength(0);
  const third = await brain.store({ content: first.memory.content, importance: 0.1 });
  expect(third.memory.importance).toBe(0.9);
});

it('does not deduplicate numeric contradictions even when contradiction checking is disabled', async () => {
  const first = await brain.store({ content: 'The service listens on port 4901' });
  const second = await brain.store({ content: 'The service listens on port 4902' });
  expect(second.deduplicated).not.toBe(true);
  expect(second.memory.id).not.toBe(first.memory.id);
  expect(getDb().select().from(schema.memories).all()).toHaveLength(2);
});

it('creates one contradiction edge between distinct memories when numeric detection is enabled', async () => {
  brain.updateContradictionConfig({ enabled: true });
  const first = await brain.store({ content: 'The service listens on port 4901' });
  const second = await brain.store({ content: 'The service listens on port 4902' });
  expect(second.deduplicated).not.toBe(true);
  expect(second.memory.id).not.toBe(first.memory.id);
  expect(second.contradictions.hasContradictions).toBe(true);
  const edges = getDb().select().from(schema.memoryConnections).all();
  expect(edges.every((edge) => edge.sourceId !== edge.targetId)).toBe(true);
  expect(edges.filter((edge) => edge.relationship === 'contradicts')).toEqual([
    expect.objectContaining({ sourceId: second.memory.id, targetId: first.memory.id }),
  ]);
});

it('does not deduplicate a different type', async () => {
  const first = await brain.store({ content: 'The service uses TypeScript', type: 'semantic' });
  const second = await brain.store({ content: first.memory.content, type: 'episodic' });
  expect(second.deduplicated).not.toBe(true);
  expect(second.memory.id).not.toBe(first.memory.id);
});

it.each([undefined, 'other'])('does not deduplicate a different namespace: %s', async (namespace) => {
  const first = await brain.store({ content: 'The service uses TypeScript', namespace: 'project' });
  const second = await brain.store({ content: first.memory.content, namespace });
  expect(second.deduplicated).not.toBe(true);
  expect(second.memory.id).not.toBe(first.memory.id);
});

it('ignores archived neighbours', async () => {
  const first = await brain.store({ content: 'The service uses TypeScript' });
  getDb().update(schema.memories).set({ archivedAt: new Date().toISOString() })
    .where(eq(schema.memories.id, first.memory.id)).run();
  const second = await brain.store({ content: first.memory.content });
  expect(second.deduplicated).not.toBe(true);
  expect(second.memory.id).not.toBe(first.memory.id);
});

it('uses the configured threshold', async () => {
  const first = await brain.store({ content: 'The service uses TypeScript' });
  vi.mocked(embed).mockResolvedValue(vector(0.96));
  const second = await brain.store({ content: 'The service uses TypeScript.' });
  expect(second.memory.id).not.toBe(first.memory.id);
  vi.stubEnv('ENGRAM_DEDUP_THRESHOLD', '0.95');
  vi.mocked(embed).mockResolvedValue(vector(0.90));
  const third = await brain.store({ content: second.memory.content });
  expect(third.deduplicated).toBe(true);
  expect(third.memory.id).toBe(second.memory.id);
});

it('does not fall through to a less similar neighbour of the same type', async () => {
  await brain.store({ content: 'The service uses TypeScript', type: 'semantic' });
  vi.mocked(embed).mockResolvedValue(vector(0.98));
  const closest = await brain.store({ content: 'The service uses TypeScript', type: 'episodic' });
  const result = await brain.store({ content: closest.memory.content, type: 'semantic' });
  expect(result.deduplicated).not.toBe(true);
  expect(getDb().select().from(schema.memories).all()).toHaveLength(3);
});

it('checks raw signals even below the contradiction confidence threshold', async () => {
  brain.updateContradictionConfig({ enabled: true, confidenceThreshold: 1 });
  await brain.store({ content: 'The service uses TypeScript' });
  const result = await brain.store({ content: 'The service currently uses TypeScript' });
  expect(result.deduplicated).not.toBe(true);
  expect(result.contradictions.hasContradictions).toBe(false);
});

it.each([
  ['semantic', 'Release: Ship on Friday'],
  ['episodic', 'Ship on Friday'],
  ['procedural', 'Ready → Deploy. Ship on Friday'],
] as const)('updates %s content with its embedding template and refreshes the index', async (type, text) => {
  const { memory } = await brain.store({
    content: 'Ship on Monday', type, concept: 'Release',
    triggerPattern: 'Ready', actionPattern: 'Deploy',
  });
  getDb().update(schema.memories).set({ embeddingModel: 'old-model', deviceId: 'old-device' })
    .where(eq(schema.memories.id, memory.id)).run();
  vi.mocked(embed).mockClear().mockResolvedValue(vector(0));
  const updated = await brain.updateMemory(memory.id.slice(0, 8), {
    content: 'Ship on Friday', importance: 0.8, tags: ['release'],
  });
  expect(embed).toHaveBeenCalledExactlyOnceWith(text);
  expect(updated).toMatchObject({
    id: memory.id, content: 'Ship on Friday', importance: 0.8, tags: '["release"]',
    embeddingDim: 384, embeddingModel: brain.getEmbeddingModel(), deviceId: getDeviceId(),
  });
  expect(unpackFP16(updated.embedding!)).toEqual(vector(0));
  expect(brain.getVectorSearch().search(vector(0), 1, 0.99)[0]?.id).toBe(memory.id);
});

it('re-embeds a semantic concept change, but skips embedding unchanged text and metadata edits', async () => {
  const { memory } = await brain.store({ content: 'Ship on Monday', type: 'semantic', concept: 'Release' });
  vi.mocked(embed).mockClear();
  await brain.updateMemory(memory.id, { content: memory.content, tags: [], importance: 0 });
  expect(embed).not.toHaveBeenCalled();
  const updated = await brain.updateMemory(memory.id, { concept: 'Schedule' });
  expect(embed).toHaveBeenCalledExactlyOnceWith('Schedule: Ship on Monday');
  expect(updated).toMatchObject({ concept: 'Schedule', importance: 0, tags: '[]' });
});

it('rejects ambiguous, short, missing, and wildcard prefixes without changing memories', async () => {
  const { memory } = await brain.store({ content: 'Original' });
  const db = getDb();
  const ids = ['12345678-1111-4111-8111-111111111111', '12345678-2222-4222-8222-222222222222'];
  for (const id of ids) db.insert(schema.memories).values({ ...memory, id }).run();
  for (const id of ['12345678', '1234567', 'missing-id', '1234567%', '1234567_']) {
    await expect(brain.updateMemory(id, { content: 'Changed' })).rejects.toThrow('Memory not found');
    await expect(brain.forget(id)).rejects.toThrow('Memory not found');
  }
  expect(db.select().from(schema.memories).all().every((row) => row.content === 'Original')).toBe(true);
  expect((await brain.updateMemory(ids[0]!, { content: 'Changed' })).id).toBe(ids[0]);
});

it('forgets a prefix and rejects updates to archived memories by full id or prefix', async () => {
  const { memory } = await brain.store({ content: 'Outdated fact' });
  await brain.forget(memory.id.slice(0, 8));
  const archived = getDb().select().from(schema.memories).where(eq(schema.memories.id, memory.id)).get();
  expect(archived?.archivedAt).toBeTruthy();
  expect(brain.getVectorSearch().getIds().has(memory.id)).toBe(false);
  expect(brain.getGraph().getNode(memory.id)).toBeUndefined();
  for (const id of [memory.id, memory.id.slice(0, 8)]) {
    await expect(brain.updateMemory(id, { content: 'Changed' })).rejects.toThrow('Memory not found');
  }
});

it('enforces isolated namespace access for update and forget prefixes', async () => {
  const foreign = await brain.store({ content: 'Private fact', namespace: 'foreign' });
  brain.shutdown();
  brain = new NeuralBrain({
    dbPath: join(directory, 'test.db'), namespaceMode: 'isolated', namespace: 'local',
    contradictionConfig: { enabled: false },
  });
  await brain.initialize();
  for (const id of [foreign.memory.id, foreign.memory.id.slice(0, 8)]) {
    await expect(brain.updateMemory(id, { content: 'Changed' })).rejects.toThrow('Memory not found');
    await expect(brain.forget(id)).rejects.toThrow('Memory not found');
  }
  const local = await brain.store({ content: 'Local fact' });
  expect((await brain.updateMemory(local.memory.id.slice(0, 8), { tags: ['local'] })).tags).toBe('["local"]');
});

it.each(['semantic', 'procedural', 'episodic'] as const)(
  'prefixes recalled %s bullets with the short id and date', async (type) => {
    const { memory } = await brain.store({ content: 'Recall this fact', type, source: 'test' });
    getDb().update(schema.memories).set({
      createdAt: '2026-10-18 12:00:00', eventAt: '2026-10-17T13:00:00.000Z', summary: 'Saved summary',
    }).where(eq(schema.memories.id, memory.id)).run();
    const result = await brain.recall('Recall this fact');
    const date = type === 'episodic' ? '2026-10-17' : '2026-10-18';
    const source = type === 'episodic' ? '[test] ' : '';
    expect(result.context).toContain(`• [${memory.id.slice(0, 8)} · ${date}] ${source}Saved summary`);
  },
);

it('uses the creation date for an event without eventAt', async () => {
  const { memory } = await brain.store({ content: 'Undated event', type: 'episodic' });
  getDb().update(schema.memories).set({ createdAt: '2026-10-18T12:00:00.000Z', eventAt: null })
    .where(eq(schema.memories.id, memory.id)).run();
  expect((await brain.recall('Undated event')).context).toContain(`• [${memory.id.slice(0, 8)} · 2026-10-18]`);
});
