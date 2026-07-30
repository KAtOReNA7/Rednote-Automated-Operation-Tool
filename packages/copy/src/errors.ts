export const COPY_ERROR_CODES = [
  'COPY_INVALID_CONTRACT',
  'COPY_INVALID_LINEAGE',
  'COPY_INVALID_PROFILE',
  'COPY_INVALID_REWRITE_SCOPE',
  'COPY_LOCKED_FIELD',
  'COPY_PERMISSION_DENIED',
  'COPY_STALE_REVISION',
  'COPY_CONFIRMATION_EXPIRED',
  'COPY_CONFIRMATION_INVALID',
  'COPY_GENERATION_BLOCKED',
  'COPY_CONFLICT',
  'COPY_NOT_FOUND',
] as const;

export type CopyErrorCode = (typeof COPY_ERROR_CODES)[number];

export class CopyError extends Error {
  public readonly code: CopyErrorCode;
  public readonly retryable: boolean;

  public constructor(code: CopyErrorCode, message: string = code, retryable = false) {
    super(message);
    this.name = 'CopyError';
    this.code = code;
    this.retryable = retryable;
  }
}
