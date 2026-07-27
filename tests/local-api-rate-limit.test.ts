import { afterEach, describe, expect, it } from 'vitest';

import { FixedWindowRateLimiter } from '../packages/local-api/src/index.js';
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

describe('injectable in-memory local API rate limits', () => {
  it('uses a fixed one-minute window with a finite Retry-After', () => {
    let now = new Date('2026-07-28T01:00:00.000Z');
    const limiter = new FixedWindowRateLimiter({ now: () => now });
    expect(limiter.take('client', 2)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.take('client', 2)).toEqual({ allowed: true, retryAfterSeconds: 0 });
    expect(limiter.take('client', 2)).toEqual({ allowed: false, retryAfterSeconds: 60 });
    now = new Date('2026-07-28T01:00:59.500Z');
    expect(limiter.take('client', 2)).toEqual({ allowed: false, retryAfterSeconds: 1 });
    now = new Date('2026-07-28T01:01:00.000Z');
    expect(limiter.take('client', 2)).toEqual({ allowed: true, retryAfterSeconds: 0 });
  });

  it('clears all in-memory buckets without timers or external state', () => {
    const limiter = new FixedWindowRateLimiter();
    expect(limiter.take('client', 1).allowed).toBe(true);
    expect(limiter.take('client', 1).allowed).toBe(false);
    limiter.clear();
    expect(limiter.take('client', 1).allowed).toBe(true);
  });

  it('limits pairing exchange globally to ten attempts per minute', async () => {
    const context = await createLocalApiContext();
    const responses = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      responses.push(
        await localApiRequest(context.port, {
          body: '{}',
          method: 'POST',
          origin: context.origin,
          path: '/v1/pairings/exchange',
        }),
      );
    }
    expect(responses.slice(0, 10).every(({ status }) => status === 401)).toBe(true);
    expect(responses[10]?.status).toBe(429);
    expect(responses[10]?.headers['retry-after']).toMatch(/^[1-9][0-9]?$/u);
  });

  it('limits all failed authentication attempts globally to sixty per minute', async () => {
    const context = await createLocalApiContext();
    let response;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      response = await localApiRequest(context.port, {
        origin: context.origin,
        path: '/v1/status',
      });
    }
    expect(response?.status).toBe(429);
    expect(response?.headers['retry-after']).toMatch(/^[1-9][0-9]?$/u);
    expect(JSON.parse(response?.body ?? '{}')).toMatchObject({
      code: 'LOCAL_API_RATE_LIMITED',
    });
  });

  it('counts malformed and unknown Bearer credentials as unauthenticated attempts', async () => {
    const context = await createLocalApiContext();
    let response;
    for (let attempt = 0; attempt < 61; attempt += 1) {
      response = await localApiRequest(context.port, {
        authorization: attempt % 2 === 0 ? 'Basic invalid' : 'Bearer invalid',
        origin: context.origin,
      });
    }
    expect(response?.status).toBe(429);
  });

  it('limits authenticated routes independently per client to 120 per minute', async () => {
    const context = await createLocalApiContext();
    const first = await pairOverHttp(context);
    const second = await pairOverHttp(context, {
      origin: randomExtensionOrigin(),
    });
    let firstResponse;
    for (let attempt = 0; attempt < 121; attempt += 1) {
      firstResponse = await localApiRequest(context.port, {
        authorization: `Bearer ${first.token}`,
        origin: first.origin,
      });
    }
    const secondResponse = await localApiRequest(context.port, {
      authorization: `Bearer ${second.token}`,
      origin: second.origin,
    });
    expect(firstResponse?.status).toBe(429);
    expect(secondResponse.status).toBe(200);
  });

  it('resets real request limits when the injected clock advances a minute', async () => {
    let now = new Date('2026-07-28T01:00:00.000Z');
    const context = await createLocalApiContext({ clock: { now: () => now } });
    for (let attempt = 0; attempt < 61; attempt += 1) {
      await localApiRequest(context.port, { origin: context.origin });
    }
    now = new Date('2026-07-28T01:01:00.000Z');
    const response = await localApiRequest(context.port, { origin: context.origin });
    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'LOCAL_API_AUTH_REQUIRED' });
  });
});
