import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      // cli.ts is the commander entrypoint (side effects on import); the
      // extracted server-control and global-install logic is what carries the
      // testable behaviour.
      include: ['src/serverControl.ts', 'src/globalInstall.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
