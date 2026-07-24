import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60000,
    // One brain singleton per process — tool tests must not race each other.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      include: ['src/server.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 60 },
    },
  },
});
