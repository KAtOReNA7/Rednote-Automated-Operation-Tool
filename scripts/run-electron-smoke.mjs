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
  createSmokeProcessCollector,
  inspectControlledProcesses,
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
  const processCollector = createSmokeProcessCollector(child.pid);
  const stdoutEnded = processCollector.attachStream(child.stdout);
  const exitPromise = waitForExit(child);
  try {
    const reportStartedAt = Date.now();
    const report = await waitForSmokeReport(outputPath);
    recordObservationStage('smoke-report-ready', reportStartedAt, { mode, packaged: false });
    assertIssue013CapabilityFixture(capabilityFixture, report);
    const networkProcessIds = await processCollector.waitForStages();
    const snapshot = await inspectControlledProcesses(networkProcessIds);
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
    await stdoutEnded;
    const finalProcessIds = processCollector.finish();
    assertCommonReport(report, false, mode, port);
    await assertProcessesExited(finalProcessIds);
    await assertPortReleased(port);
    results.push({
      mode,
      ...socketEvidence,
      portReleased: true,
      processCount: finalProcessIds.length,
      processesExited: true,
    });
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

{
  const temporary = await createPortableTemp(projectRoot, 'source-smoke-v2');
  const smokeWorkspace = await mkdtemp(join(temporary.root, 'rednote-issue010-smoke-'));
  try {
    for (const attempt of [1, 2]) {
      const outputPath = join(temporary.root, `issue006-smoke-${randomUUID()}.json`);
      const child = spawn(
        electron,
        [
          '.',
          '--issue006-smoke',
          '--v2-shell',
          `--issue006-smoke-output=${outputPath}`,
          `--issue010-smoke-workspace=${smokeWorkspace}`,
        ],
        {
          cwd: projectRoot,
          env: { ...childEnvironment, ...temporary.env },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      );
      const processCollector = createSmokeProcessCollector(child.pid);
      const stdoutEnded = processCollector.attachStream(child.stdout);
      const exitPromise = waitForExit(child);
      try {
        const report = await waitForSmokeReport(outputPath);
        const processIds = await processCollector.waitForStages();
        const socketEvidence = assertSocketSnapshot(
          await inspectControlledProcesses(processIds),
          'disabled',
          43_119,
          43_120,
        );
        const exitCode = await exitPromise;
        await stdoutEnded;
        const finalProcessIds = processCollector.finish();
        if (
          exitCode !== 0 ||
          report.ok !== true ||
          report.packaged !== false ||
          report.mode !== 'v2' ||
          report.renderer?.navigationCount !== 7 ||
          report.renderer?.mockMode !== false ||
          report.security?.preload !== true ||
          report.runtime?.ipcRegistered !== true ||
          report.runtime?.projectDataRootInitialized !== true ||
          report.runtime?.sqliteInitialized !== true ||
          report.runtime?.v2TableCount !== 8 ||
          report.runtime?.personaRevision !== 0 ||
          report.runtime?.planRevision !== 1 ||
          report.security?.externalRequestAttempts !== 0
        )
          throw new Error(`V2 source smoke failed: ${JSON.stringify(report)}`);
        await assertProcessesExited(finalProcessIds);
        results.push({
          attempt,
          mode: 'v2',
          ...socketEvidence,
          processCount: finalProcessIds.length,
          processesExited: true,
        });
      } finally {
        if (child.exitCode === null) {
          child.kill();
          await exitPromise.catch(() => undefined);
        }
        await rm(outputPath, { force: true });
      }
    }
  } finally {
    await rm(smokeWorkspace, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 });
    await temporary.cleanup();
  }
}

process.stdout.write(`${JSON.stringify({ externalConnections: 0, packaged: false, results })}\n`);
