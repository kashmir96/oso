import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// oso/agent — minimal ad-script agent. Built into ../static/agent so Hugo
// passes it through to /agent. Shares /ckf's auth + api helpers via a vite
// alias, same pattern as /biz.
export default defineConfig({
  plugins: [react()],
  base: '/agent/',
  resolve: {
    alias: {
      '@ckf-lib': path.resolve(__dirname, '../ckf/src/lib'),
    },
  },
  build: {
    outDir: '../static/agent',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5175,
    proxy: {
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
});
