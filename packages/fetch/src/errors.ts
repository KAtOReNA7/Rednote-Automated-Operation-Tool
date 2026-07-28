import type { FetchSendState } from './constants.js';

export const FETCH_ERROR_CODES = Object.freeze([
  'FETCH_INVALID_REQUEST',
  'FETCH_CANDIDATE_NOT_FOUND',
  'FETCH_CANDIDATE_BINDING_MISMATCH',
  'FETCH_PLAN_STALE',
  'FETCH_EXECUTION_CONFLICT',
  'FETCH_URL_INVALID',
  'FETCH_HOST_DISALLOWED',
  'FETCH_DNS_FAILED',
  'FETCH_DNS_NON_PUBLIC',
  'FETCH_DNS_REBINDING',
  'FETCH_REMOTE_ADDRESS_MISMATCH',
  'FETCH_TLS_FAILED',
  'FETCH_REDIRECT_INVALID',
  'FETCH_REDIRECT_CROSS_HOST',
  'FETCH_REDIRECT_LIMIT',
  'FETCH_HTTPS_DOWNGRADE',
  'FETCH_ROBOTS_DISALLOWED',
  'FETCH_ROBOTS_UNKNOWN',
  'FETCH_RATE_LIMITED',
  'FETCH_ACCESS_CONTROLLED',
  'FETCH_CHALLENGE_DETECTED',
  'FETCH_HEADERS_TOO_LARGE',
  'FETCH_RESPONSE_TOO_LARGE',
  'FETCH_COMPRESSION_LIMIT',
  'FETCH_MIME_MISSING',
  'FETCH_MIME_UNSUPPORTED',
  'FETCH_MIME_MISMATCH',
  'FETCH_CHARSET_UNSUPPORTED',
  'FETCH_DECODE_FAILED',
  'FETCH_HTML_LIMIT',
  'FETCH_SANITIZE_FAILED',
  'FETCH_EXTRACTION_EMPTY',
  'FETCH_PRIVACY_REVIEW_REQUIRED',
  'FETCH_STORAGE_FAILED',
  'FETCH_CANCELLED_BEFORE_SEND',
  'FETCH_CANCELLED_AFTER_SEND',
  'FETCH_TIMEOUT_BEFORE_SEND',
  'FETCH_TIMEOUT_AFTER_SEND',
  'FETCH_FAILED_BEFORE_SEND',
  'FETCH_FAILED_AFTER_SEND',
  'FETCH_AMBIGUOUS',
  'FETCH_INTERNAL',
] as const);
export type FetchErrorCode = (typeof FETCH_ERROR_CODES)[number];

const RETRYABLE = new Set<FetchErrorCode>([
  'FETCH_DNS_FAILED',
  'FETCH_RATE_LIMITED',
  'FETCH_TIMEOUT_BEFORE_SEND',
  'FETCH_FAILED_BEFORE_SEND',
]);

export class FetchError extends Error {
  public readonly code: FetchErrorCode;
  public readonly retryable: boolean;
  public readonly safeDetails: Readonly<Record<string, boolean | number | string>>;
  public readonly sendState: FetchSendState;

  public constructor(
    code: FetchErrorCode,
    options: {
      readonly cause?: unknown;
      readonly retryable?: boolean;
      readonly safeDetails?: Readonly<Record<string, boolean | number | string>>;
      readonly sendState?: FetchSendState;
    } = {},
  ) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'FetchError';
    this.code = code;
    this.retryable = options.retryable ?? RETRYABLE.has(code);
    this.safeDetails = Object.freeze({ ...(options.safeDetails ?? {}) });
    this.sendState = options.sendState ?? 'NOT_SENT';
  }
}

export function isFetchError(value: unknown): value is FetchError {
  return value instanceof FetchError;
}
