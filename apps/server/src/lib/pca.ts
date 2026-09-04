/**
 * Principal component analysis, reduced to the three components the 3D
 * dashboard draws with.
 *
 * Why PCA and not UMAP/t-SNE: this runs on every store change, in-process,
 * with no new dependency and no hyperparameters. It is a linear projection,
 * so it is *deterministic for a given input* — the same store yields the same
 * axes on every call, byte for byte — where t-SNE and UMAP both start from a
 * random init and would need a pinned seed plus a much larger dependency to
 * get the same property. PCA under-separates fine local structure compared to
 * those two; it does not invent structure that is not there, which is the
 * failure mode that matters for a memory graph.
 *
 * A caveat worth stating plainly: PCA is deterministic, not *invariant*. The
 * basis is fitted to the data, so adding a memory changes the axes by O(1/N)
 * and every node shifts slightly. The layout endpoint caches the result, so
 * nothing moves at all until the memory set actually changes; when it does,
 * the shift on a few-hundred-memory store is a fraction of a percent of the
 * world box. See __tests__/pca.test.ts, which measures it.
 */

export type Vec3 = readonly [number, number, number];

export interface Pca3Result {
  /** One 3-vector per input vector, in input order. */
  readonly coords: readonly Vec3[];
  /** Fraction of total variance carried by each of the three components. */
  readonly explained: Vec3;
  /** How many vectors the basis was fitted on (see FIT_SAMPLE_CAP). */
  readonly fittedOn: number;
}

/**
 * Cap on how many vectors the basis is fitted to.
 *
 * Fitting is O(samples x dim) per iteration; projection is O(N x dim x 3).
 * Bounding the fit keeps a 100k-memory store from turning a page load into a
 * minute of linear algebra. The subsample is every k-th vector in the input
 * order the caller supplies (which the route fixes as `ORDER BY id`), so it is
 * deterministic — not a random draw.
 */
export const FIT_SAMPLE_CAP = 4000;

/** Minimum vectors before a 3-component projection means anything at all. */
export const MIN_VECTORS_FOR_PCA = 4;

const MAX_ITERATIONS = 256;
const TOLERANCE = 1e-10;

function dot(a: Float64Array, b: Float64Array): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += (a[i] as number) * (b[i] as number);
  return sum;
}

function scaleInPlace(w: Float64Array, factor: number): void {
  for (let i = 0; i < w.length; i++) w[i] = (w[i] as number) * factor;
}

function magnitude(w: Float64Array): number {
  return Math.sqrt(dot(w, w));
}

/** Deterministic seed vector for component `k` — never `Math.random()`. */
function seedVector(dim: number, k: number): Float64Array {
  const w = new Float64Array(dim);
  const golden = 1.618033988749895;
  for (let i = 0; i < dim; i++) w[i] = Math.sin(i * golden * (k + 1) + k);
  const norm = magnitude(w);
  if (norm > 0) scaleInPlace(w, 1 / norm);
  return w;
}

/**
 * Canonical sign for an eigenvector.
 *
 * An eigenvector and its negation are equally valid, and which one power
 * iteration lands on depends on the seed. Forcing the largest-magnitude
 * loading positive pins it, so a re-fit on unchanged data cannot mirror the
 * whole scene.
 */
function canonicalizeSign(w: Float64Array): void {
  let best = 0;
  for (let i = 1; i < w.length; i++) {
    if (Math.abs(w[i] as number) > Math.abs(w[best] as number)) best = i;
  }
  if ((w[best] as number) < 0) scaleInPlace(w, -1);
}

/** Cov·w computed implicitly as Xᵀ(Xw)/N — no D×D matrix is ever built. */
function covMultiply(rows: readonly Float64Array[], w: Float64Array): Float64Array {
  const dim = w.length;
  const out = new Float64Array(dim);
  for (const row of rows) {
    const projection = dot(row, w);
    if (projection === 0) continue;
    for (let i = 0; i < dim; i++) out[i] = (out[i] as number) + projection * (row[i] as number);
  }
  scaleInPlace(out, 1 / rows.length);
  return out;
}

function deflate(vector: Float64Array, basis: readonly Float64Array[]): void {
  for (const previous of basis) {
    const overlap = dot(vector, previous);
    for (let i = 0; i < vector.length; i++) {
      vector[i] = (vector[i] as number) - overlap * (previous[i] as number);
    }
  }
}

function absoluteDelta(a: Float64Array, b: Float64Array): number {
  let delta = 0;
  for (let i = 0; i < a.length; i++) delta += Math.abs((a[i] as number) - (b[i] as number));
  return delta;
}

/** One eigenvector by power iteration, deflated against those already found. */
function leadingEigenvector(
  rows: readonly Float64Array[],
  basis: readonly Float64Array[],
  k: number
): { vector: Float64Array; value: number } {
  let w = seedVector((rows[0] as Float64Array).length, k);
  let value = 0;
  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const next = covMultiply(rows, w);
    deflate(next, basis);
    const norm = magnitude(next);
    if (norm === 0) break;
    value = norm;
    scaleInPlace(next, 1 / norm);
    const delta = absoluteDelta(next, w);
    w = next;
    if (delta < TOLERANCE) break;
  }
  canonicalizeSign(w);
  return { vector: w, value };
}

function centeredRows(vectors: readonly Float32Array[], dim: number): Float64Array[] {
  const mean = new Float64Array(dim);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i++) mean[i] = (mean[i] as number) + (vector[i] as number);
  }
  scaleInPlace(mean, 1 / vectors.length);

  return vectors.map((vector) => {
    const row = new Float64Array(dim);
    for (let i = 0; i < dim; i++) row[i] = (vector[i] as number) - (mean[i] as number);
    return row;
  });
}

function subsample<T>(items: readonly T[], cap: number): readonly T[] {
  if (items.length <= cap) return items;
  const stride = items.length / cap;
  const out: T[] = [];
  for (let i = 0; out.length < cap; i++) {
    const index = Math.floor(i * stride);
    if (index >= items.length) break;
    out.push(items[index] as T);
  }
  return out;
}

/**
 * Project vectors onto their first three principal components.
 *
 * Returns `null` when there is nothing meaningful to project: fewer than
 * MIN_VECTORS_FOR_PCA vectors, vectors of inconsistent or zero dimension, or a
 * cloud with no variance at all (every embedding identical). The caller is
 * expected to fall back visibly rather than pretend.
 */
export function pca3(vectors: readonly Float32Array[]): Pca3Result | null {
  if (vectors.length < MIN_VECTORS_FOR_PCA) return null;
  const dim = (vectors[0] as Float32Array).length;
  if (dim === 0 || vectors.some((v) => v.length !== dim)) return null;

  const rows = centeredRows(vectors, dim);
  const fitRows = subsample(rows, FIT_SAMPLE_CAP);

  let totalVariance = 0;
  for (const row of fitRows) totalVariance += dot(row, row);
  totalVariance /= fitRows.length;
  if (!(totalVariance > 0)) return null;

  const basis: Float64Array[] = [];
  const values: number[] = [];
  for (let k = 0; k < 3; k++) {
    const { vector, value } = leadingEigenvector(fitRows, basis, k);
    basis.push(vector);
    values.push(value);
  }

  const [first, second, third] = basis as [Float64Array, Float64Array, Float64Array];
  const coords = rows.map((row): Vec3 => [dot(row, first), dot(row, second), dot(row, third)]);

  return {
    coords,
    explained: [
      (values[0] as number) / totalVariance,
      (values[1] as number) / totalVariance,
      (values[2] as number) / totalVariance,
    ],
    fittedOn: fitRows.length,
  };
}

/** Percentile of |coordinate| used as the scale reference — see fitToBox. */
const SCALE_PERCENTILE = 0.995;

/**
 * Scale a point cloud into a fixed [-halfExtent, halfExtent]³ world box.
 *
 * One uniform factor for all three axes, so the relative spread of PC1 / PC2 /
 * PC3 survives — stretching each axis to fill the box independently would make
 * a nearly-flat cloud look spherical and lie about the data. The factor comes
 * from the 99.5th percentile of per-point max-|coordinate| rather than the
 * maximum, so a single outlier cannot squash everything else into the middle;
 * the handful of points past that percentile are clamped to the wall.
 */
export function fitToBox(coords: readonly Vec3[], halfExtent: number): Vec3[] {
  if (coords.length === 0) return [];
  const reach = coords
    .map(([x, y, z]) => Math.max(Math.abs(x), Math.abs(y), Math.abs(z)))
    .sort((a, b) => a - b);
  const pivot = reach[Math.min(reach.length - 1, Math.floor(reach.length * SCALE_PERCENTILE))] ?? 0;
  if (!(pivot > 0)) return coords.map((): Vec3 => [0, 0, 0]);

  const scale = halfExtent / pivot;
  const clamp = (v: number): number => Math.max(-halfExtent, Math.min(halfExtent, v * scale));
  return coords.map(([x, y, z]): Vec3 => [clamp(x), clamp(y), clamp(z)]);
}
