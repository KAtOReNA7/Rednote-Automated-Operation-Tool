import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';

import { afterEach, describe, expect, it } from 'vitest';

import {
  NodeFetchHttpTransport,
  PROVIDER_LIMITS,
  providerEndpointUrlForTesting,
} from '../packages/providers/src/index.js';

interface Fixture {
  readonly baseUrl: string;
  readonly server: Server;
  readonly sockets: Set<Socket>;
}

const fixtures = new Set<Fixture>();

async function startFixture(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
): Promise<Fixture> {
  const sockets = new Set<Socket>();
  const server = createServer(handler);
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const fixture = {
    baseUrl: `http://127.0.0.1:${address.port}/compat/v1`,
    server,
    sockets,
  };
  fixtures.add(fixture);
  return fixture;
}

async function closeFixture(fixture: Fixture): Promise<void> {
  fixtures.delete(fixture);
  const socketClosures = [...fixture.sockets].map(
    (socket) =>
      new Promise<void>((resolve) => {
        if (socket.destroyed) {
          resolve();
          return;
        }
        socket.once('close', () => resolve());
      }),
  );
  const serverClosed = new Promise<void>((resolve) => {
    fixture.server.close(() => resolve());
  });
  fixture.server.closeAllConnections();
  for (const socket of fixture.sockets) {
    socket.destroy();
  }
  await Promise.all([serverClosed, ...socketClosures]);
}

afterEach(async () => {
  await Promise.all([...fixtures].map(closeFixture));
});

function request(
  baseUrl: string,
  overrides: Partial<Parameters<NodeFetchHttpTransport['request']>[0]> = {},
) {
  return {
    baseUrl,
    body: '{"model":"synthetic"}',
    credential: 'runtime-synthetic-credential',
    endpoint: 'RESPONSES' as const,
    modelId: 'model-writing',
    operation: 'TEXT_GENERATION',
    providerId: 'configured-provider',
    requestId: 'request-loopback',
    timeoutMs: 2_000,
    ...overrides,
  };
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

describe('Issue 012 Node fetch transport', () => {
  it('preserves a legal base path and uses only allowlisted endpoint paths', () => {
    expect(
      providerEndpointUrlForTesting('https://relay.invalid/base/v1/', 'CHAT_COMPLETIONS'),
    ).toBe('https://relay.invalid/base/v1/chat/completions');
    expect(providerEndpointUrlForTesting('http://127.0.0.1:43199/root', 'IMAGES_GENERATIONS')).toBe(
      'http://127.0.0.1:43199/root/images/generations',
    );
  });

  it.each([
    'http://external.invalid/v1',
    'ftp://127.0.0.1/v1',
    'https://user:pass@relay.invalid/v1',
    'https://relay.invalid/v1?query=1',
    'https://relay.invalid/v1#fragment',
  ])('rejects transport URL outside HTTPS/loopback policy: %s', async (baseUrl) => {
    const transport = new NodeFetchHttpTransport();
    await expect(transport.request(request(baseUrl))).rejects.toMatchObject({
      code: 'PROVIDER_NOT_CONFIGURED',
      outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
    });
  });

  it('POSTs fixed JSON headers with no cookie and streams a bounded response', async () => {
    let observed:
      | {
          readonly authorization: boolean;
          readonly contentType: string | undefined;
          readonly cookie: string | undefined;
          readonly method: string | undefined;
          readonly url: string | undefined;
        }
      | undefined;
    const fixture = await startFixture((incoming, response) => {
      observed = {
        authorization: incoming.headers.authorization !== undefined,
        contentType: incoming.headers['content-type'],
        cookie: incoming.headers.cookie,
        method: incoming.method,
        url: incoming.url,
      };
      json(response, 200, { ok: true });
    });
    const result = await new NodeFetchHttpTransport().request(request(fixture.baseUrl));
    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({ ok: true });
    expect(observed).toEqual({
      authorization: true,
      contentType: 'application/json',
      cookie: undefined,
      method: 'POST',
      url: '/compat/v1/responses',
    });
    expect(fixture.server.address()).toMatchObject({
      address: '127.0.0.1',
      family: 'IPv4',
    });
    await closeFixture(fixture);
    expect(fixture.sockets.size).toBe(0);
  });

  it('returns finite safe headers and never returns arbitrary response headers', async () => {
    const fixture = await startFixture((_incoming, response) => {
      response.writeHead(429, {
        'content-type': 'application/json',
        'retry-after': '4',
        'x-request-id': 'safe-request-id',
        'x-vendor-secret': 'must-not-escape',
      });
      response.end('{}');
    });
    const result = await new NodeFetchHttpTransport().request(request(fixture.baseUrl));
    expect(result.headers).toEqual({
      contentType: 'application/json',
      providerRequestId: 'safe-request-id',
      retryAfter: '4',
    });
    expect(JSON.stringify(result)).not.toContain('must-not-escape');
  });

  it('rejects invalid success Content-Type and cancels the body', async () => {
    const fixture = await startFixture((_incoming, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('vendor response body');
    });
    await expect(
      new NodeFetchHttpTransport().request(request(fixture.baseUrl)),
    ).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_CONTENT_TYPE',
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
    });
  });

  it('rejects an oversized request before opening a connection', async () => {
    const transport = new NodeFetchHttpTransport();
    await expect(
      transport.request(
        request('http://127.0.0.1:9/v1', {
          body: 'x'.repeat(PROVIDER_LIMITS.maxRequestBodyBytes + 1),
        }),
      ),
    ).rejects.toMatchObject({
      code: 'PROVIDER_REQUEST_TOO_LARGE',
      outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
    });
  });

  it('counts streamed response bytes and rejects overflow', async () => {
    const fixture = await startFixture((_incoming, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      const chunk = Buffer.alloc(256 * 1024, 0x20);
      for (
        let written = 0;
        written <= PROVIDER_LIMITS.maxResponseBodyBytes;
        written += chunk.byteLength
      ) {
        response.write(chunk);
      }
      response.end();
    });
    await expect(
      new NodeFetchHttpTransport().request(request(fixture.baseUrl)),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_TOO_LARGE' });
  });

  it('does not follow redirects to another endpoint', async () => {
    const paths: string[] = [];
    const fixture = await startFixture((incoming, response) => {
      paths.push(incoming.url ?? '');
      response.writeHead(302, { location: '/compat/v1/chat/completions' });
      response.end();
    });
    await expect(
      new NodeFetchHttpTransport().request(request(fixture.baseUrl)),
    ).rejects.toMatchObject({ outcomeCertainty: 'MAY_HAVE_EXECUTED' });
    expect(paths).toEqual(['/compat/v1/responses']);
  });

  it('classifies a deadline after send as MAY_HAVE_EXECUTED and releases the socket', async () => {
    const fixture = await startFixture((incoming, response) => {
      const timer = setTimeout(() => json(response, 200, { late: true }), 5_000);
      incoming.socket.once('close', () => clearTimeout(timer));
    });
    await expect(
      new NodeFetchHttpTransport().request(request(fixture.baseUrl, { timeoutMs: 20 })),
    ).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
      outcomeCertainty: 'MAY_HAVE_EXECUTED',
    });
    await closeFixture(fixture);
    expect(fixture.sockets.size).toBe(0);
  });

  it('honors an external AbortSignal and leaves no fixture listener', async () => {
    const fixture = await startFixture((incoming, response) => {
      const timer = setTimeout(() => json(response, 200, { late: true }), 5_000);
      incoming.socket.once('close', () => clearTimeout(timer));
    });
    const controller = new AbortController();
    const pending = new NodeFetchHttpTransport().request(
      request(fixture.baseUrl, { signal: controller.signal }),
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: 'PROVIDER_ABORTED' });
    await closeFixture(fixture);
    expect(fixture.server.listening).toBe(false);
    expect(fixture.sockets.size).toBe(0);
  });
});
