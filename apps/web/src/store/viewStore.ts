import { create } from 'zustand';
import type { MemoryRecord } from './memoryStore.js';
import type { NeuronNode } from './neuralStore.js';
import { hexToInt, TYPE_COLORS } from '../lib/tokens.js';

/**
 * One honest layout, three framings of it.
 *
 * Position used to be decorative: five views, five unrelated scatter functions,
 * none of which encoded anything about the memory beyond its type. A node's
 * place on screen told you nothing you could not read off its colour.
 *
 * Now every view draws the SAME projection — the server's PCA of each memory's
 * 384-dimension embedding into a fixed world box (GET /api/graph/layout), so
 * two nodes near each other are near each other in meaning. The views differ in
 * how that projection is framed and art-directed, not in where they put things:
 *
 *   Cosmos    the projection as it is, free orbit — global structure
 *   Neural Net the projection with type pulled apart along X — bands you can
 *              compare, similarity still governing within each band
 *   Clusters  the projection folded into three per-type volumes — the view the
 *             audit found was the only one that worked, now with real
 *             within-cluster structure instead of hash noise
 *
 * Nebula and Galaxy are gone. Nebula was Cosmos with a bigger radius and the
 * type colours thrown away; Galaxy encoded nothing at all in position and could
 * not show the spiral it was named for (disc in XZ, camera inside that plane,
 * autoRotate about Y preserving the polar angle).
 */

// ─── Canonical colour ─────────────────────────────────────────────────────────
//
// TYPE_COLORS is the app's single source of truth for memory-type colour, and
// the footer legend has always drawn from it. Three view themes used to
// override it with near-monochrome ramps (Neural Net's worst pair was ΔE 10.4 —
// effectively one colour), which made the app's own legend false. Memory type is
// the primary categorical variable here, so its encoding is invariant across
// views: views differentiate on background, fog, bloom and geometry, never on
// hue. See lib/__tests__/typeColorsSingleSource.test.ts.
const CANONICAL_NEURON_COLORS = {
  episodic: hexToInt(TYPE_COLORS.episodic),
  semantic: hexToInt(TYPE_COLORS.semantic),
  procedural: hexToInt(TYPE_COLORS.procedural),
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewStyle = 'cosmos' | 'net' | 'clusters';

export interface ViewCamera {
  /** Direction the camera sits in, from the target. Normalised by the rig. */
  direction: [number, number, number];
  /** Half-extent of the content, in world units — what has to fit on screen. */
  frameRadius: number;
  /** Where the orbit pivots, for a layout that is not centred on the origin. */
  target: [number, number, number];
  fov: number;
}

export interface ViewTheme {
  background: string;
  /**
   * Fog as a fraction of the camera distance, not absolute world units: the rig
   * pushes the camera back on a narrow viewport, and absolute fog would swallow
   * the whole scene on a phone while barely touching it on a desktop.
   */
  fog: { nearFactor: number; farFactor: number };
  bloom: { intensity: number; threshold: number; smoothing: number };
  autoRotateSpeed: number;
  /** Always CANONICAL_NEURON_COLORS. Kept as a field so the renderer reads
   *  colour from one place, not so views can disagree about it. */
  colors: typeof CANONICAL_NEURON_COLORS;
  camera: ViewCamera;
  /** Ground plane, only where a horizontal reference means something. */
  grid: boolean;
  style: ViewStyle;
}

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

export interface ViewConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  layout: (nodes: readonly SceneNodeInput[]) => NeuronPosition[];
  theme: ViewTheme;
}

// ─── Deterministic hash ───────────────────────────────────────────────────────

/**
 * murmur3's finalizer. The previous hash ended in a single `h ^= h >>> 15`,
 * which does not avalanche: with the salt appended LAST, two salts differing
 * only in their final character produced almost the same value. Measured over
 * 4,000 uuids: corr(cloud-x, cloud-y) = 0.978, corr(net-y, net-z) = 0.953, mean
 * absolute difference 0.008 where independent uniforms give 0.333. That is why
 * the "clusters" clouds rendered as straight diagonal rods — x, y and z were
 * the same number.
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

// ─── Layout helpers ───────────────────────────────────────────────────────────

/**
 * Jitter, and nothing else.
 *
 * The hash no longer decides where a memory goes — the projection does. Its one
 * remaining job is to pull apart nodes whose embeddings are identical: 42 of the
 * live store's 653 memories are job-generated reflections that embed to the same
 * vector, and without this they would occupy exactly one pixel.
 */
const JITTER = 0.9;

function jitter(id: string, axis: string): number {
  return (idRandom(id, 'jitter-' + axis) - 0.5) * JITTER;
}

function base(n: SceneNodeInput, x: number, y: number, z: number): NeuronPosition {
  return {
    id: n.id,
    type: n.type,
    label: n.label,
    importance: n.importance,
    source: n.source,
    accessCount: n.accessCount,
    createdAtMs: Date.parse(n.createdAt),
    lastAccessedAtMs: n.lastAccessedAt ? Date.parse(n.lastAccessedAt) : null,
    projected: n.projected,
    x: x + jitter(n.id, 'x'),
    y: y + jitter(n.id, 'y'),
    z: z + jitter(n.id, 'z'),
  };
}

/** Cosmos — the projection, untouched. */
function projectionLayout(nodes: readonly SceneNodeInput[]): NeuronPosition[] {
  return nodes.map((n) => base(n, n.x, n.y, n.z));
}

/** Neural Net — type separated along X, similarity still governing within a band. */
const NET_BAND_X: Record<NeuronNode['type'], number> = {
  episodic: -58,
  semantic: 0,
  procedural: 58,
};
/** How much of the projection's X survives inside a band. Small enough that
 *  bands never overlap (0.28 x 42 = 11.8 against a 58-unit gap). */
const NET_X_COMPRESSION = 0.28;

function bandedLayout(nodes: readonly SceneNodeInput[]): NeuronPosition[] {
  return nodes.map((n) => base(n, NET_BAND_X[n.type] + n.x * NET_X_COMPRESSION, n.y, n.z));
}

/** Clusters — three volumes, each keeping its own internal projection. */
const CLUSTER_CENTRE: Record<NeuronNode['type'], [number, number, number]> = {
  episodic: [-44, 24, 0],
  semantic: [44, 24, 0],
  procedural: [0, -46, 0],
};
const CLUSTER_SCALE = 0.4;

function clusteredLayout(nodes: readonly SceneNodeInput[]): NeuronPosition[] {
  return nodes.map((n) => {
    const [cx, cy, cz] = CLUSTER_CENTRE[n.type];
    return base(n, cx + n.x * CLUSTER_SCALE, cy + n.y * CLUSTER_SCALE, cz + n.z * CLUSTER_SCALE);
  });
}

// ─── Fallback when the projection is unavailable ──────────────────────────────

/** Half-extent the server scales its projection into (GET /api/graph/layout). */
export const WORLD_HALF_EXTENT = 42;

/**
 * What the scene shows when `/api/graph/layout` cannot be reached.
 *
 * A deterministic sphere derived from ids alone — meaningless as a position,
 * and flagged `projected: false` so the renderer draws these hollow and the
 * scene key says "positions unavailable" rather than implying the arrangement
 * means something. This is a degraded mode, not a second layout.
 */
export function fallbackSceneNodes(records: readonly MemoryRecord[]): SceneNodeInput[] {
  return records.map((r) => {
    const phi = Math.acos(1 - 2 * idRandom(r.id, 'fallback-u'));
    const theta = idRandom(r.id, 'fallback-v') * Math.PI * 2;
    const radius = WORLD_HALF_EXTENT * 0.85;
    return {
      id: r.id,
      type: r.type,
      label: r.concept ?? r.content.slice(0, 60),
      importance: r.importance,
      source: r.source,
      accessCount: 0,
      createdAt: r.createdAt,
      lastAccessedAt: null,
      x: radius * Math.sin(phi) * Math.cos(theta),
      y: radius * Math.cos(phi),
      z: radius * Math.sin(phi) * Math.sin(theta),
      projected: false,
    };
  });
}

// ─── View configs ─────────────────────────────────────────────────────────────

export const VIEWS: ViewConfig[] = [
  {
    id: 'cosmos',
    name: 'Cosmos',
    icon: '✦',
    description: 'The whole projection, free orbit — near means similar',
    layout: projectionLayout,
    theme: {
      background: '#03060f',
      fog: { nearFactor: 0.72, farFactor: 2.35 },
      bloom: { intensity: 1.05, threshold: 0.3, smoothing: 0.75 },
      autoRotateSpeed: 0.18,
      colors: CANONICAL_NEURON_COLORS,
      camera: { direction: [0, 0.06, 1], frameRadius: 52, target: [0, 0, 0], fov: 50 },
      grid: false,
      style: 'cosmos',
    },
  },
  {
    id: 'neural',
    name: 'Neural Net',
    icon: '⬡',
    description: 'Same projection, type separated into bands along one axis',
    layout: bandedLayout,
    theme: {
      background: '#04090c',
      fog: { nearFactor: 0.8, farFactor: 2.6 },
      bloom: { intensity: 0.9, threshold: 0.32, smoothing: 0.6 },
      autoRotateSpeed: 0,
      colors: CANONICAL_NEURON_COLORS,
      camera: { direction: [0, 0.17, 1], frameRadius: 74, target: [0, 0, 0], fov: 50 },
      grid: true,
      style: 'net',
    },
  },
  {
    id: 'clusters',
    name: 'Clusters',
    icon: '⊹',
    description: 'Same projection, grouped into one volume per memory type',
    layout: clusteredLayout,
    theme: {
      background: '#07070d',
      fog: { nearFactor: 0.78, farFactor: 2.6 },
      bloom: { intensity: 1.0, threshold: 0.3, smoothing: 0.7 },
      autoRotateSpeed: 0.12,
      colors: CANONICAL_NEURON_COLORS,
      camera: { direction: [0, 0.05, 1], frameRadius: 72, target: [0, -10, 0], fov: 50 },
      grid: false,
      style: 'clusters',
    },
  },
];

export const DEFAULT_VIEW_ID = 'cosmos';

/**
 * Resolve a view id to one that exists.
 *
 * Nebula and Galaxy were removed, and `setView` used to store whatever id it
 * was handed even when no view matched — so a stale 'nebula' left the switcher
 * highlighting nothing while the canvas rendered Cosmos. An unknown id now
 * resolves to the default, id included.
 */
export function resolveView(id: string | null | undefined): ViewConfig {
  return VIEWS.find((v) => v.id === id) ?? (VIEWS[0] as ViewConfig);
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ViewState {
  activeViewId: string;
  activeView: ViewConfig;
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
