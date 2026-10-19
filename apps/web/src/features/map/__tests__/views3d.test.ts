import { describe, expect, it } from 'vitest';
import { brightness, DAY, depthByAge, phase } from '../views/sky.js';
import { archiveDay, decayProjection, decades, DEFAULT_POLICY, GRID, heightAt, heightField } from '../views/landscape.js';
import { node, NOW } from './payload.js';

const aged = (id: string, age: number, regionId: string) => node(id, { regionId, createdAt: new Date(NOW - age * DAY).toISOString() });

describe('sky depth and visual encodings', () => {
  it('puts older regions behind newer ones and preserves meaning coordinates', () => {
    const nodes = [aged('new', 1, 'a'), aged('old', 90, 'b')];
    nodes[0]!.x = 0.5; nodes[0]!.y = -0.25;
    const p = depthByAge(nodes, NOW);
    expect([...p.slice(0, 2)]).toEqual([35, -17.5]);
    expect(p[2]).toBeGreaterThan(p[5]!);
  });
  it('orders a region by age over ten units, including equal-age regions and singletons', () => {
    const p = depthByAge([aged('old', 10, 'a'), aged('new', 0, 'a'), aged('solo', 5, 'b')], NOW);
    expect(p[5]! - p[2]!).toBe(10);
    expect([...p].every(Number.isFinite)).toBe(true);
    expect(depthByAge([], NOW)).toHaveLength(0);
  });
  it('uses bounded log retention brightness and stable per-id twinkling', () => {
    expect(brightness(0)).toBe(0.16);
    expect(brightness(1)).toBe(1);
    expect(brightness(4)).toBe(1);
    expect(brightness(0.1)).toBeGreaterThan(brightness(0.01));
    expect(phase('a-memory')).toBe(phase('a-memory'));
    expect(phase('a-memory')).not.toBe(phase('b-memory'));
    expect(phase('a-memory')).toBeGreaterThanOrEqual(0);
    expect(phase('a-memory')).toBeLessThan(1);
  });
});

describe('landscape decay projection', () => {
  it('halves every policy half-life without changing today or projecting into the past', () => {
    expect(decayProjection(0.8, 0)).toBe(0.8);
    expect(decayProjection(0.8, 7)).toBe(0.4);
    expect(decayProjection(0.8, 14)).toBe(0.2);
    expect(decayProjection(0.8, 10, 10)).toBe(0.4);
    expect(decayProjection(0.8, -10)).toBe(0.8);
  });
  it('archives at the threshold, already faded at day zero, but never protected memories', () => {
    expect(archiveDay({ retention: 0.1, protected: false })).toBe(7);
    expect(archiveDay({ retention: 0.05, protected: false })).toBe(0);
    expect(archiveDay({ retention: 0, protected: false })).toBe(0);
    expect(archiveDay({ retention: 0, protected: true })).toBe(Infinity);
    expect(archiveDay({ retention: 0.8, protected: false }, { halfLifeDays: 10, archiveThreshold: 0.2 })).toBe(20);
  });
  it('builds a symmetric Gaussian field, summing retention and excluding archived nodes', () => {
    const memory = node('one', { x: 0, y: 0, retention: 0.1, protected: false });
    const field = heightField([memory], 0);
    expect(field).toHaveLength(GRID * GRID);
    const central = (GRID / 2) * GRID + GRID / 2;
    expect(field[central]).toBeGreaterThan(0.09);
    expect(field[central]).toBeCloseTo(field[central - 1]!);
    expect(field[0]).toBe(0);
    const doubled = heightField([memory, { ...memory, id: 'two' }], 0);
    expect(doubled[central]).toBeCloseTo(field[central]! * 2);
    expect(heightField([memory], 7).every((n) => n === 0)).toBe(true);
    expect(heightField([{ ...memory, protected: true }], 90)[central]).toBeGreaterThan(0);
  });
  it('interpolates heights in log decades and clamps the sea floor and field edges', () => {
    const field = new Float32Array(GRID * GRID).fill(0.5);
    expect(heightAt(field, 0, 0, 0.05)).toBeCloseTo(1);
    expect(heightAt(field, 20, -20, 0.05)).toBeCloseTo(1);
    expect(decades(0, DEFAULT_POLICY.archiveThreshold)).toBe(-3);
    expect(decades(0.05, 0.05)).toBe(0);
    expect(heightAt(heightField([], 0), 0, 0, 0.05)).toBe(-3);
  });
});
