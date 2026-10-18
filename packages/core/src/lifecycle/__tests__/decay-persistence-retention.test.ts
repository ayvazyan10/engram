import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { NeuralBrain } from '../../NeuralBrain.ts';
import { closeDb, getDb, schema } from '../../db/index.ts';

let directory: string;
let dbPath: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'engram-decay-regression-'));
  dbPath = join(directory, 'test.db');
});

afterEach(() => {
  closeDb();
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

it('shares persisted policy across readers, external writes and restart, preserving nested updates', async () => {
  const writer = new NeuralBrain({ dbPath });
  const reader = new NeuralBrain({ dbPath });
  await writer.initialize();
  await reader.initialize();
  const consolidation = { enabled: true, minClusterSize: 8, similarityThreshold: 0.9, minEpisodicAgeMs: 1234 };
  writer.updateDecayPolicy({ halfLifeDays: 21, consolidation });
  expect.soft(reader.getDecayPolicy().halfLifeDays).toBe(21);
  reader.updateDecayPolicy({ consolidation: { enabled: false } });
  expect.soft(writer.getDecayPolicy().consolidation).toEqual({ ...consolidation, enabled: false });

  // A separate SQLite connection represents a write from another process.
  const external = new Database(dbPath);
  try {
    external.prepare('INSERT INTO local_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run('decay_policy', JSON.stringify({ halfLifeDays: 31, archiveThreshold: 0,
        consolidation: { ...consolidation, enabled: false } }));
    getDb().insert(schema.memories).values({ id: 'old', type: 'episodic', content: 'old',
      importance: 0.1, createdAt: '2000-01-01T00:00:00.000Z' }).run();
    expect.soft((await writer.runDecaySweep(true)).archivedCount).toBe(0);
    expect.soft(writer.getDecayPolicy().halfLifeDays).toBe(31);
    writer.updateDecayPolicy({ batchSize: 17 });
    expect.soft(writer.getDecayPolicy().halfLifeDays).toBe(31);
    expect(() => writer.updateDecayPolicy({ batchSize: 1.5 })).toThrow(/batchSize/);
  } finally {
    external.close();
  }
  closeDb();
  const restarted = new NeuralBrain({ dbPath });
  await restarted.initialize();
  expect.soft(restarted.getDecayPolicy()).toMatchObject({ halfLifeDays: 31, batchSize: 17,
    consolidation: { ...consolidation, enabled: false } });
  expect(restarted.getDecayPolicy().protectionRules.every(rule => typeof rule.predicate === 'function')).toBe(true);
});

it('prunes old context assemblies on real sweeps and exact memory references on forget and decay', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-18T12:00:00.000Z'));
  const brain = new NeuralBrain({ dbPath, decayPolicy: {
    protectionRules: [], consolidation: { enabled: false, minClusterSize: 3, similarityThreshold: 0.6, minEpisodicAgeMs: 0 },
  } });
  await brain.initialize();
  const db = getDb();
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
  db.insert(schema.memories).values(['forgotten', 'decayed', 'decayed-suffix'].map(id => ({
    id, type: 'episodic' as const, content: id, importance: 0.5,
    createdAt: id === 'decayed' ? '2026-01-01T00:00:00.000Z' : now, updatedAt: now,
  }))).run();
  const logs = [
    { id: 'forget-log', memoryIds: ['forgotten', 'decayed-suffix'], createdAt: now },
    { id: 'decay-log', memoryIds: ['decayed'], createdAt: now },
    { id: 'keep-log', memoryIds: ['decayed-suffix'], createdAt: now },
    { id: 'expired', memoryIds: [], createdAt: new Date(Date.parse(cutoff) - 1).toISOString() },
    { id: 'boundary', memoryIds: [], createdAt: cutoff },
  ];
  db.insert(schema.contextAssemblies).values(logs.map(({ memoryIds, ...row }) => ({
    ...row, query: 'private query', queryEmbedding: Buffer.from([1, 2]),
    assembledContext: JSON.stringify(memoryIds.map(memoryId => ({ memoryId, score: 1, type: 'episodic' }))),
  }))).run();
  await brain.runDecaySweep(true);
  expect(db.select().from(schema.contextAssemblies).all()).toHaveLength(5);
  await brain.forget('forgotten');
  expect.soft(db.select().from(schema.contextAssemblies).all().map(row => row.id)).not.toContain('forget-log');
  const result = await brain.runDecaySweep();
  expect(result.archivedIds).toEqual(['decayed']);
  expect(db.select().from(schema.contextAssemblies).all().map(row => row.id).sort()).toEqual(['boundary', 'keep-log']);
});
