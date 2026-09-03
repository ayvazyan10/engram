import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      // cli.ts is the commander entrypoint (side effects on import); the
      // logic extracted out of it — server control, global install, the
      // install-failure hints — is what carries the testable behaviour.
      include: ['src/serverControl.ts', 'src/globalInstall.ts', 'src/installFailure.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
