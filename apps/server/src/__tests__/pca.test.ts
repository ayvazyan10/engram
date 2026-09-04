/**
 * The projection is the one thing in the 3D view that is supposed to *mean*
 * something, so its properties are asserted rather than assumed: it is
 * deterministic, it lands inside a fixed box, it keeps the relative spread of
 * its three axes, it separates clusters that really are separate, and it says
 * `null` instead of inventing a projection it cannot justify.
 */

import { describe, it, expect } from 'vitest';
import { fitToBox, pca3, FIT_SAMPLE_CAP, MIN_VECTORS_FOR_PCA, type Vec3 } from '../lib/pca.js';

/** Seeded LCG — no Math.random anywhere in these fixtures. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function gaussianCloud(count: number, dim: number, centre: number[], spread: number, seed: number): Float32Array[] {
  const rand = lcg(seed);
  return Array.from({ length: count }, () => {
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      const u = (rand() + rand() + rand() + rand() - 2) * spread;
      v[i] = (centre[i] ?? 0) + u;
    }
    return v;
  });
}

/** A cloud whose variance falls off across dimensions, like a real embedding set. */
function anisotropicCloud(count: number, dim: number, seed: number): Float32Array[] {
  const rand = lcg(seed);
  return Array.from({ length: count }, () => {
    const v = new Float32Array(dim);
    for (let i = 0; i < dim; i++) {
      const u = rand() + rand() + rand() + rand() - 2;
      v[i] = u / (i + 1);
    }
    return v;
  });
}

describe('pca3', () => {
  it('is deterministic — two runs over the same vectors agree exactly', () => {
    const vectors = gaussianCloud(120, 32, [], 1, 7);
    const a = pca3(vectors);
    const b = pca3(vectors.map((v) => Float32Array.from(v)));
    expect(a).not.toBeNull();
    expect(b?.coords).toEqual(a?.coords);
    expect(b?.explained).toEqual(a?.explained);
  });

  it('places clusters that are genuinely far apart in genuinely different places', () => {
    const left = gaussianCloud(60, 24, Array.from({ length: 24 }, (_, i) => (i === 0 ? -8 : 0)), 0.4, 11);
    const right = gaussianCloud(60, 24, Array.from({ length: 24 }, (_, i) => (i === 0 ? 8 : 0)), 0.4, 12);
    const result = pca3([...left, ...right]);
    expect(result).not.toBeNull();

    const first = result!.coords.slice(0, 60).map((c) => c[0]);
    const second = result!.coords.slice(60).map((c) => c[0]);
    const meanA = first.reduce((a, b) => a + b, 0) / first.length;
    const meanB = second.reduce((a, b) => a + b, 0) / second.length;

    // The dominant axis has to be the one that separates them.
    expect(Math.abs(meanA - meanB)).toBeGreaterThan(8);
    // …and the two clusters must land on opposite sides of it.
    expect(Math.sign(meanA)).not.toBe(Math.sign(meanB));
    expect(result!.explained[0]).toBeGreaterThan(result!.explained[1]);
    expect(result!.explained[1]).toBeGreaterThanOrEqual(result!.explained[2]);
  });

  it('is stable under an unrelated arrival — one new memory in 200 barely moves the rest', () => {
    // Anisotropic on purpose: real sentence embeddings have clearly ordered
    // leading eigenvalues (24% / 9.4% / 4.6% on the live store), which is what
    // pins the basis. Isotropic noise has near-degenerate eigenvalues whose
    // eigenvectors are free to rotate, and no fitted projection is stable
    // there — that is a property of the data, not of this implementation.
    const base = anisotropicCloud(200, 32, 21);
    const before = pca3(base)!;
    const after = pca3([...base, ...anisotropicCloud(1, 32, 999)])!;

    const boxedBefore = fitToBox(before.coords, 42);
    const boxedAfter = fitToBox(after.coords.slice(0, 200), 42);

    let worst = 0;
    for (let i = 0; i < boxedBefore.length; i++) {
      const a = boxedBefore[i] as Vec3;
      const b = boxedAfter[i] as Vec3;
      worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    }
    // PCA is deterministic, not invariant: the basis is fitted, so a new row
    // perturbs it by O(1/N). This pins how small that is — under 2% of the
    // 84-unit box width, i.e. invisible next to a node radius of ~1-4.
    expect(worst).toBeLessThan(84 * 0.02);
  });

  it('refuses to project what it cannot: too few vectors, mismatched dims, no variance', () => {
    expect(pca3(gaussianCloud(MIN_VECTORS_FOR_PCA - 1, 8, [], 1, 3))).toBeNull();
    expect(pca3([new Float32Array(8), new Float32Array(4), new Float32Array(8), new Float32Array(8)])).toBeNull();
    expect(pca3([])).toBeNull();
    expect(pca3(Array.from({ length: 10 }, () => new Float32Array(0)))).toBeNull();
    // Ten identical vectors carry no variance at all — there is no axis to find.
    const identical = Array.from({ length: 10 }, () => Float32Array.from([1, 2, 3, 4]));
    expect(pca3(identical)).toBeNull();
  });

  it('caps how many vectors the basis is fitted on, but still projects every one', () => {
    const many = gaussianCloud(FIT_SAMPLE_CAP + 250, 8, [], 1, 5);
    const result = pca3(many)!;
    expect(result.coords).toHaveLength(FIT_SAMPLE_CAP + 250);
    expect(result.fittedOn).toBe(FIT_SAMPLE_CAP);
  });

  it('projects a realistic 653 x 384 store without an algorithmic blow-up', () => {
    const vectors = gaussianCloud(653, 384, [], 1, 31);
    const started = Date.now();
    const result = pca3(vectors);
    expect(result).not.toBeNull();
    expect(result!.coords).toHaveLength(653);
    // A deliberately loose ceiling. Measured on the live 653 x 384 store this
    // is ~150ms, and ~490ms for this synthetic worst case where the isotropic
    // eigenvalues force every component to the iteration cap — but the same
    // call takes ~4.6s under v8 coverage instrumentation, so a tight wall-clock
    // bound here would be a flaky test rather than a useful one. What this
    // catches is an accidental O(N x D^2) regression, not a slow afternoon.
    expect(Date.now() - started).toBeLessThan(20000);
  });
});

describe('fitToBox', () => {
  it('keeps every coordinate inside the box', () => {
    const coords: Vec3[] = Array.from({ length: 500 }, (_, i) => [
      Math.sin(i) * 3,
      Math.cos(i * 1.7) * 9,
      Math.sin(i * 0.3) * 0.2,
    ]);
    for (const [x, y, z] of fitToBox(coords, 42)) {
      expect(Math.abs(x)).toBeLessThanOrEqual(42);
      expect(Math.abs(y)).toBeLessThanOrEqual(42);
      expect(Math.abs(z)).toBeLessThanOrEqual(42);
    }
  });

  it('scales all three axes by ONE factor, so a flat cloud still looks flat', () => {
    const coords: Vec3[] = Array.from({ length: 400 }, (_, i) => [
      Math.sin(i) * 10,
      Math.cos(i * 1.3) * 10,
      Math.sin(i * 2.1) * 1,
    ]);
    const boxed = fitToBox(coords, 42);
    const spread = (axis: 0 | 1 | 2) =>
      Math.max(...boxed.map((c) => Math.abs(c[axis])));
    // z was a tenth of x in the input and must still be about a tenth here.
    expect(spread(2) / spread(0)).toBeGreaterThan(0.06);
    expect(spread(2) / spread(0)).toBeLessThan(0.16);
  });

  it('is not thrown off by a single wild outlier', () => {
    const coords: Vec3[] = [
      ...Array.from({ length: 400 }, (_, i): Vec3 => [Math.sin(i), Math.cos(i), 0]),
      [10000, 0, 0],
    ];
    const boxed = fitToBox(coords, 42);
    const bulk = boxed.slice(0, 400).map(([x]) => Math.abs(x));
    // Without the percentile pivot the outlier would flatten the other 400
    // points into a dot at the origin.
    expect(Math.max(...bulk)).toBeGreaterThan(20);
    // …and the outlier itself is clamped to the wall rather than escaping it.
    expect(Math.abs((boxed[400] as Vec3)[0])).toBe(42);
  });

  it('handles degenerate input without producing NaN', () => {
    expect(fitToBox([], 42)).toEqual([]);
    expect(fitToBox([[0, 0, 0]], 42)).toEqual([[0, 0, 0]]);
  });
});
