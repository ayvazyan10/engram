import { describe, it, expect } from 'vitest';
import {
  CUT_ALPHA,
  DAY_MS,
  ageDays,
  dayCounts,
  describeNode,
  faultLines,
  honesty,
  lensAlpha,
  pickable,
  regionName,
  retentionAlpha,
  spanDays,
  type LensState,
} from '../lenses.js';
import { NOW, node, region } from './payload.js';

const base: LensState = { lens: 'meaning', cutDays: 30, now: NOW, hits: null, regionId: null };

describe('retention as strength', () => {
  it('draws a protected memory at full strength whatever its score', () => {
    expect(retentionAlpha({ retention: 0.0001, protected: true }, 0.05)).toBe(1);
  });

  it('fades the rest on a log scale, from full at 1 to faint at the archive threshold', () => {
    expect(retentionAlpha({ retention: 1, protected: false }, 0.05)).toBe(1);
    expect(retentionAlpha({ retention: 0.05, protected: false }, 0.05)).toBeCloseTo(0.3);
    expect(retentionAlpha({ retention: 0.01, protected: false }, 0.05)).toBeCloseTo(0.3);
    const mid = retentionAlpha({ retention: Math.sqrt(0.05), protected: false }, 0.05);
    expect(mid).toBeCloseTo(0.65);
    expect(retentionAlpha({ retention: 0.5, protected: false }, 0)).toBeCloseTo(0.3);
  });
});

describe('lensAlpha and pickable', () => {
  const created = NOW - 2 * DAY_MS;

  it('leaves a mark alone under Meaning', () => {
    expect(lensAlpha(node('a'), created, base)).toBe(1);
  });

  it('Time cuts memories older than the scrubber to a trace, and they cannot be picked', () => {
    const time = { ...base, lens: 'time' as const, cutDays: 1 };
    expect(lensAlpha(node('a'), created, time)).toBe(CUT_ALPHA);
    expect(pickable(created, time)).toBe(false);
    expect(pickable(created, { ...time, cutDays: 3 })).toBe(true);
    expect(pickable(created, base)).toBe(true);
  });

  it('Faults steps back what contradicts nothing; search and an open region step back the rest', () => {
    expect(lensAlpha(node('a'), created, { ...base, lens: 'faults' })).toBeCloseTo(0.3);
    expect(lensAlpha(node('a', { contradictCount: 2 }), created, { ...base, lens: 'faults' })).toBe(1);
    expect(lensAlpha(node('a'), created, { ...base, hits: new Set(['b']) })).toBeCloseTo(0.22);
    expect(lensAlpha(node('a'), created, { ...base, hits: new Set(['a']) })).toBe(1);
    expect(lensAlpha(node('a', { regionId: 'r2' }), created, { ...base, regionId: 'r1' })).toBeCloseTo(0.25);
  });

  it('does not draw a memory waiting out its archive undo', () => {
    expect(lensAlpha(node('a'), created, { ...base, hidden: new Set(['a']) })).toBe(0);
  });
});

describe('faultLines', () => {
  const at = new Map([
    ['a', 0],
    ['b', 1],
    ['c', 2],
  ]);
  const nodes = [{ regionId: 'r1' }, { regionId: 'r1' }, { regionId: 'r2' }];
  const edges: [string, string][] = [
    ['a', 'b'],
    ['b', 'c'],
    ['a', 'gone'],
  ];

  it('draws every line with both ends on the map', () => {
    expect(faultLines(edges, at, nodes, null, null)).toEqual([
      [0, 1],
      [1, 2],
    ]);
  });

  it('draws only the open memory’s lines, or the open region’s', () => {
    expect(faultLines(edges, at, nodes, 'c', null)).toEqual([[1, 2]]);
    expect(faultLines(edges, at, nodes, 'off-map', 'r2')).toEqual([[1, 2]]);
    expect(faultLines(edges, at, nodes, null, 'r1')).toHaveLength(2);
  });
});

describe('time', () => {
  const created = [NOW - 0.5 * DAY_MS, NOW - 1.5 * DAY_MS, NOW - 1.7 * DAY_MS, NOW - 40 * DAY_MS, 0];

  it('counts memories per day back from today', () => {
    expect(dayCounts(created, NOW, 3)).toEqual([1, 2, 0]);
    expect(ageDays(NOW + DAY_MS, NOW)).toBe(0);
  });

  it('spans back to the oldest memory, at least a week', () => {
    expect(spanDays(created, NOW)).toBe(40);
    expect(spanDays([NOW], NOW)).toBe(7);
  });
});

describe('words', () => {
  it('names a region by the reader’s rename, or the server’s name with a capital', () => {
    const r = region('r1', { name: 'sync · encryption' });
    expect(regionName(r, {})).toBe('Sync · encryption');
    expect(regionName(r, { r1: 'Cloud sync' })).toBe('Cloud sync');
  });

  it('says what the keyboard is on: type, region, words, and what matters about it', () => {
    expect(describeNode(node('a', { label: 'Sync is encrypted' }), 'Cloud sync')).toBe('Semantic, Cloud sync: Sync is encrypted');
    const long = node('b', { isReflection: true, protected: true, contradictCount: 2, label: 'x'.repeat(100) });
    const said = describeNode(long, null);
    expect(said.startsWith('Semantic reflection: ')).toBe(true);
    expect(said).toContain('…. protected, 2 contradictions.');
    expect(describeNode(node('c', { contradictCount: 1 }), null)).toContain('1 contradiction.');
  });

  it('says how far to trust a distance', () => {
    expect(honesty({ method: 'pca2+knn', explainedVariance: [0.23, 0.08] })).toContain('two axes keep 31%');
    expect(honesty({ method: 'fallback', explainedVariance: [0, 0] })).toContain('only a fallback');
  });
});
