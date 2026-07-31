export const FACT_MAPPING_ERROR_CODES = [
  'FACT_MAPPING_INVALID_CONTRACT',
  'FACT_MAPPING_INVALID_LOCATOR',
  'FACT_MAPPING_INVALID_CLASSIFICATION',
  'FACT_MAPPING_PROTECTED_SIGNAL',
  'FACT_MAPPING_INVALID_CANDIDATE',
  'FACT_MAPPING_INCOMPATIBLE',
  'FACT_MAPPING_NOT_FOUND',
  'FACT_MAPPING_NOT_READY',
  'FACT_MAPPING_STALE_REVISION',
  'FACT_MAPPING_CONFLICT',
  'FACT_MAPPING_CONFIRMATION_INVALID',
  'FACT_MAPPING_CONFIRMATION_EXPIRED',
  'FACT_MAPPING_MODEL_BLOCKED',
] as const;

export type FactMappingErrorCode = (typeof FACT_MAPPING_ERROR_CODES)[number];

export class FactMappingError extends Error {
  public readonly code: FactMappingErrorCode;
  public readonly retryable: boolean;

  public constructor(code: FactMappingErrorCode, message: string = code, retryable = false) {
    super(message);
    this.name = 'FactMappingError';
    this.code = code;
    this.retryable = retryable;
  }
}
