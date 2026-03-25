import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars, Grid } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';
import { Suspense } from 'react';
import { useNeuralStore } from '../../store/neuralStore.js';
import { useViewStore } from '../../store/viewStore.js';
import NeuronMesh from './NeuronMesh.js';
import ConnectionLine from './ConnectionLine.js';

export default function NeuralCanvas() {
  const { neurons, connections } = useNeuralStore();
  const { activeView } = useViewStore();
  const { theme } = activeView;

  return (
    <Canvas
      style={{ width: '100%', height: '100%' }}
      camera={{ position: [0, 0, 120], fov: 55, near: 0.1, far: 2000 }}
      gl={{ antialias: true, powerPreference: 'high-performance', alpha: false }}
      dpr={[1, 1.5]}
    >
      <Suspense fallback={null}>
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
          fade speed={theme.style === 'stars' ? 0.6 : 0.2}
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
        {connections.map((conn) => {
          const src = neurons.find((n) => n.id === conn.sourceId);
          const tgt = neurons.find((n) => n.id === conn.targetId);
          if (!src || !tgt || !conn.targetId) return null;
          return (
            <ConnectionLine
              key={conn.id}
              sourcePos={[src.x, src.y, src.z]}
              targetPos={[tgt.x, tgt.y, tgt.z]}
              strength={conn.strength}
              relationship={conn.relationship}
              style={theme.style}
            />
          );
        })}

        {/* Neurons */}
        {neurons.map((neuron) => (
          <NeuronMesh key={neuron.id} neuron={neuron} theme={theme} />
        ))}

        <OrbitControls
          enableDamping
          dampingFactor={0.04}
          rotateSpeed={0.45}
          zoomSpeed={0.7}
          minDistance={10}
          maxDistance={700}
          makeDefault
          autoRotate={theme.autoRotateSpeed > 0}
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
