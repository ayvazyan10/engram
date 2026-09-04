/**
 * The layout hash has to produce INDEPENDENT streams per salt.
 *
 * It did not. The salt was appended last (`id + ':' + salt`) and the finalizer
 * was a single `h ^= h >>> 15`, which does not avalanche — so two salts
 * differing only in their final character produced almost the same number. The
 * visible consequence was the "Clusters" view: x, y and z were each
 * `(idRandom(id, 'cloud-…') - 0.5) * s` with salts that differed in one
 * character, so every cloud rendered as a straight diagonal rod instead of a
 * cloud.
 *
 * These tests pin both halves of the fix — salt first, real avalanche — by
 * measuring the correlation of every salt pair, and keep the old
 * implementation around as a witness so the regression cannot quietly return.
 */

import { describe, it, expect } from 'vitest';
import { idRandom } from '../viewStore.js';

/** The pre-fix hash, kept only to prove the test can see the bug. */
function legacyIdRandom(id: string, salt: string): number {
  let h = 0x811c9dc5;
  const s = id + ':' + salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Deterministic uuid-shaped ids — no Math.random in a layout test. */
function makeIds(count: number): string[] {
  let state = 0x2545f491;
  const hex = (n: number): string => {
    let out = '';
    for (let i = 0; i < n; i++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      out += (state >>> 28).toString(16);
    }
    return out;
  };
  return Array.from({ length: count }, () => `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`);
}

function correlation(a: readonly number[], b: readonly number[]): number {
  const n = a.length;
  const meanA = a.reduce((x, y) => x + y, 0) / n;
  const meanB = b.reduce((x, y) => x + y, 0) / n;
  let cov = 0;
  let varA = 0;
  let varB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i]! - meanA;
    const db = b[i]! - meanB;
    cov += da * db;
    varA += da * da;
    varB += db * db;
  }
  return cov / Math.sqrt(varA * varB);
}

function meanAbsoluteDifference(a: readonly number[], b: readonly number[]): number {
  return a.reduce((sum, value, i) => sum + Math.abs(value - b[i]!), 0) / a.length;
}

/** Every salt the app actually uses, including the near-identical suffixes. */
const SALTS = ['jitter-x', 'jitter-y', 'jitter-z', 'fallback-u', 'fallback-v'];

const IDS = makeIds(4000);

describe('idRandom independence across salts', () => {
  const streams = new Map(SALTS.map((salt) => [salt, IDS.map((id) => idRandom(id, salt))]));

  it('gives every salt pair a correlation under |r| < 0.05', () => {
    const table: string[] = [];
    for (let i = 0; i < SALTS.length; i++) {
      for (let j = i + 1; j < SALTS.length; j++) {
        const a = SALTS[i]!;
        const b = SALTS[j]!;
        const r = correlation(streams.get(a)!, streams.get(b)!);
        table.push(`${a} x ${b} = ${r.toFixed(4)}`);
        expect(Math.abs(r), `corr(${a}, ${b}) = ${r}`).toBeLessThan(0.05);
      }
    }
    expect(table).toHaveLength((SALTS.length * (SALTS.length - 1)) / 2);
  });

  it('keeps the mean absolute difference near the 1/3 of independent uniforms', () => {
    for (let i = 0; i < SALTS.length; i++) {
      for (let j = i + 1; j < SALTS.length; j++) {
        const mad = meanAbsoluteDifference(streams.get(SALTS[i]!)!, streams.get(SALTS[j]!)!);
        // Two independent U(0,1) draws differ by 1/3 on average. The old hash
        // measured 0.008 here — the two streams were effectively one number.
        expect(mad).toBeGreaterThan(0.3);
        expect(mad).toBeLessThan(0.37);
      }
    }
  });

  it('is uniform: the ten deciles are all within 15% of even', () => {
    for (const salt of SALTS) {
      const buckets = new Array(10).fill(0) as number[];
      for (const value of streams.get(salt)!) buckets[Math.min(9, Math.floor(value * 10))]! += 1;
      for (const count of buckets) {
        expect(count).toBeGreaterThan((IDS.length / 10) * 0.85);
        expect(count).toBeLessThan((IDS.length / 10) * 1.15);
      }
    }
  });

  it('is stable — the same id and salt always give the same number', () => {
    for (const id of IDS.slice(0, 50)) {
      expect(idRandom(id, 'jitter-x')).toBe(idRandom(id, 'jitter-x'));
    }
  });

  it('REGRESSION WITNESS: the old hash really was this broken', () => {
    const legacyX = IDS.map((id) => legacyIdRandom(id, 'cloud-x'));
    const legacyY = IDS.map((id) => legacyIdRandom(id, 'cloud-y'));
    // Salts differing only in the last character, appended last, with a weak
    // finalizer: the two "independent" axes were the same number.
    expect(correlation(legacyX, legacyY)).toBeGreaterThan(0.9);
    expect(meanAbsoluteDifference(legacyX, legacyY)).toBeLessThan(0.05);
  });
});
