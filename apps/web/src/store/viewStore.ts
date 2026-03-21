import { create } from 'zustand';
import type { MemoryRecord } from './memoryStore.js';
import type { NeuronNode } from './neuralStore.js';

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

function base(r: MemoryRecord, x: number, y: number, z: number): NeuronPosition {
  return {
    id: r.id, type: r.type,
    label: r.concept ?? r.content.slice(0, 30),
    importance: r.importance, source: r.source,
    x, y, z,
  };
}

function fibSphere(records: MemoryRecord[], minR: number, maxR: number): NeuronPosition[] {
  return records.map((r, i) => {
    const phi   = Math.acos(-1 + (2 * i) / Math.max(records.length, 1));
    const theta = Math.sqrt(records.length * Math.PI) * phi;
    const rad   = minR + r.importance * (maxR - minR);
    return base(r, rad * Math.cos(theta) * Math.sin(phi), rad * Math.sin(theta) * Math.sin(phi), rad * Math.cos(phi));
  });
}

function spiralGalaxy(records: MemoryRecord[]): NeuronPosition[] {
  const arms = 3;
  return records.map((r, i) => {
    const t     = i / Math.max(records.length, 1);
    const arm   = i % arms;
    const angle = t * Math.PI * 6 + (arm / arms) * Math.PI * 2;
    const rad   = 8 + t * 55;
    const y     = (Math.random() - 0.5) * rad * 0.18;
    return base(r, rad * Math.cos(angle), y, rad * Math.sin(angle));
  });
}

function layeredNet(records: MemoryRecord[]): NeuronPosition[] {
  const groups: Record<string, MemoryRecord[]> = { episodic: [], semantic: [], procedural: [] };
  records.forEach((r) => groups[r.type]?.push(r));
  const colX = { episodic: -48, semantic: 0, procedural: 48 };
  const result: NeuronPosition[] = [];
  (['episodic', 'semantic', 'procedural'] as const).forEach((type) => {
    const list = groups[type]!;
    list.forEach((r, i) => {
      const y = list.length * 2 - i * 4 + (i % 2) * 2;
      const z = (Math.random() - 0.5) * 18;
      result.push(base(r, colX[type], y, z));
    });
  });
  return result;
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
    return base(r, cx + (Math.random() - 0.5) * s, cy + (Math.random() - 0.5) * s, cz + (Math.random() - 0.5) * s);
  });
}

// ─── 5 View configs ───────────────────────────────────────────────────────────

export const VIEWS: ViewConfig[] = [
  {
    id: 'cosmos', name: 'Cosmos', icon: '✦', description: 'Deep-space sphere with metallic neurons',
    layout: (rs) => fibSphere(rs, 25, 45),
    theme: { background: '#020a18', bloom: { intensity: 1.4, threshold: 0.2, smoothing: 0.8 }, autoRotateSpeed: 0.25, colors: { episodic: 0x818cf8, semantic: 0x22d3ee, procedural: 0xfbbf24 }, style: 'cosmos' },
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
    theme: { background: '#08080f', bloom: { intensity: 1.2, threshold: 0.2, smoothing: 0.7 }, autoRotateSpeed: 0.18, colors: { episodic: 0x818cf8, semantic: 0x22d3ee, procedural: 0xfbbf24 }, style: 'plasma' },
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
