import { useRef, useCallback, useMemo, Suspense } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { Text, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { useNeuralStore, type NeuronNode } from '../../store/neuralStore.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import type { ViewTheme } from '../../store/viewStore.js';

interface Props {
  neuron: NeuronNode;
  theme: ViewTheme;
  /** W11: skips the perpetual sine-wave pulse and ring spin below when
   *  `prefers-reduced-motion: reduce` — those never settle, so they'd keep
   *  invalidating NeuralCanvas's `frameloop="demand"` every frame forever
   *  otherwise, defeating the point of demand mode. */
  reducedMotion: boolean;
}

/**
 * Per-node derived UI state, subscribed with narrow selectors so a node only
 * re-renders when something it actually displays changes — not on every
 * write to either store (F5). A socket blip calling `setConnected`, or a
 * search touching some other node's highlight, used to re-render all ~500
 * nodes because the component pulled the whole store with no selector.
 *
 * Exported so this is testable without mounting the WebGL scene.
 */
/**
 * Click handling extracted as a pure function (same pattern as
 * useNeuronDerivedState/buildRenderableConnections) so the stopPropagation
 * behaviour is unit-testable without mounting the WebGL scene (W2).
 *
 * stopPropagation is required because r3f delivers a click to every
 * intersected object nearest-first; without it, overlapping neurons — the
 * oversized transparent glow spheres are click targets too, up to 3.5x the
 * core radius — all fire their handler, and the LAST one to run (the
 * farthest from the camera) is what `selectNeuron` ends up reflecting.
 * Stopping propagation at the first (nearest) hit makes clicking overlapping
 * neurons select the frontmost one.
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

export default function NeuronMesh({ neuron, theme, reducedMotion }: Props) {
  const coreRef  = useRef<THREE.Mesh>(null);
  const glowRef  = useRef<THREE.Mesh>(null);
  const ringRef  = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { isSelected, isActive, hasContradiction, isHighlighted, isSearchActive, isDimmed, selectNeuron } =
    useNeuronDerivedState(neuron.id);

  const colorInt = theme.colors[neuron.type as keyof typeof theme.colors] ?? 0x94a3b8;
  const colorHex = '#' + colorInt.toString(16).padStart(6, '0');

  const coreRadius = useMemo(() => {
    if (theme.style === 'stars')  return 0.3 + neuron.importance * 0.9;
    if (theme.style === 'neon')   return 0.4 + neuron.importance * 1.2;
    if (theme.style === 'ghost')  return 0.8 + neuron.importance * 2.2;
    if (theme.style === 'plasma') return 0.5 + neuron.importance * 1.6;
    return 0.5 + neuron.importance * 1.5; // cosmos
  }, [neuron.importance, theme.style]);

  useFrame(({ clock }, delta) => {
    const t = clock.getElapsedTime();
    const speed = theme.style === 'ghost' ? 1.0 : theme.style === 'stars' ? 2.5 : 1.8;

    // ── Smooth position transitions ──
    if (groupRef.current && neuron.tx !== undefined && neuron.ty !== undefined && neuron.tz !== undefined) {
      const lerpSpeed = Math.min(delta * 4, 1);
      groupRef.current.position.x += (neuron.tx - groupRef.current.position.x) * lerpSpeed;
      groupRef.current.position.y += (neuron.ty - groupRef.current.position.y) * lerpSpeed;
      groupRef.current.position.z += (neuron.tz - groupRef.current.position.z) * lerpSpeed;
    }

    // ── Dim factor for search filtering ──
    const dimFactor = isDimmed ? 0.15 : 1;

    if (coreRef.current) {
      const mat = coreRef.current.material as THREE.MeshStandardMaterial;
      const baseEI = isActive ? 3 : isSelected ? 2.2 : (theme.style === 'stars' ? 2.0 : 0.7) + neuron.activation;
      const highlightBoost = isHighlighted && isSearchActive ? 1.5 : 0;
      const targetEI = (baseEI + highlightBoost) * dimFactor;
      mat.emissiveIntensity += (targetEI - mat.emissiveIntensity) * Math.min(delta * 6, 1);
      mat.opacity = isDimmed ? 0.15 : 1;
      mat.transparent = isDimmed;
      const pulse = reducedMotion ? 1 : 1 + Math.sin(t * speed + neuron.importance * 10) * (theme.style === 'ghost' ? 0.08 : 0.04);
      const highlightPulse = !reducedMotion && isHighlighted && isSearchActive ? 1 + Math.sin(t * 4) * 0.08 : 1;
      coreRef.current.scale.setScalar(pulse * highlightPulse);
    }

    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial;
      const targetOp = (isActive ? 0.5 : isSelected ? 0.38 : 0.1 + neuron.importance * 0.15) * dimFactor;
      mat.opacity += (targetOp - mat.opacity) * Math.min(delta * 4, 1);
      const gp = reducedMotion ? 1 : 1 + Math.sin(t * speed + neuron.importance * 10) * 0.07;
      glowRef.current.scale.setScalar(gp);
    }

    if (ringRef.current) {
      ringRef.current.rotation.z += reducedMotion ? 0 : delta * (isSelected ? 1.6 : hasContradiction ? 2.0 : 0.5);
      ringRef.current.rotation.x = reducedMotion ? 0 : Math.sin(t * 0.4) * 0.35;
      const mat = ringRef.current.material as THREE.MeshStandardMaterial;
      const targetOp = isSelected ? 0.9 : isActive ? 0.6 : hasContradiction ? 0.7 : 0;
      mat.opacity += (targetOp - mat.opacity) * Math.min(delta * 8, 1);
      if (hasContradiction && !isSelected) {
        mat.color.set(0xf97316); // orange for contradiction
        mat.emissive.set(0xf97316);
      }
    }
  });

  const handleClick = useCallback(
    (event: ThreeEvent<MouseEvent>) => handleNeuronClick(event, neuron.id, isSelected, selectNeuron),
    [neuron.id, isSelected, selectNeuron]
  );

  // Initial position ONLY, computed once on mount — the frame loop above owns
  // every position update after that (F4). Passing a `position` prop that
  // tracks neuron.tx/ty/tz would fight it: R3F diffs the position prop by
  // value on every render and calls position.set(...) the instant the target
  // changes, which snaps the group there before the useFrame lerp gets a
  // single frame to interpolate. Reading/writing a ref during render like
  // this is React's documented pattern for one-time lazy initialization.
  const initialPosRef = useRef<[number, number, number] | null>(null);
  if (initialPosRef.current === null) {
    initialPosRef.current = [
      neuron.tx ?? neuron.x,
      neuron.ty ?? neuron.y,
      neuron.tz ?? neuron.z,
    ];
  }
  const initialPos = initialPosRef.current;

  // ── Style variants ──────────────────────────────────────────────────────────
  //
  // W3: every <Text> below (drei's, which suspends on first-time font load
  // via `preloadFont`) is wrapped in its own local `<Suspense fallback={null}>`
  // rather than relying solely on NeuralCanvas's single top-level boundary.
  // With one shared boundary, a single high-importance neuron rendering a
  // label was enough to blank the ENTIRE scene — lights, stars, every other
  // neuron's core, connections, controls — because Suspense blanks its whole
  // subtree, not just the node that suspended. A local boundary per label
  // means only that (decorative, optional) label is briefly absent; the
  // Sphere geometry around it, and everything else in the scene, renders
  // immediately regardless of font-load state.

  if (theme.style === 'neon') {
    return (
      <group ref={groupRef} position={initialPos}>
        <Sphere ref={coreRef} args={[coreRadius, 12, 12]} onClick={handleClick}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={1.2} roughness={1} metalness={0} />
        </Sphere>
        <Sphere ref={glowRef} args={[coreRadius * 2.5, 8, 8]}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.5} transparent opacity={0.07} depthWrite={false} side={THREE.BackSide} />
        </Sphere>
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[coreRadius * 2, 0.05, 6, 32]} />
          <meshStandardMaterial color={hasContradiction ? 0xf97316 : colorInt} emissive={hasContradiction ? 0xf97316 : colorInt} emissiveIntensity={3} transparent opacity={0} depthWrite={false} />
        </mesh>
        {hasContradiction && (
          <Suspense fallback={null}>
            <Text position={[coreRadius + 1.2, coreRadius + 1.2, 0]} fontSize={1.0} color="#f97316" anchorX="center" anchorY="middle" renderOrder={3} depthOffset={-1}>
              ⚠
            </Text>
          </Suspense>
        )}
        {(isSelected || neuron.importance > 0.8) && (
          <Suspense fallback={null}>
            <Text position={[0, coreRadius + 1.8, 0]} fontSize={1.2} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
              {neuron.label.slice(0, 20)}
            </Text>
          </Suspense>
        )}
      </group>
    );
  }

  if (theme.style === 'stars') {
    return (
      <group ref={groupRef} position={initialPos}>
        <Sphere ref={coreRef} args={[coreRadius, 8, 8]} onClick={handleClick}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={2.5} roughness={0.1} metalness={0.9} />
        </Sphere>
        <Sphere ref={glowRef} args={[coreRadius * 3.5, 6, 6]}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.4} transparent opacity={0.06} depthWrite={false} side={THREE.BackSide} />
        </Sphere>
        {hasContradiction && (
          <Suspense fallback={null}>
            <Text position={[coreRadius + 0.8, coreRadius + 0.8, 0]} fontSize={0.8} color="#f97316" anchorX="center" anchorY="middle" renderOrder={3} depthOffset={-1}>
              ⚠
            </Text>
          </Suspense>
        )}
        {isSelected && (
          <Suspense fallback={null}>
            <Text position={[0, coreRadius + 1.5, 0]} fontSize={1.1} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
              {neuron.label.slice(0, 20)}
            </Text>
          </Suspense>
        )}
      </group>
    );
  }

  if (theme.style === 'ghost') {
    return (
      <group ref={groupRef} position={initialPos}>
        <Sphere ref={glowRef} args={[coreRadius * 2.8, 12, 12]} onClick={handleClick}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.5} transparent opacity={0.12} depthWrite={false} side={THREE.FrontSide} />
        </Sphere>
        <Sphere ref={coreRef} args={[coreRadius, 20, 20]} onClick={handleClick}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={1.0} roughness={0.05} metalness={0.4} transparent opacity={0.92} />
        </Sphere>
        <mesh ref={ringRef} rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[coreRadius * 2, 0.07, 8, 40]} />
          <meshStandardMaterial color={hasContradiction ? 0xf97316 : colorInt} emissive={hasContradiction ? 0xf97316 : colorInt} emissiveIntensity={2.5} transparent opacity={0} depthWrite={false} />
        </mesh>
        {hasContradiction && (
          <Suspense fallback={null}>
            <Text position={[coreRadius + 1.5, coreRadius + 1.5, 0]} fontSize={1.2} color="#f97316" anchorX="center" anchorY="middle" renderOrder={3} depthOffset={-1}>
              ⚠
            </Text>
          </Suspense>
        )}
        {(isSelected || neuron.importance > 0.85) && (
          <Suspense fallback={null}>
            <Text position={[0, coreRadius + 2.5, 0]} fontSize={1.3} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
              {neuron.label.slice(0, 22)}
            </Text>
          </Suspense>
        )}
      </group>
    );
  }

  // cosmos / plasma — default layered design
  return (
    <group ref={groupRef} position={initialPos}>
      <Sphere ref={glowRef} args={[coreRadius * 2.2, 12, 12]} onClick={handleClick}>
        <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.3} transparent opacity={0.1} depthWrite={false} side={THREE.BackSide} />
      </Sphere>
      <Sphere ref={coreRef} args={[coreRadius, 24, 24]} onClick={handleClick}>
        <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.7} roughness={0.15} metalness={0.85} />
      </Sphere>
      <mesh ref={ringRef} rotation={[Math.PI / 2.5, 0, 0]}>
        <torusGeometry args={[coreRadius * 1.75, 0.07, 8, 40]} />
        <meshStandardMaterial color={hasContradiction ? 0xf97316 : colorInt} emissive={hasContradiction ? 0xf97316 : colorInt} emissiveIntensity={2.5} transparent opacity={0} depthWrite={false} />
      </mesh>
      {hasContradiction && (
        <Suspense fallback={null}>
          <Text position={[coreRadius + 1.2, coreRadius + 1.2, 0]} fontSize={1.1} color="#f97316" anchorX="center" anchorY="middle" renderOrder={3} depthOffset={-1}>
            ⚠
          </Text>
        </Suspense>
      )}
      {(isSelected || (neuron.type === 'semantic' && neuron.importance > 0.75)) && (
        <Suspense fallback={null}>
          <Text position={[0, coreRadius + 2.2, 0]} fontSize={1.4} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
            {neuron.label.slice(0, 22)}
          </Text>
        </Suspense>
      )}
    </group>
  );
}
