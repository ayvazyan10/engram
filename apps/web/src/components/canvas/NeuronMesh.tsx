import { useRef, useCallback, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, Sphere } from '@react-three/drei';
import * as THREE from 'three';
import { useNeuralStore, type NeuronNode } from '../../store/neuralStore.js';
import type { ViewTheme } from '../../store/viewStore.js';

interface Props {
  neuron: NeuronNode;
  theme: ViewTheme;
}

export default function NeuronMesh({ neuron, theme }: Props) {
  const coreRef  = useRef<THREE.Mesh>(null);
  const glowRef  = useRef<THREE.Mesh>(null);
  const ringRef  = useRef<THREE.Mesh>(null);
  const { selectedNeuronId, activeNeuronIds, selectNeuron } = useNeuralStore();

  const isSelected = selectedNeuronId === neuron.id;
  const isActive   = activeNeuronIds.has(neuron.id);

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

    if (coreRef.current) {
      const mat = coreRef.current.material as THREE.MeshStandardMaterial;
      const targetEI = isActive ? 3 : isSelected ? 2.2 : (theme.style === 'stars' ? 2.0 : 0.7) + neuron.activation;
      mat.emissiveIntensity += (targetEI - mat.emissiveIntensity) * Math.min(delta * 6, 1);
      const pulse = 1 + Math.sin(t * speed + neuron.importance * 10) * (theme.style === 'ghost' ? 0.08 : 0.04);
      coreRef.current.scale.setScalar(pulse);
    }

    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial;
      const targetOp = isActive ? 0.5 : isSelected ? 0.38 : 0.1 + neuron.importance * 0.15;
      mat.opacity += (targetOp - mat.opacity) * Math.min(delta * 4, 1);
      const gp = 1 + Math.sin(t * speed + neuron.importance * 10) * 0.07;
      glowRef.current.scale.setScalar(gp);
    }

    if (ringRef.current) {
      ringRef.current.rotation.z += delta * (isSelected ? 1.6 : 0.5);
      ringRef.current.rotation.x = Math.sin(t * 0.4) * 0.35;
      const mat = ringRef.current.material as THREE.MeshStandardMaterial;
      const targetOp = isSelected ? 0.9 : isActive ? 0.6 : 0;
      mat.opacity += (targetOp - mat.opacity) * Math.min(delta * 8, 1);
    }
  });

  const handleClick = useCallback(() => {
    selectNeuron(isSelected ? null : neuron.id);
  }, [neuron.id, isSelected, selectNeuron]);

  // ── Style variants ──────────────────────────────────────────────────────────

  if (theme.style === 'neon') {
    return (
      <group position={[neuron.x, neuron.y, neuron.z]}>
        <Sphere ref={coreRef} args={[coreRadius, 12, 12]} onClick={handleClick}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={1.2} roughness={1} metalness={0} />
        </Sphere>
        <Sphere ref={glowRef} args={[coreRadius * 2.5, 8, 8]}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.5} transparent opacity={0.07} depthWrite={false} side={THREE.BackSide} />
        </Sphere>
        <mesh ref={ringRef} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[coreRadius * 2, 0.05, 6, 32]} />
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={3} transparent opacity={0} depthWrite={false} />
        </mesh>
        {(isSelected || neuron.importance > 0.8) && (
          <Text position={[0, coreRadius + 1.8, 0]} fontSize={1.2} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
            {neuron.label.slice(0, 20)}
          </Text>
        )}
      </group>
    );
  }

  if (theme.style === 'stars') {
    // Tiny bright star-like points with cross flare on selected
    return (
      <group position={[neuron.x, neuron.y, neuron.z]}>
        <Sphere ref={coreRef} args={[coreRadius, 8, 8]} onClick={handleClick}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={2.5} roughness={0.1} metalness={0.9} />
        </Sphere>
        <Sphere ref={glowRef} args={[coreRadius * 3.5, 6, 6]}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.4} transparent opacity={0.06} depthWrite={false} side={THREE.BackSide} />
        </Sphere>
        {isSelected && (
          <Text position={[0, coreRadius + 1.5, 0]} fontSize={1.1} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
            {neuron.label.slice(0, 20)}
          </Text>
        )}
      </group>
    );
  }

  if (theme.style === 'ghost') {
    // Large soft orbs for Nebula
    return (
      <group position={[neuron.x, neuron.y, neuron.z]}>
        <Sphere ref={glowRef} args={[coreRadius * 2.8, 12, 12]} onClick={handleClick}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.5} transparent opacity={0.12} depthWrite={false} side={THREE.FrontSide} />
        </Sphere>
        <Sphere ref={coreRef} args={[coreRadius, 20, 20]} onClick={handleClick}>
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={1.0} roughness={0.05} metalness={0.4} transparent opacity={0.92} />
        </Sphere>
        <mesh ref={ringRef} rotation={[Math.PI / 3, 0, 0]}>
          <torusGeometry args={[coreRadius * 2, 0.07, 8, 40]} />
          <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={2.5} transparent opacity={0} depthWrite={false} />
        </mesh>
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
    <group position={[neuron.x, neuron.y, neuron.z]}>
      {/* Outer glow */}
      <Sphere ref={glowRef} args={[coreRadius * 2.2, 12, 12]} onClick={handleClick}>
        <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.3} transparent opacity={0.1} depthWrite={false} side={THREE.BackSide} />
      </Sphere>
      {/* Core */}
      <Sphere ref={coreRef} args={[coreRadius, 24, 24]} onClick={handleClick}>
        <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={0.7} roughness={0.15} metalness={0.85} />
      </Sphere>
      {/* Orbital ring */}
      <mesh ref={ringRef} rotation={[Math.PI / 2.5, 0, 0]}>
        <torusGeometry args={[coreRadius * 1.75, 0.07, 8, 40]} />
        <meshStandardMaterial color={colorInt} emissive={colorInt} emissiveIntensity={2.5} transparent opacity={0} depthWrite={false} />
      </mesh>
      {(isSelected || (neuron.type === 'semantic' && neuron.importance > 0.75)) && (
        <Text position={[0, coreRadius + 2.2, 0]} fontSize={1.4} color={colorHex} anchorX="center" anchorY="bottom" renderOrder={2} depthOffset={-1}>
          {neuron.label.slice(0, 22)}
        </Text>
      )}
    </group>
  );
}
