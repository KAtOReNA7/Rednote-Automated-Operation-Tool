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
