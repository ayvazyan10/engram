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
        manualChunks: {
          'three': ['three'],
          'react-three': ['@react-three/fiber', '@react-three/drei'],
          'react': ['react', 'react-dom'],
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@xenova/transformers'],
  },
});
