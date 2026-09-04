import { useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useNeuralStore } from '../../store/neuralStore.js';
import { hexToInt, STATUS } from '../../lib/tokens.js';
import { importanceRadius } from './encoding.js';
import { useNeuronDerivedState } from './NeuronMesh.js';
import type { ScenePositions } from './scenePositions.js';

/**
 * Rings, drawn only where a ring means something.
 *
 * Every node used to carry its own torus mesh at `opacity: 0` — 200 draw calls
 * a frame rendering nothing, in the common case where nothing was selected and
 * nothing contradicted. There are two rings now: one InstancedMesh for the
 * ~82 memories involved in a contradiction, and one mesh for the selection.
 *
 * Orange stays the contradiction colour. It is the one place in this app where
 * colour already carries meaning beyond category, and it comes from the same
 * STATUS token the 2D panels use rather than a hex literal typed in twice.
 */

interface Props {
  positions: RefObject<ScenePositions>;
  reducedMotion: boolean;
}

const CONTRADICTION_COLOR = hexToInt(STATUS.contradiction);
const scratch = new THREE.Object3D();

/** Ring radius as a multiple of the node's core radius. */
const CONTRADICTION_RING = 1.5;
const SELECTION_RING = 2.4;

function readPosition(positions: ScenePositions, index: number): boolean {
  const base = index * 3;
  if (base + 2 >= positions.xyz.length) return false;
  scratch.position.set(positions.xyz[base]!, positions.xyz[base + 1]!, positions.xyz[base + 2]!);
  return true;
}

export default function NeuronRings({ positions, reducedMotion }: Props) {
  const neurons = useNeuralStore((s) => s.neurons);
  const contradictionIds = useNeuralStore((s) => s.contradictionIds);
  const selectedId = useNeuralStore((s) => s.selectedNeuronId);
  const ringsRef = useRef<THREE.InstancedMesh>(null);

  /** Instance index -> node index, for the nodes that actually need a ring. */
  const marked = useMemo(
    () =>
      neurons
        .map((n, index) => ({ index, id: n.id, radius: importanceRadius(n.importance) }))
        .filter((n) => contradictionIds.has(n.id)),
    [neurons, contradictionIds]
  );

  const capacity = useMemo(() => Math.max(16, 1 << Math.ceil(Math.log2(Math.max(1, marked.length)))), [marked.length]);
  const instanceArgs = useMemo(
    () => [undefined, undefined, capacity] as unknown as [THREE.BufferGeometry, THREE.Material, number],
    [capacity]
  );

  useFrame(({ camera }) => {
    const mesh = ringsRef.current;
    if (!mesh) return;
    mesh.count = Math.min(marked.length, capacity);
    for (let i = 0; i < mesh.count; i++) {
      const entry = marked[i]!;
      if (!readPosition(positions.current, entry.index)) continue;
      // Face the camera, so a ring is never edge-on and invisible.
      scratch.quaternion.copy(camera.quaternion);
      scratch.scale.setScalar(entry.radius * CONTRADICTION_RING);
      scratch.updateMatrix();
      mesh.setMatrixAt(i, scratch.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <>
      <instancedMesh ref={ringsRef} args={instanceArgs} frustumCulled={false} raycast={() => null} renderOrder={2}>
        <torusGeometry args={[1, 0.045, 6, 36]} />
        <meshBasicMaterial
          color={CONTRADICTION_COLOR}
          transparent
          opacity={0.6}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      {selectedId && <FocusRing id={selectedId} positions={positions} reducedMotion={reducedMotion} />}
    </>
  );
}

interface FocusRingProps {
  id: string;
  positions: RefObject<ScenePositions>;
  reducedMotion: boolean;
}

/** The one ring that follows the selection. */
function FocusRing({ id, positions, reducedMotion }: FocusRingProps) {
  const neurons = useNeuralStore((s) => s.neurons);
  const { hasContradiction, isActive } = useNeuronDerivedState(id);
  const meshRef = useRef<THREE.Mesh>(null);

  const target = useMemo(() => {
    const index = neurons.findIndex((n) => n.id === id);
    return index < 0 ? null : { index, radius: importanceRadius(neurons[index]!.importance) };
  }, [neurons, id]);

  useFrame(({ camera }, delta) => {
    const mesh = meshRef.current;
    if (!mesh || !target) return;
    const base = target.index * 3;
    const xyz = positions.current.xyz;
    if (base + 2 >= xyz.length) return;
    mesh.position.set(xyz[base]!, xyz[base + 1]!, xyz[base + 2]!);
    mesh.quaternion.copy(camera.quaternion);
    if (!reducedMotion) mesh.rotateZ(delta * 0.8);
  });

  if (!target) return null;
  const color = hasContradiction ? CONTRADICTION_COLOR : isActive ? 0xffffff : 0xe2e8f0;

  return (
    <mesh ref={meshRef} raycast={() => null} renderOrder={3}>
      <torusGeometry args={[target.radius * SELECTION_RING, 0.11, 8, 40]} />
      <meshBasicMaterial color={color} transparent opacity={0.95} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}
