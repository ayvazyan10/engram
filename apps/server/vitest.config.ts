import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60000,
    // Route tests share one module-level brain singleton, so they must not run
    // in parallel against the same database.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/routes/**/*.ts'],
      thresholds: { lines: 80, functions: 65, statements: 80, branches: 60 },
    },
  },
});
