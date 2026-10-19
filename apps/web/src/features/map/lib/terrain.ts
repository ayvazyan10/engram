import { contourDensity } from 'd3-contour';
import { LAYOUT_SIZE } from './project.js';

/** One band of ground: everything at least this dense, as an SVG path in
 *  layout units (a canvas takes it as `new Path2D(path)`). */
export interface TerrainLevel {
  path: string;
  /** 0 for the lowest ground up to 1 for the highest. */
  height: number;
  /** Every fourth line is an index contour, drawn heavier, as on a survey map. */
  index: boolean;
}

/** In layout units: wide enough that a region reads as one hill, narrow
 *  enough that two neighbouring regions stay two. */
const BANDWIDTH = 24;
const LEVELS = 16;
const CELL = 4;

type Ring = number[][];

/** A d3 contour's rings as one path; holes keep their own winding. */
export function ringsToPath(polygons: Ring[][]): string {
  let d = '';
  for (const polygon of polygons) {
    for (const ring of polygon) {
      ring.forEach(([x, y], i) => {
        d += `${i === 0 ? 'M' : 'L'}${Math.round(x! * 10) / 10} ${Math.round(y! * 10) / 10}`;
      });
      d += 'Z';
    }
  }
  return d;
}

/**
 * Density terrain over the layout square: where many memories sit close
 * together the ground rises. Computed once per payload, drawn under any zoom.
 */
export function terrain(xs: ArrayLike<number>, ys: ArrayLike<number>): TerrainLevel[] {
  if (xs.length < 3) return [];
  const points = Array.from({ length: xs.length }, (_, i) => i);
  const contours = contourDensity<number>()
    .x((i) => xs[i]!)
    .y((i) => ys[i]!)
    .size([LAYOUT_SIZE, LAYOUT_SIZE])
    .cellSize(CELL)
    .bandwidth(BANDWIDTH)
    .thresholds(LEVELS)(points);
  const n = contours.length;
  return contours
    .map((c, i) => ({ path: ringsToPath(c.coordinates as Ring[][]), height: n > 1 ? i / (n - 1) : 1, index: i % 4 === 3 }))
    .filter((level) => level.path.length > 0);
}

function channels(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * The ground colour at a height in [0, 1], blended along the terrain ramp
 * (--terrain-1 lowest to --terrain-6 highest). A ramp it cannot read gives
 * its first colour, or transparent when there is none.
 */
export function rampColour(ramp: readonly string[], height: number): string {
  const rgb = ramp.map(channels);
  if (rgb.some((c) => c === null) || rgb.length < 2) return ramp[0] ?? 'transparent';
  const at = Math.min(1, Math.max(0, height)) * (rgb.length - 1);
  const i = Math.min(rgb.length - 2, Math.floor(at));
  const t = at - i;
  const [a, b] = [rgb[i]!, rgb[i + 1]!];
  const mixed = a.map((v, c) => Math.round(v + (b[c]! - v) * t));
  return `rgb(${mixed.join(',')})`;
}
