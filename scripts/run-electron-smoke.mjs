import { spawn } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import electron from 'electron';

const outputPath = join(tmpdir(), `issue006-smoke-${randomUUID()}.json`);
const childEnvironment = { ...process.env };
delete childEnvironment.DESKTOP_DEV_SERVER_URL;
delete childEnvironment.ELECTRON_RUN_AS_NODE;
delete childEnvironment.NODE_OPTIONS;

const child = spawn(electron, ['.', '--issue006-smoke', `--issue006-smoke-output=${outputPath}`], {
  cwd: new URL('..', import.meta.url),
  env: childEnvironment,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderr += chunk;
});

const exitCode = await new Promise((resolveExit, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error('Electron source smoke timed out.'));
  }, 30_000);
  child.once('error', reject);
  child.once('exit', (code) => {
    clearTimeout(timeout);
    resolveExit(code);
  });
});

try {
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  if (
    exitCode !== 0 ||
    report.ok !== true ||
    report.packaged !== false ||
    report.runtimeVersion !== '43.2.0' ||
    report.storage !== true ||
    report.security?.externalRequestAttempts !== 0
  ) {
    throw new Error(`Electron source smoke failed with code ${String(exitCode)}: ${stderr}`);
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await rm(outputPath, { force: true });
}
