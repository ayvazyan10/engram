import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // Barrel files, entry points, and the WebGL scene are not exercised by
      // unit tests here — see the F4/W1-W16 report for why. NeuronMesh.tsx
      // and ConnectionLine.tsx join NeuralCanvas.tsx for the same reason:
      // both had their actual logic (useNeuronDerivedState,
      // handleNeuronClick, buildRenderableConnections) already pulled out
      // into plain, exported, unit-tested functions — what's left in these
      // three files is Canvas wiring (useFrame callbacks mutating THREE refs
      // every frame, JSX trees of <mesh>/<Sphere>/<Text>) that only means
      // anything inside a real WebGL context, which jsdom doesn't provide
      // and @react-three/test-renderer isn't a dependency here.
      exclude: [
        'src/**/__tests__/**',
        'src/test/**',
        'src/main.tsx',
        'src/components/canvas/NeuralCanvas.tsx',
        'src/components/canvas/NeuronMesh.tsx',
        'src/components/canvas/ConnectionLine.tsx',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
