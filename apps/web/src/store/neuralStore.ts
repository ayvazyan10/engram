import { create } from 'zustand';

export interface ContradictionPair {
  sourceId: string;
  targetId: string;
  confidence: number;
}

/**
 * What every screen shares about the store as a whole: the open memory (the
 * `?m=` link), whether the live socket is up, and the contradiction pairs the
 * Review count is read from. The map's own state is features/map/mapStore.ts.
 */
interface NeuralState {
  selectedNeuronId: string | null;
  isConnected: boolean;
  contradictionPairs: ContradictionPair[];

  setContradictionPairs: (pairs: ContradictionPair[]) => void;
  selectNeuron: (id: string | null) => void;
  setConnected: (connected: boolean) => void;
}

export const useNeuralStore = create<NeuralState>((set) => ({
  selectedNeuronId: null,
  isConnected: false,
  contradictionPairs: [],

  setContradictionPairs: (pairs) => set({ contradictionPairs: pairs }),
  selectNeuron: (id) => set({ selectedNeuronId: id }),
  setConnected: (connected) => set({ isConnected: connected }),
}));
