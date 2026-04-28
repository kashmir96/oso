import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// oso/biz — creative-agency app. Built into ../static/biz so Hugo passes it
// through to /biz, mirroring the /ckf pattern. Independent SPA, shares the
// same Supabase + auth + lib helpers as /ckf via a vite alias (no copies).
export default defineConfig({
  plugins: [react()],
  base: '/biz/',
  resolve: {
    alias: {
      '@ckf-lib': path.resolve(__dirname, '../ckf/src/lib'),
    },
  },
  build: {
    outDir: '../static/biz',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5174,
    proxy: {
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
});
