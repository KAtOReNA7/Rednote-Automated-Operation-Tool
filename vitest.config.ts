import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    clearMocks: true,
    environment: 'node',
    exclude: ['**/coverage/**', '**/dist/**', '**/node_modules/**'],
    include: ['tests/**/*.test.ts'],
    passWithNoTests: false,
    sequence: {
      shuffle: false,
    },
  },
});
