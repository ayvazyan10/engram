/**
 * Regression tests for ReflectionConfig validation.
 *
 * `updateConfig` was a bare `{ ...this.config, ...partial }`: it merged whatever
 * it was handed. The REST route has since been locked down, but that made the
 * HTTP schema the ONLY guard, and the MCP tools and every library consumer of
 * `@engram-ai-memory/core` reach these engines in-process without passing it.
 *
 * The reported corruption — `PUT /api/reflection/config '"just a string"'`
 * returning 200 with the config then holding keys "0": "j", "1": "u", … —
 * is a plain spread of a string, and is still reachable from any in-process
 * caller.
 *
 * `types` is the sharp one: buildTasks() does `this.config.types.map(...)`, so a
 * non-array is accepted here and throws much later from inside
 * getReflectionTasks(), taking the MCP `request_reflection` tool with it.
 */

import { describe, it, expect } from 'vitest';
import { ReflectionEngine, DEFAULT_REFLECTION_CONFIG } from '../ReflectionEngine.js';
import type { ReflectionConfig } from '../ReflectionEngine.js';
import type { Memory } from '../../db/schema.js';

/** Cast helper for the malformed inputs an in-process caller can actually pass. */
function malformed(value: unknown): Partial<ReflectionConfig> {
  return value as Partial<ReflectionConfig>;
}

function fakeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: Math.random().toString(36).slice(2),
    type: 'semantic',
    content: 'A memory worth reflecting on',
    importance: 0.9,
    createdAt: new Date().toISOString(),
    source: 'test',
    archivedAt: null,
    ...overrides,
  } as Memory;
}

describe('ReflectionEngine config validation — updateConfig', () => {
  it('rejects a bare string instead of spreading it into index keys', () => {
    const engine = new ReflectionEngine();
    expect(() => engine.updateConfig(malformed('just a string'))).toThrow(/reflection config/i);

    const config = engine.getConfig();
    expect(config).toEqual(DEFAULT_REFLECTION_CONFIG);
    expect(Object.keys(config)).not.toContain('0');
  });

  it('rejects unknown keys rather than merging them through', () => {
    const engine = new ReflectionEngine();
    expect(() => engine.updateConfig(malformed({ storeCountThreshold: 5, nonsense: true })))
      .toThrow(/nonsense/);
    // Rejected wholesale — the valid field in the same object is not applied.
    expect(engine.getConfig().storeCountThreshold).toBe(DEFAULT_REFLECTION_CONFIG.storeCountThreshold);
  });

  it('rejects null and array payloads', () => {
    const engine = new ReflectionEngine();
    expect(() => engine.updateConfig(malformed(null))).toThrow(/reflection config/i);
    expect(() => engine.updateConfig(malformed(['pattern']))).toThrow(/reflection config/i);
  });

  describe('types', () => {
    it('rejects a non-array, so buildTasks cannot throw later', () => {
      const engine = new ReflectionEngine();
      expect(() => engine.updateConfig(malformed({ types: 'pattern' }))).toThrow(/types/);

      // The engine still works — this is the MCP request_reflection path.
      const tasks = engine.buildTasks([fakeMemory(), fakeMemory(), fakeMemory()]);
      expect(tasks.length).toBeGreaterThan(0);
    });

    it('rejects an unknown reflection type', () => {
      const engine = new ReflectionEngine();
      expect(() => engine.updateConfig(malformed({ types: ['pattern', 'wat'] }))).toThrow(/wat/);
    });

    it('rejects an empty types array', () => {
      const engine = new ReflectionEngine();
      expect(() => engine.updateConfig({ types: [] })).toThrow(/types/);
    });

    it('accepts a valid subset', () => {
      const engine = new ReflectionEngine();
      engine.updateConfig({ types: ['pattern', 'trend'] });
      expect(engine.getConfig().types).toEqual(['pattern', 'trend']);
    });
  });

  describe('numeric fields', () => {
    it('rejects a fractional maxMemoriesToAnalyze — it lands in a SQL LIMIT', () => {
      const engine = new ReflectionEngine();
      expect(() => engine.updateConfig({ maxMemoriesToAnalyze: 12.5 })).toThrow(/maxMemoriesToAnalyze/);
    });

    it('rejects a non-positive maxMemoriesToAnalyze', () => {
      const engine = new ReflectionEngine();
      expect(() => engine.updateConfig({ maxMemoriesToAnalyze: 0 })).toThrow(/maxMemoriesToAnalyze/);
      expect(() => engine.updateConfig({ maxMemoriesToAnalyze: -5 })).toThrow(/maxMemoriesToAnalyze/);
    });

    it('rejects a non-positive or fractional storeCountThreshold', () => {
      const engine = new ReflectionEngine();
      expect(() => engine.updateConfig({ storeCountThreshold: 0 })).toThrow(/storeCountThreshold/);
      expect(() => engine.updateConfig({ storeCountThreshold: 1.5 })).toThrow(/storeCountThreshold/);
    });

    it('rejects minImportance outside [0, 1] and non-finite values', () => {
      const engine = new ReflectionEngine();
      expect(() => engine.updateConfig({ minImportance: -0.1 })).toThrow(/minImportance/);
      expect(() => engine.updateConfig({ minImportance: 1.5 })).toThrow(/minImportance/);
      expect(() => engine.updateConfig({ minImportance: Number.NaN })).toThrow(/minImportance/);
    });

    it('accepts the bounds themselves', () => {
      const engine = new ReflectionEngine();
      engine.updateConfig({ minImportance: 0, maxMemoriesToAnalyze: 1, storeCountThreshold: 1 });
      expect(engine.getConfig().minImportance).toBe(0);
      engine.updateConfig({ minImportance: 1 });
      expect(engine.getConfig().minImportance).toBe(1);
    });
  });

  it('rejects non-boolean enabled / triggerOnDecay', () => {
    const engine = new ReflectionEngine();
    expect(() => engine.updateConfig(malformed({ enabled: 'yes' }))).toThrow(/enabled/);
    expect(() => engine.updateConfig(malformed({ triggerOnDecay: 1 }))).toThrow(/triggerOnDecay/);
  });

  it('leaves the previous config completely intact after a rejected update', () => {
    const engine = new ReflectionEngine({ storeCountThreshold: 7, types: ['trend'] });
    const before = engine.getConfig();

    expect(() => engine.updateConfig(malformed({ types: 42 }))).toThrow();
    expect(() => engine.updateConfig(malformed({ bogus: 1 }))).toThrow();

    expect(engine.getConfig()).toEqual(before);
  });
});

describe('ReflectionEngine config validation — constructor', () => {
  it('rejects a malformed config at construction, not on first use', () => {
    expect(() => new ReflectionEngine(malformed({ types: 'pattern' }))).toThrow(/types/);
    expect(() => new ReflectionEngine(malformed({ bogus: true }))).toThrow(/bogus/);
    expect(() => new ReflectionEngine({ maxMemoriesToAnalyze: 0 })).toThrow(/maxMemoriesToAnalyze/);
  });

  it('still accepts no config at all, and a valid partial', () => {
    expect(new ReflectionEngine().getConfig()).toEqual(DEFAULT_REFLECTION_CONFIG);
    expect(new ReflectionEngine({ minImportance: 0.5 }).getConfig().minImportance).toBe(0.5);
  });
});
