import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 20000,
    coverage: {
      provider: 'v8',
      // proxy.ts is the server entrypoint (listens on import); the logic it
      // wires together lives in the sibling modules covered below.
      include: ['src/messages.ts', 'src/parse.ts', 'src/headers.ts', 'src/upstream.ts'],
      thresholds: { lines: 80, functions: 80, branches: 70, statements: 80 },
    },
  },
});
