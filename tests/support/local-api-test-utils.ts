import { randomBytes, randomUUID } from 'node:crypto';
import { request } from 'node:http';
import { createServer } from 'node:net';
import type { DatabaseSync } from 'node:sqlite';

import { SqliteLocalApiRepository } from '../../packages/db/src/index.js';
import { type LocalApiClock, LocalApiServer } from '../../packages/local-api/src/index.js';
import { createInitializedDatabase } from './database-test-utils.js';

export interface LocalApiHttpResponse {
  readonly body: string;
  readonly headers: Readonly<Record<string, string | readonly string[] | undefined>>;
  readonly status: number;
}

export interface LocalApiTestContext {
  readonly database: DatabaseSync;
  readonly origin: string;
  readonly port: number;
  readonly repository: SqliteLocalApiRepository;
  readonly server: LocalApiServer;
}

const contexts = new Set<LocalApiTestContext>();

export function randomRuntimeToken(): string {
  return randomBytes(32).toString('base64url');
}

export function randomExtensionOrigin(): string {
  const alphabet = 'abcdefghijklmnop';
  const id = randomBytes(16)
    .toString('hex')
    .replace(/[0-9a-f]/gu, (character) => alphabet[Number.parseInt(character, 16)] ?? 'a');
  return `chrome-extension://${id}`;
}

export async function allocateLocalApiPort(): Promise<number> {
  const allocator = createServer();
  await new Promise<void>((resolveListen, rejectListen) => {
    allocator.once('error', rejectListen);
    allocator.listen({ host: '127.0.0.1', port: 0 }, resolveListen);
  });
  const address = allocator.address();
  if (address === null || typeof address === 'string') {
    allocator.close();
    throw new Error('Could not allocate a local API test port.');
  }
  await new Promise<void>((resolveClose, rejectClose) => {
    allocator.close((error) => (error === undefined ? resolveClose() : rejectClose(error)));
  });
  return address.port;
}

export async function createLocalApiContext(
  options: {
    readonly clock?: LocalApiClock;
  } = {},
): Promise<LocalApiTestContext> {
  const { database } = await createInitializedDatabase('local api database');
  const repository = new SqliteLocalApiRepository(database);
  const port = await allocateLocalApiPort();
  const server = new LocalApiServer({
    ...(options.clock === undefined ? {} : { clock: options.clock }),
    port,
    repository,
  });
  await server.start();
  const context = {
    database,
    origin: randomExtensionOrigin(),
    port,
    repository,
    server,
  };
  contexts.add(context);
  return context;
}

export async function cleanupLocalApiContexts(): Promise<void> {
  for (const context of contexts) {
    await context.server.stop().catch(() => undefined);
    context.database.close();
  }
  contexts.clear();
}

export async function localApiRequest(
  port: number,
  options: {
    readonly authorization?: string;
    readonly body?: Buffer | string;
    readonly headers?: Readonly<Record<string, number | readonly string[] | string>>;
    readonly host?: string;
    readonly method?: string;
    readonly origin?: string;
    readonly path?: string;
  } = {},
): Promise<LocalApiHttpResponse> {
  const body =
    options.body === undefined
      ? Buffer.alloc(0)
      : Buffer.isBuffer(options.body)
        ? options.body
        : Buffer.from(options.body, 'utf8');
  return new Promise<LocalApiHttpResponse>((resolveRequest, rejectRequest) => {
    const outgoing = request(
      {
        headers: {
          Host: options.host ?? `127.0.0.1:${port}`,
          ...(options.origin === undefined ? {} : { Origin: options.origin }),
          ...(options.authorization === undefined ? {} : { Authorization: options.authorization }),
          ...(body.length === 0
            ? {}
            : {
                'Content-Length': body.length,
                'Content-Type': 'application/json',
              }),
          ...options.headers,
        },
        host: '127.0.0.1',
        method: options.method ?? 'GET',
        path: options.path ?? '/v1/status',
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
    outgoing.once('timeout', () => outgoing.destroy(new Error('LOCAL_API_TEST_TIMEOUT')));
    if (body.length > 0) {
      outgoing.write(body);
    }
    outgoing.end();
  });
}

export async function pairOverHttp(
  context: LocalApiTestContext,
  options: {
    readonly label?: string;
    readonly origin?: string;
    readonly token?: string;
    readonly windowId?: number;
  } = {},
): Promise<{ readonly origin: string; readonly token: string }> {
  const pairing = context.server.pairingSessions.start(
    context.server.listener?.listenerInstanceId ?? randomUUID(),
    context.port,
    options.windowId ?? 1,
  );
  const origin = options.origin ?? context.origin;
  const token = options.token ?? randomRuntimeToken();
  const response = await localApiRequest(context.port, {
    body: JSON.stringify({
      clientLabel: options.label ?? 'Local API test client',
      clientToken: token,
      extensionOrigin: origin,
      pairingCode: pairing.pairingCode,
    }),
    method: 'POST',
    origin,
    path: '/v1/pairings/exchange',
  });
  if (response.status !== 201) {
    throw new Error('Local API test pairing failed.');
  }
  return { origin, token };
}

export function startTestPairing(context: LocalApiTestContext, windowId = 1) {
  const listener = context.server.listener;
  if (listener === null) {
    throw new Error('Local API test listener is not running.');
  }
  return context.server.pairingSessions.start(listener.listenerInstanceId, context.port, windowId);
}
