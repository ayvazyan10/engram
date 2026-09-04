import { useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { hexToInt, STATUS } from '../../lib/tokens.js';
import type { RenderableConnection } from './NeuralCanvas.js';
import type { ScenePositions } from './scenePositions.js';

/**
 * Every edge in one draw call.
 *
 * This was a `<mesh>` with a 4-sided cylinder per connection, plus a per-frame
 * opacity animation per connection. That is one draw call per edge — and it was
 * only ever asked to draw 67 of them, because the client fetched the
 * neighbourhoods of the top 30 memories by importance and then dropped any edge
 * whose other end had fallen outside its 200-row page. It now renders the full
 * set the server reports (3,102 on the live store) as a single THREE.LineSegments
 * over one BufferGeometry.
 */

interface Props {
  connections: readonly RenderableConnection[];
  positions: RefObject<ScenePositions>;
  /** Edges touching this node are brightened — the fastest way to read a
   *  neighbourhood out of a dense graph. */
  selectedId: string | null;
}

const CONTRADICTION = hexToInt(STATUS.contradiction);

/** Cool ramp for ordinary relations; strength picks the step. */
const RELATION_RAMP = [0x2b3d7d, 0x4a63d6, 0x8fa8ff] as const;

function relationColor(strength: number): number {
  if (strength > 0.7) return RELATION_RAMP[2];
  if (strength > 0.45) return RELATION_RAMP[1];
  return RELATION_RAMP[0];
}

const scratchColor = new THREE.Color();

/** Colour and brightness for one edge, folded into the vertex colour. */
function edgeColor(edge: RenderableConnection, incidentToSelection: boolean): THREE.Color {
  const isContradiction = edge.relationship === 'contradicts';
  scratchColor.setHex(isContradiction ? CONTRADICTION : relationColor(edge.strength));
  // Opacity is a single material-wide value for a LineSegments, so per-edge
  // weight has to live in the colour: strong edges read brighter, weak ones
  // recede, and anything touching the selection is lifted above both.
  const weight = 0.45 + edge.strength * 0.55;
  scratchColor.multiplyScalar(incidentToSelection ? 1.9 : isContradiction ? weight * 0.85 : weight);
  return scratchColor;
}

export default function ConnectionLines({ connections, positions, selectedId }: Props) {
  const geometryRef = useRef<THREE.BufferGeometry>(null);
  const versionRef = useRef(-1);

  const buffers = useMemo(() => {
    const count = connections.length;
    return {
      position: new Float32Array(count * 6),
      color: new Float32Array(count * 6),
      count,
    };
  }, [connections.length]);

  // Colour depends on the data and the selection, never on the frame.
  useEffect(() => {
    const { color } = buffers;
    connections.forEach((edge, i) => {
      const incident =
        selectedId !== null && (edge.sourceId === selectedId || edge.targetId === selectedId);
      const c = edgeColor(edge, incident);
      for (const offset of [0, 3]) {
        color[i * 6 + offset] = c.r;
        color[i * 6 + offset + 1] = c.g;
        color[i * 6 + offset + 2] = c.b;
      }
    });
    const attribute = geometryRef.current?.getAttribute('color');
    if (attribute) attribute.needsUpdate = true;
    // Force a position rewrite too: the buffers were just reallocated.
    versionRef.current = -1;
  }, [connections, buffers, selectedId]);

  useFrame(() => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    const scene = positions.current;
    if (scene.version === versionRef.current) return;
    versionRef.current = scene.version;

    const { position } = buffers;
    const xyz = scene.xyz;
    connections.forEach((edge, i) => {
      const s = edge.sourceIndex * 3;
      const t = edge.targetIndex * 3;
      if (s < 0 || t < 0 || t + 2 >= xyz.length || s + 2 >= xyz.length) return;
      position[i * 6] = xyz[s]!;
      position[i * 6 + 1] = xyz[s + 1]!;
      position[i * 6 + 2] = xyz[s + 2]!;
      position[i * 6 + 3] = xyz[t]!;
      position[i * 6 + 4] = xyz[t + 1]!;
      position[i * 6 + 5] = xyz[t + 2]!;
    });
    const attribute = geometry.getAttribute('position');
    if (attribute) attribute.needsUpdate = true;
    geometry.computeBoundingSphere();
  });

  if (buffers.count === 0) return null;

  return (
    <lineSegments frustumCulled={false} raycast={() => null} renderOrder={0}>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute attach="attributes-position" args={[buffers.position, 3]} />
        <bufferAttribute attach="attributes-color" args={[buffers.color, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        vertexColors
        transparent
        opacity={0.7}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
