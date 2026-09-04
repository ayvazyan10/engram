/**
 * Regression tests for ContradictionConfig validation.
 *
 * Like ReflectionEngine, `updateConfig` was a bare `{ ...this.config,
 * ...partial }`. The REST route now validates, but the MCP tools and any
 * library consumer of `@engram-ai-memory/core` call this in-process and never
 * touch that schema — so a malformed config could still reach the detector,
 * exactly as a malformed policy could once reach DecayEngine.
 */

import { describe, it, expect } from 'vitest';
import {
  ContradictionDetector,
  DEFAULT_CONTRADICTION_CONFIG,
} from '../ContradictionDetector.js';
import type { ContradictionConfig } from '../ContradictionDetector.js';

function malformed(value: unknown): Partial<ContradictionConfig> {
  return value as Partial<ContradictionConfig>;
}

describe('ContradictionDetector config validation — updateConfig', () => {
  it('rejects a bare string instead of spreading it into index keys', () => {
    const detector = new ContradictionDetector();
    expect(() => detector.updateConfig(malformed('just a string'))).toThrow(/contradiction config/i);

    const config = detector.getConfig();
    expect(config).toEqual(DEFAULT_CONTRADICTION_CONFIG);
    expect(Object.keys(config)).not.toContain('0');
  });

  it('rejects unknown keys rather than merging them through', () => {
    const detector = new ContradictionDetector();
    expect(() => detector.updateConfig(malformed({ autoResolve: true, nonsense: 1 })))
      .toThrow(/nonsense/);
    expect(detector.getConfig().autoResolve).toBe(DEFAULT_CONTRADICTION_CONFIG.autoResolve);
  });

  it('rejects null and array payloads', () => {
    const detector = new ContradictionDetector();
    expect(() => detector.updateConfig(malformed(null))).toThrow(/contradiction config/i);
    expect(() => detector.updateConfig(malformed([1, 2]))).toThrow(/contradiction config/i);
  });

  it('rejects an unknown resolution strategy', () => {
    const detector = new ContradictionDetector();
    expect(() => detector.updateConfig(malformed({ defaultStrategy: 'keep_shiniest' })))
      .toThrow(/defaultStrategy/);
    expect(() => detector.updateConfig(malformed({ defaultStrategy: 3 })))
      .toThrow(/defaultStrategy/);
  });

  it('accepts every documented resolution strategy', () => {
    const detector = new ContradictionDetector();
    for (const strategy of ['keep_newest', 'keep_oldest', 'keep_important', 'keep_both', 'manual'] as const) {
      detector.updateConfig({ defaultStrategy: strategy });
      expect(detector.getConfig().defaultStrategy).toBe(strategy);
    }
  });

  it('rejects thresholds outside [0, 1] and non-finite values', () => {
    const detector = new ContradictionDetector();
    expect(() => detector.updateConfig({ similarityThreshold: -0.1 })).toThrow(/similarityThreshold/);
    expect(() => detector.updateConfig({ similarityThreshold: 1.2 })).toThrow(/similarityThreshold/);
    expect(() => detector.updateConfig({ confidenceThreshold: Number.NaN })).toThrow(/confidenceThreshold/);
    expect(() => detector.updateConfig({ confidenceThreshold: Infinity })).toThrow(/confidenceThreshold/);
  });

  it('rejects a fractional or non-positive maxCandidates — it lands in a topK', () => {
    const detector = new ContradictionDetector();
    expect(() => detector.updateConfig({ maxCandidates: 4.5 })).toThrow(/maxCandidates/);
    expect(() => detector.updateConfig({ maxCandidates: 0 })).toThrow(/maxCandidates/);
    expect(() => detector.updateConfig({ maxCandidates: -3 })).toThrow(/maxCandidates/);
  });

  it('rejects non-boolean enabled / autoResolve', () => {
    const detector = new ContradictionDetector();
    expect(() => detector.updateConfig(malformed({ enabled: 'true' }))).toThrow(/enabled/);
    expect(() => detector.updateConfig(malformed({ autoResolve: 'yes' }))).toThrow(/autoResolve/);
  });

  it('leaves the previous config completely intact after a rejected update', () => {
    const detector = new ContradictionDetector({ similarityThreshold: 0.5, autoResolve: true });
    const before = detector.getConfig();

    expect(() => detector.updateConfig(malformed({ defaultStrategy: 'nope' }))).toThrow();
    expect(() => detector.updateConfig(malformed({ bogus: 1 }))).toThrow();

    expect(detector.getConfig()).toEqual(before);
  });

  it('applies a valid partial update', () => {
    const detector = new ContradictionDetector();
    detector.updateConfig({ autoResolve: true, similarityThreshold: 0.5 });
    expect(detector.getConfig().autoResolve).toBe(true);
    expect(detector.getConfig().similarityThreshold).toBe(0.5);
    // Untouched fields keep their previous values.
    expect(detector.getConfig().maxCandidates).toBe(DEFAULT_CONTRADICTION_CONFIG.maxCandidates);
  });
});

describe('ContradictionDetector config validation — constructor', () => {
  it('rejects a malformed config at construction, not on first check', () => {
    expect(() => new ContradictionDetector(malformed({ defaultStrategy: 'nope' }))).toThrow(/defaultStrategy/);
    expect(() => new ContradictionDetector(malformed({ bogus: true }))).toThrow(/bogus/);
    expect(() => new ContradictionDetector({ maxCandidates: 0 })).toThrow(/maxCandidates/);
  });

  it('still accepts no config at all, and a valid partial', () => {
    expect(new ContradictionDetector().getConfig()).toEqual(DEFAULT_CONTRADICTION_CONFIG);
    expect(new ContradictionDetector({ maxCandidates: 5 }).getConfig().maxCandidates).toBe(5);
  });
});
