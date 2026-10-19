import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { NeuralBrain } from '../../NeuralBrain.js';
import { getDb, schema } from '../../db/index.js';
import { getEmbeddingDimension, getEmbeddingModelId, packFP16 } from '../../embedding/Embedder.js';
import type { RecallOptions } from '../ContextAssembler.js';
import * as hybrid from '../HybridSearch.js';

vi.mock('../../embedding/Embedder.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../embedding/Embedder.js')>(),
  embed: async () => Float32Array.from({ length: getEmbeddingDimension() }, (_, i) => i === 0 ? 1 : 0),
}));

let directory: string;
let brain: NeuralBrain;
const createdAt = '2026-01-01T00:00:00.000Z';

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime('2026-01-10T00:00:00.000Z');
  directory = mkdtempSync(join(tmpdir(), 'engram-recall-identity-'));
  brain = new NeuralBrain({ dbPath: join(directory, 'test.db'), hybridSearch: false });
  await brain.initialize();
  for (const [id, type, similarity, content, summary] of [
    ['event-0001', 'episodic', 1, 'Discussed deployment ☃', null],
    ['large-0002', 'semantic', 0.95, 'Large knowledge '.repeat(100), null],
    ['skill-0003', 'procedural', 0.9, 'Verbose underlying procedure '.repeat(50), 'Run migration first'],
    ['known-0004', 'semantic', 0.85, 'Uses Postgres', ''],
    ['graph-0005', 'semantic', 0, 'Graph knowledge', null],
  ] as const) {
    const vector = Float32Array.from({ length: getEmbeddingDimension() }, (_, i) =>
      i === 0 ? similarity : i === 1 ? Math.sqrt(1 - similarity * similarity) : 0);
    getDb().insert(schema.memories).values({
      id, type, content, summary, importance: 0.5, source: 'fixture',
      createdAt, updatedAt: createdAt, eventAt: type === 'episodic' ? '2025-12-25T00:00:00.000Z' : null,
      embedding: packFP16(vector), embeddingDim: vector.length, embeddingModel: getEmbeddingModelId(),
    }).run();
  }
  getDb().insert(schema.memoryConnections).values({
    id: 'edge', sourceId: 'event-0001', targetId: 'graph-0005', relationship: 'related_to', strength: 1,
  }).run();
});

afterEach(() => {
  brain?.shutdown();
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

// Snapshots captured from fd8bf0d04f13ad2d237cb21465b1afb7ecb35dc1 before the split.
// Freeze Date so even latency, recency scores and persisted timestamps compare exactly.
it.each<RecallOptions>([{}, { maxTokens: 20 }, { types: ['procedural'], sources: ['fixture'] }, { threshold: 1.1 }])(
  'preserves pre-B2 recall/stream bytes and writes for %j', async (options) => {
    const db = getDb();
    const recall = await brain.recall('deployment', options);
    const recallWrites = {
      memories: db.select().from(schema.memories).all(),
      audits: db.select().from(schema.contextAssemblies).all().map(({ id: _id, ...row }) => row),
    };
    db.update(schema.memories).set({ accessCount: 0, lastAccessedAt: null }).run();
    db.delete(schema.contextAssemblies).run();
    const chunks = [];
    for await (const chunk of brain.recallStream('deployment', options)) chunks.push(chunk);
    const streamWrites = {
      memories: db.select().from(schema.memories).all(),
      audits: db.select().from(schema.contextAssemblies).all().map(({ id: _id, ...row }) => row),
    };
    // REST sends recall directly; SSE serializes these same chunks verbatim.
    expect(JSON.stringify(recall)).toMatchSnapshot('recall JSON');
    // The recall_context MCP tool's existing text payload projection.
    expect(JSON.stringify({
      context: recall.context, memoriesUsed: recall.memories.length, latencyMs: recall.latencyMs,
      memories: recall.memories.map((m) => ({ id: m.id, type: m.type, score: m.score.toFixed(3), source: m.source })),
    })).toMatchSnapshot('MCP recall_context text');
    expect(chunks.map((chunk) => `event: ${chunk.phase}\ndata: ${JSON.stringify(chunk)}\n\n`).join(''))
      .toMatchSnapshot('SSE bytes');
    // Embeddings are unchanged fixture data, so avoid a large binary snapshot.
    for (const writes of [recallWrites, streamWrites]) {
      expect(JSON.stringify({
        memories: writes.memories.map(({ embedding: _embedding, ...row }) => row),
        audits: writes.audits.map(({ queryEmbedding: _embedding, ...row }) => row),
      })).toMatchSnapshot('writes');
    }
  },
);

it('explains ranks, section positions, exact offsets and budget omissions without any writes', async () => {
  const db = getDb();
  const before = db.select().from(schema.memories).all();
  const audits = db.select().from(schema.contextAssemblies).all();
  const changes = db.get(sql`SELECT total_changes() AS n`);
  const explanation = await brain.explainRecall('deployment', { maxTokens: 20 });
  expect(db.select().from(schema.memories).all()).toEqual(before);
  expect(db.select().from(schema.contextAssemblies).all()).toEqual(audits);
  expect(db.get(sql`SELECT total_changes() AS n`)).toEqual(changes);
  expect(explanation.candidates).toBe(5);
  expect(explanation.items.map((item) => item.rank)).toEqual([1, 2, 3, 4, 5]);
  expect(explanation.items.find((item) => item.id === 'large-0002')).toMatchObject({
    included: false, reason: 'over_budget', position: null, offset: null,
  });
  expect(explanation.items.find((item) => item.id === 'graph-0005')).toMatchObject({ via: 'graph', similarity: 0.1 });
  expect(explanation.items.find((item) => item.id === 'known-0004')).toMatchObject({ chars: 0, tokens: 0, included: true });
  const included = explanation.items.filter((item) => item.included);
  const ordered = [...included].sort((a, b) => a.position! - b.position!);
  expect(ordered.map((item) => item.id)).toEqual(['known-0004', 'graph-0005', 'skill-0003', 'event-0001']);
  expect(ordered.map((item) => item.position)).toEqual([1, 2, 3, 4]);
  for (const item of ordered) {
    expect(explanation.context.slice(item.offset!)).toMatch(new RegExp(`^• \\[${item.id.slice(0, 8)}`));
    expect(item.tokens).toBe(Math.ceil(item.chars / 4));
  }
  expect(explanation.budget).toEqual({ maxTokens: 20, usedTokens: Math.ceil(included.reduce((n, item) => n + item.chars, 0) / 4) });
  expect(explanation.context).toBe((await brain.recall('deployment', { maxTokens: 20 })).context);
});

it('preserves the top-memory exception and returns an empty explanation for no matches', async () => {
  const explanation = await brain.explainRecall('deployment', { maxTokens: 1 });
  expect(explanation.items[0]).toMatchObject({ included: true, rank: 1, position: 1 });
  expect(explanation.budget.usedTokens).toBeGreaterThan(1);
  expect(await brain.explainRecall('deployment', { threshold: 1.1 })).toEqual({
    context: '', latencyMs: 0, budget: { maxTokens: 2000, usedTokens: 0 }, items: [], candidates: 0,
  });
});

it('does not call recall hooks; normal recall still does', async () => {
  const hook = vi.spyOn(brain.getPluginRegistry(), 'runHook');
  await brain.explainRecall('deployment');
  expect(hook).not.toHaveBeenCalled();
  await brain.recall('deployment');
  expect(hook).toHaveBeenCalledWith('onRecall', expect.objectContaining({ query: 'deployment', memoriesUsed: 5 }));
  hook.mockRestore();
});

it.each([false, true])('uses the same hybridSearch=%s configuration as recall', async (hybridSearch) => {
  brain.shutdown();
  brain = new NeuralBrain({ dbPath: join(directory, 'test.db'), hybridSearch });
  await brain.initialize();
  const retrieval = vi.spyOn(hybrid, 'hybridSearch');
  const explanation = await brain.explainRecall('deployment');
  const recall = await brain.recall('deployment');
  expect(retrieval).toHaveBeenCalledTimes(hybridSearch ? 2 : 0);
  expect(explanation.context).toBe(recall.context);
  expect(explanation.items.filter((item) => item.included).map(({ id, score, similarity }) => ({ id, score, similarity })))
    .toEqual(recall.memories.map(({ id, score, similarity }) => ({ id, score, similarity })));
  retrieval.mockRestore();
});
