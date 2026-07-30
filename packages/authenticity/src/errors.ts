export type AuthenticityErrorCode =
  | 'AUTHENTICITY_ASSERTION_NOT_FOUND'
  | 'AUTHENTICITY_CAPACITY_EXCEEDED'
  | 'AUTHENTICITY_CONFIRMATION_INVALID'
  | 'AUTHENTICITY_CONFLICT'
  | 'AUTHENTICITY_INVALID_CONTRACT'
  | 'AUTHENTICITY_INVALID_REQUEST'
  | 'AUTHENTICITY_POLICY_BLOCKED'
  | 'AUTHENTICITY_PROFILE_NOT_FOUND'
  | 'AUTHENTICITY_READING_STATE_NOT_FOUND'
  | 'AUTHENTICITY_STALE_REVISION'
  | 'AUTHENTICITY_SUBJECT_NOT_FOUND';

export class AuthenticityError extends Error {
  public readonly code: AuthenticityErrorCode;
  public readonly retryable: boolean;
  public readonly safeDetails: Readonly<Record<string, boolean | number | string>>;

  public constructor(
    code: AuthenticityErrorCode,
    options: {
      readonly retryable?: boolean;
      readonly safeDetails?: Readonly<Record<string, boolean | number | string>>;
    } = {},
  ) {
    super(code);
    this.name = 'AuthenticityError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.safeDetails = Object.freeze({ ...(options.safeDetails ?? {}) });
  }
}
