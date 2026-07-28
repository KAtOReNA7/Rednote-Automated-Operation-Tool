import { describe, expect, it } from 'vitest';

import {
  SEARCH_ERROR_CODES,
  SEARCH_LIMITS,
  ManualUrlAdapter,
  normalizeSearchCandidates,
  validateSearchBatchV1,
  validateSearchCandidateV1,
  validateSearchFixtureV1,
  validateSearchProviderDescriptorV1,
  validateSearchRatePolicyV1,
  validateSearchRequestV1,
} from '../packages/search/src/index.js';
import { appearance, searchRequest } from './search-fixtures.js';

describe('SearchProviderV1 contracts', () => {
  it('freezes the five provider kinds and all stable search errors', () => {
    expect(SEARCH_ERROR_CODES).toHaveLength(25);
    expect(new Set(SEARCH_ERROR_CODES).size).toBe(25);
    expect(SEARCH_ERROR_CODES).toContain('SEARCH_AMBIGUOUS');
    expect(SEARCH_ERROR_CODES).toContain('SEARCH_PLAN_STALE');
  });

  it('accepts only exact bounded requests', () => {
    const valid = validateSearchRequestV1(searchRequest());
    expect(Object.isFrozen(valid)).toBe(true);
    expect(() =>
      validateSearchRequestV1({
        ...searchRequest(),
        query: 'q'.repeat(SEARCH_LIMITS.queryCharacters + 1),
      }),
    ).toThrowError('SEARCH_QUERY_TOO_LARGE');
    expect(() => validateSearchRequestV1({ ...searchRequest(), arbitrary: true })).toThrowError(
      'SEARCH_INVALID_REQUEST',
    );
    expect(() =>
      validateSearchRequestV1({
        ...searchRequest(),
        cursor: '密'.repeat(1_000),
      }),
    ).toThrowError('SEARCH_INVALID_REQUEST');
    expect(() =>
      validateSearchRequestV1({
        ...searchRequest(),
        allowedDomains: ['例子.测试', 'xn--fsqu00a.xn--0zwm56d'],
      }),
    ).toThrowError('SEARCH_DOMAIN_INVALID');
  });

  it('requires a complete versioned remote rate policy', () => {
    const policy = validateSearchRatePolicyV1({
      contractVersion: 'search-rate-policy-v1',
      maxConcurrent: 1,
      maxRequestsPerWindow: 20,
      maxResponseBytes: 1024,
      maxResults: 10,
      minIntervalMs: 100,
      revision: 1,
      timeoutMs: 5_000,
      windowMs: 60_000,
    });
    expect(policy.revision).toBe(1);
    expect(() => validateSearchRatePolicyV1({ ...policy, maxConcurrent: 0 })).toThrowError(
      'SEARCH_RATE_POLICY_REQUIRED',
    );
  });

  it('declares every feature and readiness facet explicitly', () => {
    const descriptor = validateSearchProviderDescriptorV1(new ManualUrlAdapter().describe());
    expect(Object.keys(descriptor.features).sort()).toEqual([
      'allowedDomains',
      'blockedDomains',
      'countryHint',
      'cursor',
      'hardDomainFilter',
      'liveAccess',
      'localeHints',
      'manualUrl',
      'publishedDateRange',
      'query',
      'structuredSources',
    ]);
    expect(descriptor.budgetState).toBe('NOT_APPLICABLE');
    expect(descriptor.credentialState).toBe('NOT_APPLICABLE');
  });

  it('enforces the fixed request limits from the Issue 015 contract', () => {
    expect(SEARCH_LIMITS).toMatchObject({
      cursorBytes: 2_048,
      domainCount: 100,
      localeCount: 4,
      maxCandidates: 20,
      noteCharacters: 2_000,
      previewCharacters: 2_000,
      queryCharacters: 512,
      titleCharacters: 512,
      urlCharacters: 4_096,
    });
  });

  it('rejects candidate and batch metadata that is not internally coherent', () => {
    const descriptor = new ManualUrlAdapter().describe();
    const candidate = normalizeSearchCandidates([appearance('https://example.com/a')], {
      descriptor,
      discoveredAt: '2026-07-28T00:00:00.000Z',
      request: searchRequest({ maxResults: 1 }),
      searchRunId: 'candidate-validation-run',
    }).candidates[0];
    expect(candidate).toBeDefined();
    expect(() =>
      validateSearchCandidateV1({
        ...candidate,
        canonicalUrl: 'https://example.com/tampered',
      }),
    ).toThrowError('SEARCH_RESULT_INVALID');
    expect(() =>
      validateSearchCandidateV1({
        ...candidate,
        previewKind: 'NONE',
        previewText: '<script>not evidence</script>',
      }),
    ).toThrowError('SEARCH_RESULT_INVALID');

    const batch = {
      candidates: [candidate],
      certainty: 'COMPLETED_INVALID_OUTPUT',
      contractVersion: 'search-provider-v1',
      costState: 'NOT_INCURRED',
      counts: { accepted: 1, duplicates: 0, rejected: 0, totalAppearances: 1 },
      cursor: null,
      executionId: 'batch-execution',
      externalRequestCount: 0,
      finishedAt: '2026-07-28T00:00:01.000Z',
      modelRunId: null,
      provider: {
        contractVersion: 'search-provider-v1',
        kind: descriptor.kind,
        mode: descriptor.mode,
        providerInstanceId: descriptor.providerInstanceId,
        readiness: descriptor.readiness,
      },
      requestSemanticHash: 'a'.repeat(64),
      searchRunId: 'candidate-validation-run',
      stableError: null,
      startedAt: '2026-07-28T00:00:00.000Z',
      status: 'SUCCEEDED',
      truncated: false,
      usage: null,
      warnings: [],
    } as const;
    expect(validateSearchBatchV1(batch).counts.accepted).toBe(1);
    expect(() => validateSearchBatchV1({ ...batch, cursor: '密'.repeat(1_000) })).toThrowError(
      'SEARCH_RESPONSE_INVALID',
    );
    expect(() =>
      validateSearchBatchV1({
        ...batch,
        candidates: [{ ...candidate, providerInstanceId: 'other-provider' }],
      }),
    ).toThrowError('SEARCH_RESPONSE_INVALID');
  });

  it('validates every offline fixture appearance instead of trusting fixture JSON', () => {
    expect(
      validateSearchFixtureV1({
        appearances: [appearance('https://example.com/offline')],
        contractVersion: 'search-fixture-v1',
        fixtureId: 'offline-fixture',
      }).appearances,
    ).toHaveLength(1);
    expect(() =>
      validateSearchFixtureV1({
        appearances: [{ ...appearance('https://example.com/offline'), extra: true }],
        contractVersion: 'search-fixture-v1',
        fixtureId: 'offline-fixture',
      }),
    ).toThrowError('SEARCH_RESULT_INVALID');
  });
});
