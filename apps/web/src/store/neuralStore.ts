import { create } from 'zustand';

export interface NeuronNode {
  id: string;
  type: 'episodic' | 'semantic' | 'procedural';
  label: string;
  x: number;
  y: number;
  z: number;
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

interface NeuralState {
  neurons: NeuronNode[];
  connections: NeuronConnection[];
  selectedNeuronId: string | null;
  activeNeuronIds: Set<string>;
  isConnected: boolean;

  setNeurons: (neurons: NeuronNode[]) => void;
  setConnections: (connections: NeuronConnection[]) => void;
  selectNeuron: (id: string | null) => void;
  activateNeuron: (id: string) => void;
  deactivateNeuron: (id: string) => void;
  setConnected: (connected: boolean) => void;
}

export const useNeuralStore = create<NeuralState>((set) => ({
  neurons: [],
  connections: [],
  selectedNeuronId: null,
  activeNeuronIds: new Set(),
  isConnected: false,

  setNeurons: (neurons) => set({ neurons }),
  setConnections: (connections) => set({ connections }),
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

  setConnected: (connected) => set({ isConnected: connected }),
}));
