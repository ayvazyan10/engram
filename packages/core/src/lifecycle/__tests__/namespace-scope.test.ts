import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { NeuralBrain } from '../../NeuralBrain.ts';
import type { NamespaceMode } from '../../NeuralBrain.ts';
import { getDb, schema } from '../../db/index.ts';
import type { Memory } from '../../db/schema.ts';

vi.mock('../../embedding/Embedder.ts', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../embedding/Embedder.ts')>(),
  embed: vi.fn(async () => Float32Array.from({ length: 384 }, (_, i) => i === 0 ? 1 : 0)),
}));

let brain: NeuralBrain;
let directory: string;
let dbPath: string;
let own: Memory;
let global: Memory;
let foreign: Memory;

async function reopen(namespaceMode: NamespaceMode, namespace?: string): Promise<void> {
  brain.shutdown();
  brain = new NeuralBrain({ dbPath, namespaceMode, namespace, contradictionConfig: { enabled: false } });
  await brain.initialize();
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'engram-namespace-scope-'));
  dbPath = join(directory, 'brain.db');
  vi.stubEnv('ENGRAM_DEDUP_THRESHOLD', '0.97');
  brain = new NeuralBrain({
    dbPath, namespaceMode: 'filter', namespace: 'A', contradictionConfig: { enabled: false },
  });
  await brain.initialize();
  own = (await brain.store({ content: 'Project A deployment', tags: ['shared', 'A'] })).memory;
  global = (await brain.store({ content: 'Global deployment preference', namespace: null, tags: ['shared', 'global'] })).memory;
  foreign = (await brain.store({ content: 'Project B deployment', namespace: 'B', tags: ['shared', 'B'] })).memory;
});

afterEach(() => {
  brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('filter scope is own plus global', () => {
  it('searches and recalls A and NULL, excluding B', async () => {
    expect(new Set((await brain.search('deployment')).map((m) => m.id))).toEqual(new Set([own.id, global.id]));
    expect(new Set((await brain.recall('deployment')).memories.map((m) => m.id))).toEqual(new Set([own.id, global.id]));
  });

  it('includes B in crossNamespace reads without updating its access metadata', async () => {
    const expected = new Set([own.id, global.id, foreign.id]);
    expect(new Set((await brain.search('deployment', { crossNamespace: true })).map((m) => m.id))).toEqual(expected);
    expect(new Set((await brain.recall('deployment', { crossNamespace: true })).memories.map((m) => m.id))).toEqual(expected);
    const row = getDb().select().from(schema.memories).where(eq(schema.memories.id, foreign.id)).get()!;
    expect(row.accessCount).toBe(foreign.accessCount);
    expect(row.lastAccessedAt).toBe(foreign.lastAccessedAt);
  });

  it.each([false, true])('scopes streaming recall, crossNamespace=%s', async (crossNamespace) => {
    const ids: string[] = [];
    for await (const chunk of brain.recallStream('deployment', { crossNamespace })) {
      if ('memory' in chunk) ids.push(chunk.memory.id);
    }
    expect(new Set(ids)).toEqual(new Set(crossNamespace ? [own.id, global.id, foreign.id] : [own.id, global.id]));
    const row = getDb().select().from(schema.memories).where(eq(schema.memories.id, foreign.id)).get()!;
    expect(row.accessCount).toBe(foreign.accessCount);
  });

  it('includes globals in graph expansion but excludes foreign neighbors', async () => {
    brain.getGraph().addEdge({ sourceId: own.id, targetId: global.id, relationship: 'relates_to', strength: 1, bidirectional: true });
    brain.getGraph().addEdge({ sourceId: own.id, targetId: foreign.id, relationship: 'relates_to', strength: 1, bidirectional: true });
    expect(new Set((await brain.recall('deployment', { topK: 1 })).memories.map((m) => m.id))).toEqual(new Set([own.id, global.id]));
    const ids: string[] = [];
    for await (const chunk of brain.recallStream('deployment', { topK: 1 })) {
      if ('memory' in chunk) ids.push(chunk.memory.id);
    }
    expect(new Set(ids)).toEqual(new Set([own.id, global.id]));
  });

  it('stores explicit null globally and defaults to A', () => {
    expect(global.namespace).toBeNull();
    expect(own.namespace).toBe('A');
    expect(brain.canAccessNamespace(null)).toBe(true);
    expect(brain.canAccessNamespace('B')).toBe(false);
  });

  it('counts scoped live namespaces and reports the actual database path', async () => {
    expect(await brain.stats()).toMatchObject({
      dbPath, total: 2, byNamespace: expect.arrayContaining([
        { namespace: 'A', count: 1 }, { namespace: null, count: 1 },
      ]),
    });
    expect((await brain.stats()).byNamespace).toHaveLength(2);
    await reopen('none');
    expect((await brain.stats()).byNamespace).toEqual(expect.arrayContaining([
      { namespace: 'A', count: 1 }, { namespace: null, count: 1 }, { namespace: 'B', count: 1 },
    ]));
    await brain.forget(foreign.id);
    expect((await brain.stats()).byNamespace).toHaveLength(2);
  });

  it('includes global tags and tagged rows, excluding B', async () => {
    expect(await brain.getTags()).toEqual(expect.arrayContaining([
      { tag: 'shared', count: 2 }, { tag: 'A', count: 1 }, { tag: 'global', count: 1 },
    ]));
    expect(await brain.getTags()).toHaveLength(3);
    expect(new Set((await brain.getByTag('shared')).map((m) => m.id))).toEqual(new Set([own.id, global.id]));
  });
});

describe('mutation scope', () => {
  it.each(['full', 'prefix'])('blocks foreign forget and update by %s ID', async (kind) => {
    const id = kind === 'prefix' ? foreign.id.slice(0, 8) : foreign.id;
    expect(brain.resolveMemoryId(id)).toBeUndefined();
    await expect(brain.forget(id)).rejects.toThrow(/not found/);
    await expect(brain.updateMemory(id, { content: 'Changed' })).rejects.toThrow(/not found/);
  });

  it('blocks foreign tag mutations and contradiction checks', async () => {
    await expect(brain.addTag(foreign.id, 'changed')).rejects.toThrow(/not found/);
    await expect(brain.removeTag(foreign.id, 'B')).rejects.toThrow(/not found/);
    await expect(brain.checkContradictions(foreign.id)).rejects.toThrow(/not found/);
  });

  it.each([false, true])('rejects a foreign contradiction endpoint, reversed=%s', async (reversed) => {
    const [source, target] = reversed ? [foreign, own] : [own, foreign];
    await expect(brain.resolveContradiction(source!.id, target!.id, 'keep_newest')).rejects.toThrow(/not found/);
    expect(getDb().select().from(schema.memories).all().every((m) => m.archivedAt === null)).toBe(true);
  });

  it('filters contradiction connections by both endpoints, including global pairs', async () => {
    const otherGlobal = (await brain.store({ content: 'Another global fact', namespace: null })).memory;
    getDb().insert(schema.memoryConnections).values([
      { id: 'own-global', sourceId: own.id, targetId: global.id, relationship: 'contradicts' },
      { id: 'global-global', sourceId: global.id, targetId: otherGlobal.id, relationship: 'contradicts' },
      { id: 'own-foreign', sourceId: own.id, targetId: foreign.id, relationship: 'contradicts' },
      { id: 'foreign-global', sourceId: foreign.id, targetId: global.id, relationship: 'contradicts' },
    ]).run();
    expect(new Set((await brain.getContradictions()).map((c) => c.edge.id))).toEqual(new Set(['own-global', 'global-global']));
    expect((await brain.getContradictions('A')).map((c) => c.edge.id)).toEqual(['own-global']);
    await reopen('none');
    expect(await brain.getContradictions()).toHaveLength(4);
    await reopen('isolated', 'A');
    expect(await brain.getContradictions()).toHaveLength(0);
  });

  it('does not merge a store override into an existing foreign memory', async () => {
    // Make B the closest candidate so deduplication reaches its namespace guard.
    brain.getVectorSearch().remove(own.id);
    brain.getVectorSearch().remove(global.id);
    const before = getDb().select().from(schema.memories).where(eq(schema.memories.id, foreign.id)).get()!;
    await brain.store({ content: foreign.content, namespace: 'B', tags: ['changed'], importance: 1 });
    expect(getDb().select().from(schema.memories).where(eq(schema.memories.id, foreign.id)).get()).toEqual(before);
  });

  it('permits mutations of global rows', async () => {
    expect((await brain.updateMemory(global.id.slice(0, 8), { importance: 0.8 })).importance).toBe(0.8);
    expect(await brain.addTag(global.id, 'changed')).toContain('changed');
    expect(await brain.resolveContradiction(own.id, global.id, 'keep_both')).toMatchObject({ resolved: true });
    await brain.forget(global.id);
    expect(brain.resolveMemoryId(global.id)).toBeUndefined();
  });

  it('does not auto-link or detect contradictions across namespaces on global stores', async () => {
    brain.updateContradictionConfig({ enabled: true });
    const result = await brain.store({ content: 'The service listens on port 4901', namespace: null });
    const edges = getDb().select().from(schema.memoryConnections).all();
    expect(edges.every((edge) => ![own.id, foreign.id].includes(edge.targetId))).toBe(true);
    expect(result.contradictions.candidatesChecked).toBe(1);
  });

  it('consolidates only A episodes, leaving global and B rows live', async () => {
    const summary = await brain.consolidate(1, 0.5);
    expect(summary).toHaveLength(1);
    expect(summary[0]!.namespace).toBe('A');
    const rows = getDb().select().from(schema.memories).all();
    expect(rows.find((m) => m.id === global.id)!.archivedAt).toBeNull();
    expect(rows.find((m) => m.id === foreign.id)!.archivedAt).toBeNull();
    expect(summary[0]!.content).not.toContain(global.content);
  });

  it('protects the isolated BLUEBIRD memory from the section 1.3 prefix-forget repro', async () => {
    await reopen('isolated', 'secret');
    const { memory } = await brain.store({ content: 'Launch codename is BLUEBIRD', type: 'semantic' });
    await reopen('filter', 'other');
    const hit = (await brain.search('codename', { crossNamespace: true })).find((m) => m.id === memory.id)!;
    expect(hit).toBeDefined();
    await expect(brain.forget(hit.id.slice(0, 8))).rejects.toThrow(/Memory not found/);
    await reopen('isolated', 'secret');
    expect((await brain.search('codename')).map((m) => m.id)).toEqual([memory.id]);
  });
});

describe('isolated scope', () => {
  it('excludes NULL rows from recall, search, tags, and stats', async () => {
    await reopen('isolated', 'A');
    expect((await brain.recall('deployment')).memories.map((m) => m.id)).toEqual([own.id]);
    expect((await brain.search('deployment')).map((m) => m.id)).toEqual([own.id]);
    expect((await brain.stats()).byNamespace).toEqual([{ namespace: 'A', count: 1 }]);
    expect((await brain.getByTag('shared')).map((m) => m.id)).toEqual([own.id]);
    expect(brain.canAccessNamespace(null)).toBe(false);
  });

  it('rejects explicit null stores', async () => {
    await reopen('isolated', 'A');
    await expect(brain.store({ content: 'Global write', namespace: null })).rejects.toThrow(/override/);
  });
});
