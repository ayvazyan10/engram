/**
 * The label rule, tested without a WebGL context.
 *
 * The old rule (`type === 'semantic' && importance > 0.75`) put 118 labels on
 * screen out of 200 loaded nodes, of which only 55 were distinct. These tests
 * pin the two things that fixed it: a screen-space greedy accept, and a cap
 * that the focus set is allowed to exceed.
 */

import { describe, it, expect } from 'vitest';
import { declutter, labelRect } from '../NeuronLabels.js';

interface Item {
  id: string;
  rect: ReturnType<typeof labelRect>;
  forced: boolean;
}

const item = (id: string, x: number, y: number, length = 14, forced = false): Item => ({
  id,
  rect: labelRect(x, y, length),
  forced,
});

describe('declutter', () => {
  it('keeps the first candidate and rejects anything that overlaps it', () => {
    const kept = declutter([item('a', 100, 100), item('b', 104, 102), item('c', 400, 100)], 12);
    expect(kept.map((k) => k.id)).toEqual(['a', 'c']);
  });

  it('respects the cap for ambient labels', () => {
    const spread = Array.from({ length: 40 }, (_, i) => item(`n${i}`, 40 + i * 300, 60 + i * 90));
    expect(declutter(spread, 12)).toHaveLength(12);
  });

  it('lets forced (selected / hovered / neighbour) labels through past the cap', () => {
    const ambient = Array.from({ length: 20 }, (_, i) => item(`a${i}`, 40 + i * 300, 60 + i * 90));
    const forced = Array.from({ length: 6 }, (_, i) =>
      item(`f${i}`, 5000 + i * 300, 5000 + i * 90, 14, true)
    );
    const kept = declutter([...forced, ...ambient], 12);
    expect(kept.filter((k) => k.forced)).toHaveLength(6);
    expect(kept.filter((k) => !k.forced)).toHaveLength(12);
  });

  it('still refuses a forced label that would sit on top of one already placed', () => {
    const kept = declutter([item('a', 100, 100, 14, true), item('b', 101, 100, 14, true)], 12);
    expect(kept.map((k) => k.id)).toEqual(['a']);
  });

  it('accepts everything when nothing overlaps and the cap is generous', () => {
    const spread = Array.from({ length: 5 }, (_, i) => item(`n${i}`, 50 + i * 400, 40 + i * 120));
    expect(declutter(spread, 12)).toHaveLength(5);
  });
});

describe('labelRect', () => {
  it('grows with the text, up to a bound', () => {
    expect(labelRect(0, 0, 20).w).toBeGreaterThan(labelRect(0, 0, 5).w);
    // A very long concept must not reserve half the viewport: the text itself
    // is sliced to the same bound before it is drawn.
    expect(labelRect(0, 0, 400).w).toBe(labelRect(0, 0, 34).w);
  });

  it('is centred on the point it was given', () => {
    const rect = labelRect(120, 240, 10);
    expect(rect.x).toBe(120);
    expect(rect.y).toBe(240);
    expect(rect.h).toBeGreaterThan(0);
  });
});
