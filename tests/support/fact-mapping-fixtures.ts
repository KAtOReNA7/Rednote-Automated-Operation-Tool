import {
  EVIDENCE_LOCATOR_VERSION,
  EVIDENCE_RECORD_CONTRACT_VERSION,
  evidenceSemanticHash,
  textSha256,
  type AtomicClaimV1,
  type ClaimEvidenceV1,
  type FactEvaluationStatus,
  type SourceAuthorityTier,
  type SourceAvailabilityState,
  type SourceIndependenceState,
  type SourceOriginKind,
  type SourceUseClass,
} from '../../packages/evidence/src/index.js';
import {
  buildClaimCandidateSet,
  factMappingHash,
  type CandidateRecordV1,
  type ClaimCandidateSetV1,
  type DraftArtifactKind,
  type MaterializedDraftArtifactV1,
  type SourceEvidenceTraceV1,
} from '../../packages/quality/src/index.js';

import { atomicClaim } from './dossier-fixtures.js';

export const FACT_MAPPING_NOW = '2026-07-31T03:00:00.000Z';

export interface SyntheticTraceOptions {
  readonly authorityTier?: SourceAuthorityTier;
  readonly availability?: SourceAvailabilityState;
  readonly current?: boolean;
  readonly independence?: SourceIndependenceState;
  readonly lineageGroup?: string | null;
  readonly originKind?: SourceOriginKind;
  readonly relation?: ClaimEvidenceV1['relation'];
  readonly sourceId?: string;
  readonly useClass?: SourceUseClass;
  readonly verificationStatus?: ClaimEvidenceV1['verificationStatus'];
}

export function syntheticTrace(
  claim: AtomicClaimV1,
  options: SyntheticTraceOptions = {},
): SourceEvidenceTraceV1 {
  const sourceId = options.sourceId ?? `source-${claim.claimId}`;
  const sourceRevision = 1;
  const excerpt = `合成公开证据：${claim.predicate}=${JSON.stringify(claim.value)}`;
  const sourceContentHash = textSha256(excerpt);
  const locator = Object.freeze({
    endCodePoint: Array.from(excerpt).length,
    extractedTextHash: sourceContentHash,
    kind: 'CHAR_RANGE' as const,
    sourceId,
    sourceRevision,
    startCodePoint: 0,
    version: EVIDENCE_LOCATOR_VERSION,
  });
  const evidenceId = `evidence-${sourceId}`;
  const evidence: ClaimEvidenceV1 = Object.freeze({
    claimId: claim.claimId,
    contractVersion: EVIDENCE_RECORD_CONTRACT_VERSION,
    createdAt: FACT_MAPPING_NOW,
    evidenceId,
    excerpt,
    excerptHash: textSha256(excerpt),
    locator,
    relation: options.relation ?? 'SUPPORTS',
    revision: 1,
    sourceContentHash,
    sourceLanguage: 'zh-CN',
    sourceRevisionId: `${sourceId}:1`,
    summary: Object.freeze({
      excerptHash: textSha256(excerpt),
      locatorHash: evidenceSemanticHash(locator),
      method: 'MANUAL',
      modelExecutionId: null,
      textZh: `中文摘要：${excerpt}`,
    }),
    verificationStatus: options.verificationStatus ?? 'VALIDATED',
  });
  return Object.freeze({
    authorityTier: options.authorityTier ?? 'OFFICIAL_PRIMARY',
    availability: options.availability ?? 'AVAILABLE',
    current: options.current ?? true,
    displayHost: 'fixture.invalid',
    evidence,
    independence: options.independence ?? 'CONFIRMED_INDEPENDENT',
    language: 'zh-CN',
    lineageGroup: options.lineageGroup ?? `lineage-${sourceId}`,
    originKind: options.originKind ?? 'SYNTHETIC_FIXTURE',
    publisherOrSite: '合成测试来源',
    sourceContentHash,
    sourceId,
    sourceRevision,
    sourceRevisionId: `${sourceId}:1`,
    title: `合成来源 ${sourceId}`,
    useClass: options.useClass ?? 'KEY_FACT_ELIGIBLE',
  });
}

export function candidateRecord(
  claim: AtomicClaimV1,
  options: {
    readonly current?: boolean;
    readonly evaluationStatus?: FactEvaluationStatus | null;
    readonly evidence?: readonly SourceEvidenceTraceV1[];
    readonly provenance?: CandidateRecordV1['provenance'];
    readonly redirectedFromIds?: readonly string[];
  } = {},
): CandidateRecordV1 {
  const evaluationStatus =
    options.evaluationStatus === undefined ? 'VERIFIED' : options.evaluationStatus;
  return Object.freeze({
    claim,
    current: options.current ?? true,
    evaluation:
      evaluationStatus === null
        ? null
        : Object.freeze({
            createdAt: FACT_MAPPING_NOW,
            evaluationId: `evaluation-${claim.claimId}`,
            inputIdentityHash: factMappingHash([claim.claimId, evaluationStatus]),
            policyVersion: 'fact-policy-v1',
            reasonCode: `SYNTHETIC_${evaluationStatus}`,
            revision: 1,
            status: evaluationStatus,
          }),
    evidence: options.evidence ?? Object.freeze([syntheticTrace(claim)]),
    provenance: options.provenance ?? Object.freeze(['CANONICAL_SUBJECT']),
    redirectedFromIds: options.redirectedFromIds ?? Object.freeze([]),
  });
}

export function candidateSet(
  records: readonly CandidateRecordV1[],
  options: {
    readonly allowedClaimIds?: readonly string[];
    readonly allowedEvidenceIds?: readonly string[];
    readonly allowedSubjectIds?: readonly string[];
    readonly workIds?: readonly string[];
  } = {},
): ClaimCandidateSetV1 {
  return buildClaimCandidateSet(records, {
    allowedClaimIds: new Set(options.allowedClaimIds ?? records.map(({ claim }) => claim.claimId)),
    allowedEvidenceIds: new Set(
      options.allowedEvidenceIds ??
        records.flatMap(({ evidence }) => evidence.map(({ evidence: item }) => item.evidenceId)),
    ),
    allowedSubjectIds: new Set(
      options.allowedSubjectIds ?? records.map(({ claim }) => claim.subject.id),
    ),
    workIds: new Set(options.workIds ?? records.map(({ claim }) => claim.subject.id)),
  });
}

export function materializedArtifact(
  text: string,
  options: {
    readonly artifactId?: string;
    readonly artifactKind?: DraftArtifactKind;
    readonly draftId?: string;
    readonly draftVersionId?: string;
    readonly evidenceRefIds?: readonly string[];
    readonly order?: number | null;
    readonly workIds?: readonly string[];
  } = {},
): MaterializedDraftArtifactV1 {
  const artifactKind = options.artifactKind ?? 'BODY_BLOCK';
  const normalized = text.normalize('NFC').replace(/\r\n?/gu, '\n');
  return Object.freeze({
    artifact: Object.freeze({
      artifactId: options.artifactId ?? 'artifact-1',
      artifactKind,
      codePointLength: Array.from(normalized).length,
      current: true,
      draftId: options.draftId ?? 'draft-1',
      draftVersionId: options.draftVersionId ?? 'draft-version-1',
      evidenceRefIds: Object.freeze([...(options.evidenceRefIds ?? [])].sort()),
      order: options.order ?? 0,
      profileId: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
      textHash: factMappingHash(normalized),
      workIds: Object.freeze([...(options.workIds ?? ['work-1'])].sort()),
    }),
    text: normalized,
  });
}

export function textClaim(
  claimId: string,
  predicate: string,
  value: AtomicClaimV1['value'],
  valueType: AtomicClaimV1['valueType'] = 'TEXT',
  workId = 'work-1',
  keyFact = true,
): AtomicClaimV1 {
  return atomicClaim(claimId, workId, predicate, valueType, value, { keyFact });
}
