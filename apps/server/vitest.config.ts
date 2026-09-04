import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 60000,
    // Route tests share one module-level brain singleton, so they must not run
    // in parallel against the same database.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      // The security and helper modules are measured alongside the routes:
      // the host allowlist, the limiter and the error handler are exactly the
      // code whose untested branches would be invisible in production.
      // src/index.ts stays out — it is process bootstrap that inject() never
      // executes, and including it would measure the harness, not the code.
      include: ['src/routes/**/*.ts', 'src/lib/**/*.ts', 'src/security/**/*.ts'],
      thresholds: { lines: 80, functions: 65, statements: 80, branches: 60 },
    },
  },
});
