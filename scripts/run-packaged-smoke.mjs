import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';

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

const projectRoot = resolve(import.meta.dirname, '..');
const outputDirectory = join(projectRoot, 'out');
const packageNames = (await readdir(outputDirectory)).filter((name) => name.endsWith('-win32-x64'));
if (packageNames.length !== 1) {
  throw new Error('Expected exactly one packaged Windows x64 application directory.');
}

const packageDirectory = join(outputDirectory, packageNames[0]);
const executablePath = join(packageDirectory, 'RednoteMysteryOperations.exe');
const resourcesPath = join(packageDirectory, 'resources');
const appAsar = join(resourcesPath, 'app.asar');
const unpackedApp = join(resourcesPath, 'app');

await stat(executablePath);
await stat(appAsar);
try {
  await stat(unpackedApp);
  throw new Error('Packaged application contains an unpacked resources/app directory.');
} catch (error) {
  if (error instanceof Error && !('code' in error && error.code === 'ENOENT')) {
    throw error;
  }
}

const fuses = await getCurrentFuseWire(executablePath);
if (
  fuses.version !== FuseVersion.V1 ||
  fuses[FuseV1Options.RunAsNode] !== FuseState.DISABLE ||
  fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable] !== FuseState.DISABLE ||
  fuses[FuseV1Options.EnableNodeCliInspectArguments] !== FuseState.DISABLE ||
  fuses[FuseV1Options.EnableEmbeddedAsarIntegrityValidation] !== FuseState.ENABLE ||
  fuses[FuseV1Options.OnlyLoadAppFromAsar] !== FuseState.ENABLE
) {
  throw new Error('Packaged executable does not carry the required Electron fuse policy.');
}

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
    executablePath,
    [
      '--issue006-smoke',
      `--issue006-smoke-output=${outputPath}`,
      `--issue010-smoke-workspace=${smokeWorkspace}`,
      `--issue011-smoke-mode=${mode}`,
      `--issue011-smoke-port=${port}`,
    ],
    {
      cwd: packageDirectory,
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
        `Packaged executable smoke exited with ${String(exitCode)} and report ${JSON.stringify(report)}: ${stderr}`,
      );
    }
    assertCommonReport(report, true, mode, port);
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

process.stdout.write(
  `${JSON.stringify({ externalConnections: 0, fuses: true, packaged: true, results })}\n`,
);
