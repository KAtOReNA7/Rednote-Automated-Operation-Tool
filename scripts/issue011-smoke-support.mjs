import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';

const TCP_SNAPSHOT_TIMEOUT_MILLISECONDS = 2_000;
const PROCESS_EXIT_DEADLINE_MILLISECONDS = 5_000;
const PROCESS_EXIT_POLL_MILLISECONDS = 50;
const PROCESS_SAMPLE_WAIT_MILLISECONDS = 1_000;
const PROCESS_SAMPLE_POLL_MILLISECONDS = 10;
const SMOKE_PROCESS_SAMPLE_PREFIX = '__REDNOTE_SMOKE_PROCESS_SAMPLE__:';
const MAX_SMOKE_PROCESS_COUNT = 32;
const MAX_SMOKE_PROCESS_SAMPLES = 6;
const MAX_SMOKE_PROCESS_SAMPLE_BYTES = 4_096;
const INITIAL_SMOKE_PROCESS_STAGES = ['ready', 'capability-validated'];
const FINAL_SMOKE_PROCESS_STAGES = [...INITIAL_SMOKE_PROCESS_STAGES, 'before-exit'];
const SMOKE_PROCESS_SAMPLE_STAGES = new Set(['before-exit', 'capability-validated', 'ready']);
const SMOKE_PROCESS_TYPES = new Set([
  'Browser',
  'GPU',
  'Pepper Plugin',
  'Pepper Plugin Broker',
  'Sandbox helper',
  'Tab',
  'Unknown',
  'Utility',
  'Zygote',
]);
const ACTIVE_NETSTAT_STATES = new Map([
  ['ESTABLISHED', 'Established'],
  ['LISTENING', 'Listen'],
  ['SYN_RECEIVED', 'SynReceived'],
  ['SYN_SENT', 'SynSent'],
]);

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

export function recordObservationStage(stage, startedAt, evidence = {}, status = 'ok') {
  const destination = status === 'ok' ? process.stdout : process.stderr;
  destination.write(
    `${JSON.stringify({
      durationMilliseconds: Date.now() - startedAt,
      evidence,
      kind: 'electron-smoke-observation',
      stage,
      status,
    })}\n`,
  );
}

function runBoundedCommand(stage, executable, arguments_, timeoutMilliseconds) {
  return new Promise((resolveCommand, rejectCommand) => {
    const startedAt = Date.now();
    execFile(
      executable,
      arguments_,
      { maxBuffer: 1_048_576, timeout: timeoutMilliseconds, windowsHide: true },
      (error, stdout, stderr) => {
        if (error !== null) {
          const evidence = {
            code:
              typeof error.code === 'number' || typeof error.code === 'string' ? error.code : null,
            killed: error.killed === true,
            signal: error.signal ?? null,
            timeoutMilliseconds,
          };
          recordObservationStage(stage, startedAt, evidence, 'failed');
          rejectCommand(
            new Error(
              `Electron smoke observation ${stage} failed (${error.killed === true ? 'TIMEOUT' : 'COMMAND_FAILED'}): ${JSON.stringify(evidence)}`,
              { cause: stderr.trim() === '' ? error : new Error(stderr.trim()) },
            ),
          );
          return;
        }
        recordObservationStage(stage, startedAt, { timeoutMilliseconds });
        resolveCommand(stdout.trim());
      },
    );
  });
}

export async function allocateLoopbackPort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port: 0 }, resolveListen);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('Could not allocate an IPv4 loopback smoke port.');
  }
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
  });
  return address.port;
}

export function waitForExit(child, timeoutMilliseconds = 35_000) {
  return new Promise((resolveExit, rejectExit) => {
    const timeout = setTimeout(() => {
      child.kill();
      rejectExit(new Error('Electron smoke process timed out.'));
    }, timeoutMilliseconds);
    child.once('error', (error) => {
      clearTimeout(timeout);
      rejectExit(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      resolveExit(code);
    });
  });
}

export async function waitForSmokeReport(outputPath, timeoutMilliseconds = 25_000) {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(outputPath, 'utf8'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
        if (!(error instanceof SyntaxError)) {
          throw error;
        }
      }
    }
    await delay(50);
  }
  throw new Error('Electron smoke report was not created in time.');
}

function hasExactKeys(value, expectedKeys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value).sort();
  return (
    keys.length === expectedKeys.length && keys.every((key, index) => key === expectedKeys[index])
  );
}

function normalizeControlledProcessIds(processIds) {
  if (!Array.isArray(processIds) || processIds.length === 0) {
    throw new Error('Electron smoke controlled process list was empty.');
  }
  const normalized = [...new Set(processIds.map(Number))].sort((left, right) => left - right);
  if (
    normalized.length === 0 ||
    normalized.length > MAX_SMOKE_PROCESS_COUNT ||
    normalized.some((value) => !Number.isSafeInteger(value) || value <= 0)
  ) {
    throw new Error('Electron smoke controlled process list was invalid or exceeded its limit.');
  }
  return normalized;
}

export function createSmokeProcessCollector(rootProcessId, limits = {}) {
  const collectorStartedAt = Date.now();
  const normalizedRoot = normalizeControlledProcessIds([rootProcessId])[0];
  const maxProcessCount = limits.maxProcessCount ?? MAX_SMOKE_PROCESS_COUNT;
  const maxSamples = limits.maxSamples ?? MAX_SMOKE_PROCESS_SAMPLES;
  const maxSampleBytes = limits.maxSampleBytes ?? MAX_SMOKE_PROCESS_SAMPLE_BYTES;
  if (
    !Number.isSafeInteger(maxProcessCount) ||
    maxProcessCount <= 0 ||
    !Number.isSafeInteger(maxSamples) ||
    maxSamples <= 0 ||
    !Number.isSafeInteger(maxSampleBytes) ||
    maxSampleBytes <= 0
  ) {
    throw new Error('Electron smoke process collector limits were invalid.');
  }

  let buffered = '';
  let failure = null;
  let sampleCount = 0;
  let processTypes = new Map();
  const sampledStages = new Set();

  function fail(message, cause) {
    failure ??= new Error(message, cause === undefined ? undefined : { cause });
  }

  function parseSampleLine(line) {
    if (!line.startsWith(SMOKE_PROCESS_SAMPLE_PREFIX)) {
      return;
    }
    if (Buffer.byteLength(line, 'utf8') > maxSampleBytes) {
      fail('Electron smoke process sample exceeded its byte limit.');
      return;
    }
    let sample;
    try {
      sample = JSON.parse(line.slice(SMOKE_PROCESS_SAMPLE_PREFIX.length));
    } catch (error) {
      fail('Electron smoke process sample was not valid JSON.', error);
      return;
    }
    if (
      !hasExactKeys(sample, ['processes', 'stage', 'truncated']) ||
      !SMOKE_PROCESS_SAMPLE_STAGES.has(sample.stage) ||
      sample.truncated !== false ||
      !Array.isArray(sample.processes) ||
      sample.processes.length === 0 ||
      sample.processes.length > maxProcessCount
    ) {
      fail('Electron smoke process sample shape was invalid or truncated.');
      return;
    }
    sampleCount += 1;
    if (sampleCount > maxSamples) {
      fail('Electron smoke process sample count exceeded its limit.');
      return;
    }
    const nextProcessTypes = new Map(processTypes);
    for (const processEntry of sample.processes) {
      if (
        !hasExactKeys(processEntry, ['pid', 'type']) ||
        !Number.isSafeInteger(processEntry.pid) ||
        processEntry.pid <= 0 ||
        !SMOKE_PROCESS_TYPES.has(processEntry.type)
      ) {
        fail('Electron smoke process sample contained an invalid process entry.');
        return;
      }
      const existingType = nextProcessTypes.get(processEntry.pid);
      if (existingType !== undefined && existingType !== processEntry.type) {
        fail('Electron smoke process sample changed the type of an existing PID.');
        return;
      }
      nextProcessTypes.set(processEntry.pid, processEntry.type);
    }
    if (nextProcessTypes.size > maxProcessCount) {
      fail('Electron smoke process sample union exceeded its limit.');
      return;
    }
    processTypes = nextProcessTypes;
    sampledStages.add(sample.stage);
  }

  function acceptChunk(chunk) {
    if (failure !== null) {
      return;
    }
    buffered += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (Buffer.byteLength(buffered, 'utf8') > maxSampleBytes && !buffered.includes('\n')) {
      fail('Electron smoke process sample stream exceeded its line limit.');
      return;
    }
    let newlineIndex = buffered.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = buffered.slice(0, newlineIndex).replace(/\r$/u, '');
      buffered = buffered.slice(newlineIndex + 1);
      parseSampleLine(line);
      newlineIndex = buffered.indexOf('\n');
    }
  }

  function attachStream(stream) {
    if (stream === null) {
      fail('Electron smoke stdout was unavailable.');
      return Promise.resolve();
    }
    stream.setEncoding('utf8');
    stream.on('data', acceptChunk);
    return new Promise((resolveStream) => {
      stream.once('error', (error) => {
        fail('Electron smoke stdout observation failed.', error);
        resolveStream();
      });
      stream.once('end', resolveStream);
    });
  }

  function requireProcessIds(requiredStages) {
    if (failure !== null) {
      throw failure;
    }
    const missingStages = requiredStages.filter((stage) => !sampledStages.has(stage));
    if (missingStages.length !== 0) {
      throw new Error(
        `Electron smoke process samples were missing stages: ${missingStages.join(',')}`,
      );
    }
    if (!processTypes.has(normalizedRoot)) {
      throw new Error('Electron smoke process samples did not include the runner root PID.');
    }
    return normalizeControlledProcessIds([...processTypes.keys()]);
  }

  async function waitForStages(
    requiredStages = INITIAL_SMOKE_PROCESS_STAGES,
    timeoutMilliseconds = PROCESS_SAMPLE_WAIT_MILLISECONDS,
  ) {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMilliseconds;
    while (Date.now() <= deadline) {
      if (failure !== null) {
        throw failure;
      }
      if (requiredStages.every((stage) => sampledStages.has(stage))) {
        const processIds = requireProcessIds(requiredStages);
        recordObservationStage('pid-sample-ready', startedAt, {
          processCount: processIds.length,
          sampleCount,
          stageCount: requiredStages.length,
        });
        return processIds;
      }
      await delay(PROCESS_SAMPLE_POLL_MILLISECONDS);
    }
    recordObservationStage(
      'pid-sample-ready',
      startedAt,
      { processCount: processTypes.size, sampleCount, stageCount: requiredStages.length },
      'failed',
    );
    throw new Error('Electron smoke process samples were not received in time.');
  }

  function finish(requiredStages = FINAL_SMOKE_PROCESS_STAGES) {
    if (buffered.startsWith(SMOKE_PROCESS_SAMPLE_PREFIX)) {
      fail('Electron smoke process sample stream ended with a truncated sample.');
    }
    const processIds = requireProcessIds(requiredStages);
    recordObservationStage('pid-sample-final', collectorStartedAt, {
      processCount: processIds.length,
      sampleCount,
      stageCount: requiredStages.length,
    });
    return processIds;
  }

  return { acceptChunk, attachStream, finish, waitForStages };
}

function parseNetstatEndpoint(endpoint) {
  const separator = endpoint.lastIndexOf(':');
  if (separator <= 0) {
    throw new Error('Electron smoke netstat output contained an invalid endpoint.');
  }
  const rawAddress = endpoint.slice(0, separator);
  const address =
    rawAddress.startsWith('[') && rawAddress.endsWith(']') ? rawAddress.slice(1, -1) : rawAddress;
  const port = Number(endpoint.slice(separator + 1));
  if (address === '' || !Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error('Electron smoke netstat output contained an invalid endpoint.');
  }
  return { address, port };
}

export function parseNetstatTcpOutput(output) {
  const connections = [];
  for (const rawLine of output.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line.startsWith('TCP')) {
      continue;
    }
    const match = /^TCP\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)$/u.exec(line);
    if (match === null) {
      throw new Error('Electron smoke netstat output contained an unparseable TCP row.');
    }
    const state = ACTIVE_NETSTAT_STATES.get(match[3]);
    if (state === undefined) {
      continue;
    }
    const local = parseNetstatEndpoint(match[1]);
    const remote = parseNetstatEndpoint(match[2]);
    const owningProcess = Number(match[4]);
    if (!Number.isSafeInteger(owningProcess) || owningProcess <= 0) {
      throw new Error('Electron smoke netstat output contained an invalid owning process.');
    }
    connections.push({
      LocalAddress: local.address,
      LocalPort: local.port,
      OwningProcess: owningProcess,
      RemoteAddress: remote.address,
      RemotePort: remote.port,
      State: state,
    });
  }
  return connections;
}

export async function inspectControlledProcesses(processIds, commandRunner = runBoundedCommand) {
  const normalizedProcessIds = normalizeControlledProcessIds(processIds);
  const netstatOutput = await commandRunner(
    'tcp-snapshot',
    'netstat.exe',
    ['-ano', '-p', 'tcp'],
    TCP_SNAPSHOT_TIMEOUT_MILLISECONDS,
  );
  const parseStartedAt = Date.now();
  const processIdSet = new Set(normalizedProcessIds);
  const connections = parseNetstatTcpOutput(netstatOutput).filter((connection) =>
    processIdSet.has(connection.OwningProcess),
  );
  recordObservationStage('snapshot-parse', parseStartedAt, {
    connectionCount: connections.length,
    processCount: normalizedProcessIds.length,
  });
  return {
    connections,
    processIds: normalizedProcessIds,
  };
}

export function assertSocketSnapshot(snapshot, mode, expectedPort, capabilityPort) {
  const listeners = snapshot.connections.filter((connection) => connection.State === 'Listen');
  const loopbackAddresses = ['127.0.0.1', '::1', '0:0:0:0:0:0:0:1'];
  const nonListeners = snapshot.connections.filter((connection) => connection.State !== 'Listen');
  const externalConnections = nonListeners.filter(
    (connection) => !loopbackAddresses.includes(connection.RemoteAddress),
  );
  if (externalConnections.length !== 0) {
    throw new Error(
      `Electron smoke opened an external TCP connection: ${JSON.stringify(externalConnections)}`,
    );
  }
  const unexpectedLoopbackConnections = nonListeners.filter(
    (connection) =>
      Number(connection.RemotePort) !== capabilityPort &&
      !(
        mode === 'enabled' &&
        (Number(connection.LocalPort) === expectedPort ||
          Number(connection.RemotePort) === expectedPort)
      ),
  );
  if (unexpectedLoopbackConnections.length !== 0) {
    throw new Error(
      `Electron smoke opened an unexpected loopback connection: ${JSON.stringify(unexpectedLoopbackConnections)}`,
    );
  }
  if (mode === 'disabled') {
    if (listeners.length !== 0) {
      throw new Error('Disabled Electron smoke unexpectedly owned a TCP listener.');
    }
    return {
      capabilityConnections: nonListeners.filter(
        (connection) => Number(connection.RemotePort) === capabilityPort,
      ).length,
      externalConnections: 0,
      listeners: 0,
    };
  }
  if (
    listeners.length !== 1 ||
    listeners[0].LocalAddress !== '127.0.0.1' ||
    Number(listeners[0].LocalPort) !== expectedPort ||
    snapshot.connections.some(
      (connection) =>
        connection.State === 'Listen' &&
        (connection.LocalAddress !== '127.0.0.1' || Number(connection.LocalPort) !== expectedPort),
    )
  ) {
    throw new Error('Enabled Electron smoke did not own exactly one expected loopback listener.');
  }
  return {
    capabilityConnections: nonListeners.filter(
      (connection) => Number(connection.RemotePort) === capabilityPort,
    ).length,
    externalConnections: 0,
    listeners: 1,
  };
}

function isProcessAlive(processId) {
  try {
    process.kill(processId, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false;
    }
    if (error instanceof Error && 'code' in error && error.code === 'EPERM') {
      return true;
    }
    throw error;
  }
}

export async function assertProcessesExited(processIds, options = {}) {
  const ids = normalizeControlledProcessIds(processIds);
  const deadlineMilliseconds = options.deadlineMilliseconds ?? PROCESS_EXIT_DEADLINE_MILLISECONDS;
  const pollMilliseconds = options.pollMilliseconds ?? PROCESS_EXIT_POLL_MILLISECONDS;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? delay;
  const queryProcess = options.isProcessAlive ?? isProcessAlive;
  if (
    !Number.isSafeInteger(deadlineMilliseconds) ||
    deadlineMilliseconds <= 0 ||
    !Number.isSafeInteger(pollMilliseconds) ||
    pollMilliseconds <= 0
  ) {
    throw new Error('Electron smoke process cleanup polling options were invalid.');
  }
  const startedAt = Date.now();
  const deadline = now() + deadlineMilliseconds;
  let pollCount = 0;
  while (true) {
    pollCount += 1;
    const remaining = [];
    try {
      for (const processId of ids) {
        if (await queryProcess(processId)) {
          remaining.push(processId);
        }
      }
    } catch (error) {
      recordObservationStage(
        'process-cleanup-check',
        startedAt,
        { pollCount, queryFailed: true, remainingCount: null },
        'failed',
      );
      throw new Error('Electron smoke controlled PID existence query failed.', { cause: error });
    }
    if (remaining.length === 0) {
      recordObservationStage('process-cleanup-check', startedAt, {
        pollCount,
        queryFailed: false,
        remainingCount: 0,
      });
      return;
    }
    if (now() >= deadline) {
      recordObservationStage(
        'process-cleanup-check',
        startedAt,
        { pollCount, queryFailed: false, remainingCount: remaining.length },
        'failed',
      );
      throw new Error('Electron smoke left a controlled residual process after the deadline.');
    }
    await wait(Math.min(pollMilliseconds, Math.max(1, deadline - now())));
  }
}

export async function assertPortReleased(port) {
  const startedAt = Date.now();
  const server = createServer();
  try {
    await new Promise((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen({ host: '127.0.0.1', port }, resolveListen);
    });
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
    });
    recordObservationStage('port-release-check', startedAt, { portReleased: true });
  } catch (error) {
    recordObservationStage('port-release-check', startedAt, { portReleased: false }, 'failed');
    throw new Error('Electron smoke port was not released.', { cause: error });
  }
}

export function assertCommonReport(report, packaged, mode, expectedPort) {
  const localApi = report.settings?.localApi;
  if (
    report.ok !== true ||
    report.packaged !== packaged ||
    report.runtimeVersion !== '43.2.0' ||
    report.storage !== true ||
    report.settings?.credentialCleared !== true ||
    report.settings?.credentialRoundtrip !== true ||
    report.settings?.locator !== true ||
    report.settings?.safeStorage !== true ||
    report.settings?.secretEgressSafeCount !== 50 ||
    report.settings?.capability?.startupAutoRequestCount !== 0 ||
    report.settings?.capability?.status !== 'SUCCEEDED' ||
    report.settings?.capability?.matrixComplete !== true ||
    report.settings?.capability?.sentRequestCount !==
      report.settings?.capability?.plannedRequestCount ||
    report.settings?.settings !== true ||
    report.security?.externalRequestAttempts !== 0 ||
    localApi?.mode !== mode ||
    localApi?.enabled !== (mode === 'enabled') ||
    localApi?.port !== (mode === 'enabled' ? expectedPort : 43_119) ||
    localApi?.hostRejected !== true ||
    localApi?.originRejectedWithoutAcao !== true ||
    localApi?.oversizedBodyRejected !== true ||
    localApi?.pairingAuthRotationRevoke !== true ||
    localApi?.preflight !== true ||
    (mode === 'enabled' &&
      (localApi.address !== '127.0.0.1' ||
        localApi.family !== 'IPv4' ||
        localApi.state !== 'RUNNING')) ||
    (mode === 'disabled' &&
      (localApi.address !== null || localApi.family !== null || localApi.state !== 'DISABLED'))
  ) {
    throw new Error('Electron smoke report did not satisfy the Issue 011 contract.');
  }
}
