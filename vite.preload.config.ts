import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: fileURLToPath(new URL('./apps/desktop/src/preload.ts', import.meta.url)),
      fileName: () => 'preload.cjs',
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
    },
  },
});
