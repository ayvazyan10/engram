import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * The comparison harness runs as its OWN Vite server, on its own port, with
 * this directory as the Vite root.
 *
 * It lives inside apps/web for exactly one reason: pnpm keeps each package's
 * dependencies in that package's own node_modules, so a file here resolves
 * react / three / @react-three/* without installing anything. Nothing else is
 * shared — `apps/web/tsconfig.json` includes only `src`, `vitest.config.ts`
 * matches only `src/**`, and `pnpm lint` runs `eslint src`. This directory is
 * therefore invisible to the app's typecheck, tests and lint, and deleting it
 * removes the harness completely.
 *
 * Ports: 4912 only. 4911 (the app's dev server) and 4901 (the API) are already
 * running and are not touched — `/api` is proxied to 4901 the same way
 * apps/web/vite.config.ts does it.
 */
export default defineConfig({
  root: __dirname,
  // Its OWN dependency-optimizer cache. Vite's default is
  // `<package>/node_modules/.vite`, which apps/web's dev server on 4911 is
  // already using — pointing a second server at it makes the two of them
  // invalidate each other's pre-bundles. Keeping it in this directory means
  // 4911 is untouched and `rm -rf apps/web/observatory` takes the cache too.
  cacheDir: path.resolve(__dirname, '.vite'),
  plugins: [react()],
  resolve: {
    alias: { '@obs': path.resolve(__dirname) },
  },
  server: {
    host: '127.0.0.1',
    port: 4912,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:4901', changeOrigin: true },
    },
  },
});
