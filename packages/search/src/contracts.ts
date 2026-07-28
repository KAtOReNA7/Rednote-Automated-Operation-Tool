import {
  SEARCH_BATCH_STATUSES,
  SEARCH_CITATION_STATES,
  SEARCH_EVIDENCE_ELIGIBILITY,
  SEARCH_FACT_STATUS,
  SEARCH_FEATURES,
  SEARCH_FETCH_STATE,
  SEARCH_INTENTS,
  SEARCH_LIMITS,
  SEARCH_LIVE_ACCESS,
  SEARCH_OUTCOME_CERTAINTIES,
  type SEARCH_PLAN_CONTRACT_VERSION,
  SEARCH_PREVIEW_KINDS,
  SEARCH_PROVIDER_CONTRACT_VERSION,
  SEARCH_PROVIDER_KINDS,
  SEARCH_PROVIDER_MODES,
  SEARCH_PROVIDER_READINESS,
  SEARCH_SOURCE_METADATA_KINDS,
  SEARCH_TRUTH_STATUS,
  type SearchBatchStatus,
  type SearchCitationState,
  type SearchFeature,
  type SearchIntent,
  type SearchLiveAccess,
  type SearchOutcomeCertainty,
  type SearchPreviewKind,
  type SearchProviderKind,
  type SearchProviderMode,
  type SearchProviderReadiness,
  type SearchSourceMetadataKind,
} from './constants.js';
import { SearchError } from './errors.js';
import { canonicalSearchJson, searchSemanticHash } from './identity.js';
import { canonicalizeSearchUrl, normalizeSearchDomain } from './url.js';

export type SearchFeatureSupportV1 = Readonly<Record<SearchFeature, boolean>>;

export interface SearchFeatureApplicationV1 {
  readonly feature: SearchFeature;
  readonly hardFilterApplied: boolean;
  readonly requested: boolean;
  readonly supported: boolean;
}

export interface SearchRatePolicyV1 {
  readonly contractVersion: 'search-rate-policy-v1';
  readonly maxConcurrent: number;
  readonly maxRequestsPerWindow: number;
  readonly maxResponseBytes: number;
  readonly maxResults: number;
  readonly minIntervalMs: number;
  readonly revision: number;
  readonly timeoutMs: number;
  readonly windowMs: number;
}

export type SearchReadinessFacet =
  | 'NOT_APPLICABLE'
  | 'READY'
  | 'REQUIRED'
  | 'SUPPORTED'
  | 'UNKNOWN'
  | 'UNSUPPORTED'
  | 'STALE'
  | 'UNAVAILABLE'
  | 'PENDING';

export interface SearchProviderDescriptorV1 {
  readonly budgetState: SearchReadinessFacet;
  readonly capabilityState: SearchReadinessFacet;
  readonly codecState: SearchReadinessFacet;
  readonly contractVersion: typeof SEARCH_PROVIDER_CONTRACT_VERSION;
  readonly credentialState: SearchReadinessFacet;
  readonly displayName: string;
  readonly features: SearchFeatureSupportV1;
  readonly kind: SearchProviderKind;
  readonly maxResponseBytes: number;
  readonly maxResults: number;
  readonly mode: SearchProviderMode;
  readonly providerInstanceId: string;
  readonly rateState: SearchReadinessFacet;
  readonly readiness: SearchProviderReadiness;
  readonly supportedIntents: readonly SearchIntent[];
}

export interface ManualUrlInputV1 {
  readonly kind: 'MANUAL_URL';
  readonly note: string | null;
  readonly title: string | null;
  readonly url: string;
}

export interface BrowserClipInputV1 {
  readonly capturedAt: string;
  readonly kind: 'BROWSER_CLIP';
  readonly note: string | null;
  readonly title: string | null;
  readonly url: string;
}

export type SearchLocalInputV1 = BrowserClipInputV1 | ManualUrlInputV1;

export interface SearchRequestV1 {
  readonly allowedDomains: readonly string[];
  readonly blockedDomains: readonly string[];
  readonly contractVersion: typeof SEARCH_PROVIDER_CONTRACT_VERSION;
  readonly countryHint: string | null;
  readonly cursor: string | null;
  readonly executionId: string;
  readonly intent: SearchIntent;
  readonly jobId: string | null;
  readonly liveAccess: SearchLiveAccess;
  readonly localeHints: readonly string[];
  readonly localInput: SearchLocalInputV1 | null;
  readonly maxResults: number;
  readonly providerInstanceId: string;
  readonly publishedAfter: string | null;
  readonly publishedBefore: string | null;
  readonly query: string;
  readonly ratePolicyRef: string | null;
}

export interface SearchPreviewV1 {
  readonly contractVersion: typeof SEARCH_PROVIDER_CONTRACT_VERSION;
  readonly estimatedExternalRequests: 0 | 1;
  readonly estimatedInternalSearchCalls: number;
  readonly featureApplications: readonly SearchFeatureApplicationV1[];
  readonly maxResults: number;
  readonly providerInstanceId: string;
  readonly readiness: SearchProviderReadiness;
  readonly requestSemanticHash: string;
  readonly warnings: readonly string[];
}

export interface SearchPlanBindingV1 {
  readonly budgetIdentity: string;
  readonly capabilityIdentity: string;
  readonly settingsRevision: number;
}

export interface SearchPlanV1 {
  readonly binding: SearchPlanBindingV1;
  readonly contractVersion: typeof SEARCH_PLAN_CONTRACT_VERSION;
  readonly estimatedExternalRequests: 0 | 1;
  readonly estimatedInternalSearchCalls: number;
  readonly expiresAt: string;
  readonly fallback: 'NONE';
  readonly featureApplications: readonly SearchFeatureApplicationV1[];
  readonly maxResults: number;
  readonly planHash: string;
  readonly planId: string;
  readonly provider: SearchProviderDescriptorV1;
  readonly ratePolicy: SearchRatePolicyV1 | null;
  readonly requestSemanticHash: string;
  readonly timeoutMs: number;
}

export interface SearchCandidateAppearanceV1 {
  readonly citationState: SearchCitationState;
  readonly languageHint: string | null;
  readonly previewKind: SearchPreviewKind;
  readonly previewText: string | null;
  readonly publishedAt: string | null;
  readonly sourceMetadataKind: SearchSourceMetadataKind;
  readonly title: string | null;
  readonly upstreamId: string | null;
  readonly upstreamRank: number | null;
  readonly url: string;
  readonly userSupplied: boolean;
  readonly wasCited: boolean | null;
  readonly wasConsulted: boolean | null;
}

export interface SearchProvenanceAppearanceV1 {
  readonly citationState: SearchCitationState;
  readonly sourceMetadataKind: SearchSourceMetadataKind;
  readonly upstreamIdHash: string | null;
  readonly upstreamRank: number | null;
  readonly wasCited: boolean | null;
  readonly wasConsulted: boolean | null;
}

export interface SearchCandidateV1 {
  readonly candidateId: string;
  readonly canonicalUrl: string;
  readonly citationState: SearchCitationState;
  readonly discoveredAt: string;
  readonly displayHost: string;
  readonly domain: string;
  readonly duplicateOfCandidateId: string | null;
  readonly evidenceEligibility: typeof SEARCH_EVIDENCE_ELIGIBILITY;
  readonly factStatus: typeof SEARCH_FACT_STATUS;
  readonly fetchState: typeof SEARCH_FETCH_STATE;
  readonly languageHint: string | null;
  readonly originKind: SearchProviderKind;
  readonly previewKind: SearchPreviewKind;
  readonly previewText: string | null;
  readonly provenanceAppearances: readonly SearchProvenanceAppearanceV1[];
  readonly providerInstanceId: string;
  readonly providerKind: SearchProviderKind;
  readonly publishedAt: string | null;
  readonly searchRunId: string;
  readonly sourceMetadataKind: SearchSourceMetadataKind;
  readonly title: string | null;
  readonly truthStatus: typeof SEARCH_TRUTH_STATUS;
  readonly upstreamIdHash: string | null;
  readonly upstreamRank: number | null;
  readonly urlHash: string;
  readonly userSupplied: boolean;
  readonly warnings: readonly string[];
  readonly wasCited: boolean | null;
  readonly wasConsulted: boolean | null;
}

export interface SearchBatchCountsV1 {
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly totalAppearances: number;
}

export interface SearchUsageV1 {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly source: 'NOT_REPORTED' | 'PROVIDER';
  readonly toolCalls: number | null;
  readonly totalTokens: number | null;
  readonly webSearchCalls: number | null;
}

export interface SearchProviderSnapshotV1 {
  readonly contractVersion: typeof SEARCH_PROVIDER_CONTRACT_VERSION;
  readonly kind: SearchProviderKind;
  readonly mode: SearchProviderMode;
  readonly providerInstanceId: string;
  readonly readiness: SearchProviderReadiness;
}

export interface SearchBatchV1 {
  readonly candidates: readonly SearchCandidateV1[];
  readonly certainty: SearchOutcomeCertainty;
  readonly contractVersion: typeof SEARCH_PROVIDER_CONTRACT_VERSION;
  readonly costState:
    | 'NOT_INCURRED'
    | 'PROVIDER_REPORTED_USD'
    | 'UNKNOWN_POSSIBLY_INCURRED'
    | 'UNPRICED_USAGE'
    | 'USER_PRICE_TABLE_ESTIMATE'
    | null;
  readonly counts: SearchBatchCountsV1;
  readonly cursor: string | null;
  readonly executionId: string;
  readonly externalRequestCount: 0 | 1;
  readonly finishedAt: string;
  readonly modelRunId: string | null;
  readonly provider: SearchProviderSnapshotV1;
  readonly requestSemanticHash: string;
  readonly searchRunId: string;
  readonly stableError: string | null;
  readonly startedAt: string;
  readonly status: SearchBatchStatus;
  readonly truncated: boolean;
  readonly usage: SearchUsageV1 | null;
  readonly warnings: readonly string[];
}

export interface SearchExecutionContextV1 {
  readonly now: () => Date;
  readonly plan: SearchPlanV1;
  readonly searchRunId: string;
  readonly signal?: AbortSignal;
}

export interface SearchProviderV1 {
  describe(): SearchProviderDescriptorV1;
  preview(request: SearchRequestV1): Promise<SearchPreviewV1>;
  execute(request: SearchRequestV1, context: SearchExecutionContextV1): Promise<SearchBatchV1>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { field: label, reason: 'UNSUPPORTED_FIELDS' },
    });
  }
}

function validIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= SEARCH_LIMITS.identifierCharacters &&
    value === value.trim() &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || code === 0x7f;
    })
  );
}

function validIso(value: unknown, nullable: boolean): value is string | null {
  if (nullable && value === null) return true;
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validBoundedString(
  value: unknown,
  maximum: number,
  options: { readonly allowEmpty?: boolean; readonly nullable?: boolean } = {},
): boolean {
  if (options.nullable === true && value === null) return true;
  return (
    typeof value === 'string' &&
    (options.allowEmpty === true || value.length > 0) &&
    value.length <= maximum &&
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code === 0 || code === 0x7f;
    })
  );
}

function validCount(value: unknown, maximum: number, nullable = false): boolean {
  return (
    (nullable && value === null) ||
    (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= maximum)
  );
}

function validateLocalInput(value: unknown): asserts value is SearchLocalInputV1 | null {
  if (value === null) return;
  if (!isPlainObject(value) || (value.kind !== 'MANUAL_URL' && value.kind !== 'BROWSER_CLIP')) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { field: 'localInput' },
    });
  }
  if (value.kind === 'MANUAL_URL') {
    exactKeys(value, ['kind', 'note', 'title', 'url'], 'localInput');
  } else {
    exactKeys(value, ['capturedAt', 'kind', 'note', 'title', 'url'], 'localInput');
    if (!validIso(value.capturedAt, false)) {
      throw new SearchError('SEARCH_INVALID_REQUEST', {
        safeDetails: { field: 'localInput.capturedAt' },
      });
    }
  }
  if (
    !validBoundedString(value.url, SEARCH_LIMITS.urlCharacters) ||
    !validBoundedString(value.title, SEARCH_LIMITS.titleCharacters, { nullable: true }) ||
    !validBoundedString(value.note, SEARCH_LIMITS.noteCharacters, { nullable: true })
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { field: 'localInput' },
    });
  }
}

export function validateSearchRequestV1(value: unknown): SearchRequestV1 {
  if (!isPlainObject(value)) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  exactKeys(
    value,
    [
      'allowedDomains',
      'blockedDomains',
      'contractVersion',
      'countryHint',
      'cursor',
      'executionId',
      'intent',
      'jobId',
      'liveAccess',
      'localeHints',
      'localInput',
      'maxResults',
      'providerInstanceId',
      'publishedAfter',
      'publishedBefore',
      'query',
      'ratePolicyRef',
    ],
    'request',
  );
  validateLocalInput(value.localInput);
  const listValid = (input: unknown, maximum: number): input is readonly string[] =>
    Array.isArray(input) &&
    input.length <= maximum &&
    input.every((item) => validBoundedString(item, 255)) &&
    new Set(input).size === input.length;
  if (
    value.contractVersion !== SEARCH_PROVIDER_CONTRACT_VERSION ||
    !validIdentifier(value.executionId) ||
    !validIdentifier(value.providerInstanceId) ||
    !SEARCH_INTENTS.includes(value.intent as SearchIntent) ||
    !SEARCH_LIVE_ACCESS.includes(value.liveAccess as SearchLiveAccess) ||
    !validBoundedString(value.query, SEARCH_LIMITS.queryCharacters, { allowEmpty: true }) ||
    !validCount(value.maxResults, SEARCH_LIMITS.maxCandidates) ||
    value.maxResults === 0 ||
    !listValid(value.localeHints, SEARCH_LIMITS.localeCount) ||
    !listValid(value.allowedDomains, SEARCH_LIMITS.domainCount) ||
    !listValid(value.blockedDomains, SEARCH_LIMITS.domainCount) ||
    !validBoundedString(value.countryHint, 8, { nullable: true }) ||
    !validBoundedString(value.cursor, SEARCH_LIMITS.cursorBytes, { nullable: true }) ||
    (typeof value.cursor === 'string' &&
      Buffer.byteLength(value.cursor, 'utf8') > SEARCH_LIMITS.cursorBytes) ||
    !validBoundedString(value.ratePolicyRef, SEARCH_LIMITS.identifierCharacters, {
      nullable: true,
    }) ||
    !validBoundedString(value.jobId, SEARCH_LIMITS.identifierCharacters, { nullable: true }) ||
    !validIso(value.publishedAfter, true) ||
    !validIso(value.publishedBefore, true) ||
    (value.localInput === null && typeof value.query === 'string' && value.query.length === 0) ||
    (value.intent === 'USER_PROVIDED_URL' && value.localInput?.kind !== 'MANUAL_URL') ||
    (value.intent === 'USER_PROVIDED_CLIP' && value.localInput?.kind !== 'BROWSER_CLIP')
  ) {
    throw new SearchError(
      typeof value.query === 'string' && value.query.length > SEARCH_LIMITS.queryCharacters
        ? 'SEARCH_QUERY_TOO_LARGE'
        : 'SEARCH_INVALID_REQUEST',
    );
  }
  if (
    value.publishedAfter !== null &&
    value.publishedBefore !== null &&
    value.publishedAfter > value.publishedBefore
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { field: 'publishedRange' },
    });
  }
  try {
    const normalizedAllowed = value.allowedDomains.map(normalizeSearchDomain);
    const normalizedBlocked = value.blockedDomains.map(normalizeSearchDomain);
    if (
      new Set(normalizedAllowed).size !== normalizedAllowed.length ||
      new Set(normalizedBlocked).size !== normalizedBlocked.length
    ) {
      throw new SearchError('SEARCH_DOMAIN_INVALID');
    }
  } catch (cause) {
    if (cause instanceof SearchError && cause.code === 'SEARCH_DOMAIN_INVALID') throw cause;
    throw new SearchError('SEARCH_DOMAIN_INVALID', { cause });
  }
  const serialized = canonicalSearchJson(value);
  if (Buffer.byteLength(serialized, 'utf8') > SEARCH_LIMITS.requestBytes) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { reason: 'REQUEST_TOO_LARGE' },
    });
  }
  return Object.freeze(value as unknown as SearchRequestV1);
}

function validateFeatureSupport(value: unknown): asserts value is SearchFeatureSupportV1 {
  if (!isPlainObject(value)) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { field: 'descriptor.features' },
    });
  }
  exactKeys(value, SEARCH_FEATURES, 'descriptor.features');
  if (Object.values(value).some((item) => typeof item !== 'boolean')) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { field: 'descriptor.features' },
    });
  }
}

const READINESS_FACETS: readonly SearchReadinessFacet[] = [
  'NOT_APPLICABLE',
  'READY',
  'REQUIRED',
  'SUPPORTED',
  'UNKNOWN',
  'UNSUPPORTED',
  'STALE',
  'UNAVAILABLE',
  'PENDING',
];

export function validateSearchProviderDescriptorV1(value: unknown): SearchProviderDescriptorV1 {
  if (!isPlainObject(value)) throw new SearchError('SEARCH_INVALID_REQUEST');
  exactKeys(
    value,
    [
      'budgetState',
      'capabilityState',
      'codecState',
      'contractVersion',
      'credentialState',
      'displayName',
      'features',
      'kind',
      'maxResponseBytes',
      'maxResults',
      'mode',
      'providerInstanceId',
      'rateState',
      'readiness',
      'supportedIntents',
    ],
    'descriptor',
  );
  validateFeatureSupport(value.features);
  if (
    value.contractVersion !== SEARCH_PROVIDER_CONTRACT_VERSION ||
    !validIdentifier(value.providerInstanceId) ||
    !validBoundedString(value.displayName, 128) ||
    !SEARCH_PROVIDER_KINDS.includes(value.kind as SearchProviderKind) ||
    !SEARCH_PROVIDER_MODES.includes(value.mode as SearchProviderMode) ||
    !SEARCH_PROVIDER_READINESS.includes(value.readiness as SearchProviderReadiness) ||
    !READINESS_FACETS.includes(value.capabilityState as SearchReadinessFacet) ||
    !READINESS_FACETS.includes(value.rateState as SearchReadinessFacet) ||
    !READINESS_FACETS.includes(value.budgetState as SearchReadinessFacet) ||
    !READINESS_FACETS.includes(value.credentialState as SearchReadinessFacet) ||
    !READINESS_FACETS.includes(value.codecState as SearchReadinessFacet) ||
    !Array.isArray(value.supportedIntents) ||
    value.supportedIntents.length === 0 ||
    value.supportedIntents.some((intent) => !SEARCH_INTENTS.includes(intent as SearchIntent)) ||
    new Set(value.supportedIntents).size !== value.supportedIntents.length ||
    !validCount(value.maxResults, SEARCH_LIMITS.maxCandidates) ||
    value.maxResults === 0 ||
    !validCount(value.maxResponseBytes, SEARCH_LIMITS.responseBytes) ||
    value.maxResponseBytes === 0
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { field: 'descriptor' },
    });
  }
  const readyFacet = (facet: SearchReadinessFacet): boolean =>
    facet === 'READY' || facet === 'SUPPORTED' || facet === 'NOT_APPLICABLE';
  if (
    (value.readiness === 'READY' &&
      ![
        value.capabilityState,
        value.rateState,
        value.budgetState,
        value.credentialState,
        value.codecState,
      ].every((facet) => readyFacet(facet as SearchReadinessFacet))) ||
    (value.readiness === 'CAPABILITY_UNKNOWN' && value.capabilityState !== 'UNKNOWN') ||
    (value.readiness === 'CAPABILITY_UNSUPPORTED' && value.capabilityState !== 'UNSUPPORTED') ||
    (value.readiness === 'CAPABILITY_STALE' && value.capabilityState !== 'STALE') ||
    (value.readiness === 'RATE_POLICY_REQUIRED' && value.rateState !== 'REQUIRED') ||
    (value.readiness === 'BUDGET_POLICY_REQUIRED' && value.budgetState !== 'REQUIRED') ||
    (value.readiness === 'CODEC_UNAVAILABLE' && value.codecState !== 'UNAVAILABLE')
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST', {
      safeDetails: { field: 'descriptor.readiness' },
    });
  }
  return Object.freeze(value as unknown as SearchProviderDescriptorV1);
}

export function validateSearchRatePolicyV1(value: unknown): SearchRatePolicyV1 {
  if (!isPlainObject(value)) throw new SearchError('SEARCH_RATE_POLICY_REQUIRED');
  exactKeys(
    value,
    [
      'contractVersion',
      'maxConcurrent',
      'maxRequestsPerWindow',
      'maxResponseBytes',
      'maxResults',
      'minIntervalMs',
      'revision',
      'timeoutMs',
      'windowMs',
    ],
    'ratePolicy',
  );
  if (
    value.contractVersion !== 'search-rate-policy-v1' ||
    !validCount(value.maxConcurrent, 32) ||
    value.maxConcurrent === 0 ||
    !validCount(value.minIntervalMs, 86_400_000) ||
    !validCount(value.maxRequestsPerWindow, 10_000) ||
    value.maxRequestsPerWindow === 0 ||
    !validCount(value.windowMs, 86_400_000) ||
    value.windowMs === 0 ||
    !validCount(value.timeoutMs, 600_000) ||
    (typeof value.timeoutMs === 'number' && value.timeoutMs < 100) ||
    !validCount(value.maxResponseBytes, SEARCH_LIMITS.responseBytes) ||
    value.maxResponseBytes === 0 ||
    !validCount(value.maxResults, SEARCH_LIMITS.maxCandidates) ||
    value.maxResults === 0 ||
    !validCount(value.revision, Number.MAX_SAFE_INTEGER) ||
    value.revision === 0
  ) {
    throw new SearchError('SEARCH_RATE_POLICY_REQUIRED');
  }
  return Object.freeze(value as unknown as SearchRatePolicyV1);
}

export function requestedSearchFeatures(request: SearchRequestV1): ReadonlySet<SearchFeature> {
  const features = new Set<SearchFeature>();
  if (request.query.length > 0) features.add('query');
  if (request.localInput?.kind === 'MANUAL_URL') features.add('manualUrl');
  if (request.allowedDomains.length > 0) features.add('allowedDomains');
  if (request.blockedDomains.length > 0) features.add('blockedDomains');
  if (request.publishedAfter !== null || request.publishedBefore !== null) {
    features.add('publishedDateRange');
  }
  if (request.localeHints.length > 0) features.add('localeHints');
  if (request.countryHint !== null) features.add('countryHint');
  if (request.liveAccess !== 'UNSPECIFIED') features.add('liveAccess');
  if (request.cursor !== null) features.add('cursor');
  return features;
}

export function buildFeatureApplications(
  descriptor: SearchProviderDescriptorV1,
  request: SearchRequestV1,
): readonly SearchFeatureApplicationV1[] {
  const requested = requestedSearchFeatures(request);
  return SEARCH_FEATURES.map((feature) =>
    Object.freeze({
      feature,
      hardFilterApplied:
        requested.has(feature) &&
        descriptor.features[feature] &&
        (feature === 'allowedDomains' || feature === 'blockedDomains')
          ? descriptor.features.hardDomainFilter
          : false,
      requested: requested.has(feature),
      supported: descriptor.features[feature],
    }),
  );
}

export function assertSupportedSearchFeatures(
  descriptor: SearchProviderDescriptorV1,
  request: SearchRequestV1,
): readonly SearchFeatureApplicationV1[] {
  if (!descriptor.supportedIntents.includes(request.intent)) {
    throw new SearchError('SEARCH_FEATURE_UNSUPPORTED', {
      safeDetails: { feature: 'intent' },
    });
  }
  const applications = buildFeatureApplications(descriptor, request);
  const unsupported = applications.find((item) => item.requested && !item.supported);
  if (unsupported !== undefined) {
    throw new SearchError('SEARCH_FEATURE_UNSUPPORTED', {
      safeDetails: { feature: unsupported.feature },
    });
  }
  for (const feature of ['allowedDomains', 'blockedDomains'] as const) {
    const application = applications.find((item) => item.feature === feature);
    if (application?.requested === true && !application.hardFilterApplied) {
      throw new SearchError('SEARCH_FEATURE_UNSUPPORTED', {
        safeDetails: { feature },
      });
    }
  }
  return applications;
}

export function validateSearchCandidateV1(value: unknown): SearchCandidateV1 {
  if (!isPlainObject(value)) throw new SearchError('SEARCH_RESULT_INVALID');
  const expected = [
    'candidateId',
    'canonicalUrl',
    'citationState',
    'discoveredAt',
    'displayHost',
    'domain',
    'duplicateOfCandidateId',
    'evidenceEligibility',
    'factStatus',
    'fetchState',
    'languageHint',
    'originKind',
    'previewKind',
    'previewText',
    'provenanceAppearances',
    'providerInstanceId',
    'providerKind',
    'publishedAt',
    'searchRunId',
    'sourceMetadataKind',
    'title',
    'truthStatus',
    'upstreamIdHash',
    'upstreamRank',
    'urlHash',
    'userSupplied',
    'warnings',
    'wasCited',
    'wasConsulted',
  ];
  try {
    exactKeys(value, expected, 'candidate');
  } catch (error) {
    throw new SearchError('SEARCH_RESULT_INVALID', { cause: error });
  }
  const nullableBoolean = (item: unknown): boolean => item === null || typeof item === 'boolean';
  let normalizedUrl;
  try {
    normalizedUrl =
      typeof value.canonicalUrl === 'string' ? canonicalizeSearchUrl(value.canonicalUrl) : null;
  } catch {
    throw new SearchError('SEARCH_RESULT_INVALID');
  }
  if (
    !validIdentifier(value.candidateId) ||
    !validIdentifier(value.searchRunId) ||
    !validIdentifier(value.providerInstanceId) ||
    !SEARCH_PROVIDER_KINDS.includes(value.providerKind as SearchProviderKind) ||
    !SEARCH_PROVIDER_KINDS.includes(value.originKind as SearchProviderKind) ||
    !validBoundedString(value.canonicalUrl, SEARCH_LIMITS.urlCharacters) ||
    normalizedUrl === null ||
    normalizedUrl.canonicalUrl !== value.canonicalUrl ||
    normalizedUrl.urlHash !== value.urlHash ||
    normalizedUrl.domain !== value.domain ||
    normalizedUrl.displayHost !== value.displayHost ||
    !/^[0-9a-f]{64}$/u.test(String(value.urlHash)) ||
    !validBoundedString(value.domain, 255) ||
    !validBoundedString(value.displayHost, 255) ||
    !validBoundedString(value.title, SEARCH_LIMITS.titleCharacters, { nullable: true }) ||
    !validBoundedString(value.previewText, SEARCH_LIMITS.previewCharacters, {
      nullable: true,
    }) ||
    (value.previewKind === 'NONE' && value.previewText !== null) ||
    (value.previewKind !== 'NONE' && value.previewText === null) ||
    !SEARCH_PREVIEW_KINDS.includes(value.previewKind as SearchPreviewKind) ||
    !SEARCH_SOURCE_METADATA_KINDS.includes(value.sourceMetadataKind as SearchSourceMetadataKind) ||
    !SEARCH_CITATION_STATES.includes(value.citationState as SearchCitationState) ||
    !nullableBoolean(value.wasConsulted) ||
    !nullableBoolean(value.wasCited) ||
    value.evidenceEligibility !== SEARCH_EVIDENCE_ELIGIBILITY ||
    value.fetchState !== SEARCH_FETCH_STATE ||
    value.truthStatus !== SEARCH_TRUTH_STATUS ||
    value.factStatus !== SEARCH_FACT_STATUS ||
    !validIso(value.discoveredAt, false) ||
    !validIso(value.publishedAt, true) ||
    !validBoundedString(value.languageHint, 32, { nullable: true }) ||
    !validCount(value.upstreamRank, 1_000_000, true) ||
    (value.upstreamIdHash !== null && !/^[0-9a-f]{64}$/u.test(String(value.upstreamIdHash))) ||
    value.duplicateOfCandidateId !== null ||
    typeof value.userSupplied !== 'boolean' ||
    !Array.isArray(value.provenanceAppearances) ||
    value.provenanceAppearances.length < 1 ||
    value.provenanceAppearances.length > 64 ||
    value.provenanceAppearances.some(
      (appearance) =>
        !isPlainObject(appearance) ||
        Object.keys(appearance).sort().join(',') !==
          'citationState,sourceMetadataKind,upstreamIdHash,upstreamRank,wasCited,wasConsulted' ||
        !SEARCH_CITATION_STATES.includes(appearance.citationState as SearchCitationState) ||
        !SEARCH_SOURCE_METADATA_KINDS.includes(
          appearance.sourceMetadataKind as SearchSourceMetadataKind,
        ) ||
        (appearance.upstreamIdHash !== null &&
          !/^[0-9a-f]{64}$/u.test(String(appearance.upstreamIdHash))) ||
        !validCount(appearance.upstreamRank, 1_000_000, true) ||
        !nullableBoolean(appearance.wasCited) ||
        !nullableBoolean(appearance.wasConsulted),
    ) ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > SEARCH_LIMITS.candidateWarnings ||
    new Set(value.warnings).size !== value.warnings.length ||
    value.warnings.some((warning) => !validBoundedString(warning, SEARCH_LIMITS.warningCharacters))
  ) {
    throw new SearchError('SEARCH_RESULT_INVALID');
  }
  return Object.freeze(value as unknown as SearchCandidateV1);
}

export function validateSearchBatchV1(value: unknown): SearchBatchV1 {
  if (!isPlainObject(value)) throw new SearchError('SEARCH_RESPONSE_INVALID');
  try {
    exactKeys(
      value,
      [
        'candidates',
        'certainty',
        'contractVersion',
        'costState',
        'counts',
        'cursor',
        'executionId',
        'externalRequestCount',
        'finishedAt',
        'modelRunId',
        'provider',
        'requestSemanticHash',
        'searchRunId',
        'stableError',
        'startedAt',
        'status',
        'truncated',
        'usage',
        'warnings',
      ],
      'batch',
    );
  } catch (error) {
    throw new SearchError('SEARCH_RESPONSE_INVALID', { cause: error });
  }
  if (
    value.contractVersion !== SEARCH_PROVIDER_CONTRACT_VERSION ||
    !validIdentifier(value.searchRunId) ||
    !validIdentifier(value.executionId) ||
    !/^[0-9a-f]{64}$/u.test(String(value.requestSemanticHash)) ||
    !SEARCH_BATCH_STATUSES.includes(value.status as SearchBatchStatus) ||
    !SEARCH_OUTCOME_CERTAINTIES.includes(value.certainty as SearchOutcomeCertainty) ||
    (value.externalRequestCount !== 0 && value.externalRequestCount !== 1) ||
    !validIso(value.startedAt, false) ||
    !validIso(value.finishedAt, false) ||
    (typeof value.startedAt === 'string' &&
      typeof value.finishedAt === 'string' &&
      value.startedAt > value.finishedAt) ||
    typeof value.truncated !== 'boolean' ||
    !validBoundedString(value.cursor, SEARCH_LIMITS.cursorBytes, { nullable: true }) ||
    (typeof value.cursor === 'string' &&
      Buffer.byteLength(value.cursor, 'utf8') > SEARCH_LIMITS.cursorBytes) ||
    !validBoundedString(value.modelRunId, SEARCH_LIMITS.identifierCharacters, {
      nullable: true,
    }) ||
    !validBoundedString(value.stableError, 96, { nullable: true }) ||
    !Array.isArray(value.candidates) ||
    value.candidates.length > SEARCH_LIMITS.maxCandidates ||
    !Array.isArray(value.warnings) ||
    value.warnings.length > SEARCH_LIMITS.candidateWarnings ||
    new Set(value.warnings).size !== value.warnings.length ||
    value.warnings.some(
      (warning) => !validBoundedString(warning, SEARCH_LIMITS.warningCharacters),
    ) ||
    ![
      'NOT_INCURRED',
      'PROVIDER_REPORTED_USD',
      'UNKNOWN_POSSIBLY_INCURRED',
      'UNPRICED_USAGE',
      'USER_PRICE_TABLE_ESTIMATE',
      null,
    ].includes(value.costState as SearchBatchV1['costState'])
  ) {
    throw new SearchError('SEARCH_RESPONSE_INVALID');
  }
  const candidates = value.candidates.map(validateSearchCandidateV1);
  if (
    new Set(candidates.map((candidate) => candidate.candidateId)).size !== candidates.length ||
    new Set(candidates.map((candidate) => candidate.canonicalUrl)).size !== candidates.length ||
    candidates.some(
      (candidate) =>
        candidate.searchRunId !== value.searchRunId ||
        candidate.providerInstanceId !==
          (isPlainObject(value.provider) ? value.provider.providerInstanceId : undefined) ||
        candidate.providerKind !==
          (isPlainObject(value.provider) ? value.provider.kind : undefined),
    )
  ) {
    throw new SearchError('SEARCH_RESPONSE_INVALID');
  }
  if (!isPlainObject(value.counts)) throw new SearchError('SEARCH_RESPONSE_INVALID');
  try {
    exactKeys(value.counts, ['accepted', 'duplicates', 'rejected', 'totalAppearances'], 'counts');
  } catch (error) {
    throw new SearchError('SEARCH_RESPONSE_INVALID', { cause: error });
  }
  const counts = value.counts as unknown as SearchBatchCountsV1;
  if (
    !validCount(counts.accepted, SEARCH_LIMITS.maxCandidates) ||
    !validCount(counts.duplicates, 10_000) ||
    !validCount(counts.rejected, 10_000) ||
    !validCount(counts.totalAppearances, 10_000) ||
    counts.accepted !== candidates.length ||
    counts.totalAppearances !== counts.accepted + counts.duplicates + counts.rejected ||
    (value.status === 'EMPTY' && candidates.length !== 0) ||
    (value.status === 'SUCCEEDED' && candidates.length === 0) ||
    (value.status === 'PARTIAL' && counts.rejected === 0)
  ) {
    throw new SearchError('SEARCH_RESPONSE_INVALID');
  }
  if (value.usage !== null) {
    if (!isPlainObject(value.usage)) throw new SearchError('SEARCH_RESPONSE_INVALID');
    try {
      exactKeys(
        value.usage,
        ['inputTokens', 'outputTokens', 'source', 'toolCalls', 'totalTokens', 'webSearchCalls'],
        'usage',
      );
    } catch (error) {
      throw new SearchError('SEARCH_RESPONSE_INVALID', { cause: error });
    }
    if (
      (value.usage.source !== 'NOT_REPORTED' && value.usage.source !== 'PROVIDER') ||
      !validCount(value.usage.inputTokens, Number.MAX_SAFE_INTEGER, true) ||
      !validCount(value.usage.outputTokens, Number.MAX_SAFE_INTEGER, true) ||
      !validCount(value.usage.totalTokens, Number.MAX_SAFE_INTEGER, true) ||
      !validCount(value.usage.toolCalls, Number.MAX_SAFE_INTEGER, true) ||
      !validCount(value.usage.webSearchCalls, Number.MAX_SAFE_INTEGER, true) ||
      (value.usage.source === 'NOT_REPORTED' &&
        [
          value.usage.inputTokens,
          value.usage.outputTokens,
          value.usage.totalTokens,
          value.usage.toolCalls,
          value.usage.webSearchCalls,
        ].some((item) => item !== null))
    ) {
      throw new SearchError('SEARCH_RESPONSE_INVALID');
    }
  }
  if (!isPlainObject(value.provider)) throw new SearchError('SEARCH_RESPONSE_INVALID');
  try {
    exactKeys(
      value.provider,
      ['contractVersion', 'kind', 'mode', 'providerInstanceId', 'readiness'],
      'provider',
    );
  } catch (error) {
    throw new SearchError('SEARCH_RESPONSE_INVALID', { cause: error });
  }
  if (
    value.provider.contractVersion !== SEARCH_PROVIDER_CONTRACT_VERSION ||
    !SEARCH_PROVIDER_KINDS.includes(value.provider.kind as SearchProviderKind) ||
    !SEARCH_PROVIDER_MODES.includes(value.provider.mode as SearchProviderMode) ||
    !SEARCH_PROVIDER_READINESS.includes(value.provider.readiness as SearchProviderReadiness) ||
    !validIdentifier(value.provider.providerInstanceId)
  ) {
    throw new SearchError('SEARCH_RESPONSE_INVALID');
  }
  const successfulStatus =
    value.status === 'SUCCEEDED' || value.status === 'PARTIAL' || value.status === 'EMPTY';
  const beforeSendStatus =
    value.status === 'RATE_LIMITED_BEFORE_SEND' ||
    value.status === 'BUDGET_BLOCKED' ||
    value.status === 'CAPABILITY_BLOCKED' ||
    value.status === 'CANCELLED_BEFORE_SEND' ||
    value.status === 'FAILED_BEFORE_SEND';
  const afterSendStatus =
    value.status === 'CANCELLED_AFTER_SEND' ||
    value.status === 'FAILED_AFTER_SEND' ||
    value.status === 'AMBIGUOUS';
  if (
    (value.status === 'PARTIAL' && value.provider.mode !== 'ACTIVE_REMOTE') ||
    (value.status === 'EMPTY' && counts.rejected !== 0) ||
    (successfulStatus && value.stableError !== null) ||
    (!successfulStatus && value.stableError === null) ||
    (!successfulStatus &&
      (candidates.length !== 0 ||
        counts.totalAppearances !== 0 ||
        value.cursor !== null ||
        value.truncated)) ||
    (beforeSendStatus &&
      (value.externalRequestCount !== 0 ||
        (value.certainty !== 'NOT_SENT' && value.certainty !== 'REJECTED_BEFORE_EXECUTION'))) ||
    (afterSendStatus && (value.externalRequestCount !== 1 || value.certainty === 'NOT_SENT')) ||
    (successfulStatus && value.certainty !== 'COMPLETED_INVALID_OUTPUT') ||
    (successfulStatus &&
      value.provider.mode === 'ACTIVE_REMOTE' &&
      value.externalRequestCount !== 1) ||
    (value.provider.mode === 'PASSIVE_LOCAL' &&
      (value.externalRequestCount !== 0 ||
        value.costState !== 'NOT_INCURRED' ||
        value.modelRunId !== null ||
        value.usage !== null)) ||
    (successfulStatus &&
      value.provider.kind === 'MODEL_WEB_SEARCH' &&
      (value.modelRunId === null || value.usage === null || value.costState === null))
  ) {
    throw new SearchError('SEARCH_RESPONSE_INVALID');
  }
  return Object.freeze({ ...(value as unknown as SearchBatchV1), candidates });
}

export function searchRequestSemanticHash(request: SearchRequestV1): string {
  const validated = validateSearchRequestV1(request);
  return searchSemanticHash({
    ...validated,
    allowedDomains: validated.allowedDomains.map(normalizeSearchDomain).sort(),
    blockedDomains: validated.blockedDomains.map(normalizeSearchDomain).sort(),
    localInput:
      validated.localInput === null
        ? null
        : {
            ...validated.localInput,
            url: canonicalizeSearchUrl(validated.localInput.url).canonicalUrl,
          },
  });
}
