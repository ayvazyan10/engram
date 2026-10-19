import { describe, expect, it } from 'vitest';
import type { RecallExplanation, RecallItem } from '../../../lib/api.js';
import { buildModel } from '../../map/lib/model.js';
import { node, payload } from '../../map/__tests__/payload.js';
import { contextSpans, memorySpan, routeLayout, segmentProgress } from '../routeLayout.js';

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
