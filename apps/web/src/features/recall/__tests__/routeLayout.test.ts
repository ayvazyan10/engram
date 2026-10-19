import { describe, expect, it } from 'vitest';
import type { RecallExplanation, RecallItem } from '../../../lib/api.js';
import { buildModel } from '../../map/lib/model.js';
import { node, payload } from '../../map/__tests__/payload.js';
import { contextSpans, memorySpan, pickRouteBadge, ROUTE_BADGE_HIT_RADIUS, ROUTE_BADGE_RADIUS, routeBadges, routeLayout, segmentProgress } from '../routeLayout.js';

const item = (id: string, patch: Partial<RecallItem> = {}): RecallItem => ({
  id, rank: 1, position: 1, offset: 0, section: 'knowledge', type: 'semantic', source: null,
  via: 'vector', similarity: 0.8, score: 0.9, chars: 8, tokens: 2, included: true, ...patch,
});

describe('explain → route', () => {
  it('uses rank, includes only charted selected items, preserves graph provenance and rank gaps', () => {
    const model = buildModel(payload({ nodes: [node('a', { x: 0, y: 0 }), node('b', { x: 1, y: 0 }), node('c', { x: 1, y: 1 })] }));
    const items = [item('c', { rank: 4, position: 1, via: 'graph' }), item('a', { rank: 1, position: 2 }),
      item('b', { rank: 2, included: false, reason: 'over_budget', offset: null, position: null }), item('missing', { rank: 3 })];
    const stops = routeLayout(items, model);
    expect(stops.map(({ id, rank, via, index }) => ({ id, rank, via, index }))).toEqual([
      { id: 'a', rank: 1, via: 'vector', index: 0 }, { id: 'c', rank: 4, via: 'graph', index: 2 },
    ]);
    expect(stops[0]).toMatchObject({ x: model.xs[0], y: model.ys[0], distance: 0 });
    expect(stops[1]!.distance).toBeCloseTo(Math.hypot(model.xs[2]! - model.xs[0]!, model.ys[2]! - model.ys[0]!));
    expect(items[0]!.id).toBe('c');
    expect(routeLayout(items, null)).toEqual([]);
    expect(routeLayout([], model)).toEqual([]);
    expect(segmentProgress(stops[0]!, stops[1]!, -1)).toBe(0);
    expect(segmentProgress(stops[0]!, stops[1]!, stops[1]!.distance / 2)).toBe(0.5);
    expect(segmentProgress(stops[0]!, stops[1]!, Infinity)).toBe(1);
    expect(segmentProgress(stops[0]!, stops[0]!, 0)).toBe(1);
    expect(segmentProgress(stops[0]!, stops[0]!, -1)).toBe(0);
  });
});

describe('exact context spans', () => {
  it('uses offsets, includes citations/source and all chars, preserves multiline and UTF-16 text', () => {
    const a = 'Repeated 🧠\n• not a new memory';
    const b = 'Repeated 🧠';
    const prefix = '[NEURAL MEMORY CONTEXT]\n\n[KNOWLEDGE]\n';
    const lineA = `• [aaaaaaaa · 2026-10-19] ${a}`;
    const middle = '\n\n[PAST EVENTS & CONVERSATIONS]\n';
    const lineB = `• [bbbbbbbb · 2026-10-19] [chat] ${b}`;
    const context = prefix + lineA + middle + lineB + '\n[END]';
    const items = [item('b', { rank: 1, position: 2, offset: prefix.length + lineA.length + middle.length, chars: b.length, section: 'events', source: 'chat' }),
      item('a', { rank: 2, offset: prefix.length, chars: a.length }), item('drop', { included: false, offset: null })];
    const spans = contextSpans({ context, items });
    expect(spans.filter((span) => span.id)).toEqual([{ id: 'a', text: lineA }, { id: 'b', text: lineB }]);
    expect(spans.map((span) => span.text).join('')).toBe(context);
    expect(memorySpan(context, items[2]!)).toBeNull();
    expect(contextSpans({ context: 'No highlights', items: [] })).toEqual([{ id: null, text: 'No highlights' }]);
    expect(contextSpans({ context: '', items: [] })).toEqual([]);
  });

  it('handles offsets starting directly at text and adjacent spans', () => {
    const context = 'firstsecond';
    expect(contextSpans({ context, items: [item('a', { chars: 5 }), item('b', { offset: 5, chars: 6 })] })).toEqual([
      { id: 'a', text: 'first' }, { id: 'b', text: 'second' },
    ]);
    const empty: RecallExplanation = { context: '', items: [], candidates: 0, latencyMs: 1, budget: { maxTokens: 500, usedTokens: 0 } };
    expect(contextSpans(empty)).toEqual([]);
  });
});


describe('Recall badge collisions', () => {
  it('keeps all 18 coincident ranks readable and touchable on a 390px phone', () => {
    const model = buildModel(payload({ nodes: Array.from({ length: 18 }, (_, i) => node(String(i), { x: 0, y: 0 })) }));
    const stops = routeLayout(model.nodes.map((n, i) => item(n.id, { rank: i + 1, via: i > 2 ? 'graph' : 'vector' })), model);
    const view = { x: 195 - stops[0]!.x, y: 160 - stops[0]!.y, k: 1 };
    const area = { left: 24, top: 64, right: 366, bottom: 256 };
    const badges = routeBadges(stops, view, area);
    expect(routeBadges(stops, view, area)).toEqual(badges);
    expect(badges.map((b) => b.rank)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
    expect(ROUTE_BADGE_RADIUS * 2).toBe(24);
    expect(ROUTE_BADGE_HIT_RADIUS * 2).toBe(44);
    for (const [i, badge] of badges.entries()) {
      expect(badge.x).toBeGreaterThanOrEqual(area.left + 22);
      expect(badge.x).toBeLessThanOrEqual(area.right - 22);
      expect(badge.y).toBeGreaterThanOrEqual(area.top + 22);
      expect(badge.y).toBeLessThanOrEqual(area.bottom - 22);
      expect(Math.hypot(badge.x - 195, badge.y - 160)).toBeLessThanOrEqual(90);
      expect(pickRouteBadge(badges, badge.x, badge.y)).toBe(badge.index);
      for (const other of badges.slice(i + 1)) expect(Math.hypot(badge.x - other.x, badge.y - other.y)).toBeGreaterThanOrEqual(28);
      if (i) {
        const predecessor = badges[i - 1]!;
        expect(badge.distance - predecessor.distance).toBeCloseTo(Math.hypot(badge.x - predecessor.x, badge.y - predecessor.y));
      }
    }
  });

  it('returns separated badges to their own map points after zoom, and never merges dense overflow', () => {
    const model = buildModel(payload({ nodes: [node('a'), node('b')] }));
    const stops = routeLayout([item('a'), item('b', { rank: 2, via: 'graph' })], model)
      .map((stop, i) => ({ ...stop, x: i * 10, y: 0 }));
    const area = { left: 0, top: 0, right: 390, bottom: 320 };
    const zoomed = routeBadges(stops, { k: 10, x: 50, y: 100 }, area);
    expect(zoomed.map(({ x, y }) => [x, y])).toEqual([[50, 100], [150, 100]]);
    const tiny = routeBadges(stops, { k: 1, x: 0, y: 0 }, { left: 0, top: 0, right: 20, bottom: 20 });
    expect(Math.hypot(tiny[1]!.x - tiny[0]!.x, tiny[1]!.y - tiny[0]!.y)).toBeGreaterThanOrEqual(28);
    expect(routeBadges([], { k: 1, x: 0, y: 0 }, area)).toEqual([]);
  });

  it('keeps the 44px hit area and picks the nearest badge inside overlapping targets', () => {
    const model = buildModel(payload({ nodes: [node('a'), node('b')] }));
    const badges = routeLayout([item('a'), item('b', { rank: 2 })], model)
      .map((stop, i) => ({ ...stop, x: 100 + i * 28, y: 100 }));
    expect(pickRouteBadge([badges[0]!], 122, 100)).toBe(0);
    expect(pickRouteBadge([badges[0]!], 122.1, 100)).toBe(-1);
    expect(pickRouteBadge(badges, 109, 100)).toBe(0);
    expect(pickRouteBadge(badges, 120, 100)).toBe(1);
    expect(pickRouteBadge([...badges].reverse(), 120, 100)).toBe(1);
    expect(pickRouteBadge([], 100, 100)).toBe(-1);
  });
});
