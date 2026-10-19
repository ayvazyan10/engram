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
      // Entry points are not exercised by unit tests. MapCanvas.tsx paints a
      // 2D canvas, which jsdom does not implement (getContext returns null),
      // so its drawing code cannot run here; everything it draws from (the
      // projection, terrain, hit-testing, labels, lenses) lives in plain,
      // exported, unit-tested functions under features/map/lib and lenses.ts.
      exclude: [
        'src/**/__tests__/**',
        'src/test/**',
        'src/main.tsx',
        'src/features/map/MapCanvas.tsx',
        // WebGL painting needs a real browser; sky.ts / landscape.ts maths are unit tested.
        'src/features/map/views/SkyView.tsx',
        'src/features/map/views/LandscapeView.tsx',
        'src/features/map/views/threeStage.ts',
        'src/features/map/views/shaders.ts',
      ],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
