import type { DatabaseSync } from 'node:sqlite';

import {
  CONTROLLED_FETCH_CONTRACT_VERSION,
  createDefaultFetchProfileV1,
  createFetchPlanV1,
  type FetchPlanV1,
  type FetchProfileV1,
  type FetchRequestV1,
} from '../packages/fetch/src/index.js';
import { canonicalizeSearchUrl, type SearchCandidateV1 } from '../packages/search/src/index.js';

export const FETCH_NOW = '2026-07-28T00:00:00.000Z';
export const FETCH_EXPIRY = '2026-07-28T01:00:00.000Z';

export function fetchCandidate(
  canonicalUrl = 'https://news.example.test/article',
): SearchCandidateV1 {
  const url = canonicalizeSearchUrl(canonicalUrl);
  return Object.freeze({
    candidateId: 'candidate-fetch-001',
    canonicalUrl: url.canonicalUrl,
    citationState: 'NOT_APPLICABLE',
    discoveredAt: FETCH_NOW,
    displayHost: url.displayHost,
    domain: url.domain,
    duplicateOfCandidateId: null,
    evidenceEligibility: 'LEAD_ONLY',
    factStatus: 'NOT_A_FACT',
    fetchState: 'NOT_FETCHED',
    languageHint: null,
    originKind: 'CURATED_SOURCE',
    previewKind: 'NONE',
    previewText: null,
    provenanceAppearances: Object.freeze([
      Object.freeze({
        citationState: 'NOT_APPLICABLE',
        sourceMetadataKind: 'CURATED_ENTRY',
        upstreamIdHash: null,
        upstreamRank: 0,
        wasCited: null,
        wasConsulted: null,
      }),
    ]),
    providerInstanceId: 'curated-source-v1',
    providerKind: 'CURATED_SOURCE',
    publishedAt: null,
    searchRunId: 'search-run-fetch-001',
    sourceMetadataKind: 'CURATED_ENTRY',
    title: '公开页面 fixture',
    truthStatus: 'UNVERIFIED',
    upstreamIdHash: null,
    upstreamRank: 0,
    urlHash: url.urlHash,
    userSupplied: false,
    warnings: Object.freeze([]),
    wasCited: null,
    wasConsulted: null,
  });
}

export function enabledFetchProfile(overrides: Partial<FetchProfileV1> = {}): FetchProfileV1 {
  return Object.freeze({
    ...createDefaultFetchProfileV1(),
    enabled: true,
    ...overrides,
  });
}

export function fetchRequest(
  candidate = fetchCandidate(),
  profile = enabledFetchProfile(),
  overrides: Partial<FetchRequestV1> = {},
): FetchRequestV1 {
  return Object.freeze({
    contractVersion: CONTROLLED_FETCH_CONTRACT_VERSION,
    executionId: 'fetch-execution-001',
    expectedCanonicalUrlHash: candidate.urlHash,
    fetchProfileId: profile.id,
    jobId: 'fetch-job-001',
    profileRevision: profile.revision,
    requestedAt: FETCH_NOW,
    searchCandidateId: candidate.candidateId,
    selectionKind: 'FIXTURE_SELECTED',
    selectionReasonCode: 'TEST_FIXTURE',
    ...overrides,
  });
}

export function fetchPlan(
  candidate = fetchCandidate(),
  profile = enabledFetchProfile(),
  request = fetchRequest(candidate, profile),
): FetchPlanV1 {
  return createFetchPlanV1({
    candidate,
    expiresAt: FETCH_EXPIRY,
    profile,
    request,
  });
}

export function insertFetchCandidate(
  database: DatabaseSync,
  candidate = fetchCandidate(),
): SearchCandidateV1 {
  database
    .prepare(
      `INSERT INTO search_provider_configs (
        provider_instance_id, provider_kind, provider_mode, enabled, max_results,
        timeout_ms, curated_entries_json, settings_revision
      ) VALUES (
        ?, 'CURATED_SOURCE', 'FIXTURE_ONLY', 1, 10, 5000, '[]', 1
      )`,
    )
    .run(candidate.providerInstanceId);
  database
    .prepare(
      `INSERT INTO search_runs (
        id, execution_id, provider_kind, provider_instance_id, provider_mode,
        provider_readiness, request_semantic_hash, plan_hash, query_hash,
        intent, status, certainty, candidate_count, total_appearance_count,
        started_at, finished_at
      ) VALUES (
        ?, 'search-execution-fetch-001', 'CURATED_SOURCE', ?, 'FIXTURE_ONLY',
        'READY', ?, ?, ?, 'BOOK_DISCOVERY', 'SUCCEEDED',
        'REJECTED_BEFORE_EXECUTION', 1, 1, ?, ?
      )`,
    )
    .run(
      candidate.searchRunId,
      candidate.providerInstanceId,
      '1'.repeat(64),
      '2'.repeat(64),
      '3'.repeat(64),
      FETCH_NOW,
      FETCH_NOW,
    );
  database
    .prepare(
      `INSERT INTO search_result_candidates (
        id, search_run_id, provider_instance_id, provider_kind, origin_kind,
        canonical_url, url_hash, domain, display_host, title, preview_kind,
        upstream_rank, discovered_at, user_supplied, source_metadata_kind,
        citation_state, evidence_eligibility, fetch_state, truth_status,
        fact_status, provenance_json, warnings_json
      ) VALUES (
        ?, ?, ?, 'CURATED_SOURCE', 'CURATED_SOURCE', ?, ?, ?, ?, ?, 'NONE',
        0, ?, 0, 'CURATED_ENTRY', 'NOT_APPLICABLE', 'LEAD_ONLY',
        'NOT_FETCHED', 'UNVERIFIED', 'NOT_A_FACT', ?, '[]'
      )`,
    )
    .run(
      candidate.candidateId,
      candidate.searchRunId,
      candidate.providerInstanceId,
      candidate.canonicalUrl,
      candidate.urlHash,
      candidate.domain,
      candidate.displayHost,
      candidate.title,
      candidate.discoveredAt,
      JSON.stringify(candidate.provenanceAppearances),
    );
  return candidate;
}
