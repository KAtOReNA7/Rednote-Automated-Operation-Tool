import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DnsPinningSession,
  assertPinnedRemoteAddress,
  FetchError,
  NodeControlledFetchTransport,
  parseFetchContentType,
  isPublicIpAddress,
  validateFetchUrl,
  validateRedirectTarget,
  type DnsResolverV1,
} from '../packages/fetch/src/index.js';
import { enabledFetchProfile } from './fetch-fixtures.js';

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
});

describe('fetch URL, DNS, SSRF and pinned transport', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.1.1',
    '172.16.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.18.0.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff00::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
  ])('rejects non-public IP range %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false);
  });

  it('rejects confusing hosts, credential query names and unsafe redirects', () => {
    for (const url of [
      'file:///etc/passwd',
      'http://localhost/a',
      'https://intranet/a',
      'https://name.local/a',
      'https://user:pass@news.example.test/a',
      'https://news.example.test/a#fragment',
      'https://news.example.test/a?access_token=secret',
      'https://news.example.test/a?x-api-key=secret',
      'https://news.example.test/%zz',
    ]) {
      expect(() => validateFetchUrl(url)).toThrow(FetchError);
    }
    expect(() =>
      validateRedirectTarget('https://news.example.test/a', 'http://news.example.test/b'),
    ).toThrow('FETCH_HTTPS_DOWNGRADE');
    expect(() =>
      validateRedirectTarget('https://news.example.test/a', 'https://other.example.test/b'),
    ).toThrow('FETCH_REDIRECT_CROSS_HOST');
  });

  it('fails closed on one private answer and DNS rebinding', async () => {
    const mixed: DnsResolverV1 = {
      resolve: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    };
    await expect(
      new DnsPinningSession(mixed).resolve('https://news.example.test/article'),
    ).rejects.toMatchObject({ code: 'FETCH_DNS_NON_PUBLIC' });

    let call = 0;
    const rebinding: DnsResolverV1 = {
      resolve: async () => [
        { address: call++ === 0 ? '93.184.216.34' : '93.184.216.35', family: 4 },
      ],
    };
    const session = new DnsPinningSession(rebinding);
    await session.resolve('https://news.example.test/a');
    await expect(session.resolve('https://news.example.test/b')).rejects.toMatchObject({
      code: 'FETCH_DNS_REBINDING',
    });
  });

  it('rejects a connected peer that is not the pinned address', () => {
    const target = {
      addresses: [{ address: '93.184.216.34', family: 4 as const }],
      dnsPolicyVersion: 'fetch-dns-public-only-v1' as const,
      hostname: 'news.example.test',
      selectedAddress: { address: '93.184.216.34', family: 4 as const },
    };
    expect(() => assertPinnedRemoteAddress(target, '93.184.216.35')).toThrow(
      'FETCH_REMOTE_ADDRESS_MISMATCH',
    );
    expect(() => assertPinnedRemoteAddress(target, '93.184.216.34')).not.toThrow();
  });

  it('uses the pinned address, original Host and a fixed header set on injected loopback', async () => {
    let observed: Record<string, string | string[] | undefined> = {};
    const server = createServer((request, response) => {
      observed = request.headers;
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('A deterministic fixture response with enough body bytes for transport.');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const transport = new NodeControlledFetchTransport();
    const profile = enabledFetchProfile();
    const response = await transport.fetch({
      deadlineAt: Date.now() + 5_000,
      kind: 'PAGE',
      pinnedTarget: {
        addresses: [{ address: '127.0.0.1', family: 4 }],
        dnsPolicyVersion: 'fetch-dns-public-only-v1',
        hostname: 'news.example.test',
        selectedAddress: { address: '127.0.0.1', family: 4 },
      },
      profile,
      url: new URL(`http://news.example.test:${port}/article`),
    });
    expect(response.statusCode).toBe(200);
    expect(response.remoteAddress).toBe('127.0.0.1');
    expect(observed.host).toBe(`news.example.test:${port}`);
    expect(observed['user-agent']).toBe('RednoteResearchFetcher/1.0 (+local-user-controlled)');
    expect(observed.cookie).toBeUndefined();
    expect(observed.authorization).toBeUndefined();
    expect(observed.referer).toBeUndefined();
    expect(observed.origin).toBeUndefined();
  });

  it('fails closed on MIME declarations, header count, Content-Length and compression ratio', async () => {
    expect(() => parseFetchContentType(null)).toThrow('FETCH_MIME_MISSING');
    expect(() => parseFetchContentType('application/pdf')).toThrow('FETCH_MIME_UNSUPPORTED');
    expect(() => parseFetchContentType('text/html; charset=utf-8; charset=gb18030')).toThrow(
      'FETCH_MIME_MISMATCH',
    );

    const server = createServer((request, response) => {
      if (request.url === '/length') {
        response.writeHead(200, {
          'Content-Length': String(3 * 1024 * 1024),
          'Content-Type': 'text/html',
        });
        response.end();
        return;
      }
      const compressed = gzipSync(Buffer.alloc(200_000, 0x61));
      response.writeHead(200, {
        'Content-Encoding': 'gzip',
        'Content-Type': 'text/plain; charset=utf-8',
      });
      response.end(compressed);
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    const request = (path: string, profile = enabledFetchProfile()) => ({
      deadlineAt: Date.now() + 5_000,
      kind: 'PAGE' as const,
      pinnedTarget: {
        addresses: [{ address: '127.0.0.1', family: 4 as const }],
        dnsPolicyVersion: 'fetch-dns-public-only-v1' as const,
        hostname: 'news.example.test',
        selectedAddress: { address: '127.0.0.1', family: 4 as const },
      },
      profile,
      url: new URL(`http://news.example.test:${port}${path}`),
    });
    const transport = new NodeControlledFetchTransport();
    await expect(transport.fetch(request('/length'))).rejects.toMatchObject({
      code: 'FETCH_RESPONSE_TOO_LARGE',
    });
    await expect(transport.fetch(request('/compressed'))).rejects.toMatchObject({
      code: 'FETCH_COMPRESSION_LIMIT',
    });
    const oneHeader = enabledFetchProfile({
      limits: { ...enabledFetchProfile().limits, headerCount: 1 },
    });
    await expect(transport.fetch(request('/compressed', oneHeader))).rejects.toMatchObject({
      code: 'FETCH_HEADERS_TOO_LARGE',
    });
  });
});
