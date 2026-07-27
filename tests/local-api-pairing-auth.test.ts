import { createHash, randomBytes } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import {
  digestRuntimeToken,
  isRuntimeToken,
  LOCAL_API_VERSION,
  PairingSessionManager,
  parseBearerAuthorization,
} from '../packages/local-api/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import {
  cleanupLocalApiContexts,
  createLocalApiContext,
  type LocalApiTestContext,
  localApiRequest,
  pairOverHttp,
  randomExtensionOrigin,
  randomRuntimeToken,
} from './support/local-api-test-utils.js';

function parsed(body: string): Readonly<Record<string, unknown>> {
  return JSON.parse(body) as Readonly<Record<string, unknown>>;
}

function listenerFor(context: LocalApiTestContext) {
  const listener = context.server.listener;
  if (listener === null) {
    throw new Error('Local API listener was not started.');
  }
  return listener;
}

afterEach(async () => {
  await cleanupLocalApiContexts();
  cleanTemporaryDatabases();
});

describe('pairing session invariants', () => {
  it('creates a 32-byte CSPRNG base64url code with an exact 120-second TTL', () => {
    let now = new Date('2026-07-28T01:00:00.000Z');
    const sessions = new PairingSessionManager({ clock: { now: () => now } });
    const pairing = sessions.start('listener-a', 43_119, 7);
    expect(isRuntimeToken(pairing.pairingCode)).toBe(true);
    expect(Buffer.from(pairing.pairingCode, 'base64url')).toHaveLength(32);
    expect(pairing.expiresAt).toBe('2026-07-28T01:02:00.000Z');
    now = new Date('2026-07-28T01:02:00.000Z');
    expect(() => sessions.consume(pairing.pairingCode, 'listener-a', 43_119)).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_PAIRING_EXPIRED' }),
    );
  });

  it('is single-use and bound to listener and port', () => {
    const sessions = new PairingSessionManager();
    const pairing = sessions.start('listener-a', 43_119, 7);
    expect(() => sessions.consume(pairing.pairingCode, 'listener-b', 43_119)).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_PAIRING_NOT_ACTIVE' }),
    );
    expect(() => sessions.consume(pairing.pairingCode, 'listener-a', 43_120)).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_PAIRING_NOT_ACTIVE' }),
    );
    expect(sessions.consume(pairing.pairingCode, 'listener-a', 43_119)).toMatchObject({
      windowId: 7,
    });
    expect(() => sessions.consume(pairing.pairingCode, 'listener-a', 43_119)).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_PAIRING_NOT_ACTIVE' }),
    );
  });

  it('cancels by session/window and clears all sessions for a destroyed window', () => {
    const sessions = new PairingSessionManager();
    const first = sessions.start('listener-a', 43_119, 7);
    const second = sessions.start('listener-a', 43_119, 8);
    expect(() => sessions.cancel(first.pairingSessionId, 8)).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_PAIRING_NOT_ACTIVE' }),
    );
    sessions.clearForWindow(7);
    expect(() => sessions.consume(first.pairingCode, 'listener-a', 43_119)).toThrow();
    expect(sessions.consume(second.pairingCode, 'listener-a', 43_119).windowId).toBe(8);
  });

  it('invalidates a session after five failed attempts', () => {
    const sessions = new PairingSessionManager();
    const pairing = sessions.start('listener-a', 43_119, 7);
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      expect(() => sessions.consume(randomRuntimeToken(), 'listener-a', 43_119)).toThrow(
        expect.objectContaining({ code: 'LOCAL_API_PAIRING_INVALID' }),
      );
    }
    expect(() => sessions.consume(randomRuntimeToken(), 'listener-a', 43_119)).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_PAIRING_ATTEMPTS_EXCEEDED' }),
    );
    expect(() => sessions.consume(pairing.pairingCode, 'listener-a', 43_119)).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_PAIRING_NOT_ACTIVE' }),
    );
  });
});

describe('runtime token authentication', () => {
  it('accepts only one exact Bearer header with a 32-byte random token', () => {
    const token = randomRuntimeToken();
    expect(parseBearerAuthorization([`Bearer ${token}`])).toBe(token);
    for (const headers of [
      [],
      [`bearer ${token}`],
      [`Bearer  ${token}`],
      [`Basic ${token}`],
      [`Bearer ${token}=X`],
      [`Bearer ${token}`, `Bearer ${token}`],
    ]) {
      expect(() => parseBearerAuthorization(headers)).toThrow();
    }
  });

  it('stores the SHA-256 digest representation and never treats it as a runtime token', () => {
    const token = randomRuntimeToken();
    const digest = digestRuntimeToken(token);
    expect(digest).toEqual(createHash('sha256').update(token, 'utf8').digest());
    expect(digest).toHaveLength(32);
    expect(isRuntimeToken(digest.toString('hex'))).toBe(false);
  });

  it('exchanges pairing data without returning token, digest, or pairing code', async () => {
    const context = await createLocalApiContext();
    const listener = listenerFor(context);
    const pairing = context.server.pairingSessions.start(
      listener.listenerInstanceId,
      context.port,
      1,
    );
    const token = randomRuntimeToken();
    const response = await localApiRequest(context.port, {
      body: JSON.stringify({
        clientLabel: '浏览器收藏夹',
        clientToken: token,
        extensionOrigin: context.origin,
        pairingCode: pairing.pairingCode,
      }),
      method: 'POST',
      origin: context.origin,
      path: '/v1/pairings/exchange',
    });
    expect(response.status).toBe(201);
    expect(parsed(response.body)).toMatchObject({
      apiVersion: LOCAL_API_VERSION,
      paired: true,
    });
    expect(response.body).not.toContain(token);
    expect(response.body).not.toContain(pairing.pairingCode);
    expect(response.body).not.toContain(digestRuntimeToken(token).toString('hex'));
  });

  it('requires exact equality between pairing header and body origins', async () => {
    const context = await createLocalApiContext();
    const listener = listenerFor(context);
    const pairing = context.server.pairingSessions.start(
      listener.listenerInstanceId,
      context.port,
      1,
    );
    const response = await localApiRequest(context.port, {
      body: JSON.stringify({
        clientToken: randomRuntimeToken(),
        extensionOrigin: context.origin,
        pairingCode: pairing.pairingCode,
      }),
      method: 'POST',
      origin: randomExtensionOrigin(),
      path: '/v1/pairings/exchange',
    });
    expect(response.status).toBe(403);
    expect(parsed(response.body).code).toBe('LOCAL_API_INVALID_ORIGIN');
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(context.server.pairingSessions.activeCount()).toBe(1);
  });

  it('allows exactly one winner for concurrent use of one pairing code', async () => {
    const context = await createLocalApiContext();
    const listener = listenerFor(context);
    const pairing = context.server.pairingSessions.start(
      listener.listenerInstanceId,
      context.port,
      1,
    );
    const requestBody = () =>
      JSON.stringify({
        clientToken: randomRuntimeToken(),
        extensionOrigin: context.origin,
        pairingCode: pairing.pairingCode,
      });
    const responses = await Promise.all([
      localApiRequest(context.port, {
        body: requestBody(),
        method: 'POST',
        origin: context.origin,
        path: '/v1/pairings/exchange',
      }),
      localApiRequest(context.port, {
        body: requestBody(),
        method: 'POST',
        origin: context.origin,
        path: '/v1/pairings/exchange',
      }),
    ]);
    expect(responses.map(({ status }) => status).sort()).toEqual([201, 401]);
    expect(
      context.repository.listClients().filter(({ status }) => status === 'ACTIVE'),
    ).toHaveLength(1);
  });

  it('authenticates status and capabilities with both origin and token', async () => {
    const context = await createLocalApiContext();
    const paired = await pairOverHttp(context);
    const status = await localApiRequest(context.port, {
      authorization: `Bearer ${paired.token}`,
      origin: paired.origin,
      path: '/v1/status',
    });
    const capabilities = await localApiRequest(context.port, {
      authorization: `Bearer ${paired.token}`,
      origin: paired.origin,
      path: '/v1/capabilities',
    });
    expect(status.status).toBe(200);
    expect(parsed(status.body)).toMatchObject({
      apiVersion: '1',
      clientStatus: 'ACTIVE',
      projectReady: true,
      serviceState: 'RUNNING',
    });
    expect(capabilities.status).toBe(200);
    expect(parsed(capabilities.body)).toMatchObject({
      authenticatedStatus: true,
      clipperBusinessRoutes: false,
      clipperIssue: '017',
      maxJsonBodyBytes: 8_192,
      pairing: true,
      supportedOriginScheme: 'chrome-extension',
    });
  });

  it('returns the same limited 401 for missing, unknown, rotated, and revoked tokens', async () => {
    const context = await createLocalApiContext();
    const first = await pairOverHttp(context);
    const unknown = randomRuntimeToken();
    const missing = await localApiRequest(context.port, { origin: first.origin });
    const unknownResponse = await localApiRequest(context.port, {
      authorization: `Bearer ${unknown}`,
      origin: first.origin,
    });
    const second = await pairOverHttp(context, { origin: first.origin });
    const rotated = await localApiRequest(context.port, {
      authorization: `Bearer ${first.token}`,
      origin: first.origin,
    });
    const active = context.repository
      .listClients()
      .find((client) => client.extensionOrigin === first.origin && client.status === 'ACTIVE');
    if (active === undefined) {
      throw new Error('Active test client was not found.');
    }
    context.repository.revokeClient(active.id, active.revision, '2026-07-28T02:00:00.000Z');
    const revoked = await localApiRequest(context.port, {
      authorization: `Bearer ${second.token}`,
      origin: first.origin,
    });
    const failures = [missing, unknownResponse, rotated, revoked];
    expect(failures.map(({ status }) => status)).toEqual([401, 401, 401, 401]);
    expect(failures.slice(1).map(({ body }) => parsed(body).code)).toEqual([
      'LOCAL_API_AUTH_INVALID',
      'LOCAL_API_AUTH_INVALID',
      'LOCAL_API_AUTH_INVALID',
    ]);
    expect(parsed(missing.body).code).toBe('LOCAL_API_AUTH_REQUIRED');
    expect(failures.every(({ body }) => !body.includes(unknown))).toBe(true);
  });

  it('rejects a ninth distinct active client safely', async () => {
    const context = await createLocalApiContext();
    for (let index = 0; index < 8; index += 1) {
      await pairOverHttp(context, {
        origin: randomExtensionOrigin(),
        windowId: index + 1,
      });
    }
    const ninthOrigin = randomExtensionOrigin();
    const listener = listenerFor(context);
    const pairing = context.server.pairingSessions.start(
      listener.listenerInstanceId,
      context.port,
      20,
    );
    const response = await localApiRequest(context.port, {
      body: JSON.stringify({
        clientToken: randomBytes(32).toString('base64url'),
        extensionOrigin: ninthOrigin,
        pairingCode: pairing.pairingCode,
      }),
      method: 'POST',
      origin: ninthOrigin,
      path: '/v1/pairings/exchange',
    });
    expect(response.status).toBe(409);
    expect(parsed(response.body).code).toBe('LOCAL_API_CLIENT_LIMIT_REACHED');
    expect(
      context.repository.listClients().filter(({ status }) => status === 'ACTIVE'),
    ).toHaveLength(8);
  });
});
