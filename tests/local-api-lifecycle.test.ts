import { connect, createServer } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { DesktopLocalApiRuntime } from '../apps/desktop/src/local-api-runtime.js';
import { SqliteLocalApiRepository } from '../packages/db/src/index.js';
import { LocalApiServer } from '../packages/local-api/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  allocateLocalApiPort,
  cleanupLocalApiContexts,
  localApiRequest,
} from './support/local-api-test-utils.js';

const databases: DatabaseSync[] = [];
const runtimes: DesktopLocalApiRuntime[] = [];

async function canBind(port: number): Promise<boolean> {
  const server = createServer();
  try {
    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen({ host: '127.0.0.1', port }, resolveListen);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) {
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    }
  }
}

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

describe('local API lifecycle', () => {
  it('enables, enters RUNNING, disables, and releases the exact port', async () => {
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const runtime = new DesktopLocalApiRuntime();
    runtimes.push(runtime);
    await runtime.attachProject(database);
    const port = await allocateLocalApiPort();
    const enabled = await runtime.updateSettings({
      enabled: true,
      expectedRevision: 0,
      port,
    });
    expect(enabled).toMatchObject({
      enabled: true,
      endpoint: `http://127.0.0.1:${port}`,
      state: 'RUNNING',
    });
    expect(await canBind(port)).toBe(false);
    const disabled = await runtime.updateSettings({
      enabled: false,
      expectedRevision: enabled.revision,
      port,
    });
    expect(disabled).toMatchObject({ enabled: false, endpoint: null, state: 'DISABLED' });
    expect(await canBind(port)).toBe(true);
  });

  it('switches configured ports and releases the previous listener', async () => {
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const runtime = new DesktopLocalApiRuntime();
    runtimes.push(runtime);
    await runtime.attachProject(database);
    const firstPort = await allocateLocalApiPort();
    const secondPort = await allocateLocalApiPort();
    const first = await runtime.updateSettings({
      enabled: true,
      expectedRevision: 0,
      port: firstPort,
    });
    const second = await runtime.updateSettings({
      enabled: true,
      expectedRevision: first.revision,
      port: secondPort,
    });
    expect(second.endpoint).toBe(`http://127.0.0.1:${secondPort}`);
    expect(await canBind(firstPort)).toBe(true);
    expect(await canBind(secondPort)).toBe(false);
  });

  it('restores the previous listener if port-setting persistence fails', async () => {
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const runtime = new DesktopLocalApiRuntime();
    runtimes.push(runtime);
    await runtime.attachProject(database);
    const firstPort = await allocateLocalApiPort();
    const secondPort = await allocateLocalApiPort();
    const first = await runtime.updateSettings({
      enabled: true,
      expectedRevision: 0,
      port: firstPort,
    });
    database.exec(`
      CREATE TRIGGER fail_issue011_settings_update
      BEFORE UPDATE ON local_api_settings
      BEGIN
        SELECT RAISE(ABORT, 'synthetic local API persistence failure');
      END;
    `);
    await expect(
      runtime.updateSettings({
        enabled: true,
        expectedRevision: first.revision,
        port: secondPort,
      }),
    ).rejects.toThrow(/synthetic local API persistence failure/iu);
    expect(runtime.getStatus()).toMatchObject({
      enabled: true,
      endpoint: `http://127.0.0.1:${firstPort}`,
      port: firstPort,
      state: 'RUNNING',
    });
    expect(await canBind(firstPort)).toBe(false);
    expect(await canBind(secondPort)).toBe(true);
  });

  it('restarts a persisted enabled listener when a project is attached', async () => {
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const port = await allocateLocalApiPort();
    new SqliteLocalApiRepository(database).updateSettings({
      enabled: true,
      expectedRevision: 0,
      port,
      updatedAt: '2026-07-28T01:00:00.000Z',
    });
    const runtime = new DesktopLocalApiRuntime();
    runtimes.push(runtime);
    await runtime.attachProject(database);
    expect(runtime.getStatus()).toMatchObject({
      enabled: true,
      endpoint: `http://127.0.0.1:${port}`,
      state: 'RUNNING',
    });
  });

  it('reports persisted port conflict on project attach without pretending to run', async () => {
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const port = await allocateLocalApiPort();
    new SqliteLocalApiRepository(database).updateSettings({
      enabled: true,
      expectedRevision: 0,
      port,
      updatedAt: '2026-07-28T01:00:00.000Z',
    });
    const occupant = createServer();
    await new Promise<void>((resolveListen, rejectListen) => {
      occupant.once('error', rejectListen);
      occupant.listen({ host: '127.0.0.1', port }, resolveListen);
    });
    const runtime = new DesktopLocalApiRuntime();
    runtimes.push(runtime);
    try {
      await runtime.attachProject(database);
      expect(runtime.getStatus()).toMatchObject({
        enabled: true,
        endpoint: null,
        errorCode: 'LOCAL_API_PORT_IN_USE',
        state: 'PORT_IN_USE',
      });
    } finally {
      await new Promise<void>((resolveClose) => occupant.close(() => resolveClose()));
    }
  });

  it('cancels pairing and closes idle and active sockets on shutdown', async () => {
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const repository = new SqliteLocalApiRepository(database);
    const port = await allocateLocalApiPort();
    const server = new LocalApiServer({
      port,
      repository,
      shutdownTimeoutMilliseconds: 100,
    });
    const listener = await server.start();
    server.pairingSessions.start(listener.listenerInstanceId, port, 1);
    const socket = connect({ host: '127.0.0.1', port });
    await new Promise<void>((resolveConnect, rejectConnect) => {
      socket.once('connect', resolveConnect);
      socket.once('error', rejectConnect);
    });
    socket.write('GET /v1/status HTTP/1.1\r\n');
    const closed = new Promise<void>((resolveClose) => socket.once('close', resolveClose));
    await server.stop();
    await closed;
    expect(server.pairingSessions.activeCount()).toBe(0);
    expect(await canBind(port)).toBe(true);
    await expect(
      localApiRequest(port, { origin: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' }),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });

  it('detaches a project to DISABLED_NO_PROJECT and releases its listener', async () => {
    const { database } = await createInitializedDatabase();
    databases.push(database);
    const runtime = new DesktopLocalApiRuntime();
    runtimes.push(runtime);
    await runtime.attachProject(database);
    const port = await allocateLocalApiPort();
    await runtime.updateSettings({ enabled: true, expectedRevision: 0, port });
    await runtime.detachProject();
    expect(runtime.getStatus()).toMatchObject({
      enabled: false,
      endpoint: null,
      projectReady: false,
      state: 'DISABLED_NO_PROJECT',
    });
    expect(await canBind(port)).toBe(true);
  });
});
