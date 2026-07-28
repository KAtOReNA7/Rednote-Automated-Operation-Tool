import { describe, expect, it } from 'vitest';

import {
  FETCH_ERROR_CODES,
  FETCH_RUN_STATUSES,
  createDefaultFetchProfileV1,
  createFetchPlanV1,
  fetchRequestSemanticHash,
  validateFetchPlanForExecution,
  validateFetchPlanV1,
  validateFetchProfileV1,
  validateFetchRequestV1,
  validateFetchExecuteJobPayloadV1,
  validateFetchExecuteJobResultV1,
} from '../packages/fetch/src/index.js';
import {
  FETCH_NOW,
  enabledFetchProfile,
  fetchCandidate,
  fetchPlan,
  fetchRequest,
} from './fetch-fixtures.js';

describe('ControlledFetch V1 contracts', () => {
  it('keeps request exact, bounded and free of raw network controls', () => {
    const request = fetchRequest();
    expect(validateFetchRequestV1(request)).toEqual(request);
    expect(Object.keys(request)).not.toContain('url');
    expect(Object.keys(request)).not.toContain('headers');
    expect(Object.keys(request)).not.toContain('proxy');
    expect(() => validateFetchRequestV1({ ...request, url: 'https://example.test' })).toThrow(
      'FETCH_INVALID_REQUEST',
    );
    expect(() =>
      validateFetchRequestV1({ ...request, selectionKind: 'USER_SELECTED', extra: true }),
    ).toThrow('FETCH_INVALID_REQUEST');
  });

  it('binds candidate, request, profile and every frozen policy in a hashed plan', () => {
    const candidate = fetchCandidate();
    const profile = enabledFetchProfile();
    const request = fetchRequest(candidate, profile);
    const plan = fetchPlan(candidate, profile, request);
    expect(validateFetchPlanV1(plan)).toEqual(plan);
    expect(plan.requestSemanticHash).toBe(fetchRequestSemanticHash(request));
    expect(plan.candidate).toMatchObject({
      evidenceEligibility: 'LEAD_ONLY',
      factStatus: 'NOT_A_FACT',
      fetchState: 'NOT_FETCHED',
      truthStatus: 'UNVERIFIED',
    });
    expect(() =>
      validateFetchPlanForExecution(
        plan,
        request,
        candidate,
        { ...profile, revision: 2 },
        new Date(FETCH_NOW),
      ),
    ).toThrow('FETCH_PLAN_STALE');
    expect(() =>
      createFetchPlanV1({
        candidate,
        expiresAt: '2026-07-27T23:59:59.000Z',
        profile,
        request,
      }),
    ).toThrow();
  });

  it('defaults disabled with bounded per-origin concurrency and no retry state', () => {
    const profile = validateFetchProfileV1(createDefaultFetchProfileV1());
    expect(profile.enabled).toBe(false);
    expect(profile.ratePolicy.perOriginMaxConcurrent).toBe(1);
    expect(profile.limits.redirectCount).toBe(3);
    expect(profile.limits.maxExternalRequests).toBe(6);
    expect(FETCH_RUN_STATUSES).toContain('AMBIGUOUS');
    expect(FETCH_RUN_STATUSES).not.toContain('RETRYING');
  });

  it('freezes the complete stable error vocabulary', () => {
    expect(FETCH_ERROR_CODES).toHaveLength(42);
    expect(FETCH_ERROR_CODES).toEqual(
      expect.arrayContaining([
        'FETCH_DNS_REBINDING',
        'FETCH_REMOTE_ADDRESS_MISMATCH',
        'FETCH_ROBOTS_UNKNOWN',
        'FETCH_PRIVACY_REVIEW_REQUIRED',
        'FETCH_AMBIGUOUS',
      ]),
    );
  });

  it('bounds the queue payload/result and rejects page content fields', () => {
    const request = fetchRequest();
    const plan = fetchPlan();
    const payload = {
      contractVersion: 'controlled-fetch-v1',
      jobType: 'FETCH_PUBLIC_PAGE_V1',
      planHash: plan.planHash,
      request,
    };
    expect(validateFetchExecuteJobPayloadV1(payload)).toEqual(payload);
    expect(() =>
      validateFetchExecuteJobPayloadV1({ ...payload, html: '<main>not allowed</main>' }),
    ).toThrow('FETCH_INVALID_REQUEST');
    const result = {
      documentId: null,
      externalRequestCount: 2,
      fetchRunId: 'fetch-run-001',
      receivedBytes: 1_024,
      redactionCounts: { addresses: 0, emails: 1, phones: 0 },
      redirectCount: 0,
      stableError: null,
      status: 'SUCCEEDED',
    };
    expect(validateFetchExecuteJobResultV1(result)).toEqual(result);
    expect(() => validateFetchExecuteJobResultV1({ ...result, text: 'not allowed' })).toThrow(
      'FETCH_INVALID_REQUEST',
    );
  });
});
