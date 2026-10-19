import type { RecallExplanation, RecallItem } from '../../lib/api.js';
import type { MapModel } from '../map/lib/model.js';

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
