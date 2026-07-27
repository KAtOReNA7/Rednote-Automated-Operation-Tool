import { execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { readFile } from 'node:fs/promises';

function delay(milliseconds) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}

function powershell(command) {
  return new Promise((resolveCommand, rejectCommand) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', command],
      { timeout: 15_000, windowsHide: true },
      (error, stdout) => {
        if (error !== null) {
          rejectCommand(error);
          return;
        }
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

export async function inspectProcessTree(rootProcessId) {
  const output = await powershell(`
    $processIds = [System.Collections.Generic.HashSet[int]]::new()
    [void]$processIds.Add(${rootProcessId})
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
    } | Select-Object LocalAddress, LocalPort, RemoteAddress, RemotePort,
      @{Name='State';Expression={$_.State.ToString()}}, OwningProcess)
    [pscustomobject]@{
      processIds = @($processIds)
      connections = @($connections)
    } | ConvertTo-Json -Compress -Depth 5
  `);
  const parsed = JSON.parse(output);
  return {
    connections: Array.isArray(parsed.connections)
      ? parsed.connections
      : parsed.connections === null || parsed.connections === undefined
        ? []
        : [parsed.connections],
    processIds: Array.isArray(parsed.processIds) ? parsed.processIds : [parsed.processIds],
  };
}

export function assertSocketSnapshot(snapshot, mode, expectedPort) {
  const listeners = snapshot.connections.filter((connection) => connection.State === 'Listen');
  const externalConnections = snapshot.connections.filter(
    (connection) =>
      connection.State !== 'Listen' &&
      !['127.0.0.1', '::1', '0:0:0:0:0:0:0:1'].includes(connection.RemoteAddress),
  );
  if (externalConnections.length !== 0) {
    throw new Error(
      `Electron smoke opened an external TCP connection: ${JSON.stringify(externalConnections)}`,
    );
  }
  if (mode === 'disabled') {
    if (snapshot.connections.length !== 0) {
      throw new Error('Disabled Electron smoke unexpectedly owned a TCP socket.');
    }
    return { externalConnections: 0, listeners: 0 };
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
  return { externalConnections: 0, listeners: 1 };
}

export async function assertProcessesExited(processIds) {
  const ids = processIds.map((value) => Number(value)).filter(Number.isSafeInteger);
  await delay(300);
  const remaining = await powershell(`
    $ids = @(${ids.join(',')})
    [Console]::Out.Write(@(Get-Process -Id $ids -ErrorAction SilentlyContinue).Count)
  `);
  if (Number.parseInt(remaining, 10) !== 0) {
    throw new Error('Electron smoke left a residual process.');
  }
}

export async function assertPortReleased(port) {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen({ host: '127.0.0.1', port }, resolveListen);
  });
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
  });
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
    report.settings?.secretEgressSafeCount !== 30 ||
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
