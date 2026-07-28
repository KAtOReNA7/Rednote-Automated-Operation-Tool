import { describe, expect, it } from 'vitest';

import {
  CapabilityProbeRunner,
  NodeFetchCapabilityProbeTransport,
  buildCapabilityProbePlan,
} from '../packages/providers/src/index.js';
import {
  startCapabilityProbeFixture,
  syntheticInvalidCredential,
} from './support/capability-probe-fixture.js';

describe('Issue 013 serial no-retry capability runner', () => {
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
