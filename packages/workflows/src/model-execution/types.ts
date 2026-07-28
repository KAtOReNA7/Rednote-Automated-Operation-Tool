import type { OutcomeCertainty, ProtocolMode } from '@mystery-operations/providers';

export const MODEL_EXECUTION_CONTRACT_VERSION = 'model-execution-v1';
export const PROVIDER_CONTRACT_VERSION = 'provider-v1';
export const CACHE_KEY_VERSION = 'cache-key-v1';
export const CANONICALIZATION_VERSION = 'canonical-json-v1';

export const MODEL_CACHE_POLICIES = Object.freeze([
  'READ_WRITE',
  'READ_ONLY',
  'BYPASS',
  'REFRESH',
] as const);
export type ModelCachePolicy = (typeof MODEL_CACHE_POLICIES)[number];

export const MODEL_EXECUTION_STATUSES = Object.freeze([
  'CACHE_HIT',
  'SUCCEEDED',
  'FAILED_BEFORE_SEND',
  'FAILED_AFTER_SEND',
  'CANCELLED_BEFORE_SEND',
  'CANCELLED_AFTER_SEND',
  'AMBIGUOUS',
  'BUDGET_BLOCKED',
  'CAPABILITY_BLOCKED',
  'CACHE_CORRUPT',
  'IN_FLIGHT',
] as const);
export type ModelExecutionStatus = (typeof MODEL_EXECUTION_STATUSES)[number];

export type ModelOutputType = 'IMAGE' | 'STRUCTURED' | 'TEXT' | 'VISION';
export type ModelCapability = 'imageGeneration' | 'structuredJson' | 'text' | 'usage' | 'vision';

export interface ContentIdentityV1 {
  readonly contentHash: string;
  readonly id: string;
  readonly version: number;
}

export interface SourceIdentityV1 {
  readonly contentHash: string;
  readonly kind: 'MEDIA' | 'SOURCE';
}

export interface ModelUnitDemandV1 {
  readonly externalCalls: number;
  readonly imageGenerationCalls: number;
  readonly images: number;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly toolCalls: number;
  readonly webSearchCalls: number;
}

export interface UsageObservationV1 {
  readonly cacheWriteTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly imageGenerationCalls: number | null;
  readonly images: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly source: 'NOT_REPORTED' | 'PROVIDER';
  readonly toolCalls: number | null;
  readonly totalTokens: number | null;
  readonly webSearchCalls: number | null;
}

export interface ProviderCostObservationV1 {
  readonly currency: string;
  readonly decimalAmountString: string;
  readonly evidenceKind: 'ALLOWLISTED_RESPONSE_FIELD' | 'OTHER';
  readonly providerRequestIdentity: string | null;
}

export interface TextModelOutputV1 {
  readonly finishReason: string;
  readonly partial: false;
  readonly refusal: false;
  readonly text: string;
  readonly type: 'TEXT' | 'VISION';
}

export interface StructuredModelOutputV1 {
  readonly partial: false;
  readonly refusal: false;
  readonly type: 'STRUCTURED';
  readonly value: unknown;
}

export interface ImageModelOutputV1 {
  readonly images: readonly {
    readonly base64: string;
    readonly height: number | null;
    readonly mimeType: 'image/gif' | 'image/jpeg' | 'image/png' | 'image/webp';
    readonly width: number | null;
  }[];
  readonly partial: false;
  readonly refusal: false;
  readonly type: 'IMAGE';
}

export type ModelExecutionOutputV1 =
  ImageModelOutputV1 | StructuredModelOutputV1 | TextModelOutputV1;

export interface ModelExecutionRequestV1 {
  readonly budgetClassification: 'NONESSENTIAL';
  readonly cachePolicy: ModelCachePolicy;
  readonly deadlineMs: number;
  readonly executionId: string;
  readonly generationOptions: Readonly<Record<string, unknown>>;
  readonly input: unknown;
  readonly jobId?: string;
  readonly mediaIdentities: readonly SourceIdentityV1[];
  readonly modelId: string;
  readonly modelRole: string;
  readonly modelSlot: string;
  readonly outputSchemaIdentity?: ContentIdentityV1;
  readonly parameterVersion: number;
  readonly promptIdentity: ContentIdentityV1;
  readonly protocolMode: ProtocolMode;
  readonly providerConfigFingerprint: string;
  readonly requiredCapabilities: readonly ModelCapability[];
  readonly signal?: AbortSignal;
  readonly sourceIdentities: readonly SourceIdentityV1[];
  readonly taskKind: string;
  readonly unitDemandUpperBound: ModelUnitDemandV1;
}

export interface ModelExecutionResultV1 {
  readonly costAmountMicroUsd: number | null;
  readonly costState:
    | 'NOT_INCURRED'
    | 'PROVIDER_REPORTED_USD'
    | 'UNKNOWN_POSSIBLY_INCURRED'
    | 'UNPRICED_USAGE'
    | 'USER_PRICE_TABLE_ESTIMATE';
  readonly executionId: string;
  readonly externalRequestCount: 0 | 1;
  readonly localCacheHit: boolean;
  readonly outcomeCertainty: OutcomeCertainty;
  readonly output: ModelExecutionOutputV1 | null;
  readonly stableErrorCode: string | null;
  readonly status: ModelExecutionStatus;
  readonly usage: UsageObservationV1;
}

export function emptyUsageObservation(): UsageObservationV1 {
  return Object.freeze({
    cacheWriteTokens: null,
    cachedInputTokens: null,
    imageGenerationCalls: null,
    images: null,
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    source: 'NOT_REPORTED',
    toolCalls: null,
    totalTokens: null,
    webSearchCalls: null,
  });
}
