import { Delaunay } from 'd3-delaunay';
import { toLayoutPoint, toScreen, type View } from './project.js';

export type Direction = 'up' | 'down' | 'left' | 'right';

const DIRS: Record<Direction, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
/** A step goes to a memory within 60 degrees either side of the key's direction. */
const CONE = 0.5;

export function buildIndex(xs: ArrayLike<number>, ys: ArrayLike<number>): Delaunay<number> {
  return Delaunay.from(
    Array.from({ length: xs.length }, (_, i) => i),
    (i) => xs[i]!,
    (i) => ys[i]!
  );
}

/**
 * The memory under a screen point: the nearest one, if it is within `maxPx`
 * on screen and `shown` lets it be picked (the Time lens hides old ones).
 * -1 when there is none.
 */
export function pick(
  index: Delaunay<number>,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  view: View,
  sx: number,
  sy: number,
  maxPx: number,
  shown: (i: number) => boolean = () => true
): number {
  if (xs.length === 0) return -1;
  const [lx, ly] = toLayoutPoint(view, sx, sy);
  const i = index.find(lx, ly);
  if (i < 0 || !shown(i)) return -1;
  const [px, py] = toScreen(view, xs[i]!, ys[i]!);
  return Math.hypot(px - sx, py - sy) <= maxPx ? i : -1;
}

/**
 * The arrow keys' step: from one memory to the closest one in that direction.
 * Delaunay neighbours are tried first, because they are what the eye reads as
 * "next to"; when none lies in the direction, every memory is. Closer and
 * better-aligned wins. -1 at the edge of the map.
 */
export function step(
  index: Delaunay<number>,
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  from: number,
  dir: Direction,
  shown: (i: number) => boolean = () => true
): number {
  const [dx, dy] = DIRS[dir];
  const score = (j: number): number => {
    if (j === from || !shown(j)) return Infinity;
    const vx = xs[j]! - xs[from]!;
    const vy = ys[j]! - ys[from]!;
    const d = Math.hypot(vx, vy);
    if (d === 0) return Infinity;
    const cos = (vx * dx + vy * dy) / d;
    return cos < CONE ? Infinity : d * (2 - cos);
  };
  const best = (candidates: Iterable<number>) => {
    let at = -1;
    let low = Infinity;
    for (const j of candidates) {
      const s = score(j);
      if (s < low) {
        low = s;
        at = j;
      }
    }
    return at;
  };
  const near = best(index.neighbors(from));
  return near !== -1 ? near : best(Array.from({ length: xs.length }, (_, i) => i));
}
