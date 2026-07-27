import { connect } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import { LOCAL_API_MAX_JSON_BODY_BYTES } from '../packages/local-api/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import {
  cleanupLocalApiContexts,
  createLocalApiContext,
  localApiRequest,
  randomRuntimeToken,
  startTestPairing,
} from './support/local-api-test-utils.js';

function errorCode(body: string): string | undefined {
  return (JSON.parse(body) as { readonly code?: string }).code;
}

async function rawHttp(port: number, payload: string): Promise<string> {
  return new Promise<string>((resolveSocket, rejectSocket) => {
    const socket = connect({ host: '127.0.0.1', port }, () => socket.end(payload));
    const chunks: Buffer[] = [];
    socket.on('data', (chunk: Buffer) => chunks.push(chunk));
    socket.once('error', rejectSocket);
    socket.once('close', () => resolveSocket(Buffer.concat(chunks).toString('utf8')));
  });
}

afterEach(async () => {
  await cleanupLocalApiContexts();
  cleanTemporaryDatabases();
});

describe('local API route allowlist and request limits', () => {
  it('exposes only the three application targets and returns a limited 404 otherwise', async () => {
    const context = await createLocalApiContext();
    for (const path of ['/v1/clips', '/generate', '/v1/jobs', '/favicon.ico']) {
      const response = await localApiRequest(context.port, {
        origin: context.origin,
        path,
      });
      expect(response.status).toBe(404);
      expect(errorCode(response.body)).toBe('LOCAL_API_NOT_FOUND');
      expect(response.body).not.toContain(path);
    }
  });

  it.each(['/v1/status?x=1', '/v1/status#fragment', 'http://example.test/v1/status'])(
    'rejects an ambiguous request-target: %s',
    async (path) => {
      const context = await createLocalApiContext();
      const response = await localApiRequest(context.port, {
        origin: context.origin,
        path,
      });
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('LOCAL_API_INVALID_REQUEST');
    },
  );

  it('returns 405 with an exact Allow value for a wrong method', async () => {
    const context = await createLocalApiContext();
    const response = await localApiRequest(context.port, {
      method: 'POST',
      origin: context.origin,
      path: '/v1/status',
    });
    expect(response.status).toBe(405);
    expect(response.headers.allow).toBe('OPTIONS, GET');
    expect(errorCode(response.body)).toBe('LOCAL_API_METHOD_NOT_ALLOWED');
  });

  it('rejects GET and OPTIONS bodies', async () => {
    const context = await createLocalApiContext();
    const get = await localApiRequest(context.port, {
      body: '{}',
      origin: context.origin,
      path: '/v1/status',
    });
    const options = await localApiRequest(context.port, {
      body: '{}',
      headers: {
        'Access-Control-Request-Headers': 'authorization',
        'Access-Control-Request-Method': 'GET',
      },
      method: 'OPTIONS',
      origin: context.origin,
      path: '/v1/status',
    });
    expect(get.status).toBe(400);
    expect(options.status).toBe(400);
  });

  it('requires exact application/json and a non-empty pairing body', async () => {
    const context = await createLocalApiContext();
    startTestPairing(context);
    const noBody = await localApiRequest(context.port, {
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
      origin: context.origin,
      path: '/v1/pairings/exchange',
    });
    const charset = await localApiRequest(context.port, {
      body: '{}',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      method: 'POST',
      origin: context.origin,
      path: '/v1/pairings/exchange',
    });
    expect(noBody.status).toBe(400);
    expect(charset.status).toBe(400);
    expect(errorCode(noBody.body)).toBe('LOCAL_API_INVALID_JSON');
    expect(errorCode(charset.body)).toBe('LOCAL_API_INVALID_REQUEST');
  });

  it.each([
    Buffer.from([0xef, 0xbb, 0xbf, 0x7b, 0x7d]),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('{not-json', 'utf8'),
    Buffer.from('[]', 'utf8'),
  ])('rejects BOM, invalid UTF-8, malformed JSON, and non-object JSON', async (body) => {
    const context = await createLocalApiContext();
    startTestPairing(context);
    const response = await localApiRequest(context.port, {
      body,
      method: 'POST',
      origin: context.origin,
      path: '/v1/pairings/exchange',
    });
    expect(response.status).toBe(400);
    expect(errorCode(response.body)).toBe('LOCAL_API_INVALID_JSON');
  });

  it('rejects extra fields, nested values, arrays, and overlong labels', async () => {
    const context = await createLocalApiContext();
    startTestPairing(context);
    const base = {
      clientToken: randomRuntimeToken(),
      extensionOrigin: context.origin,
      pairingCode: randomRuntimeToken(),
    };
    const invalidValues = [
      { ...base, extra: true },
      { ...base, clientLabel: { nested: true } },
      { ...base, clientLabel: [] },
      { ...base, clientLabel: 'x'.repeat(121) },
    ];
    for (const value of invalidValues) {
      const response = await localApiRequest(context.port, {
        body: JSON.stringify(value),
        method: 'POST',
        origin: context.origin,
        path: '/v1/pairings/exchange',
      });
      expect(response.status).toBe(400);
      expect(errorCode(response.body)).toBe('LOCAL_API_INVALID_JSON');
    }
  });

  it('counts streamed bytes and returns 413 above 8 KiB', async () => {
    const context = await createLocalApiContext();
    startTestPairing(context);
    const response = await localApiRequest(context.port, {
      body: 'x'.repeat(LOCAL_API_MAX_JSON_BODY_BYTES + 1),
      method: 'POST',
      origin: context.origin,
      path: '/v1/pairings/exchange',
    });
    expect(response.status).toBe(413);
    expect(errorCode(response.body)).toBe('LOCAL_API_BODY_TOO_LARGE');
    expect(response.body.length).toBeLessThan(16 * 1_024);
  });

  it('rejects duplicate Content-Length at the native parser boundary', async () => {
    const context = await createLocalApiContext();
    const response = await rawHttp(
      context.port,
      [
        'POST /v1/pairings/exchange HTTP/1.1',
        `Host: 127.0.0.1:${context.port}`,
        `Origin: ${context.origin}`,
        'Content-Type: application/json',
        'Content-Length: 2',
        'Content-Length: 3',
        '',
        '{}',
      ].join('\r\n'),
    );
    expect(response).toMatch(/^HTTP\/1\.1 400 Bad Request/mu);
  });

  it('rejects CONNECT and Upgrade without enabling WebSocket or HTTP/2', async () => {
    const context = await createLocalApiContext();
    const connectResponse = await rawHttp(
      context.port,
      [
        'CONNECT example.test:443 HTTP/1.1',
        `Host: 127.0.0.1:${context.port}`,
        `Origin: ${context.origin}`,
        '',
        '',
      ].join('\r\n'),
    );
    const upgradeResponse = await rawHttp(
      context.port,
      [
        'GET /v1/status HTTP/1.1',
        `Host: 127.0.0.1:${context.port}`,
        `Origin: ${context.origin}`,
        'Connection: Upgrade',
        'Upgrade: websocket',
        '',
        '',
      ].join('\r\n'),
    );
    expect(connectResponse).toMatch(/^HTTP\/1\.1 400 Bad Request/mu);
    expect(upgradeResponse).toMatch(/^HTTP\/1\.1 400 Bad Request/mu);
  });

  it('bounds oversized headers at 16 KiB', async () => {
    const context = await createLocalApiContext();
    const response = await rawHttp(
      context.port,
      [
        'GET /v1/status HTTP/1.1',
        `Host: 127.0.0.1:${context.port}`,
        `Origin: ${context.origin}`,
        `X-Oversized: ${'x'.repeat(17 * 1_024)}`,
        '',
        '',
      ].join('\r\n'),
    );
    expect(response).toMatch(/^HTTP\/1\.1 431 Request Header Fields Too Large/mu);
  });

  it('adds bounded no-store security headers to JSON responses', async () => {
    const context = await createLocalApiContext();
    const response = await localApiRequest(context.port, { origin: context.origin });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers.pragma).toBe('no-cache');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['content-security-policy']).toBe("default-src 'none'");
    expect(Number(response.headers['content-length'])).toBeLessThanOrEqual(16 * 1_024);
  });
});
