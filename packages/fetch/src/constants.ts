export const CONTROLLED_FETCH_CONTRACT_VERSION = 'controlled-fetch-v1' as const;
export const FETCH_PLAN_CONTRACT_VERSION = 'fetch-plan-v1' as const;
export const FETCH_PROFILE_CONTRACT_VERSION = 'fetch-profile-v1' as const;
export const FETCH_ROBOTS_POLICY_VERSION = 'robots-rfc9309-subset-v1' as const;
export const FETCH_REDIRECT_POLICY_VERSION = 'fetch-redirect-v1' as const;
export const FETCH_DNS_POLICY_VERSION = 'fetch-dns-public-only-v1' as const;
export const FETCH_MIME_POLICY_VERSION = 'fetch-mime-v1' as const;
export const FETCH_CHARSET_POLICY_VERSION = 'fetch-charset-v1' as const;
export const FETCH_PRIVACY_POLICY_VERSION = 'fetch-privacy-v1' as const;
export const FETCH_SANITIZER_VERSION = 'fetch-sanitizer-v1' as const;
export const FETCH_EXTRACTOR_VERSION = 'fetch-extractor-v1' as const;
export const FETCH_USER_AGENT = 'RednoteResearchFetcher/1.0 (+local-user-controlled)' as const;
export const FETCH_JOB_TYPE = 'FETCH_PUBLIC_PAGE_V1' as const;

export const FETCH_SELECTION_KINDS = Object.freeze([
  'USER_SELECTED',
  'RESEARCH_PLAN_SELECTED',
  'FIXTURE_SELECTED',
] as const);
export type FetchSelectionKind = (typeof FETCH_SELECTION_KINDS)[number];

export const FETCH_RUN_STATUSES = Object.freeze([
  'PLANNED',
  'RECOVERABLE_PRE_SEND',
  'ROBOTS_CHECKING',
  'ROBOTS_BLOCKED',
  'RATE_LIMITED_BEFORE_SEND',
  'FETCHING',
  'RECEIVED',
  'SANITIZING',
  'EXTRACTING',
  'PERSISTING',
  'SUCCEEDED',
  'REJECTED',
  'CANCELLED_BEFORE_SEND',
  'CANCELLED_AFTER_SEND',
  'FAILED_BEFORE_SEND',
  'FAILED_AFTER_SEND',
  'AMBIGUOUS',
] as const);
export type FetchRunStatus = (typeof FETCH_RUN_STATUSES)[number];

export const FETCH_TERMINAL_STATUSES = Object.freeze([
  'ROBOTS_BLOCKED',
  'RATE_LIMITED_BEFORE_SEND',
  'SUCCEEDED',
  'REJECTED',
  'CANCELLED_BEFORE_SEND',
  'CANCELLED_AFTER_SEND',
  'FAILED_BEFORE_SEND',
  'FAILED_AFTER_SEND',
  'AMBIGUOUS',
] as const);
export type FetchTerminalStatus = (typeof FETCH_TERMINAL_STATUSES)[number];

export const FETCH_SEND_STATES = Object.freeze([
  'NOT_SENT',
  'ROBOTS_SENT',
  'PAGE_SENT',
  'UNKNOWN',
] as const);
export type FetchSendState = (typeof FETCH_SEND_STATES)[number];

export const FETCH_EVIDENCE_ELIGIBILITY = 'FETCHED_NOT_EVIDENCE' as const;
export const FETCH_TRUTH_STATUS = 'UNVERIFIED' as const;
export const FETCH_FACT_STATUS = 'NOT_A_FACT' as const;

export const FETCH_MIME_TYPES = Object.freeze([
  'text/html',
  'application/xhtml+xml',
  'text/plain',
] as const);
export type FetchMimeType = (typeof FETCH_MIME_TYPES)[number];

export const FETCH_CHARSETS = Object.freeze([
  'utf-8',
  'gb18030',
  'big5',
  'shift_jis',
  'euc-jp',
  'iso-2022-jp',
] as const);
export type FetchCharset = (typeof FETCH_CHARSETS)[number];

export const FETCH_ROBOTS_RESULTS = Object.freeze(['ALLOWED', 'DISALLOWED', 'UNKNOWN'] as const);
export type FetchRobotsResult = (typeof FETCH_ROBOTS_RESULTS)[number];

export const FETCH_LIMITS = Object.freeze({
  contractBytes: 128 * 1024,
  decodedBytes: 4 * 1024 * 1024,
  domDepth: 64,
  domNodes: 50_000,
  headerBytes: 32 * 1024,
  headerCount: 100,
  identifierCharacters: 128,
  maxExternalRequests: 6,
  rawBytes: 2 * 1024 * 1024,
  redirectCount: 3,
  robotsBytes: 256 * 1024,
  sanitizedBytes: 2 * 1024 * 1024,
  stableErrorCharacters: 96,
  textBytes: 2 * 1024 * 1024,
  urlCharacters: 4_096,
} as const);
