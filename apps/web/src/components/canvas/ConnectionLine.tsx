import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { Vector3Tuple } from 'three';
import type { ViewTheme } from '../../store/viewStore.js';

interface Props {
  sourcePos: Vector3Tuple;
  targetPos: Vector3Tuple;
  strength: number;
  style: ViewTheme['style'];
}

const STYLE_COLORS: Record<ViewTheme['style'], { low: number; mid: number; high: number }> = {
  cosmos:  { low: 0x1e2060, mid: 0x3730a3, high: 0x6366f1 },
  neon:    { low: 0x14532d, mid: 0x166534, high: 0x4ade80 },
  plasma:  { low: 0x1e1b4b, mid: 0x4338ca, high: 0x818cf8 },
  stars:   { low: 0x2d1b00, mid: 0x78350f, high: 0xfde68a },
  ghost:   { low: 0x2e1065, mid: 0x7c3aed, high: 0xc084fc },
};

export default function ConnectionLine({ sourcePos, targetPos, strength, style }: Props) {
  const ref = useRef<THREE.Mesh>(null);
  const palette = STYLE_COLORS[style] ?? STYLE_COLORS.cosmos;

  const { midPoint, length, quaternion } = useMemo(() => {
    const s   = new THREE.Vector3(...sourcePos);
    const t   = new THREE.Vector3(...targetPos);
    const mid = s.clone().lerp(t, 0.5);
    const dir = t.clone().sub(s);
    const len = dir.length();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    return { midPoint: mid, length: len, quaternion: quat };
  }, [sourcePos, targetPos]);

  useFrame(({ clock }) => {
    if (!ref.current) return;
    const mat = ref.current.material as THREE.MeshStandardMaterial;
    const base = 0.06 + strength * 0.22;
    const pulse = style === 'neon' ? 0.08 : 0.04;
    mat.opacity = base + Math.sin(clock.getElapsedTime() * 1.5 + strength * 8) * pulse;
  });

  const color  = strength > 0.7 ? palette.high : strength > 0.4 ? palette.mid : palette.low;
  const radius = style === 'neon' ? 0.06 + strength * 0.1 :
                 style === 'stars' ? 0.03 + strength * 0.04 :
                 0.04 + strength * 0.08;

  return (
    <mesh ref={ref} position={midPoint} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 4, 1]} />
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={style === 'neon' ? 2 : style === 'ghost' ? 1.8 : 1.2}
        transparent
        opacity={0.06 + strength * 0.22}
        depthWrite={false}
      />
    </mesh>
  );
}
