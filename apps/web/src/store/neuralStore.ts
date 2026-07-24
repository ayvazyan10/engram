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

/** A laid-out node before it gains runtime state (activation, tween targets). */
export type NeuronLayoutNode = Omit<NeuronNode, 'activation' | 'tx' | 'ty' | 'tz'>;

interface NeuralState {
  neurons: NeuronNode[];
  connections: NeuronConnection[];
  selectedNeuronId: string | null;
  activeNeuronIds: Set<string>;
  isConnected: boolean;
  contradictionPairs: ContradictionPair[];
  /**
   * Ids involved in any contradiction. Derived from contradictionPairs so the
   * renderer can test membership in O(1) — NeuronMesh used to scan every pair
   * for every neuron on every render (531 x 1511 comparisons in a real brain).
   */
  contradictionIds: Set<string>;

  setNeurons: (neurons: NeuronNode[]) => void;
  /** Set target positions for smooth transitions (doesn't change current x/y/z) */
  setTargetPositions: (targets: Array<{ id: string; x: number; y: number; z: number }>) => void;
  /**
   * Reconcile the node set against a fresh layout: retarget existing nodes
   * (keeping their current position and activation), append nodes that appeared
   * since the last render, and drop ones that are gone.
   */
  reconcileNeurons: (targets: NeuronLayoutNode[]) => void;
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
  contradictionIds: new Set(),

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

  reconcileNeurons: (targets) =>
    set((state) => {
      const existing = new Map(state.neurons.map((n) => [n.id, n]));
      const neurons: NeuronNode[] = targets.map((t) => {
        const prev = existing.get(t.id);
        if (!prev) {
          // New node — seed it at its target so it doesn't fly in from origin.
          return { ...t, activation: 0, tx: t.x, ty: t.y, tz: t.z };
        }
        return {
          ...prev,
          ...t,
          // Keep where it currently is; only the target moves.
          x: prev.x,
          y: prev.y,
          z: prev.z,
          activation: prev.activation,
          tx: t.x,
          ty: t.y,
          tz: t.z,
        };
      });

      const ids = new Set(targets.map((t) => t.id));
      return {
        neurons,
        selectedNeuronId:
          state.selectedNeuronId && ids.has(state.selectedNeuronId) ? state.selectedNeuronId : null,
      };
    }),

  setConnections: (connections) => set({ connections }),
  setContradictionPairs: (pairs) =>
    set({
      contradictionPairs: pairs,
      contradictionIds: new Set(pairs.flatMap((p) => [p.sourceId, p.targetId])),
    }),
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
