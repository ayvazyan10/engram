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
  /**
   * Retrieval and recency, carried through from the API instead of being
   * discarded at the layout boundary. The old `base()` copied id, type, label,
   * importance, source and coordinates and dropped everything else — so the two
   * fields that actually distinguish memories in a memory system (how often
   * this one has been recalled, and how long ago it was written) never reached
   * the renderer. NeuronField encodes accessCount as halo size and recency as
   * core brightness; see canvas/encoding.ts.
   */
  accessCount: number;
  createdAtMs: number;
  lastAccessedAtMs: number | null;
  /** False when the server could not project this memory from an embedding. */
  projected: boolean;
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
  /** Node under the pointer. Drives the label layer, which shows the selected
   *  node, its direct neighbours and whatever is hovered. */
  hoveredNeuronId: string | null;
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
  /**
   * Reconcile the node set against a fresh layout: retarget existing nodes
   * (keeping their current position and activation), append nodes that appeared
   * since the last render, and drop ones that are gone.
   */
  reconcileNeurons: (targets: NeuronLayoutNode[]) => void;
  setConnections: (connections: NeuronConnection[]) => void;
  setContradictionPairs: (pairs: ContradictionPair[]) => void;
  selectNeuron: (id: string | null) => void;
  hoverNeuron: (id: string | null) => void;
  /**
   * W15: deliberate future API, not dead code. `activeNeuronIds`,
   * `activateNeuron` and `deactivateNeuron` are fully wired end-to-end —
   * NeuronMesh already reads `isActive` off `activeNeuronIds` for its
   * emissive/glow/ring targets across all 5 view styles — the only missing
   * piece is a caller that decides *when* a neuron counts as "active"
   * (e.g. while it's part of a live recall, or a real-time consolidation
   * pulse). Left in place rather than deleted so that trigger can be added
   * without re-deriving this from scratch.
   */
  activateNeuron: (id: string) => void;
  deactivateNeuron: (id: string) => void;
  removeNeuron: (id: string) => void;
  setConnected: (connected: boolean) => void;
}

export const useNeuralStore = create<NeuralState>((set) => ({
  neurons: [],
  connections: [],
  selectedNeuronId: null,
  hoveredNeuronId: null,
  activeNeuronIds: new Set(),
  isConnected: false,
  contradictionPairs: [],
  contradictionIds: new Set(),

  setNeurons: (neurons) => set({ neurons }),

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
        hoveredNeuronId:
          state.hoveredNeuronId && ids.has(state.hoveredNeuronId) ? state.hoveredNeuronId : null,
      };
    }),

  setConnections: (connections) => set({ connections }),
  setContradictionPairs: (pairs) =>
    set({
      contradictionPairs: pairs,
      contradictionIds: new Set(pairs.flatMap((p) => [p.sourceId, p.targetId])),
    }),
  selectNeuron: (id) => set({ selectedNeuronId: id }),
  hoverNeuron: (id) =>
    set((state) => (state.hoveredNeuronId === id ? state : { hoveredNeuronId: id })),

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
      hoveredNeuronId: state.hoveredNeuronId === id ? null : state.hoveredNeuronId,
    })),

  setConnected: (connected) => set({ isConnected: connected }),
}));
