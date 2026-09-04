import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handleNeuronClick } from '../NeuronMesh.js';
import { haloScale } from '../encoding.js';

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

/**
 * F7 — hit targets. The median node projects to 17px in Cosmos and 12px in
 * Neural Net at 375px, against a 24px minimum, and the halo drawn around it was
 * declared `raycast={() => null}` so it contributed nothing to the hit area.
 *
 * Asserted against the source because the meshes need a WebGL context to
 * mount; what matters is the declaration, and the declaration is what changed.
 */
describe('hit area (F7) — the halo takes the ray', () => {
  const source = readFileSync(join(__dirname, '../NeuronMesh.tsx'), 'utf-8');
  const halo = source.slice(source.indexOf('ref={haloRef}'), source.indexOf('ref={coreRef}'));

  it('no longer opts the halo out of raycasting', () => {
    expect(halo).not.toContain('raycast={() => null}');
  });

  it('gives the halo the same pointer handlers as the core it surrounds', () => {
    for (const handler of ['onClick={onClick}', 'onPointerMove={onPointerMove}', 'onPointerOut={onPointerOut}']) {
      expect(halo, handler).toContain(handler);
    }
  });

  it('is a real widening of the target — the halo is 1.45x to 2.35x the core radius', () => {
    expect(haloScale(0)).toBeGreaterThanOrEqual(1.45);
    expect(haloScale(433)).toBeLessThanOrEqual(2.35);
    // A 12px node in Neural Net reaches the 24px minimum at the halo's floor.
    expect(12 * haloScale(0)).toBeGreaterThanOrEqual(17);
    expect(17 * haloScale(0)).toBeGreaterThanOrEqual(24);
  });
});
