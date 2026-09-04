import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars, Grid } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { Suspense, useMemo } from 'react';
import { useNeuralStore, type NeuronNode, type NeuronConnection } from '../../store/neuralStore.js';
import { useViewStore } from '../../store/viewStore.js';
import { useMediaQuery } from '../../hooks/useMediaQuery.js';
import NeuronMesh from './NeuronMesh.js';
import ConnectionLine from './ConnectionLine.js';

export interface RenderableConnection {
  id: string;
  sourcePos: [number, number, number];
  targetPos: [number, number, number];
  strength: number;
  relationship: string;
}

/**
 * Map connections onto the endpoints ConnectionLine needs to render.
 *
 * Pulled out as a plain, testable function (F5, "one level up" from
 * NeuronMesh): an O(1) id → neuron lookup instead of the previous
 * O(connections x neurons) `neurons.find` per line, and its result is meant
 * to be wrapped in `useMemo` by the caller so ConnectionLine's own useMemo
 * (keyed on sourcePos/targetPos) isn't defeated by fresh position arrays on
 * every NeuralCanvas render that has nothing to do with connections.
 */
export function buildRenderableConnections(
  neurons: NeuronNode[],
  connections: NeuronConnection[]
): RenderableConnection[] {
  const byId = new Map(neurons.map((n) => [n.id, n] as const));
  const result: RenderableConnection[] = [];
  for (const conn of connections) {
    const src = byId.get(conn.sourceId);
    const tgt = byId.get(conn.targetId);
    if (!src || !tgt || !conn.targetId) continue;
    result.push({
      id: conn.id,
      sourcePos: [src.tx ?? src.x, src.ty ?? src.y, src.tz ?? src.z],
      targetPos: [tgt.tx ?? tgt.x, tgt.ty ?? tgt.y, tgt.tz ?? tgt.z],
      strength: conn.strength,
      relationship: conn.relationship,
    });
  }
  return result;
}

/** Non-null Suspense fallback (W3) — a dim placeholder sphere plus a light,
 *  rendered with plain three.js primitives so it can never itself suspend.
 *  Visible for at most a frame or two in practice now that NeuronMesh's
 *  labels each carry their own boundary, but a placeholder still beats a
 *  black canvas for whatever ends up hitting this one. */
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

export default function NeuralCanvas() {
  // Narrow selectors (F5): NeuralCanvas used to pull the whole neural store,
  // so it (and every child it re-renders) re-ran on state this component
  // never uses, like selectedNeuronId or isConnected.
  const neurons = useNeuralStore((s) => s.neurons);
  const connections = useNeuralStore((s) => s.connections);
  const activeView = useViewStore((s) => s.activeView);
  const { theme } = activeView;
  // W11: no prior handling of prefers-reduced-motion, and the render loop
  // never idled — auto-rotate, per-neuron/per-line pulsing, animated Stars
  // and Bloom all ran on a continuous rAF loop regardless, burning GPU in an
  // idle background tab. `frameloop="demand"` (r3f only renders on an actual
  // state/prop change, or an explicit invalidate() — which OrbitControls'
  // damping already calls) is the load-bearing fix; autoRotate and the
  // Stars twinkle are turned off outright since a control loop can't un-spin
  // a rotation that's still being requested every frame.
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  const renderableConnections = useMemo(
    () => buildRenderableConnections(neurons, connections),
    [neurons, connections]
  );

  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0, 120], fov: 55, near: 0.1, far: 2000 }}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
      dpr={[1, 1.5]}
      frameloop={reducedMotion ? 'demand' : 'always'}
    >
      {/* W3: this boundary is defense-in-depth, not the primary fix — every
          <Text> in NeuronMesh now suspends behind its own local Suspense
          (fallback=null) so a font fetch never blanks the shared scene below
          it. This one keeps a non-null fallback (rather than the previous
          `null`) so that IF some future suspending drei/r3f addition (a
          loader, a texture) ever bubbles up here, the canvas shows a visible
          placeholder instead of going black. */}
      <Suspense fallback={<CanvasLoadingFallback background={theme.background} />}>
        <color attach="background" args={[theme.background]} />

        {/* Lighting varies by style */}
        {theme.style === 'neon' ? (
          <>
            <ambientLight intensity={0.05} />
            <pointLight position={[0, 60, 0]} intensity={1.5} color="#4ade80" />
            <pointLight position={[-60, -40, 60]} intensity={0.8} color="#22c55e" />
          </>
        ) : theme.style === 'stars' ? (
          <>
            <ambientLight intensity={0.1} />
            <pointLight position={[80, 0, 0]} intensity={2} color="#fef9c3" />
            <pointLight position={[-80, 0, 0]} intensity={1} color="#fca5a1" />
          </>
        ) : theme.style === 'ghost' ? (
          <>
            <ambientLight intensity={0.08} />
            <pointLight position={[60, 60, 40]} intensity={2} color="#c084fc" />
            <pointLight position={[-60, -40, -60]} intensity={1.2} color="#f472b6" />
          </>
        ) : (
          <>
            <ambientLight intensity={0.15} />
            <pointLight position={[100, 80, 60]} intensity={2} color="#6366f1" />
            <pointLight position={[-80, -60, -80]} intensity={1.2} color="#22d3ee" />
            <pointLight position={[0, -120, 60]} intensity={0.8} color="#fbbf24" />
          </>
        )}

        {/* Background decoration */}
        <Stars
          radius={500} depth={100}
          count={theme.style === 'stars' ? 6000 : theme.style === 'neon' ? 500 : 3500}
          factor={theme.style === 'stars' ? 4 : 2.5}
          saturation={theme.style === 'neon' ? 0 : 0.15}
          fade speed={reducedMotion ? 0 : theme.style === 'stars' ? 0.6 : 0.2}
        />

        {/* Neural Net style gets a subtle grid */}
        {theme.style === 'neon' && (
          <Grid
            position={[0, -50, 0]}
            args={[200, 200]}
            cellSize={8}
            cellThickness={0.3}
            cellColor="#1a3a1a"
            sectionSize={32}
            sectionThickness={0.6}
            sectionColor="#224422"
            fadeDistance={180}
            infiniteGrid
          />
        )}

        {/* Connections */}
        {renderableConnections.map((c) => (
          <ConnectionLine
            key={c.id}
            sourcePos={c.sourcePos}
            targetPos={c.targetPos}
            strength={c.strength}
            relationship={c.relationship}
            style={theme.style}
            reducedMotion={reducedMotion}
          />
        ))}

        {/* Neurons */}
        {neurons.map((neuron) => (
          <NeuronMesh key={neuron.id} neuron={neuron} theme={theme} reducedMotion={reducedMotion} />
        ))}

        <OrbitControls
          enableDamping
          dampingFactor={0.04}
          rotateSpeed={0.45}
          zoomSpeed={0.7}
          minDistance={10}
          maxDistance={700}
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
          <Vignette offset={0.35} darkness={0.65} blendFunction={BlendFunction.NORMAL} />
        </EffectComposer>
      </Suspense>
    </Canvas>
  );
}
