import { describe, it, expect, beforeEach } from 'vitest';
import { useNeuralStore } from '../neuralStore.js';

describe('neuralStore', () => {
  beforeEach(() => {
    useNeuralStore.setState({ selectedNeuronId: null, isConnected: false, contradictionPairs: [] });
  });

  it('selects and clears the open memory', () => {
    useNeuralStore.getState().selectNeuron('n1');
    expect(useNeuralStore.getState().selectedNeuronId).toBe('n1');
    useNeuralStore.getState().selectNeuron(null);
    expect(useNeuralStore.getState().selectedNeuronId).toBeNull();
  });

  it('keeps the contradiction pairs it is given', () => {
    const pairs = [{ sourceId: 'a', targetId: 'b', confidence: 0.8 }];
    useNeuralStore.getState().setContradictionPairs(pairs);
    expect(useNeuralStore.getState().contradictionPairs).toBe(pairs);
  });

  it('setConnected toggles isConnected', () => {
    useNeuralStore.getState().setConnected(true);
    expect(useNeuralStore.getState().isConnected).toBe(true);
    useNeuralStore.getState().setConnected(false);
    expect(useNeuralStore.getState().isConnected).toBe(false);
  });
});
