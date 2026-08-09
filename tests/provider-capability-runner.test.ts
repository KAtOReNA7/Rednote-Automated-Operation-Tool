import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_PROBE_MARKERS,
  CapabilityProbeRunner,
  NodeFetchCapabilityProbeTransport,
  buildCapabilityProbePlan,
} from '../packages/providers/src/index.js';
import {
  startCapabilityProbeFixture,
  syntheticInvalidCredential,
} from './support/capability-probe-fixture.js';

describe('Issue 013 serial no-retry capability runner', () => {
  it('deduplicates shared text slots and keeps a URL-only image result inconclusive', async () => {
    const paths: string[] = [];
    const runner = new CapabilityProbeRunner({
      request: async (request) => {
        paths.push(request.path);
        return request.path === '/responses'
          ? {
              body: JSON.stringify({
                output_text: JSON.stringify({ marker: CAPABILITY_PROBE_MARKERS.structured }),
              }),
              headers: { 'content-type': 'application/json' },
              status: 200,
            }
          : {
              body: JSON.stringify({ data: [{ url: 'https://invalid.example/image.png' }] }),
              headers: { 'content-type': 'application/json' },
              status: 200,
            };
      },
    });
    const plan = buildCapabilityProbePlan(
      {
        baseUrl: 'http://127.0.0.1:43119/v1',
        credentialBindingVersion: 1,
        models: {
          image: 'fixture-image',
          provider: 'shared-model',
          research: 'shared-model',
          review: 'review-model',
          writing: 'shared-model',
        },
        protocol: 'OPENAI_COMPATIBLE',
        settingsRevision: 1,
      },
      {
        includeToolCalling: false,
        profile: 'CUSTOM',
        selectedCapabilities: ['structuredJson', 'imageGeneration'],
        targetModelSlots: ['RESEARCH', 'WRITING', 'IMAGE'],
      },
    );
    const result = await runner.run(
      plan,
      'http://127.0.0.1:43119/v1',
      syntheticInvalidCredential(),
      {
        isConfigCurrent: () => true,
        runId: 'probe-runner-diagnostics-0001',
        signal: new AbortController().signal,
      },
    );

    expect(plan.requestCount).toBe(2);
    expect(paths).toEqual(['/responses', '/images/generations']);
    expect(result.status).toBe('SUCCEEDED');
    expect(result.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capability: 'structuredJson',
          modelSlots: ['RESEARCH', 'WRITING'],
          state: 'SUPPORTED',
        }),
        expect.objectContaining({
          capability: 'imageGeneration',
          modelSlots: ['IMAGE'],
          reasonCode: 'OUTPUT_VARIANT_UNSUPPORTED',
          state: 'UNKNOWN',
        }),
      ]),
    );
  });

  it('executes a complete CORE plan once per step against loopback only', async () => {
    const credential = syntheticInvalidCredential();
    const fixture = await startCapabilityProbeFixture({ expectedCredential: credential });
    try {
      const plan = buildCapabilityProbePlan(
        {
          baseUrl: fixture.baseUrl,
          credentialBindingVersion: 1,
          models: {
            image: null,
            provider: 'fixture-model',
            research: 'fixture-model',
            review: 'fixture-model',
            writing: 'fixture-model',
          },
          protocol: 'OPENAI_COMPATIBLE',
          settingsRevision: 1,
        },
        { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
      );
      const result = await new CapabilityProbeRunner(new NodeFetchCapabilityProbeTransport()).run(
        plan,
        fixture.baseUrl,
        credential,
        {
          isConfigCurrent: () => true,
          runId: 'probe-runner-000001',
          signal: new AbortController().signal,
        },
      );

      expect(result.status).toBe('SUCCEEDED');
      expect(result.sentRequestCount).toBe(plan.requestCount);
      expect(fixture.requests).toHaveLength(plan.requestCount);
      expect(fixture.requests.every((request) => request.authorizationPresent)).toBe(true);
      expect(fixture.requests.filter((request) => request.path === '/v1/models')).toHaveLength(1);
    } finally {
      await fixture.close();
    }
  });

  it('stops globally on authentication rejection without retrying', async () => {
    let count = 0;
    const runner = new CapabilityProbeRunner({
      request: async () => {
        count += 1;
        return {
          body: JSON.stringify({ error: { code: 'invalid_api_key' } }),
          headers: { 'content-type': 'application/json' },
          status: 401,
        };
      },
    });
    const plan = buildCapabilityProbePlan(
      {
        baseUrl: 'http://127.0.0.1:43119/v1',
        credentialBindingVersion: 1,
        models: {
          image: null,
          provider: 'fixture-model',
          research: 'fixture-model',
          review: 'fixture-model',
          writing: 'fixture-model',
        },
        protocol: 'OPENAI_COMPATIBLE',
        settingsRevision: 1,
      },
      { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
    );
    const result = await runner.run(
      plan,
      'http://127.0.0.1:43119/v1',
      syntheticInvalidCredential(),
      {
        isConfigCurrent: () => true,
        runId: 'probe-runner-000002',
        signal: new AbortController().signal,
      },
    );

    expect(result).toMatchObject({
      reasonCode: 'AUTHENTICATION_REJECTED',
      sentRequestCount: 1,
      status: 'PARTIAL',
    });
    expect(count).toBe(1);
  });

  it('cancels the current request and never sends later steps', async () => {
    const controller = new AbortController();
    let count = 0;
    const runner = new CapabilityProbeRunner({
      request: async ({ signal }) => {
        count += 1;
        controller.abort();
        throw signal.aborted
          ? new DOMException('aborted', 'AbortError')
          : new Error('expected abort');
      },
    });
    const plan = buildCapabilityProbePlan(
      {
        baseUrl: 'http://127.0.0.1:43119/v1',
        credentialBindingVersion: 1,
        models: {
          image: null,
          provider: 'fixture-model',
          research: 'fixture-model',
          review: 'fixture-model',
          writing: 'fixture-model',
        },
        protocol: 'OPENAI_COMPATIBLE',
        settingsRevision: 1,
      },
      { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
    );
    const result = await runner.run(
      plan,
      'http://127.0.0.1:43119/v1',
      syntheticInvalidCredential(),
      {
        isConfigCurrent: () => true,
        runId: 'probe-runner-000003',
        signal: controller.signal,
      },
    );

    expect(result.status).toBe('CANCELLED');
    expect(count).toBe(1);
  });
});
