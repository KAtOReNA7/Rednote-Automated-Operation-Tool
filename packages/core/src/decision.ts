import { hasFailedQualityCheck, type QualityCheckResult } from './quality.js';
import { hasRequiredSpoilerWarnings, type SpoilerWarnings } from './spoiler.js';
import { ContentStatus } from './statuses.js';
import type { ApprovalTier, SpoilerLevel } from './statuses.js';

export interface AiParticipationMetadata {
  readonly generatedFraction: number;
  readonly modelRunCount: number;
}

export interface AssetSourceMetadata {
  readonly origin: string;
  readonly sourceId: string | null;
}

export interface ContentDecisionInput {
  readonly aiParticipation: AiParticipationMetadata;
  readonly approvalTier: ApprovalTier;
  readonly assetSource: AssetSourceMetadata;
  readonly baseScore: number;
  readonly plannedPublishAt: string | null;
  readonly qualityChecks: readonly QualityCheckResult[];
  readonly spoilerLevel: SpoilerLevel;
  readonly spoilerWarnings: SpoilerWarnings;
  readonly status: ContentStatus;
}

export interface ContentDecision {
  readonly approvalTier: ApprovalTier;
  readonly exportEligible: boolean;
  readonly plannedPublishAt: string | null;
  readonly score: number;
  readonly status: ContentStatus;
}

export function evaluateContentDecision(input: ContentDecisionInput): ContentDecision {
  if (!Number.isFinite(input.baseScore)) {
    throw new TypeError('baseScore must be finite.');
  }

  const exportEligible =
    input.status === ContentStatus.EXPORT_READY &&
    !hasFailedQualityCheck(input.qualityChecks) &&
    hasRequiredSpoilerWarnings(input.spoilerLevel, input.spoilerWarnings);

  return {
    approvalTier: input.approvalTier,
    exportEligible,
    plannedPublishAt: input.plannedPublishAt,
    score: input.baseScore,
    status: input.status,
  };
}
