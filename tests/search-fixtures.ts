import {
  SEARCH_PROVIDER_CONTRACT_VERSION,
  type SearchCandidateAppearanceV1,
  type SearchRequestV1,
} from '../packages/search/src/index.js';

export function searchRequest(overrides: Partial<SearchRequestV1> = {}): SearchRequestV1 {
  return {
    allowedDomains: [],
    blockedDomains: [],
    contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
    countryHint: null,
    cursor: null,
    executionId: 'search-execution-001',
    intent: 'BOOK_DISCOVERY',
    jobId: null,
    liveAccess: 'UNSPECIFIED',
    localeHints: [],
    localInput: null,
    maxResults: 10,
    providerInstanceId: 'curated-source-v1',
    publishedAfter: null,
    publishedBefore: null,
    query: 'locked-room mystery',
    ratePolicyRef: null,
    ...overrides,
  };
}

export function appearance(
  url: string,
  overrides: Partial<SearchCandidateAppearanceV1> = {},
): SearchCandidateAppearanceV1 {
  return {
    citationState: 'NOT_APPLICABLE',
    languageHint: null,
    previewKind: 'NONE',
    previewText: null,
    publishedAt: null,
    sourceMetadataKind: 'CURATED_ENTRY',
    title: 'Fixture title',
    upstreamId: 'fixture-1',
    upstreamRank: 0,
    url,
    userSupplied: false,
    wasCited: null,
    wasConsulted: null,
    ...overrides,
  };
}
