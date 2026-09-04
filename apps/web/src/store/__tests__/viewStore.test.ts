import { describe, it, expect, vi } from 'vitest';
import {
  VIEWS,
  WORLD_HALF_EXTENT,
  fallbackSceneNodes,
  resolveView,
  useViewStore,
  type SceneNodeInput,
} from '../viewStore.js';
import type { MemoryRecord } from '../memoryStore.js';
import { TYPE_COLORS, hexToInt } from '../../lib/tokens.js';

const TYPES: SceneNodeInput['type'][] = ['episodic', 'semantic', 'procedural'];

/** Deterministic stand-in for what GET /api/graph/layout returns. */
function makeNode(id: string, overrides: Partial<SceneNodeInput> = {}): SceneNodeInput {
  const seed = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 9973, 7);
  return {
    id,
    type: 'semantic',
    label: `label ${id}`,
    importance: 0.5,
    source: null,
    accessCount: seed % 40,
    createdAt: '2026-01-01T00:00:00.000Z',
    lastAccessedAt: null,
    x: ((seed % 84) - 42) * 0.9,
    y: (((seed * 7) % 84) - 42) * 0.9,
    z: (((seed * 13) % 84) - 42) * 0.9,
    projected: true,
    ...overrides,
  };
}

function makeNodes(n: number): SceneNodeInput[] {
  return Array.from({ length: n }, (_, i) =>
    makeNode(`mem-${i}`, { type: TYPES[i % 3], importance: (i % 10) / 10 })
  );
}

function findPos(list: ReturnType<(typeof VIEWS)[number]['layout']>, id: string) {
  const found = list.find((p) => p.id === id);
  if (!found) throw new Error(`missing position for ${id}`);
  return { x: found.x, y: found.y, z: found.z };
}

describe('the view set after Nebula and Galaxy were removed', () => {
  it('is exactly Cosmos, Neural Net and Clusters', () => {
    expect(VIEWS.map((v) => v.id)).toEqual(['cosmos', 'neural', 'clusters']);
  });

  it('leaves nothing dangling: an unknown or removed view id resolves to the default', () => {
    for (const stale of ['nebula', 'galaxy', 'not-a-view', '', null, undefined]) {
      expect(resolveView(stale).id).toBe('cosmos');
    }
  });

  it('setView stores the RESOLVED id, so a persisted "nebula" cannot leave the switcher lit on nothing', () => {
    useViewStore.getState().setView('nebula');
    expect(useViewStore.getState().activeViewId).toBe('cosmos');
    expect(useViewStore.getState().activeView.id).toBe('cosmos');

    useViewStore.getState().setView('clusters');
    expect(useViewStore.getState().activeViewId).toBe('clusters');
    useViewStore.getState().setView('cosmos');
  });

  it('every surviving view uses the canonical TYPE_COLORS — the footer legend is not allowed to be false', () => {
    for (const view of VIEWS) {
      expect(view.theme.colors).toEqual({
        episodic: hexToInt(TYPE_COLORS.episodic),
        semantic: hexToInt(TYPE_COLORS.semantic),
        procedural: hexToInt(TYPE_COLORS.procedural),
      });
    }
  });

  it('gives each view its own framing, since framing is now what distinguishes them', () => {
    const framings = VIEWS.map(
      (v) => `${v.theme.camera.direction.join(',')}|${v.theme.camera.frameRadius}|${v.theme.camera.target.join(',')}`
    );
    expect(new Set(framings).size).toBe(VIEWS.length);
  });

  it('frames each view around content that actually fits inside its frameRadius', () => {
    const nodes = makeNodes(120);
    for (const view of VIEWS) {
      const placed = view.layout(nodes);
      const [tx, ty, tz] = view.theme.camera.target;
      const reach = Math.max(
        ...placed.map((p) => Math.max(Math.abs(p.x - tx), Math.abs(p.y - ty), Math.abs(p.z - tz)))
      );
      // The rig solves the camera distance from frameRadius, so a radius smaller
      // than the content silently crops it — which is exactly how the old fixed
      // camera positions cut the Neural Net bands off at the edge of the canvas.
      expect(view.theme.camera.frameRadius, view.id).toBeGreaterThanOrEqual(reach);
    }
  });
});

describe('view layouts are deterministic (F3)', () => {
  for (const view of VIEWS) {
    describe(`${view.id} view`, () => {
      it('gives the same position for the same node across two independent calls', () => {
        const nodes = makeNodes(30);
        const first = view.layout(nodes);
        const second = view.layout(nodes.map((n) => ({ ...n })));
        for (const n of nodes) {
          expect(findPos(second, n.id)).toEqual(findPos(first, n.id));
        }
      });

      it('does not move an existing node when an unrelated one is prepended', () => {
        const nodes = makeNodes(20);
        const before = view.layout(nodes);
        const after = view.layout([makeNode('mem-new'), ...nodes]);
        for (const n of nodes) {
          expect(findPos(after, n.id)).toEqual(findPos(before, n.id));
        }
      });

      it('does not move remaining nodes when one is removed', () => {
        const nodes = makeNodes(20);
        const before = view.layout(nodes);
        const remaining = nodes.filter((n) => n.id !== 'mem-5');
        const after = view.layout(remaining);
        for (const n of remaining) {
          expect(findPos(after, n.id)).toEqual(findPos(before, n.id));
        }
      });

      it('spreads distinct nodes across distinct positions', () => {
        const positions = view.layout(makeNodes(20));
        expect(new Set(positions.map((p) => Math.round(p.x * 1000))).size).toBeGreaterThan(1);
      });

      it('carries recency and retrieval count through to the renderer', () => {
        const [placed] = view.layout([
          makeNode('m', { accessCount: 17, createdAt: '2026-02-03T00:00:00.000Z', lastAccessedAt: '2026-02-09T00:00:00.000Z' }),
        ]);
        expect(placed!.accessCount).toBe(17);
        expect(placed!.createdAtMs).toBe(Date.parse('2026-02-03T00:00:00.000Z'));
        expect(placed!.lastAccessedAtMs).toBe(Date.parse('2026-02-09T00:00:00.000Z'));
      });
    });
  }

  it('never calls Math.random — positions come from the projection plus a deterministic hash', () => {
    const spy = vi.spyOn(Math, 'random');
    const nodes = makeNodes(15);
    for (const view of VIEWS) view.layout(nodes);
    fallbackSceneNodes([]);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('every view draws the same projection', () => {
  const nodes = makeNodes(90);

  it('Cosmos shows the projection itself, moved only by the anti-overlap jitter', () => {
    const cosmos = VIEWS.find((v) => v.id === 'cosmos')!;
    for (const placed of cosmos.layout(nodes)) {
      const source = nodes.find((n) => n.id === placed.id)!;
      expect(Math.abs(placed.x - source.x)).toBeLessThan(0.5);
      expect(Math.abs(placed.y - source.y)).toBeLessThan(0.5);
      expect(Math.abs(placed.z - source.z)).toBeLessThan(0.5);
    }
  });

  it('Neural Net separates the three types into non-overlapping bands along X', () => {
    const net = VIEWS.find((v) => v.id === 'neural')!;
    const placed = net.layout(nodes);
    const ranges = TYPES.map((type) => {
      const xs = placed.filter((p) => p.type === type).map((p) => p.x);
      return { type, min: Math.min(...xs), max: Math.max(...xs) };
    }).sort((a, b) => a.min - b.min);

    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]!.min).toBeGreaterThan(ranges[i - 1]!.max);
    }
  });

  it('Neural Net still orders nodes within a band by their projection', () => {
    const net = VIEWS.find((v) => v.id === 'neural')!;
    const placed = net.layout(nodes);
    // Similarity governs inside a band: Y is the projection's Y, untouched
    // except by the sub-unit anti-overlap jitter.
    for (const node of nodes.filter((n) => n.type === 'semantic')) {
      const own = placed.find((p) => p.id === node.id)!;
      expect(Math.abs(own.y - node.y)).toBeLessThan(0.5);
      expect(Math.abs(own.z - node.z)).toBeLessThan(0.5);
    }
  });

  it('Clusters puts each type in its own volume, keeping the projection inside it', () => {
    const clusters = VIEWS.find((v) => v.id === 'clusters')!;
    const placed = clusters.layout(nodes);
    const centroids = TYPES.map((type) => {
      const own = placed.filter((p) => p.type === type);
      return {
        type,
        x: own.reduce((s, p) => s + p.x, 0) / own.length,
        y: own.reduce((s, p) => s + p.y, 0) / own.length,
        radius: Math.max(...own.map((p) => Math.hypot(p.x, p.y, p.z))),
      };
    });
    // Every pair of cluster centres is further apart than a cluster is wide.
    for (let i = 0; i < centroids.length; i++) {
      for (let j = i + 1; j < centroids.length; j++) {
        const a = centroids[i]!;
        const b = centroids[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(40);
      }
    }
    // …and the within-cluster spread is a scaled copy of the projection, not
    // a hash: this is what makes the "clouds" clouds rather than rods.
    for (const node of nodes.filter((n) => n.type === 'semantic')) {
      const own = placed.find((p) => p.id === node.id)!;
      expect(Math.abs(own.x - (44 + node.x * 0.4))).toBeLessThan(0.5);
      expect(Math.abs(own.y - (24 + node.y * 0.4))).toBeLessThan(0.5);
    }
  });
});

describe('fallbackSceneNodes', () => {
  function record(id: string): MemoryRecord {
    return {
      id,
      type: 'semantic',
      content: `content ${id}`,
      summary: null,
      importance: 0.5,
      source: null,
      concept: null,
      tags: '[]',
      createdAt: '2026-01-01T00:00:00.000Z',
    };
  }

  it('marks every node unprojected, so the scene key can say the positions mean nothing', () => {
    const nodes = fallbackSceneNodes([record('a'), record('b'), record('c')]);
    expect(nodes.every((n) => n.projected === false)).toBe(true);
  });

  it('stays inside the same world box the real projection uses', () => {
    for (const node of fallbackSceneNodes(Array.from({ length: 50 }, (_, i) => record(`m${i}`)))) {
      expect(Math.hypot(node.x, node.y, node.z)).toBeLessThanOrEqual(WORLD_HALF_EXTENT);
    }
  });

  it('is deterministic for the same ids', () => {
    const first = fallbackSceneNodes([record('a'), record('b')]);
    const second = fallbackSceneNodes([record('a'), record('b')]);
    expect(second).toEqual(first);
  });
});
