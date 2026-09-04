import { describe, it, expect, vi } from 'vitest';
import { handleNeuronClick } from '../NeuronMesh.js';

describe('handleNeuronClick (W2)', () => {
  it('stops propagation so overlapping neurons behind this one never receive the click', () => {
    // r3f delivers a click to every intersected object nearest-first; without
    // stopPropagation, the oversized transparent glow spheres (2.2x-3.5x the
    // core radius) plus every farther neuron's handler would also fire, and
    // the LAST one to run (farthest from the camera) is what `selectNeuron`
    // ends up reflecting.
    const stopPropagation = vi.fn();
    const selectNeuron = vi.fn();

    handleNeuronClick({ stopPropagation }, 'n1', false, selectNeuron);

    expect(stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('selects the clicked neuron when it was not already selected', () => {
    const selectNeuron = vi.fn();
    handleNeuronClick({ stopPropagation: vi.fn() }, 'n1', false, selectNeuron);
    expect(selectNeuron).toHaveBeenCalledWith('n1');
  });

  it('deselects when the already-selected neuron is clicked again', () => {
    const selectNeuron = vi.fn();
    handleNeuronClick({ stopPropagation: vi.fn() }, 'n1', true, selectNeuron);
    expect(selectNeuron).toHaveBeenCalledWith(null);
  });
});
