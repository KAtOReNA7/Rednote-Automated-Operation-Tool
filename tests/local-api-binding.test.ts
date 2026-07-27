import { createServer } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { DesktopLocalApiRuntime } from '../apps/desktop/src/local-api-runtime.js';
import { SqliteLocalApiRepository } from '../packages/db/src/index.js';
import {
  LOCAL_API_HOST,
  LOCAL_API_SERVER_LIMITS,
  LocalApiServer,
} from '../packages/local-api/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  allocateLocalApiPort,
  cleanupLocalApiContexts,
  createLocalApiContext,
} from './support/local-api-test-utils.js';

const databases: DatabaseSync[] = [];
const runtimes: DesktopLocalApiRuntime[] = [];

afterEach(async () => {
  for (const runtime of runtimes.splice(0)) {
    await runtime.close();
  }
  await cleanupLocalApiContexts();
  for (const database of databases.splice(0)) {
    database.close();
  }
  cleanTemporaryDatabases();
});

describe('local API IPv4 loopback binding', () => {
  it('binds a real node:http listener to exactly 127.0.0.1 and the configured port', async () => {
    const context = await createLocalApiContext();
    expect(context.server.listener).toMatchObject({
      address: LOCAL_API_HOST,
      family: 'IPv4',
      port: context.port,
    });
  });

  it('uses explicit finite header, request, socket, connection, and backlog limits', () => {
    expect(LOCAL_API_SERVER_LIMITS).toEqual({
      backlog: 32,
      headersTimeout: 5_000,
      keepAliveTimeout: 2_000,
      maxConnections: 32,
      maxHeaderSize: 16 * 1_024,
      maxHeadersCount: 32,
      maxRequestsPerSocket: 100,
      requestTimeout: 10_000,
      socketTimeout: 10_000,
    });
  });

  it('is disabled by default after a project is attached', async () => {
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const runtime = new DesktopLocalApiRuntime();
    runtimes.push(runtime);
    await runtime.attachProject(database);
    expect(runtime.getStatus()).toMatchObject({
      activeClientCount: 0,
      enabled: false,
      endpoint: null,
      port: 43_119,
      projectReady: true,
      revision: 0,
      state: 'DISABLED',
    });
  });

  it('never listens without a ProjectDataRoot database', () => {
    const runtime = new DesktopLocalApiRuntime();
    runtimes.push(runtime);
    expect(runtime.getStatus()).toEqual({
      activeClientCount: 0,
      enabled: false,
      endpoint: null,
      port: 43_119,
      projectReady: false,
      revision: 0,
      state: 'DISABLED_NO_PROJECT',
    });
    expect(() => runtime.startPairing(1)).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_DISABLED' }),
    );
  });

  it('reports a stable port-in-use error without scanning or persisting another port', async () => {
    const occupiedPort = await allocateLocalApiPort();
    const occupant = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      occupant.once('error', rejectListen);
      occupant.listen({ host: '127.0.0.1', port: occupiedPort }, resolveListen);
    });
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const runtime = new DesktopLocalApiRuntime();
    runtimes.push(runtime);
    await runtime.attachProject(database);
    try {
      await expect(
        runtime.updateSettings({
          enabled: true,
          expectedRevision: 0,
          port: occupiedPort,
        }),
      ).rejects.toMatchObject({ code: 'LOCAL_API_PORT_IN_USE', retryable: true });
      expect(runtime.getStatus()).toMatchObject({
        enabled: false,
        endpoint: null,
        port: 43_119,
        revision: 0,
        state: 'DISABLED',
      });
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        occupant.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
      });
    }
  });

  it('refuses invalid ports before attempting a bind', async () => {
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const repository = new SqliteLocalApiRepository(database);
    for (const port of [0, 1_023, 65_536, 1.5]) {
      expect(() => new LocalApiServer({ port, repository })).toThrow(
        expect.objectContaining({ code: 'LOCAL_API_INVALID_REQUEST' }),
      );
    }
  });
});
