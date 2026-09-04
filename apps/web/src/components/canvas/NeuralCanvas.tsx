import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Stars, Grid } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { Suspense, useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useNeuralStore, type NeuronNode, type NeuronConnection } from '../../store/neuralStore.js';
import { useViewStore, type ViewTheme } from '../../store/viewStore.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import NeuronField from './NeuronMesh.js';
import NeuronRings from './NeuronRings.js';
import NeuronLabels from './NeuronLabels.js';
import ConnectionLines from './ConnectionLine.js';
import { createScenePositions } from './scenePositions.js';

export interface RenderableConnection {
  id: string;
  sourceId: string;
  targetId: string;
  /** Instance index of each endpoint, parallel to `neurons` and to the shared
   *  position buffer — what the edge geometry needs to follow a tween. */
  sourceIndex: number;
  targetIndex: number;
  sourcePos: [number, number, number];
  targetPos: [number, number, number];
  strength: number;
  relationship: string;
}

/**
 * Map connections onto the endpoints the edge geometry needs.
 *
 * Pulled out as a plain, testable function (F5, "one level up" from the node
 * renderer): an O(1) id → neuron lookup instead of an O(connections x neurons)
 * `neurons.find` per line, and its result is meant to be wrapped in `useMemo`
 * by the caller so it is rebuilt only when the data changes — not on every
 * render that has nothing to do with connections. At 3,102 edges that
 * difference is the whole frame budget.
 */
export function buildRenderableConnections(
  neurons: NeuronNode[],
  connections: NeuronConnection[]
): RenderableConnection[] {
  const byId = new Map(neurons.map((n, index) => [n.id, { node: n, index }] as const));
  const result: RenderableConnection[] = [];
  for (const conn of connections) {
    const src = byId.get(conn.sourceId);
    const tgt = byId.get(conn.targetId);
    if (!src || !tgt || !conn.targetId) continue;
    result.push({
      id: conn.id,
      sourceId: conn.sourceId,
      targetId: conn.targetId,
      sourceIndex: src.index,
      targetIndex: tgt.index,
      sourcePos: [src.node.tx ?? src.node.x, src.node.ty ?? src.node.y, src.node.tz ?? src.node.z],
      targetPos: [tgt.node.tx ?? tgt.node.x, tgt.node.ty ?? tgt.node.y, tgt.node.tz ?? tgt.node.z],
      strength: conn.strength,
      relationship: conn.relationship,
    });
  }
  return result;
}

/** Non-null Suspense fallback (W3) — a dim placeholder rendered with plain
 *  three.js primitives, so it can never itself suspend. */
function CanvasLoadingFallback({ background }: { background: string }) {
  return (
    <>
      <color attach="background" args={[background]} />
      <ambientLight intensity={0.4} />
      <mesh>
        <icosahedronGeometry args={[12, 1]} />
        <meshBasicMaterial color="#334155" wireframe />
      </mesh>
    </>
  );
}

/**
 * Frames the scene for the active view, at the current viewport.
 *
 * Two jobs the `camera` prop on <Canvas> cannot do. It is applied once at
 * mount, so the three views would otherwise share whatever framing the first
 * one wanted — and since they are now framings of ONE layout, framing is most
 * of what distinguishes them. And it takes a fixed position, which crops the
 * graph on a narrow viewport: a perspective camera fits its FOV vertically, so
 * at a 375px width the horizontal half-extent on screen is barely half what it
 * is at 1440px. The distance is solved from the content radius and the actual
 * aspect ratio instead, and the fog follows it, so a phone gets the same
 * composition rather than a cropped one.
 */
function CameraRig({ theme }: { theme: ViewTheme }) {
  const camera = useThree((s) => s.camera);
  const scene = useThree((s) => s.scene);
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as { target?: THREE.Vector3; update?: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  const { direction, frameRadius, target, fov } = theme.camera;
  const { nearFactor, farFactor } = theme.fog;
  const aspect = size.width > 0 && size.height > 0 ? size.width / size.height : 1;

  useEffect(() => {
    const half = Math.tan((fov * Math.PI) / 360);
    // Fit vertically AND horizontally; whichever needs more room wins.
    const distance = (frameRadius / half) * Math.max(1, 1 / aspect) * 1.06;

    const offset = new THREE.Vector3(...direction).normalize().multiplyScalar(distance);
    camera.position.set(target[0] + offset.x, target[1] + offset.y, target[2] + offset.z);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
    camera.lookAt(target[0], target[1], target[2]);

    if (scene.fog instanceof THREE.Fog) {
      scene.fog.near = distance * nearFactor;
      scene.fog.far = distance * farFactor;
    }

    controls?.target?.set(target[0], target[1], target[2]);
    controls?.update?.();
    invalidate();
  }, [camera, scene, controls, invalidate, direction, frameRadius, target, fov, aspect, nearFactor, farFactor]);

  return null;
}

export default function NeuralCanvas() {
  // Narrow selectors (F5): this component used to pull the whole neural store,
  // so it (and every child it re-rendered) re-ran on state it never used.
  const neurons = useNeuralStore((s) => s.neurons);
  const connections = useNeuralStore((s) => s.connections);
  const selectedId = useNeuralStore((s) => s.selectedNeuronId);
  const activeView = useViewStore((s) => s.activeView);
  const { theme } = activeView;
  // W11: no prior handling of prefers-reduced-motion, and the render loop never
  // idled. `frameloop="demand"` (r3f renders only on an actual change or an
  // explicit invalidate) is the load-bearing fix; auto-rotate and the Stars
  // twinkle are turned off outright, since a control loop cannot un-spin a
  // rotation that is still being requested every frame.
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const renderableConnections = useMemo(
    () => buildRenderableConnections(neurons, connections),
    [neurons, connections]
  );

  // Shared tween buffer: NeuronField writes it, rings, labels and edges read it.
  const positions = useRef(createScenePositions());

  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0, 140], fov: theme.camera.fov, near: 0.1, far: 4000 }}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
      dpr={[1, 1.5]}
      frameloop={reducedMotion ? 'demand' : 'always'}
    >
      {/* W3: defence in depth. Every <Text> in NeuronLabels suspends behind its
          own local boundary, so a font fetch never blanks the shared scene;
          this one keeps a visible fallback in case some future suspending
          addition ever bubbles up here. */}
      <Suspense fallback={<CanvasLoadingFallback background={theme.background} />}>
        <color attach="background" args={[theme.background]} />
        {/* Fog is the depth cue that replaces the old per-style haze: it is
            keyed to the world box, so "further away" reads the same in every
            view instead of meaning something different in each. */}
        {/* CameraRig owns near/far — they are a fraction of the camera distance
            it solves for, not fixed world units. These are placeholders. */}
        <fog attach="fog" args={[theme.background, 100, 400]} />

        {/* The node and edge materials are unlit — colour is data here, and a
            light would tint it — so this is atmosphere for the grid and the
            fallback mesh only. */}
        <ambientLight intensity={0.6} />

        <Stars
          radius={520}
          depth={110}
          count={theme.style === 'net' ? 700 : 2200}
          factor={2.4}
          saturation={0}
          fade
          speed={reducedMotion ? 0 : 0.16}
        />

        {theme.grid && (
          <Grid
            position={[0, -58, 0]}
            args={[240, 240]}
            cellSize={10}
            cellThickness={0.3}
            cellColor="#16233a"
            sectionSize={40}
            sectionThickness={0.6}
            sectionColor="#22344f"
            fadeDistance={320}
            infiniteGrid
          />
        )}

        <ConnectionLines
          connections={renderableConnections}
          positions={positions}
          selectedId={selectedId}
        />
        <NeuronField theme={theme} positions={positions} reducedMotion={reducedMotion} />
        <NeuronRings positions={positions} reducedMotion={reducedMotion} />
        <NeuronLabels positions={positions} />

        <CameraRig theme={theme} />

        <OrbitControls
          enableDamping
          dampingFactor={0.04}
          rotateSpeed={0.45}
          zoomSpeed={0.7}
          minDistance={10}
          maxDistance={1200}
          makeDefault
          autoRotate={theme.autoRotateSpeed > 0 && !reducedMotion}
          autoRotateSpeed={theme.autoRotateSpeed}
        />

        <EffectComposer>
          <Bloom
            intensity={theme.bloom.intensity}
            luminanceThreshold={theme.bloom.threshold}
            luminanceSmoothing={theme.bloom.smoothing}
            mipmapBlur
          />
          <Vignette offset={0.35} darkness={0.6} blendFunction={BlendFunction.NORMAL} />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
