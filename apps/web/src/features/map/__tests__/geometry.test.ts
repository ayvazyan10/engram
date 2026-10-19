import { describe, it, expect } from 'vitest';
import {
  LAYOUT_SIZE,
  between,
  boundsOf,
  centreOn,
  contains,
  easeCubicInOut,
  easeExpoOut,
  fitView,
  toLayout,
  toLayoutPoint,
  toScreen,
  visibleArea,
} from '../lib/project.js';
import { buildIndex, pick, step } from '../lib/hitTest.js';
import { placeLabels } from '../lib/labels.js';
import { rampColour, ringsToPath, terrain } from '../lib/terrain.js';
import { buildModel, regionMembers } from '../lib/model.js';
import { payload } from './payload.js';

describe('project: world, layout and screen', () => {
  it('puts the world square inside the layout square with a margin, y turned downward', () => {
    const [cx, cy] = toLayout(0, 0);
    expect(cx).toBeCloseTo(LAYOUT_SIZE / 2);
    expect(cy).toBeCloseTo(LAYOUT_SIZE / 2);
    const [left, top] = toLayout(-1, 1);
    expect(left).toBeGreaterThan(0);
    expect(top).toBeGreaterThan(0);
    expect(toLayout(0, 1)[1]).toBeLessThan(toLayout(0, -1)[1]);
  });

  it('boxes every point, or only the ones asked for, and nothing at all', () => {
    const xs = [10, 50, 30];
    const ys = [5, 40, 90];
    expect(boundsOf(xs, ys)).toEqual({ left: 10, right: 50, top: 5, bottom: 90 });
    expect(boundsOf(xs, ys, [0, 1])).toEqual({ left: 10, right: 50, top: 5, bottom: 40 });
    expect(boundsOf([], [])).toBeNull();
  });

  it('fits a box into an area, centred, and does not zoom one point into a blur', () => {
    const area = { left: 0, top: 0, right: 800, bottom: 400 };
    const view = fitView({ left: 100, right: 300, top: 100, bottom: 200 }, area, 1);
    expect(view.k).toBe(4);
    expect(toScreen(view, 200, 150)).toEqual([400, 200]);
    const one = fitView({ left: 50, right: 50, top: 50, bottom: 50 }, area, 1);
    expect(one.k).toBeCloseTo(400 / 60);
  });

  it('centres a layout point and maps screen back to layout', () => {
    const area = { left: 100, top: 0, right: 500, bottom: 300 };
    const view = centreOn({ k: 1, x: 0, y: 0 }, 10, 20, area, 3);
    expect(toScreen(view, 10, 20)).toEqual([300, 150]);
    expect(toLayoutPoint(view, 300, 150)).toEqual([10, 20]);
    expect(contains(area, 300, 150)).toBe(true);
    expect(contains(area, 105, 150, 10)).toBe(false);
  });

  it('keeps the map clear of a side sheet on the right, or a bottom sheet, and of the field on top', () => {
    expect(visibleArea(1000, 800, { left: 600, top: 0, right: 1000, bottom: 800 }, 120)).toEqual({ left: 0, top: 120, right: 600, bottom: 800 });
    expect(visibleArea(390, 800, { left: 0, top: 450, right: 390, bottom: 800 }, 110)).toEqual({ left: 0, top: 110, right: 390, bottom: 450 });
    expect(visibleArea(390, 800, null, 0)).toEqual({ left: 0, top: 0, right: 390, bottom: 800 });
  });

  it('glides from one view to another through the middle, ending exactly on both', () => {
    const area = { left: 0, top: 0, right: 200, bottom: 200 };
    const from = centreOn({ k: 1, x: 0, y: 0 }, 0, 0, area, 1);
    const to = centreOn({ k: 1, x: 0, y: 0 }, 100, 100, area, 4);
    expect(between(from, to, 0, area)).toEqual(from);
    const end = between(from, to, 1, area);
    expect(end.k).toBeCloseTo(4);
    expect(end.x).toBeCloseTo(to.x);
    expect(between(from, to, 0.5, area).k).toBeCloseTo(2);
  });

  it('eases in and out, and settles at exactly 1', () => {
    expect(easeCubicInOut(0)).toBe(0);
    expect(easeCubicInOut(0.5)).toBe(0.5);
    expect(easeCubicInOut(1)).toBe(1);
    expect(easeExpoOut(1)).toBe(1);
    expect(easeExpoOut(0.3)).toBeGreaterThan(0.8);
  });
});

describe('hitTest', () => {
  // A plus sign: centre 0, then up, down, left, right; and one far away.
  const xs = [100, 100, 100, 60, 140, 400];
  const ys = [100, 60, 140, 100, 100, 400];
  const index = buildIndex(xs, ys);
  const view = { k: 1, x: 0, y: 0 };

  it('picks the memory under the pointer, within reach and when the lens shows it', () => {
    expect(pick(index, xs, ys, view, 103, 98, 14)).toBe(0);
    expect(pick(index, xs, ys, view, 250, 250, 14)).toBe(-1);
    expect(pick(index, xs, ys, view, 103, 98, 14, (i) => i !== 0)).toBe(-1);
    expect(pick(buildIndex([], []), [], [], view, 0, 0, 14)).toBe(-1);
  });

  it('steps to the neighbour in the direction of the arrow', () => {
    expect(step(index, xs, ys, 0, 'up')).toBe(1);
    expect(step(index, xs, ys, 0, 'down')).toBe(2);
    expect(step(index, xs, ys, 0, 'left')).toBe(3);
    expect(step(index, xs, ys, 0, 'right')).toBe(4);
  });

  it('skips what the lens hides, reaches past the cluster, and stops at the edge', () => {
    expect(step(index, xs, ys, 0, 'up', (i) => i !== 1)).toBe(-1);
    expect(step(index, xs, ys, 2, 'down')).toBe(5);
    expect(step(index, xs, ys, 3, 'left')).toBe(-1);
  });
});

describe('placeLabels', () => {
  const area = { left: 0, top: 0, right: 600, bottom: 400 };

  it('keeps a label on its anchor when there is room, and nudges the next one clear of it', () => {
    const out = placeLabels(
      [
        { id: 'big', x: 300, y: 200, w: 120, h: 30 },
        { id: 'small', x: 310, y: 205, w: 100, h: 30 },
      ],
      area
    );
    expect(out.get('big')).toEqual({ x: 300, y: 200 });
    expect(out.get('small')).toEqual({ x: 310, y: 205 - 30 - 26 });
  });

  it('hides a label whose anchor is off the map, and keeps one at the edge inside it', () => {
    const out = placeLabels(
      [
        { id: 'off', x: -20, y: 100, w: 80, h: 20 },
        { id: 'edge', x: 590, y: 100, w: 100, h: 20 },
      ],
      area
    );
    expect(out.get('off')).toBeNull();
    expect(out.get('edge')!.x).toBe(600 - 50 - 6);
  });

  it('shows fewer names on a small map', () => {
    const boxes = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, x: 20 + i * 45, y: 60, w: 30, h: 16 }));
    const small = placeLabels(boxes, { left: 0, top: 0, right: 360, bottom: 140 });
    expect([...small.values()].filter(Boolean)).toHaveLength(2);
  });
});

describe('terrain', () => {
  it('writes d3 contour rings as one path, holes included', () => {
    expect(
      ringsToPath([
        [
          [
            [0, 0],
            [10, 0],
            [10, 10],
          ],
          [
            [2, 2],
            [3, 2],
            [3, 3],
          ],
        ],
      ])
    ).toBe('M0 0L10 0L10 10ZM2 2L3 2L3 3Z');
  });

  it('raises ground where memories crowd, lowest band first, every fourth line an index contour', () => {
    const xs = Array.from({ length: 60 }, (_, i) => 300 + (i % 6) * 4);
    const ys = Array.from({ length: 60 }, (_, i) => 300 + Math.floor(i / 6) * 4);
    const levels = terrain(xs, ys);
    expect(levels.length).toBeGreaterThan(3);
    expect(levels[0]!.height).toBe(0);
    expect(levels.at(-1)!.height).toBe(1);
    expect(levels.map((l) => l.index).slice(0, 4)).toEqual([false, false, false, true]);
    expect(levels[0]!.path.startsWith('M')).toBe(true);
    expect(terrain([1, 2], [1, 2])).toEqual([]);
  });

  it('blends along the ramp, and falls back when it cannot read a colour', () => {
    expect(rampColour(['#000000', '#ffffff'], 0)).toBe('rgb(0,0,0)');
    expect(rampColour(['#000000', '#ffffff'], 0.5)).toBe('rgb(128,128,128)');
    expect(rampColour(['#000000', '#ffffff'], 2)).toBe('rgb(255,255,255)');
    expect(rampColour(['red', '#ffffff'], 0.5)).toBe('red');
    expect(rampColour([], 0.5)).toBe('transparent');
  });
});

describe('buildModel', () => {
  it('lays the payload out once: positions, index, terrain, regions biggest first, and their anchors', () => {
    const model = buildModel(payload());
    expect(model.nodes).toHaveLength(5);
    expect(model.at.get('d')).toBe(3);
    expect(model.xs[0]).toBeLessThan(model.xs[3]!);
    expect(model.created[0]).toBe(Date.parse(model.nodes[0]!.createdAt));
    expect(model.regions.map((r) => r.id)).toEqual(['r1', 'r2']);
    expect(model.anchors.get('r2')![0]).toBeGreaterThan(LAYOUT_SIZE / 2);
    expect(model.bounds).not.toBeNull();
    expect(regionMembers(model, 'r2')).toEqual([3, 4]);
    const marked = payload();
    marked.nodes[0] = { ...marked.nodes[0]!, label: '# Trend **Analysis**' };
    expect(buildModel(marked).nodes[0]!.label).toBe('Trend Analysis');
    expect(marked.nodes[0]!.label).toBe('# Trend **Analysis**');
  });
});
