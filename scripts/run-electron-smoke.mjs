import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import electron from 'electron';

import {
  allocateLoopbackPort,
  assertCommonReport,
  assertPortReleased,
  assertProcessesExited,
  assertSocketSnapshot,
  inspectProcessTree,
  recordObservationStage,
  waitForExit,
  waitForSmokeReport,
} from './issue011-smoke-support.mjs';
import {
  assertIssue013CapabilityFixture,
  startIssue013CapabilityFixture,
} from './issue013-capability-smoke-fixture.mjs';
import { createPortableTemp } from './portable-temp.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));

const childEnvironment = { ...process.env };
delete childEnvironment.DESKTOP_DEV_SERVER_URL;
delete childEnvironment.ELECTRON_RUN_AS_NODE;
delete childEnvironment.NODE_OPTIONS;

const results = [];
for (const mode of ['disabled', 'enabled']) {
  const temporary = await createPortableTemp(projectRoot, `source-smoke-${mode}`);
  const capabilityFixture = await startIssue013CapabilityFixture();
  const port = await allocateLoopbackPort();
  const outputPath = join(temporary.root, `issue006-smoke-${randomUUID()}.json`);
  const smokeWorkspace = await mkdtemp(join(temporary.root, 'rednote-issue010-smoke-'));
  const modeEnvironment = {
    ...childEnvironment,
    ...temporary.env,
  };
  const child = spawn(
    electron,
    [
      '.',
      '--issue006-smoke',
      `--issue006-smoke-output=${outputPath}`,
      `--issue010-smoke-workspace=${smokeWorkspace}`,
      `--issue011-smoke-mode=${mode}`,
      `--issue011-smoke-port=${port}`,
      `--issue013-smoke-port=${capabilityFixture.port}`,
    ],
    {
      cwd: projectRoot,
      env: modeEnvironment,
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
    const reportStartedAt = Date.now();
    const report = await waitForSmokeReport(outputPath);
    recordObservationStage('smoke-report-ready', reportStartedAt, { mode, packaged: false });
    assertIssue013CapabilityFixture(capabilityFixture, report);
    const snapshot = await inspectProcessTree(child.pid);
    const socketStartedAt = Date.now();
    const socketEvidence = assertSocketSnapshot(snapshot, mode, port, capabilityFixture.port);
    recordObservationStage('socket-policy-check', socketStartedAt, {
      mode,
      packaged: false,
      ...socketEvidence,
    });
    const exitStartedAt = Date.now();
    const exitCode = await exitPromise;
    recordObservationStage('electron-exit-wait', exitStartedAt, {
      exitCode,
      mode,
      packaged: false,
    });
    if (exitCode !== 0) {
      throw new Error(
        `Electron source smoke exited with ${String(exitCode)} and report ${JSON.stringify(report)}: ${stderr}`,
      );
    }
    assertCommonReport(report, false, mode, port);
    await assertProcessesExited(snapshot.processIds);
    await assertPortReleased(port);
    results.push({ mode, ...socketEvidence, portReleased: true, processesExited: true });
  } finally {
    if (child.exitCode === null) {
      child.kill();
      await exitPromise.catch(() => undefined);
    }
    await capabilityFixture.close();
    await rm(outputPath, { force: true });
    await rm(smokeWorkspace, {
      force: true,
      maxRetries: 20,
      recursive: true,
      retryDelay: 100,
    });
    await temporary.cleanup();
  }
}

process.stdout.write(`${JSON.stringify({ externalConnections: 0, packaged: false, results })}\n`);
