export const BRIEF_ERROR_CODES = [
  'BRIEF_CONFIRMATION_EXPIRED',
  'BRIEF_CONFIRMATION_INVALID',
  'BRIEF_CONFLICT',
  'BRIEF_INVALID_CONTRACT',
  'BRIEF_INVALID_EVIDENCE',
  'BRIEF_INVALID_EXPERIMENT',
  'BRIEF_INVALID_GENERATION',
  'BRIEF_LOCKED_FIELD',
  'BRIEF_NOT_FOUND',
  'BRIEF_NOT_READY',
  'BRIEF_STALE_REVISION',
] as const;
export type BriefErrorCode = (typeof BRIEF_ERROR_CODES)[number];

export class BriefError extends Error {
  public readonly code: BriefErrorCode;
  public readonly retryable: boolean;

  public constructor(code: BriefErrorCode, retryable = false) {
    super(code);
    this.name = 'BriefError';
    this.code = code;
    this.retryable = retryable;
  }
}
