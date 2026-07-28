export const SEARCH_PROVIDER_CONTRACT_VERSION = 'search-provider-v1' as const;
export const SEARCH_FIXTURE_CONTRACT_VERSION = 'search-fixture-v1' as const;
export const SEARCH_PLAN_CONTRACT_VERSION = 'search-plan-v1' as const;
export const SEARCH_URL_NORMALIZATION_VERSION = 'search-url-v1' as const;
export const SEARCH_JOB_TYPE = 'SEARCH_EXECUTE_V1' as const;

export const SEARCH_PROVIDER_KINDS = Object.freeze([
  'MODEL_WEB_SEARCH',
  'SEARCH_API',
  'CURATED_SOURCE',
  'BROWSER_CLIP',
  'MANUAL_URL',
] as const);
export type SearchProviderKind = (typeof SEARCH_PROVIDER_KINDS)[number];

export const SEARCH_PROVIDER_MODES = Object.freeze([
  'ACTIVE_REMOTE',
  'PASSIVE_LOCAL',
  'FIXTURE_ONLY',
] as const);
export type SearchProviderMode = (typeof SEARCH_PROVIDER_MODES)[number];

export const SEARCH_PROVIDER_READINESS = Object.freeze([
  'READY',
  'DISABLED',
  'NOT_CONFIGURED',
  'CAPABILITY_UNKNOWN',
  'CAPABILITY_UNSUPPORTED',
  'CAPABILITY_STALE',
  'RATE_POLICY_REQUIRED',
  'BUDGET_POLICY_REQUIRED',
  'CODEC_UNAVAILABLE',
  'PENDING_LATER_ISSUE',
  'ERROR',
] as const);
export type SearchProviderReadiness = (typeof SEARCH_PROVIDER_READINESS)[number];

export const SEARCH_OVERALL_READINESS = Object.freeze([
  'ACTIVE_SEARCH_READY',
  'PASSIVE_ONLY',
  'NOT_READY',
  'DEGRADED',
] as const);
export type SearchOverallReadiness = (typeof SEARCH_OVERALL_READINESS)[number];

export const SEARCH_INTENTS = Object.freeze([
  'BOOK_DISCOVERY',
  'BIBLIOGRAPHIC_LOOKUP',
  'AUTHOR_RESEARCH',
  'AWARD_RESEARCH',
  'PUBLISHING_NEWS',
  'REVIEW_LANDSCAPE',
  'CULTURAL_CONTEXT',
  'USER_PROVIDED_URL',
  'USER_PROVIDED_CLIP',
] as const);
export type SearchIntent = (typeof SEARCH_INTENTS)[number];

export const SEARCH_LIVE_ACCESS = Object.freeze(['LIVE', 'CACHED_ONLY', 'UNSPECIFIED'] as const);
export type SearchLiveAccess = (typeof SEARCH_LIVE_ACCESS)[number];

export const SEARCH_BATCH_STATUSES = Object.freeze([
  'SUCCEEDED',
  'PARTIAL',
  'EMPTY',
  'RATE_LIMITED_BEFORE_SEND',
  'BUDGET_BLOCKED',
  'CAPABILITY_BLOCKED',
  'CANCELLED_BEFORE_SEND',
  'CANCELLED_AFTER_SEND',
  'FAILED_BEFORE_SEND',
  'FAILED_AFTER_SEND',
  'AMBIGUOUS',
] as const);
export type SearchBatchStatus = (typeof SEARCH_BATCH_STATUSES)[number];

export const SEARCH_OUTCOME_CERTAINTIES = Object.freeze([
  'NOT_SENT',
  'REJECTED_BEFORE_EXECUTION',
  'MAY_HAVE_EXECUTED',
  'COMPLETED_INVALID_OUTPUT',
] as const);
export type SearchOutcomeCertainty = (typeof SEARCH_OUTCOME_CERTAINTIES)[number];

export const SEARCH_SOURCE_METADATA_KINDS = Object.freeze([
  'WEB_SEARCH_SOURCE',
  'URL_CITATION',
  'SEARCH_API_RESULT',
  'CURATED_ENTRY',
  'BROWSER_CLIP_INPUT',
  'MANUAL_URL_INPUT',
] as const);
export type SearchSourceMetadataKind = (typeof SEARCH_SOURCE_METADATA_KINDS)[number];

export const SEARCH_PREVIEW_KINDS = Object.freeze([
  'NONE',
  'UPSTREAM_SNIPPET',
  'USER_NOTE',
] as const);
export type SearchPreviewKind = (typeof SEARCH_PREVIEW_KINDS)[number];

export const SEARCH_CITATION_STATES = Object.freeze([
  'NOT_APPLICABLE',
  'CONSULTED_ONLY',
  'CITED',
  'UNKNOWN',
] as const);
export type SearchCitationState = (typeof SEARCH_CITATION_STATES)[number];

export const SEARCH_FEATURES = Object.freeze([
  'query',
  'manualUrl',
  'allowedDomains',
  'blockedDomains',
  'publishedDateRange',
  'localeHints',
  'countryHint',
  'liveAccess',
  'cursor',
  'structuredSources',
  'hardDomainFilter',
] as const);
export type SearchFeature = (typeof SEARCH_FEATURES)[number];

export const SEARCH_LIMITS = Object.freeze({
  candidateWarnings: 16,
  cursorBytes: 2 * 1024,
  domainCount: 100,
  identifierCharacters: 128,
  localeCount: 4,
  maxCandidates: 20,
  maxDepth: 12,
  noteCharacters: 2_000,
  previewCharacters: 2_000,
  queryCharacters: 512,
  requestBytes: 128 * 1024,
  responseBytes: 2 * 1024 * 1024,
  titleCharacters: 512,
  urlCharacters: 4_096,
  warningCharacters: 256,
} as const);

export const SEARCH_EVIDENCE_ELIGIBILITY = 'LEAD_ONLY' as const;
export const SEARCH_FETCH_STATE = 'NOT_FETCHED' as const;
export const SEARCH_TRUTH_STATUS = 'UNVERIFIED' as const;
export const SEARCH_FACT_STATUS = 'NOT_A_FACT' as const;
