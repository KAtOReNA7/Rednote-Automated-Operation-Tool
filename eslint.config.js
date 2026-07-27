import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/coverage/**',
      '**/dist/**',
      '**/node_modules/**',
      '**/*.tsbuildinfo',
      'codex-master-development-instruction-v1.md',
      'xiaohongshu-development-roadmap-v1.md',
      'xiaohongshu-mystery-account-prd-v1.md',
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
    files: ['**/*.ts'],
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
    },
  },
);
