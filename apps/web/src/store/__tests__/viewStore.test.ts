import { describe, it, expect, vi } from 'vitest';
import {
  VIEWS,
  DEFAULT_VIEW_ID,
  resolveView,
  sceneLayout,
  useViewStore,
  type SceneNodeInput,
} from '../viewStore.js';

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

const TYPES: SceneNodeInput['type'][] = ['episodic', 'semantic', 'procedural'];

function makeNodes(n: number): SceneNodeInput[] {
  return Array.from({ length: n }, (_, i) =>
    makeNode(`mem-${i}`, { type: TYPES[i % 3], importance: (i % 10) / 10 })
  );
}

function findPos(list: ReturnType<typeof sceneLayout>, id: string) {
  const found = list.find((p) => p.id === id);
  if (!found) throw new Error(`missing position for ${id}`);
  return { x: found.x, y: found.y, z: found.z };
}

describe('the plate registry', () => {
  it('holds exactly the five plates the owner picked', () => {
    expect(VIEWS.map((v) => v.id)).toEqual([
      'by-link',
      'overview-detail',
      'river',
      'axes-chords',
      'matrix',
    ]);
  });

  it('gives every plate a unique id — the id is what is resolved and persisted', () => {
    expect(new Set(VIEWS.map((v) => v.id)).size).toBe(VIEWS.length);
  });

  it('gives every plate a unique name, so the chooser can never show the same row twice', () => {
    expect(new Set(VIEWS.map((v) => v.name)).size).toBe(VIEWS.length);
  });

  /**
   * The switch used to say "3D" over three framings of one WebGL scene, so the
   * dimension each plate declares about ITSELF is what the chooser prints.
   *
   * This assertion used to also require the five to differ, which held while
   * two were 3D, two 2D and one hybrid. The owner then had the 2D and hybrid
   * three re-authored in 3D to win back the space the app's sidebar and
   * inspector take, so all five are now genuinely 3D and the old clause
   * asserted a fact that had stopped being true. What is worth locking is not
   * that the values differ but that each one is a word a reader can act on,
   * and that it matches what the plate actually draws — so a plate declaring
   * anything but 3D must not open a WebGL canvas, and every plate here does.
   */
  it('declares an honest dimension per plate', () => {
    for (const view of VIEWS) {
      expect(['2D', '3D', 'Hybrid'], view.id).toContain(view.dimension);
    }
    expect(VIEWS.map((v) => v.dimension)).toEqual(['3D', '3D', '3D', '3D', '3D']);
  });

  it('carries a plain caption and a method per plate', () => {
    for (const view of VIEWS) {
      expect(view.name.length, view.id).toBeGreaterThan(0);
      // The caption is what the plate shows and how to read it: two lines
      // at the strip's width, not a paragraph.
      expect(view.caption.length, view.id).toBeGreaterThan(40);
      expect(view.caption.length, view.id).toBeLessThanOrEqual(200);
      expect(view.method.length, view.id).toBeGreaterThan(view.caption.length);
      expect(typeof view.Plate, view.id).toBe('function');
    }
  });

  it('names the plates by the task they serve', () => {
    expect(VIEWS.map((v) => v.name)).toEqual(['Links', 'Hotspots', 'Over time', 'Communities', 'Overview']);
  });

  /** The copy is shared by every store, so it may not state facts about one. */
  it('asserts nothing about one particular store in its copy', () => {
    for (const view of VIEWS) {
      const copy = `${view.caption} ${view.method}`;
      expect(copy, view.id).not.toMatch(/this store|the store has|five-day|\b\d+ memories\b|\b\d+ links\b/i);
    }
  });

  it('defaults to the first plate', () => {
    expect(DEFAULT_VIEW_ID).toBe(VIEWS[0]!.id);
    expect(useViewStore.getState().activeView.id).toBe(DEFAULT_VIEW_ID);
  });
});

describe('resolveView leaves nothing dangling', () => {
  it('resolves an unknown or stale id to the default', () => {
    // The three view styles this replaced, the two removed before them, and
    // the shapes a URL hash or a persisted preference can actually take.
    for (const stale of [
      'cosmos',
      'neural',
      'clusters',
      'nebula',
      'galaxy',
      'not-a-view',
      '',
      null,
      undefined,
    ]) {
      expect(resolveView(stale).id, String(stale)).toBe(DEFAULT_VIEW_ID);
    }
  });

  it('resolves every real id to itself', () => {
    for (const view of VIEWS) expect(resolveView(view.id)).toBe(view);
  });

  it('setView stores the RESOLVED id, so a persisted "cosmos" cannot leave the switch lit on nothing', () => {
    useViewStore.getState().setView('cosmos');
    expect(useViewStore.getState().activeViewId).toBe(DEFAULT_VIEW_ID);
    expect(useViewStore.getState().activeView.id).toBe(DEFAULT_VIEW_ID);

    useViewStore.getState().setView('river');
    expect(useViewStore.getState().activeViewId).toBe('river');
    expect(useViewStore.getState().activeView.id).toBe('river');

    useViewStore.getState().setView(DEFAULT_VIEW_ID);
  });
});

/**
 * There is exactly one layout now. The banded and clustered variants were art
 * direction for a renderer that no longer exists; a plate owns its own
 * geometry and never reads this. What this still feeds is `neuralStore.neurons`
 * — the array NeuronInspector, the sidebar and the socket reconciliation read
 * — so its determinism guarantees still matter.
 */
describe('sceneLayout is the projection, and is deterministic (F3)', () => {
  it('gives the same position for the same node across two independent calls', () => {
    const nodes = makeNodes(30);
    const first = sceneLayout(nodes);
    const second = sceneLayout(nodes.map((n) => ({ ...n })));
    for (const n of nodes) expect(findPos(second, n.id)).toEqual(findPos(first, n.id));
  });

  it('does not move an existing node when an unrelated one is prepended', () => {
    const nodes = makeNodes(20);
    const before = sceneLayout(nodes);
    const after = sceneLayout([makeNode('mem-new'), ...nodes]);
    for (const n of nodes) expect(findPos(after, n.id)).toEqual(findPos(before, n.id));
  });

  it('does not move remaining nodes when one is removed', () => {
    const nodes = makeNodes(20);
    const before = sceneLayout(nodes);
    const remaining = nodes.filter((n) => n.id !== 'mem-5');
    const after = sceneLayout(remaining);
    for (const n of remaining) expect(findPos(after, n.id)).toEqual(findPos(before, n.id));
  });

  it('shows the projection itself, moved only by the sub-unit anti-overlap jitter', () => {
    const nodes = makeNodes(90);
    for (const placed of sceneLayout(nodes)) {
      const source = nodes.find((n) => n.id === placed.id)!;
      expect(Math.abs(placed.x - source.x)).toBeLessThan(0.5);
      expect(Math.abs(placed.y - source.y)).toBeLessThan(0.5);
      expect(Math.abs(placed.z - source.z)).toBeLessThan(0.5);
    }
  });

  it('separates nodes that share a coordinate, which is the only reason the jitter exists', () => {
    const identical = ['a', 'b', 'c'].map((id) => makeNode(id, { x: 0, y: 0, z: 0 }));
    const placed = sceneLayout(identical);
    expect(new Set(placed.map((p) => `${p.x},${p.y},${p.z}`)).size).toBe(3);
  });

  it('carries recency and retrieval count through to the renderer', () => {
    const [placed] = sceneLayout([
      makeNode('m', {
        accessCount: 17,
        createdAt: '2026-02-03T00:00:00.000Z',
        lastAccessedAt: '2026-02-09T00:00:00.000Z',
      }),
    ]);
    expect(placed!.accessCount).toBe(17);
    expect(placed!.createdAtMs).toBe(Date.parse('2026-02-03T00:00:00.000Z'));
    expect(placed!.lastAccessedAtMs).toBe(Date.parse('2026-02-09T00:00:00.000Z'));
  });

  it('never calls Math.random — positions come from the projection plus a deterministic hash', () => {
    const spy = vi.spyOn(Math, 'random');
    sceneLayout(makeNodes(15));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
