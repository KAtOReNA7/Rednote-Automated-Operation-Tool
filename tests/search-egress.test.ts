import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  LoopbackSearchApiCodec,
  NodeSearchApiTransport,
  SEARCH_LIMITS,
  SearchApiAdapter,
  SearchPlanner,
  SearchProviderRegistry,
  validateSearchApiRedirect,
  type SearchApiEncodedRequestV1,
  type SearchApiTransportContextV1,
} from '../packages/search/src/index.js';
import { searchRequest } from './search-fixtures.js';

const servers: Server[] = [];
const LIMITS = {
  bodyTimeoutMs: 2_000,
  connectTimeoutMs: 2_000,
  headerBytes: 8_192,
  headerTimeoutMs: 2_000,
  maxDecompressedBytes: SEARCH_LIMITS.responseBytes,
  maxRawBytes: SEARCH_LIMITS.responseBytes,
  totalTimeoutMs: 4_000,
};

function encodedRequest(url: URL): SearchApiEncodedRequestV1 {
  return {
    body: new TextEncoder().encode('{}'),
    contentType: 'application/json',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    method: 'POST',
    url,
  };
}

function loopbackContext(
  overrides: Partial<SearchApiTransportContextV1['limits']> = {},
  allowSameOriginRedirect = false,
): SearchApiTransportContextV1 {
  return {
    allowLoopbackHttpForTests: true,
    allowSameOriginRedirect,
    limits: { ...LIMITS, ...overrides },
  };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  servers.push(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('fixture listen failed');
  return address.port;
}

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server !== undefined) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }
});

describe('Search API egress boundaries', () => {
  it('rejects a 70-target production HTTP matrix before any connection attempt', async () => {
    const transport = new NodeSearchApiTransport();
    const context: SearchApiTransportContextV1 = {
      allowLoopbackHttpForTests: false,
      allowSameOriginRedirect: false,
      limits: LIMITS,
    };
    const targets = [
      ...Array.from(
        { length: 20 },
        (_unused, index) => new URL(`http://192.0.2.${index + 1}/search`),
      ),
      ...Array.from(
        { length: 20 },
        (_unused, index) => new URL(`http://198.51.100.${index + 1}/v1/search?q=target-${index}`),
      ),
      ...Array.from(
        { length: 15 },
        (_unused, index) => new URL(`http://203.0.113.${index + 1}/result/content-${index}`),
      ),
      ...Array.from(
        { length: 10 },
        (_unused, index) => new URL(`http://192.0.2.${index + 40}/crawler/sitemap-${index}.xml`),
      ),
      ...Array.from(
        { length: 5 },
        (_unused, index) => new URL(`http://198.51.100.${index + 40}/plugin/fetch-${index}`),
      ),
    ];
    expect(targets).toHaveLength(70);
    for (const url of targets) {
      const request: SearchApiEncodedRequestV1 = {
        body: new Uint8Array(),
        contentType: 'application/json',
        headers: {},
        method: 'POST',
        url,
      };
      await expect(transport.send(request, context)).rejects.toMatchObject({
        code: 'SEARCH_INVALID_REQUEST',
        sendState: 'NOT_SENT',
      });
    }
  });

  it('allows one loopback fixture request and never follows the returned candidate URL', async () => {
    let apiCalls = 0;
    let candidateCalls = 0;
    const candidatePort = await listen(
      createServer((_request, response) => {
        candidateCalls += 1;
        response.end('must not be reached');
      }),
    );
    const apiPort = await listen(
      createServer((request, response) => {
        apiCalls += 1;
        request.resume();
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            complete: true,
            cursor: null,
            results: [
              {
                languageHint: null,
                previewText: null,
                publishedAt: null,
                title: 'Lead only',
                upstreamId: 'result-1',
                url: `http://127.0.0.1:${candidatePort}/must-not-connect`,
              },
            ],
            truncated: false,
          }),
        );
      }),
    );
    const credential = randomBytes(32).toString('base64url');
    const adapter = new SearchApiAdapter({
      accountingReady: true,
      codec: new LoopbackSearchApiCodec(new URL(`http://127.0.0.1:${apiPort}/search`)),
      credentialReference: 'runtime-fixture-reference',
      credentialResolver: { resolveCredential: async () => credential },
      enabled: true,
      rateReady: true,
      transport: new NodeSearchApiTransport(),
      transportLimits: LIMITS,
    });
    const registry = new SearchProviderRegistry();
    registry.register(adapter);
    const request = searchRequest({
      providerInstanceId: 'search-api-v1',
      ratePolicyRef: 'search-api-rate-policy-v1',
    });
    const ratePolicy = {
      contractVersion: 'search-rate-policy-v1' as const,
      maxConcurrent: 1,
      maxRequestsPerWindow: 10,
      maxResponseBytes: SEARCH_LIMITS.responseBytes,
      maxResults: 20,
      minIntervalMs: 1_000,
      revision: 1,
      timeoutMs: 4_000,
      windowMs: 60_000,
    };
    const now = new Date('2026-07-28T00:00:00.000Z');
    const plan = await new SearchPlanner(registry, {
      idFactory: () => 'loopback-plan',
      now: () => now,
    }).createPlan(
      request,
      { budgetIdentity: 'auditable-test', capabilityIdentity: 'none', settingsRevision: 1 },
      ratePolicy,
      4_000,
    );
    const batch = await adapter.execute(request, {
      now: () => now,
      plan,
      searchRunId: 'loopback-run',
    });
    expect(apiCalls).toBe(1);
    expect(candidateCalls).toBe(0);
    expect(batch.candidates[0]?.fetchState).toBe('NOT_FETCHED');
    expect(JSON.stringify(batch)).not.toContain(credential);
  });

  it('enforces raw and decompressed response limits', async () => {
    const rawPort = await listen(
      createServer((request, response) => {
        request.resume();
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('x'.repeat(256));
      }),
    );
    await expect(
      new NodeSearchApiTransport().send(
        encodedRequest(new URL(`http://127.0.0.1:${rawPort}/raw`)),
        loopbackContext({ maxDecompressedBytes: 512, maxRawBytes: 64 }),
      ),
    ).rejects.toMatchObject({ code: 'SEARCH_RESPONSE_TOO_LARGE', sendState: 'SENT' });

    const compressed = gzipSync('x'.repeat(512));
    const compressedPort = await listen(
      createServer((request, response) => {
        request.resume();
        response.writeHead(200, {
          'content-encoding': 'gzip',
          'content-type': 'application/json',
        });
        response.end(compressed);
      }),
    );
    await expect(
      new NodeSearchApiTransport().send(
        encodedRequest(new URL(`http://127.0.0.1:${compressedPort}/compressed`)),
        loopbackContext({ maxDecompressedBytes: 128, maxRawBytes: 1_024 }),
      ),
    ).rejects.toMatchObject({ code: 'SEARCH_RESPONSE_TOO_LARGE', sendState: 'SENT' });
  });

  it('allows at most one same-origin redirect and rejects cross-origin and downgrade targets', async () => {
    let calls = 0;
    const port = await listen(
      createServer((request, response) => {
        calls += 1;
        request.resume();
        if (request.url === '/start') {
          response.writeHead(307, { location: '/final' });
          response.end();
          return;
        }
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
      }),
    );
    await expect(
      new NodeSearchApiTransport().send(
        encodedRequest(new URL(`http://127.0.0.1:${port}/start`)),
        loopbackContext({}, true),
      ),
    ).resolves.toMatchObject({ status: 200 });
    expect(calls).toBe(2);

    const otherPort = await listen(
      createServer((_request, response) => {
        response.end('must not be reached');
      }),
    );
    expect(() =>
      validateSearchApiRedirect(
        new URL(`http://127.0.0.1:${port}/start`),
        `http://127.0.0.1:${otherPort}/cross-origin`,
        true,
        true,
        0,
      ),
    ).toThrowError('SEARCH_RESPONSE_INVALID');
    expect(() =>
      validateSearchApiRedirect(
        new URL('https://search.example/start'),
        'http://search.example/downgrade',
        false,
        true,
        0,
      ),
    ).toThrowError('SEARCH_RESPONSE_INVALID');
    expect(() =>
      validateSearchApiRedirect(
        new URL(`http://127.0.0.1:${port}/start`),
        '/second-redirect',
        true,
        true,
        1,
      ),
    ).toThrowError('SEARCH_RESPONSE_INVALID');
  });

  it('classifies header/body timeout and partial socket close without retry', async () => {
    const headerPort = await listen(
      createServer((request) => {
        request.resume();
      }),
    );
    await expect(
      new NodeSearchApiTransport().send(
        encodedRequest(new URL(`http://127.0.0.1:${headerPort}/header-timeout`)),
        loopbackContext({ headerTimeoutMs: 50, totalTimeoutMs: 500 }),
      ),
    ).rejects.toMatchObject({ code: 'SEARCH_TIMEOUT_AFTER_SEND', sendState: 'SENT' });

    const bodyPort = await listen(
      createServer((request, response) => {
        request.resume();
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"partial":');
      }),
    );
    await expect(
      new NodeSearchApiTransport().send(
        encodedRequest(new URL(`http://127.0.0.1:${bodyPort}/body-timeout`)),
        loopbackContext({ bodyTimeoutMs: 50, totalTimeoutMs: 500 }),
      ),
    ).rejects.toMatchObject({ code: 'SEARCH_TIMEOUT_AFTER_SEND', sendState: 'SENT' });

    let partialCalls = 0;
    const partialPort = await listen(
      createServer((request, response) => {
        partialCalls += 1;
        request.resume();
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"complete":');
        response.destroy();
      }),
    );
    await expect(
      new NodeSearchApiTransport().send(
        encodedRequest(new URL(`http://127.0.0.1:${partialPort}/partial`)),
        loopbackContext(),
      ),
    ).rejects.toMatchObject({ code: 'SEARCH_AMBIGUOUS', sendState: 'UNKNOWN' });
    expect(partialCalls).toBe(1);
  });

  it('returns 429/5xx once and leaves MIME/schema rejection to the fixed codec', async () => {
    for (const fixture of [
      { body: '{}', contentType: 'application/json', status: 429 },
      { body: '{}', contentType: 'application/json', status: 503 },
      { body: '{"unexpected":true}', contentType: 'text/html', status: 200 },
      { body: '{"unexpected":true}', contentType: 'application/json', status: 200 },
      { body: '{"truncated":', contentType: 'application/json', status: 200 },
    ]) {
      let calls = 0;
      const port = await listen(
        createServer((request, response) => {
          calls += 1;
          request.resume();
          response.writeHead(fixture.status, {
            'content-type': fixture.contentType,
            'retry-after': '7',
          });
          response.end(fixture.body);
        }),
      );
      const codec = new LoopbackSearchApiCodec(new URL(`http://127.0.0.1:${port}/fixed-codec`));
      const response = await new NodeSearchApiTransport().send(
        codec.encode(
          searchRequest({
            providerInstanceId: 'search-api-v1',
            ratePolicyRef: 'search-api-rate-policy-v1',
          }),
          randomBytes(32).toString('base64url'),
        ),
        loopbackContext(),
      );
      expect(calls).toBe(1);
      if (fixture.status === 429) {
        expect(response.retryAfterSeconds).toBe(7);
      } else {
        expect(() => codec.decode(response)).toThrowError('SEARCH_RESPONSE_INVALID');
      }
    }
  });
});
