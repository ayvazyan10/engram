import { useRef, useCallback, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { useNeuralStore, type NeuronNode } from '../../store/neuralStore.js';
import { useMemoryStore } from '../../store/memoryStore.js';
import type { ViewTheme } from '../../store/viewStore.js';

interface Props {
  neuron: NeuronNode;
  theme: ViewTheme;
}

export default function NeuronMesh({ neuron, theme }: Props) {
  const coreRef  = useRef<THREE.Mesh>(null);
  const glowRef  = useRef<THREE.Mesh>(null);
  const ringRef  = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { selectedNeuronId, activeNeuronIds, contradictionPairs, selectNeuron } = useNeuralStore();
  const { highlightedIds, searchQuery } = useMemoryStore();

  const isSelected = selectedNeuronId === neuron.id;
  const isActive   = activeNeuronIds.has(neuron.id);
  const isSearchActive = searchQuery.length > 0 && highlightedIds.size > 0;
  const isHighlighted  = highlightedIds.has(neuron.id);
  const isDimmed       = isSearchActive && !isHighlighted && !isSelected;
  const hasContradiction = contradictionPairs.some(
    (p) => p.sourceId === neuron.id || p.targetId === neuron.id
  );

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
      const pulse = 1 + Math.sin(t * speed + neuron.importance * 10) * (theme.style === 'ghost' ? 0.08 : 0.04);
      const highlightPulse = isHighlighted && isSearchActive ? 1 + Math.sin(t * 4) * 0.08 : 1;
      coreRef.current.scale.setScalar(pulse * highlightPulse);
    }

    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial;
      const targetOp = (isActive ? 0.5 : isSelected ? 0.38 : 0.1 + neuron.importance * 0.15) * dimFactor;
      mat.opacity += (targetOp - mat.opacity) * Math.min(delta * 4, 1);
      const gp = 1 + Math.sin(t * speed + neuron.importance * 10) * 0.07;
      glowRef.current.scale.setScalar(gp);
    }

    if (ringRef.current) {
      ringRef.current.rotation.z += delta * (isSelected ? 1.6 : hasContradiction ? 2.0 : 0.5);
      ringRef.current.rotation.x = Math.sin(t * 0.4) * 0.35;
      const mat = ringRef.current.material as THREE.MeshStandardMaterial;
      const targetOp = isSelected ? 0.9 : isActive ? 0.6 : hasContradiction ? 0.7 : 0;
      mat.opacity += (targetOp - mat.opacity) * Math.min(delta * 8, 1);
      if (hasContradiction && !isSelected) {
        mat.color.set(0xf97316); // orange for contradiction
        mat.emissive.set(0xf97316);
      }
    }
  });

  const handleClick = useCallback(() => {
    selectNeuron(isSelected ? null : neuron.id);
  }, [neuron.id, isSelected, selectNeuron]);

  // Initial position (before smooth transitions kick in)
  const pos: [number, number, number] = [
    neuron.tx ?? neuron.x,
    neuron.ty ?? neuron.y,
    neuron.tz ?? neuron.z,
  ];

  // ── Style variants ──────────────────────────────────────────────────────────

  if (theme.style === 'neon') {
    return (
      <group ref={groupRef} position={pos}>
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
          <Text position={[coreRadius + 1.2, coreRadius + 1.2, 0]} fontSize={1.0} color="#f97316" anchorX="center" anchorY="middle" renderOrder={3} depthOffset={-1}>
            ⚠
          </Text>
        )}
        {(isSelected || neuron.importance > 0.8) && (
          <Text position={[0, coreRadius + 1.8, 0]} fontSize={1.2} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
            {neuron.label.slice(0, 20)}
          </Text>
        )}
      </group>
    );
  }

  if (theme.style === 'stars') {
    return (
      <group ref={groupRef} position={pos}>
        <Sphere ref={coreRef} args={[coreRadius, 8, 8]} onClick={handleClick}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={2.5} roughness={0.1} metalness={0.9} />
        </Sphere>
        <Sphere ref={glowRef} args={[coreRadius * 3.5, 6, 6]}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.4} transparent opacity={0.06} depthWrite={false} side={THREE.BackSide} />
        </Sphere>
        {hasContradiction && (
          <Text position={[coreRadius + 0.8, coreRadius + 0.8, 0]} fontSize={0.8} color="#f97316" anchorX="center" anchorY="middle" renderOrder={3} depthOffset={-1}>
            ⚠
          </Text>
        )}
        {isSelected && (
          <Text position={[0, coreRadius + 1.5, 0]} fontSize={1.1} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
            {neuron.label.slice(0, 20)}
          </Text>
        )}
      </group>
    );
  }

  if (theme.style === 'ghost') {
    return (
      <group ref={groupRef} position={pos}>
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
          <Text position={[coreRadius + 1.5, coreRadius + 1.5, 0]} fontSize={1.2} color="#f97316" anchorX="center" anchorY="middle" renderOrder={3} depthOffset={-1}>
            ⚠
          </Text>
        )}
        {(isSelected || neuron.importance > 0.85) && (
          <Text position={[0, coreRadius + 2.5, 0]} fontSize={1.3} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
            {neuron.label.slice(0, 22)}
          </Text>
        )}
      </group>
    );
  }

  // cosmos / plasma — default layered design
  return (
    <group ref={groupRef} position={pos}>
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
        <Text position={[coreRadius + 1.2, coreRadius + 1.2, 0]} fontSize={1.1} color="#f97316" anchorX="center" anchorY="middle" renderOrder={3} depthOffset={-1}>
          ⚠
        </Text>
      )}
      {(isSelected || (neuron.type === 'semantic' && neuron.importance > 0.75)) && (
        <Text position={[0, coreRadius + 2.2, 0]} fontSize={1.4} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
          {neuron.label.slice(0, 22)}
        </Text>
      )}
    </group>
  );
}
