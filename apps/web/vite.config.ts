import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 4902,
    proxy: {
      '/api': {
        target: 'http://localhost:4901',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:4901',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // W16: the object form matches module ids by substring against
        // every group in listed order, and React's own modules are pulled
        // in (as a dependency) while Rollup is resolving whichever
        // three/@react-three group it visits first — the result was a
        // ~500 KB 'react-three' chunk that silently contained React itself,
        // and a "react" chunk() that came out at 1 byte. A function gives
        // deterministic, ordered control instead: react/react-dom/scheduler
        // are matched FIRST and unconditionally, before three or
        // @react-three ever get a chance to claim them.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          if (id.includes('node_modules/three/')) return 'three';
          if (id.includes('node_modules/@react-three/')) return 'react-three';
          if (id.includes('node_modules/recharts/') || id.includes('node_modules/d3-')) return 'charts';
          return undefined;
        },
      },
    },
  },
});
