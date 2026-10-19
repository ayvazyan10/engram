import { describe, expect, it } from 'vitest';
import { pca2 } from '../pca.js';
import { align, insertPoints, project } from './project.js';
import { regionGroups } from './regions.js';
import { regionNames } from './names.js';

describe('map geometry', () => {
  it('projects onto two deterministic components and reports degeneracy', () => {
    const vectors = [-2, -1, 0, 1, 2].map((x) => new Float32Array([x, x * 2, 0]));
    const fit = pca2(vectors)!;
    expect(fit).toEqual(pca2(vectors));
    expect(fit.explained[0]).toBeCloseTo(1);
    expect(fit.explained[1]).toBeCloseTo(0);
    expect(pca2([vectors[0]!, vectors[1]!])).toBeNull();
    expect(pca2(Array.from({ length: 4 }, () => new Float32Array([1, 1])))).toBeNull();
  });

  it('uses a similarity-weighted centroid without changing any existing point', () => {
    const previous = [{ id: 'a', x: -0.5, y: 0.5 }, { id: 'b', x: 0.5, y: -0.5 }];
    const result = insertPoints(['a', 'b', 'c'], [
      { sourceId: 'c', targetId: 'a', strength: 1 },
      { sourceId: 'b', targetId: 'c', strength: 0.5 },
    ], previous);
    expect(result.slice(0, 2)).toEqual(previous);
    expect(result[2]!.x).toBeCloseTo(-1 / 6);
    expect(result[2]!.y).toBeCloseTo(1 / 6);
  });

  it('aligns rotated, scaled, translated and mirrored recomputes', () => {
    const previous = [{ id: 'a', x: 0, y: 0 }, { id: 'b', x: 1, y: 0 }, { id: 'c', x: 0, y: 1 }];
    for (const sign of [1, -1]) {
      const transformed = previous.map((p) => ({ id: p.id, x: 3 - p.y * 2, y: -4 + p.x * 2 * sign }));
      align(transformed, previous).forEach((p, i) => {
        expect(p.x).toBeCloseTo(previous[i]!.x);
        expect(p.y).toBeCloseTo(previous[i]!.y);
      });
    }
  });

  it('runs a deterministic bounded force refinement', async () => {
    const rows = Array.from({ length: 32 }, (_, i) => ({ id: String(i), vector: new Float32Array([Math.sin(i), Math.cos(i), i % 4]) }));
    const links = rows.slice(1).map((r, i) => ({ sourceId: r.id, targetId: rows[i]!.id, strength: 0.8 }));
    const a = await project(rows, links);
    expect(await project(rows, links)).toEqual(a);
    expect(a.method).toBe('pca2+knn');
    for (const p of a.points) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1);
    }
  });
});

describe('map regions', () => {
  it('finds linked communities, merges small neighbours and keeps medoid IDs stable', () => {
    const points = Array.from({ length: 19 }, (_, i) => ({ id: `m${i}`, x: i < 9 ? -0.8 : 0.8, y: (i % 9) * 0.01 }));
    const links = [];
    for (let i = 0; i < 18; i++) for (let j = i + 1; j < 18; j++) {
      if (Math.floor(i / 9) === Math.floor(j / 9)) links.push({ sourceId: `m${i}`, targetId: `m${j}`, strength: 0.9 });
    }
    const groups = regionGroups(points, links);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.members.length).sort()).toEqual([10, 9]);
    expect(regionGroups(points, links)).toEqual(groups);
    expect(groups.every((g) => g.members.some((i) => points[i]!.id === g.id))).toBe(true);
    expect(regionGroups([], [])).toEqual([]);
  });

  it('names regions from distinguishing tags/concepts and ignores machine/reflection tags', () => {
    const rows = [
      { tags: ['database', 'reflection:insight', 'mc:job'], concept: 'Postgres' },
      { tags: ['database'], concept: 'Postgres' },
      { tags: ['bread'], concept: 'Sourdough' },
    ];
    const names = regionNames(rows, [[0, 1], [2]]);
    expect(names[0]!.name).toBe('database · postgres');
    expect(names[0]!.topTags).toEqual(['database']);
    expect(names[1]!.name).toBe('bread · sourdough');
  });
});
