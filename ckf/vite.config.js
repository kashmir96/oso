import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// CKF Second Brain — built into oso/static/ckf so Hugo passes it through to /ckf.
export default defineConfig({
  plugins: [react()],
  base: '/ckf/',
  build: {
    outDir: '../static/ckf',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      // For `npm run dev`: forward function calls to a separately-running `netlify dev`
      '/.netlify/functions': {
        target: 'http://localhost:8888',
        changeOrigin: true,
      },
    },
  },
});
