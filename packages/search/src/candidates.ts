import { createHash } from 'node:crypto';

import {
  SEARCH_CITATION_STATES,
  SEARCH_EVIDENCE_ELIGIBILITY,
  SEARCH_FACT_STATUS,
  SEARCH_FETCH_STATE,
  SEARCH_LIMITS,
  SEARCH_PREVIEW_KINDS,
  SEARCH_PROVIDER_CONTRACT_VERSION,
  SEARCH_SOURCE_METADATA_KINDS,
  SEARCH_TRUTH_STATUS,
  type SearchCitationState,
  type SearchPreviewKind,
  type SearchSourceMetadataKind,
} from './constants.js';
import {
  type SearchBatchCountsV1,
  type SearchCandidateAppearanceV1,
  type SearchCandidateV1,
  type SearchProviderDescriptorV1,
  type SearchProvenanceAppearanceV1,
  type SearchRequestV1,
  validateSearchCandidateV1,
} from './contracts.js';
import { SearchError } from './errors.js';
import { canonicalizeSearchUrl, domainAllowed } from './url.js';

export interface NormalizeCandidateOptionsV1 {
  readonly descriptor: SearchProviderDescriptorV1;
  readonly discoveredAt: string;
  readonly request: SearchRequestV1;
  readonly searchRunId: string;
}

export interface NormalizedCandidatesV1 {
  readonly candidates: readonly SearchCandidateV1[];
  readonly counts: SearchBatchCountsV1;
  readonly warnings: readonly string[];
}

function nullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean';
}

function validIso(value: string | null): boolean {
  return (
    value === null ||
    (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value) &&
      Number.isFinite(Date.parse(value)))
  );
}

export function validateSearchCandidateAppearanceV1(value: unknown): SearchCandidateAppearanceV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SearchError('SEARCH_RESULT_INVALID');
  }
  const appearance = value as SearchCandidateAppearanceV1;
  const keys = Object.keys(value).sort();
  const expected = [
    'citationState',
    'languageHint',
    'previewKind',
    'previewText',
    'publishedAt',
    'sourceMetadataKind',
    'title',
    'upstreamId',
    'upstreamRank',
    'url',
    'userSupplied',
    'wasCited',
    'wasConsulted',
  ].sort();
  if (
    keys.length !== expected.length ||
    keys.some((key, index) => key !== expected[index]) ||
    typeof appearance.url !== 'string' ||
    appearance.url.length < 1 ||
    appearance.url.length > SEARCH_LIMITS.urlCharacters ||
    (appearance.title !== null &&
      (typeof appearance.title !== 'string' ||
        appearance.title.length < 1 ||
        appearance.title.length > SEARCH_LIMITS.titleCharacters)) ||
    (appearance.previewText !== null &&
      (typeof appearance.previewText !== 'string' ||
        appearance.previewText.length < 1 ||
        appearance.previewText.length > SEARCH_LIMITS.previewCharacters)) ||
    (appearance.previewKind === 'NONE' && appearance.previewText !== null) ||
    (appearance.previewKind !== 'NONE' && appearance.previewText === null) ||
    (appearance.languageHint !== null &&
      (typeof appearance.languageHint !== 'string' ||
        appearance.languageHint.length < 1 ||
        appearance.languageHint.length > 32)) ||
    (appearance.upstreamId !== null &&
      (typeof appearance.upstreamId !== 'string' ||
        appearance.upstreamId.length < 1 ||
        appearance.upstreamId.length > 512)) ||
    (appearance.upstreamRank !== null &&
      (!Number.isSafeInteger(appearance.upstreamRank) ||
        appearance.upstreamRank < 0 ||
        appearance.upstreamRank > 1_000_000)) ||
    !SEARCH_PREVIEW_KINDS.includes(appearance.previewKind as SearchPreviewKind) ||
    !SEARCH_SOURCE_METADATA_KINDS.includes(
      appearance.sourceMetadataKind as SearchSourceMetadataKind,
    ) ||
    !SEARCH_CITATION_STATES.includes(appearance.citationState as SearchCitationState) ||
    typeof appearance.userSupplied !== 'boolean' ||
    !nullableBoolean(appearance.wasCited) ||
    !nullableBoolean(appearance.wasConsulted) ||
    !validIso(appearance.publishedAt)
  ) {
    throw new SearchError('SEARCH_RESULT_INVALID');
  }
  try {
    canonicalizeSearchUrl(appearance.url);
  } catch (cause) {
    throw new SearchError('SEARCH_RESULT_INVALID', { cause });
  }
  return appearance;
}

function upstreamHash(value: string | null): string | null {
  return value === null ? null : createHash('sha256').update(value, 'utf8').digest('hex');
}

function appearanceProvenance(
  appearance: SearchCandidateAppearanceV1,
): SearchProvenanceAppearanceV1 {
  return Object.freeze({
    citationState: appearance.citationState,
    sourceMetadataKind: appearance.sourceMetadataKind,
    upstreamIdHash: upstreamHash(appearance.upstreamId),
    upstreamRank: appearance.upstreamRank,
    wasCited: appearance.wasCited,
    wasConsulted: appearance.wasConsulted,
  });
}

function mergedCitationState(
  existing: SearchCitationState,
  incoming: SearchCitationState,
): SearchCitationState {
  if (existing === 'CITED' || incoming === 'CITED') return 'CITED';
  if (existing === 'CONSULTED_ONLY' || incoming === 'CONSULTED_ONLY') return 'CONSULTED_ONLY';
  if (existing === 'UNKNOWN' || incoming === 'UNKNOWN') return 'UNKNOWN';
  return 'NOT_APPLICABLE';
}

function mergedNullableBoolean(left: boolean | null, right: boolean | null): boolean | null {
  if (left === true || right === true) return true;
  if (left === false || right === false) return false;
  return null;
}

export function normalizeSearchCandidates(
  appearances: readonly SearchCandidateAppearanceV1[],
  options: NormalizeCandidateOptionsV1,
): NormalizedCandidatesV1 {
  if (appearances.length > 10_000) {
    throw new SearchError('SEARCH_RESPONSE_TOO_LARGE', { sendState: 'SENT' });
  }
  const byUrl = new Map<string, SearchCandidateV1>();
  let rejected = 0;
  let duplicates = 0;
  for (const raw of appearances) {
    let appearance: SearchCandidateAppearanceV1;
    try {
      appearance = validateSearchCandidateAppearanceV1(raw);
      const normalizedUrl = canonicalizeSearchUrl(appearance.url);
      if (
        !domainAllowed(
          normalizedUrl.domain,
          options.request.allowedDomains,
          options.request.blockedDomains,
        )
      ) {
        rejected += 1;
        continue;
      }
      const existing = byUrl.get(normalizedUrl.canonicalUrl);
      if (existing !== undefined) {
        duplicates += 1;
        const merged = validateSearchCandidateV1({
          ...existing,
          citationState: mergedCitationState(existing.citationState, appearance.citationState),
          languageHint: existing.languageHint ?? appearance.languageHint,
          previewKind:
            existing.previewKind === 'NONE' ? appearance.previewKind : existing.previewKind,
          previewText: existing.previewText ?? appearance.previewText,
          provenanceAppearances: [
            ...existing.provenanceAppearances,
            appearanceProvenance(appearance),
          ],
          publishedAt: existing.publishedAt ?? appearance.publishedAt,
          title: existing.title ?? appearance.title,
          userSupplied: existing.userSupplied || appearance.userSupplied,
          wasCited: mergedNullableBoolean(existing.wasCited, appearance.wasCited),
          wasConsulted: mergedNullableBoolean(existing.wasConsulted, appearance.wasConsulted),
        });
        byUrl.set(normalizedUrl.canonicalUrl, merged);
        continue;
      }
      if (byUrl.size >= options.request.maxResults) {
        rejected += 1;
        continue;
      }
      const candidateId = createHash('sha256')
        .update(
          `${SEARCH_PROVIDER_CONTRACT_VERSION}\n${options.searchRunId}\n${normalizedUrl.canonicalUrl}`,
          'utf8',
        )
        .digest('hex');
      byUrl.set(
        normalizedUrl.canonicalUrl,
        validateSearchCandidateV1({
          candidateId,
          canonicalUrl: normalizedUrl.canonicalUrl,
          citationState: appearance.citationState,
          discoveredAt: options.discoveredAt,
          displayHost: normalizedUrl.displayHost,
          domain: normalizedUrl.domain,
          duplicateOfCandidateId: null,
          evidenceEligibility: SEARCH_EVIDENCE_ELIGIBILITY,
          factStatus: SEARCH_FACT_STATUS,
          fetchState: SEARCH_FETCH_STATE,
          languageHint: appearance.languageHint,
          originKind: options.descriptor.kind,
          previewKind: appearance.previewKind,
          previewText: appearance.previewText,
          provenanceAppearances: [appearanceProvenance(appearance)],
          providerInstanceId: options.descriptor.providerInstanceId,
          providerKind: options.descriptor.kind,
          publishedAt: appearance.publishedAt,
          searchRunId: options.searchRunId,
          sourceMetadataKind: appearance.sourceMetadataKind,
          title: appearance.title,
          truthStatus: SEARCH_TRUTH_STATUS,
          upstreamIdHash: upstreamHash(appearance.upstreamId),
          upstreamRank: appearance.upstreamRank,
          urlHash: normalizedUrl.urlHash,
          userSupplied: appearance.userSupplied,
          warnings: [],
          wasCited: appearance.wasCited,
          wasConsulted: appearance.wasConsulted,
        }),
      );
    } catch {
      rejected += 1;
    }
  }
  const candidates = [...byUrl.values()];
  return Object.freeze({
    candidates: Object.freeze(candidates),
    counts: Object.freeze({
      accepted: candidates.length,
      duplicates,
      rejected,
      totalAppearances: appearances.length,
    }),
    warnings: Object.freeze(rejected > 0 ? ['SEARCH_ITEMS_REJECTED'] : []),
  });
}
