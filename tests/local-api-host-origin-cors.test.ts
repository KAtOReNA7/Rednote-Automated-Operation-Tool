import { afterEach, describe, expect, it } from 'vitest';

import {
  isExtensionOrigin,
  parseSingleOrigin,
  validateHost,
  validateRemoteAddress,
} from '../packages/local-api/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import {
  cleanupLocalApiContexts,
  createLocalApiContext,
  localApiRequest,
  pairOverHttp,
  randomExtensionOrigin,
} from './support/local-api-test-utils.js';

afterEach(async () => {
  await cleanupLocalApiContexts();
  cleanTemporaryDatabases();
});

describe('Host, remote address, Origin, and CORS policy', () => {
  it.each([
    '',
    'null',
    'file:///tmp/a',
    'http://example.test',
    'https://example.test',
    'moz-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    `chrome-extension://${'a'.repeat(31)}`,
    `chrome-extension://${'a'.repeat(33)}`,
    `chrome-extension://${'A'.repeat(32)}`,
    `chrome-extension://${'q'.repeat(32)}`,
    `chrome-extension://${'a'.repeat(32)}/path`,
    `chrome-extension://${'a'.repeat(32)}?query=1`,
    `chrome-extension://${'a'.repeat(32)}#fragment`,
  ])('rejects a non-canonical application origin: %s', (origin) => {
    expect(isExtensionOrigin(origin)).toBe(false);
  });

  it('requires exactly one raw Host and Origin header with exact values', () => {
    const origin = randomExtensionOrigin();
    expect(() => validateHost(['Host', '127.0.0.1:43119'], 43_119)).not.toThrow();
    expect(() =>
      validateHost(['Host', '127.0.0.1:43119', 'Host', '127.0.0.1:43119'], 43_119),
    ).toThrow(expect.objectContaining({ code: 'LOCAL_API_INVALID_HOST' }));
    expect(parseSingleOrigin(['Origin', origin])).toBe(origin);
    expect(() => parseSingleOrigin(['Origin', origin, 'Origin', origin])).toThrow(
      expect.objectContaining({ code: 'LOCAL_API_INVALID_ORIGIN' }),
    );
  });

  it.each(['localhost:43119', '0.0.0.0:43119', '[::1]:43119', 'example.test:43119'])(
    'rejects an imprecise Host value: %s',
    (host) => {
      expect(() => validateHost(['Host', host], 43_119)).toThrow(
        expect.objectContaining({ code: 'LOCAL_API_INVALID_HOST' }),
      );
    },
  );

  it('accepts only the actual IPv4 loopback remote address', () => {
    expect(() => validateRemoteAddress('127.0.0.1')).not.toThrow();
    for (const address of [undefined, '::1', '::ffff:127.0.0.1', '192.168.1.2']) {
      expect(() => validateRemoteAddress(address)).toThrow(
        expect.objectContaining({ code: 'LOCAL_API_INVALID_HOST' }),
      );
    }
  });

  it('rejects wrong Host, missing Origin, and invalid Origin without ACAO', async () => {
    const context = await createLocalApiContext();
    const wrongHost = await localApiRequest(context.port, {
      host: `localhost:${context.port}`,
      origin: context.origin,
    });
    const missingOrigin = await localApiRequest(context.port);
    const invalidOrigin = await localApiRequest(context.port, {
      origin: 'https://example.test',
    });
    for (const response of [wrongHost, missingOrigin, invalidOrigin]) {
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['access-control-allow-credentials']).toBeUndefined();
      expect(response.headers.vary).toBe('Origin');
    }
  });

  it('never echoes ACAO for a legal but unpaired or wrong extension origin', async () => {
    const context = await createLocalApiContext();
    const unpaired = await localApiRequest(context.port, {
      origin: context.origin,
    });
    const paired = await pairOverHttp(context);
    const wrong = await localApiRequest(context.port, {
      authorization: `Bearer ${paired.token}`,
      origin: randomExtensionOrigin(),
    });
    expect(unpaired.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unpaired.headers['access-control-allow-origin']).toBeUndefined();
    expect(wrong.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns exact CORS headers only after origin authorization', async () => {
    const context = await createLocalApiContext();
    const paired = await pairOverHttp(context);
    const response = await localApiRequest(context.port, {
      headers: {
        'Access-Control-Request-Headers': 'authorization',
        'Access-Control-Request-Method': 'GET',
      },
      method: 'OPTIONS',
      origin: paired.origin,
      path: '/v1/status',
    });
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe(paired.origin);
    expect(response.headers['access-control-allow-methods']).toBe('GET');
    expect(response.headers['access-control-allow-headers']).toBe('authorization');
    expect(Number(response.headers['access-control-max-age'])).toBeLessThanOrEqual(300);
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
    expect(response.headers.vary).toBe('Origin');
    expect(response.body).toBe('');
  });

  it('accepts Chrome authenticated GETs that bind an omitted Origin in an exact header', async () => {
    const context = await createLocalApiContext();
    const paired = await pairOverHttp(context);
    const response = await localApiRequest(context.port, {
      authorization: `Bearer ${paired.token}`,
      headers: {
        'X-Rednote-Extension-Origin': paired.origin,
      },
      path: '/v1/status',
    });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      clientStatus: 'ACTIVE',
      serviceState: 'RUNNING',
    });
  });

  it('allows the exact authenticated Chromium GET preflight header set', async () => {
    const context = await createLocalApiContext();
    const paired = await pairOverHttp(context);
    const response = await localApiRequest(context.port, {
      headers: {
        'Access-Control-Request-Headers': 'authorization, x-rednote-extension-origin',
        'Access-Control-Request-Method': 'GET',
      },
      method: 'OPTIONS',
      origin: paired.origin,
      path: '/v1/status',
    });
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-headers']).toBe(
      'authorization,x-rednote-extension-origin',
    );
    expect(response.headers['access-control-allow-origin']).toBe(paired.origin);
  });

  it('rejects a claimed extension origin that disagrees with the browser Origin', async () => {
    const context = await createLocalApiContext();
    const paired = await pairOverHttp(context);
    const response = await localApiRequest(context.port, {
      authorization: `Bearer ${paired.token}`,
      headers: {
        'X-Rednote-Extension-Origin': randomExtensionOrigin(),
      },
      origin: paired.origin,
      path: '/v1/status',
    });
    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('allows a valid pairing preflight only while a pairing session is active', async () => {
    const context = await createLocalApiContext();
    const listenerId = context.server.listener?.listenerInstanceId;
    expect(listenerId).toBeDefined();
    if (listenerId === undefined) {
      throw new Error('Local API listener was not started.');
    }
    const before = await localApiRequest(context.port, {
      headers: {
        'Access-Control-Request-Headers': 'content-type',
        'Access-Control-Request-Method': 'POST',
      },
      method: 'OPTIONS',
      origin: context.origin,
      path: '/v1/pairings/exchange',
    });
    context.server.pairingSessions.start(listenerId, context.port, 1);
    const during = await localApiRequest(context.port, {
      headers: {
        'Access-Control-Request-Headers': 'content-type',
        'Access-Control-Request-Method': 'POST',
      },
      method: 'OPTIONS',
      origin: context.origin,
      path: '/v1/pairings/exchange',
    });
    expect(before.status).toBe(403);
    expect(before.headers['access-control-allow-origin']).toBeUndefined();
    expect(during.status).toBe(204);
    expect(during.headers['access-control-allow-origin']).toBe(context.origin);
    expect(context.server.pairingSessions.activeCount()).toBe(1);
  });

  it('rejects illegal preflight without ACAO and without business state changes', async () => {
    const context = await createLocalApiContext();
    const paired = await pairOverHttp(context);
    const clientsBefore = context.repository.listClients();
    const response = await localApiRequest(context.port, {
      headers: {
        'Access-Control-Request-Headers': 'authorization,x-extra',
        'Access-Control-Request-Method': 'GET',
      },
      method: 'OPTIONS',
      origin: paired.origin,
      path: '/v1/status',
    });
    expect(response.status).toBe(403);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(context.repository.listClients()).toEqual(clientsBefore);
  });

  it('does not trust forwarded-address headers and does not leak server internals', async () => {
    const context = await createLocalApiContext();
    const paired = await pairOverHttp(context);
    const response = await localApiRequest(context.port, {
      authorization: `Bearer ${paired.token}`,
      headers: {
        Forwarded: 'for=203.0.113.10',
        'X-Forwarded-For': '203.0.113.10',
        'X-Real-IP': '203.0.113.10',
      },
      origin: paired.origin,
    });
    expect(response.status).toBe(200);
    expect(response.headers.server).toBeUndefined();
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.body).not.toMatch(/stack|sqlite|absolute|internal/iu);
  });
});
