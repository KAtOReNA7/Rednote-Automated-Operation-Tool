import { describe, expect, it, vi } from 'vitest';

import {
  CAPABILITY_PROBE_LIMITS,
  NodeFetchCapabilityProbeTransport,
  capabilityProbeModelMetadataUrl,
  capabilityProbeUrl,
} from '../packages/providers/src/index.js';
import { syntheticInvalidCredential } from './support/capability-probe-fixture.js';

describe('Issue 013 fixed capability probe transport', () => {
  it('preserves base paths and strictly encodes safe model segments', () => {
    expect(capabilityProbeUrl('https://relay.example/v1/', '/responses')).toBe(
      'https://relay.example/v1/responses',
    );
    expect(capabilityProbeModelMetadataUrl('https://relay.example/v1', 'model name')).toBe(
      'https://relay.example/v1/models/model%20name',
    );
    expect(() => capabilityProbeModelMetadataUrl('https://relay.example/v1', 'model/path')).toThrow(
      /path segment/iu,
    );
    expect(() => capabilityProbeUrl('http://relay.example/v1', '/models')).toThrow(/policy/iu);
  });

  it('injects Authorization only in the final transport and forbids redirect/cookies', async () => {
    const credential = syntheticInvalidCredential();
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init).toMatchObject({
        credentials: 'omit',
        method: 'GET',
        redirect: 'error',
      });
      expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${credential}`);
      expect(new Headers(init?.headers).has('cookie')).toBe(false);
      return new Response(JSON.stringify({ data: [] }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
    const transport = new NodeFetchCapabilityProbeTransport(fetch);
    await transport.request({
      baseUrl: 'http://127.0.0.1:43119/v1',
      body: null,
      credential,
      method: 'GET',
      path: '/models',
      signal: new AbortController().signal,
      timeoutMs: 1000,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('advertises JSON for non-streaming requests and event-stream only for streaming probes', async () => {
    const accepts: string[] = [];
    const transport = new NodeFetchCapabilityProbeTransport(async (_url, init) => {
      accepts.push(new Headers(init?.headers).get('accept') ?? '');
      return new Response('{"output":[]}', {
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
    const base = {
      baseUrl: 'http://127.0.0.1:43119/v1',
      credential: syntheticInvalidCredential(),
      method: 'POST' as const,
      path: '/responses' as const,
      signal: new AbortController().signal,
      timeoutMs: 1000,
    };
    await transport.request({ ...base, body: { stream: false } });
    await transport.request({ ...base, body: { stream: true } });
    expect(accepts).toEqual(['application/json', 'text/event-stream']);
  });

  it('permits Batch metadata only through OPTIONS or HEAD', async () => {
    const transport = new NodeFetchCapabilityProbeTransport(
      async () => new Response(null, { status: 204 }),
    );
    await expect(
      transport.request({
        baseUrl: 'http://127.0.0.1:43119/v1',
        body: {},
        credential: syntheticInvalidCredential(),
        method: 'POST',
        path: '/batches',
        signal: new AbortController().signal,
        timeoutMs: 1000,
      }),
    ).rejects.toThrow(/invalid/iu);
  });

  it('allows larger bounded image bodies while keeping text at the original limit', async () => {
    const body = 'x'.repeat(CAPABILITY_PROBE_LIMITS.maxResponseBodyBytes + 1);
    const transport = new NodeFetchCapabilityProbeTransport(
      async () =>
        new Response(body, { headers: { 'content-type': 'application/json' }, status: 200 }),
    );
    const base = {
      baseUrl: 'http://127.0.0.1:43119/v1',
      body: {},
      credential: syntheticInvalidCredential(),
      method: 'POST' as const,
      signal: new AbortController().signal,
      timeoutMs: 1000,
    };
    await expect(transport.request({ ...base, path: '/responses' })).rejects.toMatchObject({
      code: 'EBODYSIZE',
    });
    await expect(
      transport.request({ ...base, path: '/images/generations' }),
    ).resolves.toMatchObject({ status: 200 });
  });
});
