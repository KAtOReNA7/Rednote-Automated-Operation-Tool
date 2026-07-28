import { createHash } from 'node:crypto';

import {
  SEARCH_EVIDENCE_ELIGIBILITY,
  SEARCH_FACT_STATUS,
  SEARCH_FETCH_STATE,
  SEARCH_TRUTH_STATUS,
  type SearchCandidateV1,
  validateSearchCandidateV1,
} from '@mystery-operations/search';
import type { ManagedRelativePath } from '@mystery-operations/shared/storage';
import { isManagedRelativePath } from '@mystery-operations/shared/storage';

import {
  CONTROLLED_FETCH_CONTRACT_VERSION,
  FETCH_CHARSET_POLICY_VERSION,
  FETCH_DNS_POLICY_VERSION,
  FETCH_EVIDENCE_ELIGIBILITY,
  FETCH_EXTRACTOR_VERSION,
  FETCH_FACT_STATUS,
  FETCH_LIMITS,
  FETCH_MIME_POLICY_VERSION,
  FETCH_PLAN_CONTRACT_VERSION,
  FETCH_PRIVACY_POLICY_VERSION,
  FETCH_PROFILE_CONTRACT_VERSION,
  FETCH_REDIRECT_POLICY_VERSION,
  FETCH_ROBOTS_POLICY_VERSION,
  FETCH_RUN_STATUSES,
  FETCH_SANITIZER_VERSION,
  FETCH_SELECTION_KINDS,
  FETCH_TERMINAL_STATUSES,
  FETCH_TRUTH_STATUS,
  type FetchCharset,
  type FetchMimeType,
  type FetchRunStatus,
  type FetchSelectionKind,
  type FetchTerminalStatus,
} from './constants.js';
import { FetchError } from './errors.js';

export interface FetchRequestV1 {
  readonly contractVersion: typeof CONTROLLED_FETCH_CONTRACT_VERSION;
  readonly executionId: string;
  readonly expectedCanonicalUrlHash: string;
  readonly fetchProfileId: string;
  readonly jobId: string | null;
  readonly profileRevision: number;
  readonly requestedAt: string;
  readonly searchCandidateId: string;
  readonly selectionKind: FetchSelectionKind;
  readonly selectionReasonCode: string;
}

export interface FetchProfileV1 {
  readonly contractVersion: typeof FETCH_PROFILE_CONTRACT_VERSION;
  readonly enabled: boolean;
  readonly globalMaxConcurrent: number;
  readonly id: string;
  readonly limits: {
    readonly connectTimeoutMs: number;
    readonly bodyTimeoutMs: number;
    readonly decodedBytes: number;
    readonly domDepth: number;
    readonly domNodes: number;
    readonly headerBytes: number;
    readonly headerCount: number;
    readonly headerTimeoutMs: number;
    readonly maxExternalRequests: number;
    readonly rawBytes: number;
    readonly redirectCount: number;
    readonly sanitizedBytes: number;
    readonly textBytes: number;
    readonly totalTimeoutMs: number;
  };
  readonly ratePolicy: {
    readonly maxRequestsPerWindow: number;
    readonly minIntervalMs: number;
    readonly perOriginMaxConcurrent: 1;
    readonly revision: number;
    readonly windowMs: number;
  };
  readonly revision: number;
}

export interface FetchCandidateBindingV1 {
  readonly canonicalUrl: string;
  readonly canonicalUrlHash: string;
  readonly evidenceEligibility: 'LEAD_ONLY';
  readonly factStatus: 'NOT_A_FACT';
  readonly fetchState: 'NOT_FETCHED';
  readonly origin: string;
  readonly searchCandidateId: string;
  readonly truthStatus: 'UNVERIFIED';
}

export interface FetchPlanV1 {
  readonly candidate: FetchCandidateBindingV1;
  readonly charsetPolicyVersion: typeof FETCH_CHARSET_POLICY_VERSION;
  readonly contractVersion: typeof FETCH_PLAN_CONTRACT_VERSION;
  readonly dnsPolicyVersion: typeof FETCH_DNS_POLICY_VERSION;
  readonly expiresAt: string;
  readonly limits: FetchProfileV1['limits'];
  readonly mimePolicyVersion: typeof FETCH_MIME_POLICY_VERSION;
  readonly planHash: string;
  readonly privacyPolicyVersion: typeof FETCH_PRIVACY_POLICY_VERSION;
  readonly profile: FetchProfileV1;
  readonly ratePolicyIdentity: string;
  readonly redirectPolicyVersion: typeof FETCH_REDIRECT_POLICY_VERSION;
  readonly requestSemanticHash: string;
  readonly robotsPolicyVersion: typeof FETCH_ROBOTS_POLICY_VERSION;
  readonly storageEstimateBytes: number;
}

export interface RedirectHopV1 {
  readonly fromHost: string;
  readonly fromUrlHash: string;
  readonly hop: number;
  readonly policyResult: 'FOLLOWED' | 'REJECTED';
  readonly statusCode: number;
  readonly toHost: string;
  readonly toUrlHash: string;
}

export interface RobotsDecisionV1 {
  readonly bodyHash: string | null;
  readonly checkedAt: string;
  readonly crawlDelayMs: number;
  readonly expiresAt: string;
  readonly origin: string;
  readonly policyVersion: typeof FETCH_ROBOTS_POLICY_VERSION;
  readonly result: 'ALLOWED' | 'DISALLOWED' | 'UNKNOWN';
  readonly rules: readonly {
    readonly allow: boolean;
    readonly pattern: string;
  }[];
  readonly userAgent: string;
}

export interface FetchRedactionCountsV1 {
  readonly addresses: number;
  readonly emails: number;
  readonly phones: number;
}

export interface FetchedDocumentV1 {
  readonly charset: FetchCharset;
  readonly contractVersion: typeof CONTROLLED_FETCH_CONTRACT_VERSION;
  readonly createdAt: string;
  readonly documentId: string;
  readonly evidenceEligibility: typeof FETCH_EVIDENCE_ELIGIBILITY;
  readonly extractedTextBytes: number;
  readonly extractedTextHash: string;
  readonly extractedTextPath: ManagedRelativePath;
  readonly extractorVersion: typeof FETCH_EXTRACTOR_VERSION;
  readonly factStatus: typeof FETCH_FACT_STATUS;
  readonly finalCanonicalUrl: string;
  readonly finalCanonicalUrlHash: string;
  readonly languageHint: string | null;
  readonly mimeType: FetchMimeType;
  readonly normalizedDocumentContentHash: string;
  readonly privacyPolicyVersion: typeof FETCH_PRIVACY_POLICY_VERSION;
  readonly rawBodyHash: string;
  readonly redactionCounts: FetchRedactionCountsV1;
  readonly sanitizedHtmlBytes: number;
  readonly sanitizedHtmlHash: string;
  readonly sanitizedHtmlPath: ManagedRelativePath;
  readonly sanitizerVersion: typeof FETCH_SANITIZER_VERSION;
  readonly truthStatus: typeof FETCH_TRUTH_STATUS;
}

export interface FetchStableErrorV1 {
  readonly code: string;
  readonly retryable: boolean;
}

export interface FetchOutcomeV1 {
  readonly charset: FetchCharset | null;
  readonly contractVersion: typeof CONTROLLED_FETCH_CONTRACT_VERSION;
  readonly document: FetchedDocumentV1 | null;
  readonly executionId: string;
  readonly externalRequestCount: number;
  readonly fetchRunId: string;
  readonly finishedAt: string;
  readonly mimeType: FetchMimeType | null;
  readonly receivedBytes: number;
  readonly redactionCounts: FetchRedactionCountsV1;
  readonly redirectCount: number;
  readonly stableError: FetchStableErrorV1 | null;
  readonly status: FetchTerminalStatus;
}

export interface FetchRunV1 {
  readonly candidateId: string;
  readonly executionId: string;
  readonly externalRequestCount: number;
  readonly fetchRunId: string;
  readonly requestSemanticHash: string;
  readonly revision: number;
  readonly stage: FetchRunStatus;
  readonly startedAt: string;
}

export function createDefaultFetchProfileV1(): FetchProfileV1 {
  return Object.freeze({
    contractVersion: FETCH_PROFILE_CONTRACT_VERSION,
    enabled: false,
    globalMaxConcurrent: 2,
    id: 'controlled-public-page-v1',
    limits: Object.freeze({
      connectTimeoutMs: 10_000,
      bodyTimeoutMs: 30_000,
      decodedBytes: FETCH_LIMITS.decodedBytes,
      domDepth: FETCH_LIMITS.domDepth,
      domNodes: FETCH_LIMITS.domNodes,
      headerBytes: FETCH_LIMITS.headerBytes,
      headerCount: FETCH_LIMITS.headerCount,
      headerTimeoutMs: 15_000,
      maxExternalRequests: FETCH_LIMITS.maxExternalRequests,
      rawBytes: FETCH_LIMITS.rawBytes,
      redirectCount: FETCH_LIMITS.redirectCount,
      sanitizedBytes: FETCH_LIMITS.sanitizedBytes,
      textBytes: FETCH_LIMITS.textBytes,
      totalTimeoutMs: 60_000,
    }),
    ratePolicy: Object.freeze({
      maxRequestsPerWindow: 30,
      minIntervalMs: 2_000,
      perOriginMaxConcurrent: 1,
      revision: 1,
      windowMs: 60_000,
    }),
    revision: 1,
  });
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= FETCH_LIMITS.identifierCharacters &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  );
}

function validHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
}

function validIso(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function validInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function serializedBytes(value: unknown): number {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function fetchSemanticHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
}

export function validateFetchRequestV1(value: unknown): FetchRequestV1 {
  if (
    !isObject(value) ||
    !exact(value, [
      'contractVersion',
      'executionId',
      'expectedCanonicalUrlHash',
      'fetchProfileId',
      'jobId',
      'profileRevision',
      'requestedAt',
      'searchCandidateId',
      'selectionKind',
      'selectionReasonCode',
    ]) ||
    serializedBytes(value) > FETCH_LIMITS.contractBytes ||
    value.contractVersion !== CONTROLLED_FETCH_CONTRACT_VERSION ||
    !validIdentifier(value.executionId) ||
    !validIdentifier(value.searchCandidateId) ||
    !validHash(value.expectedCanonicalUrlHash) ||
    !FETCH_SELECTION_KINDS.includes(value.selectionKind as FetchSelectionKind) ||
    !validIdentifier(value.selectionReasonCode) ||
    !validIdentifier(value.fetchProfileId) ||
    !validInteger(value.profileRevision, 1, Number.MAX_SAFE_INTEGER) ||
    !validIso(value.requestedAt) ||
    (value.jobId !== null && !validIdentifier(value.jobId))
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  return Object.freeze(value as unknown as FetchRequestV1);
}

export function validateFetchProfileV1(value: unknown): FetchProfileV1 {
  if (
    !isObject(value) ||
    !exact(value, [
      'contractVersion',
      'enabled',
      'globalMaxConcurrent',
      'id',
      'limits',
      'ratePolicy',
      'revision',
    ]) ||
    value.contractVersion !== FETCH_PROFILE_CONTRACT_VERSION ||
    !validIdentifier(value.id) ||
    typeof value.enabled !== 'boolean' ||
    !validInteger(value.globalMaxConcurrent, 1, 8) ||
    !validInteger(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !isObject(value.limits) ||
    !exact(value.limits, [
      'connectTimeoutMs',
      'bodyTimeoutMs',
      'decodedBytes',
      'domDepth',
      'domNodes',
      'headerBytes',
      'headerCount',
      'headerTimeoutMs',
      'maxExternalRequests',
      'rawBytes',
      'redirectCount',
      'sanitizedBytes',
      'textBytes',
      'totalTimeoutMs',
    ]) ||
    !validInteger(value.limits.connectTimeoutMs, 100, 60_000) ||
    !validInteger(value.limits.bodyTimeoutMs, 100, 120_000) ||
    !validInteger(value.limits.headerTimeoutMs, 100, 60_000) ||
    !validInteger(value.limits.totalTimeoutMs, 500, 300_000) ||
    !validInteger(value.limits.headerBytes, 1_024, FETCH_LIMITS.headerBytes) ||
    !validInteger(value.limits.headerCount, 1, FETCH_LIMITS.headerCount) ||
    !validInteger(value.limits.rawBytes, 1_024, FETCH_LIMITS.rawBytes) ||
    !validInteger(value.limits.decodedBytes, 1_024, FETCH_LIMITS.decodedBytes) ||
    value.limits.decodedBytes < value.limits.rawBytes ||
    !validInteger(value.limits.domNodes, 100, FETCH_LIMITS.domNodes) ||
    !validInteger(value.limits.domDepth, 4, FETCH_LIMITS.domDepth) ||
    !validInteger(value.limits.sanitizedBytes, 1_024, FETCH_LIMITS.sanitizedBytes) ||
    !validInteger(value.limits.textBytes, 1_024, FETCH_LIMITS.textBytes) ||
    !validInteger(value.limits.redirectCount, 0, FETCH_LIMITS.redirectCount) ||
    !validInteger(value.limits.maxExternalRequests, 2, FETCH_LIMITS.maxExternalRequests) ||
    value.limits.maxExternalRequests < value.limits.redirectCount + 3 ||
    !isObject(value.ratePolicy) ||
    !exact(value.ratePolicy, [
      'maxRequestsPerWindow',
      'minIntervalMs',
      'perOriginMaxConcurrent',
      'revision',
      'windowMs',
    ]) ||
    value.ratePolicy.perOriginMaxConcurrent !== 1 ||
    !validInteger(value.ratePolicy.minIntervalMs, 0, 86_400_000) ||
    !validInteger(value.ratePolicy.maxRequestsPerWindow, 1, 10_000) ||
    !validInteger(value.ratePolicy.windowMs, 1_000, 86_400_000) ||
    !validInteger(value.ratePolicy.revision, 1, Number.MAX_SAFE_INTEGER) ||
    serializedBytes(value) > FETCH_LIMITS.contractBytes
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  return Object.freeze(value as unknown as FetchProfileV1);
}

export function fetchRequestSemanticHash(request: FetchRequestV1): string {
  return fetchSemanticHash(validateFetchRequestV1(request));
}

export function candidateBindingFromSearchCandidate(
  candidateValue: SearchCandidateV1,
): FetchCandidateBindingV1 {
  const candidate = validateSearchCandidateV1(candidateValue);
  if (
    candidate.evidenceEligibility !== SEARCH_EVIDENCE_ELIGIBILITY ||
    candidate.fetchState !== SEARCH_FETCH_STATE ||
    candidate.truthStatus !== SEARCH_TRUTH_STATUS ||
    candidate.factStatus !== SEARCH_FACT_STATUS
  ) {
    throw new FetchError('FETCH_CANDIDATE_BINDING_MISMATCH');
  }
  const url = new URL(candidate.canonicalUrl);
  return Object.freeze({
    canonicalUrl: candidate.canonicalUrl,
    canonicalUrlHash: candidate.urlHash,
    evidenceEligibility: 'LEAD_ONLY',
    factStatus: 'NOT_A_FACT',
    fetchState: 'NOT_FETCHED',
    origin: url.origin,
    searchCandidateId: candidate.candidateId,
    truthStatus: 'UNVERIFIED',
  });
}

function validateCandidateBinding(value: unknown): FetchCandidateBindingV1 {
  if (
    !isObject(value) ||
    !exact(value, [
      'canonicalUrl',
      'canonicalUrlHash',
      'evidenceEligibility',
      'factStatus',
      'fetchState',
      'origin',
      'searchCandidateId',
      'truthStatus',
    ]) ||
    !validIdentifier(value.searchCandidateId) ||
    typeof value.canonicalUrl !== 'string' ||
    value.canonicalUrl.length > FETCH_LIMITS.urlCharacters ||
    !validHash(value.canonicalUrlHash) ||
    value.evidenceEligibility !== 'LEAD_ONLY' ||
    value.fetchState !== 'NOT_FETCHED' ||
    value.truthStatus !== 'UNVERIFIED' ||
    value.factStatus !== 'NOT_A_FACT' ||
    typeof value.origin !== 'string'
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  try {
    const url = new URL(value.canonicalUrl);
    if (url.origin !== value.origin) throw new Error('origin mismatch');
  } catch (cause) {
    throw new FetchError('FETCH_INVALID_REQUEST', { cause });
  }
  return Object.freeze(value as unknown as FetchCandidateBindingV1);
}

export function createFetchPlanV1(input: {
  readonly candidate: SearchCandidateV1;
  readonly expiresAt: string;
  readonly profile: FetchProfileV1;
  readonly request: FetchRequestV1;
}): FetchPlanV1 {
  const request = validateFetchRequestV1(input.request);
  const profile = validateFetchProfileV1(input.profile);
  const candidate = candidateBindingFromSearchCandidate(input.candidate);
  if (
    request.searchCandidateId !== candidate.searchCandidateId ||
    request.expectedCanonicalUrlHash !== candidate.canonicalUrlHash ||
    request.fetchProfileId !== profile.id ||
    request.profileRevision !== profile.revision ||
    !validIso(input.expiresAt) ||
    input.expiresAt <= request.requestedAt
  ) {
    throw new FetchError('FETCH_CANDIDATE_BINDING_MISMATCH');
  }
  const planBase = {
    candidate,
    charsetPolicyVersion: FETCH_CHARSET_POLICY_VERSION,
    contractVersion: FETCH_PLAN_CONTRACT_VERSION,
    dnsPolicyVersion: FETCH_DNS_POLICY_VERSION,
    expiresAt: input.expiresAt,
    limits: profile.limits,
    mimePolicyVersion: FETCH_MIME_POLICY_VERSION,
    privacyPolicyVersion: FETCH_PRIVACY_POLICY_VERSION,
    profile,
    ratePolicyIdentity: `${profile.id}:${profile.ratePolicy.revision}`,
    redirectPolicyVersion: FETCH_REDIRECT_POLICY_VERSION,
    requestSemanticHash: fetchRequestSemanticHash(request),
    robotsPolicyVersion: FETCH_ROBOTS_POLICY_VERSION,
    storageEstimateBytes: profile.limits.sanitizedBytes + profile.limits.textBytes,
  };
  return Object.freeze({ ...planBase, planHash: fetchSemanticHash(planBase) });
}

export function validateFetchPlanV1(value: unknown): FetchPlanV1 {
  if (
    !isObject(value) ||
    !exact(value, [
      'candidate',
      'charsetPolicyVersion',
      'contractVersion',
      'dnsPolicyVersion',
      'expiresAt',
      'limits',
      'mimePolicyVersion',
      'planHash',
      'privacyPolicyVersion',
      'profile',
      'ratePolicyIdentity',
      'redirectPolicyVersion',
      'requestSemanticHash',
      'robotsPolicyVersion',
      'storageEstimateBytes',
    ]) ||
    value.contractVersion !== FETCH_PLAN_CONTRACT_VERSION ||
    value.charsetPolicyVersion !== FETCH_CHARSET_POLICY_VERSION ||
    value.dnsPolicyVersion !== FETCH_DNS_POLICY_VERSION ||
    value.mimePolicyVersion !== FETCH_MIME_POLICY_VERSION ||
    value.privacyPolicyVersion !== FETCH_PRIVACY_POLICY_VERSION ||
    value.redirectPolicyVersion !== FETCH_REDIRECT_POLICY_VERSION ||
    value.robotsPolicyVersion !== FETCH_ROBOTS_POLICY_VERSION ||
    !validIso(value.expiresAt) ||
    !validHash(value.planHash) ||
    !validHash(value.requestSemanticHash) ||
    typeof value.ratePolicyIdentity !== 'string' ||
    !validInteger(
      value.storageEstimateBytes,
      1,
      FETCH_LIMITS.sanitizedBytes + FETCH_LIMITS.textBytes,
    )
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  const profile = validateFetchProfileV1(value.profile);
  const candidate = validateCandidateBinding(value.candidate);
  if (
    JSON.stringify(value.limits) !== JSON.stringify(profile.limits) ||
    value.ratePolicyIdentity !== `${profile.id}:${profile.ratePolicy.revision}`
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  const { planHash: _ignored, ...base } = value;
  void _ignored;
  if (
    fetchSemanticHash(base) !== value.planHash ||
    serializedBytes(value) > FETCH_LIMITS.contractBytes
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  return Object.freeze({ ...(value as unknown as FetchPlanV1), candidate, profile });
}

export function validateFetchPlanForExecution(
  planValue: FetchPlanV1,
  requestValue: FetchRequestV1,
  candidateValue: SearchCandidateV1,
  profileValue: FetchProfileV1,
  now: Date,
): FetchPlanV1 {
  const plan = validateFetchPlanV1(planValue);
  const request = validateFetchRequestV1(requestValue);
  const candidate = candidateBindingFromSearchCandidate(candidateValue);
  const profile = validateFetchProfileV1(profileValue);
  if (
    plan.expiresAt <= now.toISOString() ||
    plan.requestSemanticHash !== fetchRequestSemanticHash(request) ||
    plan.candidate.searchCandidateId !== candidate.searchCandidateId ||
    plan.candidate.canonicalUrlHash !== candidate.canonicalUrlHash ||
    plan.candidate.canonicalUrl !== candidate.canonicalUrl ||
    JSON.stringify(plan.profile) !== JSON.stringify(profile) ||
    request.fetchProfileId !== profile.id ||
    request.profileRevision !== profile.revision
  ) {
    throw new FetchError('FETCH_PLAN_STALE');
  }
  return plan;
}

function validateRedactionCounts(value: unknown): FetchRedactionCountsV1 {
  if (
    !isObject(value) ||
    !exact(value, ['addresses', 'emails', 'phones']) ||
    !validInteger(value.addresses, 0, 100_000) ||
    !validInteger(value.emails, 0, 100_000) ||
    !validInteger(value.phones, 0, 100_000)
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  return Object.freeze(value as unknown as FetchRedactionCountsV1);
}

export function validateFetchedDocumentV1(value: unknown): FetchedDocumentV1 {
  if (
    !isObject(value) ||
    !exact(value, [
      'charset',
      'contractVersion',
      'createdAt',
      'documentId',
      'evidenceEligibility',
      'extractedTextBytes',
      'extractedTextHash',
      'extractedTextPath',
      'extractorVersion',
      'factStatus',
      'finalCanonicalUrl',
      'finalCanonicalUrlHash',
      'languageHint',
      'mimeType',
      'normalizedDocumentContentHash',
      'privacyPolicyVersion',
      'rawBodyHash',
      'redactionCounts',
      'sanitizedHtmlBytes',
      'sanitizedHtmlHash',
      'sanitizedHtmlPath',
      'sanitizerVersion',
      'truthStatus',
    ]) ||
    value.contractVersion !== CONTROLLED_FETCH_CONTRACT_VERSION ||
    !validIdentifier(value.documentId) ||
    value.evidenceEligibility !== FETCH_EVIDENCE_ELIGIBILITY ||
    value.truthStatus !== FETCH_TRUTH_STATUS ||
    value.factStatus !== FETCH_FACT_STATUS ||
    value.sanitizerVersion !== FETCH_SANITIZER_VERSION ||
    value.extractorVersion !== FETCH_EXTRACTOR_VERSION ||
    value.privacyPolicyVersion !== FETCH_PRIVACY_POLICY_VERSION ||
    !validHash(value.rawBodyHash) ||
    !validHash(value.sanitizedHtmlHash) ||
    !validHash(value.extractedTextHash) ||
    !validHash(value.normalizedDocumentContentHash) ||
    !validHash(value.finalCanonicalUrlHash) ||
    typeof value.finalCanonicalUrl !== 'string' ||
    !isManagedRelativePath(value.sanitizedHtmlPath, 'SOURCE_SNAPSHOT') ||
    !isManagedRelativePath(value.extractedTextPath, 'SOURCE_SNAPSHOT') ||
    !validInteger(value.sanitizedHtmlBytes, 1, FETCH_LIMITS.sanitizedBytes) ||
    !validInteger(value.extractedTextBytes, 1, FETCH_LIMITS.textBytes) ||
    !validIso(value.createdAt) ||
    (value.languageHint !== null &&
      (typeof value.languageHint !== 'string' || value.languageHint.length > 32))
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  const counts = validateRedactionCounts(value.redactionCounts);
  return Object.freeze({ ...(value as unknown as FetchedDocumentV1), redactionCounts: counts });
}

export function validateFetchOutcomeV1(value: unknown): FetchOutcomeV1 {
  if (
    !isObject(value) ||
    !exact(value, [
      'charset',
      'contractVersion',
      'document',
      'executionId',
      'externalRequestCount',
      'fetchRunId',
      'finishedAt',
      'mimeType',
      'receivedBytes',
      'redactionCounts',
      'redirectCount',
      'stableError',
      'status',
    ]) ||
    value.contractVersion !== CONTROLLED_FETCH_CONTRACT_VERSION ||
    !validIdentifier(value.executionId) ||
    !validIdentifier(value.fetchRunId) ||
    !FETCH_TERMINAL_STATUSES.includes(value.status as FetchTerminalStatus) ||
    !validInteger(value.externalRequestCount, 0, FETCH_LIMITS.maxExternalRequests) ||
    !validInteger(value.redirectCount, 0, FETCH_LIMITS.redirectCount) ||
    !validInteger(value.receivedBytes, 0, FETCH_LIMITS.decodedBytes) ||
    !validIso(value.finishedAt)
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  const redactionCounts = validateRedactionCounts(value.redactionCounts);
  const document = value.document === null ? null : validateFetchedDocumentV1(value.document);
  const stableError = value.stableError;
  if (
    (value.status === 'SUCCEEDED' && (document === null || stableError !== null)) ||
    (value.status !== 'SUCCEEDED' && (document !== null || !isObject(stableError)))
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  if (
    stableError !== null &&
    (!isObject(stableError) ||
      !exact(stableError, ['code', 'retryable']) ||
      typeof stableError.code !== 'string' ||
      stableError.code.length > FETCH_LIMITS.stableErrorCharacters ||
      typeof stableError.retryable !== 'boolean')
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  return Object.freeze({
    ...(value as unknown as FetchOutcomeV1),
    document,
    redactionCounts,
  });
}

export function validateFetchRunV1(value: unknown): FetchRunV1 {
  if (
    !isObject(value) ||
    !exact(value, [
      'candidateId',
      'executionId',
      'externalRequestCount',
      'fetchRunId',
      'requestSemanticHash',
      'revision',
      'stage',
      'startedAt',
    ]) ||
    !validIdentifier(value.candidateId) ||
    !validIdentifier(value.executionId) ||
    !validIdentifier(value.fetchRunId) ||
    !validHash(value.requestSemanticHash) ||
    !FETCH_RUN_STATUSES.includes(value.stage as FetchRunStatus) ||
    !validInteger(value.externalRequestCount, 0, FETCH_LIMITS.maxExternalRequests) ||
    !validInteger(value.revision, 1, Number.MAX_SAFE_INTEGER) ||
    !validIso(value.startedAt)
  ) {
    throw new FetchError('FETCH_INVALID_REQUEST');
  }
  return Object.freeze(value as unknown as FetchRunV1);
}
