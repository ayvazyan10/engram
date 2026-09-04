/**
 * The visual encoding, as data.
 *
 * Every channel the scene uses lives here as a pure function plus the legend
 * entry that describes it, so the key on screen and the geometry on screen
 * cannot drift apart — the way the footer legend and the view themes used to.
 *
 * Four channels, one variable each:
 *
 *   hue         memory type          the canonical palette in lib/tokens.ts,
 *                                    invariant across every view
 *   core size   importance           four discrete steps, not a ramp
 *   brightness  recency              30-day half-life on createdAt
 *   halo size   retrieval count      log-scaled accessCount
 *
 * Importance is banded rather than continuous on purpose. The previous encoding
 * was `0.5 + importance * 1.5` — a 1.0-to-2.0 world-unit span — applied to a
 * distribution where 55% of the live store shares the single value 0.825 and
 * everything sits between 0.33 and 1.0. Nothing was distinguishable. Discrete
 * steps over a 4x range, with the thresholds printed in the key, say what the
 * ramp could not.
 */

export interface ImportanceBand {
  /** Inclusive lower bound. */
  readonly min: number;
  readonly radius: number;
  readonly label: string;
}

/**
 * Thresholds are fixed, not quantiles of the current store: a node must not
 * change size because some other memory was written.
 */
export const IMPORTANCE_BANDS: readonly ImportanceBand[] = [
  { min: 0.9, radius: 3.6, label: '≥ 0.90' },
  { min: 0.82, radius: 2.5, label: '0.82 – 0.90' },
  { min: 0.7, radius: 1.7, label: '0.70 – 0.82' },
  { min: 0, radius: 1.0, label: '< 0.70' },
];

export function importanceRadius(importance: number): number {
  for (const band of IMPORTANCE_BANDS) {
    if (importance >= band.min) return band.radius;
  }
  return IMPORTANCE_BANDS[IMPORTANCE_BANDS.length - 1]!.radius;
}

/** Half-life, in days, of the brightness that encodes recency. */
export const RECENCY_HALF_LIFE_DAYS = 30;

/** Floor, so an old memory is dim but never invisible and never off-hue. */
const MIN_BRIGHTNESS = 0.42;
const DAY_MS = 86_400_000;

/**
 * Brightness in [MIN_BRIGHTNESS, 1] from age. Multiplying the type colour
 * rather than shifting it keeps hue — and therefore type — readable at every
 * age, which is the whole reason recency got brightness and not colour.
 */
export function recencyBrightness(createdAtMs: number, nowMs: number): number {
  if (!Number.isFinite(createdAtMs)) return MIN_BRIGHTNESS;
  const ageDays = Math.max(0, (nowMs - createdAtMs) / DAY_MS);
  const decay = Math.pow(2, -ageDays / RECENCY_HALF_LIFE_DAYS);
  return MIN_BRIGHTNESS + (1 - MIN_BRIGHTNESS) * decay;
}

/** accessCount at which the halo reaches full size; live max is 433. */
const HALO_SATURATION = 100;
const HALO_MIN = 1.45;
const HALO_MAX = 2.35;

/** Halo radius as a multiple of the core radius, from retrieval count. */
export function haloScale(accessCount: number): number {
  const t = Math.log1p(Math.max(0, accessCount)) / Math.log1p(HALO_SATURATION);
  return HALO_MIN + (HALO_MAX - HALO_MIN) * Math.min(1, t);
}

/** How far a node's colour is knocked back when a search excludes it. */
export const DIMMED_FACTOR = 0.14;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** 0xrrggbb -> linear-ish 0-1 channels, scaled by `brightness`. */
export function tint(colorInt: number, brightness: number): Rgb {
  const scale = Math.max(0, brightness) / 255;
  return {
    r: ((colorInt >> 16) & 0xff) * scale,
    g: ((colorInt >> 8) & 0xff) * scale,
    b: (colorInt & 0xff) * scale,
  };
}
