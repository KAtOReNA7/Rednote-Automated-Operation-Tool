import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

interface SocketConnection {
  readonly LocalAddress: string;
  readonly LocalPort: number;
  readonly OwningProcess: number;
  readonly RemoteAddress: string;
  readonly RemotePort: number;
  readonly State: 'Established' | 'Listen';
}

interface SocketSnapshot {
  readonly connections: readonly SocketConnection[];
  readonly processIds: readonly number[];
}

interface SmokeProcessCollector {
  readonly acceptChunk: (chunk: string | Uint8Array) => void;
  readonly attachStream: (stream: NodeJS.ReadableStream | null) => Promise<void>;
  readonly finish: (requiredStages?: readonly string[]) => readonly number[];
  readonly waitForStages: (
    requiredStages?: readonly string[],
    timeoutMilliseconds?: number,
  ) => Promise<readonly number[]>;
}

interface SmokeSupport {
  readonly assertProcessesExited: (
    processIds: readonly number[],
    options?: {
      readonly deadlineMilliseconds?: number;
      readonly isProcessAlive?: (processId: number) => boolean | Promise<boolean>;
      readonly now?: () => number;
      readonly pollMilliseconds?: number;
      readonly wait?: (milliseconds: number) => Promise<void>;
    },
  ) => Promise<void>;
  readonly createSmokeProcessCollector: (
    rootProcessId: number,
    limits?: {
      readonly maxProcessCount?: number;
      readonly maxSampleBytes?: number;
      readonly maxSamples?: number;
    },
  ) => SmokeProcessCollector;
  readonly inspectControlledProcesses: (
    processIds: readonly number[],
    commandRunner: (
      stage: string,
      executable: string,
      arguments_: readonly string[],
      timeoutMilliseconds: number,
    ) => Promise<string>,
  ) => Promise<SocketSnapshot>;
  readonly parseNetstatTcpOutput: (output: string) => readonly SocketConnection[];
  readonly assertSocketSnapshot: (
    snapshot: SocketSnapshot,
    mode: 'disabled' | 'enabled',
    expectedPort: number,
    capabilityPort: number,
  ) => {
    readonly capabilityConnections: number;
    readonly externalConnections: number;
    readonly listeners: number;
  };
}

const projectRoot = process.cwd();

async function loadSmokeSupport(): Promise<SmokeSupport> {
  const moduleUrl = pathToFileURL(join(projectRoot, 'scripts', 'issue011-smoke-support.mjs')).href;
  return (await import(moduleUrl)) as SmokeSupport;
}

function connection(
  localPort: number,
  remotePort: number,
  state: SocketConnection['State'] = 'Established',
): SocketConnection {
  return {
    LocalAddress: '127.0.0.1',
    LocalPort: localPort,
    OwningProcess: 42,
    RemoteAddress: '127.0.0.1',
    RemotePort: remotePort,
    State: state,
  };
}

function processSample(
  stage: 'before-exit' | 'capability-validated' | 'ready',
  processes: ReadonlyArray<{ readonly pid: number; readonly type: string }>,
  truncated = false,
): string {
  return `__REDNOTE_SMOKE_PROCESS_SAMPLE__:${JSON.stringify({ processes, stage, truncated })}\n`;
}

describe('Electron smoke socket evidence', () => {
  it('strictly parses active Windows netstat TCP rows including IPv6 without accepting malformed rows', async () => {
    const { parseNetstatTcpOutput } = await loadSmokeSupport();
    const output = `
      Active Connections
      Proto  Local Address          Foreign Address        State           PID
      TCP    127.0.0.1:43119        0.0.0.0:0              LISTENING       42
      TCP    [::1]:61001            [::1]:51001            ESTABLISHED     43
      TCP    127.0.0.1:61002        127.0.0.1:51002        TIME_WAIT       0
    `;

    expect(parseNetstatTcpOutput(output)).toEqual([
      {
        LocalAddress: '127.0.0.1',
        LocalPort: 43_119,
        OwningProcess: 42,
        RemoteAddress: '0.0.0.0',
        RemotePort: 0,
        State: 'Listen',
      },
      {
        LocalAddress: '::1',
        LocalPort: 61_001,
        OwningProcess: 43,
        RemoteAddress: '::1',
        RemotePort: 51_001,
        State: 'Established',
      },
    ]);
    expect(() => parseNetstatTcpOutput('TCP malformed')).toThrow(/unparseable TCP row/u);
  });

  it('collects a deterministic PID union across required smoke stages and deduplicates repeats', async () => {
    const { createSmokeProcessCollector } = await loadSmokeSupport();
    const collector = createSmokeProcessCollector(42);
    const stdout = new PassThrough();
    const stdoutEnded = collector.attachStream(stdout);

    stdout.write(
      processSample('ready', [
        { pid: 42, type: 'Browser' },
        { pid: 42, type: 'Browser' },
      ]),
    );
    stdout.write(
      processSample('capability-validated', [
        { pid: 42, type: 'Browser' },
        { pid: 43, type: 'Tab' },
      ]),
    );
    await expect(collector.waitForStages()).resolves.toEqual([42, 43]);
    stdout.end(
      processSample('before-exit', [
        { pid: 43, type: 'Tab' },
        { pid: 44, type: 'GPU' },
      ]),
    );
    await stdoutEnded;

    expect(collector.finish()).toEqual([42, 43, 44]);
  });

  it('fails closed for invalid, truncated, conflicting, and over-limit PID samples', async () => {
    const { createSmokeProcessCollector } = await loadSmokeSupport();

    const invalid = createSmokeProcessCollector(42);
    invalid.acceptChunk(processSample('ready', [{ pid: 0, type: 'Browser' }]));
    expect(() => invalid.finish([])).toThrow(/invalid process entry/u);

    const truncated = createSmokeProcessCollector(42);
    truncated.acceptChunk(processSample('ready', [{ pid: 42, type: 'Browser' }], true));
    expect(() => truncated.finish([])).toThrow(/invalid or truncated/u);

    const conflicting = createSmokeProcessCollector(42);
    conflicting.acceptChunk(processSample('ready', [{ pid: 42, type: 'Browser' }]));
    conflicting.acceptChunk(processSample('capability-validated', [{ pid: 42, type: 'GPU' }]));
    expect(() => conflicting.finish([])).toThrow(/changed the type/u);

    const overLimit = createSmokeProcessCollector(42, { maxProcessCount: 2 });
    overLimit.acceptChunk(
      processSample('ready', [
        { pid: 42, type: 'Browser' },
        { pid: 43, type: 'Tab' },
        { pid: 44, type: 'GPU' },
      ]),
    );
    expect(() => overLimit.finish([])).toThrow(/invalid or truncated/u);
  });

  it('uses only bounded netstat observation and filters it by the controlled PID list', async () => {
    const { inspectControlledProcesses } = await loadSmokeSupport();
    const calls: Array<{
      readonly arguments_: readonly string[];
      readonly executable: string;
      readonly stage: string;
      readonly timeoutMilliseconds: number;
    }> = [];
    const snapshot = await inspectControlledProcesses(
      [42, 43],
      async (stage, executable, arguments_, timeoutMilliseconds) => {
        calls.push({ arguments_, executable, stage, timeoutMilliseconds });
        return [
          'TCP 127.0.0.1:43119 0.0.0.0:0 LISTENING 43',
          'TCP 127.0.0.1:43120 0.0.0.0:0 LISTENING 99',
        ].join('\n');
      },
    );

    expect(snapshot).toEqual({
      connections: [
        {
          LocalAddress: '127.0.0.1',
          LocalPort: 43_119,
          OwningProcess: 43,
          RemoteAddress: '0.0.0.0',
          RemotePort: 0,
          State: 'Listen',
        },
      ],
      processIds: [42, 43],
    });
    expect(
      calls.map(({ executable, stage, timeoutMilliseconds }) => ({
        executable,
        stage,
        timeoutMilliseconds,
      })),
    ).toEqual([{ executable: 'netstat.exe', stage: 'tcp-snapshot', timeoutMilliseconds: 2_000 }]);
    expect(calls[0]?.arguments_).toEqual(['-ano', '-p', 'tcp']);
  });

  it('fails closed when the TCP observation command fails', async () => {
    const { inspectControlledProcesses } = await loadSmokeSupport();

    await expect(
      inspectControlledProcesses([42], async () => {
        throw new Error('TCP_SNAPSHOT_FAILED');
      }),
    ).rejects.toThrow('TCP_SNAPSHOT_FAILED');
  });

  it('polls controlled PIDs to normal exit and rejects a PID that survives the deadline', async () => {
    const { assertProcessesExited } = await loadSmokeSupport();
    let clock = 0;

    await expect(
      assertProcessesExited([42, 43], {
        deadlineMilliseconds: 30,
        isProcessAlive: (processId) => processId === 43 && clock < 10,
        now: () => clock,
        pollMilliseconds: 10,
        wait: async (milliseconds) => {
          clock += milliseconds;
        },
      }),
    ).resolves.toBeUndefined();

    clock = 0;
    await expect(
      assertProcessesExited([42], {
        deadlineMilliseconds: 20,
        isProcessAlive: () => true,
        now: () => clock,
        pollMilliseconds: 10,
        wait: async (milliseconds) => {
          clock += milliseconds;
        },
      }),
    ).rejects.toThrow(/controlled residual process/u);
  });

  it('fails closed when controlled PID existence cannot be queried', async () => {
    const { assertProcessesExited } = await loadSmokeSupport();

    await expect(
      assertProcessesExited([42], {
        deadlineMilliseconds: 20,
        isProcessAlive: () => {
          throw new Error('PID_QUERY_FAILED');
        },
        pollMilliseconds: 10,
      }),
    ).rejects.toThrow(/existence query failed/u);
  });

  it('accepts both halves of an in-flight request on the exact configured local API port', async () => {
    const { assertSocketSnapshot } = await loadSmokeSupport();
    const expectedPort = 43_119;
    const clientPort = 61_001;
    const capabilityPort = 51_001;

    expect(
      assertSocketSnapshot(
        {
          connections: [
            connection(expectedPort, 0, 'Listen'),
            connection(clientPort, expectedPort),
            connection(expectedPort, clientPort),
            connection(61_002, capabilityPort),
          ],
          processIds: [42],
        },
        'enabled',
        expectedPort,
        capabilityPort,
      ),
    ).toEqual({
      capabilityConnections: 1,
      externalConnections: 0,
      listeners: 1,
    });
  });

  it('still rejects a loopback connection unrelated to either approved smoke port in both modes', async () => {
    const { assertSocketSnapshot } = await loadSmokeSupport();

    for (const mode of ['disabled', 'enabled'] as const) {
      expect(() =>
        assertSocketSnapshot(
          {
            connections: [
              ...(mode === 'enabled' ? [connection(43_119, 0, 'Listen')] : []),
              connection(61_003, 61_004),
            ],
            processIds: [42],
          },
          mode,
          43_119,
          51_001,
        ),
      ).toThrow(/unexpected loopback connection/u);
    }
  });

  it('rejects an external connection even when its local port matches the configured listener', async () => {
    const { assertSocketSnapshot } = await loadSmokeSupport();
    const externalConnection: SocketConnection = {
      ...connection(43_119, 61_005),
      RemoteAddress: '203.0.113.10',
    };

    expect(() =>
      assertSocketSnapshot(
        {
          connections: [connection(43_119, 0, 'Listen'), externalConnection],
          processIds: [42],
        },
        'enabled',
        43_119,
        51_001,
      ),
    ).toThrow(/external TCP connection/u);
  });
});
