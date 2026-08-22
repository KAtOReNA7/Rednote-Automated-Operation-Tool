import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    outDir: '.vite/clipper',
    rollupOptions: {
      input: {
        popup: fileURLToPath(new URL('./apps/clipper/src/web-export-popup.ts', import.meta.url)),
        'service-worker': fileURLToPath(
          new URL('./apps/clipper/src/web-export-service-worker.ts', import.meta.url),
        ),
      },
      output: {
        assetFileNames: '[name][extname]',
        chunkFileNames: 'chunks/[name]-[hash].js',
        entryFileNames: '[name].js',
      },
    },
    sourcemap: false,
    target: 'chrome120',
  },
  publicDir: false,
  resolve: {
    alias: {
      '@mystery-operations/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
    },
  },
});
