import { describe, expect, it } from 'vitest';
import { binRiver, dateLabel, DAY, hash, historyWindow, particlePosition, retentionDepth, riverLayout, spline, whirlpoolCounts } from '../river.js';
import { graph, node, payload } from './fixtures.js';

describe('River data', () => {
  it('pads the dated history and gives an empty history a finite range', () => {
    expect(historyWindow([])).toEqual([0, DAY * 4]);
    expect(historyWindow([node('a', { createdAt: new Date(DAY * 10).toISOString() }), node('bad', { createdAt: 'invalid' })])).toEqual([DAY * 8, DAY * 12]);
    expect(dateLabel(Date.UTC(2026, 0, 2))).toMatch(/Jan 2, 2026/);
  });
  it('bins by creation time with padded steps and sorts regions by size', () => {
    const p = payload(); const window = historyWindow(p.nodes);
    const bins = binRiver(p, window, 800);
    expect(bins.steps).toBe(40); expect(bins.rows).toHaveLength(48);
    expect(bins.keys).toEqual(['r1', 'r2']);
    expect(bins.rows.reduce((sum, row) => sum + Object.values(row).reduce((a, b) => a + b, 0), 0)).toBe(5);
    expect(binRiver(p, window, 100).steps).toBe(18);
    expect(binRiver(p, window, 2000).steps).toBe(72);
  });
  it('shares square-root total width in proportion to region counts', () => {
    const p = payload({ nodes: [node('a'), node('b'), node('c'), node('d', { regionId: 'r2' })] });
    const bins = binRiver(p, historyWindow(p.nodes), 800);
    const row = bins.scaled.find((r) => r.r1! > 0)!;
    expect(row.r1).toBe(1.5); expect(row.r2).toBe(0.5);
    expect(Object.values(row).reduce((a, b) => a + b, 0)).toBe(2);
  });
  it('ignores invalid dates, out-of-window dates and unknown regions in the stack', () => {
    const p = payload({ nodes: [node('a', { createdAt: 'invalid' }), node('b', { regionId: 'missing' }), node('c', { createdAt: new Date(0).toISOString() })] });
    const bins = binRiver(p, [DAY * 100, DAY * 101], 800);
    expect(bins.rows.every((r) => Object.values(r).every((n) => n === 0))).toBe(true);
  });
  it('dates each contradiction by the later endpoint and aggregates within its region and step', () => {
    const p = payload(); const full = historyWindow(p.nodes); const bins = binRiver(p, full, 800);
    const edges = [...graph.edges, { ...graph.edges[1]!, sourceId: 'd', targetId: 'c' }, { ...graph.edges[1]!, sourceId: 'missing' }];
    const counts = whirlpoolCounts(p.nodes, edges, full, bins.duration);
    expect(counts).toHaveLength(1); expect(counts[0]).toMatchObject({ regionId: 'r2', count: 2 });
    expect(counts[0]!.bin).toBe(bins.bin(Date.parse(p.nodes[3]!.createdAt)));
    expect(whirlpoolCounts(p.nodes, edges, [0, DAY], DAY / 18)).toEqual([]);
  });
  it('uses the source on equal dates and keeps a right-boundary event in the last bin', () => {
    const nodes = [node('a', { createdAt: new Date(DAY).toISOString() }), node('b', { regionId: 'r2', createdAt: new Date(DAY).toISOString() })];
    expect(whirlpoolCounts(nodes, [{ sourceId: 'a', targetId: 'b', relationship: 'contradicts', strength: 1 }], [0, DAY], DAY / 2)[0]).toMatchObject({ regionId: 'r1', bin: 1 });
    nodes[0]!.createdAt = 'bad'; nodes[1]!.createdAt = 'bad';
    expect(whirlpoolCounts(nodes, [{ sourceId: 'a', targetId: 'b', relationship: 'contradicts', strength: 1 }], [0, DAY], DAY)).toEqual([]);
  });
  it('maps retention on a clamped logarithmic scale', () => {
    expect([0, 1e-6, 1e-5, 1e-3, 1, 2].map(retentionDepth)).toEqual([0, 0, 0, 0.4, 1, 1]);
  });
  it('uses stable seeded particle positions and a basis spline with clamped endpoints', () => {
    expect(hash('abc', 1)).toBe(hash('abc', 1)); expect(hash('abc', 1)).not.toBe(hash('abc', 2));
    expect(hash('abc', 1)).toBeGreaterThanOrEqual(0); expect(hash('abc', 1)).toBeLessThan(1);
    expect(spline([[2, 4], [2, 4]], 0.5, 1)).toBe(4);
    expect(spline([[2, 4], [2, 4]], -5, 0)).toBe(2);
  });
  it('keeps drifting particles within their creation step and their smoothed band', () => {
    const p = payload(), model = riverLayout(p, graph.edges, historyWindow(p.nodes), 800, 460);
    expect(model.eddies).toHaveLength(1);
    for (const particle of model.particles) for (const seconds of [0, 1, 40, 1000]) {
      const pos = particlePosition(particle, model, seconds, false);
      expect(pos.x).toBeGreaterThanOrEqual(particle.bin * model.dx);
      expect(pos.x).toBeLessThan((particle.bin + 1) * model.dx);
      const [top, bottom] = model.bands.find((b) => b.id === particle.node.regionId)!.bounds(pos.x);
      expect(pos.y).toBeGreaterThanOrEqual(top); expect(pos.y).toBeLessThanOrEqual(bottom);
      expect(pos.alpha).toBeGreaterThanOrEqual(0); expect(pos.alpha).toBeLessThanOrEqual(1);
    }
    expect(particlePosition(model.particles[0]!, model, 0, true)).toEqual(particlePosition(model.particles[0]!, model, 100, true));
  });
  it('keeps sparse and empty layouts finite, without inventing regions', () => {
    const p = payload({ nodes: [], regions: [] });
    const model = riverLayout(p, [], historyWindow([]), 390, 400);
    expect(model.bands).toEqual([]); expect(model.particles).toEqual([]); expect(model.eddies).toEqual([]);
    expect(Number.isFinite(model.pixelsPerUnit)).toBe(true);
    const one = payload({ nodes: [node('one')] });
    expect(riverLayout(one, [], historyWindow(one.nodes), 390, 400).particles[0]!.radius).toBe(3);
  });
});
