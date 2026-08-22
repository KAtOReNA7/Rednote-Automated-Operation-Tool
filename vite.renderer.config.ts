import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

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
  builtAt: new Date(Number(sourceDateEpoch) * 1000).toISOString(),
  commit,
  sourceDateEpoch,
  v2DataVersion: 1,
});
if (!/^[a-f0-9]{40}$/u.test(buildInfo.commit)) throw new Error('Invalid build commit identity.');
mkdirSync(fileURLToPath(new URL('./.vite', import.meta.url)), { recursive: true });
writeFileSync(
  fileURLToPath(new URL('./.vite/build-info.json', import.meta.url)),
  `${JSON.stringify(buildInfo, null, 2)}\n`,
  'utf8',
);

export default defineConfig({
  base: './',
  build: {
    emptyOutDir: true,
    outDir: fileURLToPath(new URL('./.vite/renderer', import.meta.url)),
    rollupOptions: {
      input: {
        legacy: fileURLToPath(new URL('./apps/web-ui/index.html', import.meta.url)),
        v2: fileURLToPath(new URL('./apps/web-ui/v2.html', import.meta.url)),
      },
    },
    sourcemap: false,
  },
  plugins: [react()],
  define: {
    __REDNOTE_BUILD_INFO__: JSON.stringify(buildInfo),
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
  root: fileURLToPath(new URL('./apps/web-ui', import.meta.url)),
});
