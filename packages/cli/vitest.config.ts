import { defineConfig, coverageConfigDefaults } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      // Every module in src, so the numbers describe the package rather than
      // the three files someone remembered to list. The old include named
      // serverControl/globalInstall/installFailure only, which left
      // claudeSetup.ts, gitUpdate.ts and syncOptions.ts — all of them tested —
      // out of the report entirely, and would have hidden any new module too.
      include: ['src/**/*.ts'],
      // cli.ts is the commander entrypoint: it parses argv and runs a command
      // as a side effect of being imported, so no test can load it. The logic
      // it used to hold has been extracted into the modules above, which are
      // what these thresholds measure.
      exclude: [...coverageConfigDefaults.exclude, 'src/cli.ts'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 70 },
    },
  },
});
