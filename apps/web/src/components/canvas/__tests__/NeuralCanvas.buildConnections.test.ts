import { describe, it, expect } from 'vitest';
import { buildRenderableConnections } from '../NeuralCanvas.js';
import type { NeuronNode, NeuronConnection } from '../../../store/neuralStore.js';

function makeNeuron(overrides: Partial<NeuronNode> = {}): NeuronNode {
  return {
    id: 'n1',
    type: 'semantic',
    label: 'n1',
    x: 1, y: 2, z: 3,
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

function makeConn(overrides: Partial<NeuronConnection> = {}): NeuronConnection {
  return {
    id: 'c1',
    sourceId: 'n1',
    targetId: 'n2',
    relationship: 'related',
    strength: 0.5,
    ...overrides,
  };
}

describe('buildRenderableConnections (F5, "one level up")', () => {
  it('maps a connection to its endpoints, preferring the tween target (tx/ty/tz) over the resting position', () => {
    const neurons = [
      makeNeuron({ id: 'n1', x: 1, y: 1, z: 1, tx: 10, ty: 10, tz: 10 }),
      makeNeuron({ id: 'n2', x: 2, y: 2, z: 2 }), // no target yet — falls back to x/y/z
    ];
    const connections = [makeConn({ sourceId: 'n1', targetId: 'n2' })];

    const result = buildRenderableConnections(neurons, connections);

    expect(result).toEqual([
      {
        id: 'c1',
        sourceId: 'n1',
        targetId: 'n2',
        // Instance indices, so the edge geometry can follow the position tween
        // frame by frame instead of being rebuilt from world coordinates.
        sourceIndex: 0,
        targetIndex: 1,
        sourcePos: [10, 10, 10],
        targetPos: [2, 2, 2],
        strength: 0.5,
        relationship: 'related',
      },
    ]);
  });

  it('drops a connection whose source or target neuron is not currently laid out', () => {
    const neurons = [makeNeuron({ id: 'n1' })];
    const connections = [makeConn({ sourceId: 'n1', targetId: 'missing' })];

    expect(buildRenderableConnections(neurons, connections)).toEqual([]);
  });

  it('drops a connection with no targetId (self-loop guard)', () => {
    const neurons = [makeNeuron({ id: 'n1' }), makeNeuron({ id: 'n2' })];
    const connections = [makeConn({ sourceId: 'n1', targetId: '' })];

    expect(buildRenderableConnections(neurons, connections)).toEqual([]);
  });

  it('is correct with many neurons — O(1) lookup, not the old O(connections x neurons) scan', () => {
    const neurons = Array.from({ length: 200 }, (_, i) => makeNeuron({ id: `n${i}`, x: i }));
    const connections = Array.from({ length: 50 }, (_, i) =>
      makeConn({ id: `c${i}`, sourceId: `n${i}`, targetId: `n${i + 1}` })
    );

    const result = buildRenderableConnections(neurons, connections);

    expect(result).toHaveLength(50);
    expect(result[0]).toEqual({
      id: 'c0',
      sourceId: 'n0',
      targetId: 'n1',
      sourceIndex: 0,
      targetIndex: 1,
      sourcePos: [0, 2, 3],
      targetPos: [1, 2, 3],
      strength: 0.5,
      relationship: 'related',
    });
  });
});
