import { describe, it, expect, beforeEach } from 'vitest';
import { useNeuralStore, type NeuronNode } from '../neuralStore.js';

function makeNeuron(overrides: Partial<NeuronNode> = {}): NeuronNode {
  return {
    id: 'n1',
    type: 'semantic',
    label: 'n1',
    x: 0, y: 0, z: 0,
    activation: 0,
    importance: 0.5,
    source: null,
    accessCount: 0,
    createdAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
    lastAccessedAtMs: null,
    projected: true,
    ...overrides,
  };
}

describe('neuralStore', () => {
  beforeEach(() => {
    useNeuralStore.setState({
      neurons: [],
      connections: [],
      selectedNeuronId: null,
      activeNeuronIds: new Set(),
      isConnected: false,
      contradictionPairs: [],
      contradictionIds: new Set(),
    });
  });

  it('activateNeuron adds an id to activeNeuronIds without mutating the previous Set', () => {
    const before = useNeuralStore.getState().activeNeuronIds;
    useNeuralStore.getState().activateNeuron('n1');
    const after = useNeuralStore.getState().activeNeuronIds;
    expect(after).not.toBe(before);
    expect(after.has('n1')).toBe(true);
  });

  it('deactivateNeuron removes an id from activeNeuronIds', () => {
    useNeuralStore.setState({ activeNeuronIds: new Set(['n1', 'n2']) });
    useNeuralStore.getState().deactivateNeuron('n1');
    const ids = useNeuralStore.getState().activeNeuronIds;
    expect(ids.has('n1')).toBe(false);
    expect(ids.has('n2')).toBe(true);
  });

  it('removeNeuron drops the neuron, its connections, and clears selection if it was selected', () => {
    useNeuralStore.setState({
      neurons: [makeNeuron({ id: 'n1' }), makeNeuron({ id: 'n2' })],
      connections: [
        { id: 'c1', sourceId: 'n1', targetId: 'n2', relationship: 'related', strength: 0.5 },
        { id: 'c2', sourceId: 'n2', targetId: 'n3', relationship: 'related', strength: 0.5 },
      ],
      selectedNeuronId: 'n1',
    });

    useNeuralStore.getState().removeNeuron('n1');

    const state = useNeuralStore.getState();
    expect(state.neurons.map((n) => n.id)).toEqual(['n2']);
    expect(state.connections.map((c) => c.id)).toEqual(['c2']);
    expect(state.selectedNeuronId).toBeNull();
  });

  it('removeNeuron leaves selection alone when a different neuron is removed', () => {
    useNeuralStore.setState({
      neurons: [makeNeuron({ id: 'n1' }), makeNeuron({ id: 'n2' })],
      selectedNeuronId: 'n2',
    });
    useNeuralStore.getState().removeNeuron('n1');
    expect(useNeuralStore.getState().selectedNeuronId).toBe('n2');
  });

  it('setConnected toggles isConnected', () => {
    useNeuralStore.getState().setConnected(true);
    expect(useNeuralStore.getState().isConnected).toBe(true);
    useNeuralStore.getState().setConnected(false);
    expect(useNeuralStore.getState().isConnected).toBe(false);
  });
});
