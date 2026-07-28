import { randomBytes } from 'node:crypto';
import { request } from 'node:http';

import type { DesktopSettingsRuntime } from './settings-runtime.js';

interface HttpResult {
  readonly body: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly status: number;
}

export interface LocalApiSmokeReport {
  readonly address: '127.0.0.1' | null;
  readonly enabled: boolean;
  readonly family: 'IPv4' | null;
  readonly hostRejected: boolean;
  readonly mode: 'disabled' | 'enabled';
  readonly originRejectedWithoutAcao: boolean;
  readonly oversizedBodyRejected: boolean;
  readonly pairingAuthRotationRevoke: boolean;
  readonly port: number;
  readonly preflight: boolean;
  readonly state: string;
}

function runtimeValue(): string {
  return randomBytes(32).toString('base64url');
}

function extensionOrigin(): string {
  const alphabet = 'abcdefghijklmnop';
  const id = randomBytes(16)
    .toString('hex')
    .replace(/[0-9a-f]/gu, (character) => alphabet[Number.parseInt(character, 16)] ?? 'a');
  return `chrome-extension://${id}`;
}

async function httpRequest(
  port: number,
  options: {
    readonly authorization?: string;
    readonly body?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly hostHeader?: string;
    readonly method: string;
    readonly origin: string;
    readonly path: string;
  },
): Promise<HttpResult> {
  const body = options.body ?? '';
  return new Promise<HttpResult>((resolveRequest, rejectRequest) => {
    const outgoing = request(
      {
        headers: {
          Host: options.hostHeader ?? `127.0.0.1:${port}`,
          Origin: options.origin,
          ...(options.authorization === undefined ? {} : { Authorization: options.authorization }),
          ...(body === ''
            ? {}
            : {
                'Content-Length': String(Buffer.byteLength(body, 'utf8')),
                'Content-Type': 'application/json',
              }),
          ...options.headers,
        },
        host: '127.0.0.1',
        method: options.method,
        path: options.path,
        port,
        timeout: 5_000,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer | string) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        response.once('end', () => {
          resolveRequest({
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
            status: response.statusCode ?? 0,
          });
        });
      },
    );
    outgoing.once('error', rejectRequest);
    outgoing.once('timeout', () => outgoing.destroy(new Error('LOCAL_API_SMOKE_TIMEOUT')));
    if (body !== '') {
      outgoing.write(body);
    }
    outgoing.end();
  });
}

function hasAcao(result: HttpResult): boolean {
  return result.headers['access-control-allow-origin'] !== undefined;
}

function assertSmoke(value: boolean): void {
  if (!value) {
    throw new Error('LOCAL_API_SMOKE_ASSERTION_FAILED');
  }
}

export function disabledLocalApiSmoke(runtime: DesktopSettingsRuntime): LocalApiSmokeReport {
  const status = runtime.getLocalApiStatus();
  assertSmoke(!status.enabled && status.endpoint === null && status.state === 'DISABLED');
  return {
    address: null,
    enabled: false,
    family: null,
    hostRejected: true,
    mode: 'disabled',
    originRejectedWithoutAcao: true,
    oversizedBodyRejected: true,
    pairingAuthRotationRevoke: true,
    port: status.port,
    preflight: true,
    state: status.state,
  };
}

export async function runEnabledLocalApiSmoke(
  runtime: DesktopSettingsRuntime,
  port: number,
  windowId: number,
): Promise<LocalApiSmokeReport> {
  const before = runtime.getLocalApiStatus();
  const started = await runtime.updateLocalApiSettings({
    enabled: true,
    expectedRevision: before.revision,
    port,
  });
  assertSmoke(
    started.enabled &&
      started.endpoint === `http://127.0.0.1:${port}` &&
      started.state === 'RUNNING',
  );

  const origin = extensionOrigin();
  const otherOrigin = extensionOrigin();
  const unauthenticated = await httpRequest(port, {
    method: 'GET',
    origin,
    path: '/v1/status',
  });
  const wrongHost = await httpRequest(port, {
    hostHeader: `localhost:${port}`,
    method: 'GET',
    origin,
    path: '/v1/status',
  });
  assertSmoke(
    unauthenticated.status === 401 &&
      !hasAcao(unauthenticated) &&
      wrongHost.status === 400 &&
      !hasAcao(wrongHost),
  );

  const firstPairing = runtime.startLocalApiPairing(windowId);
  const firstToken = runtimeValue();
  const firstExchange = await httpRequest(port, {
    body: JSON.stringify({
      clientLabel: 'Electron smoke client',
      clientToken: firstToken,
      extensionOrigin: origin,
      pairingCode: firstPairing.pairingCode,
    }),
    method: 'POST',
    origin,
    path: '/v1/pairings/exchange',
  });
  assertSmoke(
    firstExchange.status === 201 &&
      firstExchange.headers['access-control-allow-origin'] === origin &&
      !firstExchange.body.includes(firstToken) &&
      !firstExchange.body.includes(firstPairing.pairingCode),
  );

  const authenticated = await httpRequest(port, {
    authorization: `Bearer ${firstToken}`,
    method: 'GET',
    origin,
    path: '/v1/status',
  });
  const capabilities = await httpRequest(port, {
    authorization: `Bearer ${firstToken}`,
    method: 'GET',
    origin,
    path: '/v1/capabilities',
  });
  const wrongOrigin = await httpRequest(port, {
    authorization: `Bearer ${firstToken}`,
    method: 'GET',
    origin: otherOrigin,
    path: '/v1/status',
  });
  assertSmoke(
    authenticated.status === 200 &&
      capabilities.status === 200 &&
      capabilities.body.includes('"clipperBusinessRoutes":true') &&
      wrongOrigin.status === 401 &&
      !hasAcao(wrongOrigin),
  );

  const validPreflight = await httpRequest(port, {
    headers: {
      'Access-Control-Request-Headers': 'authorization',
      'Access-Control-Request-Method': 'GET',
    },
    method: 'OPTIONS',
    origin,
    path: '/v1/status',
  });
  const invalidPreflight = await httpRequest(port, {
    headers: {
      'Access-Control-Request-Headers': 'x-arbitrary',
      'Access-Control-Request-Method': 'GET',
    },
    method: 'OPTIONS',
    origin,
    path: '/v1/status',
  });
  assertSmoke(
    validPreflight.status === 204 &&
      validPreflight.headers['access-control-allow-origin'] === origin &&
      invalidPreflight.status === 403 &&
      !hasAcao(invalidPreflight),
  );

  const secondPairing = runtime.startLocalApiPairing(windowId);
  const secondToken = runtimeValue();
  const secondExchange = await httpRequest(port, {
    body: JSON.stringify({
      clientLabel: 'Electron smoke client rotated',
      clientToken: secondToken,
      extensionOrigin: origin,
      pairingCode: secondPairing.pairingCode,
    }),
    method: 'POST',
    origin,
    path: '/v1/pairings/exchange',
  });
  const oldToken = await httpRequest(port, {
    authorization: `Bearer ${firstToken}`,
    method: 'GET',
    origin,
    path: '/v1/status',
  });
  const newToken = await httpRequest(port, {
    authorization: `Bearer ${secondToken}`,
    method: 'GET',
    origin,
    path: '/v1/status',
  });
  assertSmoke(secondExchange.status === 201 && oldToken.status === 401 && newToken.status === 200);

  const activeClient = runtime
    .listLocalApiClients()
    .find((client) => client.extensionOrigin === origin && client.status === 'ACTIVE');
  assertSmoke(activeClient !== undefined);
  runtime.revokeLocalApiClient(
    activeClient?.id ?? '',
    activeClient?.revision ?? -1,
    'REVOKE_LOCAL_API_CLIENT',
  );
  const revokedToken = await httpRequest(port, {
    authorization: `Bearer ${secondToken}`,
    method: 'GET',
    origin,
    path: '/v1/status',
  });
  assertSmoke(revokedToken.status === 401 && !hasAcao(revokedToken));

  runtime.startLocalApiPairing(windowId);
  const oversized = await httpRequest(port, {
    body: 'x'.repeat(8 * 1_024 + 1),
    method: 'POST',
    origin,
    path: '/v1/pairings/exchange',
  });
  assertSmoke(oversized.status === 413 && !oversized.body.includes('x'.repeat(128)));

  return {
    address: '127.0.0.1',
    enabled: true,
    family: 'IPv4',
    hostRejected: wrongHost.status === 400 && !hasAcao(wrongHost),
    mode: 'enabled',
    originRejectedWithoutAcao: wrongOrigin.status === 401 && !hasAcao(wrongOrigin),
    oversizedBodyRejected: oversized.status === 413,
    pairingAuthRotationRevoke: revokedToken.status === 401,
    port,
    preflight: validPreflight.status === 204 && invalidPreflight.status === 403,
    state: runtime.getLocalApiStatus().state,
  };
}
