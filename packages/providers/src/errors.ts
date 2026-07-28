export const PROVIDER_ERROR_CODES = Object.freeze([
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_MODEL_NOT_CONFIGURED',
  'PROVIDER_CAPABILITY_UNKNOWN',
  'PROVIDER_CAPABILITY_UNSUPPORTED',
  'PROVIDER_CREDENTIAL_UNAVAILABLE',
  'PROVIDER_INVALID_REQUEST',
  'PROVIDER_REQUEST_TOO_LARGE',
  'PROVIDER_TIMEOUT',
  'PROVIDER_ABORTED',
  'PROVIDER_NETWORK_UNREACHABLE',
  'PROVIDER_TLS_ERROR',
  'PROVIDER_RATE_LIMITED',
  'PROVIDER_UPSTREAM_4XX',
  'PROVIDER_UPSTREAM_5XX',
  'PROVIDER_INVALID_CONTENT_TYPE',
  'PROVIDER_RESPONSE_TOO_LARGE',
  'PROVIDER_INVALID_JSON',
  'PROVIDER_SCHEMA_VALIDATION_FAILED',
  'PROVIDER_INVALID_USAGE',
  'PROVIDER_REFUSAL',
  'PROVIDER_UNSUPPORTED_STRUCTURED_OUTPUT',
  'PROVIDER_UNSUPPORTED_OUTPUT_VARIANT',
  'PROVIDER_PROTOCOL_ERROR',
  'PROVIDER_STALE_CONFIGURATION',
  'PROVIDER_AMBIGUOUS_OUTCOME',
  'PROVIDER_INTERNAL_ERROR',
  'PROVIDER_MOCK_SCRIPT_EXHAUSTED',
] as const);
export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

export const RETRY_DISPOSITIONS = Object.freeze([
  'DO_NOT_RETRY',
  'RETRY_AUTOMATIC_SAFE',
  'RETRY_QUEUE',
  'RETRY_MANUAL',
] as const);
export type RetryDisposition = (typeof RETRY_DISPOSITIONS)[number];

export const OUTCOME_CERTAINTIES = Object.freeze([
  'NOT_SENT',
  'REJECTED_BEFORE_EXECUTION',
  'MAY_HAVE_EXECUTED',
  'COMPLETED_INVALID_OUTPUT',
] as const);
export type OutcomeCertainty = (typeof OUTCOME_CERTAINTIES)[number];

export const PROVIDER_CAUSE_CATEGORIES = Object.freeze([
  'ABORT',
  'CONFIGURATION',
  'CONTENT_TYPE',
  'CREDENTIAL',
  'NETWORK',
  'PROTOCOL',
  'RATE_LIMIT',
  'SCHEMA',
  'TIMEOUT',
  'TLS',
  'UPSTREAM',
  'VALIDATION',
  'UNKNOWN',
] as const);
export type ProviderCauseCategory = (typeof PROVIDER_CAUSE_CATEGORIES)[number];

export type SafeErrorDetail = boolean | null | number | string | readonly (number | string)[];

const ERROR_MESSAGES: Readonly<Record<ProviderErrorCode, string>> = Object.freeze({
  PROVIDER_ABORTED: 'Provider request was aborted.',
  PROVIDER_AMBIGUOUS_OUTCOME: 'Provider request outcome is ambiguous.',
  PROVIDER_CAPABILITY_UNKNOWN: 'Provider capability has not been established.',
  PROVIDER_CAPABILITY_UNSUPPORTED: 'Provider capability is unsupported.',
  PROVIDER_CREDENTIAL_UNAVAILABLE: 'Provider credential is unavailable.',
  PROVIDER_INTERNAL_ERROR: 'Provider operation failed internally.',
  PROVIDER_INVALID_CONTENT_TYPE: 'Provider returned an unsupported content type.',
  PROVIDER_INVALID_JSON: 'Provider returned invalid JSON.',
  PROVIDER_INVALID_REQUEST: 'Provider request is invalid.',
  PROVIDER_INVALID_USAGE: 'Provider returned invalid usage metadata.',
  PROVIDER_MOCK_SCRIPT_EXHAUSTED: 'Mock provider script is exhausted.',
  PROVIDER_MODEL_NOT_CONFIGURED: 'Provider model is not configured.',
  PROVIDER_NETWORK_UNREACHABLE: 'Provider network is unreachable.',
  PROVIDER_NOT_CONFIGURED: 'Provider is not configured.',
  PROVIDER_PROTOCOL_ERROR: 'Provider response violates the selected protocol.',
  PROVIDER_RATE_LIMITED: 'Provider rate limit was reached.',
  PROVIDER_REFUSAL: 'Provider refused the request.',
  PROVIDER_REQUEST_TOO_LARGE: 'Provider request exceeds the configured limit.',
  PROVIDER_RESPONSE_TOO_LARGE: 'Provider response exceeds the configured limit.',
  PROVIDER_SCHEMA_VALIDATION_FAILED: 'Provider output failed runtime schema validation.',
  PROVIDER_STALE_CONFIGURATION: 'Provider configuration is stale.',
  PROVIDER_TIMEOUT: 'Provider request timed out.',
  PROVIDER_TLS_ERROR: 'Provider TLS connection failed.',
  PROVIDER_UNSUPPORTED_OUTPUT_VARIANT: 'Provider returned an unsupported output variant.',
  PROVIDER_UNSUPPORTED_STRUCTURED_OUTPUT: 'Selected protocol cannot encode structured output.',
  PROVIDER_UPSTREAM_4XX: 'Provider rejected the request.',
  PROVIDER_UPSTREAM_5XX: 'Provider failed while processing the request.',
});

export interface ProviderErrorOptions {
  readonly causeCategory?: ProviderCauseCategory;
  readonly details?: Readonly<Record<string, SafeErrorDetail>>;
  readonly modelId?: string | null;
  readonly operation: string;
  readonly outcomeCertainty: OutcomeCertainty;
  readonly providerId: string;
  readonly requestId: string;
  readonly retryAfterMs?: number | null;
  readonly retryDisposition: RetryDisposition;
}

function sanitizeDetails(
  details: Readonly<Record<string, SafeErrorDetail>> | undefined,
): Readonly<Record<string, SafeErrorDetail>> {
  if (details === undefined) {
    return Object.freeze({});
  }
  const entries = Object.entries(details).slice(0, 12);
  return Object.freeze(
    Object.fromEntries(
      entries.map(([key, value]) => {
        const safeKey = /^[a-z][a-zA-Z0-9]{0,63}$/u.test(key) ? key : 'detail';
        if (typeof value === 'string') {
          return [safeKey, value.slice(0, 160)];
        }
        if (Array.isArray(value)) {
          return [safeKey, Object.freeze(value.slice(0, 12))];
        }
        return [safeKey, value];
      }),
    ),
  );
}

export class ProviderError extends Error {
  public readonly causeCategory: ProviderCauseCategory;
  public readonly code: ProviderErrorCode;
  public readonly details: Readonly<Record<string, SafeErrorDetail>>;
  public readonly modelId: string | null;
  public readonly operation: string;
  public readonly outcomeCertainty: OutcomeCertainty;
  public readonly providerId: string;
  public readonly requestId: string;
  public readonly retryAfterMs: number | null;
  public readonly retryDisposition: RetryDisposition;

  public constructor(code: ProviderErrorCode, options: ProviderErrorOptions) {
    super(ERROR_MESSAGES[code]);
    this.name = 'ProviderError';
    this.code = code;
    this.causeCategory = options.causeCategory ?? 'UNKNOWN';
    this.details = sanitizeDetails(options.details);
    this.modelId = options.modelId ?? null;
    this.operation = options.operation.slice(0, 64);
    this.outcomeCertainty = options.outcomeCertainty;
    this.providerId = options.providerId.slice(0, 128);
    this.requestId = options.requestId.slice(0, 128);
    this.retryAfterMs =
      options.retryAfterMs === undefined || options.retryAfterMs === null
        ? null
        : Math.max(0, Math.min(60_000, Math.trunc(options.retryAfterMs)));
    this.retryDisposition = options.retryDisposition;
    delete this.stack;
  }
}

export function isProviderError(value: unknown): value is ProviderError {
  return value instanceof ProviderError;
}
