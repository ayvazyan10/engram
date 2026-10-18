import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { NeuralBrain } from '../NeuralBrain.ts';
import { getDb, schema } from '../db/index.ts';
import type { NewMemory } from '../db/schema.ts';
import { getEmbeddingDimension, getEmbeddingModelId, packFP16 } from '../embedding/Embedder.ts';
import type { RecallOptions } from './ContextAssembler.ts';
import { escapeMatch, hybridSearch, keywordSearch } from './HybridSearch.ts';
import { VectorSearch } from './VectorSearch.ts';

// Same deterministic vector fixture as __tests__/recall-filters.test.ts.
vi.mock('../embedding/Embedder.ts', async (importOriginal) => {
  const original = await importOriginal<typeof import('../embedding/Embedder.ts')>();
  return { ...original,
    embed: async () => Float32Array.from({ length: original.getEmbeddingDimension() }, (_, i) => i === 0 ? 1 : 0),
  };
});

let directory: string;
let brain: NeuralBrain;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), 'engram-hybrid-'));
  brain = new NeuralBrain({ dbPath: join(directory, 'test.db'), namespace: 'project-a',
    namespaceMode: 'filter', contradictionConfig: { enabled: false } });
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
    id, type: 'semantic', content: id, namespace: 'project-a',
    createdAt: '2026-01-15T00:00:00.000Z', updatedAt: '2026-01-15T00:00:00.000Z',
    embedding: packFP16(vector), embeddingDim: vector.length, embeddingModel: getEmbeddingModelId(),
    ...fields,
  }).run();
}

async function retrieve(mode: string, query: string, options: RecallOptions = {}): Promise<string[]> {
  if (mode === 'search') return (await brain.search(query, options)).map((memory) => memory.id);
  if (mode === 'recall') return (await brain.recall(query, { graphDepth: 0, ...options })).memories.map((m) => m.id);
  const ids: string[] = [];
  for await (const chunk of brain.recallStream(query, { graphDepth: 0, ...options })) {
    if ('memory' in chunk) ids.push(chunk.memory.id);
    if ('memories' in chunk) expect(chunk.memories.map((m) => m.id).sort()).toEqual([...ids].sort());
  }
  return ids;
}

describe.each(['search', 'recall', 'stream'])('%s hybrid retrieval', (mode) => {
  it('surfaces keyword-only hits below the cosine threshold', async () => {
    insert('keyword', 0, { content: 'ERR_AUTH_429' });
    expect(await retrieve(mode, 'ERR_AUTH_429', { threshold: 0.3 })).toEqual(['keyword']);
  });

  it('excludes keyword hits rejected by index reconciliation', async () => {
    insert('foreign-dim', 0, { content: 'keyword',
      embedding: packFP16(new Float32Array(192)), embeddingDim: 192 });
    insert('healthy', 0, { content: 'keyword' });
    expect(await retrieve(mode, 'keyword')).toEqual(['healthy']);
    expect(brain.getIndexStatus().externalSkipped).toBe(1);
  });

  it('ranks an exact identifier ahead of a more similar unrelated memory', async () => {
    insert('semantic', 1, { content: 'An authentication failure' });
    insert('exact', 0, { content: 'ERR_AUTH_429 in VectorSearch.ts' });
    expect((await retrieve(mode, 'ERR_AUTH_429'))[0]).toBe('exact');
    expect((await retrieve(mode, 'VectorSearch.ts'))[0]).toBe('exact');
  });

  it('preserves vector-only paraphrase retrieval and threshold rejection', async () => {
    insert('paraphrase', 0.9, { content: 'prefers tabs over spaces' });
    insert('unrelated', 0.1, { content: 'a distant galaxy' });
    expect(keywordSearch('code style preferences', 20)).toEqual([]);
    expect(await retrieve(mode, 'code style preferences')).toEqual(['paraphrase']);
  });

  it('searches concept and tags as well as content', async () => {
    insert('concept', 0, { concept: 'Quasar' });
    insert('tag', 0, { tags: '["Nebula"]' });
    expect(await retrieve(mode, 'Quasar')).toEqual(['concept']);
    expect(await retrieve(mode, 'Nebula')).toEqual(['tag']);
  });

  it('keeps own+global scope and only crosses projects when requested', async () => {
    insert('own', 0, { content: 'keyword' });
    insert('global', 0, { content: 'keyword', namespace: null });
    insert('foreign', 0, { content: 'keyword', namespace: 'project-b' });
    expect((await retrieve(mode, 'keyword')).sort()).toEqual(['global', 'own']);
    expect((await retrieve(mode, 'keyword', { crossNamespace: true })).sort()).toEqual(['foreign', 'global', 'own']);
  });

  it('applies type, source, date, and exact tag filters to keyword hits', async () => {
    const fields = { content: 'keyword', source: 'cli', tags: '["keep"]' };
    insert('keep', 0, fields);
    insert('source', 0, { ...fields, source: 'web' });
    insert('type', 0, { ...fields, type: 'episodic' });
    insert('tag', 0, { ...fields, tags: '["keeper"]' });
    insert('before', 0, { ...fields, eventAt: '2026-01-09T00:00:00.000Z' });
    insert('after', 0, { ...fields, eventAt: '2026-01-21T00:00:00.000Z' });
    insert('foreign', 0, { ...fields, namespace: 'project-b' });
    expect(await retrieve(mode, 'keyword', { sources: ['cli'], types: ['semantic'], tags: ['keep'],
      since: '2026-01-10T00:00:00.000Z', until: '2026-01-20T00:00:00.000Z' })).toEqual(['keep']);
  });

  it('reflects public store, update, and forget immediately', async () => {
    const { memory } = await brain.store({ content: 'oldword', concept: 'oldconcept', tags: ['oldtag'] });
    expect(await retrieve(mode, 'oldword', { threshold: 1.1 })).toEqual([memory.id]);
    await brain.updateMemory(memory.id, { content: 'newword', concept: 'newconcept', tags: ['newtag'] });
    for (const query of ['oldword', 'oldconcept', 'oldtag']) {
      expect(await retrieve(mode, query, { threshold: 1.1 })).toEqual([]);
    }
    for (const query of ['newword', 'newconcept', 'newtag']) {
      expect(await retrieve(mode, query, { threshold: 1.1 })).toEqual([memory.id]);
    }
    await brain.forget(memory.id);
    expect(await retrieve(mode, 'newword', { threshold: 1.1 })).toEqual([]);
  });

  it('excludes archived rows and supports physical deletion and re-embedding', async () => {
    insert('memory', 0, { content: 'keyword' });
    getDb().update(schema.memories).set({ embedding: packFP16(new Float32Array(384)) })
      .where(eq(schema.memories.id, 'memory')).run();
    expect(await retrieve(mode, 'keyword')).toEqual(['memory']);
    getDb().update(schema.memories).set({ archivedAt: new Date().toISOString() })
      .where(eq(schema.memories.id, 'memory')).run();
    expect(await retrieve(mode, 'keyword')).toEqual([]);
    getDb().delete(schema.memories).where(eq(schema.memories.id, 'memory')).run();
    expect(keywordSearch('keyword', 20)).toEqual([]);
  });
});

it.each(['"', '*', 'NEAR(', 'a OR b', 'a AND b', 'a NOT b', 'col:x', '-', "''", '',
  '(){}:^+!?', 'a*', '" OR * --', 'café 東京', 'x\u0000y'])('treats MATCH input as literal words: %j', (query) => {
  insert('literal', 0, { content: 'a OR b col x café 東京' });
  insert('partial', 0, { content: 'a' });
  expect(() => keywordSearch(query, 20)).not.toThrow();
  if (query === 'a OR b') expect(keywordSearch(query, 20).map((m) => m.id)).toEqual(['literal']);
  if (query === 'col:x' || query === 'café 東京') expect(keywordSearch(query, 20)).toHaveLength(1);
  if (!escapeMatch(query)) expect(keywordSearch(query, 20)).toEqual([]);
});

it('restricts an unnamed filter namespace to global keyword hits', () => {
  insert('foreign', 0, { content: 'keyword' });
  insert('global', 0, { content: 'keyword', namespace: null });
  expect(keywordSearch('keyword', 20, undefined, undefined, false, true).map((m) => m.id)).toEqual(['global']);
});

it('computes reciprocal ranks with k=60 without mutating the vector index', () => {
  insert('exact', 0, { content: 'keyword' });
  insert('semantic', 1);
  const index = new VectorSearch(2);
  index.load([{ id: 'semantic', type: 'semantic', vector: new Float32Array([1, 0]) },
    { id: 'exact', type: 'semantic', vector: new Float32Array([0, 1]) }]);
  const hits = hybridSearch(index, 'keyword', new Float32Array([1, 0]), 20, 0.3);
  expect(hits.map((hit) => hit.id)).toEqual(['exact', 'semantic']);
  expect(hits[0]?.relevance).toBeCloseTo((1 / 62 + 1 / 61) * 61 / 2);
  expect(hits[0]?.similarity).toBe(0);
  expect(index.search(new Float32Array([1, 0]))[0]?.id).toBe('semantic');
});

it('orders lexical candidates by BM25 before limiting them', () => {
  insert('verbose', 0, { content: `ERR_AUTH_429 ${'background '.repeat(100)}` });
  insert('exact', 0, { content: 'ERR_AUTH_429' });
  expect(keywordSearch('ERR_AUTH_429', 1).map((hit) => hit.id)).toEqual(['exact']);
});

it('admits a keyword hit outside the vector candidate list', () => {
  insert('keyword', 0, { content: 'ERR_AUTH_429' });
  const index = new VectorSearch(2);
  index.load([{ id: 'semantic', type: 'semantic', vector: new Float32Array([1, 0]) },
    { id: 'keyword', type: 'semantic', vector: new Float32Array([0, 1]) }]);
  expect(index.search(new Float32Array([1, 0]), 1).map((hit) => hit.id)).toEqual(['semantic']);
  const hits = hybridSearch(index, 'ERR_AUTH_429', new Float32Array([1, 0]), 1, 0.3);
  expect(hits.map((hit) => hit.id)).toEqual(['keyword']);
  expect(hits[0]?.similarity).toBe(0);
});
