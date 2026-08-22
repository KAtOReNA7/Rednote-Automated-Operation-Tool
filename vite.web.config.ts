import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const projectRoot = fileURLToPath(new URL('.', import.meta.url));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: projectRoot,
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const sourceDateEpoch = execFileSync('git', ['show', '-s', '--format=%ct', 'HEAD'], {
  cwd: projectRoot,
  encoding: 'utf8',
  windowsHide: true,
}).trim();
const buildInfo = Object.freeze({
  builtAt: new Date(Number(sourceDateEpoch) * 1_000).toISOString(),
  commit,
  v2DataVersion: 2,
});

if (!/^[a-f0-9]{40}$/u.test(commit)) throw new Error('Invalid build commit identity.');

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL('./.vite/web', import.meta.url)),
    rollupOptions: { input: fileURLToPath(new URL('./apps/web-ui/web.html', import.meta.url)) },
    sourcemap: false,
  },
  define: { __REDNOTE_BUILD_INFO__: JSON.stringify(buildInfo) },
  plugins: [react()],
  resolve: {
    alias: {
      '@mystery-operations/v2': fileURLToPath(
        new URL('./packages/v2/src/index.ts', import.meta.url),
      ),
    },
  },
  root: fileURLToPath(new URL('./apps/web-ui', import.meta.url)),
});
