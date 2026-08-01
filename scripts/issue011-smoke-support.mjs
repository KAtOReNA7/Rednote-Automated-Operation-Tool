import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';

const PROCESS_TREE_TIMEOUT_MILLISECONDS = 3_000;
const TCP_SNAPSHOT_TIMEOUT_MILLISECONDS = 2_000;
const PROCESS_EXIT_TIMEOUT_MILLISECONDS = 3_000;
const MAX_PROCESS_TREE_DEPTH = 8;
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

export function parseProcessTreeOutput(output, rootProcessId) {
  const parsed = JSON.parse(output);
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Electron smoke process-tree output was not an object.');
  }
  const rawProcessIds = Array.isArray(parsed.processIds) ? parsed.processIds : [parsed.processIds];
  const processIds = rawProcessIds.map(Number);
  if (
    processIds.length === 0 ||
    processIds.some((value) => !Number.isSafeInteger(value) || value <= 0) ||
    new Set(processIds).size !== processIds.length ||
    !processIds.includes(rootProcessId)
  ) {
    throw new Error('Electron smoke process-tree output contained invalid process identifiers.');
  }
  return processIds;
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

export async function inspectProcessTree(rootProcessId, commandRunner = runBoundedCommand) {
  if (!Number.isSafeInteger(rootProcessId) || rootProcessId <= 0) {
    throw new Error('Electron smoke root process identifier was invalid.');
  }
  const processTreeCommand = `
    $ErrorActionPreference = 'Stop'
    $processIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$processIds.Add(${rootProcessId})
    $frontier = @(${rootProcessId})
    for ($depth = 0; $frontier.Count -gt 0; $depth++) {
      if ($depth -ge ${MAX_PROCESS_TREE_DEPTH}) {
        throw 'PROCESS_TREE_DEPTH_EXCEEDED'
      }
      $filter = @($frontier | ForEach-Object { "ParentProcessId = $($_)" }) -join ' OR '
      $children = @(Get-CimInstance -ClassName Win32_Process -Filter $filter -Property ProcessId, ParentProcessId -OperationTimeoutSec 2 -ErrorAction Stop)
      $next = [System.Collections.Generic.List[int]]::new()
      foreach ($child in $children) {
        $childId = [int]$child.ProcessId
        if ($processIds.Add($childId)) {
          $next.Add($childId)
        }
      }
      $frontier = @($next.ToArray())
    }
    [pscustomobject]@{
      processIds = @($processIds | Sort-Object)
    } | ConvertTo-Json -Compress -Depth 3
  `;
  const observations = await Promise.allSettled([
    commandRunner(
      'process-tree-query',
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', processTreeCommand],
      PROCESS_TREE_TIMEOUT_MILLISECONDS,
    ),
    commandRunner(
      'tcp-snapshot',
      'netstat.exe',
      ['-ano', '-p', 'tcp'],
      TCP_SNAPSHOT_TIMEOUT_MILLISECONDS,
    ),
  ]);
  const failedObservation = observations.find((observation) => observation.status === 'rejected');
  if (failedObservation?.status === 'rejected') {
    throw failedObservation.reason;
  }
  const [processOutput, netstatOutput] = observations;
  if (processOutput.status !== 'fulfilled' || netstatOutput.status !== 'fulfilled') {
    throw new Error('Electron smoke observations did not complete.');
  }
  const parseStartedAt = Date.now();
  const processIds = parseProcessTreeOutput(processOutput.value, rootProcessId);
  const processIdSet = new Set(processIds);
  const connections = parseNetstatTcpOutput(netstatOutput.value).filter((connection) =>
    processIdSet.has(connection.OwningProcess),
  );
  recordObservationStage('snapshot-parse', parseStartedAt, {
    connectionCount: connections.length,
    processCount: processIds.length,
  });
  return {
    connections,
    processIds,
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

export async function assertProcessesExited(processIds) {
  const ids = processIds.map((value) => Number(value)).filter(Number.isSafeInteger);
  const startedAt = Date.now();
  await delay(300);
  const remaining = await runBoundedCommand(
    'residual-process-query',
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `$ids = @(${ids.join(',')}); [Console]::Out.Write(@(Get-Process -Id $ids -ErrorAction SilentlyContinue).Count)`,
    ],
    PROCESS_EXIT_TIMEOUT_MILLISECONDS,
  );
  const remainingCount = Number.parseInt(remaining, 10);
  if (!Number.isSafeInteger(remainingCount) || remainingCount !== 0) {
    recordObservationStage('process-cleanup-check', startedAt, { remainingCount }, 'failed');
    throw new Error('Electron smoke left a residual process.');
  }
  recordObservationStage('process-cleanup-check', startedAt, { remainingCount });
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
