import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Barrel files are pure re-exports; migrations and scripts are not library code.
      exclude: ['src/**/__tests__/**', 'src/test-helpers/**', 'src/**/index.ts', 'src/db/migrations/**'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
