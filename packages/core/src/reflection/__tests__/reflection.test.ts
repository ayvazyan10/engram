import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { ReflectionEngine, DEFAULT_REFLECTION_CONFIG } from '../ReflectionEngine.js';
import type { Memory } from '../../db/schema.js';
import { NeuralBrain } from '../../NeuralBrain.js';
import { closeDb } from '../../db/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../db/migrations/0000_cynical_marauders.sql'),
  'utf-8',
);

function createTestDb(): string {
  const dbPath = path.join(__dirname, `test-reflection-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  const sqlite = new Database(dbPath);
  for (const stmt of MIGRATION_SQL.split('--> statement-breakpoint')) {
    const trimmed = stmt.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
  sqlite.close();
  return dbPath;
}

function makeFakeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: `mem-${Math.random().toString(36).slice(2)}`,
    type: 'semantic',
    content: 'Test memory content about TypeScript development',
    summary: null,
    embedding: null,
    embeddingDim: 384,
    embeddingModel: null,
    importance: 0.6,
    confidence: 1.0,
    accessCount: 1,
    lastAccessedAt: new Date().toISOString(),
    eventAt: null,
    sessionId: null,
    source: 'test',
    concept: null,
    triggerPattern: null,
    actionPattern: null,
    namespace: null,
    metadata: '{}',
    tags: '[]',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    archivedAt: null,
    ...overrides,
  };
}

describe('ReflectionEngine', () => {
  describe('notifyStore', () => {
    it('returns true after threshold reached', () => {
      const engine = new ReflectionEngine({ storeCountThreshold: 3 });
      expect(engine.notifyStore()).toBe(false);
      expect(engine.notifyStore()).toBe(false);
      expect(engine.notifyStore()).toBe(true);
      expect(engine.getCounter()).toBe(0);
    });

    it('returns false when disabled', () => {
      const engine = new ReflectionEngine({ enabled: false, storeCountThreshold: 1 });
      expect(engine.notifyStore()).toBe(false);
    });

    it('marks reflection as due once threshold is reached', () => {
      const engine = new ReflectionEngine({ storeCountThreshold: 2 });
      expect(engine.isReflectionDue()).toBe(false);
      engine.notifyStore();
      expect(engine.isReflectionDue()).toBe(false);
      engine.notifyStore();
      expect(engine.isReflectionDue()).toBe(true);
    });
  });

  describe('notifyDecay', () => {
    it('returns true and marks due when triggerOnDecay is enabled', () => {
      const engine = new ReflectionEngine({ triggerOnDecay: true });
      expect(engine.notifyDecay()).toBe(true);
      expect(engine.isReflectionDue()).toBe(true);
    });

    it('returns false when triggerOnDecay is disabled', () => {
      const engine = new ReflectionEngine({ triggerOnDecay: false });
      expect(engine.notifyDecay()).toBe(false);
      expect(engine.isReflectionDue()).toBe(false);
    });

    it('returns false when engine is disabled', () => {
      const engine = new ReflectionEngine({ enabled: false });
      expect(engine.notifyDecay()).toBe(false);
    });
  });

  describe('status & pending', () => {
    it('getStatus reports counter, threshold, and due', () => {
      const engine = new ReflectionEngine({ storeCountThreshold: 5 });
      engine.notifyStore();
      const status = engine.getStatus();
      expect(status.enabled).toBe(true);
      expect(status.threshold).toBe(5);
      expect(status.counter).toBe(1);
      expect(status.due).toBe(false);
    });

    it('clearPending resets the due flag', () => {
      const engine = new ReflectionEngine({ triggerOnDecay: true });
      engine.notifyDecay();
      expect(engine.isReflectionDue()).toBe(true);
      engine.clearPending();
      expect(engine.isReflectionDue()).toBe(false);
    });
  });

  describe('buildTasks', () => {
    it('returns empty when too few qualifying memories', () => {
      const engine = new ReflectionEngine();
      expect(engine.buildTasks([makeFakeMemory()])).toEqual([]);
    });

    it('skips low importance memories', () => {
      const engine = new ReflectionEngine({ minImportance: 0.8 });
      const memories = [
        makeFakeMemory({ importance: 0.2 }),
        makeFakeMemory({ importance: 0.3 }),
        makeFakeMemory({ importance: 0.1 }),
      ];
      expect(engine.buildTasks(memories)).toEqual([]);
    });

    it('builds one task per configured type with a prompt and related ids', () => {
      const engine = new ReflectionEngine({ types: ['pattern', 'trend'] });
      const memories = Array.from({ length: 5 }, () => makeFakeMemory());
      const tasks = engine.buildTasks(memories);

      expect(tasks).toHaveLength(2);
      expect(tasks.map((t) => t.type)).toEqual(['pattern', 'trend']);
      expect(tasks[0]!.prompt).toContain('TASK:');
      expect(tasks[0]!.prompt.length).toBeGreaterThan(50);
      expect(tasks[0]!.relatedMemoryIds.length).toBeGreaterThan(0);
      expect(tasks[0]!.stats.total).toBe(5);
    });

    it('never calls out to any LLM (no async, deterministic)', () => {
      const engine = new ReflectionEngine({ types: ['pattern'] });
      const memories = Array.from({ length: 3 }, () => makeFakeMemory());
      const tasks = engine.buildTasks(memories);
      // Same inputs → identical prompt (pure function of memories)
      expect(engine.buildTasks(memories)[0]!.prompt).toBe(tasks[0]!.prompt);
    });
  });

  describe('buildResult', () => {
    it('returns null for empty insight', () => {
      const engine = new ReflectionEngine();
      expect(engine.buildResult('pattern', '')).toBeNull();
      expect(engine.buildResult('pattern', '   ')).toBeNull();
    });

    it('returns null for NO_INSIGHT responses', () => {
      const engine = new ReflectionEngine();
      expect(engine.buildResult('pattern', 'NO_INSIGHT')).toBeNull();
      expect(engine.buildResult('trend', 'Sorry, NO_INSIGHT here')).toBeNull();
    });

    it('builds a result with computed confidence when none supplied', () => {
      const engine = new ReflectionEngine();
      const result = engine.buildResult('pattern', 'Users frequently work with TypeScript in the evening.', ['a', 'b']);
      expect(result).not.toBeNull();
      expect(result!.type).toBe('pattern');
      expect(result!.insight).toBe('Users frequently work with TypeScript in the evening.');
      expect(result!.confidence).toBeGreaterThan(0);
      expect(result!.confidence).toBeLessThanOrEqual(0.95);
      expect(result!.relatedMemoryIds).toEqual(['a', 'b']);
      expect(result!.id).toBeTruthy();
    });

    it('honours an AI-supplied confidence', () => {
      const engine = new ReflectionEngine();
      const result = engine.buildResult('trend', 'A trend.', [], 0.82);
      expect(result!.confidence).toBe(0.82);
    });
  });

  describe('config management', () => {
    it('uses defaults', () => {
      const engine = new ReflectionEngine();
      const config = engine.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.storeCountThreshold).toBe(DEFAULT_REFLECTION_CONFIG.storeCountThreshold);
    });

    it('updateConfig merges correctly', () => {
      const engine = new ReflectionEngine();
      engine.updateConfig({ storeCountThreshold: 20 });
      expect(engine.getConfig().storeCountThreshold).toBe(20);
      expect(engine.getConfig().enabled).toBe(true);
    });

    it('resetCounter resets to zero', () => {
      const engine = new ReflectionEngine({ storeCountThreshold: 100 });
      engine.notifyStore();
      engine.notifyStore();
      expect(engine.getCounter()).toBe(2);
      engine.resetCounter();
      expect(engine.getCounter()).toBe(0);
    });
  });
});

describe('NeuralBrain reflection integration', () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTestDb();
  });

  afterEach(async () => {
    await closeDb();
    try { fs.unlinkSync(dbPath); } catch {}
    try { fs.unlinkSync(dbPath + '-shm'); } catch {}
    try { fs.unlinkSync(dbPath + '-wal'); } catch {}
    try { fs.unlinkSync(dbPath + '.index'); } catch {}
  });

  it('getReflectionTasks() returns empty with too few memories', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    await brain.store({ content: 'Only one memory', type: 'semantic', importance: 0.6 });

    const tasks = await brain.getReflectionTasks();
    expect(tasks).toEqual([]);
  });

  it('getReflectionTasks() returns a task per type once enough memories exist', async () => {
    const brain = new NeuralBrain({ dbPath, reflection: { types: ['pattern', 'trend'] } });
    await brain.initialize();

    for (let i = 0; i < 5; i++) {
      await brain.store({ content: `Memory about topic ${i}`, type: 'semantic', importance: 0.6 });
    }

    const tasks = await brain.getReflectionTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks[0]!.prompt).toContain('TASK:');
  });

  it('storeReflection() persists an AI insight as a reflection-sourced memory', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const stored = await brain.storeReflection({
      type: 'pattern',
      insight: 'The user works in focused evening blocks.',
      relatedMemoryIds: [],
      confidence: 0.7,
    });

    expect(stored).not.toBeNull();
    expect(stored!.source).toBe('reflection');

    const reflections = await brain.getReflections();
    expect(reflections).toHaveLength(1);
    expect(reflections[0]!.content).toBe('The user works in focused evening blocks.');
    const meta = JSON.parse(reflections[0]!.metadata ?? '{}');
    expect(meta.reflectionType).toBe('pattern');
    expect(meta.confidence).toBe(0.7);
  });

  it('storeReflection() returns null for NO_INSIGHT and stores nothing', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    const stored = await brain.storeReflection({ type: 'trend', insight: 'NO_INSIGHT' });
    expect(stored).toBeNull();

    const reflections = await brain.getReflections();
    expect(reflections).toHaveLength(0);
  });

  it('getReflections() returns only reflection-sourced memories', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    await brain.storeReflection({ type: 'pattern', insight: 'A reflection insight' });
    await brain.store({ content: 'Regular memory', type: 'semantic', source: 'test' });

    const reflections = await brain.getReflections();
    expect(reflections).toHaveLength(1);
    expect(reflections[0]!.source).toBe('reflection');
  });

  it('getReflectionEngine() exposes the engine', () => {
    const brain = new NeuralBrain({ dbPath });
    const engine = brain.getReflectionEngine();
    expect(engine).toBeInstanceOf(ReflectionEngine);
    expect(engine.getConfig().enabled).toBe(true);
  });
});
