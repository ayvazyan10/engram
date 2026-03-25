import { create } from 'zustand';

export interface NeuronNode {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  label: string;
  x: number;
  y: number;
  z: number;
  /** Target position for smooth transitions */
  tx?: number;
  ty?: number;
  tz?: number;
  activation: number;
  importance: number;
  source: string | null;
}

export interface NeuronConnection {
  id: string;
  sourceId: string;
  targetId: string;
  relationship: string;
  strength: number;
}

export interface ContradictionPair {
  sourceId: string;
  targetId: string;
  confidence: number;
}

interface NeuralState {
  neurons: NeuronNode[];
  connections: NeuronConnection[];
  selectedNeuronId: string | null;
  activeNeuronIds: Set<string>;
  isConnected: boolean;
  contradictionPairs: ContradictionPair[];

  setNeurons: (neurons: NeuronNode[]) => void;
  /** Set target positions for smooth transitions (doesn't change current x/y/z) */
  setTargetPositions: (targets: Array<{ id: string; x: number; y: number; z: number }>) => void;
  setConnections: (connections: NeuronConnection[]) => void;
  setContradictionPairs: (pairs: ContradictionPair[]) => void;
  selectNeuron: (id: string | null) => void;
  activateNeuron: (id: string) => void;
  deactivateNeuron: (id: string) => void;
  removeNeuron: (id: string) => void;
  setConnected: (connected: boolean) => void;
}

export const useNeuralStore = create<NeuralState>((set) => ({
  neurons: [],
  connections: [],
  selectedNeuronId: null,
  activeNeuronIds: new Set(),
  isConnected: false,
  contradictionPairs: [],

  setNeurons: (neurons) => set({ neurons }),

  setTargetPositions: (targets) =>
    set((state) => {
      const targetMap = new Map(targets.map((t) => [t.id, t]));
      return {
        neurons: state.neurons.map((n) => {
          const t = targetMap.get(n.id);
          return t ? { ...n, tx: t.x, ty: t.y, tz: t.z } : n;
        }),
      };
    }),

  setConnections: (connections) => set({ connections }),
  setContradictionPairs: (pairs) => set({ contradictionPairs: pairs }),
  selectNeuron: (id) => set({ selectedNeuronId: id }),

  activateNeuron: (id) =>
    set((state) => {
      const next = new Set(state.activeNeuronIds);
      next.add(id);
      return { activeNeuronIds: next };
    }),

  deactivateNeuron: (id) =>
    set((state) => {
      const next = new Set(state.activeNeuronIds);
      next.delete(id);
      return { activeNeuronIds: next };
    }),

  removeNeuron: (id) =>
    set((state) => ({
      neurons: state.neurons.filter((n) => n.id !== id),
      connections: state.connections.filter((c) => c.sourceId !== id && c.targetId !== id),
      selectedNeuronId: state.selectedNeuronId === id ? null : state.selectedNeuronId,
    })),

  setConnected: (connected) => set({ isConnected: connected }),
}));
