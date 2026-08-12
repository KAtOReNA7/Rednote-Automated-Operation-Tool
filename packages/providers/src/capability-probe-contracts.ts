import type { JsonValue } from './contracts.js';

export const PROVIDER_CAPABILITY_CONTRACT_VERSION = 'provider-capabilities-v1' as const;

export const PROBE_CAPABILITIES = Object.freeze([
  'batch',
  'imageGeneration',
  'streaming',
  'structuredJson',
  'text',
  'toolCalling',
  'usage',
  'vision',
  'webSearch',
] as const);
export type ProbeCapability = (typeof PROBE_CAPABILITIES)[number];

export const PROBE_STATES = Object.freeze(['UNKNOWN', 'SUPPORTED', 'UNSUPPORTED'] as const);
export type ProbeState = (typeof PROBE_STATES)[number];

export const PROBE_SOURCES = Object.freeze(['PROBED', 'METADATA', 'NOT_PROBED'] as const);
export type ProbeSource = (typeof PROBE_SOURCES)[number];

export const PROBE_CONFIDENCES = Object.freeze(['CONFIRMED', 'INCONCLUSIVE'] as const);
export type ProbeConfidence = (typeof PROBE_CONFIDENCES)[number];

export const PROBE_PROFILES = Object.freeze(['CORE', 'FULL', 'CUSTOM'] as const);
export type ProbeProfile = (typeof PROBE_PROFILES)[number];

export const PROBE_PROTOCOL_MODES = Object.freeze([
  'RESPONSES',
  'CHAT_COMPLETIONS',
  'NOT_APPLICABLE',
] as const);
export type ProbeProtocolMode = (typeof PROBE_PROTOCOL_MODES)[number];

export const PROBE_MODEL_SLOTS = Object.freeze([
  'PROVIDER',
  'RESEARCH',
  'WRITING',
  'REVIEW',
  'IMAGE',
] as const);
export type ProbeModelSlot = (typeof PROBE_MODEL_SLOTS)[number];

export const PROBE_RUN_STATUSES = Object.freeze([
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
  'INTERRUPTED',
] as const);
export type ProbeRunStatus = (typeof PROBE_RUN_STATUSES)[number];

export const PROBE_REASON_CODES = Object.freeze([
  'NOT_PROBED',
  'USER_SKIPPED',
  'CONFIG_STALE',
  'AUTHENTICATION_REJECTED',
  'PERMISSION_REJECTED',
  'RATE_LIMITED',
  'QUOTA_UNAVAILABLE',
  'NETWORK_UNREACHABLE',
  'TLS_FAILURE',
  'TIMEOUT',
  'ABORTED',
  'ENDPOINT_EXPLICITLY_UNSUPPORTED',
  'MODEL_EXPLICITLY_UNSUPPORTED',
  'PROTOCOL_EXPLICITLY_UNSUPPORTED',
  'INVALID_CONTENT_TYPE',
  'INVALID_RESPONSE',
  'INVALID_JSON',
  'SCHEMA_MISMATCH',
  'TOOL_NOT_OBSERVED',
  'SEARCH_NOT_OBSERVED',
  'VISION_INCONCLUSIVE',
  'OUTPUT_VARIANT_UNSUPPORTED',
  'USAGE_NOT_REPORTED',
  'METADATA_NOT_REPORTED',
  'AMBIGUOUS_OUTCOME',
  'INTERNAL_ERROR',
] as const);
export type ProbeReasonCode = (typeof PROBE_REASON_CODES)[number];

export interface ProbeModelMapping {
  readonly image: string | null;
  readonly provider: string | null;
  readonly research: string | null;
  readonly review: string | null;
  readonly writing: string | null;
}

export interface CapabilityProbeConfigSnapshot {
  readonly baseUrl: string;
  readonly credentialBindingVersion: number;
  readonly models: ProbeModelMapping;
  readonly protocol: 'OPENAI_COMPATIBLE';
  readonly settingsRevision: number;
}

export interface CapabilityProbeSelection {
  readonly includeToolCalling: boolean;
  readonly profile: ProbeProfile;
  readonly selectedCapabilities: readonly ProbeCapability[];
  readonly structuredProtocolModes?: readonly ('CHAT_COMPLETIONS' | 'RESPONSES')[];
  readonly targetModelSlots?: readonly ProbeModelSlot[];
}

export type CapabilityProbeStepKind =
  | 'BATCH_METADATA'
  | 'IMAGE'
  | 'METADATA'
  | 'STREAMING'
  | 'STRUCTURED'
  | 'TEXT'
  | 'TOOL'
  | 'VISION'
  | 'WEB_SEARCH';

export interface CapabilityProbeStep {
  readonly capability: ProbeCapability;
  readonly id: string;
  readonly kind: CapabilityProbeStepKind;
  readonly modelId: string | null;
  readonly modelSlots: readonly ProbeModelSlot[];
  readonly protocolMode: ProbeProtocolMode;
}

export interface CapabilityProbePlan {
  readonly configFingerprint: string;
  readonly contractVersion: typeof PROVIDER_CAPABILITY_CONTRACT_VERSION;
  readonly credentialBindingVersion: number;
  readonly hash: string;
  readonly profile: ProbeProfile;
  readonly requestCount: number;
  readonly settingsRevision: number;
  readonly steps: readonly CapabilityProbeStep[];
}

export interface ProbeSafeDetails {
  readonly citationCount?: number;
  readonly endpointNotFound?: number;
  readonly errorCode?: string;
  readonly errorParam?: string;
  readonly errorType?: string;
  readonly eventCount?: number;
  readonly imageCount?: number;
  readonly inputTokens?: number;
  readonly modelIdMismatch?: number;
  readonly modelNotFound?: number;
  readonly outputTokens?: number;
  readonly requestId?: string;
  readonly receivedContentType?: string;
  readonly status?: number;
  readonly totalTokens?: number;
  readonly transportVariant?:
    'NONSTANDARD_MIME_JSON' | 'REJECTED' | 'SSE_NORMALIZED' | 'STANDARD_JSON';
}

export interface CapabilityProbeObservation {
  readonly capability: ProbeCapability;
  readonly confidence: ProbeConfidence;
  readonly maxContextTokens: number | null;
  readonly modelId: string | null;
  readonly modelSlots: readonly ProbeModelSlot[];
  readonly observedAt: string | null;
  readonly protocolMode: ProbeProtocolMode;
  readonly rateLimitRequests: number | null;
  readonly rateLimitTokens: number | null;
  readonly reasonCode: ProbeReasonCode;
  readonly safeDetails: ProbeSafeDetails;
  readonly source: ProbeSource;
  readonly state: ProbeState;
}

export interface CapabilityProbeProgress {
  readonly completedRequestCount: number;
  readonly currentCapability: ProbeCapability | null;
  readonly plannedRequestCount: number;
  readonly runId: string;
  readonly sentRequestCount: number;
  readonly status: ProbeRunStatus;
}

export interface CapabilityProbeRunResult {
  readonly completedAt: string;
  readonly observations: readonly CapabilityProbeObservation[];
  readonly reasonCode: ProbeReasonCode | null;
  readonly sentRequestCount: number;
  readonly status: Exclude<ProbeRunStatus, 'RUNNING'>;
}

export interface CapabilityProbeRequest {
  readonly baseUrl: string;
  readonly body: JsonValue | null;
  readonly credential: string;
  readonly method: 'GET' | 'HEAD' | 'OPTIONS' | 'POST';
  readonly path:
    '/batches' | '/chat/completions' | '/images/generations' | '/models' | '/responses';
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
}

export interface CapabilityProbeResponse {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly receivedContentType?: string;
  readonly status: number;
  readonly transportVariant?:
    'NONSTANDARD_MIME_JSON' | 'REJECTED' | 'SSE_NORMALIZED' | 'STANDARD_JSON';
}

export interface CapabilityProbeTransport {
  request(request: CapabilityProbeRequest): Promise<CapabilityProbeResponse>;
}

export interface CapabilityProbeRunnerOptions {
  readonly afterExternalRequest?: (
    step: CapabilityProbeStep,
    observations: readonly CapabilityProbeObservation[],
  ) => void | Promise<void>;
  readonly beforeExternalRequest?: (step: CapabilityProbeStep) => void | Promise<void>;
  readonly isConfigCurrent: () => boolean;
  readonly now?: () => Date;
  readonly onObservation?: (observation: CapabilityProbeObservation) => void | Promise<void>;
  readonly onProgress?: (progress: CapabilityProbeProgress) => void;
  readonly runDeadlineMs?: number;
  readonly runId: string;
  readonly signal: AbortSignal;
  readonly stepTimeoutMs?: number;
}

export const CAPABILITY_PROBE_LIMITS = Object.freeze({
  imageStepTimeoutMs: 120_000,
  maxExternalRequests: 32,
  maxImageResponseBodyBytes: 8 * 1024 * 1024,
  maxResponseBodyBytes: 2 * 1024 * 1024,
  maxResponseHeaderBytes: 32 * 1024,
  runDeadlineMs: 315_000,
  startTokenTtlMs: 5 * 60 * 1_000,
  stepTimeoutMs: 20_000,
  structuredStepTimeoutMs: 90_000,
} as const);
