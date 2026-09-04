import { defineConfig, coverageConfigDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60000,
    // One brain singleton per process — tool tests must not race each other.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      // Every shipped module, not just server.ts. The old single-file include
      // left store-session.ts — the `engram-store-session` bin, and the only
      // writer the session-end hook uses — out of the numbers entirely, so a
      // module with no tests at all read as 100% covered by omission.
      include: ['src/**/*.ts'],
      exclude: [...coverageConfigDefaults.exclude, 'src/test-helpers/**'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 60 },
    },
  },
});
