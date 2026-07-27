import { builtinModules } from 'node:module';
import { fileURLToPath, URL } from 'node:url';

import { defineConfig } from 'vite';

const nodeExternals = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

export default defineConfig({
  build: {
    emptyOutDir: false,
    lib: {
      entry: fileURLToPath(new URL('./apps/desktop/src/main.ts', import.meta.url)),
      fileName: () => 'main.cjs',
      formats: ['cjs'],
    },
    minify: false,
    outDir: fileURLToPath(new URL('./.vite/build', import.meta.url)),
    rollupOptions: {
      external: ['electron', ...nodeExternals],
    },
    sourcemap: false,
  },
  resolve: {
    alias: {
      '@mystery-operations/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/db': fileURLToPath(
        new URL('./packages/db/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/workflows': fileURLToPath(
        new URL('./packages/workflows/src/index.ts', import.meta.url),
      ),
    },
  },
});
