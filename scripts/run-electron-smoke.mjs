import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import electron from 'electron';

const outputPath = join(tmpdir(), `issue006-smoke-${randomUUID()}.json`);
const smokeWorkspace = await mkdtemp(join(tmpdir(), 'rednote-issue010-smoke-'));
const childEnvironment = { ...process.env };
delete childEnvironment.DESKTOP_DEV_SERVER_URL;
delete childEnvironment.ELECTRON_RUN_AS_NODE;
delete childEnvironment.NODE_OPTIONS;

const child = spawn(
  electron,
  [
    '.',
    '--issue006-smoke',
    `--issue006-smoke-output=${outputPath}`,
    `--issue010-smoke-workspace=${smokeWorkspace}`,
  ],
  {
    cwd: new URL('..', import.meta.url),
    env: childEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  },
);

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
    report.settings?.credentialCleared !== true ||
    report.settings?.credentialRoundtrip !== true ||
    report.settings?.locator !== true ||
    report.settings?.safeStorage !== true ||
    report.settings?.secretEgressSafeCount !== 30 ||
    report.settings?.settings !== true ||
    report.security?.externalRequestAttempts !== 0
  ) {
    throw new Error(
      `Electron source smoke failed with code ${String(exitCode)} and report ${JSON.stringify(report)}: ${stderr}`,
    );
  }
  process.stdout.write(`${JSON.stringify(report)}\n`);
} finally {
  await rm(outputPath, { force: true });
  await rm(smokeWorkspace, { force: true, recursive: true });
}
