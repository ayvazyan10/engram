/**
 * mergePolicy() validation.
 *
 * mergePolicy used to spread whatever it was handed straight over the
 * defaults, so a policy that could never work reached the engine intact and
 * only failed later, from inside a sweep:
 *
 *   - a protection rule without a callable `predicate` (everything JSON can
 *     express) threw "rule.predicate is not a function" on every sweep from
 *     then on, because DecayEngine.isProtected() calls it per memory;
 *   - a fractional `batchSize` reached the SQL LIMIT clause and produced
 *     SQLITE_MISMATCH.
 *
 * Both are rejected at merge time now, so a bad policy from any caller — REST,
 * MCP, CLI, an embedder — fails loudly at the point it is set and the engine
 * keeps the policy it already had.
 */

import { describe, it, expect } from 'vitest';
import { mergePolicy, DEFAULT_DECAY_POLICY } from '../DecayPolicy.js';

describe('mergePolicy — protection rule validation', () => {
  it('rejects a rule with no predicate', () => {
    expect(() => mergePolicy({ protectionRules: [{ name: 'x' } as never] })).toThrow(
      /predicate/i
    );
  });

  it('rejects a rule whose predicate is not callable', () => {
    expect(() =>
      mergePolicy({ protectionRules: [{ name: 'x', predicate: 'nope' } as never] })
    ).toThrow(/predicate/i);
  });

  it('rejects a rule with no name', () => {
    expect(() =>
      mergePolicy({ protectionRules: [{ predicate: () => true } as never] })
    ).toThrow(/name/i);
  });

  it('rejects a non-object rule', () => {
    expect(() => mergePolicy({ protectionRules: ['pinned' as never] })).toThrow(/rule/i);
  });

  it('rejects protectionRules that is not an array', () => {
    expect(() => mergePolicy({ protectionRules: {} as never })).toThrow(/protectionRules/i);
  });

  it('still accepts a well-formed custom rule', () => {
    const merged = mergePolicy({
      protectionRules: [{ name: 'always-protect', predicate: () => true }],
    });
    expect(merged.protectionRules).toHaveLength(1);
    expect(merged.protectionRules[0]!.predicate({} as never)).toBe(true);
  });

  it('keeps the defaults when protectionRules is omitted', () => {
    expect(mergePolicy({}).protectionRules).toHaveLength(
      DEFAULT_DECAY_POLICY.protectionRules.length
    );
  });
});

describe('mergePolicy — numeric validation', () => {
  it('rejects a fractional batchSize', () => {
    expect(() => mergePolicy({ batchSize: 1.5 })).toThrow(/batchSize/);
  });

  it('rejects a batchSize below 1', () => {
    expect(() => mergePolicy({ batchSize: 0 })).toThrow(/batchSize/);
  });

  it('rejects a NaN halfLifeDays', () => {
    expect(() => mergePolicy({ halfLifeDays: Number.NaN })).toThrow(/halfLifeDays/);
  });

  it('rejects a non-positive halfLifeDays', () => {
    expect(() => mergePolicy({ halfLifeDays: 0 })).toThrow(/halfLifeDays/);
  });

  it('rejects an archiveThreshold outside 0..1', () => {
    expect(() => mergePolicy({ archiveThreshold: 1.5 })).toThrow(/archiveThreshold/);
  });

  it('rejects a negative decayIntervalMs', () => {
    expect(() => mergePolicy({ decayIntervalMs: -1 })).toThrow(/decayIntervalMs/);
  });

  it('rejects an importanceFloor outside 0..1', () => {
    expect(() => mergePolicy({ importanceFloor: -0.5 })).toThrow(/importanceFloor/);
  });

  it('rejects a fractional consolidation.minClusterSize', () => {
    expect(() =>
      mergePolicy({ consolidation: { minClusterSize: 2.5 } as never })
    ).toThrow(/minClusterSize/);
  });

  it('rejects a consolidation.similarityThreshold outside 0..1', () => {
    expect(() =>
      mergePolicy({ consolidation: { similarityThreshold: 2 } as never })
    ).toThrow(/similarityThreshold/);
  });

  it('accepts the documented valid ranges', () => {
    const merged = mergePolicy({
      halfLifeDays: 14,
      archiveThreshold: 0,
      decayIntervalMs: 0,
      batchSize: 1,
      importanceDecayRate: 1,
      importanceFloor: 1,
      consolidation: { minClusterSize: 2, similarityThreshold: 0.9 } as never,
    });
    expect(merged.batchSize).toBe(1);
    expect(merged.decayIntervalMs).toBe(0);
    expect(merged.consolidation.minClusterSize).toBe(2);
    expect(merged.consolidation.enabled).toBe(true); // untouched default
  });
});
