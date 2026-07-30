import {
  AUTHENTICITY_POLICY_VERSION,
  EXPRESSION_PERMISSION_VERSION,
  SCORE_POLICY_VERSION,
  SPOILER_POLICY_VERSION,
  type AuthenticityReasonCode,
  type AuthenticitySpoilerLevel,
  type ExpressionPermissionState,
  type SpoilerWarningPlacement,
} from './constants.js';
import { assertExpressionPermissionInput, type ExpressionPermissionInput } from './contracts.js';
import { authenticitySemanticHash } from './identity.js';

export interface SpoilerPolicyResult {
  readonly coreTrickDisclosure: boolean;
  readonly endingDisclosure: boolean;
  readonly level: AuthenticitySpoilerLevel;
  readonly reasonCodes: readonly AuthenticityReasonCode[];
  readonly satisfied: boolean;
  readonly userConfirmationRequired: boolean;
  readonly warningPlacement: SpoilerWarningPlacement;
  readonly warningRequired: boolean;
}

export interface ExpressionPermissionSnapshotV1 {
  readonly authenticityPolicyVersion: typeof AUTHENTICITY_POLICY_VERSION;
  readonly blockingReasonCodes: readonly AuthenticityReasonCode[];
  readonly contentBriefModes: {
    readonly personalExperience: ExpressionPermissionState;
    readonly publicResearchAnalysis: ExpressionPermissionState;
  };
  readonly contentBriefReadiness: ExpressionPermissionState;
  readonly dependencyHash: string;
  readonly dossier: ExpressionPermissionInput['dossier'];
  readonly evaluatedAt: string;
  readonly firstPersonPermission: ExpressionPermissionState;
  readonly personalExperiencePermission: ExpressionPermissionState;
  readonly personalScorePermission: ExpressionPermissionState;
  readonly profileId: string;
  readonly publicLabels: {
    readonly researchAnalysis: '公开资料整理';
    readonly researchScore: '资料分析评分';
  };
  readonly publicResearchAnalysisPermission: ExpressionPermissionState;
  readonly readingStateRevisionId: string;
  readonly researchAnalysisScorePermission: ExpressionPermissionState;
  readonly scorePolicyVersion: typeof SCORE_POLICY_VERSION;
  readonly snapshotVersion: typeof EXPRESSION_PERMISSION_VERSION;
  readonly spoiler: SpoilerPolicyResult;
  readonly spoilerPolicyVersion: typeof SPOILER_POLICY_VERSION;
  readonly stale: boolean;
  readonly warningReasonCodes: readonly AuthenticityReasonCode[];
  readonly workId: string;
}

export function evaluateSpoilerPolicy(
  selection: ExpressionPermissionInput['spoilerSelection'],
): SpoilerPolicyResult {
  switch (selection.level) {
    case 'NO_SPOILER':
      return Object.freeze({
        coreTrickDisclosure: false,
        endingDisclosure: false,
        level: selection.level,
        reasonCodes: Object.freeze([]),
        satisfied: true,
        userConfirmationRequired: false,
        warningPlacement: 'NONE',
        warningRequired: false,
      });
    case 'LIGHT_SPOILER': {
      const reasons: AuthenticityReasonCode[] = selection.warningIncluded
        ? []
        : ['SPOILER_WARNING_REQUIRED'];
      return Object.freeze({
        coreTrickDisclosure: false,
        endingDisclosure: false,
        level: selection.level,
        reasonCodes: Object.freeze(reasons),
        satisfied: selection.warningIncluded,
        userConfirmationRequired: false,
        warningPlacement: 'BODY_OPENING',
        warningRequired: true,
      });
    }
    case 'FULL_TRICK_ANALYSIS': {
      const reasons: AuthenticityReasonCode[] = [];
      if (!selection.warningIncluded) reasons.push('SPOILER_WARNING_REQUIRED');
      if (!selection.userConfirmed) reasons.push('SPOILER_USER_CONFIRMATION_REQUIRED');
      return Object.freeze({
        coreTrickDisclosure: true,
        endingDisclosure: true,
        level: selection.level,
        reasonCodes: Object.freeze(reasons),
        satisfied: reasons.length === 0,
        userConfirmationRequired: true,
        warningPlacement: 'COVER_TITLE_AND_BODY_OPENING',
        warningRequired: true,
      });
    }
  }
}

function dossierReasons(input: ExpressionPermissionInput): AuthenticityReasonCode[] {
  if (input.dossier === null) return ['DOSSIER_NOT_READY'];
  if (input.dossier.stale || input.dossier.readiness === 'STALE') return ['DOSSIER_STALE'];
  switch (input.dossier.readiness) {
    case 'FACT_BLOCKED':
      return ['DOSSIER_FACT_BLOCKED'];
    case 'INSUFFICIENT_COVERAGE':
      return ['DOSSIER_INSUFFICIENT'];
    case 'READY_FOR_CONTENT_BRIEF':
      return [];
    default:
      return ['DOSSIER_NOT_READY'];
  }
}

function uniqueSortedReasonCodes(
  reasons: readonly AuthenticityReasonCode[],
): readonly AuthenticityReasonCode[] {
  return Object.freeze([...new Set(reasons)].sort());
}

export function evaluateExpressionPermission(
  rawInput: unknown,
  evaluatedAt = new Date().toISOString(),
): ExpressionPermissionSnapshotV1 {
  const input = assertExpressionPermissionInput(rawInput);
  const currentAssertions = input.assertions.filter(
    (assertion) =>
      assertion.status === 'CONFIRMED' &&
      assertion.readingStateRevisionId === input.readingStateRevisionId,
  );
  const hasCurrentAssertion = currentAssertions.length > 0;
  const hasPersonalScoreAssertion = currentAssertions.some(
    (assertion) => assertion.assertionKind === 'PERSONAL_SCORE',
  );
  const dossierBlocking = dossierReasons(input);
  const dossierReady = dossierBlocking.length === 0;
  const dossierStale = dossierBlocking.includes('DOSSIER_STALE');
  const spoiler = evaluateSpoilerPolicy(input.spoilerSelection);

  let personalExperiencePermission: ExpressionPermissionState = 'BLOCKED';
  let firstPersonPermission: ExpressionPermissionState = 'BLOCKED';
  let personalScorePermission: ExpressionPermissionState = 'BLOCKED';

  switch (input.readingState) {
    case 'R1_READ_CLEAR':
      personalExperiencePermission = 'ALLOWED';
      firstPersonPermission = 'ALLOWED';
      personalScorePermission = 'ALLOWED';
      break;
    case 'R2_READ_FUZZY':
      if (hasCurrentAssertion) {
        personalExperiencePermission = 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY';
        firstPersonPermission = 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY';
      }
      if (hasPersonalScoreAssertion) {
        personalScorePermission = 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY';
      }
      break;
    case 'R3_READ_UNCONFIRMED_DETAILS':
    case 'S1_RESEARCH_ONLY':
    case 'S2_RESEARCH_INSUFFICIENT':
    case 'UNCLASSIFIED':
      break;
  }

  const researchEligible =
    input.readingState !== 'S2_RESEARCH_INSUFFICIENT' && input.readingState !== 'UNCLASSIFIED';
  const publicResearchAnalysisPermission: ExpressionPermissionState = dossierStale
    ? 'STALE_REVIEW_REQUIRED'
    : researchEligible && dossierReady
      ? 'RESEARCH_ONLY'
      : 'BLOCKED';
  const researchAnalysisScorePermission = publicResearchAnalysisPermission;

  const personalModeAllowed =
    dossierReady &&
    (firstPersonPermission === 'ALLOWED' ||
      firstPersonPermission === 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY');
  const researchModeAllowed = publicResearchAnalysisPermission === 'RESEARCH_ONLY';
  const personalMode: ExpressionPermissionState = dossierStale
    ? 'STALE_REVIEW_REQUIRED'
    : personalModeAllowed && spoiler.satisfied
      ? firstPersonPermission
      : 'BLOCKED';
  const researchMode: ExpressionPermissionState = dossierStale
    ? 'STALE_REVIEW_REQUIRED'
    : researchModeAllowed && spoiler.satisfied
      ? 'RESEARCH_ONLY'
      : 'BLOCKED';
  const contentBriefReadiness: ExpressionPermissionState =
    personalMode === 'STALE_REVIEW_REQUIRED' || researchMode === 'STALE_REVIEW_REQUIRED'
      ? 'STALE_REVIEW_REQUIRED'
      : personalMode !== 'BLOCKED' || researchMode !== 'BLOCKED'
        ? 'ALLOWED'
        : 'BLOCKED';

  const blockingReasons: AuthenticityReasonCode[] = [...dossierBlocking];
  const warningReasons: AuthenticityReasonCode[] = [...spoiler.reasonCodes];
  if (input.readingState === 'UNCLASSIFIED') {
    blockingReasons.push('READING_STATE_UNCLASSIFIED');
  }
  if (input.readingState === 'S2_RESEARCH_INSUFFICIENT') {
    blockingReasons.push('S2_RESEARCH_INSUFFICIENT');
  }
  if (input.readingState === 'R3_READ_UNCONFIRMED_DETAILS') {
    blockingReasons.push('R3_DETAILS_UNCONFIRMED');
  }
  if (firstPersonPermission === 'BLOCKED') blockingReasons.push('FIRST_PERSON_BLOCKED');
  if (input.readingState === 'R2_READ_FUZZY' && !hasCurrentAssertion) {
    blockingReasons.push('ASSERTION_REQUIRED');
  }
  if (personalScorePermission === 'BLOCKED') blockingReasons.push('PERSONAL_SCORE_BLOCKED');
  if (input.readingState === 'R2_READ_FUZZY' && !hasPersonalScoreAssertion) {
    blockingReasons.push('PERSONAL_SCORE_ASSERTION_REQUIRED');
  }
  if (publicResearchAnalysisPermission === 'BLOCKED') {
    blockingReasons.push('RESEARCH_ANALYSIS_BLOCKED');
  } else if (publicResearchAnalysisPermission === 'RESEARCH_ONLY') {
    warningReasons.push('PUBLIC_RESEARCH_LABEL_REQUIRED', 'RESEARCH_SCORE_LABEL_REQUIRED');
  }
  blockingReasons.push(...spoiler.reasonCodes);

  const dependencyInput = {
    assertions: currentAssertions
      .map((assertion) => ({
        assertionId: assertion.assertionId,
        assertionRevision: assertion.assertionRevision,
      }))
      .sort((left, right) => left.assertionId.localeCompare(right.assertionId)),
    authenticityPolicyVersion: AUTHENTICITY_POLICY_VERSION,
    dossier: input.dossier,
    profileId: input.profileId,
    readingStateRevisionId: input.readingStateRevisionId,
    scorePolicyVersion: SCORE_POLICY_VERSION,
    spoilerPolicyVersion: SPOILER_POLICY_VERSION,
    spoilerSelection: input.spoilerSelection,
    workId: input.workId,
  };

  return Object.freeze({
    authenticityPolicyVersion: AUTHENTICITY_POLICY_VERSION,
    blockingReasonCodes: uniqueSortedReasonCodes(blockingReasons),
    contentBriefModes: Object.freeze({
      personalExperience: personalMode,
      publicResearchAnalysis: researchMode,
    }),
    contentBriefReadiness,
    dependencyHash: authenticitySemanticHash(dependencyInput),
    dossier: input.dossier,
    evaluatedAt,
    firstPersonPermission,
    personalExperiencePermission,
    personalScorePermission,
    profileId: input.profileId,
    publicLabels: Object.freeze({
      researchAnalysis: '公开资料整理',
      researchScore: '资料分析评分',
    }),
    publicResearchAnalysisPermission,
    readingStateRevisionId: input.readingStateRevisionId,
    researchAnalysisScorePermission,
    scorePolicyVersion: SCORE_POLICY_VERSION,
    snapshotVersion: EXPRESSION_PERMISSION_VERSION,
    spoiler,
    spoilerPolicyVersion: SPOILER_POLICY_VERSION,
    stale: dossierStale,
    warningReasonCodes: uniqueSortedReasonCodes(warningReasons),
    workId: input.workId,
  });
}
