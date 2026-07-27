import { execFile, spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { FuseState, FuseV1Options, FuseVersion, getCurrentFuseWire } from '@electron/fuses';

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

const outputPath = join(tmpdir(), `issue006-smoke-${randomUUID()}.json`);
const smokeWorkspace = await mkdtemp(join(tmpdir(), 'rednote-issue010-smoke-'));
const childEnvironment = { ...process.env };
delete childEnvironment.DESKTOP_DEV_SERVER_URL;
delete childEnvironment.ELECTRON_RUN_AS_NODE;
delete childEnvironment.NODE_OPTIONS;

const child = spawn(
  executablePath,
  [
    '--issue006-smoke',
    `--issue006-smoke-output=${outputPath}`,
    `--issue010-smoke-workspace=${smokeWorkspace}`,
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

const exitPromise = new Promise((resolveExit, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error('Packaged executable smoke timed out.'));
  }, 30_000);
  child.once('error', reject);
  child.once('exit', (code) => {
    clearTimeout(timeout);
    resolveExit(code);
  });
});

const tcpConnectionCount = await new Promise((resolveCount, reject) => {
  setTimeout(() => {
    const command = `
      $processIds = [System.Collections.Generic.HashSet[int]]::new()
      [void]$processIds.Add(${child.pid})
      do {
        $before = $processIds.Count
        Get-CimInstance Win32_Process | Where-Object {
          $processIds.Contains([int]$_.ParentProcessId)
        } | ForEach-Object {
          [void]$processIds.Add([int]$_.ProcessId)
        }
      } while ($processIds.Count -gt $before)
      $connections = @(Get-NetTCPConnection -ErrorAction SilentlyContinue | Where-Object {
        $processIds.Contains([int]$_.OwningProcess) -and
        $_.State -in @('Listen', 'Established', 'SynSent', 'SynReceived')
      })
      [Console]::Out.Write($connections.Count)
    `;
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 10_000, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          reject(error);
          return;
        }
        resolveCount(Number.parseInt(stdout.trim(), 10));
      },
    );
  }, 300);
});

const exitCode = await exitPromise;

try {
  const report = JSON.parse(await readFile(outputPath, 'utf8'));
  if (
    exitCode !== 0 ||
    report.ok !== true ||
    report.packaged !== true ||
    report.runtimeVersion !== '43.2.0' ||
    report.storage !== true ||
    report.settings?.credentialCleared !== true ||
    report.settings?.credentialRoundtrip !== true ||
    report.settings?.locator !== true ||
    report.settings?.safeStorage !== true ||
    report.settings?.secretEgressSafeCount !== 30 ||
    report.settings?.settings !== true ||
    report.security?.externalRequestAttempts !== 0 ||
    tcpConnectionCount !== 0
  ) {
    throw new Error(
      `Packaged executable smoke failed with code ${String(exitCode)} and report ${JSON.stringify(report)}: ${stderr}`,
    );
  }
  process.stdout.write(
    `${JSON.stringify({ ...report, fuses: true, tcpConnections: tcpConnectionCount })}\n`,
  );
} finally {
  await rm(outputPath, { force: true });
  await rm(smokeWorkspace, { force: true, recursive: true });
}
