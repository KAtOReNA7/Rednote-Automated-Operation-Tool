import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: {
        preload: fileURLToPath(new URL('./apps/desktop/src/preload.ts', import.meta.url)),
        'v2-preload': fileURLToPath(new URL('./apps/desktop/src/v2-preload.ts', import.meta.url)),
      },
      fileName: (_format, entryName) => `${entryName}.cjs`,
      formats: ['cjs'],
    },
    minify: false,
    outDir: fileURLToPath(new URL('./.vite/build', import.meta.url)),
    rollupOptions: {
      external: ['electron'],
    },
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@mystery-operations/local-api': fileURLToPath(
        new URL('./packages/local-api/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/settings': fileURLToPath(
        new URL('./packages/settings/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/v2': fileURLToPath(
        new URL('./packages/v2/src/index.ts', import.meta.url),
      ),
    },
  },
});
