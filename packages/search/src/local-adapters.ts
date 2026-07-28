import {
  SEARCH_INTENTS,
  SEARCH_LIMITS,
  SEARCH_PROVIDER_CONTRACT_VERSION,
  type SearchIntent,
} from './constants.js';
import {
  type SearchCandidateAppearanceV1,
  type SearchExecutionContextV1,
  type SearchPreviewV1,
  type SearchProviderDescriptorV1,
  type SearchProviderV1,
  type SearchRequestV1,
  validateSearchProviderDescriptorV1,
  validateSearchRequestV1,
} from './contracts.js';
import { SearchError } from './errors.js';
import { createSearchBatch, createSearchPreview } from './provider-utils.js';
import { canonicalizeSearchUrl } from './url.js';

const LOCAL_FEATURES = Object.freeze({
  allowedDomains: true,
  blockedDomains: true,
  countryHint: false,
  cursor: false,
  hardDomainFilter: true,
  liveAccess: false,
  localeHints: false,
  manualUrl: false,
  publishedDateRange: false,
  query: false,
  structuredSources: true,
});

export class ManualUrlAdapter implements SearchProviderV1 {
  readonly #descriptor: SearchProviderDescriptorV1;

  public constructor(providerInstanceId = 'manual-url-v1', enabled = true) {
    this.#descriptor = validateSearchProviderDescriptorV1({
      budgetState: 'NOT_APPLICABLE',
      capabilityState: 'NOT_APPLICABLE',
      codecState: 'NOT_APPLICABLE',
      contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
      credentialState: 'NOT_APPLICABLE',
      displayName: '手工 URL',
      features: { ...LOCAL_FEATURES, manualUrl: true },
      kind: 'MANUAL_URL',
      maxResponseBytes: SEARCH_LIMITS.responseBytes,
      maxResults: 1,
      mode: 'PASSIVE_LOCAL',
      providerInstanceId,
      rateState: 'NOT_APPLICABLE',
      readiness: enabled ? 'READY' : 'DISABLED',
      supportedIntents: ['USER_PROVIDED_URL'],
    });
  }

  public describe(): SearchProviderDescriptorV1 {
    return this.#descriptor;
  }

  public async preview(requestValue: SearchRequestV1): Promise<SearchPreviewV1> {
    const request = validateSearchRequestV1(requestValue);
    return createSearchPreview(this.#descriptor, request, 0);
  }

  public async execute(requestValue: SearchRequestV1, context: SearchExecutionContextV1) {
    const request = validateSearchRequestV1(requestValue);
    if (this.#descriptor.readiness !== 'READY') {
      throw new SearchError('SEARCH_PROVIDER_NOT_READY');
    }
    if (request.localInput?.kind !== 'MANUAL_URL') {
      throw new SearchError('SEARCH_INVALID_REQUEST');
    }
    canonicalizeSearchUrl(request.localInput.url);
    const startedAt = context.now().toISOString();
    return createSearchBatch({
      appearances: [
        {
          citationState: 'NOT_APPLICABLE',
          languageHint: request.localeHints[0] ?? null,
          previewKind: request.localInput.note === null ? 'NONE' : 'USER_NOTE',
          previewText: request.localInput.note,
          publishedAt: null,
          sourceMetadataKind: 'MANUAL_URL_INPUT',
          title: request.localInput.title,
          upstreamId: null,
          upstreamRank: 0,
          url: request.localInput.url,
          userSupplied: true,
          wasCited: null,
          wasConsulted: null,
        },
      ],
      descriptor: this.#descriptor,
      executionContext: context,
      externalRequestCount: 0,
      request,
      startedAt,
    });
  }
}

export interface CuratedSourceEntryV1 {
  readonly entryId: string;
  readonly intent: SearchIntent;
  readonly languageHint: string | null;
  readonly title: string;
  readonly urlTemplate: string;
}

function validateCuratedEntry(entry: CuratedSourceEntryV1): CuratedSourceEntryV1 {
  if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  const keys = Object.keys(entry).sort();
  const placeholderCount = entry.urlTemplate.match(/\{query\}/gu)?.length ?? 0;
  if (
    keys.join(',') !== 'entryId,intent,languageHint,title,urlTemplate' ||
    typeof entry.entryId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(entry.entryId) ||
    !SEARCH_INTENTS.includes(entry.intent) ||
    typeof entry.title !== 'string' ||
    entry.title.length < 1 ||
    entry.title.length > SEARCH_LIMITS.titleCharacters ||
    (entry.languageHint !== null &&
      (typeof entry.languageHint !== 'string' ||
        entry.languageHint.length < 1 ||
        entry.languageHint.length > 32)) ||
    typeof entry.urlTemplate !== 'string' ||
    entry.urlTemplate.length < 1 ||
    entry.urlTemplate.length > SEARCH_LIMITS.urlCharacters ||
    placeholderCount !== 1
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  const marker = 'issue015-query-marker';
  const probe = entry.urlTemplate.replace('{query}', marker);
  const normalized = canonicalizeSearchUrl(probe);
  const rawParsed = new URL(probe);
  const parsed = new URL(normalized.canonicalUrl);
  const markerLocations = [...parsed.searchParams.entries()].filter(
    ([key, value]) => key.includes(marker) || value.includes(marker),
  );
  if (
    rawParsed.hash !== '' ||
    parsed.pathname.includes(marker) ||
    parsed.hostname.includes(marker) ||
    markerLocations.length !== 1 ||
    markerLocations[0]?.[0].includes(marker) === true
  ) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  return Object.freeze({ ...entry });
}

export function validateCuratedSourceEntriesV1(value: unknown): readonly CuratedSourceEntryV1[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  const entries = value.map((entry) => validateCuratedEntry(entry as CuratedSourceEntryV1));
  if (new Set(entries.map((entry) => entry.entryId)).size !== entries.length) {
    throw new SearchError('SEARCH_INVALID_REQUEST');
  }
  return Object.freeze(entries);
}

export class CuratedSourceAdapter implements SearchProviderV1 {
  readonly #descriptor: SearchProviderDescriptorV1;
  readonly #entries: readonly CuratedSourceEntryV1[];

  public constructor(
    entries: readonly CuratedSourceEntryV1[],
    providerInstanceId = 'curated-source-v1',
    enabled = true,
  ) {
    this.#entries = validateCuratedSourceEntriesV1(entries);
    const intents = [...new Set(entries.map((entry) => entry.intent))];
    this.#descriptor = validateSearchProviderDescriptorV1({
      budgetState: 'NOT_APPLICABLE',
      capabilityState: 'NOT_APPLICABLE',
      codecState: 'NOT_APPLICABLE',
      contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
      credentialState: 'NOT_APPLICABLE',
      displayName: '定向来源',
      features: { ...LOCAL_FEATURES, query: true },
      kind: 'CURATED_SOURCE',
      maxResponseBytes: SEARCH_LIMITS.responseBytes,
      maxResults: SEARCH_LIMITS.maxCandidates,
      mode: 'PASSIVE_LOCAL',
      providerInstanceId,
      rateState: 'NOT_APPLICABLE',
      readiness: !enabled ? 'DISABLED' : entries.length === 0 ? 'NOT_CONFIGURED' : 'READY',
      supportedIntents: intents.length > 0 ? intents : ['BOOK_DISCOVERY'],
    });
  }

  public describe(): SearchProviderDescriptorV1 {
    return this.#descriptor;
  }

  public async preview(requestValue: SearchRequestV1): Promise<SearchPreviewV1> {
    return createSearchPreview(this.#descriptor, validateSearchRequestV1(requestValue), 0);
  }

  public async execute(requestValue: SearchRequestV1, context: SearchExecutionContextV1) {
    const request = validateSearchRequestV1(requestValue);
    if (this.#descriptor.readiness !== 'READY') {
      throw new SearchError('SEARCH_PROVIDER_NOT_READY');
    }
    const startedAt = context.now().toISOString();
    const appearances: SearchCandidateAppearanceV1[] = this.#entries
      .filter((entry) => entry.intent === request.intent)
      .slice(0, request.maxResults)
      .map((entry, index) => ({
        citationState: 'NOT_APPLICABLE',
        languageHint: entry.languageHint,
        previewKind: 'NONE',
        previewText: null,
        publishedAt: null,
        sourceMetadataKind: 'CURATED_ENTRY',
        title: entry.title,
        upstreamId: entry.entryId,
        upstreamRank: index,
        url: entry.urlTemplate.replace('{query}', encodeURIComponent(request.query)),
        userSupplied: false,
        wasCited: null,
        wasConsulted: null,
      }));
    return createSearchBatch({
      appearances,
      descriptor: this.#descriptor,
      executionContext: context,
      externalRequestCount: 0,
      request,
      startedAt,
    });
  }
}

export class BrowserClipAdapter implements SearchProviderV1 {
  readonly #descriptor: SearchProviderDescriptorV1;

  public constructor(providerInstanceId = 'browser-clip-v1') {
    this.#descriptor = validateSearchProviderDescriptorV1({
      budgetState: 'NOT_APPLICABLE',
      capabilityState: 'NOT_APPLICABLE',
      codecState: 'NOT_APPLICABLE',
      contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
      credentialState: 'NOT_APPLICABLE',
      displayName: '浏览器收藏',
      features: LOCAL_FEATURES,
      kind: 'BROWSER_CLIP',
      maxResponseBytes: SEARCH_LIMITS.responseBytes,
      maxResults: 1,
      mode: 'PASSIVE_LOCAL',
      providerInstanceId,
      rateState: 'NOT_APPLICABLE',
      readiness: 'READY',
      supportedIntents: ['USER_PROVIDED_CLIP'],
    });
  }

  public describe(): SearchProviderDescriptorV1 {
    return this.#descriptor;
  }

  public async preview(requestValue: SearchRequestV1): Promise<SearchPreviewV1> {
    return createSearchPreview(this.#descriptor, validateSearchRequestV1(requestValue), 0);
  }

  public async execute(requestValue: SearchRequestV1, context: SearchExecutionContextV1) {
    const request = validateSearchRequestV1(requestValue);
    if (request.localInput?.kind !== 'BROWSER_CLIP') {
      throw new SearchError('SEARCH_INVALID_REQUEST');
    }
    canonicalizeSearchUrl(request.localInput.url);
    const startedAt = context.now().toISOString();
    return createSearchBatch({
      appearances: [
        {
          citationState: 'NOT_APPLICABLE',
          languageHint: request.localeHints[0] ?? null,
          previewKind: 'NONE',
          previewText: null,
          publishedAt: null,
          sourceMetadataKind: 'BROWSER_CLIP_INPUT',
          title: request.localInput.title,
          upstreamId: null,
          upstreamRank: 0,
          url: request.localInput.url,
          userSupplied: true,
          wasCited: null,
          wasConsulted: null,
        },
      ],
      descriptor: this.#descriptor,
      executionContext: context,
      externalRequestCount: 0,
      request,
      startedAt,
    });
  }
}
