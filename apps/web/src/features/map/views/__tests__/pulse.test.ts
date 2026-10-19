import { describe, expect, it } from 'vitest';
import { budgetWalk, clamp, dotFrame, END_MS, inferPullers, pulseLayout, rimPath, smooth } from '../pulse.js';
import { graph, item, payload, recall } from './fixtures.js';

describe('Pulse recall model', () => {
  it('uses character totals so per-item rounding cannot invent budget overflow', () => {
    const walk = budgetWalk(recall({ budget: { maxTokens: 2, usedTokens: 2 }, items: [
      item('a', 1, { tokens: 1, chars: 1 }), item('b', 2, { tokens: 2, chars: 7 }),
      item('c', 3, { tokens: 1, chars: 1, included: false, reason: 'over_budget' }),
    ] }));
    expect(walk.map((i) => i.remaining)).toEqual([2, 1.75, 0]);
    expect(walk[1]!.why).not.toContain('over budget');
    expect(walk[1]!.offset).toBe(0.25);
    expect(walk[1]!.budgetTokens).toBe(1.75);
    expect(walk[2]!.why).toContain('0 left');
  });
  it('walks rank order without charging excluded items or changing the server verdict', () => {
    const rec = recall({ items: [item('c', 3), item('b', 2, { included: false, tokens: 1990 }), item('a', 1)] });
    const walk = budgetWalk(rec);
    expect(walk.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(walk.map((i) => i.remaining)).toEqual([2000, 1900, 1900]);
    expect(walk[1]!.why).toBe('Left out: needs 1990 tokens, 1900 left in the budget');
    expect(walk[2]!.offset).toBe(100); expect(rec.items[0]!.id).toBe('c');
  });
  it('explains forced inclusion, a budget reason, and other recall exclusions', () => {
    const walk = budgetWalk(recall({ items: [item('a', 1, { tokens: 2200 }), item('b', 2, { included: false, tokens: 1 })] }));
    expect(walk[0]!.why).toContain('top memory is always included'); expect(walk[1]!.why).toContain('0 left');
    expect(budgetWalk(recall({ items: [item('x', 1, { included: false })] }))[0]!.why).toBe('Left out by the recall');
    expect(budgetWalk(recall({ items: [item('x', 1, { included: false, reason: 'over_budget' })] }))[0]!.why).toContain('left in the budget');
  });
  it('infers the best earlier vector neighbour before an earlier graph neighbour, in either direction', () => {
    const items = [item('later', 5), item('g', 1, { via: 'graph' }), item('v2', 3), item('target', 4, { via: 'graph' }), item('v1', 2), item('unknown', 6, { via: 'graph' })];
    const edges = ['g', 'v1', 'v2', 'later'].map((id, i) => ({ sourceId: i % 2 ? 'target' : id, targetId: i % 2 ? id : 'target', relationship: 'relates_to', strength: 1 }));
    const pullers = inferPullers(items, edges);
    expect(pullers.get('target')).toBe('v1'); expect(pullers.get('v1')).toBeNull(); expect(pullers.get('unknown')).toBeNull();
    expect(inferPullers(items, edges.slice(0, 1)).get('target')).toBe('g');
    expect(inferPullers(items, edges.slice(3)).get('target')).toBeNull();
  });
  it('lays out ranks outward, groups region angles, and dates the outward wave', () => {
    const model = pulseLayout(recall(), payload(), graph.edges, 700);
    expect(model.items.map((i) => i.radius)).toEqual([...model.items.map((i) => i.radius)].sort((a, b) => a - b));
    expect(model.sectors.map((s) => s.id)).toEqual(['r1', 'r2']);
    for (const item of model.items) {
      const sector = model.sectors.find((s) => s.id === item.regionId)!;
      expect(item.angle).toBeGreaterThan(sector.start); expect(item.angle).toBeLessThan(sector.end);
      expect(Math.hypot(item.x, item.y)).toBeCloseTo(item.radius);
    }
    expect(model.items[3]!.size).toBeGreaterThan(model.items[0]!.size);
    expect(model.items[3]!.time).toBeGreaterThan(model.items[0]!.time);
    expect(model.budgetRadius).toBe(model.radius(3) + 5);
  });
  it('handles empty, single-region, off-map and phone layouts without invalid geometry', () => {
    const empty = pulseLayout(recall({ items: [] }), payload(), [], 390);
    expect(empty.budgetRadius).toBeNull(); expect(empty.items).toEqual([]);
    const model = pulseLayout(recall({ items: [item('off-map', 1)] }), payload(), [], 320);
    expect(model.narrow).toBe(true); expect(model.items[0]!.label).toBe('(memory not on the map)');
    expect(model.sectors[0]!.name).toBe('Not on the map'); expect(model.items[0]!.angle).toBeCloseTo(Math.PI / 2, 2);
    expect(model.sectors[0]!.end - model.sectors[0]!.start).toBeLessThan(Math.PI * 2);
  });
  it('returns deterministic included and excluded animation frames, with a settled end', () => {
    const model = pulseLayout(recall(), payload(), [], 640);
    const inside = model.items[0]!, outside = model.items[3]!;
    expect(dotFrame(inside, 0)).toMatchObject({ active: false, alpha: 0.28 });
    expect(dotFrame(inside, inside.time + 90).scale).toBeCloseTo(1.9);
    expect(dotFrame(inside, END_MS)).toMatchObject({ active: true, scale: 1, alpha: 1 });
    expect(dotFrame(outside, outside.time + 20)).toMatchObject({ fault: true, alpha: 0.95 });
    expect(dotFrame(outside, outside.time + 100).alpha).toBe(0.2);
    expect(dotFrame(outside, outside.time + 200).alpha).toBe(0.8);
    expect(dotFrame(outside, outside.time + 400).outward).toBeGreaterThan(0);
    expect(dotFrame(outside, END_MS)).toMatchObject({ outward: 5, fault: false });
    expect(dotFrame(outside, END_MS).alpha).toBeCloseTo(0.32);
    expect([clamp(-1), clamp(2), smooth(0.5)]).toEqual([0, 1, 0.5]);
  });
  it('reverses lower-half rim labels to keep them upright', () => {
    expect(rimPath(0, Math.PI, 100).lower).toBe(true);
    expect(rimPath(-Math.PI, 0, 100).lower).toBe(false);
    expect(rimPath(0, Math.PI * 1.5, 100).path).toContain(' 0 1 ');
  });
});
