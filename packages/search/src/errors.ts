export const SEARCH_ERROR_CODES = Object.freeze([
  'SEARCH_INVALID_REQUEST',
  'SEARCH_QUERY_TOO_LARGE',
  'SEARCH_URL_INVALID',
  'SEARCH_DOMAIN_INVALID',
  'SEARCH_FEATURE_UNSUPPORTED',
  'SEARCH_PROVIDER_NOT_FOUND',
  'SEARCH_PROVIDER_NOT_READY',
  'SEARCH_CAPABILITY_UNKNOWN',
  'SEARCH_CAPABILITY_UNSUPPORTED',
  'SEARCH_CAPABILITY_STALE',
  'SEARCH_RATE_POLICY_REQUIRED',
  'SEARCH_RATE_LIMITED',
  'SEARCH_BUDGET_BLOCKED',
  'SEARCH_CODEC_UNAVAILABLE',
  'SEARCH_TIMEOUT_BEFORE_SEND',
  'SEARCH_TIMEOUT_AFTER_SEND',
  'SEARCH_RESPONSE_TOO_LARGE',
  'SEARCH_RESPONSE_INVALID',
  'SEARCH_RESULT_INVALID',
  'SEARCH_CANCELLED_BEFORE_SEND',
  'SEARCH_CANCELLED_AFTER_SEND',
  'SEARCH_AMBIGUOUS',
  'SEARCH_EXECUTION_CONFLICT',
  'SEARCH_PLAN_STALE',
  'SEARCH_INTERNAL',
] as const);

export type SearchErrorCode = (typeof SEARCH_ERROR_CODES)[number];
export type SearchSendState = 'NOT_SENT' | 'SENT' | 'UNKNOWN';

export interface SearchErrorOptions {
  readonly cause?: unknown;
  readonly retryable?: boolean;
  readonly safeDetails?: Readonly<Record<string, boolean | number | string>>;
  readonly sendState?: SearchSendState;
}

export class SearchError extends Error {
  public readonly code: SearchErrorCode;
  public readonly retryable: boolean;
  public readonly safeDetails: Readonly<Record<string, boolean | number | string>>;
  public readonly sendState: SearchSendState;

  public constructor(code: SearchErrorCode, options: SearchErrorOptions = {}) {
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'SearchError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.safeDetails = Object.freeze({ ...options.safeDetails });
    this.sendState = options.sendState ?? 'NOT_SENT';
  }
}

export function isSearchError(error: unknown): error is SearchError {
  return error instanceof SearchError;
}
