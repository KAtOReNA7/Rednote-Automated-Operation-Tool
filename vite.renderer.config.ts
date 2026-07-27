import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL('./.vite/renderer', import.meta.url)),
    sourcemap: false,
  },
  plugins: [react()],
  resolve: {
    alias: {
      '@mystery-operations/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/settings': fileURLToPath(
        new URL('./packages/settings/src/index.ts', import.meta.url),
      ),
    },
  },
  root: fileURLToPath(new URL('./apps/web-ui', import.meta.url)),
});
