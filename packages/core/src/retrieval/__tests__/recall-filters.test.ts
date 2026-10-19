import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NeuralBrain } from '../../NeuralBrain.ts';
import { getDb, schema } from '../../db/index.ts';
import type { NewMemory } from '../../db/schema.ts';
import { getEmbeddingDimension, getEmbeddingModelId, packFP16 } from '../../embedding/Embedder.ts';
import type { RecallOptions } from '../ContextAssembler.ts';

vi.mock('../../embedding/Embedder.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../embedding/Embedder.ts')>();
  return {
    ...original,
    embed: async () => Float32Array.from({ length: original.getEmbeddingDimension() }, (_, i) => i === 0 ? 1 : 0),
  };
});

const SINCE = '2026-01-10T00:00:00.000Z';
const UNTIL = '2026-01-20T00:00:00.000Z';
const CREATED = '2026-02-01T00:00:00.000Z';
let directory: string;
let brain: NeuralBrain;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'engram-recall-filters-'));
  brain = new NeuralBrain({ dbPath: join(directory, 'test.db') });
  await brain.initialize();
});

afterEach(() => {
  brain?.shutdown();
  rmSync(directory, { recursive: true, force: true });
});

function insert(id: string, similarity: number, fields: Partial<NewMemory> = {}): void {
  const vector = Float32Array.from({ length: getEmbeddingDimension() }, (_, i) => {
    if (i === 0) return similarity;
    return i === 1 ? Math.sqrt(1 - similarity * similarity) : 0;
  });
  getDb().insert(schema.memories).values({
    id, type: 'semantic', content: id, createdAt: CREATED, updatedAt: CREATED,
    embedding: packFP16(vector), embeddingDim: vector.length, embeddingModel: getEmbeddingModelId(),
    ...fields,
  }).run();
}

async function retrieve(mode: string, options: RecallOptions): Promise<string[]> {
  if (mode === 'search') return (await brain.search('query', options)).map((memory) => memory.id);
  if (mode === 'recall') return (await brain.recall('query', options)).memories.map((memory) => memory.id);
  const ids: string[] = [];
  for await (const chunk of brain.recallStream('query', options)) {
    if ('memory' in chunk) ids.push(chunk.memory.id);
    if ('memories' in chunk) expect(chunk.memories.map((memory) => memory.id).sort()).toEqual([...ids].sort());
  }
  return ids;
}

describe.each(['search', 'recall', 'stream'])('%s filters', (mode) => {
  it('uses inclusive event dates, falling back to creation dates and comparing instants', async () => {
    insert('before', 1, { eventAt: '2026-01-09T23:59:59.999Z' });
    insert('lower', 0.99, { eventAt: SINCE });
    insert('upper', 0.98, { eventAt: '2026-01-20T02:00:00.000+02:00' });
    insert('after', 0.97, { eventAt: '2026-01-20T00:00:00.001Z' });
    insert('created-inside', 0.96, { createdAt: '2026-01-15T00:00:00.000Z' });
    insert('created-outside', 0.95);
    const result = await retrieve(mode, { since: SINCE, until: UNTIL });
    expect(result.sort()).toEqual(['created-inside', 'lower', 'upper']);
  });

  it('supports each date bound independently', async () => {
    insert('before', 1, { eventAt: '2026-01-01T00:00:00.000Z' });
    insert('inside', 0.99, { eventAt: SINCE });
    insert('after', 0.98, { eventAt: CREATED });
    expect((await retrieve(mode, { since: SINCE })).sort()).toEqual(['after', 'inside']);
    expect((await retrieve(mode, { until: UNTIL })).sort()).toEqual(['before', 'inside']);
  });

  it('requires every exact tag and permits an empty tag list', async () => {
    insert('both', 1, { tags: '["project","release","extra"]' });
    insert('one', 0.99, { tags: '["project"]' });
    insert('substring', 0.98, { tags: '["project","prerelease"]' });
    insert('none', 0.97);
    expect(await retrieve(mode, { tags: ['project', 'release'] })).toEqual(['both']);
    expect(await retrieve(mode, { tags: [] })).toHaveLength(4);
  });

  it('fills topK after skipping leading candidates and truncates extra matches', async () => {
    insert('wrong-date', 1, { tags: '["keep"]' });
    insert('wrong-tags', 0.99, { eventAt: SINCE });
    for (let i = 0; i < 3; i++) insert(`match-${i}`, 0.98 - i / 100, { eventAt: SINCE, tags: '["keep"]' });
    expect(await retrieve(mode, { topK: 2 })).toEqual(['wrong-date', 'wrong-tags']);
    const options = { topK: 2, since: SINCE, until: UNTIL, tags: ['keep'] };
    const result = await retrieve(mode, options);
    expect(result).toHaveLength(2);
    expect(result.every((id) => id.startsWith('match-'))).toBe(true);
    expect(options).toEqual({ topK: 2, since: SINCE, until: UNTIL, tags: ['keep'] });
  });
});

describe.each(['recall', 'stream'])('%s graph filters', (mode) => {
  it('filters graph neighbors that were not vector candidates', async () => {
    insert('seed', 1, { eventAt: SINCE, tags: '["keep"]' });
    insert('neighbor-tags', 0, { eventAt: SINCE });
    insert('neighbor-date', 0, { tags: '["keep"]' });
    insert('neighbor-keep', 0, { eventAt: SINCE, tags: '["keep"]' });
    for (const targetId of ['neighbor-tags', 'neighbor-date', 'neighbor-keep']) {
      getDb().insert(schema.memoryConnections).values({
        id: targetId, sourceId: 'seed', targetId, relationship: 'related_to', strength: 1,
      }).run();
    }
    expect((await retrieve(mode, { since: SINCE, until: UNTIL, tags: ['keep'] })).sort())
      .toEqual(['neighbor-keep', 'seed']);
  });
});

describe('search project filters', () => {
  it.each([{ namespace: '/code/api' }, { global: true as const }])('fills topK past leading nonmatches for %j', async (filter) => {
    insert('other-1', 1, { namespace: '/code/web' });
    insert('other-2', 0.99, { namespace: '/code/web' });
    for (let i = 0; i < 3; i++) {
      insert(`match-${i}`, 0.98 - i / 100, { namespace: 'namespace' in filter ? filter.namespace : null });
    }
    expect((await brain.search('query', { topK: 2 })).map((m) => m.id)).toEqual(['other-1', 'other-2']);
    expect((await brain.search('query', { topK: 2, ...filter })).map((m) => m.id)).toEqual(['match-0', 'match-1']);
  });

  it('combines project filters with existing filters', async () => {
    insert('wrong-tag', 1, { namespace: '/code/api', eventAt: SINCE });
    insert('wrong-project', 0.99, { namespace: '/code/web', eventAt: SINCE, tags: '["keep"]' });
    insert('match', 0.98, { namespace: '/code/api', eventAt: SINCE, tags: '["keep"]' });
    expect((await brain.search('query', { namespace: '/code/api', since: SINCE, until: UNTIL, tags: ['keep'] })).map((m) => m.id)).toEqual(['match']);
  });

  it.each(['filter', 'isolated'] as const)('only narrows configured %s scope', async (namespaceMode) => {
    insert('own', 1, { namespace: '/code/api' });
    insert('foreign', 0.99, { namespace: '/code/web' });
    insert('global', 0.98);
    brain.shutdown();
    brain = new NeuralBrain({ dbPath: join(directory, 'test.db'), namespaceMode, namespace: '/code/api' });
    await brain.initialize();

    expect((await brain.search('query', { namespace: '/code/api' })).map((m) => m.id)).toEqual(['own']);
    expect(await brain.search('query', { namespace: '/code/web' })).toEqual([]);
    expect((await brain.search('query', { global: true })).map((m) => m.id)).toEqual(namespaceMode === 'filter' ? ['global'] : []);
    if (namespaceMode === 'filter') {
      expect((await brain.search('query', { namespace: '/code/web', crossNamespace: true })).map((m) => m.id)).toEqual(['foreign']);
    } else {
      await expect(brain.search('query', { namespace: '/code/web', crossNamespace: true })).rejects.toThrow(/cross-namespace/);
    }
  });
});
