import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/.vite/**',
      '**/node_modules/**',
      '**/out/**',
      '.rednote-temp/**',
      '**/*.tsbuildinfo',
      'docs/governance/codex-master-development-instruction-v1.md',
      'docs/product/xiaohongshu-development-roadmap-v1.md',
      'docs/product/xiaohongshu-mystery-account-prd-v1.md',
    ],
  },
  eslint.configs.recommended,
  tseslint.configs.strict,
  {
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
  {
    files: [
      'apps/web-ui/**/*.{ts,tsx}',
      'tests/desktop-renderer.test.tsx',
      'tests/local-api-renderer.test.tsx',
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
);
