import { create } from 'zustand';
import type { MemoryRecord } from './memoryStore.js';
import type { NeuronNode } from './neuralStore.js';
import { hexToInt, TYPE_COLORS } from '../lib/tokens.js';

// The 5 views below are deliberately, independently art-directed — Nebula's
// pink/violet fog, Neural Net's green, Galaxy's yellow are the point of
// having different views, the same way switching UI templates is. That's
// not the "same memory changes colour" bug the audit found (that was
// TYPE_COLORS disagreeing between 2D panels — see lib/tokens.ts). 'cosmos'
// (the default view) and 'clusters' happen to already agree with the
// canonical 2D palette, so they reference it directly instead of
// re-typing the same three hex values as numeric literals.
const CANONICAL_NEURON_COLORS = {
  episodic: hexToInt(TYPE_COLORS.episodic),
  semantic: hexToInt(TYPE_COLORS.semantic),
  procedural: hexToInt(TYPE_COLORS.procedural),
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type ViewStyle = 'cosmos' | 'neon' | 'plasma' | 'ghost' | 'stars';

export interface ViewTheme {
  background: string;
  bloom: { intensity: number; threshold: number; smoothing: number };
  autoRotateSpeed: number;
  colors: { episodic: number; semantic: number; procedural: number };
  style: ViewStyle;
}

export type NeuronPosition = Omit<NeuronNode, 'activation'>;

export interface ViewConfig {
  id: string;
  name: string;
  icon: string;
  description: string;
  layout: (records: MemoryRecord[]) => NeuronPosition[];
  theme: ViewTheme;
}

// ─── Layout helpers ───────────────────────────────────────────────────────────
//
// F3: every position below is a pure function of a record's own id/type/
// importance — never of its index in `records` or of `records.length`. That's
// what makes a node's position stable across unrelated record changes: array
// reordering (a new memory prepended), removals (an archive), or edits to
// *other* records all used to feed into `i`, `records.length`, or a fresh
// `Math.random()` draw, so the whole graph reshuffled on every write. A
// record's own importance/type changing its own position is still correct —
// that's a related change.

/** Deterministic pseudo-random float in [0, 1), stable for a given id + salt.
 *  Swap the salt to get an independent-looking value for the same id (e.g.
 *  one for an x jitter, another for y) without ever touching Math.random. */
function idRandom(id: string, salt: string): number {
  let h = 0x811c9dc5; // FNV-1a offset basis
  const s = id + ':' + salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function base(r: MemoryRecord, x: number, y: number, z: number): NeuronPosition {
  return {
    id: r.id, type: r.type,
    label: r.concept ?? r.content.slice(0, 30),
    importance: r.importance, source: r.source,
    x, y, z,
  };
}

// Fixed spiral density (replaces the old sqrt(records.length * PI)): tuned to
// look like the same banding a few-hundred-record dataset produced, but
// fixed so the graph doesn't visibly rewind as records arrive.
const FIB_SPIRAL_TURNS = 30;

function fibSphere(records: MemoryRecord[], minR: number, maxR: number): NeuronPosition[] {
  return records.map((r) => {
    const t     = idRandom(r.id, 'fib-t'); // uniform latitude position, stands in for i/N
    const spin  = idRandom(r.id, 'fib-spin');
    const phi   = Math.acos(1 - 2 * t);
    const theta = phi * FIB_SPIRAL_TURNS + spin * Math.PI * 2;
    const rad   = minR + r.importance * (maxR - minR);
    return base(r, rad * Math.cos(theta) * Math.sin(phi), rad * Math.sin(theta) * Math.sin(phi), rad * Math.cos(phi));
  });
}

function spiralGalaxy(records: MemoryRecord[]): NeuronPosition[] {
  const arms = 3;
  return records.map((r) => {
    const t     = idRandom(r.id, 'galaxy-t'); // stands in for i / records.length
    const arm   = Math.floor(idRandom(r.id, 'galaxy-arm') * arms);
    const angle = t * Math.PI * 6 + (arm / arms) * Math.PI * 2;
    const rad   = 8 + t * 55;
    const y     = (idRandom(r.id, 'galaxy-y') - 0.5) * rad * 0.18;
    return base(r, rad * Math.cos(angle), y, rad * Math.sin(angle));
  });
}

function layeredNet(records: MemoryRecord[]): NeuronPosition[] {
  const colX = { episodic: -48, semantic: 0, procedural: 48 };
  const columnSpread = 80; // vertical scatter within a type's column
  return records.map((r) => {
    const y = (idRandom(r.id, 'net-y') - 0.5) * columnSpread;
    const z = (idRandom(r.id, 'net-z') - 0.5) * 18;
    return base(r, colX[r.type], y, z);
  });
}

function cloudCluster(records: MemoryRecord[]): NeuronPosition[] {
  const centres: Record<string, [number, number, number]> = {
    episodic:   [-35, 15, 0],
    semantic:   [35, 15, 0],
    procedural: [0, -30, 0],
  };
  return records.map((r) => {
    const [cx, cy, cz] = centres[r.type] ?? [0, 0, 0];
    const s = 22 + r.importance * 8;
    return base(
      r,
      cx + (idRandom(r.id, 'cloud-x') - 0.5) * s,
      cy + (idRandom(r.id, 'cloud-y') - 0.5) * s,
      cz + (idRandom(r.id, 'cloud-z') - 0.5) * s
    );
  });
}

// ─── 5 View configs ───────────────────────────────────────────────────────────

export const VIEWS: ViewConfig[] = [
  {
    id: 'cosmos', name: 'Cosmos', icon: '✦', description: 'Deep-space sphere with metallic neurons',
    layout: (rs) => fibSphere(rs, 25, 45),
    theme: { background: '#020a18', bloom: { intensity: 1.4, threshold: 0.2, smoothing: 0.8 }, autoRotateSpeed: 0.25, colors: CANONICAL_NEURON_COLORS, style: 'cosmos' },
  },
  {
    id: 'nebula', name: 'Nebula', icon: '◈', description: 'Pink & violet fog with soft glowing orbs',
    layout: (rs) => fibSphere(rs, 30, 60),
    theme: { background: '#0a0015', bloom: { intensity: 2.4, threshold: 0.08, smoothing: 0.95 }, autoRotateSpeed: 0.12, colors: { episodic: 0xf472b6, semantic: 0xc084fc, procedural: 0xfb7185 }, style: 'ghost' },
  },
  {
    id: 'neural', name: 'Neural Net', icon: '⬡', description: 'Layered architecture — episodic / semantic / procedural',
    layout: layeredNet,
    theme: { background: '#000d00', bloom: { intensity: 1.1, threshold: 0.25, smoothing: 0.6 }, autoRotateSpeed: 0, colors: { episodic: 0x4ade80, semantic: 0x86efac, procedural: 0x6ee7b7 }, style: 'neon' },
  },
  {
    id: 'galaxy', name: 'Galaxy', icon: '⊛', description: 'Spiral arms, star-like cores, fast rotation',
    layout: spiralGalaxy,
    theme: { background: '#000005', bloom: { intensity: 2.0, threshold: 0.15, smoothing: 0.85 }, autoRotateSpeed: 0.9, colors: { episodic: 0xfde68a, semantic: 0xfef9c3, procedural: 0xfca5a1 }, style: 'stars' },
  },
  {
    id: 'clusters', name: 'Clusters', icon: '⊹', description: 'Three memory types as distinct cloud clusters',
    layout: cloudCluster,
    theme: { background: '#08080f', bloom: { intensity: 1.2, threshold: 0.2, smoothing: 0.7 }, autoRotateSpeed: 0.18, colors: CANONICAL_NEURON_COLORS, style: 'plasma' },
  },
];

// ─── Store ────────────────────────────────────────────────────────────────────

interface ViewState {
  activeViewId: string;
  activeView: ViewConfig;
  setView: (id: string) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeViewId: 'cosmos',
  activeView: VIEWS[0]!,
  setView: (id) => {
    const view = VIEWS.find((v) => v.id === id) ?? VIEWS[0]!;
    set({ activeViewId: id, activeView: view });
  },
}));
