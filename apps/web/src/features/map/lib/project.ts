/**
 * World, layout and screen. The server places memories in [-1, 1] on both
 * axes, y up. The map works in a fixed layout square (y down, LAYOUT_SIZE on
 * a side, a margin around the data so terrain is not cut at the edge), where
 * the terrain, the hit index and the labels are computed once per payload.
 * A view `{k, x, y}` takes layout to screen: `screen = layout * k + (x, y)`,
 * the same shape as a d3-zoom transform.
 */

export const LAYOUT_SIZE = 1000;
/** Half the layout square in world units: [-1, 1] plus a 10% margin. */
const WORLD_HALF = 1.1;

export interface View {
  k: number;
  x: number;
  y: number;
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function toLayout(x: number, y: number): [number, number] {
  return [((x + WORLD_HALF) / (2 * WORLD_HALF)) * LAYOUT_SIZE, ((WORLD_HALF - y) / (2 * WORLD_HALF)) * LAYOUT_SIZE];
}

/** The box around some layout points; every point when `only` is left out. */
export function boundsOf(xs: ArrayLike<number>, ys: ArrayLike<number>, only?: readonly number[]): Rect | null {
  const at = only ?? Array.from({ length: xs.length }, (_, i) => i);
  if (at.length === 0) return null;
  const box = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const i of at) {
    box.left = Math.min(box.left, xs[i]!);
    box.right = Math.max(box.right, xs[i]!);
    box.top = Math.min(box.top, ys[i]!);
    box.bottom = Math.max(box.bottom, ys[i]!);
  }
  return box;
}

/** Below this the box is treated as this wide, so one memory is not zoomed into a blur. */
const MIN_SPAN = 60;

/** The view that fits a layout box into a screen area, `fill` of the way, centred. */
export function fitView(box: Rect, area: Rect, fill = 0.88): View {
  const w = Math.max(MIN_SPAN, box.right - box.left);
  const h = Math.max(MIN_SPAN, box.bottom - box.top);
  const k = Math.max(1e-3, Math.min(((area.right - area.left) * fill) / w, ((area.bottom - area.top) * fill) / h));
  return centreOn({ k, x: 0, y: 0 }, (box.left + box.right) / 2, (box.top + box.bottom) / 2, area);
}

/** The same zoom, moved so a layout point sits in the middle of the area. */
export function centreOn(view: View, lx: number, ly: number, area: Rect, k = view.k): View {
  return { k, x: (area.left + area.right) / 2 - lx * k, y: (area.top + area.bottom) / 2 - ly * k };
}

export function toScreen(view: View, lx: number, ly: number): [number, number] {
  return [lx * view.k + view.x, ly * view.k + view.y];
}

export function toLayoutPoint(view: View, sx: number, sy: number): [number, number] {
  return [(sx - view.x) / view.k, (sy - view.y) / view.k];
}

export function contains(area: Rect, sx: number, sy: number, margin = 0): boolean {
  return sx >= area.left + margin && sx <= area.right - margin && sy >= area.top + margin && sy <= area.bottom - margin;
}

/**
 * The part of the view the map can use: the whole view less the side sheet
 * (desktop, on the right) or the bottom sheet (phone), and less `top` for the
 * search field floating over it.
 */
export function visibleArea(width: number, height: number, sheet: Rect | null, top: number): Rect {
  const area = { left: 0, top, right: width, bottom: height };
  if (!sheet) return area;
  const atRight = sheet.left > width / 3 && sheet.top < height / 3;
  if (atRight) area.right = Math.max(area.left + 1, sheet.left);
  else area.bottom = Math.max(area.top + 1, sheet.top);
  return area;
}

/**
 * Part of the way from one view to another, `t` in [0, 1] already eased.
 * The point under the area's centre moves in a straight line and the zoom
 * moves in log space, so a glide neither swings wide nor rushes its zoom.
 */
export function between(from: View, to: View, t: number, area: Rect): View {
  const cx = (area.left + area.right) / 2;
  const cy = (area.top + area.bottom) / 2;
  const [ax, ay] = toLayoutPoint(from, cx, cy);
  const [bx, by] = toLayoutPoint(to, cx, cy);
  const k = Math.exp(Math.log(from.k) + (Math.log(to.k) - Math.log(from.k)) * t);
  return centreOn({ k, x: 0, y: 0 }, ax + (bx - ax) * t, ay + (by - ay) * t, { left: cx, right: cx, top: cy, bottom: cy });
}

/** d3's cubic in-out, the camera's curve (plan 2.5). */
export function easeCubicInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Expo-out, for things that arrive (search pins). Exactly 1 at the end. */
export function easeExpoOut(t: number): number {
  return t >= 1 ? 1 : 1 - Math.pow(2, -10 * t);
}
