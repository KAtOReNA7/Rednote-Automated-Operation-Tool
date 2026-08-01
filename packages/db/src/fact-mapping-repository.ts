import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  assertContentDraftPayload,
  copySemanticHash,
  type ContentDraftPayloadV1,
} from '@mystery-operations/copy';
import {
  EVIDENCE_LOCATOR_VERSION,
  EVIDENCE_RECORD_CONTRACT_VERSION,
  evidenceSemanticHash,
  validateAtomicClaimV1,
  validateClaimEvidenceV1,
  type AtomicClaimV1,
  type ClaimEvidenceV1,
  type FactSubjectType,
  type SourceOriginKind,
} from '@mystery-operations/evidence';
import {
  CLAIM_CANDIDATE_POLICY_VERSION,
  DRAFT_TEXT_LOCATOR_VERSION,
  FACT_MAPPING_CHECKER_VERSION,
  FACT_MAPPING_CLASSIFICATION_VERSION,
  FACT_MAPPING_CONTRACT_VERSION,
  FACT_MAPPING_LIMITS,
  FACT_MAPPING_SEGMENTATION_VERSION,
  KEY_FACT_POLICY_VERSION,
  PROTECTED_SIGNAL_POLICY_VERSION,
  TYPED_FACT_COMPATIBILITY_VERSION,
  FactMappingError,
  assertClassification,
  buildClaimCandidateSet,
  buildDeterministicFactMapping,
  buildFactMappingAssistInput,
  buildModelAssistedFactMapping,
  buildWarningBoundaryEscapes,
  canonicalFactMappingJson,
  createDraftStatement,
  createStatementClaimMapping,
  detectProtectedSignals,
  evaluateCandidateFactPolicy,
  evaluateStatementDisposition,
  factMappingHash,
  materializeDraftPublicArtifacts,
  projectFactMappingManualDecision,
  resolveDraftTextLocator,
  validateFactMappingAssistOutput,
  type FactMappingEditableBundleV1,
  type FactMappingManualDecisionInputV1,
  type FactMappingManualProjectionV1,
  type FactMappingAssistInputV1,
  type FactMappingJobPayloadV1,
  type CandidateRecordV1,
  type ClaimCandidateSetV1,
  type ClaimCandidateV1,
  type DraftArtifactKind,
  type DraftTextLocatorV1,
  type FactMappingCheckVersionV1,
  type FactMappingMode,
  type FactMappingPlanV1,
  type FactMappingRollupV1,
  type FactMappingRunV1,
  type FactMappingStatementResultV1,
  type MaterializedDraftArtifactV1,
  type SourceEvidenceTraceV1,
  type StatementClaimMappingV1,
  type StatementProvenance,
} from '@mystery-operations/quality';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const MAX_EVIDENCE_EXCERPT_CODE_POINTS = 600;
const MAX_VALUE_SUMMARY_CODE_POINTS = 300;

interface DraftRow extends Row {
  readonly brief_id: string;
  readonly brief_version_id: string;
  readonly content_hash: string;
  readonly current_version_id: string;
  readonly draft_id: string;
  readonly draft_revision: number;
  readonly draft_state: 'ACTIVE' | 'ARCHIVED';
  readonly payload_json: string;
  readonly profile_id: ContentDraftPayloadV1['profileId'];
  readonly status: string;
  readonly structural_valid: 0 | 1;
  readonly version_number: number;
}

interface ClaimRow extends Row {
  readonly claimant_source_id: string | null;
  readonly claimant_source_revision: number | null;
  readonly contract_version: string;
  readonly created_at: string;
  readonly evaluation_created_at: string | null;
  readonly evaluation_id: string | null;
  readonly evaluation_input_hash: string | null;
  readonly evaluation_policy_version: string | null;
  readonly evaluation_reason_code: string | null;
  readonly evaluation_status: ClaimCandidateV1['evaluation'] extends infer T
    ? T extends { readonly status: infer S }
      ? S
      : never
    : never;
  readonly id: string;
  readonly key_fact: 0 | 1;
  readonly predicate: string;
  readonly predicate_version: number;
  readonly provenance_json: string;
  readonly revision: number;
  readonly scope_json: string;
  readonly semantic_fingerprint: string;
  readonly status: AtomicClaimV1['status'];
  readonly subject_id: string;
  readonly subject_type: AtomicClaimV1['subject']['type'];
  readonly value_json: string;
  readonly value_type: AtomicClaimV1['valueType'];
}

interface EvidenceRow extends Row {
  readonly authority_tier: SourceEvidenceTraceV1['authorityTier'] | null;
  readonly availability: SourceEvidenceTraceV1['availability'];
  readonly classification_revision: number | null;
  readonly created_at: string;
  readonly claim_id: string;
  readonly display_host: string | null;
  readonly excerpt: string;
  readonly excerpt_hash: string;
  readonly id: string;
  readonly independence_state: SourceEvidenceTraceV1['independence'] | null;
  readonly language: string;
  readonly lineage_group: string | null;
  readonly locator_json: string;
  readonly locator_kind: string;
  readonly locator_validated: 0 | 1;
  readonly locator_version: string;
  readonly max_source_revision: number;
  readonly model_execution_id: string | null;
  readonly origin_kind: string;
  readonly publisher_or_site: string | null;
  readonly revision: number;
  readonly source_content_hash: string;
  readonly source_id: string;
  readonly source_language: string;
  readonly source_revision: number;
  readonly summary_method: 'MANUAL' | 'MODEL_CANDIDATE' | null;
  readonly summary_zh: string | null;
  readonly supports_or_contradicts: ClaimEvidenceV1['relation'];
  readonly title: string;
  readonly use_class: SourceEvidenceTraceV1['useClass'] | null;
  readonly verification_status: ClaimEvidenceV1['verificationStatus'];
}

interface PlanRow extends Row {
  readonly artifact_count: number;
  readonly brief_version_id: string;
  readonly candidate_claim_count: number;
  readonly candidate_hash: string;
  readonly check_id: string;
  readonly checker_version: typeof FACT_MAPPING_CHECKER_VERSION;
  readonly classification_version: typeof FACT_MAPPING_CLASSIFICATION_VERSION;
  readonly created_at: string;
  readonly dependency_hash: string;
  readonly draft_id: string;
  readonly draft_version_id: string;
  readonly evidence_count: number;
  readonly expected_draft_revision: number;
  readonly expires_at: string;
  readonly id: string;
  readonly input_code_point_count: number;
  readonly input_hash: string;
  readonly key_fact_policy_version: typeof KEY_FACT_POLICY_VERSION;
  readonly mapping_policy_version: typeof FACT_MAPPING_CONTRACT_VERSION;
  readonly maximum_model_requests: 0 | 1;
  readonly budget_state: FactMappingPlanV1['budgetState'];
  readonly cache_state: FactMappingPlanV1['cacheState'];
  readonly capability_state: FactMappingPlanV1['capabilityState'];
  readonly credential_state: FactMappingPlanV1['credentialState'];
  readonly mode: FactMappingMode;
  readonly preview_hash: string;
  readonly protected_signal_count: number;
  readonly segmentation_version: typeof FACT_MAPPING_SEGMENTATION_VERSION;
  readonly source_revision_count: number;
  readonly statement_count: number;
}

interface VersionRow extends Row {
  readonly artifact_hash: string;
  readonly candidate_hash: string;
  readonly check_id: string;
  readonly checker_version: typeof FACT_MAPPING_CHECKER_VERSION;
  readonly conflicted_count: number;
  readonly created_at: string;
  readonly decision_revision: number;
  readonly dependency_hash: string;
  readonly draft_id: string;
  readonly draft_version_id: string;
  readonly id: string;
  readonly input_hash: string;
  readonly needs_review_count: number;
  readonly not_applicable_count: number;
  readonly reason_codes_json: string;
  readonly run_id: string;
  readonly satisfied_count: number;
  readonly stale_count: number;
  readonly warning_boundary_escape_count: number;
  readonly status: FactMappingRollupV1['status'];
  readonly blocking_key_fact_count: number;
  readonly unmapped_supporting_fact_count: number;
  readonly version_number: number;
}

interface StatementRow extends Row {
  readonly artifact_id: string;
  readonly artifact_kind: DraftArtifactKind;
  readonly artifact_text_hash: string;
  readonly check_version_id: string;
  readonly classification_reason_code: string;
  readonly classification_version: string;
  readonly created_at: string;
  readonly end_code_point: number;
  readonly fact_domain: FactMappingStatementResultV1['statement']['classification']['domain'];
  readonly id: string;
  readonly locator_version: string;
  readonly materiality: FactMappingStatementResultV1['statement']['classification']['materiality'];
  readonly provenance: FactMappingStatementResultV1['statement']['provenance'];
  readonly requires_review: 0 | 1;
  readonly segmentation_version: string;
  readonly selected_text_hash: string;
  readonly start_code_point: number;
  readonly statement_kind: FactMappingStatementResultV1['statement']['classification']['kind'];
  readonly statement_order: number;
  readonly statement_revision: number;
}

export type FactMappingDisplayStatus =
  'AWAITING_REVIEW' | 'FACT_BLOCKED' | 'PASS' | 'STALE' | 'UNCHECKED';

export interface FactMappingListItem {
  readonly briefVersionId: string;
  readonly draftId: string;
  readonly draftRevision: number;
  readonly draftVersionId: string;
  readonly profileId: ContentDraftPayloadV1['profileId'];
  readonly status: FactMappingDisplayStatus;
  readonly structuralStatus: 'READY_FOR_QUALITY_PIPELINE';
  readonly versionNumber: number;
  readonly workIds: readonly string[];
}

export interface FactMappingListView {
  readonly items: readonly FactMappingListItem[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface FactMappingPreviewView {
  readonly plan: FactMappingPlanV1;
  readonly writes: readonly string[];
}

export interface FactMappingStatementView {
  readonly artifactId: string;
  readonly artifactKind: DraftArtifactKind;
  readonly claimId: string | null;
  readonly compatibilityReasonCode: string | null;
  readonly disposition: FactMappingStatementResultV1['disposition'];
  readonly domain: FactMappingStatementResultV1['statement']['classification']['domain'];
  readonly factPolicyReasonCode: string | null;
  readonly fragment: string;
  readonly kind: FactMappingStatementResultV1['statement']['classification']['kind'];
  readonly materiality: FactMappingStatementResultV1['statement']['classification']['materiality'];
  readonly protectedSignals: readonly string[];
  readonly relation: StatementClaimMappingV1['relation'] | null;
  readonly statementId: string;
  readonly statementOrder: number;
  readonly startCodePoint: number;
  readonly endCodePoint: number;
}

export interface FactMappingCandidateView {
  readonly claimId: string;
  readonly current: boolean;
  readonly evaluationStatus: string | null;
  readonly evidenceCount: number;
  readonly factPolicyReasonCode: string;
  readonly factPolicySatisfied: boolean;
  readonly predicate: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly valueSummary: string;
  readonly valueType: string;
}

export interface FactMappingClaimChainView {
  readonly claim: {
    readonly claimId: string;
    readonly current: boolean;
    readonly predicate: string;
    readonly revision: number;
    readonly scopeSummary: string;
    readonly subjectId: string;
    readonly subjectType: string;
    readonly valueSummary: string;
    readonly valueType: string;
  };
  readonly conflicts: readonly {
    readonly conflictId: string;
    readonly state: string;
  }[];
  readonly evaluation: {
    readonly createdAt: string;
    readonly evaluationId: string;
    readonly policyVersion: string;
    readonly reasonCode: string;
    readonly status: string;
  };
  readonly evidence: readonly {
    readonly excerpt: string;
    readonly relation: ClaimEvidenceV1['relation'];
    readonly revision: number;
    readonly source: {
      readonly authorityTier: string;
      readonly availability: string;
      readonly contentHashSummary: string;
      readonly current: boolean;
      readonly displayHost: string | null;
      readonly independence: string;
      readonly language: string;
      readonly lineageGroup: string | null;
      readonly publisherOrSite: string | null;
      readonly revisionId: string;
      readonly title: string;
      readonly useClass: string;
    };
    readonly summaryZh: string | null;
    readonly summaryZhIsEvidence: false;
  }[];
  readonly statementId: string;
}

export interface FactMappingDetailView extends FactMappingListItem {
  readonly artifacts: readonly {
    readonly artifactId: string;
    readonly artifactKind: DraftArtifactKind;
    readonly codePointLength: number;
    readonly coveredStatementCount: number;
    readonly textHash: string;
  }[];
  readonly candidates: readonly FactMappingCandidateView[];
  readonly checkVersion: FactMappingCheckVersionV1 | null;
  readonly history: readonly {
    readonly createdAt: string;
    readonly current: boolean;
    readonly dependencyHash: string;
    readonly inputHash: string;
    readonly reasonCodes: readonly string[];
    readonly status: FactMappingDisplayStatus;
    readonly versionId: string;
    readonly versionNumber: number;
  }[];
  readonly invalidationReasons: readonly string[];
  readonly rollup: FactMappingRollupV1 | null;
  readonly runs: readonly FactMappingRunV1[];
  readonly statements: readonly FactMappingStatementView[];
}

export interface FactMappingDecisionPreviewView {
  readonly after: ReturnType<typeof projectFactMappingManualDecision>['after'];
  readonly before: ReturnType<typeof projectFactMappingManualDecision>['before'];
  readonly draftId: string;
  readonly draftVersionId: string;
  readonly expectedRevision: number;
  readonly expectedStatus: FactMappingRollupV1['status'];
  readonly kind: FactMappingManualDecisionInputV1['kind'];
  readonly statementId: string;
}

export interface FactMappingDecisionExecution {
  readonly decisionId: string;
  readonly detail: FactMappingDetailView;
  readonly kind: FactMappingManualDecisionInputV1['kind'];
}

export interface FactMappingStartExecution {
  readonly checkVersion: FactMappingCheckVersionV1;
  readonly run: FactMappingRunV1;
}

export interface FactMappingPreparedExecution {
  readonly payload: FactMappingJobPayloadV1;
  readonly run: FactMappingRunV1;
}

export interface FactMappingWorkflowExecution {
  readonly artifacts: readonly MaterializedDraftArtifactV1[];
  readonly assistInput: FactMappingAssistInputV1;
  readonly candidates: ClaimCandidateSetV1;
  readonly plan: FactMappingPlanV1;
  readonly run: FactMappingRunV1;
}

interface CandidateContext {
  readonly allowedEvidenceIds: ReadonlySet<string>;
  readonly candidates: ClaimCandidateSetV1;
  readonly canonicalWorkIds: readonly string[];
  readonly lineageIds: readonly string[];
  readonly records: readonly CandidateRecordV1[];
}

type DependencyTypedColumns = readonly [
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  string | null,
  number | null,
  string | null,
];

function identifier(value: string, maximum: number = FACT_MAPPING_LIMITS.identifierBytes): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximum ||
    Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  ) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  return value;
}

function iso(value: string): string {
  if (!UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  return value;
}

function page(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  return value;
}

function json<T>(value: unknown): T {
  if (typeof value !== 'string') throw new FactMappingError('FACT_MAPPING_CONFLICT');
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new FactMappingError('FACT_MAPPING_CONFLICT');
  }
}

function stringArray(value: unknown): readonly string[] {
  const parsed = json<unknown>(value);
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new FactMappingError('FACT_MAPPING_CONFLICT');
  }
  return Object.freeze([...new Set(parsed)].sort());
}

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join('');
}

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

function checkId(draftId: string): string {
  return `fmcheck-${factMappingHash(draftId).slice(0, 32)}`;
}

function safeJson(value: unknown, maximum: number): string {
  const result = canonicalFactMappingJson(value);
  if (Buffer.byteLength(result, 'utf8') > maximum) {
    throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
  }
  return result;
}

function rollupFromVersion(row: VersionRow): FactMappingRollupV1 {
  return Object.freeze({
    counts: Object.freeze({
      BLOCKING_KEY_FACT: row.blocking_key_fact_count,
      CONFLICTED: row.conflicted_count,
      NEEDS_REVIEW: row.needs_review_count,
      NOT_APPLICABLE: row.not_applicable_count,
      SATISFIED: row.satisfied_count,
      STALE: row.stale_count,
      UNMAPPED_SUPPORTING_FACT: row.unmapped_supporting_fact_count,
    }),
    reasonCodes: stringArray(row.reason_codes_json),
    status: row.status,
    warningBoundaryEscapeCount: row.warning_boundary_escape_count,
  });
}

export class SqliteFactMappingRepository {
  readonly #database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.#database = database;
  }

  public list(input: {
    readonly limit: number;
    readonly offset: number;
    readonly status?: FactMappingDisplayStatus;
  }): FactMappingListView {
    const limit = page(input.limit, 1, FACT_MAPPING_LIMITS.maxPageSize);
    const offset = page(input.offset, 0, FACT_MAPPING_LIMITS.maxPageOffset);
    const status = input.status;
    if (
      status !== undefined &&
      !['AWAITING_REVIEW', 'FACT_BLOCKED', 'PASS', 'STALE', 'UNCHECKED'].includes(status)
    ) {
      throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
    }
    const statusExpression = `CASE
      WHEN mapping_version.id IS NULL THEN 'UNCHECKED'
      WHEN EXISTS(
        SELECT 1 FROM fact_mapping_invalidations AS invalidation
        WHERE invalidation.check_version_id = mapping_version.id
      ) THEN 'STALE'
      ELSE mapping_version.status
    END`;
    const base = `
      FROM content_draft_heads AS head
      JOIN content_draft_versions AS version ON version.id = head.current_version_id
      LEFT JOIN fact_mapping_checks AS check_root ON check_root.draft_id = head.draft_id
      LEFT JOIN fact_mapping_heads AS mapping_head ON mapping_head.check_id = check_root.id
      LEFT JOIN fact_mapping_check_versions AS mapping_version
        ON mapping_version.id = mapping_head.current_version_id
       AND mapping_version.draft_version_id = head.current_version_id
      WHERE head.draft_state = 'ACTIVE'
        AND version.status = 'READY_FOR_QUALITY_PIPELINE'
        AND version.structural_valid = 1
        AND (? IS NULL OR ${statusExpression} = ?)`;
    const rows = this.#database
      .prepare(
        `SELECT
           head.draft_id, head.draft_revision, head.current_version_id,
           version.version_number, version.brief_version_id, version.profile_id,
           version.payload_json, mapping_version.id AS mapping_version_id,
           mapping_version.status AS mapping_status,
           CASE WHEN mapping_version.id IS NULL THEN 0 ELSE EXISTS(
             SELECT 1 FROM fact_mapping_invalidations AS invalidation
             WHERE invalidation.check_version_id = mapping_version.id
           ) END AS stale
         ${base}
         ORDER BY version.created_at DESC, head.draft_id
         LIMIT ? OFFSET ?`,
      )
      .all(status ?? null, status ?? null, limit, offset) as unknown as readonly Row[];
    const mapped = rows.map((row) => {
      const payload = assertContentDraftPayload(json(row.payload_json));
      const computedStatus: FactMappingDisplayStatus =
        row.mapping_version_id === null
          ? 'UNCHECKED'
          : row.stale === 1
            ? 'STALE'
            : (row.mapping_status as FactMappingRollupV1['status']);
      return Object.freeze({
        briefVersionId: row.brief_version_id as string,
        draftId: row.draft_id as string,
        draftRevision: row.draft_revision as number,
        draftVersionId: row.current_version_id as string,
        profileId: row.profile_id as ContentDraftPayloadV1['profileId'],
        status: computedStatus,
        structuralStatus: 'READY_FOR_QUALITY_PIPELINE' as const,
        versionNumber: row.version_number as number,
        workIds: Object.freeze([...payload.brief.workIds]),
      });
    });
    const totalRow = this.#database
      .prepare(`SELECT count(*) AS count ${base}`)
      .get(status ?? null, status ?? null) as { readonly count: number };
    return Object.freeze({
      items: Object.freeze(mapped),
      limit,
      offset,
      total: totalRow.count,
    });
  }

  public previewStart(input: {
    readonly draftId: string;
    readonly mode: FactMappingMode;
    readonly now: string;
    readonly readiness?: {
      readonly budgetState: FactMappingPlanV1['budgetState'];
      readonly cacheState: FactMappingPlanV1['cacheState'];
      readonly capabilityState: FactMappingPlanV1['capabilityState'];
      readonly credentialState: FactMappingPlanV1['credentialState'];
    };
  }): FactMappingPreviewView {
    identifier(input.draftId);
    iso(input.now);
    if (!['LOCAL_MANUAL', 'MODEL_ASSISTED'].includes(input.mode)) {
      throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
    }
    const draft = this.#draft(input.draftId);
    const artifacts = this.#artifacts(draft);
    const context = this.#candidateContext(draft);
    const warningBoundaryEscapes = buildWarningBoundaryEscapes(draft.payload);
    const deterministic = buildDeterministicFactMapping({
      artifacts,
      candidates: context.candidates,
      createdAt: input.now,
      warningBoundaryEscapes,
    });
    const planId = randomUUID();
    const created = Date.parse(input.now);
    const expiresAt = new Date(created + FACT_MAPPING_LIMITS.confirmationTtlMs).toISOString();
    const evidenceCount = context.candidates.candidates.reduce(
      (total, candidate) => total + candidate.evidence.length,
      0,
    );
    const sourceRevisionCount = new Set(
      context.candidates.candidates.flatMap(({ evidence }) =>
        evidence.map(({ sourceRevisionId }) => sourceRevisionId),
      ),
    ).size;
    const readiness =
      input.mode === 'LOCAL_MANUAL'
        ? {
            budgetState: 'AVAILABLE' as const,
            cacheState: 'AVAILABLE' as const,
            capabilityState: 'SUPPORTED' as const,
            credentialState: 'NOT_REQUIRED' as const,
          }
        : (input.readiness ?? {
            budgetState: 'UNKNOWN' as const,
            cacheState: 'UNKNOWN' as const,
            capabilityState: 'UNKNOWN' as const,
            credentialState: 'UNKNOWN' as const,
          });
    const base = {
      artifactCount: artifacts.length,
      briefVersionId: draft.row.brief_version_id,
      budgetState: readiness.budgetState,
      cacheState: readiness.cacheState,
      candidateClaimCount: context.candidates.candidates.length,
      candidateEvidenceCount: evidenceCount,
      candidateSourceRevisionCount: sourceRevisionCount,
      capabilityState: readiness.capabilityState,
      checkerVersion: FACT_MAPPING_CHECKER_VERSION,
      classificationVersion: FACT_MAPPING_CLASSIFICATION_VERSION,
      createdAt: input.now,
      credentialState: readiness.credentialState,
      dependencyHash: context.candidates.dependencyHash,
      draftId: draft.row.draft_id,
      draftRevision: draft.row.draft_revision,
      draftVersionId: draft.row.current_version_id,
      estimatedLocalWrites:
        4 +
        artifacts.length +
        deterministic.statements.length * 3 +
        evidenceCount +
        sourceRevisionCount,
      expiresAt,
      inputCodePointCount: artifacts.reduce((sum, item) => sum + item.artifact.codePointLength, 0),
      inputHash: deterministic.inputHash,
      mappingPolicyVersion: FACT_MAPPING_CONTRACT_VERSION,
      maximumModelRequests: input.mode === 'LOCAL_MANUAL' ? (0 as const) : (1 as const),
      mode: input.mode,
      planId,
      profileId: draft.payload.profileId,
      protectedSignalCount: deterministic.statements.reduce(
        (sum, item) => sum + item.signals.length,
        0,
      ),
      segmentationVersion: FACT_MAPPING_SEGMENTATION_VERSION,
      statementCount: deterministic.statements.length,
      typedCompatibilityVersion: TYPED_FACT_COMPATIBILITY_VERSION,
      workIds: Object.freeze([...context.canonicalWorkIds]),
    };
    const previewHash = factMappingHash(base);
    const plan: FactMappingPlanV1 = Object.freeze({ ...base, previewHash });
    const rootId = checkId(input.draftId);
    runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO fact_mapping_checks(
             id, draft_id, contract_version, created_at
           ) VALUES (?, ?, ?, ?)`,
        )
        .run(rootId, input.draftId, FACT_MAPPING_CONTRACT_VERSION, input.now);
      this.#database
        .prepare(
          `INSERT INTO fact_mapping_plans(
             id, check_id, draft_id, draft_version_id, brief_version_id,
             expected_draft_revision, mode, artifact_count, input_code_point_count,
             protected_signal_count, statement_count, candidate_claim_count,
             evidence_count, source_revision_count, maximum_model_requests,
             capability_state, cache_state, budget_state, credential_state,
             input_hash, candidate_hash, dependency_hash, preview_hash,
             checker_version, segmentation_version, classification_version,
             key_fact_policy_version, mapping_policy_version, expires_at, created_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           )`,
        )
        .run(
          plan.planId,
          rootId,
          plan.draftId,
          plan.draftVersionId,
          plan.briefVersionId,
          plan.draftRevision,
          plan.mode,
          plan.artifactCount,
          plan.inputCodePointCount,
          plan.protectedSignalCount,
          plan.statementCount,
          plan.candidateClaimCount,
          plan.candidateEvidenceCount,
          plan.candidateSourceRevisionCount,
          plan.maximumModelRequests,
          plan.capabilityState,
          plan.cacheState,
          plan.budgetState,
          plan.credentialState,
          plan.inputHash,
          context.candidates.inputHash,
          plan.dependencyHash,
          plan.previewHash,
          plan.checkerVersion,
          plan.segmentationVersion,
          plan.classificationVersion,
          KEY_FACT_POLICY_VERSION,
          plan.mappingPolicyVersion,
          plan.expiresAt,
          plan.createdAt,
        );
    });
    return Object.freeze({
      plan,
      writes: Object.freeze([
        'FACT_MAPPING 专属检查、版本、Statement、映射和依赖记录',
        'quality_checks 中一个版本绑定的 FACT_MAPPING 汇总',
        '不会修改 Draft、Claim、Evidence、Source 或 FactEvaluation',
      ]),
    });
  }

  public confirmLocalStart(input: {
    readonly executionId: string;
    readonly now: string;
    readonly planId: string;
    readonly previewHash: string;
  }): FactMappingStartExecution {
    identifier(input.executionId, 128);
    identifier(input.planId, 128);
    iso(input.now);
    if (!/^[a-f0-9]{64}$/u.test(input.previewHash)) {
      throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
    }
    const replay = this.#database
      .prepare(
        `SELECT version.id AS version_id
         FROM fact_mapping_runs AS run
         JOIN fact_mapping_check_versions AS version ON version.run_id = run.id
         WHERE run.execution_id = ?`,
      )
      .get(input.executionId) as { readonly version_id: string } | undefined;
    if (replay !== undefined) return this.#execution(replay.version_id);
    const plan = this.#plan(input.planId);
    if (
      plan.mode !== 'LOCAL_MANUAL' ||
      plan.preview_hash !== input.previewHash ||
      Date.parse(input.now) > Date.parse(plan.expires_at)
    ) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_INVALID');
    }
    const draft = this.#draft(plan.draft_id);
    if (
      draft.row.current_version_id !== plan.draft_version_id ||
      draft.row.draft_revision !== plan.expected_draft_revision
    ) {
      throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
    }
    const artifacts = this.#artifacts(draft);
    const context = this.#candidateContext(draft);
    const deterministic = buildDeterministicFactMapping({
      artifacts,
      candidates: context.candidates,
      createdAt: input.now,
      warningBoundaryEscapes: buildWarningBoundaryEscapes(draft.payload),
    });
    if (
      deterministic.inputHash !== plan.input_hash ||
      context.candidates.inputHash !== plan.candidate_hash ||
      context.candidates.dependencyHash !== plan.dependency_hash ||
      artifacts.length !== plan.artifact_count ||
      deterministic.statements.length !== plan.statement_count
    ) {
      throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
    }
    const existing = this.#database
      .prepare(
        `SELECT id FROM fact_mapping_check_versions
         WHERE draft_version_id = ? AND checker_version = ? AND input_hash = ?`,
      )
      .get(plan.draft_version_id, FACT_MAPPING_CHECKER_VERSION, plan.input_hash) as
      { readonly id: string } | undefined;
    if (existing !== undefined) return this.#execution(existing.id);
    const runId = randomUUID();
    const versionId = randomUUID();
    this.#publish({
      artifacts,
      context,
      deterministic,
      executionId: input.executionId,
      now: input.now,
      plan,
      runId,
      versionId,
    });
    return this.#execution(versionId);
  }

  public prepareQueuedStart(input: {
    readonly executionId: string;
    readonly now: string;
    readonly planId: string;
    readonly previewHash: string;
  }): FactMappingPreparedExecution {
    identifier(input.executionId, 128);
    identifier(input.planId, 128);
    iso(input.now);
    if (!/^[a-f0-9]{64}$/u.test(input.previewHash)) {
      throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
    }
    const existing = this.#database
      .prepare(`SELECT * FROM fact_mapping_runs WHERE execution_id = ?`)
      .get(input.executionId) as Row | undefined;
    if (existing !== undefined) {
      if (existing.plan_id !== input.planId || existing.preview_hash !== input.previewHash) {
        throw new FactMappingError('FACT_MAPPING_CONFLICT');
      }
      const run = this.#run(input.executionId);
      return Object.freeze({
        payload: this.#jobPayload(run),
        run,
      });
    }
    const plan = this.#plan(input.planId);
    if (
      plan.preview_hash !== input.previewHash ||
      Date.parse(input.now) > Date.parse(plan.expires_at)
    ) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_INVALID');
    }
    const prepared = this.#revalidatePlan(plan, input.now);
    const runId = randomUUID();
    this.#database
      .prepare(
        `INSERT INTO fact_mapping_runs(
           id, execution_id, plan_id, check_id, draft_id, draft_version_id,
           mode, status, external_request_count, input_hash, candidate_hash,
           dependency_hash, preview_hash, revision, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PLANNED', 0, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(
        runId,
        input.executionId,
        plan.id,
        plan.check_id,
        plan.draft_id,
        plan.draft_version_id,
        plan.mode,
        prepared.deterministic.inputHash,
        prepared.context.candidates.inputHash,
        prepared.context.candidates.dependencyHash,
        plan.preview_hash,
        input.now,
        input.now,
      );
    const run = this.#run(input.executionId);
    return Object.freeze({ payload: this.#jobPayload(run), run });
  }

  public markRunQueued(
    executionIdValue: string,
    jobIdValue: string,
    nowValue: string,
  ): FactMappingRunV1 {
    const executionId = identifier(executionIdValue, 128);
    const jobId = identifier(jobIdValue, 128);
    const now = iso(nowValue);
    const changed = this.#database
      .prepare(
        `UPDATE fact_mapping_runs
         SET job_id = ?, status = 'QUEUED', updated_at = ?, revision = revision + 1
         WHERE execution_id = ? AND status = 'PLANNED'`,
      )
      .run(jobId, now, executionId);
    if (changed.changes !== 1) {
      const replay = this.#run(executionId);
      if (replay.status !== 'QUEUED') {
        throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
      }
      return replay;
    }
    return this.#run(executionId);
  }

  public loadWorkflowExecution(executionIdValue: string): FactMappingWorkflowExecution {
    const executionId = identifier(executionIdValue, 128);
    const run = this.#run(executionId);
    const row = this.#database
      .prepare(`SELECT * FROM fact_mapping_runs WHERE execution_id = ?`)
      .get(executionId) as Row | undefined;
    if (row === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    const plan = this.#plan(row.plan_id as string);
    const prepared = this.#revalidatePlan(plan, new Date().toISOString(), false);
    return Object.freeze({
      artifacts: prepared.artifacts,
      assistInput: buildFactMappingAssistInput({
        artifacts: prepared.artifacts,
        candidates: prepared.context.candidates,
        profileId: prepared.draft.payload.profileId,
      }),
      candidates: prepared.context.candidates,
      plan: this.#planView(
        plan,
        prepared.draft.payload.profileId,
        prepared.context.canonicalWorkIds,
      ),
      run,
    });
  }

  public markWorkflowRunning(executionIdValue: string, nowValue: string): FactMappingRunV1 {
    const executionId = identifier(executionIdValue, 128);
    const now = iso(nowValue);
    const changed = this.#database
      .prepare(
        `UPDATE fact_mapping_runs
         SET status = 'RUNNING', updated_at = ?, revision = revision + 1
         WHERE execution_id = ? AND status = 'QUEUED'`,
      )
      .run(now, executionId);
    if (changed.changes !== 1) {
      const replay = this.#run(executionId);
      if (replay.status !== 'RUNNING') {
        throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
      }
      return replay;
    }
    return this.#run(executionId);
  }

  public completeLocalWorkflow(
    executionIdValue: string,
    nowValue: string,
  ): FactMappingStartExecution {
    const executionId = identifier(executionIdValue, 128);
    const now = iso(nowValue);
    const replay = this.#database
      .prepare(
        `SELECT version.id
         FROM fact_mapping_runs AS run
         JOIN fact_mapping_check_versions AS version ON version.run_id = run.id
         WHERE run.execution_id = ?`,
      )
      .get(executionId) as { readonly id: string } | undefined;
    if (replay !== undefined) return this.#execution(replay.id);
    const runRow = this.#database
      .prepare(`SELECT * FROM fact_mapping_runs WHERE execution_id = ?`)
      .get(executionId) as Row | undefined;
    if (runRow === undefined || runRow.mode !== 'LOCAL_MANUAL') {
      throw new FactMappingError('FACT_MAPPING_CONFLICT');
    }
    const plan = this.#plan(runRow.plan_id as string);
    const prepared = this.#revalidatePlan(plan, now, false);
    const versionId = randomUUID();
    this.#publish({
      artifacts: prepared.artifacts,
      context: prepared.context,
      deterministic: prepared.deterministic,
      executionId,
      existingRunId: runRow.id as string,
      now,
      plan,
      runId: runRow.id as string,
      versionId,
    });
    return this.#execution(versionId);
  }

  public completeModelWorkflow(input: {
    readonly executionId: string;
    readonly externalRequestCount: 0 | 1;
    readonly modelExecutionId: string | null;
    readonly now: string;
    readonly output: unknown;
  }): FactMappingStartExecution {
    const executionId = identifier(input.executionId, 128);
    const now = iso(input.now);
    const replay = this.#database
      .prepare(
        `SELECT version.id
         FROM fact_mapping_runs AS run
         JOIN fact_mapping_check_versions AS version ON version.run_id = run.id
         WHERE run.execution_id = ?`,
      )
      .get(executionId) as { readonly id: string } | undefined;
    if (replay !== undefined) return this.#execution(replay.id);
    const runRow = this.#database
      .prepare(`SELECT * FROM fact_mapping_runs WHERE execution_id = ?`)
      .get(executionId) as Row | undefined;
    if (runRow === undefined || runRow.mode !== 'MODEL_ASSISTED') {
      throw new FactMappingError('FACT_MAPPING_CONFLICT');
    }
    const plan = this.#plan(runRow.plan_id as string);
    const prepared = this.#revalidatePlan(plan, now, false);
    const validated = validateFactMappingAssistOutput({
      artifacts: prepared.artifacts,
      candidateSet: prepared.context.candidates,
      output: input.output,
    });
    const candidate = buildModelAssistedFactMapping({
      artifacts: prepared.artifacts,
      candidates: prepared.context.candidates,
      createdAt: now,
      output: validated,
      warningBoundaryEscapes: buildWarningBoundaryEscapes(prepared.draft.payload),
    });
    const versionId = randomUUID();
    this.#publish({
      artifacts: prepared.artifacts,
      context: prepared.context,
      deterministic: candidate,
      executionId,
      existingRunId: runRow.id as string,
      externalRequestCount: input.externalRequestCount,
      modelExecutionId: input.modelExecutionId,
      now,
      plan,
      runId: runRow.id as string,
      runMode: 'MODEL_ASSISTED',
      versionId,
    });
    return this.#execution(versionId);
  }

  public stopWorkflowRun(input: {
    readonly executionId: string;
    readonly externalRequestCount: 0 | 1;
    readonly modelExecutionId: string | null;
    readonly now: string;
    readonly reasonCode: string;
    readonly status: 'AMBIGUOUS' | 'CANCELLED' | 'FAILED';
  }): FactMappingRunV1 {
    const executionId = identifier(input.executionId, 128);
    const now = iso(input.now);
    identifier(input.reasonCode, 128);
    const changed = this.#database
      .prepare(
        `UPDATE fact_mapping_runs
         SET status = ?, external_request_count = ?, model_execution_id = ?,
             stable_error_code = ?, updated_at = ?, finished_at = ?,
             revision = revision + 1
         WHERE execution_id = ? AND status IN ('PLANNED', 'QUEUED', 'RUNNING')`,
      )
      .run(
        input.status,
        input.externalRequestCount,
        input.modelExecutionId,
        input.reasonCode,
        now,
        now,
        executionId,
      );
    if (changed.changes !== 1) {
      const replay = this.#run(executionId);
      if (!['AMBIGUOUS', 'CANCELLED', 'FAILED'].includes(replay.status)) {
        throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
      }
      return replay;
    }
    return this.#run(executionId);
  }

  public recoverInterrupted(nowValue: string): {
    readonly ambiguous: number;
    readonly requeued: number;
  } {
    const now = iso(nowValue);
    const ambiguous = this.#database
      .prepare(
        `UPDATE fact_mapping_runs
         SET status = 'AMBIGUOUS',
             stable_error_code = 'RECOVERED_AFTER_POSSIBLE_SEND',
             updated_at = ?, finished_at = ?, revision = revision + 1
         WHERE status = 'RUNNING' AND mode = 'MODEL_ASSISTED'`,
      )
      .run(now, now).changes;
    const requeued = this.#database
      .prepare(
        `UPDATE fact_mapping_runs
         SET status = 'QUEUED', stable_error_code = 'RECOVERED_PRE_SEND',
             updated_at = ?, revision = revision + 1
         WHERE status = 'RUNNING' AND mode = 'LOCAL_MANUAL'`,
      )
      .run(now).changes;
    return Object.freeze({
      ambiguous: Number(ambiguous),
      requeued: Number(requeued),
    });
  }

  public get(draftId: string): FactMappingDetailView {
    identifier(draftId);
    const draft = this.#draft(draftId);
    const artifacts = this.#artifacts(draft);
    const context = this.#candidateContext(draft);
    const candidates = this.#candidateViews(context);
    const listItem = this.#listItem(draft);
    const version = this.#currentVersion(draftId, draft.row.current_version_id);
    if (version === undefined) {
      return Object.freeze({
        ...listItem,
        artifacts: Object.freeze(
          artifacts.map(({ artifact }) =>
            Object.freeze({
              artifactId: artifact.artifactId,
              artifactKind: artifact.artifactKind,
              codePointLength: artifact.codePointLength,
              coveredStatementCount: 0,
              textHash: artifact.textHash,
            }),
          ),
        ),
        candidates,
        checkVersion: null,
        history: this.#history(draftId),
        invalidationReasons: Object.freeze([]),
        rollup: null,
        runs: this.#runs(draftId),
        statements: Object.freeze([]),
      });
    }
    const invalidationReasons = this.#invalidationReasons(version.id);
    const statementRows = this.#database
      .prepare(
        `SELECT * FROM fact_mapping_statements
         WHERE check_version_id = ?
         ORDER BY statement_order
         LIMIT 512`,
      )
      .all(version.id) as unknown as readonly StatementRow[];
    const artifactMap = new Map(
      artifacts.map((item) => [`${item.artifact.artifactKind}:${item.artifact.artifactId}`, item]),
    );
    const views = statementRows.map((statement) => this.#statementView(statement, artifactMap));
    const countByArtifact = new Map<string, number>();
    for (const row of statementRows) {
      const key = `${row.artifact_kind}:${row.artifact_id}`;
      countByArtifact.set(key, (countByArtifact.get(key) ?? 0) + 1);
    }
    const rollup = rollupFromVersion(version);
    return Object.freeze({
      ...listItem,
      status: invalidationReasons.length > 0 ? 'STALE' : version.status,
      artifacts: Object.freeze(
        artifacts.map(({ artifact }) =>
          Object.freeze({
            artifactId: artifact.artifactId,
            artifactKind: artifact.artifactKind,
            codePointLength: artifact.codePointLength,
            coveredStatementCount:
              countByArtifact.get(`${artifact.artifactKind}:${artifact.artifactId}`) ?? 0,
            textHash: artifact.textHash,
          }),
        ),
      ),
      candidates,
      checkVersion: Object.freeze({
        checkerVersion: FACT_MAPPING_CHECKER_VERSION,
        createdAt: version.created_at,
        decisionRevision: this.#headRevision(version.check_id),
        dependencyHash: version.dependency_hash,
        draftId: version.draft_id,
        draftVersionId: version.draft_version_id,
        inputHash: version.input_hash,
        rollup,
        runId: version.run_id,
        versionId: version.id,
        versionNumber: version.version_number,
      }),
      history: this.#history(draftId),
      invalidationReasons,
      rollup,
      runs: this.#runs(draftId),
      statements: Object.freeze(views),
    });
  }

  public getClaimChain(statementId: string): FactMappingClaimChainView {
    identifier(statementId, 128);
    const mapping = this.#database
      .prepare(
        `SELECT
           mapping.id, mapping.claim_id, mapping.claim_revision,
           mapping.claim_current_snapshot, mapping.fact_evaluation_id,
           claim.subject_type, claim.subject_id, claim.predicate,
           claim.value_type, claim.value_json, claim.scope_json,
           evaluation.status AS evaluation_status,
           evaluation.policy_version, evaluation.reason_code,
           evaluation.created_at AS evaluation_created_at
         FROM fact_mapping_links AS mapping
         JOIN claims AS claim ON claim.id = mapping.claim_id
         JOIN fact_evaluations AS evaluation ON evaluation.id = mapping.fact_evaluation_id
         WHERE mapping.statement_id = ?`,
      )
      .get(statementId) as Row | undefined;
    if (mapping === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    const evidenceRows = this.#database
      .prepare(
        `SELECT
           trace.evidence_id, trace.evidence_relation, trace.evidence_revision,
           trace.source_id, trace.source_revision, trace.source_content_hash,
           trace.source_availability, trace.source_current_snapshot,
           trace.authority_tier, trace.use_class, trace.independence_state,
           trace.lineage_group, evidence.excerpt, evidence.summary_zh,
           source.title, source.publisher_or_site, revision.display_host,
           revision.language
         FROM fact_mapping_link_evidence AS trace
         JOIN claim_evidence AS evidence ON evidence.id = trace.evidence_id
         JOIN sources AS source ON source.id = trace.source_id
         JOIN source_revisions AS revision
           ON revision.source_id = trace.source_id
          AND revision.revision = trace.source_revision
         WHERE trace.mapping_id = ?
         ORDER BY trace.source_id, trace.source_revision, trace.evidence_id
         LIMIT 64`,
      )
      .all(mapping.id as string) as unknown as readonly Row[];
    const conflicts = this.#database
      .prepare(
        `SELECT id, state FROM fact_conflicts
         WHERE claim_left_id = ? OR claim_right_id = ?
         ORDER BY id LIMIT 64`,
      )
      .all(mapping.claim_id as string, mapping.claim_id as string) as unknown as readonly Row[];
    return Object.freeze({
      claim: Object.freeze({
        claimId: mapping.claim_id as string,
        current: mapping.claim_current_snapshot === 1,
        predicate: mapping.predicate as string,
        revision: mapping.claim_revision as number,
        scopeSummary: truncateCodePoints(
          canonicalFactMappingJson(json(mapping.scope_json)),
          MAX_VALUE_SUMMARY_CODE_POINTS,
        ),
        subjectId: mapping.subject_id as string,
        subjectType: mapping.subject_type as string,
        valueSummary: truncateCodePoints(
          canonicalFactMappingJson(json(mapping.value_json)),
          MAX_VALUE_SUMMARY_CODE_POINTS,
        ),
        valueType: mapping.value_type as string,
      }),
      conflicts: Object.freeze(
        conflicts.map((row) =>
          Object.freeze({
            conflictId: row.id as string,
            state: row.state as string,
          }),
        ),
      ),
      evaluation: Object.freeze({
        createdAt: mapping.evaluation_created_at as string,
        evaluationId: mapping.fact_evaluation_id as string,
        policyVersion: mapping.policy_version as string,
        reasonCode: mapping.reason_code as string,
        status: mapping.evaluation_status as string,
      }),
      evidence: Object.freeze(
        evidenceRows.map((row) =>
          Object.freeze({
            excerpt: truncateCodePoints(row.excerpt as string, MAX_EVIDENCE_EXCERPT_CODE_POINTS),
            relation: row.evidence_relation as ClaimEvidenceV1['relation'],
            revision: row.evidence_revision as number,
            source: Object.freeze({
              authorityTier: row.authority_tier as string,
              availability: row.source_availability as string,
              contentHashSummary: String(row.source_content_hash).slice(0, 12),
              current: row.source_current_snapshot === 1,
              displayHost: row.display_host as string | null,
              independence: row.independence_state as string,
              language: row.language as string,
              lineageGroup: row.lineage_group as string | null,
              publisherOrSite: row.publisher_or_site as string | null,
              revisionId: `${String(row.source_id)}:${String(row.source_revision)}`,
              title: truncateCodePoints(String(row.title), 200),
              useClass: row.use_class as string,
            }),
            summaryZh: row.summary_zh as string | null,
            summaryZhIsEvidence: false as const,
          }),
        ),
      ),
      statementId,
    });
  }

  public previewDecision(
    decision: FactMappingManualDecisionInputV1,
    nowValue: string,
  ): FactMappingDecisionPreviewView {
    const now = iso(nowValue);
    const prepared = this.#prepareDecision(decision, now);
    return Object.freeze({
      after: prepared.projection.after,
      before: prepared.projection.before,
      draftId: decision.draftId,
      draftVersionId: prepared.version.draft_version_id,
      expectedRevision: decision.expectedRevision,
      expectedStatus: prepared.projection.rollup.status,
      kind: decision.kind,
      statementId: decision.statementId,
    });
  }

  public applyDecision(input: {
    readonly decision: FactMappingManualDecisionInputV1;
    readonly executionId: string;
    readonly now: string;
    readonly previewHash: string;
  }): FactMappingDecisionExecution {
    identifier(input.executionId, 128);
    iso(input.now);
    if (!/^[a-f0-9]{64}$/u.test(input.previewHash)) {
      throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
    }
    const existingDecision = this.#database
      .prepare(
        `SELECT decision.id, decision.decision_kind, check_root.draft_id
         FROM fact_mapping_decisions AS decision
         JOIN fact_mapping_checks AS check_root ON check_root.id = decision.check_id
         JOIN fact_mapping_runs AS run ON run.id = (
           SELECT version.run_id FROM fact_mapping_check_versions AS version
           WHERE version.id = decision.resulting_version_id
         )
         WHERE run.execution_id = ?`,
      )
      .get(input.executionId) as Row | undefined;
    if (existingDecision !== undefined) {
      if (
        existingDecision.draft_id !== input.decision.draftId ||
        existingDecision.decision_kind !== input.decision.kind
      ) {
        throw new FactMappingError('FACT_MAPPING_CONFLICT');
      }
      return Object.freeze({
        decisionId: existingDecision.id as string,
        detail: this.get(input.decision.draftId),
        kind: input.decision.kind,
      });
    }
    const prepared = this.#prepareDecision(input.decision, input.now);
    const expectedPreviewHash = factMappingHash({
      decision: input.decision,
      preview: {
        after: prepared.projection.after,
        before: prepared.projection.before,
        draftId: input.decision.draftId,
        draftVersionId: prepared.version.draft_version_id,
        expectedRevision: input.decision.expectedRevision,
        expectedStatus: prepared.projection.rollup.status,
        kind: input.decision.kind,
        statementId: input.decision.statementId,
      },
    });
    if (input.previewHash !== expectedPreviewHash) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_INVALID');
    }
    const runId = randomUUID();
    const versionId = randomUUID();
    const decisionId = randomUUID();
    const plan = this.#database
      .prepare(
        `SELECT plan.*
         FROM fact_mapping_runs AS run
         JOIN fact_mapping_plans AS plan ON plan.id = run.plan_id
         WHERE run.id = ?`,
      )
      .get(prepared.version.run_id) as PlanRow | undefined;
    if (plan === undefined) throw new FactMappingError('FACT_MAPPING_CONFLICT');
    this.#publish({
      artifacts: prepared.artifacts,
      context: prepared.context,
      decision: {
        afterHash: factMappingHash(prepared.projection.after),
        beforeHash: factMappingHash(prepared.projection.before),
        decisionId,
        expectedRevision: input.decision.expectedRevision,
        kind: input.decision.kind,
        previewHash: input.previewHash,
        reason: input.decision.reason,
        reasonCode: `USER_${input.decision.kind}`,
        resultingRevision: input.decision.expectedRevision + 1,
        statementId: input.decision.statementId,
      },
      deterministic: prepared.projection,
      executionId: input.executionId,
      now: input.now,
      plan,
      runId,
      versionId,
    });
    return Object.freeze({
      decisionId,
      detail: this.get(input.decision.draftId),
      kind: input.decision.kind,
    });
  }

  public cancelRun(input: {
    readonly executionId: string;
    readonly expectedRevision: number;
    readonly now: string;
  }): FactMappingRunV1 {
    identifier(input.executionId, 128);
    page(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER);
    iso(input.now);
    const row = this.#database
      .prepare(`SELECT * FROM fact_mapping_runs WHERE execution_id = ?`)
      .get(input.executionId) as Row | undefined;
    if (row === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    if (row.revision !== input.expectedRevision) {
      throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
    }
    if (row.status === 'RUNNING') {
      return this.#run(input.executionId);
    }
    if (row.status !== 'PLANNED' && row.status !== 'QUEUED') {
      throw new FactMappingError('FACT_MAPPING_CONFLICT');
    }
    const changed = this.#database
      .prepare(
        `UPDATE fact_mapping_runs
         SET status = 'CANCELLED', stable_error_code = 'USER_CANCELLED',
             updated_at = ?, finished_at = ?, revision = revision + 1
         WHERE execution_id = ? AND revision = ? AND status IN ('PLANNED', 'QUEUED')`,
      )
      .run(input.now, input.now, input.executionId, input.expectedRevision);
    if (changed.changes !== 1) {
      throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
    }
    return this.#run(input.executionId);
  }

  public jobIdForExecution(executionIdValue: string): string | null {
    const executionId = identifier(executionIdValue, 128);
    const row = this.#database
      .prepare(`SELECT job_id FROM fact_mapping_runs WHERE execution_id = ?`)
      .get(executionId) as { readonly job_id: string | null } | undefined;
    if (row === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    return row.job_id;
  }

  public queryPlanEvidence(): readonly { readonly detail: string }[] {
    const queries: readonly {
      readonly bindings: readonly string[];
      readonly sql: string;
    }[] = [
      {
        bindings: ['x'],
        sql: `SELECT dependency.check_version_id
       FROM fact_mapping_dependencies AS dependency
       WHERE dependency.dependency_kind = 'CLAIM' AND dependency.dependency_id = ?
       ORDER BY dependency.check_version_id LIMIT 100`,
      },
      {
        bindings: ['x'],
        sql: `SELECT invalidation.reason_code
       FROM fact_mapping_invalidations AS invalidation
       WHERE invalidation.check_version_id = ?
       ORDER BY invalidation.created_at DESC LIMIT 100`,
      },
      {
        bindings: ['x', 'y'],
        sql: `SELECT version.id
       FROM fact_mapping_checks AS check_root
       JOIN fact_mapping_heads AS head ON head.check_id = check_root.id
       JOIN fact_mapping_check_versions AS version ON version.id = head.current_version_id
       WHERE check_root.draft_id = ? AND version.draft_version_id = ?`,
      },
    ];
    return Object.freeze(
      queries.flatMap(({ bindings, sql }) =>
        (this.#database.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...bindings) as Row[]).map((row) =>
          Object.freeze({ detail: row.detail as string }),
        ),
      ),
    );
  }

  #draft(draftId: string): { readonly payload: ContentDraftPayloadV1; readonly row: DraftRow } {
    const row = this.#database
      .prepare(
        `SELECT
           head.draft_id, head.current_version_id, head.draft_revision, head.draft_state,
           version.version_number, version.brief_version_id, version.profile_id,
           version.payload_json, version.content_hash, version.status,
           version.structural_valid, draft.brief_id
         FROM content_draft_heads AS head
         JOIN content_draft_versions AS version ON version.id = head.current_version_id
         JOIN drafts AS draft ON draft.id = head.draft_id
         WHERE head.draft_id = ?`,
      )
      .get(draftId) as DraftRow | undefined;
    if (row === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    const payload = assertContentDraftPayload(json(row.payload_json));
    if (
      row.draft_state !== 'ACTIVE' ||
      row.status !== 'READY_FOR_QUALITY_PIPELINE' ||
      row.structural_valid !== 1 ||
      row.content_hash !== copySemanticHash(payload)
    ) {
      throw new FactMappingError('FACT_MAPPING_NOT_READY');
    }
    return Object.freeze({ payload, row });
  }

  #artifacts(draft: {
    readonly payload: ContentDraftPayloadV1;
    readonly row: DraftRow;
  }): readonly MaterializedDraftArtifactV1[] {
    return materializeDraftPublicArtifacts({
      current: true,
      draftId: draft.row.draft_id,
      draftStatus: draft.row.status,
      draftVersionId: draft.row.current_version_id,
      payload: draft.payload,
      structuralValid: draft.row.structural_valid === 1,
    });
  }

  #resolveEntity(type: FactSubjectType, id: string): string {
    let current = id;
    const visited = new Set<string>();
    while (!visited.has(current)) {
      visited.add(current);
      const redirect = this.#database
        .prepare(
          `SELECT to_entity_id FROM entity_redirects
           WHERE entity_type = ? AND from_entity_id = ? AND active = 1`,
        )
        .get(type, current) as { readonly to_entity_id: string } | undefined;
      if (redirect === undefined) return current;
      current = redirect.to_entity_id;
    }
    throw new FactMappingError('FACT_MAPPING_CONFLICT');
  }

  #candidateContext(draft: {
    readonly payload: ContentDraftPayloadV1;
    readonly row: DraftRow;
  }): CandidateContext {
    const canonicalWorkIds = Object.freeze(
      [...new Set(draft.payload.brief.workIds.map((id) => this.#resolveEntity('WORK', id)))].sort(),
    );
    const briefRows = this.#database
      .prepare(
        `SELECT id, claim_id, evidence_locator_id
         FROM content_brief_evidence_refs
         WHERE version_id = ?
         ORDER BY id
         LIMIT 512`,
      )
      .all(draft.row.brief_version_id) as unknown as readonly Row[];
    const lineageRows = this.#database
      .prepare(
        `SELECT id, evidence_ref_ids_json
         FROM content_draft_lineage_refs
         WHERE version_id = ?
         ORDER BY artifact_kind, artifact_id, lineage_order
         LIMIT 4096`,
      )
      .all(draft.row.current_version_id) as unknown as readonly Row[];
    const lineageEvidenceIds = new Set(
      lineageRows.flatMap((row) => stringArray(row.evidence_ref_ids_json)),
    );
    const briefEvidenceIds = new Set(briefRows.map((row) => row.evidence_locator_id as string));
    const allowedEvidenceIds = new Set([...briefEvidenceIds, ...lineageEvidenceIds]);
    const allowedClaimIds = new Set(briefRows.map((row) => row.claim_id as string));
    const subjectIds = this.#subjectIds(canonicalWorkIds);
    if (allowedClaimIds.size === 0 && subjectIds.size === 0) {
      return Object.freeze({
        allowedEvidenceIds,
        candidates: buildClaimCandidateSet([], {
          allowedClaimIds,
          allowedEvidenceIds,
          allowedSubjectIds: subjectIds,
          workIds: new Set(canonicalWorkIds),
        }),
        canonicalWorkIds,
        lineageIds: Object.freeze(lineageRows.map((row) => row.id as string)),
        records: Object.freeze([]),
      });
    }
    const clauses: string[] = [];
    const bindings: string[] = [];
    if (allowedClaimIds.size > 0) {
      clauses.push(`claim.id IN (${placeholders(allowedClaimIds.size)})`);
      bindings.push(...allowedClaimIds);
    }
    if (subjectIds.size > 0) {
      clauses.push(`claim.subject_id IN (${placeholders(subjectIds.size)})`);
      bindings.push(...subjectIds);
    }
    const claimRows = this.#database
      .prepare(
        `SELECT
           claim.*,
           evaluation.id AS evaluation_id,
           evaluation.status AS evaluation_status,
           evaluation.policy_version AS evaluation_policy_version,
           evaluation.reason_code AS evaluation_reason_code,
           evaluation.input_identity_hash AS evaluation_input_hash,
           evaluation.created_at AS evaluation_created_at
         FROM claims AS claim
         LEFT JOIN fact_evaluations AS evaluation ON evaluation.id = (
           SELECT current_eval.id FROM fact_evaluations AS current_eval
           WHERE current_eval.claim_id = claim.id
           ORDER BY current_eval.created_at DESC, current_eval.id DESC LIMIT 1
         )
         WHERE claim.contract_version = 'atomic-claim-v1'
           AND claim.status <> 'REJECTED'
           AND (${clauses.join(' OR ')})
         ORDER BY claim.subject_type, claim.subject_id, claim.predicate,
                  claim.normalized_scope_hash, claim.id
         LIMIT 512`,
      )
      .all(...bindings) as unknown as readonly ClaimRow[];
    const claimIds = claimRows.map((row) => row.id);
    const evidenceByClaim = this.#evidenceByClaim(claimIds);
    const records: CandidateRecordV1[] = claimRows.map((row) => {
      const claim = this.#claim(row);
      const evidence = evidenceByClaim.get(claim.claimId) ?? Object.freeze([]);
      const provenance: CandidateRecordV1['provenance'] = Object.freeze(
        [
          ...(allowedClaimIds.has(claim.claimId) ||
          evidence.some(({ evidence: item }) => briefEvidenceIds.has(item.evidenceId))
            ? (['BRIEF_EVIDENCE'] as const)
            : []),
          ...(evidence.some(({ evidence: item }) => lineageEvidenceIds.has(item.evidenceId))
            ? (['DRAFT_LINEAGE'] as const)
            : []),
          ...(subjectIds.has(claim.subject.id) ? (['CANONICAL_SUBJECT'] as const) : []),
        ].sort(),
      );
      return Object.freeze({
        claim,
        current:
          claim.status === 'ACTIVE' &&
          this.#resolveEntity(claim.subject.type, claim.subject.id) === claim.subject.id,
        evaluation:
          row.evaluation_id === null
            ? null
            : Object.freeze({
                createdAt: row.evaluation_created_at as string,
                evaluationId: row.evaluation_id,
                inputIdentityHash: row.evaluation_input_hash as string,
                policyVersion: row.evaluation_policy_version as string,
                reasonCode: row.evaluation_reason_code as string,
                revision: 1,
                status: row.evaluation_status,
              }),
        evidence,
        provenance,
      });
    });
    return Object.freeze({
      allowedEvidenceIds,
      candidates: buildClaimCandidateSet(records, {
        allowedClaimIds,
        allowedEvidenceIds,
        allowedSubjectIds: subjectIds,
        workIds: new Set(canonicalWorkIds),
      }),
      canonicalWorkIds,
      lineageIds: Object.freeze(lineageRows.map((row) => row.id as string)),
      records: Object.freeze(records),
    });
  }

  #subjectIds(workIds: readonly string[]): ReadonlySet<string> {
    if (workIds.length === 0) return new Set();
    const workPlaceholders = placeholders(workIds.length);
    const ids = new Set(workIds);
    const expressions = this.#database
      .prepare(`SELECT id FROM expressions WHERE work_id IN (${workPlaceholders})`)
      .all(...workIds) as unknown as readonly Row[];
    expressions.forEach((row) => ids.add(row.id as string));
    const expressionIds = expressions.map((row) => row.id as string);
    if (expressionIds.length > 0) {
      const editions = this.#database
        .prepare(
          `SELECT id FROM book_editions
           WHERE expression_id IN (${placeholders(expressionIds.length)})`,
        )
        .all(...expressionIds) as unknown as readonly Row[];
      editions.forEach((row) => ids.add(row.id as string));
    }
    const agents = this.#database
      .prepare(
        `SELECT DISTINCT agent_id FROM catalog_agent_relations
         WHERE (scope_type = 'WORK' AND scope_id IN (${workPlaceholders}))
            OR (scope_type = 'EXPRESSION' AND scope_id IN (${placeholders(expressionIds.length || 1)}))
         LIMIT 512`,
      )
      .all(
        ...workIds,
        ...(expressionIds.length > 0 ? expressionIds : ['']),
      ) as unknown as readonly Row[];
    agents.forEach((row) => ids.add(row.agent_id as string));
    return ids;
  }

  #claim(row: ClaimRow): AtomicClaimV1 {
    return validateAtomicClaimV1({
      claimId: row.id,
      claimant:
        row.claimant_source_id === null
          ? null
          : {
              sourceId: row.claimant_source_id,
              sourceRevision: row.claimant_source_revision,
            },
      contractVersion: row.contract_version,
      createdAt: row.created_at,
      keyFact: row.key_fact === 1,
      predicate: row.predicate,
      predicateVersion: row.predicate_version,
      provenance: json(row.provenance_json),
      revision: row.revision,
      scope: json(row.scope_json),
      semanticFingerprint: row.semantic_fingerprint,
      status: row.status,
      subject: { id: row.subject_id, type: row.subject_type },
      value: json(row.value_json),
      valueType: row.value_type,
    });
  }

  #evidenceByClaim(
    claimIds: readonly string[],
  ): ReadonlyMap<string, readonly SourceEvidenceTraceV1[]> {
    if (claimIds.length === 0) return new Map();
    const rows = this.#database
      .prepare(
        `SELECT
           evidence.id, evidence.claim_id, evidence.source_id,
           evidence.source_revision, evidence.locator_version,
           evidence.locator_kind, evidence.locator_json, evidence.excerpt,
           evidence.excerpt_hash, evidence.supports_or_contradicts,
           evidence.language AS source_language, evidence.summary_zh,
           evidence.summary_method, evidence.model_execution_id,
           evidence.locator_validated, evidence.verification_status,
           evidence.revision, evidence.created_at,
           revision.content_hash AS source_content_hash,
           revision.availability, revision.display_host, revision.language,
           revision.origin_kind,
           source.title, source.publisher_or_site,
           classification.authority_tier, classification.use_class,
           classification.independence_state, classification.lineage_group,
           classification.classification_revision,
           (SELECT max(current_revision.revision) FROM source_revisions AS current_revision
            WHERE current_revision.source_id = evidence.source_id) AS max_source_revision
         FROM claim_evidence AS evidence
         JOIN source_revisions AS revision
           ON revision.source_id = evidence.source_id
          AND revision.revision = evidence.source_revision
         JOIN sources AS source ON source.id = evidence.source_id
         LEFT JOIN source_classifications AS classification
           ON classification.source_id = evidence.source_id
          AND classification.source_revision = evidence.source_revision
          AND classification.classification_revision = (
            SELECT max(current_classification.classification_revision)
            FROM source_classifications AS current_classification
            WHERE current_classification.source_id = evidence.source_id
              AND current_classification.source_revision = evidence.source_revision
          )
         WHERE evidence.claim_id IN (${placeholders(claimIds.length)})
           AND evidence.locator_kind = 'CHAR_RANGE'
           AND evidence.locator_validated = 1
         ORDER BY evidence.claim_id, evidence.source_id,
                  evidence.source_revision, evidence.id
         LIMIT 16384`,
      )
      .all(...claimIds) as unknown as readonly EvidenceRow[];
    const result = new Map<string, SourceEvidenceTraceV1[]>();
    for (const row of rows) {
      if (
        !['FETCH_DOCUMENT', 'BROWSER_CLIP', 'SYNTHETIC_FIXTURE', 'USER_LOCAL_INPUT'].includes(
          row.origin_kind,
        )
      ) {
        continue;
      }
      const locator = json<ClaimEvidenceV1['locator']>(row.locator_json);
      if (
        row.locator_version !== EVIDENCE_LOCATOR_VERSION ||
        locator.version !== EVIDENCE_LOCATOR_VERSION
      ) {
        continue;
      }
      const summary =
        row.summary_zh === null
          ? null
          : {
              excerptHash: row.excerpt_hash,
              locatorHash: evidenceSemanticHash(locator),
              method: row.summary_method,
              modelExecutionId: row.model_execution_id,
              textZh: row.summary_zh,
            };
      const evidence = validateClaimEvidenceV1({
        claimId: row.claim_id,
        contractVersion: EVIDENCE_RECORD_CONTRACT_VERSION,
        createdAt: row.created_at,
        evidenceId: row.id,
        excerpt: row.excerpt,
        excerptHash: row.excerpt_hash,
        locator,
        relation: row.supports_or_contradicts,
        revision: row.revision,
        sourceContentHash: row.source_content_hash,
        sourceLanguage: row.source_language,
        sourceRevisionId: `${row.source_id}:${row.source_revision}`,
        summary,
        verificationStatus: row.verification_status,
      });
      const item: SourceEvidenceTraceV1 = Object.freeze({
        authorityTier: row.authority_tier ?? 'UNKNOWN',
        availability: row.availability,
        current: row.source_revision === row.max_source_revision,
        displayHost: row.display_host,
        evidence,
        independence: row.independence_state ?? 'UNKNOWN',
        language: row.language,
        lineageGroup: row.lineage_group,
        originKind: row.origin_kind as SourceOriginKind,
        publisherOrSite: row.publisher_or_site,
        sourceContentHash: row.source_content_hash,
        sourceId: row.source_id,
        sourceRevision: row.source_revision,
        sourceRevisionId: `${row.source_id}:${row.source_revision}`,
        title: truncateCodePoints(row.title, 200),
        useClass: row.use_class ?? 'NOT_CLASSIFIED',
      });
      const claimId = row.claim_id;
      const group = result.get(claimId) ?? [];
      group.push(item);
      result.set(claimId, group);
    }
    return new Map(
      [...result.entries()].map(([key, value]) => [
        key,
        Object.freeze(value.slice(0, FACT_MAPPING_LIMITS.evidencePerClaim)),
      ]),
    );
  }

  #prepareDecision(
    decision: FactMappingManualDecisionInputV1,
    now: string,
  ): {
    readonly artifacts: readonly MaterializedDraftArtifactV1[];
    readonly context: CandidateContext;
    readonly projection: FactMappingManualProjectionV1;
    readonly version: VersionRow;
  } {
    identifier(decision.draftId);
    identifier(decision.statementId, 128);
    page(decision.expectedRevision, 0, Number.MAX_SAFE_INTEGER);
    if (decision.reason !== null && Array.from(decision.reason.trim()).length > 500) {
      throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
    }
    if (decision.kind === 'MAP_CLAIM') identifier(decision.claimId);
    if (decision.kind === 'UNDO') identifier(decision.targetVersionId, 128);
    if (
      decision.kind === 'SPLIT' &&
      (!Number.isSafeInteger(decision.splitCodePoint) || decision.splitCodePoint < 1)
    ) {
      throw new FactMappingError('FACT_MAPPING_INVALID_CONTRACT');
    }
    const draft = this.#draft(decision.draftId);
    const version = this.#currentVersion(decision.draftId, draft.row.current_version_id);
    if (version === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    const head = this.#database
      .prepare(`SELECT check_revision FROM fact_mapping_heads WHERE check_id = ?`)
      .get(version.check_id) as { readonly check_revision: number } | undefined;
    if (
      head === undefined ||
      head.check_revision !== decision.expectedRevision ||
      version.draft_version_id !== draft.row.current_version_id ||
      this.#invalidationReasons(version.id).length > 0
    ) {
      throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
    }
    const artifacts = this.#artifacts(draft);
    const artifactHash = factMappingHash(artifacts.map(({ artifact }) => artifact));
    const context = this.#candidateContext(draft);
    if (
      artifactHash !== version.artifact_hash ||
      context.candidates.inputHash !== version.candidate_hash ||
      context.candidates.dependencyHash !== version.dependency_hash
    ) {
      throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
    }
    const bundles = this.#editableBundles(version.id, artifacts, context, now);
    let replacementBundles: readonly FactMappingEditableBundleV1[] | undefined;
    if (decision.kind === 'UNDO') {
      const target = this.#database
        .prepare(
          `SELECT target.*
           FROM fact_mapping_check_versions AS target
           WHERE target.id = ? AND target.check_id = ? AND target.draft_version_id = ?`,
        )
        .get(decision.targetVersionId, version.check_id, version.draft_version_id) as
        VersionRow | undefined;
      if (
        target === undefined ||
        target.artifact_hash !== version.artifact_hash ||
        this.#invalidationReasons(target.id).length > 0
      ) {
        throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
      }
      replacementBundles = this.#editableBundles(target.id, artifacts, context, now);
    }
    const projection = projectFactMappingManualDecision({
      artifactHash,
      artifacts,
      bundles,
      candidates: context.candidates,
      createdAt: now,
      decision,
      idSeed: factMappingHash({
        decision,
        versionId: version.id,
      }),
      ...(replacementBundles === undefined ? {} : { replacementBundles }),
      warningBoundaryEscapes: buildWarningBoundaryEscapes(draft.payload),
    });
    return Object.freeze({ artifacts, context, projection, version });
  }

  #editableBundles(
    versionId: string,
    artifacts: readonly MaterializedDraftArtifactV1[],
    context: CandidateContext,
    createdAt: string,
  ): readonly FactMappingEditableBundleV1[] {
    const statements = this.#database
      .prepare(
        `SELECT * FROM fact_mapping_statements
         WHERE check_version_id = ?
         ORDER BY statement_order LIMIT 512`,
      )
      .all(versionId) as unknown as readonly StatementRow[];
    const mappings = new Map(
      (
        this.#database
          .prepare(
            `SELECT statement_id, claim_id, relation, mapper_provenance, reason
             FROM fact_mapping_links
             WHERE check_version_id = ?`,
          )
          .all(versionId) as Row[]
      ).map((row) => [row.statement_id as string, row]),
    );
    const signalMap = new Map<string, Row[]>();
    const signalRows = this.#database
      .prepare(
        `SELECT * FROM fact_mapping_signals
         WHERE check_version_id = ? AND statement_id IS NOT NULL
         ORDER BY statement_id, start_code_point, signal_kind
         LIMIT 1024`,
      )
      .all(versionId) as Row[];
    for (const row of signalRows) {
      const statementId = row.statement_id as string;
      const list = signalMap.get(statementId) ?? [];
      list.push(row);
      signalMap.set(statementId, list);
    }
    const artifactMap = new Map(
      artifacts.map((item) => [`${item.artifact.artifactKind}:${item.artifact.artifactId}`, item]),
    );
    return Object.freeze(
      statements.map((row) => {
        const artifact = artifactMap.get(`${row.artifact_kind}:${row.artifact_id}`);
        if (artifact === undefined) throw new FactMappingError('FACT_MAPPING_CONFLICT');
        const locator: DraftTextLocatorV1 = {
          artifactId: row.artifact_id,
          artifactKind: row.artifact_kind,
          draftVersionId: artifact.artifact.draftVersionId,
          endCodePoint: row.end_code_point,
          locatorVersion: DRAFT_TEXT_LOCATOR_VERSION,
          selectedTextHash: row.selected_text_hash,
          startCodePoint: row.start_code_point,
          textHash: row.artifact_text_hash,
        };
        const fragment = resolveDraftTextLocator(artifact, locator);
        const statement = createDraftStatement({
          classification: assertClassification({
            classificationVersion: FACT_MAPPING_CLASSIFICATION_VERSION,
            domain: row.fact_domain,
            kind: row.statement_kind,
            materiality: row.materiality,
            reasonCode: row.classification_reason_code,
            requiresReview: row.requires_review === 1,
          }),
          createdAt: row.created_at,
          locator,
          provenance: row.provenance,
          revision: row.statement_revision,
          statementId: row.id,
        });
        const signals = Object.freeze(
          (signalMap.get(row.id) ?? []).map((signal) =>
            Object.freeze({
              acknowledged: signal.acknowledged === 1,
              endCodePoint: signal.end_code_point as number,
              kind: signal.signal_kind as ReturnType<typeof detectProtectedSignals>[number]['kind'],
              policyVersion: PROTECTED_SIGNAL_POLICY_VERSION,
              reason: signal.acknowledgement_reason as string | null,
              signalId: signal.id as string,
              startCodePoint: signal.start_code_point as number,
              tokenHash: signal.token_hash as string,
            }),
          ),
        );
        const storedMapping = mappings.get(row.id);
        let mapping: StatementClaimMappingV1 | null = null;
        if (storedMapping?.claim_id !== null && storedMapping?.claim_id !== undefined) {
          const candidate = context.candidates.candidates.find(
            ({ claim }) => claim.claimId === storedMapping.claim_id,
          );
          if (candidate === undefined) {
            throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
          }
          mapping = createStatementClaimMapping({
            candidate,
            createdAt,
            ...(artifact.artifact.workIds.length === 1 && artifact.artifact.workIds[0] !== undefined
              ? { expectedSubjectId: artifact.artifact.workIds[0] }
              : {}),
            mapperProvenance: storedMapping.mapper_provenance as StatementProvenance,
            reason: storedMapping.reason as string | null,
            relation: storedMapping.relation as StatementClaimMappingV1['relation'],
            statement,
            statementText: fragment,
          });
        }
        return Object.freeze({
          fragment,
          result: evaluateStatementDisposition({
            mapping,
            signalsUnacknowledged:
              statement.classification.kind === 'FACT'
                ? 0
                : signals.filter(({ acknowledged }) => !acknowledged).length,
            statement,
          }),
          signals,
        });
      }),
    );
  }

  #revalidatePlan(
    plan: PlanRow,
    now: string,
    enforceExpiry = true,
  ): {
    readonly artifacts: readonly MaterializedDraftArtifactV1[];
    readonly context: CandidateContext;
    readonly deterministic: ReturnType<typeof buildDeterministicFactMapping>;
    readonly draft: {
      readonly payload: ContentDraftPayloadV1;
      readonly row: DraftRow;
    };
  } {
    if (enforceExpiry && Date.parse(now) > Date.parse(plan.expires_at)) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_EXPIRED');
    }
    const draft = this.#draft(plan.draft_id);
    if (
      draft.row.current_version_id !== plan.draft_version_id ||
      draft.row.draft_revision !== plan.expected_draft_revision
    ) {
      throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
    }
    const artifacts = this.#artifacts(draft);
    const context = this.#candidateContext(draft);
    const deterministic = buildDeterministicFactMapping({
      artifacts,
      candidates: context.candidates,
      createdAt: now,
      warningBoundaryEscapes: buildWarningBoundaryEscapes(draft.payload),
    });
    if (
      deterministic.inputHash !== plan.input_hash ||
      context.candidates.inputHash !== plan.candidate_hash ||
      context.candidates.dependencyHash !== plan.dependency_hash ||
      artifacts.length !== plan.artifact_count ||
      deterministic.statements.length !== plan.statement_count
    ) {
      throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
    }
    return Object.freeze({ artifacts, context, deterministic, draft });
  }

  #planView(
    row: PlanRow,
    profileId: ContentDraftPayloadV1['profileId'],
    workIds: readonly string[],
  ): FactMappingPlanV1 {
    return Object.freeze({
      artifactCount: row.artifact_count,
      briefVersionId: row.brief_version_id,
      budgetState: row.budget_state,
      cacheState: row.cache_state,
      candidateClaimCount: row.candidate_claim_count,
      candidateEvidenceCount: row.evidence_count,
      candidateSourceRevisionCount: row.source_revision_count,
      capabilityState: row.capability_state,
      checkerVersion: row.checker_version,
      classificationVersion: row.classification_version,
      createdAt: row.created_at,
      credentialState: row.credential_state,
      dependencyHash: row.dependency_hash,
      draftId: row.draft_id,
      draftRevision: row.expected_draft_revision,
      draftVersionId: row.draft_version_id,
      estimatedLocalWrites:
        4 +
        row.artifact_count +
        row.statement_count * 3 +
        row.evidence_count +
        row.source_revision_count,
      expiresAt: row.expires_at,
      inputCodePointCount: row.input_code_point_count,
      inputHash: row.input_hash,
      mappingPolicyVersion: row.mapping_policy_version,
      maximumModelRequests: row.maximum_model_requests,
      mode: row.mode,
      planId: row.id,
      previewHash: row.preview_hash,
      profileId,
      protectedSignalCount: row.protected_signal_count,
      segmentationVersion: row.segmentation_version,
      statementCount: row.statement_count,
      typedCompatibilityVersion: TYPED_FACT_COMPATIBILITY_VERSION,
      workIds: Object.freeze([...workIds]),
    });
  }

  #jobPayload(run: FactMappingRunV1): FactMappingJobPayloadV1 {
    const row = this.#database
      .prepare(
        `SELECT run.*, plan.expected_draft_revision
         FROM fact_mapping_runs AS run
         JOIN fact_mapping_plans AS plan ON plan.id = run.plan_id
         WHERE run.execution_id = ?`,
      )
      .get(run.executionId) as Row | undefined;
    if (row === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    return Object.freeze({
      candidateHash: row.candidate_hash as string,
      dependencyHash: row.dependency_hash as string,
      draftId: row.draft_id as string,
      draftRevision: row.expected_draft_revision as number,
      draftVersionId: row.draft_version_id as string,
      executionId: run.executionId,
      inputHash: row.input_hash as string,
      jobType: 'FACT_MAPPING_CHECK_V1',
      mode: run.mode,
      planId: row.plan_id as string,
      previewHash: row.preview_hash as string,
    });
  }

  #plan(planId: string): PlanRow {
    const row = this.#database
      .prepare(`SELECT * FROM fact_mapping_plans WHERE id = ?`)
      .get(planId) as PlanRow | undefined;
    if (row === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    return row;
  }

  #publish(input: {
    readonly artifacts: readonly MaterializedDraftArtifactV1[];
    readonly context: CandidateContext;
    readonly decision?: {
      readonly afterHash: string;
      readonly beforeHash: string;
      readonly decisionId: string;
      readonly expectedRevision: number;
      readonly kind: FactMappingManualDecisionInputV1['kind'];
      readonly previewHash: string;
      readonly reason: string | null;
      readonly reasonCode: string;
      readonly resultingRevision: number;
      readonly statementId: string;
    };
    readonly deterministic: {
      readonly artifactHash: string;
      readonly inputHash: string;
      readonly rollup: FactMappingRollupV1;
      readonly statements: readonly {
        readonly result: FactMappingStatementResultV1;
        readonly signals: readonly ReturnType<typeof detectProtectedSignals>[number][];
      }[];
      readonly warningBoundaryEscapes: readonly {
        readonly field:
          | 'bodyOpeningWarningText'
          | 'coverWarningText'
          | 'pinnedCommentWarningText'
          | 'titleWarningMarker';
        readonly signalCount: number;
        readonly textHash: string;
      }[];
    };
    readonly executionId: string;
    readonly existingRunId?: string;
    readonly externalRequestCount?: 0 | 1;
    readonly modelExecutionId?: string | null;
    readonly now: string;
    readonly plan: PlanRow;
    readonly runMode?: FactMappingMode;
    readonly runId: string;
    readonly versionId: string;
  }): void {
    const candidateByClaim = new Map(
      input.context.candidates.candidates.map((candidate) => [candidate.claim.claimId, candidate]),
    );
    runInTransaction(this.#database, () => {
      const currentHead = this.#database
        .prepare(
          `SELECT current_version_id, check_revision FROM fact_mapping_heads WHERE check_id = ?`,
        )
        .get(input.plan.check_id) as
        { readonly check_revision: number; readonly current_version_id: string } | undefined;
      if (
        input.decision !== undefined &&
        (currentHead === undefined ||
          currentHead.check_revision !== input.decision.expectedRevision)
      ) {
        throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
      }
      const versionNumberRow = this.#database
        .prepare(
          `SELECT coalesce(max(version_number), 0) + 1 AS next
           FROM fact_mapping_check_versions WHERE check_id = ?`,
        )
        .get(input.plan.check_id) as { readonly next: number };
      if (input.existingRunId === undefined) {
        this.#database
          .prepare(
            `INSERT INTO fact_mapping_runs(
             id, execution_id, plan_id, check_id, draft_id, draft_version_id,
             model_execution_id, mode, status, external_request_count, input_hash,
             candidate_hash, dependency_hash, preview_hash, revision,
             created_at, updated_at, finished_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
          )
          .run(
            input.runId,
            input.executionId,
            input.plan.id,
            input.plan.check_id,
            input.plan.draft_id,
            input.plan.draft_version_id,
            input.modelExecutionId ?? null,
            input.runMode ?? input.plan.mode,
            input.deterministic.rollup.status,
            input.externalRequestCount ?? 0,
            input.deterministic.inputHash,
            input.context.candidates.inputHash,
            input.context.candidates.dependencyHash,
            input.decision?.previewHash ?? input.plan.preview_hash,
            input.now,
            input.now,
            input.now,
          );
      } else {
        const changed = this.#database
          .prepare(
            `UPDATE fact_mapping_runs
             SET status = ?, external_request_count = ?, model_execution_id = ?,
                 input_hash = ?, candidate_hash = ?, dependency_hash = ?,
                 stable_error_code = NULL, updated_at = ?, finished_at = ?,
                 revision = revision + 1
             WHERE id = ? AND execution_id = ? AND plan_id = ?
               AND status IN ('QUEUED', 'RUNNING')`,
          )
          .run(
            input.deterministic.rollup.status,
            input.externalRequestCount ?? 0,
            input.modelExecutionId ?? null,
            input.deterministic.inputHash,
            input.context.candidates.inputHash,
            input.context.candidates.dependencyHash,
            input.now,
            input.now,
            input.existingRunId,
            input.executionId,
            input.plan.id,
          );
        if (changed.changes !== 1) {
          throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
        }
      }
      const counts = input.deterministic.rollup.counts;
      this.#database
        .prepare(
          `INSERT INTO fact_mapping_check_versions(
             id, check_id, draft_id, draft_version_id, run_id, version_number,
             previous_version_id, decision_revision, status,
             satisfied_count, not_applicable_count, needs_review_count,
             blocking_key_fact_count, unmapped_supporting_fact_count,
             conflicted_count, stale_count, warning_boundary_escape_count,
             reason_codes_json,
             input_hash, artifact_hash, candidate_hash, dependency_hash,
             checker_version, segmentation_version, classification_version,
             key_fact_policy_version, mapping_policy_version, created_at
           ) VALUES (
             ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
           )`,
        )
        .run(
          input.versionId,
          input.plan.check_id,
          input.plan.draft_id,
          input.plan.draft_version_id,
          input.runId,
          versionNumberRow.next,
          currentHead?.current_version_id ?? null,
          input.decision?.resultingRevision ?? 0,
          input.deterministic.rollup.status,
          counts.SATISFIED,
          counts.NOT_APPLICABLE,
          counts.NEEDS_REVIEW,
          counts.BLOCKING_KEY_FACT,
          counts.UNMAPPED_SUPPORTING_FACT,
          counts.CONFLICTED,
          counts.STALE,
          input.deterministic.rollup.warningBoundaryEscapeCount,
          safeJson(input.deterministic.rollup.reasonCodes, 8192),
          input.deterministic.inputHash,
          input.deterministic.artifactHash,
          input.context.candidates.inputHash,
          input.context.candidates.dependencyHash,
          FACT_MAPPING_CHECKER_VERSION,
          FACT_MAPPING_SEGMENTATION_VERSION,
          FACT_MAPPING_CLASSIFICATION_VERSION,
          KEY_FACT_POLICY_VERSION,
          FACT_MAPPING_CONTRACT_VERSION,
          input.now,
        );
      for (const item of input.artifacts) {
        this.#database
          .prepare(
            `INSERT INTO fact_mapping_artifacts(
               check_version_id, artifact_kind, artifact_id, artifact_order,
               text_hash, code_point_length, profile_id, lineage_hash,
               current_at_creation
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          )
          .run(
            input.versionId,
            item.artifact.artifactKind,
            item.artifact.artifactId,
            item.artifact.order,
            item.artifact.textHash,
            item.artifact.codePointLength,
            item.artifact.profileId,
            factMappingHash({
              evidenceRefIds: item.artifact.evidenceRefIds,
              workIds: item.artifact.workIds,
            }),
          );
      }
      input.deterministic.statements.forEach((bundle, statementOrder) => {
        const statement = bundle.result.statement;
        this.#database
          .prepare(
            `INSERT INTO fact_mapping_statements(
               id, check_version_id, artifact_kind, artifact_id, statement_order,
               start_code_point, end_code_point, artifact_text_hash,
               selected_text_hash, locator_version, statement_kind, materiality,
               fact_domain, classification_reason_code, requires_review,
               provenance, statement_revision, contract_version,
               segmentation_version, classification_version, created_at
             ) VALUES (
               ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
             )`,
          )
          .run(
            statement.statementId,
            input.versionId,
            statement.locator.artifactKind,
            statement.locator.artifactId,
            statementOrder,
            statement.locator.startCodePoint,
            statement.locator.endCodePoint,
            statement.locator.textHash,
            statement.locator.selectedTextHash,
            statement.locator.locatorVersion,
            statement.classification.kind,
            statement.classification.materiality,
            statement.classification.domain,
            statement.classification.reasonCode,
            statement.classification.requiresReview ? 1 : 0,
            statement.provenance,
            statement.revision,
            statement.contractVersion,
            statement.segmentationVersion,
            statement.classification.classificationVersion,
            statement.createdAt,
          );
        bundle.signals.forEach((signal) => {
          this.#database
            .prepare(
              `INSERT INTO fact_mapping_signals(
                 id, check_version_id, statement_id, warning_field, signal_kind,
                 start_code_point, end_code_point, token_hash, acknowledged,
                 acknowledgement_reason, policy_version
               ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              `signal-${factMappingHash([input.versionId, statement.statementId, signal.signalId]).slice(0, 32)}`,
              input.versionId,
              statement.statementId,
              signal.kind,
              signal.startCodePoint,
              signal.endCodePoint,
              signal.tokenHash,
              signal.acknowledged ? 1 : 0,
              signal.reason,
              signal.policyVersion,
            );
        });
        if (bundle.result.mapping !== null) {
          this.#insertMapping(
            input.versionId,
            bundle.result.mapping,
            candidateByClaim.get(bundle.result.mapping.claimId ?? ''),
          );
        }
      });
      for (const escape of input.deterministic.warningBoundaryEscapes) {
        const warningText = this.#warningText(input.plan.draft_version_id, escape.field);
        for (const signal of detectProtectedSignals(warningText)) {
          this.#database
            .prepare(
              `INSERT INTO fact_mapping_signals(
                 id, check_version_id, statement_id, warning_field, signal_kind,
                 start_code_point, end_code_point, token_hash, acknowledged,
                 acknowledgement_reason, policy_version
               ) VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 0, NULL, ?)`,
            )
            .run(
              `signal-${factMappingHash([input.versionId, escape.field, signal.signalId]).slice(0, 32)}`,
              input.versionId,
              escape.field,
              signal.kind,
              signal.startCodePoint,
              signal.endCodePoint,
              signal.tokenHash,
              signal.policyVersion,
            );
        }
      }
      this.#insertDependencies(
        input.versionId,
        input.plan,
        input.context,
        input.now,
        input.modelExecutionId ?? null,
      );
      if (input.decision !== undefined) {
        const parent = this.#database
          .prepare(
            `SELECT id FROM fact_mapping_decisions
             WHERE check_id = ?
             ORDER BY resulting_revision DESC LIMIT 1`,
          )
          .get(input.plan.check_id) as { readonly id: string } | undefined;
        this.#database
          .prepare(
            `INSERT INTO fact_mapping_decisions(
               id, check_id, resulting_version_id, statement_id,
               parent_decision_id, decision_kind, expected_revision,
               resulting_revision, preview_hash, before_hash, after_hash,
               reason_code, reason, actor, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USER', ?)`,
          )
          .run(
            input.decision.decisionId,
            input.plan.check_id,
            input.versionId,
            input.decision.statementId,
            parent?.id ?? null,
            input.decision.kind,
            input.decision.expectedRevision,
            input.decision.resultingRevision,
            input.decision.previewHash,
            input.decision.beforeHash,
            input.decision.afterHash,
            input.decision.reasonCode,
            input.decision.reason,
            input.now,
          );
      }
      if (currentHead === undefined) {
        this.#database
          .prepare(
            `INSERT INTO fact_mapping_heads(
               check_id, current_version_id, check_revision, updated_at
             ) VALUES (?, ?, 0, ?)`,
          )
          .run(input.plan.check_id, input.versionId, input.now);
      } else {
        const changed = this.#database
          .prepare(
            `UPDATE fact_mapping_heads
             SET current_version_id = ?, check_revision = check_revision + 1, updated_at = ?
             WHERE check_id = ? AND check_revision = ?`,
          )
          .run(input.versionId, input.now, input.plan.check_id, currentHead.check_revision);
        if (changed.changes !== 1) {
          throw new FactMappingError('FACT_MAPPING_STALE_REVISION');
        }
      }
      const status = input.deterministic.rollup.status;
      this.#database
        .prepare(
          `INSERT INTO quality_checks(
             id, draft_id, draft_version_id, fact_mapping_version_id,
             fact_mapping_run_id, check_type, result, summary_status, severity,
             reason_code, details_json, checker_version, input_hash,
             legacy_unresolved, created_at
           ) VALUES (?, ?, ?, ?, ?, 'FACT_MAPPING', ?, ?, ?, ?, '{}', ?, ?, 0, ?)`,
        )
        .run(
          randomUUID(),
          input.plan.draft_id,
          input.plan.draft_version_id,
          input.versionId,
          input.runId,
          status === 'PASS' ? 'PASS' : 'FAIL',
          status,
          status === 'PASS' ? 'INFO' : status === 'FACT_BLOCKED' ? 'BLOCKING' : 'REVIEW',
          status === 'PASS'
            ? 'ALL_FACTS_SATISFIED'
            : status === 'FACT_BLOCKED'
              ? 'KEY_FACT_BLOCKED'
              : 'REVIEW_REQUIRED',
          FACT_MAPPING_CHECKER_VERSION,
          input.deterministic.inputHash,
          input.now,
        );
    });
  }

  #insertMapping(
    versionId: string,
    mapping: StatementClaimMappingV1,
    candidate: ClaimCandidateV1 | undefined,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO fact_mapping_links(
           id, check_version_id, statement_id, claim_id, claim_revision,
           claim_current_snapshot, fact_evaluation_id, evaluation_revision,
           evaluation_policy_version, evaluation_status_snapshot,
           fact_policy_satisfied, fact_policy_reason_code, relation,
           compatibility_ok, compatibility_reason_code,
           candidate_provenance_json, mapper_provenance, reason,
           input_hash, semantic_hash, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        mapping.mappingId,
        versionId,
        mapping.statementId,
        mapping.claimId,
        mapping.claimRevision,
        mapping.claimCurrent ? 1 : 0,
        mapping.evaluationId,
        mapping.evaluationRevision,
        mapping.evaluationPolicyVersion,
        mapping.evaluationStatus,
        mapping.factPolicySatisfied ? 1 : 0,
        mapping.factPolicyReasonCode,
        mapping.relation,
        mapping.compatibility === null ? null : mapping.compatibility.compatible ? 1 : 0,
        mapping.compatibility?.reasonCode ?? null,
        safeJson(mapping.candidateProvenance, 1024),
        mapping.mapperProvenance,
        mapping.reason,
        mapping.inputHash,
        mapping.semanticHash,
        mapping.createdAt,
      );
    if (candidate === undefined) return;
    for (const trace of candidate.evidence) {
      this.#database
        .prepare(
          `INSERT INTO fact_mapping_link_evidence(
             mapping_id, evidence_id, source_id, source_revision,
             evidence_revision, evidence_relation, evidence_excerpt_hash,
             source_content_hash, source_availability, source_current_snapshot,
             authority_tier, use_class, independence_state, lineage_group
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          mapping.mappingId,
          trace.evidence.evidenceId,
          trace.sourceId,
          trace.sourceRevision,
          trace.evidence.revision,
          trace.evidence.relation,
          trace.evidence.excerptHash,
          trace.sourceContentHash,
          trace.availability,
          trace.current ? 1 : 0,
          trace.authorityTier,
          trace.useClass,
          trace.independence,
          trace.lineageGroup,
        );
    }
  }

  #insertDependencies(
    versionId: string,
    plan: PlanRow,
    context: CandidateContext,
    now: string,
    modelExecutionId: string | null,
  ): void {
    const dependencies: {
      readonly hash: string;
      readonly id: string;
      readonly kind: string;
      readonly revision: string;
      readonly typed: DependencyTypedColumns;
    }[] = [
      {
        hash: plan.input_hash,
        id: plan.draft_version_id,
        kind: 'DRAFT_VERSION',
        revision: plan.input_hash,
        typed: [plan.draft_version_id, null, null, null, null, null, null, null, null, null, null],
      },
      {
        hash: factMappingHash(plan.brief_version_id),
        id: plan.brief_version_id,
        kind: 'BRIEF_VERSION',
        revision: '1',
        typed: [null, plan.brief_version_id, null, null, null, null, null, null, null, null, null],
      },
      ...context.lineageIds.map((lineageId) => ({
        hash: factMappingHash(lineageId),
        id: lineageId,
        kind: 'DRAFT_LINEAGE',
        revision: '1',
        typed: [null, null, null, null, null, null, null, null, null, null, null] as const,
      })),
      ...context.canonicalWorkIds.map((workId) => ({
        hash: factMappingHash(['WORK', workId]),
        id: `WORK:${workId}`,
        kind: 'SUBJECT',
        revision: '1',
        typed: [null, null, null, 'WORK', workId, null, null, null, null, null, null] as const,
      })),
      ...[
        ['SEGMENTATION', FACT_MAPPING_SEGMENTATION_VERSION],
        ['CLASSIFICATION', FACT_MAPPING_CLASSIFICATION_VERSION],
        ['KEY_FACT', KEY_FACT_POLICY_VERSION],
        ['CANDIDATE', CLAIM_CANDIDATE_POLICY_VERSION],
        ['TYPED_COMPATIBILITY', TYPED_FACT_COMPATIBILITY_VERSION],
        ['MAPPING', FACT_MAPPING_CONTRACT_VERSION],
        ['CHECKER', FACT_MAPPING_CHECKER_VERSION],
      ].map(([kind, policyVersion]) => ({
        hash: factMappingHash([kind, policyVersion]),
        id: `${kind}:${policyVersion}`,
        kind: 'POLICY',
        revision: '1',
        typed: [null, null, null, null, null, null, null, null, null, null, null] as const,
      })),
      ...(modelExecutionId === null
        ? []
        : [
            {
              hash: factMappingHash(['MODEL_EXECUTION', modelExecutionId]),
              id: modelExecutionId,
              kind: 'MODEL_EXECUTION',
              revision: '1',
              typed: [null, null, null, null, null, null, null, null, null, null, null] as const,
            },
          ]),
    ];
    const briefEvidenceRows = this.#database
      .prepare(
        `SELECT id, dependency_hash FROM content_brief_evidence_refs
         WHERE version_id = ? ORDER BY id LIMIT 512`,
      )
      .all(plan.brief_version_id) as unknown as readonly Row[];
    briefEvidenceRows.forEach((row) =>
      dependencies.push({
        hash: row.dependency_hash as string,
        id: row.id as string,
        kind: 'BRIEF_EVIDENCE',
        revision: row.dependency_hash as string,
        typed: [null, null, row.id as string, null, null, null, null, null, null, null, null],
      }),
    );
    for (const candidate of context.candidates.candidates) {
      dependencies.push({
        hash: candidate.claim.semanticFingerprint,
        id: candidate.claim.claimId,
        kind: 'CLAIM',
        revision: String(candidate.claim.revision),
        typed: [
          null,
          null,
          null,
          null,
          null,
          candidate.claim.claimId,
          null,
          null,
          null,
          null,
          null,
        ],
      });
      if (candidate.evaluation !== null) {
        dependencies.push({
          hash: candidate.evaluation.inputIdentityHash,
          id: candidate.evaluation.evaluationId,
          kind: 'FACT_EVALUATION',
          revision: String(candidate.evaluation.revision),
          typed: [
            null,
            null,
            null,
            null,
            null,
            null,
            candidate.evaluation.evaluationId,
            null,
            null,
            null,
            null,
          ],
        });
      }
      for (const trace of candidate.evidence) {
        dependencies.push({
          hash: trace.evidence.excerptHash,
          id: trace.evidence.evidenceId,
          kind: 'EVIDENCE',
          revision: String(trace.evidence.revision),
          typed: [
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            trace.evidence.evidenceId,
            null,
            null,
            null,
          ],
        });
        dependencies.push({
          hash: factMappingHash([
            trace.sourceContentHash,
            trace.availability,
            trace.authorityTier,
            trace.useClass,
            trace.independence,
            trace.lineageGroup,
          ]),
          id: trace.sourceRevisionId,
          kind: 'SOURCE_REVISION',
          revision: String(trace.sourceRevision),
          typed: [
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            trace.sourceId,
            trace.sourceRevision,
            null,
          ],
        });
      }
      const conflicts = this.#database
        .prepare(
          `SELECT id, revision, state FROM fact_conflicts
           WHERE claim_left_id = ? OR claim_right_id = ?
           ORDER BY id LIMIT 64`,
        )
        .all(candidate.claim.claimId, candidate.claim.claimId) as unknown as readonly Row[];
      conflicts.forEach((conflict) =>
        dependencies.push({
          hash: factMappingHash([conflict.id, conflict.revision, conflict.state]),
          id: conflict.id as string,
          kind: 'CONFLICT',
          revision: String(conflict.revision),
          typed: [
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            conflict.id as string,
          ],
        }),
      );
    }
    const unique = new Map<string, (typeof dependencies)[number]>();
    dependencies.forEach((dependency) =>
      unique.set(`${dependency.kind}:${dependency.id}`, dependency),
    );
    const insert = this.#database.prepare(
      `INSERT INTO fact_mapping_dependencies(
         id, check_version_id, dependency_kind, dependency_id,
         dependency_revision, dependency_hash, draft_version_id,
         brief_version_id, brief_evidence_id, subject_type, subject_id,
         claim_id, fact_evaluation_id, evidence_id, source_id,
         source_revision, conflict_id, model_execution_id, current_at_creation
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    );
    for (const dependency of [...unique.values()].sort(
      (left, right) => left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id),
    )) {
      const [
        draftVersionId,
        briefVersionId,
        briefEvidenceId,
        subjectType,
        subjectId,
        claimId,
        evaluationId,
        evidenceId,
        sourceId,
        sourceRevision,
        conflictId,
      ] = dependency.typed;
      insert.run(
        `dep-${factMappingHash([versionId, dependency.kind, dependency.id]).slice(0, 32)}`,
        versionId,
        dependency.kind,
        dependency.id,
        dependency.revision,
        dependency.hash,
        draftVersionId,
        briefVersionId,
        briefEvidenceId,
        subjectType,
        subjectId,
        claimId,
        evaluationId,
        evidenceId,
        sourceId,
        sourceRevision,
        conflictId,
        dependency.kind === 'MODEL_EXECUTION' ? modelExecutionId : null,
      );
    }
    void now;
  }

  #warningText(
    draftVersionId: string,
    field:
      | 'bodyOpeningWarningText'
      | 'coverWarningText'
      | 'pinnedCommentWarningText'
      | 'titleWarningMarker',
  ): string {
    const row = this.#database
      .prepare(`SELECT payload_json FROM content_draft_versions WHERE id = ?`)
      .get(draftVersionId) as { readonly payload_json: string } | undefined;
    if (row === undefined) throw new FactMappingError('FACT_MAPPING_CONFLICT');
    return assertContentDraftPayload(json(row.payload_json)).spoilerWarnings[field] ?? '';
  }

  #currentVersion(draftId: string, draftVersionId: string): VersionRow | undefined {
    return this.#database
      .prepare(
        `SELECT version.*
         FROM fact_mapping_checks AS check_root
         JOIN fact_mapping_heads AS head ON head.check_id = check_root.id
         JOIN fact_mapping_check_versions AS version ON version.id = head.current_version_id
         WHERE check_root.draft_id = ? AND version.draft_version_id = ?`,
      )
      .get(draftId, draftVersionId) as VersionRow | undefined;
  }

  #headRevision(checkIdValue: string): number {
    const row = this.#database
      .prepare(`SELECT check_revision FROM fact_mapping_heads WHERE check_id = ?`)
      .get(checkIdValue) as { readonly check_revision: number } | undefined;
    if (row === undefined) throw new FactMappingError('FACT_MAPPING_CONFLICT');
    return row.check_revision;
  }

  #listItem(draft: {
    readonly payload: ContentDraftPayloadV1;
    readonly row: DraftRow;
  }): FactMappingListItem {
    const version = this.#currentVersion(draft.row.draft_id, draft.row.current_version_id);
    const stale = version === undefined ? false : this.#invalidationReasons(version.id).length > 0;
    return Object.freeze({
      briefVersionId: draft.row.brief_version_id,
      draftId: draft.row.draft_id,
      draftRevision: draft.row.draft_revision,
      draftVersionId: draft.row.current_version_id,
      profileId: draft.payload.profileId,
      status: version === undefined ? 'UNCHECKED' : stale ? 'STALE' : version.status,
      structuralStatus: 'READY_FOR_QUALITY_PIPELINE',
      versionNumber: draft.row.version_number,
      workIds: Object.freeze([...draft.payload.brief.workIds]),
    });
  }

  #candidateViews(context: CandidateContext): readonly FactMappingCandidateView[] {
    return Object.freeze(
      context.candidates.candidates.map((candidate) => {
        const policy = evaluateCandidateFactPolicy(candidate);
        return Object.freeze({
          claimId: candidate.claim.claimId,
          current: candidate.current,
          evaluationStatus: candidate.evaluation?.status ?? null,
          evidenceCount: candidate.evidence.length,
          factPolicyReasonCode: policy.reasonCode,
          factPolicySatisfied: policy.satisfied,
          predicate: candidate.claim.predicate,
          subjectId: candidate.claim.subject.id,
          subjectType: candidate.claim.subject.type,
          valueSummary: truncateCodePoints(
            canonicalFactMappingJson(candidate.claim.value),
            MAX_VALUE_SUMMARY_CODE_POINTS,
          ),
          valueType: candidate.claim.valueType,
        });
      }),
    );
  }

  #history(draftId: string): FactMappingDetailView['history'] {
    return Object.freeze(
      (
        this.#database
          .prepare(
            `SELECT
               version.id, version.version_number, version.status, version.created_at,
               version.input_hash, version.dependency_hash, version.reason_codes_json,
               CASE WHEN head.current_version_id = version.id THEN 1 ELSE 0 END AS current,
               EXISTS(
                 SELECT 1 FROM fact_mapping_invalidations AS invalidation
                 WHERE invalidation.check_version_id = version.id
               ) AS stale
             FROM fact_mapping_checks AS check_root
             JOIN fact_mapping_check_versions AS version
               ON version.check_id = check_root.id
             LEFT JOIN fact_mapping_heads AS head ON head.check_id = check_root.id
             WHERE check_root.draft_id = ?
             ORDER BY version.version_number DESC
             LIMIT 100`,
          )
          .all(draftId) as Row[]
      ).map((row) =>
        Object.freeze({
          createdAt: row.created_at as string,
          current: row.current === 1,
          dependencyHash: row.dependency_hash as string,
          inputHash: row.input_hash as string,
          reasonCodes: stringArray(row.reason_codes_json),
          status: row.stale === 1 ? ('STALE' as const) : (row.status as FactMappingDisplayStatus),
          versionId: row.id as string,
          versionNumber: row.version_number as number,
        }),
      ),
    );
  }

  #runs(draftId: string): readonly FactMappingRunV1[] {
    return Object.freeze(
      (
        this.#database
          .prepare(
            `SELECT * FROM fact_mapping_runs
             WHERE draft_id = ?
             ORDER BY created_at DESC, id
             LIMIT 50`,
          )
          .all(draftId) as Row[]
      ).map((row) => this.#runView(row)),
    );
  }

  #invalidationReasons(versionId: string): readonly string[] {
    return Object.freeze(
      (
        this.#database
          .prepare(
            `SELECT DISTINCT reason_code FROM fact_mapping_invalidations
             WHERE check_version_id = ?
             ORDER BY reason_code LIMIT 100`,
          )
          .all(versionId) as Row[]
      ).map((row) => row.reason_code as string),
    );
  }

  #statementView(
    statement: StatementRow,
    artifacts: ReadonlyMap<string, MaterializedDraftArtifactV1>,
  ): FactMappingStatementView {
    const artifact = artifacts.get(`${statement.artifact_kind}:${statement.artifact_id}`);
    if (artifact === undefined) throw new FactMappingError('FACT_MAPPING_CONFLICT');
    const locator: DraftTextLocatorV1 = {
      artifactId: statement.artifact_id,
      artifactKind: statement.artifact_kind,
      draftVersionId: artifact.artifact.draftVersionId,
      endCodePoint: statement.end_code_point,
      locatorVersion: DRAFT_TEXT_LOCATOR_VERSION,
      selectedTextHash: statement.selected_text_hash,
      startCodePoint: statement.start_code_point,
      textHash: statement.artifact_text_hash,
    };
    const fragment = resolveDraftTextLocator(artifact, locator);
    const mapping = this.#database
      .prepare(
        `SELECT claim_id, relation, compatibility_ok, compatibility_reason_code,
                claim_current_snapshot, evaluation_status_snapshot,
                fact_policy_satisfied, fact_policy_reason_code
         FROM fact_mapping_links WHERE statement_id = ?`,
      )
      .get(statement.id) as Row | undefined;
    const signals = this.#database
      .prepare(
        `SELECT signal_kind FROM fact_mapping_signals
         WHERE statement_id = ? ORDER BY start_code_point, signal_kind LIMIT 64`,
      )
      .all(statement.id) as unknown as readonly Row[];
    const disposition = this.#disposition(statement, mapping);
    return Object.freeze({
      artifactId: statement.artifact_id,
      artifactKind: statement.artifact_kind,
      claimId: (mapping?.claim_id as string | null | undefined) ?? null,
      compatibilityReasonCode:
        (mapping?.compatibility_reason_code as string | null | undefined) ?? null,
      disposition,
      domain: statement.fact_domain,
      factPolicyReasonCode: (mapping?.fact_policy_reason_code as string | null | undefined) ?? null,
      fragment: truncateCodePoints(fragment, 600),
      kind: statement.statement_kind,
      materiality: statement.materiality,
      protectedSignals: Object.freeze(signals.map((row) => row.signal_kind as string)),
      relation: (mapping?.relation as StatementClaimMappingV1['relation'] | undefined) ?? null,
      statementId: statement.id,
      statementOrder: statement.statement_order,
      startCodePoint: statement.start_code_point,
      endCodePoint: statement.end_code_point,
    });
  }

  #disposition(
    statement: StatementRow,
    mapping: Row | undefined,
  ): FactMappingStatementResultV1['disposition'] {
    if (statement.statement_kind === 'MIXED' || statement.statement_kind === 'AMBIGUOUS') {
      return 'NEEDS_REVIEW';
    }
    if (statement.statement_kind !== 'FACT') {
      return statement.requires_review === 1 ? 'NEEDS_REVIEW' : 'NOT_APPLICABLE';
    }
    if (mapping === undefined || mapping.relation === 'NO_CLAIM') {
      return statement.materiality === 'KEY_FACT'
        ? 'BLOCKING_KEY_FACT'
        : 'UNMAPPED_SUPPORTING_FACT';
    }
    if (mapping.relation === 'STALE' || mapping.claim_current_snapshot !== 1) return 'STALE';
    if (
      mapping.evaluation_status_snapshot === 'CONFLICTED' ||
      mapping.evaluation_status_snapshot === 'FACT_BLOCKED'
    ) {
      return 'CONFLICTED';
    }
    if (
      !['EXACT', 'SUPPORTED_PARAPHRASE', 'NARROWER_THAN_CLAIM'].includes(
        String(mapping.relation),
      ) ||
      mapping.compatibility_ok !== 1 ||
      mapping.evaluation_status_snapshot !== 'VERIFIED' ||
      mapping.fact_policy_satisfied !== 1
    ) {
      return statement.materiality === 'KEY_FACT'
        ? 'BLOCKING_KEY_FACT'
        : 'UNMAPPED_SUPPORTING_FACT';
    }
    return 'SATISFIED';
  }

  #execution(versionId: string): FactMappingStartExecution {
    const version = this.#database
      .prepare(`SELECT * FROM fact_mapping_check_versions WHERE id = ?`)
      .get(versionId) as VersionRow | undefined;
    if (version === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    const run = this.#database
      .prepare(`SELECT * FROM fact_mapping_runs WHERE id = ?`)
      .get(version.run_id) as Row | undefined;
    if (run === undefined) throw new FactMappingError('FACT_MAPPING_CONFLICT');
    return Object.freeze({
      checkVersion: Object.freeze({
        checkerVersion: FACT_MAPPING_CHECKER_VERSION,
        createdAt: version.created_at,
        decisionRevision: this.#headRevision(version.check_id),
        dependencyHash: version.dependency_hash,
        draftId: version.draft_id,
        draftVersionId: version.draft_version_id,
        inputHash: version.input_hash,
        rollup: rollupFromVersion(version),
        runId: version.run_id,
        versionId: version.id,
        versionNumber: version.version_number,
      }),
      run: Object.freeze({
        createdAt: run.created_at as string,
        draftId: run.draft_id as string,
        executionId: run.execution_id as string,
        externalRequestCount: run.external_request_count as 0 | 1,
        finishedAt: run.finished_at as string | null,
        modelExecutionId: run.model_execution_id as string | null,
        mode: run.mode as FactMappingMode,
        planId: run.plan_id as string,
        reasonCode: run.stable_error_code as string | null,
        revision: run.revision as number,
        runId: run.id as string,
        status: run.status as FactMappingRunV1['status'],
      }),
    });
  }

  #run(executionId: string): FactMappingRunV1 {
    const run = this.#database
      .prepare(`SELECT * FROM fact_mapping_runs WHERE execution_id = ?`)
      .get(executionId) as Row | undefined;
    if (run === undefined) throw new FactMappingError('FACT_MAPPING_NOT_FOUND');
    return this.#runView(run);
  }

  #runView(run: Row): FactMappingRunV1 {
    return Object.freeze({
      createdAt: run.created_at as string,
      draftId: run.draft_id as string,
      executionId: run.execution_id as string,
      externalRequestCount: run.external_request_count as 0 | 1,
      finishedAt: run.finished_at as string | null,
      modelExecutionId: run.model_execution_id as string | null,
      mode: run.mode as FactMappingMode,
      planId: run.plan_id as string,
      reasonCode: run.stable_error_code as string | null,
      revision: run.revision as number,
      runId: run.id as string,
      status: run.status as FactMappingRunV1['status'],
    });
  }
}
