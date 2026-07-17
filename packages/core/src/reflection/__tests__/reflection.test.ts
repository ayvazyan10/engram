import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

import { ReflectionEngine, DEFAULT_REFLECTION_CONFIG } from '../ReflectionEngine.js';
import type { ReflectionConfig } from '../ReflectionEngine.js';
import { NullProvider } from '../../llm/NullProvider.js';
import type { LLMProvider, LLMCompletionResult } from '../../llm/LLMProvider.js';
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

function createMockLLM(response: string): LLMProvider {
  return {
    id: 'mock',
    isAvailable: vi.fn().mockResolvedValue(true),
    complete: vi.fn().mockResolvedValue({
      content: response,
      inputTokens: 100,
      outputTokens: 20,
      model: 'mock',
      durationMs: 50,
    } satisfies LLMCompletionResult),
    estimateTokens: (text: string) => Math.ceil(text.length / 4),
    getModel: () => 'mock',
    getContextWindow: () => 8192,
  };
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
      const engine = new ReflectionEngine(new NullProvider(), { storeCountThreshold: 3 });
      expect(engine.notifyStore()).toBe(false);
      expect(engine.notifyStore()).toBe(false);
      expect(engine.notifyStore()).toBe(true);
      expect(engine.getCounter()).toBe(0);
    });

    it('returns false when disabled', () => {
      const engine = new ReflectionEngine(new NullProvider(), { enabled: false, storeCountThreshold: 1 });
      expect(engine.notifyStore()).toBe(false);
    });
  });

  describe('notifyDecay', () => {
    it('returns true when triggerOnDecay is enabled', () => {
      const engine = new ReflectionEngine(new NullProvider(), { triggerOnDecay: true });
      expect(engine.notifyDecay()).toBe(true);
    });

    it('returns false when triggerOnDecay is disabled', () => {
      const engine = new ReflectionEngine(new NullProvider(), { triggerOnDecay: false });
      expect(engine.notifyDecay()).toBe(false);
    });

    it('returns false when engine is disabled', () => {
      const engine = new ReflectionEngine(new NullProvider(), { enabled: false });
      expect(engine.notifyDecay()).toBe(false);
    });
  });

  describe('reflect', () => {
    it('returns empty when LLM is not available', async () => {
      const engine = new ReflectionEngine(new NullProvider());
      const memories = [makeFakeMemory(), makeFakeMemory(), makeFakeMemory()];
      const results = await engine.reflect(memories);
      expect(results).toEqual([]);
    });

    it('returns empty when too few memories', async () => {
      const llm = createMockLLM('Some insight');
      const engine = new ReflectionEngine(llm);
      const results = await engine.reflect([makeFakeMemory()]);
      expect(results).toEqual([]);
    });

    it('skips low importance memories', async () => {
      const llm = createMockLLM('Some insight');
      const engine = new ReflectionEngine(llm, { minImportance: 0.8 });
      const memories = [
        makeFakeMemory({ importance: 0.2 }),
        makeFakeMemory({ importance: 0.3 }),
        makeFakeMemory({ importance: 0.1 }),
      ];
      const results = await engine.reflect(memories);
      expect(results).toEqual([]);
    });

    it('generates insights for all configured types', async () => {
      const llm = createMockLLM('Users frequently work with TypeScript in the evening.');
      const engine = new ReflectionEngine(llm, {
        types: ['pattern', 'trend'],
      });
      const memories = Array.from({ length: 5 }, () => makeFakeMemory());
      const results = await engine.reflect(memories);

      expect(results).toHaveLength(2);
      expect(results[0]!.type).toBe('pattern');
      expect(results[1]!.type).toBe('trend');
      expect(results[0]!.insight).toBe('Users frequently work with TypeScript in the evening.');
      expect(results[0]!.confidence).toBeGreaterThan(0);
      expect(results[0]!.relatedMemoryIds.length).toBeGreaterThan(0);
    });

    it('skips NO_INSIGHT responses', async () => {
      const llm = createMockLLM('NO_INSIGHT');
      const engine = new ReflectionEngine(llm, { types: ['pattern'] });
      const memories = Array.from({ length: 5 }, () => makeFakeMemory());
      const results = await engine.reflect(memories);
      expect(results).toEqual([]);
    });

    it('handles LLM errors gracefully', async () => {
      const llm = createMockLLM('');
      (llm.complete as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API down'));
      const engine = new ReflectionEngine(llm, { types: ['pattern'] });
      const memories = Array.from({ length: 5 }, () => makeFakeMemory());
      const results = await engine.reflect(memories);
      expect(results).toEqual([]);
    });
  });

  describe('config management', () => {
    it('uses defaults', () => {
      const engine = new ReflectionEngine(new NullProvider());
      const config = engine.getConfig();
      expect(config.enabled).toBe(true);
      expect(config.storeCountThreshold).toBe(DEFAULT_REFLECTION_CONFIG.storeCountThreshold);
    });

    it('updateConfig merges correctly', () => {
      const engine = new ReflectionEngine(new NullProvider());
      engine.updateConfig({ storeCountThreshold: 20 });
      expect(engine.getConfig().storeCountThreshold).toBe(20);
      expect(engine.getConfig().enabled).toBe(true);
    });

    it('resetCounter resets to zero', () => {
      const engine = new ReflectionEngine(new NullProvider(), { storeCountThreshold: 100 });
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

  it('reflect() returns empty with no LLM', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    for (let i = 0; i < 5; i++) {
      await brain.store({ content: `Memory about topic ${i}`, type: 'semantic' });
    }

    const results = await brain.reflect();
    expect(results).toEqual([]);
  });

  it('getReflections() returns reflection-sourced memories', async () => {
    const brain = new NeuralBrain({ dbPath });
    await brain.initialize();

    await brain.store({
      content: 'A reflection insight',
      type: 'semantic',
      source: 'reflection',
      tags: ['reflection', 'reflection:pattern'],
    });
    await brain.store({
      content: 'Regular memory',
      type: 'semantic',
      source: 'test',
    });

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
