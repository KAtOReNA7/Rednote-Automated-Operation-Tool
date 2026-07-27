export enum QualityCheckType {
  FACT_MAPPING = 'FACT_MAPPING',
  INTERNAL_CONSISTENCY = 'INTERNAL_CONSISTENCY',
  READING_AUTHENTICITY = 'READING_AUTHENTICITY',
  SPOILER = 'SPOILER',
  DUPLICATION = 'DUPLICATION',
  TITLE_BODY_CONSISTENCY = 'TITLE_BODY_CONSISTENCY',
  IMAGE_TECHNICAL = 'IMAGE_TECHNICAL',
  STRUCTURED_OUTPUT = 'STRUCTURED_OUTPUT',
}

export const QUALITY_CHECK_TYPES = [
  QualityCheckType.FACT_MAPPING,
  QualityCheckType.INTERNAL_CONSISTENCY,
  QualityCheckType.READING_AUTHENTICITY,
  QualityCheckType.SPOILER,
  QualityCheckType.DUPLICATION,
  QualityCheckType.TITLE_BODY_CONSISTENCY,
  QualityCheckType.IMAGE_TECHNICAL,
  QualityCheckType.STRUCTURED_OUTPUT,
] as const;

export enum QualityCheckOutcome {
  PASS = 'PASS',
  FAIL = 'FAIL',
}

export interface QualityCheckResult {
  readonly outcome: QualityCheckOutcome;
  readonly type: QualityCheckType;
}

export function hasFailedQualityCheck(results: readonly QualityCheckResult[]): boolean {
  return results.some((result) => result.outcome === QualityCheckOutcome.FAIL);
}
