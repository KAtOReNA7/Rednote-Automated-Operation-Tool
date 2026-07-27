import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import electron from 'electron';

import {
  allocateLoopbackPort,
  assertCommonReport,
  assertPortReleased,
  assertProcessesExited,
  assertSocketSnapshot,
  inspectProcessTree,
  waitForExit,
  waitForSmokeReport,
} from './issue011-smoke-support.mjs';

const childEnvironment = { ...process.env };
delete childEnvironment.DESKTOP_DEV_SERVER_URL;
delete childEnvironment.ELECTRON_RUN_AS_NODE;
delete childEnvironment.NODE_OPTIONS;

const results = [];
for (const mode of ['disabled', 'enabled']) {
  const port = await allocateLoopbackPort();
  const outputPath = join(tmpdir(), `issue006-smoke-${randomUUID()}.json`);
  const smokeWorkspace = await mkdtemp(join(tmpdir(), 'rednote-issue010-smoke-'));
  const child = spawn(
    electron,
    [
      '.',
      '--issue006-smoke',
      `--issue006-smoke-output=${outputPath}`,
      `--issue010-smoke-workspace=${smokeWorkspace}`,
      `--issue011-smoke-mode=${mode}`,
      `--issue011-smoke-port=${port}`,
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
  const exitPromise = waitForExit(child);
  try {
    const report = await waitForSmokeReport(outputPath);
    const snapshot = await inspectProcessTree(child.pid);
    const socketEvidence = assertSocketSnapshot(snapshot, mode, port);
    const exitCode = await exitPromise;
    if (exitCode !== 0) {
      throw new Error(
        `Electron source smoke exited with ${String(exitCode)} and report ${JSON.stringify(report)}: ${stderr}`,
      );
    }
    assertCommonReport(report, false, mode, port);
    await assertProcessesExited(snapshot.processIds);
    await assertPortReleased(port);
    results.push({ mode, ...socketEvidence, portReleased: true });
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exitPromise.catch(() => undefined);
    }
    await rm(outputPath, { force: true });
    await rm(smokeWorkspace, { force: true, recursive: true });
  }
}

process.stdout.write(`${JSON.stringify({ externalConnections: 0, packaged: false, results })}\n`);
