import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { createPortableTemp } from './portable-temp.mjs';

const projectRoot = resolve(import.meta.dirname, '..');
const temporary = await createPortableTemp(projectRoot, 'vitest');
const vitestEntry = resolve(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');

try {
  const child = spawn(process.execPath, [vitestEntry, ...process.argv.slice(2)], {
    cwd: projectRoot,
    env: { ...process.env, ...temporary.env },
    stdio: 'inherit',
    windowsHide: true,
  });
  const exitCode = await new Promise((resolveExit, rejectExit) => {
    child.once('error', rejectExit);
    child.once('exit', (code, signal) => {
      if (signal !== null) {
        rejectExit(new Error(`Vitest terminated by ${signal}.`));
        return;
      }
      resolveExit(code ?? 1);
    });
  });
  process.exitCode = exitCode;
} finally {
  await temporary.cleanup();
}
