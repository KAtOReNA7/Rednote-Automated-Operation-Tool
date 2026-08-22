import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  appendFile,
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
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import {
  readReleaseManifest,
  WINDOWS_APPLICATION_ID,
  WINDOWS_CANONICAL_VERSION,
  WINDOWS_CI_FIXTURE_VERSION,
  WINDOWS_INSTALLER_GUID,
  WINDOWS_PRODUCT_NAME,
} from './windows-distribution-contract.mjs';

const run = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const POLL_MILLISECONDS = 250;
const CONVERGENCE_TIMEOUT_MILLISECONDS = 90_000;
const CLEANUP_TIMEOUT_MILLISECONDS = 30_000;
const PROBE_TIMEOUT_MILLISECONDS = 4_000;
const INSTALLER_TIMEOUT_MILLISECONDS = 180_000;
const FAILURE_SUMMARY_LIMIT = 900;
const WINDOWS_APPLICATION_EXECUTABLE = 'RednoteMysteryOperations.exe';
let activeStage = 'bootstrap';
let lastObservedState;

export class LifecycleFailure extends Error {
  constructor(stage, code, classification = 'invariant') {
    super(code);
    this.name = 'LifecycleFailure';
    this.stage = stage;
    this.code = code;
    this.classification = classification;
  }
}

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function setStage(stage) {
  activeStage = stage;
}

function failure(stage, code, classification = 'invariant') {
  return new LifecycleFailure(stage, code, classification);
}

function stableCode(error) {
  if (error instanceof LifecycleFailure) return error.code;
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_]{2,95}$/u.test(message)
    ? message
    : 'INSTALLER_LIFECYCLE_UNCLASSIFIED_FAILURE';
}

function failureClassification(error) {
  if (error instanceof LifecycleFailure) return error.classification;
  const code = stableCode(error);
  if (code.includes('TIMEOUT')) return 'timeout';
  if (code.includes('SIGNAL')) return 'signal';
  if (code.includes('SPAWN')) return 'spawn_error';
  if (code.includes('CLEANUP')) return 'cleanup';
  return 'invariant';
}

function summaryState(state = lastObservedState) {
  if (state === undefined) return { known: false };
  return {
    displayVersion: state.displayVersion,
    installDirectory: state.installDirectory,
    nsisHelperDirectories: state.nsisHelperDirectories,
    processCount: state.processes.length,
    registryEntries: state.registryEntries,
    startMenu: state.startMenu,
  };
}

export function formatFailureSummary(error, role = 'primary', state) {
  const value = JSON.stringify({
    classification: role === 'cleanup' ? 'cleanup' : failureClassification(error),
    code: stableCode(error),
    kind: 'r10d-installer-lifecycle-failure',
    role,
    stage: error instanceof LifecycleFailure ? error.stage : activeStage,
    state: summaryState(state),
  })
    .replace(/[\r\n]/gu, ' ')
    .slice(0, FAILURE_SUMMARY_LIMIT);
  return `R10D_LIFECYCLE_FAILURE ${value}`;
}

async function emitFailureSummary(error, role = 'primary') {
  const summary = formatFailureSummary(error, role);
  process.stderr.write(`::error title=R10D lifecycle ${role}::${summary}\n`);
  if (process.env.GITHUB_STEP_SUMMARY !== undefined) {
    try {
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `\n\`${summary}\`\n`, 'utf8');
    } catch {
      process.stderr.write(
        '::warning title=R10D lifecycle summary::R10D_STEP_SUMMARY_WRITE_FAILED\n',
      );
    }
  }
}

export async function retryProbe(stage, probe, attempts = 2) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await probe();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(POLL_MILLISECONDS);
    }
  }
  throw failure(
    stage,
    `INSTALLER_LIFECYCLE_${stage.toUpperCase().replace(/[^A-Z0-9]+/gu, '_')}_PROBE_FAILED`,
    failureClassification(lastError),
  );
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

function probeClassification(error) {
  if (
    typeof error === 'object' &&
    error !== null &&
    ('killed' in error ? error.killed === true : false)
  )
    return 'timeout';
  if (
    typeof error === 'object' &&
    error !== null &&
    'signal' in error &&
    typeof error.signal === 'string'
  )
    return 'signal';
  if (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
  )
    return 'spawn_error';
  return 'invariant';
}

async function registryProbe() {
  const key = `HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\${WINDOWS_INSTALLER_GUID}`;
  try {
    const { stdout } = await run('reg.exe', ['query', key, '/v', 'DisplayVersion'], {
      maxBuffer: 4_096,
      timeout: PROBE_TIMEOUT_MILLISECONDS,
      windowsHide: true,
    });
    const match = /DisplayVersion\s+REG_SZ\s+([^\r\n]+)/iu.exec(stdout);
    if (match?.[1] === undefined)
      throw failure('registry', 'INSTALLER_LIFECYCLE_REGISTRY_VALUE_INVALID');
    return { displayVersion: match[1].trim(), registryEntries: 1 };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 1)
      return { displayVersion: null, registryEntries: 0 };
    throw failure(
      'registry',
      'INSTALLER_LIFECYCLE_REGISTRY_PROBE_FAILED',
      probeClassification(error),
    );
  }
}

export function parseTasklistProcesses(stdout) {
  const processes = [];
  for (const line of stdout.split(/\r?\n/gu)) {
    const match = /^"([^"]+)","([0-9]+)"/u.exec(line.trim());
    if (match === null || match[1]?.toLowerCase() !== WINDOWS_APPLICATION_EXECUTABLE.toLowerCase())
      continue;
    const pid = Number(match[2]);
    if (!Number.isSafeInteger(pid) || pid <= 0)
      throw failure('process', 'INSTALLER_LIFECYCLE_PROCESS_PROBE_INVALID');
    processes.push({
      image: WINDOWS_APPLICATION_EXECUTABLE,
      inInstall: true,
      nsisHelper: false,
      pid,
    });
  }
  if (
    processes.length > 8 ||
    (stdout.includes(WINDOWS_APPLICATION_EXECUTABLE) && processes.length === 0)
  )
    throw failure('process', 'INSTALLER_LIFECYCLE_PROCESS_PROBE_INVALID');
  return processes;
}

async function processProbe() {
  try {
    const { stdout } = await run(
      'tasklist.exe',
      ['/FI', `IMAGENAME eq ${WINDOWS_APPLICATION_EXECUTABLE}`, '/FO', 'CSV', '/NH'],
      {
        maxBuffer: 8_192,
        timeout: PROBE_TIMEOUT_MILLISECONDS,
        windowsHide: true,
      },
    );
    return parseTasklistProcesses(stdout);
  } catch (error) {
    if (error instanceof LifecycleFailure) throw error;
    throw failure(
      'process',
      'INSTALLER_LIFECYCLE_PROCESS_PROBE_FAILED',
      probeClassification(error),
    );
  }
}

async function helperDirectoryProbe(temporaryDirectory) {
  const entries = await readdir(temporaryDirectory, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory() && /^ns.*\.tmp$/iu.test(entry.name)).length;
}

async function observe(target, temporaryDirectory, stage) {
  setStage(stage);
  const [registry, processes, nsisHelperDirectories] = await Promise.all([
    retryProbe(`${stage}-registry`, registryProbe),
    retryProbe(`${stage}-process`, processProbe),
    retryProbe(`${stage}-helper`, () => helperDirectoryProbe(temporaryDirectory)),
  ]);
  const state = {
    ...registry,
    installDirectory: existsSync(target),
    nsisHelperDirectories,
    processes,
    startMenu: existsSync(startMenuPath()),
  };
  if (
    typeof state.installDirectory !== 'boolean' ||
    typeof state.startMenu !== 'boolean' ||
    !Number.isSafeInteger(state.registryEntries) ||
    !Number.isSafeInteger(state.nsisHelperDirectories) ||
    !Array.isArray(state.processes) ||
    state.processes.length > 16
  )
    throw new Error('INSTALLER_LIFECYCLE_STATE_INVALID');
  lastObservedState = state;
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
  setStage(stage);
  const startedAt = performance.now();
  let attempts = 0;
  let state = await readState(stage);
  while (!predicate(state)) {
    if (performance.now() - startedAt >= timeout) {
      log(stage, startedAt, { attempts, state: safeState(state) }, 'failed');
      throw failure(stage, 'INSTALLER_LIFECYCLE_CONVERGENCE_TIMEOUT', 'timeout');
    }
    attempts += 1;
    await delay(POLL_MILLISECONDS);
    state = await readState(stage);
  }
  log(stage, startedAt, { attempts, state: safeState(state) });
  return state;
}

export function invokeProcess(
  executable,
  arguments_,
  cwd,
  timeout = INSTALLER_TIMEOUT_MILLISECONDS,
) {
  return new Promise((resolveInvocation) => {
    const child = spawn(executable, arguments_, {
      cwd,
      stdio: 'ignore',
      windowsHide: true,
    });
    let settled = false;
    let timedOut = false;
    let timer;
    const cleanupListeners = () => {
      if (timer !== undefined) clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    const settle = (result) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      resolveInvocation(result);
    };
    const onError = (error) => {
      if (timedOut) {
        settle({ kind: 'timeout' });
        return;
      }
      settle({
        code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
        kind: 'spawn_error',
      });
    };
    const onExit = (code, signal) => {
      if (timedOut) {
        settle({ kind: 'timeout' });
        return;
      }
      if (code !== null) settle({ code, kind: 'exit' });
      else settle({ kind: 'signal', signal: signal ?? 'UNKNOWN' });
    };
    child.once('error', onError);
    child.once('exit', onExit);
    timer = setTimeout(() => {
      timedOut = true;
      if (!child.kill()) {
        settle({ kind: 'timeout' });
        return;
      }
      timer = setTimeout(() => settle({ kind: 'timeout' }), 5_000);
    }, timeout);
  });
}

export function assertInvocation(stage, result, expectation, code) {
  if (result.kind === 'timeout') throw failure(stage, `${code}_TIMEOUT`, 'timeout');
  if (result.kind === 'signal') throw failure(stage, `${code}_SIGNAL`, 'signal');
  if (result.kind === 'spawn_error') throw failure(stage, `${code}_SPAWN_ERROR`, 'spawn_error');
  if (expectation === 'success' && result.code !== 0)
    throw failure(stage, `${code}_NONZERO_EXIT`, 'nonzero_exit');
  if (expectation === 'nonzero' && result.code === 0)
    throw failure(stage, `${code}_UNEXPECTED_ZERO_EXIT`, 'invariant');
  return result.code;
}

async function invokeExpected(stage, executable, arguments_, cwd, expectation, code) {
  setStage(stage);
  const result = await invokeProcess(executable, arguments_, cwd);
  return assertInvocation(stage, result, expectation, code);
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

export async function waitForReport(outputPath, timeout = 25_000) {
  const deadline = performance.now() + timeout;
  let incompleteJson = false;
  while (performance.now() < deadline) {
    try {
      return JSON.parse(await readFile(outputPath, 'utf8'));
    } catch (error) {
      if (error instanceof SyntaxError) incompleteJson = true;
      else if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
        throw failure('smoke-report', 'INSTALLER_LIFECYCLE_SMOKE_REPORT_READ_FAILED');
    }
    await delay(50);
  }
  throw failure(
    'smoke-report',
    incompleteJson
      ? 'INSTALLER_LIFECYCLE_SMOKE_REPORT_INVALID'
      : 'INSTALLER_LIFECYCLE_SMOKE_REPORT_TIMEOUT',
    'timeout',
  );
}

export function waitForExit(child, timeout = 35_000) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  if (child.signalCode !== undefined && child.signalCode !== null)
    return Promise.reject(
      failure('process-exit', 'INSTALLER_LIFECYCLE_SMOKE_EXIT_SIGNAL', 'signal'),
    );
  return new Promise((resolveExit, rejectExit) => {
    let settled = false;
    const cleanupListeners = () => {
      clearTimeout(timer);
      child.removeListener('error', onError);
      child.removeListener('exit', onExit);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      rejectExit(error);
    };
    const resolveOnce = (code) => {
      if (settled) return;
      settled = true;
      cleanupListeners();
      resolveExit(code);
    };
    const onError = () => {
      rejectOnce(
        failure('process-exit', 'INSTALLER_LIFECYCLE_SMOKE_EXIT_SPAWN_ERROR', 'spawn_error'),
      );
    };
    const onExit = (code, signal) => {
      if (code !== null) resolveOnce(code);
      else
        rejectOnce(
          failure(
            'process-exit',
            `INSTALLER_LIFECYCLE_SMOKE_EXIT_SIGNAL_${signal ?? 'UNKNOWN'}`,
            'signal',
          ),
        );
    };
    const timer = setTimeout(
      () =>
        rejectOnce(failure('process-exit', 'INSTALLER_LIFECYCLE_SMOKE_EXIT_TIMEOUT', 'timeout')),
      timeout,
    );
    child.once('error', onError);
    child.once('exit', onExit);
    if (child.exitCode !== null) resolveOnce(child.exitCode);
    else if (child.signalCode !== undefined && child.signalCode !== null)
      onExit(null, child.signalCode);
  });
}

async function terminateOwnedChild(child) {
  if (child.exitCode !== null || (child.signalCode !== undefined && child.signalCode !== null))
    return;
  if (!child.kill())
    throw failure('smoke-cleanup', 'INSTALLER_LIFECYCLE_SMOKE_CLEANUP_KILL_FAILED', 'cleanup');
  await waitForExit(child, 5_000).catch((error) => {
    if (error instanceof LifecycleFailure && error.classification === 'signal') return;
    throw error;
  });
}

async function launchSmoke(executable, workspace, reportRoot, version, stage) {
  setStage(stage);
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
  const exitOutcome = waitForExit(child).then(
    (code) => ({ code, kind: 'exit' }),
    (error) => ({ error, kind: 'error' }),
  );
  let primaryError;
  try {
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
      throw failure(stage, 'INSTALLER_LIFECYCLE_INSTALLED_SMOKE_INVALID');
  } catch (error) {
    primaryError = error;
  }
  if (primaryError !== undefined) {
    try {
      await terminateOwnedChild(child);
    } catch (cleanupError) {
      await emitFailureSummary(cleanupError, 'cleanup');
    }
    throw primaryError;
  }
  return {
    child,
    exit: exitOutcome.then(async (outcome) => {
      if (outcome.kind === 'error') {
        try {
          await terminateOwnedChild(child);
        } catch (cleanupError) {
          await emitFailureSummary(cleanupError, 'cleanup');
        }
        throw outcome.error;
      }
      return outcome.code;
    }),
  };
}

export function createRunningProcess(child, awaitExit = waitForExit) {
  let spawnError;
  const onError = (error) => {
    spawnError = error;
  };
  child.once('error', onError);
  return {
    awaitExit,
    child,
    dispose() {
      child.removeListener('error', onError);
    },
    get spawnError() {
      return spawnError;
    },
  };
}

export function launchRunning(executable, arguments_ = []) {
  const child = spawn(executable, arguments_, {
    cwd: dirname(executable),
    env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined, NODE_OPTIONS: undefined },
    stdio: ['ignore', 'ignore', 'ignore'],
    windowsHide: true,
  });
  return createRunningProcess(child);
}

export async function stopRunning(running) {
  try {
    if (running.spawnError !== undefined)
      throw failure(
        'running-app-cleanup',
        'INSTALLER_LIFECYCLE_RUNNING_APP_SPAWN_ERROR',
        'spawn_error',
      );
    if (running.child.exitCode !== null) return running.child.exitCode;
    // The owned app is intentionally persistent. Its bounded exit wait begins only
    // when this harness explicitly requests its shutdown.
    if (!running.child.kill())
      throw failure(
        'running-app-cleanup',
        'INSTALLER_LIFECYCLE_RUNNING_APP_STOP_FAILED',
        'cleanup',
      );
    try {
      return await running.awaitExit(running.child);
    } catch (error) {
      if (error instanceof LifecycleFailure && error.classification === 'signal') return null;
      throw error;
    }
  } finally {
    running.dispose();
  }
}

export function selectLifecycleFailure(primaryError, cleanupError) {
  return primaryError ?? cleanupError;
}

async function withRunningApplication(
  executable,
  readState,
  version,
  readyStage,
  closedStage,
  action,
) {
  const running = launchRunning(executable);
  let primaryError;
  let cleanupError;
  try {
    await converge(readyStage, readState, (state) => {
      if (running.spawnError !== undefined)
        throw failure(readyStage, 'INSTALLER_LIFECYCLE_RUNNING_APP_SPAWN_ERROR', 'spawn_error');
      return runningInstalled(state, version);
    });
    await action();
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      await stopRunning(running);
      await converge(closedStage, readState, (state) => installed(state, version));
    } catch (error) {
      cleanupError = error;
      if (primaryError !== undefined) {
        log(closedStage, performance.now(), { cleanup: 'failed' }, 'failed');
        await emitFailureSummary(cleanupError, 'cleanup');
      }
    }
  }
  const selectedError = selectLifecycleFailure(primaryError, cleanupError);
  if (selectedError !== undefined) throw selectedError;
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
      throw failure(stage, 'INSTALLER_LIFECYCLE_CLEANUP_TIMEOUT', 'cleanup');
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
  const readState = (stage) => observe(target, temporaryDirectory, stage);
  setStage('L01-preconditions');
  const initial = await readState('L01-preconditions');
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
  let primaryError;
  let cleanupError;
  try {
    await invokeExpected(
      'L02-beta0-install',
      beta0Installer,
      ['/S'],
      fixtureBundle,
      'success',
      'INSTALLER_LIFECYCLE_BETA0_INSTALL',
    );
    await converge('L02-clean-beta0-install', readState, (state) =>
      installed(state, WINDOWS_CI_FIXTURE_VERSION),
    );
    await assertPayload(target, beta0Manifest, WINDOWS_CI_FIXTURE_VERSION);

    const first = await launchSmoke(
      executable,
      workspace,
      lifecycleRoot,
      WINDOWS_CI_FIXTURE_VERSION,
      'L03-beta0-installed-smoke',
    );
    if ((await first.exit) !== 0) throw new Error('INSTALLER_LIFECYCLE_BETA0_SMOKE_FAILED');
    const data = await createDataRecord(workspace);

    await withRunningApplication(
      executable,
      readState,
      WINDOWS_CI_FIXTURE_VERSION,
      'L04-running-upgrade-app-ready',
      'L04-running-upgrade-app-closed',
      async () => {
        await invokeExpected(
          'L04-running-upgrade-block',
          beta1Installer,
          ['/S'],
          canonicalBundle,
          'nonzero',
          'INSTALLER_LIFECYCLE_RUNNING_UPGRADE',
        );
        await converge('L04-running-upgrade-block', readState, (state) =>
          runningInstalled(state, WINDOWS_CI_FIXTURE_VERSION),
        );
      },
    );

    await withRunningApplication(
      executable,
      readState,
      WINDOWS_CI_FIXTURE_VERSION,
      'L04-running-uninstall-app-ready',
      'L04-running-uninstall-app-closed',
      async () => {
        await invokeExpected(
          'L04-running-uninstall-block',
          uninstaller(),
          ['/S'],
          target,
          'nonzero',
          'INSTALLER_LIFECYCLE_RUNNING_UNINSTALL',
        );
        await converge('L04-running-uninstall-block', readState, (state) =>
          runningInstalled(state, WINDOWS_CI_FIXTURE_VERSION),
        );
      },
    );

    const corrupt = join(lifecycleRoot, 'corrupt-beta1.exe');
    await cp(beta1Installer, corrupt);
    const size = (await stat(corrupt)).size;
    if (size < 8_192) throw new Error('INSTALLER_LIFECYCLE_CORRUPT_FIXTURE_INVALID');
    await truncate(corrupt, size - 1_024);
    await invokeExpected(
      'L05-corrupt-installer-rollback',
      corrupt,
      ['/S'],
      lifecycleRoot,
      'nonzero',
      'INSTALLER_LIFECYCLE_CORRUPT_INSTALLER',
    );
    await converge('L05-corrupt-installer-rollback', readState, (state) =>
      installed(state, WINDOWS_CI_FIXTURE_VERSION),
    );
    await assertPayload(target, beta0Manifest, WINDOWS_CI_FIXTURE_VERSION);
    await assertData(data);

    await invokeExpected(
      'L06-beta0-to-beta1-upgrade',
      beta1Installer,
      ['/S'],
      canonicalBundle,
      'success',
      'INSTALLER_LIFECYCLE_BETA1_UPGRADE',
    );
    await converge('L06-beta0-to-beta1-upgrade', readState, (state) =>
      installed(state, WINDOWS_CANONICAL_VERSION),
    );
    await assertPayload(target, beta1Manifest, WINDOWS_CANONICAL_VERSION);
    const upgraded = await launchSmoke(
      executable,
      workspace,
      lifecycleRoot,
      WINDOWS_CANONICAL_VERSION,
      'L06-beta1-installed-smoke',
    );
    if ((await upgraded.exit) !== 0) throw new Error('INSTALLER_LIFECYCLE_BETA1_SMOKE_FAILED');
    await assertData(data);

    await invokeExpected(
      'L07-downgrade-block',
      beta0Installer,
      ['/S'],
      fixtureBundle,
      'nonzero',
      'INSTALLER_LIFECYCLE_DOWNGRADE',
    );
    await converge('L07-downgrade-block', readState, (state) =>
      installed(state, WINDOWS_CANONICAL_VERSION),
    );
    await assertPayload(target, beta1Manifest, WINDOWS_CANONICAL_VERSION);

    await invokeExpected(
      'L08-uninstall-data-preserved',
      uninstaller(),
      ['/S'],
      target,
      'success',
      'INSTALLER_LIFECYCLE_UNINSTALL',
    );
    await converge('L08-uninstall-data-preserved', readState, uninstalled);
    await assertData(data);

    await invokeExpected(
      'L09-reinstall-read-preserved-data',
      beta1Installer,
      ['/S'],
      canonicalBundle,
      'success',
      'INSTALLER_LIFECYCLE_REINSTALL',
    );
    await converge('L09-reinstall-read-preserved-data', readState, (state) =>
      installed(state, WINDOWS_CANONICAL_VERSION),
    );
    const reinstalled = await launchSmoke(
      executable,
      workspace,
      lifecycleRoot,
      WINDOWS_CANONICAL_VERSION,
      'L09-reinstalled-smoke',
    );
    if ((await reinstalled.exit) !== 0)
      throw new Error('INSTALLER_LIFECYCLE_REINSTALL_SMOKE_FAILED');
    await assertData(data);

    await invokeExpected(
      'L10-final-uninstall',
      uninstaller(),
      ['/S'],
      target,
      'success',
      'INSTALLER_LIFECYCLE_FINAL_UNINSTALL',
    );
    await converge('L10-final-uninstall', readState, uninstalled);
    await assertData(data);
    await removeOwned(workspace);
    await removeOwned(lifecycleRoot);
    await removeOwned(fixtureOutput);
    process.stdout.write(
      `${JSON.stringify({ lifecycle: 'L01-L10', networkConnections: 0, version: WINDOWS_CANONICAL_VERSION })}\n`,
    );
  } catch (error) {
    primaryError = error;
  } finally {
    for (const [directory, stage] of [
      [within(temporaryDirectory, lifecycleRoot) ? lifecycleRoot : undefined, 'lifecycle-cleanup'],
      [fixtureOutput, 'fixture-cleanup'],
    ]) {
      if (directory === undefined || !existsSync(directory)) continue;
      try {
        await removeOwned(directory, stage);
      } catch (error) {
        cleanupError ??= error;
        await emitFailureSummary(error, 'cleanup');
      }
    }
  }
  const selectedError = selectLifecycleFailure(primaryError, cleanupError);
  if (selectedError !== undefined) throw selectedError;
}

async function cleanup() {
  const temporaryDirectory = ciTemp();
  if (process.env.REDNOTE_R10D_CI_CLEANUP !== '1')
    throw new Error('INSTALLER_LIFECYCLE_CLEANUP_FLAG_REQUIRED');
  await removeOwned(temporaryDirectory, 'ci-temp-cleanup');
}

async function runCli() {
  try {
    if (process.argv.includes('--cleanup-ci-temp')) await cleanup();
    else await main();
  } catch (error) {
    await emitFailureSummary(error);
    process.exitCode = 1;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await runCli();
}
