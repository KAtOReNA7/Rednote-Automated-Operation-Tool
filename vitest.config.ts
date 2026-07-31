import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@mystery-operations/authenticity': fileURLToPath(
        new URL('./packages/authenticity/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/briefs': fileURLToPath(
        new URL('./packages/briefs/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/catalog': fileURLToPath(
        new URL('./packages/catalog/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/clipper': fileURLToPath(
        new URL('./apps/clipper/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/core': fileURLToPath(
        new URL('./packages/core/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/copy': fileURLToPath(
        new URL('./packages/copy/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/db': fileURLToPath(
        new URL('./packages/db/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/dossier': fileURLToPath(
        new URL('./packages/dossier/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/evidence': fileURLToPath(
        new URL('./packages/evidence/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/experiments': fileURLToPath(
        new URL('./packages/experiments/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/fetch': fileURLToPath(
        new URL('./packages/fetch/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/local-api': fileURLToPath(
        new URL('./packages/local-api/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/providers': fileURLToPath(
        new URL('./packages/providers/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/quality': fileURLToPath(
        new URL('./packages/quality/src/index.ts', import.meta.url),
      ),
      '@mystery-operations/search': fileURLToPath(
        new URL('./packages/search/src/index.ts', import.meta.url),
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
      '@mystery-operations/topics': fileURLToPath(
        new URL('./packages/topics/src/index.ts', import.meta.url),
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
