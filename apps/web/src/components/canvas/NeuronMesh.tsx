import { useCallback, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import type { ViewTheme } from '../../store/viewStore.js';
import { DIMMED_FACTOR, haloScale, importanceRadius, recencyBrightness, tint } from './encoding.js';
import type { ScenePositions } from './scenePositions.js';

/**
 * Every neuron core and halo in two draw calls.
 *
 * This file used to render ONE component per memory, and each of those built
 * three meshes plus a <Text>: a core sphere, an oversized transparent glow
 * sphere, a torus ring drawn at `opacity: 0` for every node in the common case,
 * and a label. At 200 nodes that measured 803 draw calls a frame — 200 of them
 * rendering a completely invisible ring. Cores and halos are now two
 * InstancedMeshes with per-instance colour and scale; rings moved to
 * NeuronRings (one instanced mesh for contradictions, one mesh for the
 * selection) and labels to NeuronLabels, which draws about a dozen.
 */

interface Props {
  theme: ViewTheme;
  /** Shared tween buffer — this component is the only writer; the ring and
   *  label layers read it so all three stay on the same frame. */
  positions: RefObject<ScenePositions>;
  /** W11: with `prefers-reduced-motion: reduce` the position tween is skipped
   *  entirely — nodes snap to their new places — so nothing keeps invalidating
   *  NeuralCanvas's `frameloop="demand"` forever. */
  reducedMotion: boolean;
}

/**
 * Click handling extracted as a pure function so the stopPropagation behaviour
 * is unit-testable without mounting the WebGL scene (W2).
 *
 * stopPropagation is required because r3f delivers a click for every
 * intersection along the ray, nearest-first — including several instances of
 * this same InstancedMesh when neurons overlap on screen. Without it the LAST
 * handler to run (the farthest node from the camera) is what `selectNeuron`
 * ends up reflecting. Stopping at the first hit selects the frontmost node.
 */
export function handleNeuronClick(
  event: { stopPropagation: () => void },
  neuronId: string,
  isSelected: boolean,
  selectNeuron: (id: string | null) => void
): void {
  event.stopPropagation();
  selectNeuron(isSelected ? null : neuronId);
}

/**
 * Per-node derived UI state, subscribed with narrow selectors so a component
 * only re-renders when something it actually displays changes — not on every
 * write to either store (F5). Used by the per-node overlays (NeuronRings'
 * selection ring, NeuronLabels' focus label); the instanced field below reads
 * the same state once for all nodes instead of once per node.
 *
 * Exported so this is testable without mounting the WebGL scene.
 */
export function useNeuronDerivedState(neuronId: string) {
  const isSelected = useNeuralStore((s) => s.selectedNeuronId === neuronId);
  const isActive = useNeuralStore((s) => s.activeNeuronIds.has(neuronId));
  const hasContradiction = useNeuralStore((s) => s.contradictionIds.has(neuronId));
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);

  const searchQuery = useMemoryStore((s) => s.searchQuery);
  const isHighlighted = useMemoryStore((s) => s.highlightedIds.has(neuronId));
  const hasAnyHighlights = useMemoryStore((s) => s.highlightedIds.size > 0);
  const isSearchActive = searchQuery.length > 0 && hasAnyHighlights;
  const isDimmed = isSearchActive && !isHighlighted && !isSelected;

  return { isSelected, isActive, hasContradiction, isHighlighted, isSearchActive, isDimmed, selectNeuron };
}

/** Scratch objects — reused across every instance write, never allocated in a loop. */
const scratchObject = new THREE.Object3D();
const scratchColor = new THREE.Color();

/** Instance capacity in powers of two, so the meshes are not rebuilt per row. */
function capacityFor(count: number): number {
  return Math.max(64, 1 << Math.ceil(Math.log2(Math.max(1, count))));
}

const TWEEN_SECONDS = 0.45;

export default function NeuronField({ theme, positions, reducedMotion }: Props) {
  const neurons = useNeuralStore((s) => s.neurons);
  const selectedId = useNeuralStore((s) => s.selectedNeuronId);
  const hoveredId = useNeuralStore((s) => s.hoveredNeuronId);
  const activeIds = useNeuralStore((s) => s.activeNeuronIds);
  const selectNeuron = useNeuralStore((s) => s.selectNeuron);
  const hoverNeuron = useNeuralStore((s) => s.hoverNeuron);
  const highlightedIds = useMemoryStore((s) => s.highlightedIds);
  const searchQuery = useMemoryStore((s) => s.searchQuery);
  const invalidate = useThree((s) => s.invalidate);

  const coreRef = useRef<THREE.InstancedMesh>(null);
  const haloRef = useRef<THREE.InstancedMesh>(null);

  const fromRef = useRef<Float32Array>(new Float32Array(0));
  const targetRef = useRef<Float32Array>(new Float32Array(0));
  const progressRef = useRef(1);

  const capacity = useMemo(() => capacityFor(neurons.length), [neurons.length]);
  // <instancedMesh> takes its geometry and material as children, so the two
  // constructor slots are placeholders; only the capacity matters here.
  const instanceArgs = useMemo(
    () => [undefined, undefined, capacity] as unknown as [THREE.BufferGeometry, THREE.Material, number],
    [capacity]
  );
  const isSearchActive = searchQuery.length > 0 && highlightedIds.size > 0;

  /** Static per-node geometry and colour inputs — recomputed only on new data. */
  const encoded = useMemo(() => {
    const now = Date.now();
    return neurons.map((n) => ({
      radius: importanceRadius(n.importance),
      halo: haloScale(n.accessCount),
      brightness: recencyBrightness(n.createdAtMs, now),
      color: theme.colors[n.type] ?? 0x94a3b8,
      projected: n.projected,
    }));
  }, [neurons, theme.colors]);

  /** Write every instance matrix and colour for the current tween position. */
  const writeInstances = useCallback(() => {
    const core = coreRef.current;
    const halo = haloRef.current;
    if (!core || !halo) return;

    const xyz = positions.current.xyz;
    const ids = positions.current.ids;
    const count = Math.min(encoded.length, capacity);
    core.count = count;
    halo.count = count;

    for (let i = 0; i < count; i++) {
      const e = encoded[i]!;
      const id = ids[i]!;
      const isSelected = id === selectedId;
      const isHovered = id === hoveredId;
      const isHighlighted = highlightedIds.has(id);
      const isDimmed = isSearchActive && !isHighlighted && !isSelected;

      let brightness = e.brightness;
      if (isDimmed) brightness *= DIMMED_FACTOR;
      else if (isSelected) brightness = 1;
      else if (isHovered || (isHighlighted && isSearchActive) || activeIds.has(id)) {
        brightness = Math.min(1, brightness * 1.45);
      }
      // A node the server could not project is drawn faint: its position is a
      // placeholder, and it must not read as though it means something.
      if (!e.projected) brightness *= 0.55;

      const emphasis = isSelected ? 1.6 : isHovered ? 1.25 : 1;
      scratchObject.position.set(xyz[i * 3]!, xyz[i * 3 + 1]!, xyz[i * 3 + 2]!);
      scratchObject.scale.setScalar(e.radius * emphasis);
      scratchObject.updateMatrix();
      core.setMatrixAt(i, scratchObject.matrix);

      scratchObject.scale.setScalar(e.radius * emphasis * e.halo);
      scratchObject.updateMatrix();
      halo.setMatrixAt(i, scratchObject.matrix);

      const rgb = tint(e.color, brightness);
      scratchColor.setRGB(rgb.r, rgb.g, rgb.b, THREE.SRGBColorSpace);
      core.setColorAt(i, scratchColor);
      scratchColor.multiplyScalar(isDimmed ? 0.4 : 0.75);
      halo.setColorAt(i, scratchColor);
    }

    core.instanceMatrix.needsUpdate = true;
    halo.instanceMatrix.needsUpdate = true;
    if (core.instanceColor) core.instanceColor.needsUpdate = true;
    if (halo.instanceColor) halo.instanceColor.needsUpdate = true;
    core.computeBoundingSphere();
    positions.current.version += 1;
    invalidate();
  }, [encoded, capacity, positions, selectedId, hoveredId, highlightedIds, isSearchActive, activeIds, invalidate]);

  // Held in a ref so the tween below can call the latest writer without
  // listing it as a dependency — selecting a node changes `writeInstances`,
  // and a data effect that depended on it would restart the position tween
  // every time the selection changed.
  const writeRef = useRef(writeInstances);
  writeRef.current = writeInstances;

  // New node set: keep whatever is already on screen where it is, and tween it
  // to the new targets. A node that has just appeared starts at its target so
  // it does not fly in from the origin.
  useEffect(() => {
    const previousIds = positions.current.ids;
    const previousPositions = positions.current.xyz;
    const previousIndex = new Map(previousIds.map((id, i) => [id, i]));

    const count = neurons.length;
    const from = new Float32Array(count * 3);
    const target = new Float32Array(count * 3);
    const ids: string[] = new Array(count);

    neurons.forEach((n, i) => {
      ids[i] = n.id;
      const tx = n.tx ?? n.x;
      const ty = n.ty ?? n.y;
      const tz = n.tz ?? n.z;
      target[i * 3] = tx;
      target[i * 3 + 1] = ty;
      target[i * 3 + 2] = tz;

      const previous = previousIndex.get(n.id);
      const hasPrevious = previous !== undefined && previousPositions.length >= (previous + 1) * 3;
      from[i * 3] = hasPrevious ? previousPositions[previous * 3]! : tx;
      from[i * 3 + 1] = hasPrevious ? previousPositions[previous * 3 + 1]! : ty;
      from[i * 3 + 2] = hasPrevious ? previousPositions[previous * 3 + 2]! : tz;
    });

    positions.current.ids = ids;
    fromRef.current = from;
    targetRef.current = target;
    positions.current.xyz = reducedMotion ? Float32Array.from(target) : Float32Array.from(from);
    progressRef.current = reducedMotion ? 1 : 0;
    writeRef.current();
  }, [neurons, reducedMotion, positions]);

  // Anything that changes colour or emphasis but not position.
  useEffect(() => {
    writeInstances();
  }, [writeInstances]);

  useFrame((_state, delta) => {
    if (progressRef.current >= 1) return;
    progressRef.current = Math.min(1, progressRef.current + delta / TWEEN_SECONDS);
    const eased = 1 - Math.pow(1 - progressRef.current, 3);
    const from = fromRef.current;
    const target = targetRef.current;
    const current = positions.current.xyz;
    for (let i = 0; i < current.length; i++) {
      current[i] = from[i]! + (target[i]! - from[i]!) * eased;
    }
    writeRef.current();
  });

  const onClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => {
      const id = positions.current.ids[event.instanceId ?? -1];
      if (!id) return;
      handleNeuronClick(event, id, id === selectedId, selectNeuron);
    },
    [selectedId, selectNeuron, positions]
  );

  const onPointerMove = useCallback(
    (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      hoverNeuron(positions.current.ids[event.instanceId ?? -1] ?? null);
    },
    [hoverNeuron, positions]
  );

  const onPointerOut = useCallback(() => hoverNeuron(null), [hoverNeuron]);

  return (
    <group>
      {/* Halo — retrieval count. Additive and unlit so overlapping coronas read
          as density rather than as a grey wash; never a click target, so it
          cannot steal a hit from the core it surrounds. */}
      <instancedMesh
        ref={haloRef}
        args={instanceArgs}
        frustumCulled={false}
        raycast={() => null}
        renderOrder={0}
      >
        <sphereGeometry args={[1, 10, 8]} />
        <meshBasicMaterial
          transparent
          opacity={0.085}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.BackSide}
          toneMapped={false}
          fog={false}
        />
      </instancedMesh>

      {/* Core — type hue, importance size, recency brightness. */}
      <instancedMesh
        ref={coreRef}
        args={instanceArgs}
        frustumCulled={false}
        onClick={onClick}
        onPointerMove={onPointerMove}
        onPointerOut={onPointerOut}
        renderOrder={1}
      >
        <sphereGeometry args={[1, 16, 12]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
