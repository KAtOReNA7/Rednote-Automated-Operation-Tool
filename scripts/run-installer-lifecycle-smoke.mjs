import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

import {
  readReleaseManifest,
  WINDOWS_APPLICATION_ID,
  WINDOWS_CANONICAL_VERSION,
  WINDOWS_CI_FIXTURE_VERSION,
  WINDOWS_PRODUCT_NAME,
} from './windows-distribution-contract.mjs';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const POLL_MILLISECONDS = 250;
const CONVERGENCE_TIMEOUT_MILLISECONDS = 90_000;
const CLEANUP_TIMEOUT_MILLISECONDS = 30_000;

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function within(parent, candidate) {
  const value = relative(resolve(parent), resolve(candidate));
  return value !== '' && !value.startsWith('..') && !value.includes(':');
}

function log(stage, startedAt, evidence, status = 'ok') {
  process[status === 'ok' ? 'stdout' : 'stderr'].write(
    `${JSON.stringify({
      durationMilliseconds: Math.round(performance.now() - startedAt),
      evidence,
      kind: 'r10d-installer-lifecycle',
      stage,
      status,
    })}\n`,
  );
}

function ciTemp() {
  const {
    GITHUB_RUN_ATTEMPT: attempt,
    GITHUB_RUN_ID: runId,
    GITHUB_WORKSPACE: workspace,
  } = process.env;
  if (
    process.platform !== 'win32' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    workspace === undefined ||
    runId === undefined ||
    attempt === undefined
  )
    throw new Error('INSTALLER_LIFECYCLE_CI_ONLY');
  const expected = join(dirname(resolve(workspace)), '.rednote-temp', `ci-${runId}-${attempt}`);
  if (resolve(tmpdir()) !== resolve(expected))
    throw new Error('INSTALLER_LIFECYCLE_TEMP_SCOPE_INVALID');
  return expected;
}

function targetPath() {
  if (process.env.LOCALAPPDATA === undefined)
    throw new Error('INSTALLER_LIFECYCLE_LOCALAPPDATA_REQUIRED');
  return join(process.env.LOCALAPPDATA, 'Programs', 'xiaohongshu-mystery-operations');
}

function startMenuPath() {
  if (process.env.APPDATA === undefined) throw new Error('INSTALLER_LIFECYCLE_APPDATA_REQUIRED');
  return join(
    process.env.APPDATA,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    `${WINDOWS_PRODUCT_NAME}.lnk`,
  );
}

async function observe(target, temporaryDirectory) {
  const { stdout } = await run(
    'powershell.exe',
    [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      [
        '$target=$env:REDNOTE_R10D_INSTALL_PATH',
        '$temp=$env:REDNOTE_R10D_TEMP_PATH',
        '$product=$env:REDNOTE_R10D_PRODUCT_NAME',
        '$entry=@(Get-ItemProperty -Path \'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*\' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "$product*" -and $_.DisplayIcon -and $_.DisplayIcon.StartsWith($target,[System.StringComparison]::OrdinalIgnoreCase) })',
        '$processes=@(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -and ($_.Path.StartsWith($target,[System.StringComparison]::OrdinalIgnoreCase) -or $_.Path.StartsWith($temp,[System.StringComparison]::OrdinalIgnoreCase)) } | ForEach-Object { $parent=Split-Path -Parent $_.Path; [PSCustomObject]@{ image=[System.IO.Path]::GetFileName($_.Path); inInstall=$_.Path.StartsWith($target,[System.StringComparison]::OrdinalIgnoreCase); nsisHelper=$_.Path.StartsWith($temp,[System.StringComparison]::OrdinalIgnoreCase) -and (Split-Path -Leaf $parent) -match "^ns.*\\.tmp$"; pid=[int]$_.Id } })',
        '$nsis=@(Get-ChildItem -LiteralPath $temp -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "^ns.*\\.tmp$" } | Select-Object -ExpandProperty Name)',
        '[PSCustomObject]@{ displayVersion=if($entry.Count -eq 1){[string]$entry[0].DisplayVersion}else{$null}; installDirectory=Test-Path -LiteralPath $target; nsisHelperDirectories=@($nsis).Count; processes=@($processes); registryEntries=@($entry).Count; startMenu=Test-Path -LiteralPath $env:REDNOTE_R10D_START_MENU_PATH } | ConvertTo-Json -Compress -Depth 4',
      ].join('; '),
    ],
    {
      env: {
        ...process.env,
        REDNOTE_R10D_INSTALL_PATH: target,
        REDNOTE_R10D_PRODUCT_NAME: WINDOWS_PRODUCT_NAME,
        REDNOTE_R10D_START_MENU_PATH: startMenuPath(),
        REDNOTE_R10D_TEMP_PATH: temporaryDirectory,
      },
      maxBuffer: 16_384,
      timeout: 10_000,
      windowsHide: true,
    },
  );
  const state = JSON.parse(stdout);
  if (
    typeof state.installDirectory !== 'boolean' ||
    typeof state.startMenu !== 'boolean' ||
    !Number.isSafeInteger(state.registryEntries) ||
    !Number.isSafeInteger(state.nsisHelperDirectories) ||
    !Array.isArray(state.processes) ||
    state.processes.length > 16
  )
    throw new Error('INSTALLER_LIFECYCLE_STATE_INVALID');
  return state;
}

function safeState(state) {
  return {
    displayVersion: state.displayVersion,
    installDirectory: state.installDirectory,
    nsisHelperDirectories: state.nsisHelperDirectories,
    processes: state.processes.map(({ image, inInstall, nsisHelper, pid }) => ({
      image: basename(image),
      inInstall,
      nsisHelper,
      pid,
    })),
    registryEntries: state.registryEntries,
    startMenu: state.startMenu,
  };
}

function installed(state, version, allowRunning = false) {
  return (
    state.installDirectory &&
    state.registryEntries === 1 &&
    state.displayVersion === version &&
    state.startMenu &&
    state.nsisHelperDirectories === 0 &&
    state.processes.every((process) => !process.nsisHelper && (allowRunning || !process.inInstall))
  );
}

function runningInstalled(state, version) {
  return installed(state, version, true) && state.processes.some((process) => process.inInstall);
}

function uninstalled(state) {
  return (
    !state.installDirectory &&
    state.registryEntries === 0 &&
    !state.startMenu &&
    state.nsisHelperDirectories === 0 &&
    state.processes.every((process) => !process.inInstall && !process.nsisHelper)
  );
}

async function converge(stage, readState, predicate, timeout = CONVERGENCE_TIMEOUT_MILLISECONDS) {
  const startedAt = performance.now();
  let attempts = 0;
  let state = await readState();
  while (!predicate(state)) {
    if (performance.now() - startedAt >= timeout) {
      log(stage, startedAt, { attempts, state: safeState(state) }, 'failed');
      throw new Error(
        `R10D_LIFECYCLE_CONVERGENCE_TIMEOUT:${stage}:${JSON.stringify(safeState(state))}`,
      );
    }
    attempts += 1;
    await delay(POLL_MILLISECONDS);
    state = await readState();
  }
  log(stage, startedAt, { attempts, state: safeState(state) });
  return state;
}

async function invoke(executable, arguments_, cwd) {
  try {
    await run(executable, arguments_, { cwd, timeout: 180_000, windowsHide: true });
    return 0;
  } catch (error) {
    return typeof error === 'object' && error !== null && typeof error.code === 'number'
      ? error.code
      : -1;
  }
}

async function assertPayload(directory, expected, version) {
  const manifest = await readReleaseManifest(directory, [version]);
  if (
    !(await stat(join(directory, 'RednoteMysteryOperations.exe'))).isFile() ||
    manifest.appId !== WINDOWS_APPLICATION_ID ||
    manifest.applicationVersion !== version ||
    JSON.stringify(manifest.files) !== JSON.stringify(expected.files)
  )
    throw new Error('INSTALLER_LIFECYCLE_INSTALLED_PAYLOAD_INVALID');
}

async function waitForReport(outputPath) {
  const deadline = performance.now() + 25_000;
  while (performance.now() < deadline) {
    try {
      return JSON.parse(await readFile(outputPath, 'utf8'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    await delay(50);
  }
  throw new Error('INSTALLER_LIFECYCLE_SMOKE_REPORT_TIMEOUT');
}

function waitForExit(child) {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(
      () => rejectExit(new Error('INSTALLER_LIFECYCLE_SMOKE_EXIT_TIMEOUT')),
      35_000,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      resolveExit(code);
    });
  });
}

async function launchSmoke(executable, workspace, reportRoot, version) {
  const outputPath = join(reportRoot, `issue006-smoke-${randomUUID()}.json`);
  const child = spawn(
    executable,
    [
      '--issue006-smoke',
      `--issue006-smoke-output=${outputPath}`,
      `--issue010-smoke-workspace=${workspace}`,
    ],
    {
      cwd: dirname(executable),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined },
      stdio: ['ignore', 'ignore', 'ignore'],
      windowsHide: true,
    },
  );
  const exit = waitForExit(child);
  const report = await waitForReport(outputPath);
  if (
    report.ok !== true ||
    report.packaged !== true ||
    report.mode !== 'v2' ||
    report.applicationVersion !== version ||
    report.runtime?.projectDataRootInitialized !== true ||
    report.runtime?.sqliteInitialized !== true ||
    report.security?.externalRequestAttempts !== 0
  )
    throw new Error('INSTALLER_LIFECYCLE_INSTALLED_SMOKE_INVALID');
  return { child, exit };
}

function launchRunning(executable) {
  const child = spawn(executable, [], {
    cwd: dirname(executable),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined },
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  return { child, exit: waitForExit(child) };
}

async function stopRunning(running) {
  if (running.child.exitCode === null && !running.child.kill())
    throw new Error('INSTALLER_LIFECYCLE_RUNNING_APP_STOP_FAILED');
  await running.exit;
}

async function createDataRecord(workspace) {
  const dataRoot = join(workspace, 'userData 中文 空格', 'v2-project-data');
  const databasePath = join(dataRoot, 'database', 'rednote.sqlite');
  const paths = [
    join(dataRoot, 'r10d-lifecycle-canary.txt'),
    join(dataRoot, 'backups', 'r10d-lifecycle-marker.txt'),
    join(dataRoot, 'diagnostics', 'r10d-lifecycle-marker.txt'),
  ];
  const value = randomUUID();
  await Promise.all(paths.map((path) => mkdir(dirname(path), { recursive: true })));
  await Promise.all(paths.map((path) => writeFile(path, value, 'utf8')));
  const database = await stat(databasePath);
  return {
    databasePath,
    databaseSize: database.size,
    paths,
    valueHash: createHash('sha256').update(value).digest('hex'),
  };
}

async function assertData(record) {
  const values = await Promise.all(record.paths.map((path) => readFile(path, 'utf8')));
  const database = await stat(record.databasePath);
  if (
    values.some((value) => createHash('sha256').update(value).digest('hex') !== record.valueHash) ||
    !database.isFile() ||
    database.size === 0 ||
    record.databaseSize === 0
  )
    throw new Error('INSTALLER_LIFECYCLE_DATA_NOT_PRESERVED');
}

async function removeOwned(directory, stage = 'owned-cleanup') {
  const startedAt = performance.now();
  let attempts = 0;
  while (existsSync(directory)) {
    try {
      await rm(directory, { force: true, recursive: true });
    } catch {
      // NSIS self-copy cleanup is observed by bounded convergence, never by force-killing.
    }
    if (!existsSync(directory)) break;
    if (performance.now() - startedAt >= CLEANUP_TIMEOUT_MILLISECONDS) {
      log(stage, startedAt, { attempts, removed: false }, 'failed');
      throw new Error(`INSTALLER_LIFECYCLE_CLEANUP_TIMEOUT:${attempts}`);
    }
    attempts += 1;
    await delay(POLL_MILLISECONDS);
  }
  log(stage, startedAt, { attempts, removed: true });
}

async function main() {
  const temporaryDirectory = ciTemp();
  if (process.env.REDNOTE_R10D_LIFECYCLE_FIXTURE !== '1')
    throw new Error('INSTALLER_LIFECYCLE_FIXTURE_REQUIRED');
  const target = targetPath();
  const readState = () => observe(target, temporaryDirectory);
  const initial = await readState();
  if (initial.installDirectory || initial.registryEntries !== 0 || initial.startMenu)
    throw new Error('INSTALLER_LIFECYCLE_REFUSES_EXISTING_INSTALL');
  log('L01-preconditions', performance.now(), { state: safeState(initial) });
  const canonicalBundle = join(root, 'out', 'installer-bundle');
  const fixtureOutput = join(root, 'out', 'r10d-beta0-fixture');
  const fixtureBundle = join(fixtureOutput, 'installer-bundle');
  const installerNames = await Promise.all([
    readdir(canonicalBundle).then((entries) => entries.filter((entry) => entry.endsWith('.exe'))),
    readdir(fixtureBundle).then((entries) => entries.filter((entry) => entry.endsWith('.exe'))),
  ]);
  if (installerNames.some((entries) => entries.length !== 1))
    throw new Error('INSTALLER_LIFECYCLE_EXPECTS_ONE_INSTALLER_PER_VERSION');
  if ((await readdir(canonicalBundle)).length !== 4)
    throw new Error('INSTALLER_LIFECYCLE_CANONICAL_BUNDLE_INVALID');
  const canonicalDirectory = (await readdir(join(root, 'out'))).find((name) =>
    name.endsWith('-win32-x64'),
  );
  const fixtureDirectory = (await readdir(fixtureOutput)).find((name) =>
    name.endsWith('-win32-x64'),
  );
  if (canonicalDirectory === undefined || fixtureDirectory === undefined)
    throw new Error('INSTALLER_LIFECYCLE_PACKAGE_DIRECTORY_MISSING');
  const [beta1Manifest, beta0Manifest] = await Promise.all([
    readReleaseManifest(join(root, 'out', canonicalDirectory), [WINDOWS_CANONICAL_VERSION]),
    readReleaseManifest(join(fixtureOutput, fixtureDirectory), [WINDOWS_CI_FIXTURE_VERSION]),
  ]);
  const beta1Installer = join(canonicalBundle, installerNames[0][0]);
  const beta0Installer = join(fixtureBundle, installerNames[1][0]);
  const lifecycleRoot = await mkdtemp(join(temporaryDirectory, 'r10d-lifecycle-'));
  const workspace = await mkdtemp(join(lifecycleRoot, 'rednote-issue010-smoke-'));
  const executable = join(target, 'RednoteMysteryOperations.exe');
  const uninstaller = () => join(target, 'Uninstall 红笺本地运营台.exe');
  try {
    if ((await invoke(beta0Installer, ['/S'], fixtureBundle)) !== 0)
      throw new Error('INSTALLER_LIFECYCLE_BETA0_INSTALL_FAILED');
    await converge('L02-clean-beta0-install', readState, (state) =>
      installed(state, WINDOWS_CI_FIXTURE_VERSION),
    );
    await assertPayload(target, beta0Manifest, WINDOWS_CI_FIXTURE_VERSION);

    const first = await launchSmoke(
      executable,
      workspace,
      lifecycleRoot,
      WINDOWS_CI_FIXTURE_VERSION,
    );
    if ((await first.exit) !== 0) throw new Error('INSTALLER_LIFECYCLE_BETA0_SMOKE_FAILED');
    const data = await createDataRecord(workspace);

    const upgradeRunning = launchRunning(executable);
    await converge('L04-running-upgrade-app-ready', readState, (state) =>
      runningInstalled(state, WINDOWS_CI_FIXTURE_VERSION),
    );
    try {
      if ((await invoke(beta1Installer, ['/S'], canonicalBundle)) === 0)
        throw new Error('INSTALLER_LIFECYCLE_RUNNING_UPGRADE_NOT_BLOCKED');
      await converge('L04-running-upgrade-block', readState, (state) =>
        runningInstalled(state, WINDOWS_CI_FIXTURE_VERSION),
      );
    } finally {
      await stopRunning(upgradeRunning);
    }
    await converge('L04-running-upgrade-app-closed', readState, (state) =>
      installed(state, WINDOWS_CI_FIXTURE_VERSION),
    );

    const uninstallRunning = launchRunning(executable);
    await converge('L04-running-uninstall-app-ready', readState, (state) =>
      runningInstalled(state, WINDOWS_CI_FIXTURE_VERSION),
    );
    try {
      if ((await invoke(uninstaller(), ['/S'], target)) === 0)
        throw new Error('INSTALLER_LIFECYCLE_RUNNING_UNINSTALL_NOT_BLOCKED');
      await converge('L04-running-uninstall-block', readState, (state) =>
        runningInstalled(state, WINDOWS_CI_FIXTURE_VERSION),
      );
    } finally {
      await stopRunning(uninstallRunning);
    }
    await converge('L04-running-uninstall-app-closed', readState, (state) =>
      installed(state, WINDOWS_CI_FIXTURE_VERSION),
    );

    const corrupt = join(lifecycleRoot, 'corrupt-beta1.exe');
    await cp(beta1Installer, corrupt);
    const size = (await stat(corrupt)).size;
    if (size < 8_192) throw new Error('INSTALLER_LIFECYCLE_CORRUPT_FIXTURE_INVALID');
    await truncate(corrupt, size - 1_024);
    if ((await invoke(corrupt, ['/S'], lifecycleRoot)) === 0)
      throw new Error('INSTALLER_LIFECYCLE_CORRUPT_INSTALLER_ACCEPTED');
    await converge('L05-corrupt-installer-rollback', readState, (state) =>
      installed(state, WINDOWS_CI_FIXTURE_VERSION),
    );
    await assertPayload(target, beta0Manifest, WINDOWS_CI_FIXTURE_VERSION);
    await assertData(data);

    if ((await invoke(beta1Installer, ['/S'], canonicalBundle)) !== 0)
      throw new Error('INSTALLER_LIFECYCLE_BETA1_UPGRADE_FAILED');
    await converge('L06-beta0-to-beta1-upgrade', readState, (state) =>
      installed(state, WINDOWS_CANONICAL_VERSION),
    );
    await assertPayload(target, beta1Manifest, WINDOWS_CANONICAL_VERSION);
    const upgraded = await launchSmoke(
      executable,
      workspace,
      lifecycleRoot,
      WINDOWS_CANONICAL_VERSION,
    );
    if ((await upgraded.exit) !== 0) throw new Error('INSTALLER_LIFECYCLE_BETA1_SMOKE_FAILED');
    await assertData(data);

    if ((await invoke(beta0Installer, ['/S'], fixtureBundle)) === 0)
      throw new Error('INSTALLER_LIFECYCLE_DOWNGRADE_NOT_BLOCKED');
    await converge('L07-downgrade-block', readState, (state) =>
      installed(state, WINDOWS_CANONICAL_VERSION),
    );
    await assertPayload(target, beta1Manifest, WINDOWS_CANONICAL_VERSION);

    if ((await invoke(uninstaller(), ['/S'], target)) !== 0)
      throw new Error('INSTALLER_LIFECYCLE_UNINSTALL_FAILED');
    await converge('L08-uninstall-data-preserved', readState, uninstalled);
    await assertData(data);

    if ((await invoke(beta1Installer, ['/S'], canonicalBundle)) !== 0)
      throw new Error('INSTALLER_LIFECYCLE_REINSTALL_FAILED');
    await converge('L09-reinstall-read-preserved-data', readState, (state) =>
      installed(state, WINDOWS_CANONICAL_VERSION),
    );
    const reinstalled = await launchSmoke(
      executable,
      workspace,
      lifecycleRoot,
      WINDOWS_CANONICAL_VERSION,
    );
    if ((await reinstalled.exit) !== 0)
      throw new Error('INSTALLER_LIFECYCLE_REINSTALL_SMOKE_FAILED');
    await assertData(data);

    if ((await invoke(uninstaller(), ['/S'], target)) !== 0)
      throw new Error('INSTALLER_LIFECYCLE_FINAL_UNINSTALL_FAILED');
    await converge('L10-final-uninstall', readState, uninstalled);
    await assertData(data);
    await removeOwned(workspace);
    await removeOwned(lifecycleRoot);
    await removeOwned(fixtureOutput);
    process.stdout.write(
      `${JSON.stringify({ lifecycle: 'L01-L10', networkConnections: 0, version: WINDOWS_CANONICAL_VERSION })}\n`,
    );
  } finally {
    if (within(temporaryDirectory, lifecycleRoot) && existsSync(lifecycleRoot))
      await removeOwned(lifecycleRoot);
    if (existsSync(fixtureOutput)) await removeOwned(fixtureOutput);
  }
}

async function cleanup() {
  const temporaryDirectory = ciTemp();
  if (process.env.REDNOTE_R10D_CI_CLEANUP !== '1')
    throw new Error('INSTALLER_LIFECYCLE_CLEANUP_FLAG_REQUIRED');
  await removeOwned(temporaryDirectory, 'ci-temp-cleanup');
}

if (process.argv.includes('--cleanup-ci-temp')) await cleanup();
else await main();
