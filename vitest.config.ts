import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@mystery-operations/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/db': fileURLToPath(
        new URL('./packages/db/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/local-api': fileURLToPath(
        new URL('./packages/local-api/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/providers': fileURLToPath(
        new URL('./packages/providers/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/shared/storage': fileURLToPath(
        new URL('./packages/shared/src/storage-contracts.ts', import.meta.url),
      ),
      '@mystery-operations/shared': fileURLToPath(
        new URL('./packages/shared/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/settings': fileURLToPath(
        new URL('./packages/settings/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/storage': fileURLToPath(
        new URL('./packages/storage/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/workflows': fileURLToPath(
        new URL('./packages/workflows/src/index.ts', import.meta.url),
      ),
    },
  },
  test: {
    clearMocks: true,
    environment: 'node',
    exclude: ['**/coverage/**', '**/dist/**', '**/node_modules/**'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    maxWorkers: 1,
    passWithNoTests: false,
    sequence: {
      shuffle: false,
    },
  },
});
