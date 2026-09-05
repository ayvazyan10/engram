import { create } from 'zustand';
import type { NeuronNode } from './neuralStore.js';
import type { DemoModule } from '../lib/plate/contract.js';
import { laidOutByLink } from '../components/plates/LaidOutByLink.js';
import { overviewAndDetail } from '../components/plates/OverviewAndDetail.js';
import { memoryRiver } from '../components/plates/MemoryRiver.js';
import { axesAndChords } from '../components/plates/AxesAndChords.js';
import { memoryMatrix } from '../components/plates/MemoryMatrix.js';

/**
 * The five plates, and the one layout that feeds the inspector.
 *
 * What used to be here was three FRAMINGS of a single projection — Cosmos, the
 * Neural Net's type bands, the Clusters' three volumes — each carrying a
 * `ViewTheme` of fog, bloom, autorotation, camera and grid, because all three
 * were rendered by one shared `NeuralCanvas`. All three were rejected, the
 * canvas is gone, and every field in that theme went with it: a plate owns its
 * own camera, its own atmosphere, and its own idea of what motion means, and
 * nothing outside the plate can tell it otherwise.
 *
 * What is left in this file is therefore two unrelated things that both happen
 * to be "the view":
 *
 *   VIEWS          the five plates, each one its own `DemoModule` export, so
 *                  the id, name, dimension and claim on the switch are the
 *                  plate's own words and cannot drift from it.
 *   sceneLayout    the projection pipeline that fills `neuralStore.neurons`.
 *                  The plates do not read that array — they take `ObsData` —
 *                  but NeuronInspector, the sidebar and the websocket
 *                  reconciliation all do, so it stays. There is now exactly
 *                  ONE layout: the projection as the server computed it, plus
 *                  a sub-unit jitter. The banded and clustered variants were
 *                  art direction for a renderer that no longer exists.
 */

/** The plate boundary calls this a `DemoModule` and the plates export it under
 *  that name; re-exported here so nothing outside has to reach past the store
 *  into the contract to name what `VIEWS` holds. */
export type { DemoModule };

/** A placed memory as `GET /api/graph/layout` returns it. */
export interface SceneNodeInput {
  id: string;
  type: NeuronNode['type'];
  label: string;
  importance: number;
  source: string | null;
  accessCount: number;
  createdAt: string;
  lastAccessedAt: string | null;
  x: number;
  y: number;
  z: number;
  /** False when the server could not project this memory (no usable embedding). */
  projected: boolean;
}

export type NeuronPosition = Omit<NeuronNode, 'activation' | 'tx' | 'ty' | 'tz'>;

// ─── Deterministic hash ───────────────────────────────────────────────────────

/**
 * murmur3's finalizer. The previous hash ended in a single `h ^= h >>> 15`,
 * which does not avalanche: with the salt appended LAST, two salts differing
 * only in their final character produced almost the same value. Measured over
 * 4,000 uuids: mean absolute difference 0.008 where independent uniforms give
 * 0.333 — the three "independent" axes were one number, which is why the old
 * Clusters clouds rendered as straight diagonal rods.
 *
 * Two fixes, both needed: the salt goes FIRST so it is mixed through every
 * subsequent byte, and the finalizer is a real avalanche.
 * See store/__tests__/viewStore.hash.test.ts, which asserts |r| < 0.05 for
 * every salt pair.
 */
function fmix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Deterministic pseudo-random float in [0, 1), stable for a given id + salt.
 *  Never Math.random — the layout must be reproducible. */
export function idRandom(id: string, salt: string): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  const s = salt + ':' + id;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix32(h) / 4294967296;
}

// ─── The one layout ───────────────────────────────────────────────────────────

/**
 * Jitter, and nothing else.
 *
 * The hash does not decide where a memory goes — the projection does. Its one
 * remaining job is to pull apart nodes whose embeddings are identical: dozens
 * of this store's memories are job-generated reflections that embed to the same
 * vector, and without this they would occupy exactly one pixel.
 */
const JITTER = 0.9;

function jitter(id: string, axis: string): number {
  return (idRandom(id, 'jitter-' + axis) - 0.5) * JITTER;
}

/** The projection as the server computed it, moved only by the anti-overlap
 *  jitter. The single canonical layout — every plate draws its own geometry
 *  from `ObsData`, and this exists to fill `neuralStore.neurons`. */
export function sceneLayout(nodes: readonly SceneNodeInput[]): NeuronPosition[] {
  return nodes.map((n) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    importance: n.importance,
    source: n.source,
    accessCount: n.accessCount,
    createdAtMs: Date.parse(n.createdAt),
    lastAccessedAtMs: n.lastAccessedAt ? Date.parse(n.lastAccessedAt) : null,
    projected: n.projected,
    x: n.x + jitter(n.id, 'x'),
    y: n.y + jitter(n.id, 'y'),
    z: n.z + jitter(n.id, 'z'),
  }));
}

// ─── The plates ───────────────────────────────────────────────────────────────

/**
 * Order is a reading order, not a ranking.
 *
 * The two that need no WebGL come first, so the surface a cold load paints is
 * the cheapest and the fastest to read; the two that put the store in a real
 * volume come last. Nothing here re-states a plate's name, dimension or claim:
 * every entry IS the module the plate exports, so the switch cannot describe a
 * plate differently from how the plate describes itself.
 */
export const VIEWS: DemoModule[] = [
  laidOutByLink,
  overviewAndDetail,
  memoryRiver,
  axesAndChords,
  memoryMatrix,
];

export const DEFAULT_VIEW_ID = VIEWS[0]!.id;

/**
 * Resolve a plate id to one that exists.
 *
 * The three view styles this replaced — `cosmos`, `neural`, `clusters` — can
 * still arrive from a URL hash or a persisted preference, exactly as `nebula`
 * and `galaxy` did before them. An unknown id resolves to the default, id
 * included, so the switch is never lit on nothing while the surface draws
 * something else.
 */
export function resolveView(id: string | null | undefined): DemoModule {
  return VIEWS.find((v) => v.id === id) ?? VIEWS[0]!;
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ViewState {
  activeViewId: string;
  activeView: DemoModule;
  setView: (id: string) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeViewId: DEFAULT_VIEW_ID,
  activeView: resolveView(DEFAULT_VIEW_ID),
  setView: (id) => {
    const view = resolveView(id);
    set({ activeViewId: view.id, activeView: view });
  },
}));
