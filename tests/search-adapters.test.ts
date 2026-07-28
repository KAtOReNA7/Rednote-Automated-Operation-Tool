import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import {
  BrowserClipAdapter,
  CuratedSourceAdapter,
  LoopbackSearchApiCodec,
  ManualUrlAdapter,
  ModelWebSearchAdapter,
  SEARCH_LIMITS,
  ScriptedSearchApiCodec,
  ScriptedSearchApiTransport,
  SearchApiAdapter,
  SearchPlanner,
  SearchProviderRegistry,
} from '../packages/search/src/index.js';
import { searchRequest } from './search-fixtures.js';

const NOW = new Date('2026-07-28T00:00:00.000Z');

function context(plan: Awaited<ReturnType<SearchPlanner['createPlan']>>, searchRunId: string) {
  return { now: () => NOW, plan, searchRunId };
}

describe('five search adapters', () => {
  it('executes Manual URL locally without network, model or fees', async () => {
    const adapter = new ManualUrlAdapter();
    const registry = new SearchProviderRegistry();
    registry.register(adapter);
    const request = searchRequest({
      executionId: 'manual-execution',
      intent: 'USER_PROVIDED_URL',
      localInput: {
        kind: 'MANUAL_URL',
        note: 'user note',
        title: 'User source',
        url: 'https://example.com/source#fragment',
      },
      maxResults: 1,
      providerInstanceId: 'manual-url-v1',
      query: '',
    });
    const plan = await new SearchPlanner(registry, {
      idFactory: () => 'manual-plan',
      now: () => NOW,
    }).createPlan(
      request,
      { budgetIdentity: 'none', capabilityIdentity: 'none', settingsRevision: 1 },
      null,
      5_000,
    );
    const batch = await adapter.execute(request, context(plan, 'manual-run'));
    expect(batch.externalRequestCount).toBe(0);
    expect(batch.costState).toBe('NOT_INCURRED');
    expect(batch.candidates[0]).toMatchObject({
      canonicalUrl: 'https://example.com/source',
      evidenceEligibility: 'LEAD_ONLY',
      userSupplied: true,
    });
  });

  it('builds CuratedSource URLs locally with one percent-encoded placeholder', async () => {
    const adapter = new CuratedSourceAdapter([
      {
        entryId: 'publisher-catalog',
        intent: 'BOOK_DISCOVERY',
        languageHint: 'zh-CN',
        title: 'Publisher catalog',
        urlTemplate: 'https://publisher.example/search?q={query}',
      },
    ]);
    const registry = new SearchProviderRegistry();
    registry.register(adapter);
    const request = searchRequest({ query: '密室 推理' });
    const plan = await new SearchPlanner(registry, {
      idFactory: () => 'curated-plan',
      now: () => NOW,
    }).createPlan(
      request,
      { budgetIdentity: 'none', capabilityIdentity: 'none', settingsRevision: 1 },
      null,
      5_000,
    );
    const batch = await adapter.execute(request, context(plan, 'curated-run'));
    expect(batch.candidates[0]?.canonicalUrl).toContain('%E5%AF%86%E5%AE%A4%20%E6%8E%A8%E7%90%86');
    expect(batch.externalRequestCount).toBe(0);
  });

  it('keeps BrowserClip product execution pending for Issue 017', async () => {
    const adapter = new BrowserClipAdapter();
    expect(adapter.describe().readiness).toBe('PENDING_LATER_ISSUE');
    await expect(adapter.execute()).rejects.toMatchObject({
      code: 'SEARCH_PROVIDER_NOT_READY',
    });
  });

  it('uses only completed structured model sources and discards narrative URLs', async () => {
    const execute = vi.fn().mockResolvedValue({
      costState: 'UNPRICED_USAGE',
      executionId: 'search-execution-001:model',
      externalRequestCount: 1,
      modelRunId: 'model-run-001',
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      output: {
        partial: false,
        refusal: false,
        type: 'STRUCTURED',
        value: {
          citations: [
            {
              title: 'Structured citation',
              upstreamId: 'citation-1',
              url: 'https://example.com/structured#citation',
            },
          ],
          completed: true,
          contractVersion: 'model-web-search-result-v1',
          narrative: 'Ignore https://narrative.invalid/not-a-source',
          sources: [
            {
              languageHint: 'en',
              publishedAt: null,
              title: 'Structured source',
              upstreamId: 'source-1',
              url: 'https://example.com/structured',
            },
          ],
          toolExecuted: true,
        },
      },
      stableErrorCode: null,
      status: 'SUCCEEDED',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        source: 'PROVIDER',
        toolCalls: 1,
        totalTokens: 15,
        webSearchCalls: 1,
      },
    });
    const adapter = new ModelWebSearchAdapter({
      budgetReady: true,
      capabilityReadiness: 'SUPPORTED',
      credentialReady: true,
      enabled: true,
      execution: { execute },
      executionReady: true,
      modelId: 'research-model',
      protocolMode: 'RESPONSES',
      providerConfigFingerprint: 'a'.repeat(64),
      rateReady: true,
    });
    const registry = new SearchProviderRegistry();
    registry.register(adapter);
    const request = searchRequest({
      providerInstanceId: 'model-web-search-v1',
      ratePolicyRef: 'model-rate-policy-v1',
    });
    const rate = {
      contractVersion: 'search-rate-policy-v1' as const,
      maxConcurrent: 1,
      maxRequestsPerWindow: 10,
      maxResponseBytes: SEARCH_LIMITS.responseBytes,
      maxResults: 20,
      minIntervalMs: 1_000,
      revision: 1,
      timeoutMs: 30_000,
      windowMs: 60_000,
    };
    const plan = await new SearchPlanner(registry, {
      idFactory: () => 'model-plan',
      now: () => NOW,
    }).createPlan(
      request,
      { budgetIdentity: 'budget-v1', capabilityIdentity: 'cap-v1', settingsRevision: 1 },
      rate,
      30_000,
    );
    const batch = await adapter.execute(request, context(plan, 'model-run'));
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[0]).toMatchObject({
      budgetClassification: 'NONESSENTIAL',
      cachePolicy: 'BYPASS',
      requiredCapabilities: ['webSearch', 'toolCalling'],
      taskKind: 'WEB_SEARCH_PROVIDER_V1',
    });
    expect(batch.candidates.map((candidate) => candidate.canonicalUrl)).toEqual([
      'https://example.com/structured',
    ]);
    expect(batch.candidates[0]).toMatchObject({
      citationState: 'CITED',
      wasCited: true,
      wasConsulted: true,
    });
    expect(batch.candidates[0]?.provenanceAppearances).toHaveLength(2);

    execute.mockResolvedValueOnce({
      ...(await execute.mock.results[0]?.value),
      output: {
        partial: false,
        refusal: false,
        type: 'STRUCTURED',
        value: {
          citations: [],
          completed: false,
          contractVersion: 'model-web-search-result-v1',
          narrative: '',
          sources: [],
          toolExecuted: false,
        },
      },
    });
    await expect(
      adapter.execute(request, context(plan, 'model-incomplete-run')),
    ).rejects.toMatchObject({
      code: 'SEARCH_RESPONSE_INVALID',
      sendState: 'SENT',
    });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('rejects Curated templates that can change host or path', () => {
    for (const urlTemplate of [
      'https://{query}.example/search',
      'https://example.com/{query}',
      'https://example.com/search#{query}',
      'https://example.com/search?{query}=value',
    ]) {
      expect(
        () =>
          new CuratedSourceAdapter([
            {
              entryId: 'invalid-template',
              intent: 'BOOK_DISCOVERY',
              languageHint: null,
              title: 'Invalid template',
              urlTemplate,
            },
          ]),
      ).toThrowError('SEARCH_INVALID_REQUEST');
    }
  });

  it('keeps product Search API unconfigured and permits only a loopback test codec', () => {
    const adapter = new SearchApiAdapter({
      accountingReady: false,
      codec: null,
      credentialReference: null,
      credentialResolver: null,
      enabled: true,
      rateReady: true,
      transport: new ScriptedSearchApiTransport({
        body: new Uint8Array(),
        contentType: 'application/json',
        retryAfterSeconds: null,
        status: 200,
      }),
      transportLimits: {
        bodyTimeoutMs: 1_000,
        connectTimeoutMs: 1_000,
        headerBytes: 1_024,
        headerTimeoutMs: 1_000,
        maxDecompressedBytes: 1_024,
        maxRawBytes: 1_024,
        totalTimeoutMs: 2_000,
      },
    });
    expect(adapter.describe().readiness).toBe('CODEC_UNAVAILABLE');
    const registry = new SearchProviderRegistry();
    registry.register(adapter);
    registry.register(new ManualUrlAdapter());
    expect(registry.overallReadiness()).toBe('PASSIVE_ONLY');
    expect(() => registry.register(new ManualUrlAdapter())).toThrowError(
      'SEARCH_EXECUTION_CONFLICT',
    );
    expect(() => new LoopbackSearchApiCodec(new URL('http://example.com/search'))).toThrowError(
      'SEARCH_INVALID_REQUEST',
    );
  });

  it('surfaces one Search API 429 with Retry-After and never retries or falls back', async () => {
    const credential = randomBytes(32).toString('base64url');
    const transport = new ScriptedSearchApiTransport({
      body: new TextEncoder().encode('{}'),
      contentType: 'application/json',
      retryAfterSeconds: 17,
      status: 429,
    });
    const adapter = new SearchApiAdapter({
      accountingReady: true,
      codec: new ScriptedSearchApiCodec(),
      credentialReference: 'fixture-reference',
      credentialResolver: { resolveCredential: async () => credential },
      enabled: true,
      rateReady: true,
      transport,
      transportLimits: {
        bodyTimeoutMs: 1_000,
        connectTimeoutMs: 1_000,
        headerBytes: 1_024,
        headerTimeoutMs: 1_000,
        maxDecompressedBytes: 1_024,
        maxRawBytes: 1_024,
        totalTimeoutMs: 2_000,
      },
    });
    const registry = new SearchProviderRegistry();
    registry.register(adapter);
    const request = searchRequest({
      providerInstanceId: 'search-api-v1',
      ratePolicyRef: 'search-api-rate-policy-v1',
    });
    const plan = await new SearchPlanner(registry, {
      idFactory: () => 'search-api-plan',
      now: () => NOW,
    }).createPlan(
      request,
      { budgetIdentity: 'accounting-v1', capabilityIdentity: 'none', settingsRevision: 1 },
      {
        contractVersion: 'search-rate-policy-v1',
        maxConcurrent: 1,
        maxRequestsPerWindow: 10,
        maxResponseBytes: 1_024,
        maxResults: 10,
        minIntervalMs: 1_000,
        revision: 1,
        timeoutMs: 2_000,
        windowMs: 60_000,
      },
      2_000,
    );
    await expect(adapter.execute(request, context(plan, 'search-api-run'))).rejects.toMatchObject({
      code: 'SEARCH_RATE_LIMITED',
      safeDetails: { retryAfterSeconds: 17 },
      sendState: 'SENT',
    });
    expect(transport.calls).toBe(1);
    expect(plan.fallback).toBe('NONE');

    const echoingAdapter = new SearchApiAdapter({
      accountingReady: true,
      codec: new ScriptedSearchApiCodec(),
      credentialReference: 'fixture-reference',
      credentialResolver: { resolveCredential: async () => credential },
      enabled: true,
      rateReady: true,
      transport: new ScriptedSearchApiTransport({
        body: new TextEncoder().encode(credential),
        contentType: 'application/json',
        retryAfterSeconds: null,
        status: 200,
      }),
      transportLimits: {
        bodyTimeoutMs: 1_000,
        connectTimeoutMs: 1_000,
        headerBytes: 1_024,
        headerTimeoutMs: 1_000,
        maxDecompressedBytes: 1_024,
        maxRawBytes: 1_024,
        totalTimeoutMs: 2_000,
      },
    });
    const echoError = await echoingAdapter
      .execute(request, context(plan, 'credential-echo-run'))
      .catch((error: unknown) => error);
    expect(echoError).toMatchObject({
      code: 'SEARCH_RESPONSE_INVALID',
      sendState: 'SENT',
    });
    expect(JSON.stringify(echoError)).not.toContain(credential);
  });
});
