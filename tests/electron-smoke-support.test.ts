import { join } from 'node:path';
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

interface SmokeSupport {
  readonly inspectProcessTree: (
    rootProcessId: number,
    commandRunner: (
      stage: string,
      executable: string,
      arguments_: readonly string[],
      timeoutMilliseconds: number,
    ) => Promise<string>,
  ) => Promise<SocketSnapshot>;
  readonly parseNetstatTcpOutput: (output: string) => readonly SocketConnection[];
  readonly parseProcessTreeOutput: (output: string, rootProcessId: number) => readonly number[];
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

  it('rejects invalid process-tree output instead of treating it as an empty observation', async () => {
    const { parseProcessTreeOutput } = await loadSmokeSupport();

    expect(parseProcessTreeOutput('{"processIds":[42,43]}', 42)).toEqual([42, 43]);
    expect(() => parseProcessTreeOutput('{"processIds":[43]}', 42)).toThrow(
      /invalid process identifiers/u,
    );
    expect(() => parseProcessTreeOutput('{"processIds":[]}', 42)).toThrow(
      /invalid process identifiers/u,
    );
  });

  it('uses independently bounded targeted process and netstat observations then filters by owned PID', async () => {
    const { inspectProcessTree } = await loadSmokeSupport();
    const calls: Array<{
      readonly arguments_: readonly string[];
      readonly executable: string;
      readonly stage: string;
      readonly timeoutMilliseconds: number;
    }> = [];
    const snapshot = await inspectProcessTree(
      42,
      async (stage, executable, arguments_, timeoutMilliseconds) => {
        calls.push({ arguments_, executable, stage, timeoutMilliseconds });
        if (stage === 'process-tree-query') {
          return '{"processIds":[42,43]}';
        }
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
    ).toEqual([
      {
        executable: 'powershell.exe',
        stage: 'process-tree-query',
        timeoutMilliseconds: 3_000,
      },
      { executable: 'netstat.exe', stage: 'tcp-snapshot', timeoutMilliseconds: 2_000 },
    ]);
    expect(calls[0]?.arguments_.at(-1)).toMatch(/-Filter \$filter/u);
  });

  it('fails closed when either observation command fails', async () => {
    const { inspectProcessTree } = await loadSmokeSupport();

    await expect(
      inspectProcessTree(42, async (stage) => {
        if (stage === 'process-tree-query') {
          return '{"processIds":[42]}';
        }
        throw new Error('TCP_SNAPSHOT_FAILED');
      }),
    ).rejects.toThrow('TCP_SNAPSHOT_FAILED');
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
