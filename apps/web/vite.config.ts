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
        // React in its own long-cached chunk. The map's d3 modules get one of
        // their own: Rollup moves a manual chunk's dependencies into it, so
        // without this the d3 modules recharts shares with the map would land
        // in 'charts' and drag recharts into the first load. recharts and the
        // d3 modules only it uses stay lazy, with Insights.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          if (/node_modules\/(d3-(array|color|contour|delaunay|dispatch|drag|ease|interpolate|selection|timer|transition|zoom)|delaunator|robust-predicates|internmap)\//.test(id)) return 'd3';
          if (id.includes('node_modules/recharts/')) return 'charts';
          return undefined;
        },
      },
    },
  },
});
