import type { RecallExplanation, RecallItem } from '../../lib/api.js';
import type { MapModel } from '../map/lib/model.js';
import { toScreen, type Rect, type View } from '../map/lib/project.js';

export interface RouteStop {
  id: string;
  rank: number;
  via: RecallItem['via'];
  index: number;
  x: number;
  y: number;
  /** Cumulative polyline length, in the shared map's layout units. */
  distance: number;
}

/** Rank is retrieval order; position/offset describe the separate context order. */
export function routeLayout(items: readonly RecallItem[], model: MapModel | null): RouteStop[] {
  const stops: RouteStop[] = [];
  for (const item of [...items].sort((a, b) => a.rank - b.rank)) {
    const index = model?.at.get(item.id);
    if (!item.included || index === undefined || !model) continue;
    const x = model.xs[index]!;
    const y = model.ys[index]!;
    const prev = stops[stops.length - 1];
    stops.push({ id: item.id, rank: item.rank, via: item.via, index, x, y,
      distance: prev ? prev.distance + Math.hypot(x - prev.x, y - prev.y) : 0 });
  }
  return stops;
}

export const ROUTE_BADGE_RADIUS = 12;
export const ROUTE_BADGE_HIT_RADIUS = 22;

/** Screen-space badges separate the visible 24px circles, even for identical map points.
 * The larger hit areas may overlap; picking resolves to the nearest centre.
 * Try the true point first, then the nearest free slot. Recompute on zoom so
 * separated memories can return to their true positions. */
export function routeBadges(stops: readonly RouteStop[], view: View, area: Rect): RouteStop[] {
  const placed: RouteStop[] = [];
  const slots: [number, number][] = [];
  const spacing = ROUTE_BADGE_RADIUS * 2 + 4;
  for (let y = area.top + ROUTE_BADGE_HIT_RADIUS; y <= area.bottom - ROUTE_BADGE_HIT_RADIUS; y += spacing) {
    for (let x = area.left + ROUTE_BADGE_HIT_RADIUS; x <= area.right - ROUTE_BADGE_HIT_RADIUS; x += spacing) slots.push([x, y]);
  }
  for (const stop of stops) {
    const [px, py] = toScreen(view, stop.x, stop.y);
    const free = (x: number, y: number) => placed.every((p) => Math.hypot(p.x - x, p.y - y) >= spacing);
    let x = px, y = py;
    if (!free(x, y)) {
      const slot = slots.filter(([sx, sy]) => free(sx, sy))
        .sort((a, b) => Math.hypot(a[0] - px, a[1] - py) - Math.hypot(b[0] - px, b[1] - py))[0];
      if (slot) [x, y] = slot;
      else {
        // A very dense route can exceed the viewport. Keep its badges distinct;
        // pan/zoom and the complete Route list still reach every memory.
        while (!free(x, y)) x += spacing;
      }
    }
    const prev = placed[placed.length - 1];
    placed.push({ ...stop, x, y, distance: prev ? prev.distance + Math.hypot(x - prev.x, y - prev.y) : 0 });
  }
  return placed;
}

/** Preserve a 44px hit diameter without letting an earlier rank steal a neighbour's click. */
export function pickRouteBadge(badges: readonly RouteStop[], x: number, y: number): number {
  let index = -1;
  let nearest = ROUTE_BADGE_HIT_RADIUS;
  for (const badge of badges) {
    const distance = Math.hypot(x - badge.x, y - badge.y);
    if (distance <= nearest) {
      nearest = distance;
      index = badge.index;
    }
  }
  return index;
}

/** offset points to the bullet, but chars excludes its citation and optional source. */
export function memorySpan(context: string, item: RecallItem): { start: number; textStart: number; end: number } | null {
  if (!item.included || item.offset === null) return null;
  const start = item.offset;
  const citation = /^• \[[^\n]*?\] /.exec(context.slice(start));
  const sourceLength = item.section === 'events' && item.source ? `[${item.source}] `.length : 0;
  const textStart = start + (citation?.[0].length ?? 0) + sourceLength;
  return { start, textStart, end: textStart + item.chars };
}

/** Slicing preserves every heading, newline, citation and code unit verbatim. */
export function contextSpans(answer: Pick<RecallExplanation, 'context' | 'items'>): { id: string | null; text: string }[] {
  const parts: { id: string | null; text: string }[] = [];
  let cursor = 0;
  const ordered = answer.items.filter((item) => item.included && item.offset !== null).sort((a, b) => a.offset! - b.offset!);
  for (const item of ordered) {
    const span = memorySpan(answer.context, item)!;
    if (span.start > cursor) parts.push({ id: null, text: answer.context.slice(cursor, span.start) });
    parts.push({ id: item.id, text: answer.context.slice(span.start, span.end) });
    cursor = span.end;
  }
  if (cursor < answer.context.length) parts.push({ id: null, text: answer.context.slice(cursor) });
  return parts;
}

/** The amount of this segment revealed by a distance-based route draw. */
export function segmentProgress(from: RouteStop, to: RouteStop, distance: number): number {
  if (to.distance === from.distance) return distance >= to.distance ? 1 : 0;
  return Math.min(1, Math.max(0, (distance - from.distance) / (to.distance - from.distance)));
}
