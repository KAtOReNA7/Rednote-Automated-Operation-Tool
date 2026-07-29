import {
  ATOMIC_CLAIM_CONTRACT_VERSION,
  FACT_POLICY_VERSION,
  SOURCE_PROCESSING_PLAN_VERSION,
  atomicClaimSemanticFingerprint,
  createEvidenceLocator,
  sourceProcessingPlanHash,
  textSha256,
  type AtomicClaimScopeV1,
  type AtomicClaimV1,
  type SourceProcessingPlanV1,
} from '../../packages/evidence/src/index.js';
import type {
  RegisterSourceInputV1,
  SourceClassificationInputV1,
} from '../../packages/db/src/index.js';

export const EVIDENCE_NOW = '2026-07-29T02:00:00.000Z';

export function syntheticSource(
  sourceId: string,
  text: string,
  classification: SourceClassificationInputV1,
  language = 'zh-CN',
): RegisterSourceInputV1 {
  const hash = textSha256(text);
  return Object.freeze({
    classification,
    contentHash: hash,
    extractedTextHash: hash,
    extractedTextPath: `sources/snapshots/${hash.slice(0, 2)}/${hash}.txt`,
    language,
    originKind: 'SYNTHETIC_FIXTURE',
    originRecordId: `fixture-${sourceId}`,
    originRevision: 1,
    publisherOrSite: '合成测试站点',
    publishedAt: null,
    publishedAtPrecision: 'UNKNOWN',
    retrievedAt: EVIDENCE_NOW,
    sourceId,
    title: `合成来源 ${sourceId}`,
    url: `https://fixture.invalid/${sourceId}`,
    warnings: Object.freeze(['SYNTHETIC_TEST_FIXTURE']),
  });
}

export function officialClassification(group = 'official-group'): SourceClassificationInputV1 {
  return Object.freeze({
    authorityTier: 'OFFICIAL_PRIMARY',
    classifiedBy: 'SYNTHETIC_FIXTURE',
    independenceState: 'CONFIRMED_INDEPENDENT',
    lineageGroup: group,
    reasonCode: 'USER_CONFIRMED_OFFICIAL',
    useClass: 'KEY_FACT_ELIGIBLE',
  });
}

export function secondaryClassification(
  group: string,
  independenceState: SourceClassificationInputV1['independenceState'] = 'CONFIRMED_INDEPENDENT',
): SourceClassificationInputV1 {
  return Object.freeze({
    authorityTier: 'INDEPENDENT_SECONDARY',
    classifiedBy: 'SYNTHETIC_FIXTURE',
    independenceState,
    lineageGroup: group,
    reasonCode: 'USER_CONFIRMED_SECONDARY',
    useClass: 'KEY_FACT_ELIGIBLE',
  });
}

export function dateClaim(
  claimId: string,
  subjectId: string,
  value: string,
  scope: Partial<AtomicClaimScopeV1> = {},
): AtomicClaimV1 {
  const precision = value.length === 4 ? 'YEAR' : value.length === 7 ? 'MONTH' : 'DAY';
  const base = {
    claimId,
    claimant: null,
    contractVersion: ATOMIC_CLAIM_CONTRACT_VERSION,
    createdAt: EVIDENCE_NOW,
    keyFact: true,
    predicate: 'publication_date',
    predicateVersion: 1,
    provenance: Object.freeze({ kind: 'MANUAL' as const, runId: null }),
    revision: 1,
    scope: Object.freeze({
      format: scope.format ?? null,
      language: scope.language ?? null,
      territory: scope.territory ?? null,
      validFrom: scope.validFrom ?? null,
      validTo: scope.validTo ?? null,
    }),
    status: 'ACTIVE' as const,
    subject: Object.freeze({ id: subjectId, type: 'WORK' }),
    value: Object.freeze({ precision, value }),
    valueType: 'DATE_WITH_PRECISION' as const,
  };
  return Object.freeze({
    ...base,
    semanticFingerprint: atomicClaimSemanticFingerprint(base),
  });
}

export function processingPlan(
  planId: string,
  sourceRevisionIds: readonly string[],
  steps: SourceProcessingPlanV1['steps'],
): SourceProcessingPlanV1 {
  const withoutHash = {
    contractVersion: SOURCE_PROCESSING_PLAN_VERSION,
    createdAt: EVIDENCE_NOW,
    estimatedExternalRequests:
      sourceRevisionIds.length *
      steps.filter((step) => step === 'EXTRACT_CLAIMS' || step === 'SUMMARIZE').length,
    estimatedFee: 'UNKNOWN' as const,
    expiresAt: '2026-07-29T02:05:00.000Z',
    limits: Object.freeze({
      maxClaims: 128,
      maxConcurrency: 1,
      maxEvidencePerClaim: 32,
      maxFragmentBytes: 64 * 1024,
      maxRuntimeMs: 60_000,
    }),
    estimatedLocalWrites: sourceRevisionIds.length * 4,
    planId,
    sourceRevisionIds: Object.freeze([...sourceRevisionIds]),
    steps,
  };
  return Object.freeze({
    ...withoutHash,
    planHash: sourceProcessingPlanHash(withoutHash),
  });
}

export function fullTextEvidence(sourceId: string, revision: number, text: string) {
  return Object.freeze({
    excerptHash: textSha256(text),
    locator: createEvidenceLocator(sourceId, revision, text, 0, Array.from(text).length),
  });
}

export const POLICY_VERSION = FACT_POLICY_VERSION;
