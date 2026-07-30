import {
  AUTHENTICITY_POLICY_VERSION,
  EXPRESSION_PERMISSION_VERSION,
  SPOILER_POLICY_VERSION,
} from '@mystery-operations/authenticity';
import { DOSSIER_COVERAGE_POLICY_VERSION } from '@mystery-operations/dossier';
import { FACT_POLICY_VERSION } from '@mystery-operations/evidence';

import {
  TOPIC_ELIGIBILITY_POLICY_VERSION,
  TOPIC_FINGERPRINT_POLICY_VERSION,
  TOPIC_CONTENT_TYPES,
  TOPIC_GENERATION_PLAN_VERSION,
  TOPIC_LIMITS,
  type TopicAnalysisMode,
  type TopicContentType,
  type TopicExpressionForm,
} from './constants.js';
import {
  assertTopicCandidateDraft,
  type TopicCandidateDraft,
  type TopicContextClaimInput,
  type TopicDossierInput,
  type TopicPermissionInput,
  type TopicSubjectInput,
} from './contracts.js';
import { TopicError } from './errors.js';
import { createTopicSemanticFingerprint, topicSemanticHash } from './identity.js';

export interface TopicGenerationExpressionInput {
  readonly catalogRevision: number;
  readonly expressionForm: TopicExpressionForm;
  readonly expressionId: string;
}

export interface TopicGenerationWorkInput {
  readonly catalogRevision: number;
  readonly contextClaims: readonly TopicContextClaimInput[];
  readonly dossier: TopicDossierInput;
  readonly expressions: readonly TopicGenerationExpressionInput[];
  readonly permission: TopicPermissionInput;
  readonly workId: string;
}

export interface TopicGenerationPlanResult {
  readonly budgetConclusion: 'NOT_APPLICABLE';
  readonly candidates: readonly TopicCandidateDraft[];
  readonly contractVersion: typeof TOPIC_GENERATION_PLAN_VERSION;
  readonly counts: Readonly<Record<TopicContentType, number>>;
  readonly deduplicationLimit: number;
  readonly estimatedLocalWrites: number;
  readonly estimatedModelRequests: 0;
  readonly expectedPolicyVersions: Readonly<{
    authenticity: typeof AUTHENTICITY_POLICY_VERSION;
    dossierCoverage: typeof DOSSIER_COVERAGE_POLICY_VERSION;
    expressionPermission: typeof EXPRESSION_PERMISSION_VERSION;
    fact: typeof FACT_POLICY_VERSION;
    spoiler: typeof SPOILER_POLICY_VERSION;
    topicEligibility: typeof TOPIC_ELIGIBILITY_POLICY_VERSION;
    topicFingerprint: typeof TOPIC_FINGERPRINT_POLICY_VERSION;
  }>;
  readonly inputWorkCount: number;
  readonly localCombinationUpperBound: number;
  readonly modelExecutionState: 'UNCONFIGURED_DISABLED';
  readonly planHash: string;
}

function isArray(value: unknown): boolean {
  return Array.isArray(value);
}

function workSubject(
  work: TopicGenerationWorkInput,
  role: 'PRIMARY' | 'COMPARISON',
): TopicSubjectInput {
  return Object.freeze({
    catalogRevision: work.catalogRevision,
    editionId: null,
    expressionForm: null,
    expressionId: null,
    role,
    subjectId: work.workId,
    subjectType: 'WORK',
    workId: work.workId,
  });
}

function expressionSubject(
  work: TopicGenerationWorkInput,
  expression: TopicGenerationExpressionInput,
): TopicSubjectInput {
  return Object.freeze({
    catalogRevision: expression.catalogRevision,
    editionId: null,
    expressionForm: expression.expressionForm,
    expressionId: expression.expressionId,
    role: 'PRIMARY',
    subjectId: expression.expressionId,
    subjectType: 'EXPRESSION',
    workId: work.workId,
  });
}

function modeFor(works: readonly TopicGenerationWorkInput[]): TopicAnalysisMode | null {
  if (
    works.every(
      (work) =>
        work.permission.personalContentMode === 'ALLOWED' ||
        work.permission.personalContentMode === 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY',
    )
  ) {
    return 'PERSONAL';
  }
  if (
    works.every(
      (work) =>
        work.permission.publicResearchContentMode === 'RESEARCH_ONLY' ||
        work.permission.publicResearchContentMode === 'ALLOWED',
    )
  ) {
    return 'PUBLIC_RESEARCH';
  }
  return null;
}

function labels(mode: TopicAnalysisMode): readonly '公开资料整理'[] {
  return mode === 'PUBLIC_RESEARCH' ? Object.freeze(['公开资料整理'] as const) : Object.freeze([]);
}

function spoilerPolicyFor(
  works: readonly TopicGenerationWorkInput[],
): TopicCandidateDraft['spoilerPolicy'] {
  const first = works[0]?.permission.spoiler;
  if (
    first === undefined ||
    works.some(
      (work) =>
        work.permission.spoiler.level !== first.level ||
        work.permission.spoiler.userConfirmationRequired !== first.userConfirmationRequired ||
        work.permission.spoiler.warningPlacement !== first.warningPlacement ||
        work.permission.spoiler.warningRequired !== first.warningRequired,
    )
  ) {
    throw new TopicError('TOPIC_INVALID_CONTRACT');
  }
  return Object.freeze({
    userConfirmationRequired: first.userConfirmationRequired,
    warningPlacement: first.warningPlacement,
    warningRequired: first.warningRequired,
  });
}

function draft(
  input: Omit<TopicCandidateDraft, 'provenance' | 'requiredPublicLabels'> & {
    readonly requiredPublicLabels?: readonly '公开资料整理'[];
  },
): TopicCandidateDraft {
  return assertTopicCandidateDraft({
    ...input,
    provenance: 'LOCAL_DETERMINISTIC',
    requiredPublicLabels: input.requiredPublicLabels ?? labels(input.analysisMode),
  });
}

function sameSpoiler(left: TopicGenerationWorkInput, right: TopicGenerationWorkInput): boolean {
  return (
    left.permission.spoiler.level === right.permission.spoiler.level &&
    left.permission.spoiler.satisfied &&
    right.permission.spoiler.satisfied
  );
}

export function buildLocalTopicGenerationPlan(
  inputWorks: readonly TopicGenerationWorkInput[],
): TopicGenerationPlanResult {
  if (
    !isArray(inputWorks) ||
    inputWorks.length > TOPIC_LIMITS.maxCandidatesPerGeneration ||
    new Set(inputWorks.map((work) => work.workId)).size !== inputWorks.length
  ) {
    throw new TopicError('TOPIC_INVALID_CONTRACT');
  }
  const works = [...inputWorks].sort((left, right) => left.workId.localeCompare(right.workId));
  const raw: TopicCandidateDraft[] = [];

  for (const work of works) {
    const analysisMode = modeFor([work]);
    if (analysisMode === null || !work.permission.spoiler.satisfied) continue;
    if (work.permission.spoiler.level === 'NO_SPOILER') {
      raw.push(
        draft({
          analysisMode,
          candidateJudgment: null,
          centralQuestion: '现有证据支持怎样的单书判断边界？',
          comparisonDimension: null,
          contentType: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
          contextClaimIds: [],
          spoilerPolicy: spoilerPolicyFor([work]),
          spoilerLevel: 'NO_SPOILER',
          subjects: [workSubject(work, 'PRIMARY')],
          topicAngle: '单书判卷 证据边界',
        }),
      );
    }
    if (work.permission.spoiler.level === 'FULL_TRICK_ANALYSIS') {
      raw.push(
        draft({
          analysisMode,
          candidateJudgment: null,
          centralQuestion: '核心诡计与逻辑链条可如何逐段核验？',
          comparisonDimension: null,
          contentType: 'FULL_TRICK_LOGIC_ANALYSIS',
          contextClaimIds: [],
          spoilerPolicy: spoilerPolicyFor([work]),
          spoilerLevel: 'FULL_TRICK_ANALYSIS',
          subjects: [workSubject(work, 'PRIMARY')],
          topicAngle: '完整诡计 逻辑链核验',
        }),
      );
    }
    const usableClaims = work.contextClaims.filter(
      (claim) =>
        !claim.contextOnly &&
        (claim.factStatus === 'VERIFIED' || claim.factStatus === 'SUPPORTED_NOT_VERIFIED'),
    );
    if (usableClaims.length > 0) {
      raw.push(
        draft({
          analysisMode,
          candidateJudgment: null,
          centralQuestion: '作品与可追溯文化背景之间存在怎样的可验证关联？',
          comparisonDimension: 'SOCIAL_CONTEXT',
          contentType: 'MYSTERY_AND_CULTURAL_PHENOMENON',
          contextClaimIds: usableClaims
            .slice(0, TOPIC_LIMITS.contextClaims)
            .map((claim) => claim.claimId),
          spoilerPolicy: spoilerPolicyFor([work]),
          spoilerLevel: work.permission.spoiler.level,
          subjects: [workSubject(work, 'PRIMARY')],
          topicAngle: '作品与文化现象 可追溯关联',
        }),
      );
    }
  }

  let combinations = 0;
  for (let leftIndex = 0; leftIndex < works.length; leftIndex += 1) {
    const left = works[leftIndex];
    if (left === undefined) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < works.length; rightIndex += 1) {
      if (combinations >= TOPIC_LIMITS.localCombinationLimit) break;
      combinations += 1;
      const right = works[rightIndex];
      if (right === undefined) continue;
      if (!sameSpoiler(left, right)) continue;
      const analysisMode = modeFor([left, right]);
      if (analysisMode === null) continue;
      raw.push(
        draft({
          analysisMode,
          candidateJudgment: null,
          centralQuestion: '两部作品在公平性与线索组织上有哪些可验证差异？',
          comparisonDimension: 'FAIR_PLAY',
          contentType: 'CROSS_WORK_COMPARISON',
          contextClaimIds: [],
          spoilerPolicy: spoilerPolicyFor([left, right]),
          spoilerLevel: left.permission.spoiler.level,
          subjects: [workSubject(left, 'PRIMARY'), workSubject(right, 'PRIMARY')],
          topicAngle: '横向比较 公平性与线索组织',
        }),
      );

      const leftWeb = left.expressions.find(
        (expression) => expression.expressionForm === 'WEB_SERIALIZED',
      );
      const leftPublished = left.expressions.find(
        (expression) => expression.expressionForm === 'PUBLISHED_EDITION',
      );
      const rightWeb = right.expressions.find(
        (expression) => expression.expressionForm === 'WEB_SERIALIZED',
      );
      const rightPublished = right.expressions.find(
        (expression) => expression.expressionForm === 'PUBLISHED_EDITION',
      );
      const pair =
        leftWeb !== undefined && rightPublished !== undefined
          ? ([left, leftWeb, right, rightPublished] as const)
          : rightWeb !== undefined && leftPublished !== undefined
            ? ([right, rightWeb, left, leftPublished] as const)
            : null;
      if (pair !== null) {
        raw.push(
          draft({
            analysisMode,
            candidateJudgment: null,
            centralQuestion: '网络连载与出版形态如何改变可核验的叙事组织？',
            comparisonDimension: 'PUBLICATION_FORM',
            contentType: 'WEB_VS_PUBLISHED_MYSTERY',
            contextClaimIds: [],
            spoilerPolicy: spoilerPolicyFor([pair[0], pair[2]]),
            spoilerLevel: left.permission.spoiler.level,
            subjects: [expressionSubject(pair[0], pair[1]), expressionSubject(pair[2], pair[3])],
            topicAngle: '网络与出版形态 叙事组织比较',
          }),
        );
      }
    }
    if (combinations >= TOPIC_LIMITS.localCombinationLimit) break;
  }

  const candidatesByFingerprint = new Map<string, TopicCandidateDraft>();
  for (const candidate of raw) {
    const fingerprint = createTopicSemanticFingerprint({
      analysisMode: candidate.analysisMode,
      comparisonDimension: candidate.comparisonDimension,
      contentType: candidate.contentType,
      normalizedAngleIntent: candidate.topicAngle,
      spoilerLevel: candidate.spoilerLevel,
      subjectIds: candidate.subjects.map((subject) => subject.workId),
    }).fingerprint;
    if (!candidatesByFingerprint.has(fingerprint))
      candidatesByFingerprint.set(fingerprint, candidate);
  }
  const candidates = Object.freeze(
    [...candidatesByFingerprint.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .slice(0, TOPIC_LIMITS.maxCandidatesPerGeneration)
      .map(([, candidate]) => candidate),
  );
  const counts = Object.fromEntries(
    TOPIC_CONTENT_TYPES.map((type) => [
      type,
      candidates.filter((candidate) => candidate.contentType === type).length,
    ]),
  ) as Record<TopicContentType, number>;
  const planInput = {
    candidates,
    contractVersion: TOPIC_GENERATION_PLAN_VERSION,
    inputWorks: works.map((work) => ({
      catalogRevision: work.catalogRevision,
      dossierVersionId: work.dossier.versionId,
      permissionSnapshotId: work.permission.snapshotId,
      workId: work.workId,
    })),
    limits: {
      localCombinationUpperBound: Math.min(
        TOPIC_LIMITS.localCombinationLimit,
        Math.trunc((works.length * Math.max(0, works.length - 1)) / 2),
      ),
      maxCandidates: TOPIC_LIMITS.maxCandidatesPerGeneration,
    },
    policyVersions: {
      authenticity: AUTHENTICITY_POLICY_VERSION,
      dossierCoverage: DOSSIER_COVERAGE_POLICY_VERSION,
      expressionPermission: EXPRESSION_PERMISSION_VERSION,
      fact: FACT_POLICY_VERSION,
      spoiler: SPOILER_POLICY_VERSION,
      topicEligibility: TOPIC_ELIGIBILITY_POLICY_VERSION,
      topicFingerprint: TOPIC_FINGERPRINT_POLICY_VERSION,
    },
  };
  return Object.freeze({
    budgetConclusion: 'NOT_APPLICABLE',
    candidates,
    contractVersion: TOPIC_GENERATION_PLAN_VERSION,
    counts: Object.freeze(counts),
    deduplicationLimit: TOPIC_LIMITS.maxCandidatesPerGeneration,
    estimatedLocalWrites: candidates.length * 10,
    estimatedModelRequests: 0,
    expectedPolicyVersions: Object.freeze(planInput.policyVersions),
    inputWorkCount: works.length,
    localCombinationUpperBound: planInput.limits.localCombinationUpperBound,
    modelExecutionState: 'UNCONFIGURED_DISABLED',
    planHash: topicSemanticHash(planInput),
  });
}
