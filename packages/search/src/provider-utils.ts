import { SEARCH_PROVIDER_CONTRACT_VERSION, type SearchBatchStatus } from './constants.js';
import {
  assertSupportedSearchFeatures,
  type SearchBatchV1,
  type SearchCandidateAppearanceV1,
  type SearchExecutionContextV1,
  type SearchPreviewV1,
  type SearchProviderDescriptorV1,
  type SearchProviderSnapshotV1,
  type SearchRequestV1,
  type SearchUsageV1,
  searchRequestSemanticHash,
  validateSearchBatchV1,
} from './contracts.js';
import { normalizeSearchCandidates } from './candidates.js';

export function searchProviderSnapshot(
  descriptor: SearchProviderDescriptorV1,
): SearchProviderSnapshotV1 {
  return Object.freeze({
    contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
    kind: descriptor.kind,
    mode: descriptor.mode,
    providerInstanceId: descriptor.providerInstanceId,
    readiness: descriptor.readiness,
  });
}

export function createSearchPreview(
  descriptor: SearchProviderDescriptorV1,
  request: SearchRequestV1,
  estimatedExternalRequests: 0 | 1,
  estimatedInternalSearchCalls = 0,
): SearchPreviewV1 {
  const featureApplications = assertSupportedSearchFeatures(descriptor, request);
  return Object.freeze({
    contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
    estimatedExternalRequests,
    estimatedInternalSearchCalls,
    featureApplications,
    maxResults: Math.min(request.maxResults, descriptor.maxResults),
    providerInstanceId: descriptor.providerInstanceId,
    readiness: descriptor.readiness,
    requestSemanticHash: searchRequestSemanticHash(request),
    warnings: Object.freeze([]),
  });
}

export interface CreateSearchBatchOptionsV1 {
  readonly appearances: readonly SearchCandidateAppearanceV1[];
  readonly certainty?: SearchBatchV1['certainty'];
  readonly costState?: SearchBatchV1['costState'];
  readonly cursor?: string | null;
  readonly descriptor: SearchProviderDescriptorV1;
  readonly executionContext: SearchExecutionContextV1;
  readonly externalRequestCount: 0 | 1;
  readonly finishedAt?: string;
  readonly modelRunId?: string | null;
  readonly request: SearchRequestV1;
  readonly stableError?: string | null;
  readonly startedAt: string;
  readonly status?: SearchBatchStatus;
  readonly truncated?: boolean;
  readonly usage?: SearchUsageV1 | null;
  readonly warnings?: readonly string[];
}

export function createSearchBatch(options: CreateSearchBatchOptionsV1): SearchBatchV1 {
  const finishedAt = options.finishedAt ?? options.executionContext.now().toISOString();
  const normalized = normalizeSearchCandidates(options.appearances, {
    descriptor: options.descriptor,
    discoveredAt: finishedAt,
    request: options.request,
    searchRunId: options.executionContext.searchRunId,
  });
  const status =
    options.status ??
    (normalized.counts.rejected > 0
      ? 'PARTIAL'
      : normalized.counts.accepted > 0
        ? 'SUCCEEDED'
        : 'EMPTY');
  return validateSearchBatchV1({
    candidates: normalized.candidates,
    certainty: options.certainty ?? 'COMPLETED_INVALID_OUTPUT',
    contractVersion: SEARCH_PROVIDER_CONTRACT_VERSION,
    costState: options.costState ?? (options.externalRequestCount === 0 ? 'NOT_INCURRED' : null),
    counts: normalized.counts,
    cursor: options.cursor ?? null,
    executionId: options.request.executionId,
    externalRequestCount: options.externalRequestCount,
    finishedAt,
    modelRunId: options.modelRunId ?? null,
    provider: searchProviderSnapshot(options.descriptor),
    requestSemanticHash: searchRequestSemanticHash(options.request),
    searchRunId: options.executionContext.searchRunId,
    stableError: options.stableError ?? null,
    startedAt: options.startedAt,
    status,
    truncated: options.truncated ?? false,
    usage: options.usage ?? null,
    warnings: Object.freeze([...(options.warnings ?? []), ...normalized.warnings]),
  });
}
