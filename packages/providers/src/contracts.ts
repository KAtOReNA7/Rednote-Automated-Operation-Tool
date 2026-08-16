import type { ProviderCapabilities } from './capabilities.js';
import type { ProviderUsage } from './usage.js';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonObject = { readonly [key: string]: JsonValue };

export const PROVIDER_OPERATIONS = Object.freeze([
  'TEXT_GENERATION',
  'STRUCTURED_GENERATION',
  'VISION_ANALYSIS',
  'IMAGE_GENERATION',
] as const);
export type ProviderOperation = (typeof PROVIDER_OPERATIONS)[number];

export const PROTOCOL_MODES = Object.freeze([
  'RESPONSES',
  'CHAT_COMPLETIONS',
  'IMAGES_GENERATIONS',
  'MOCK',
] as const);
export type ProtocolMode = (typeof PROTOCOL_MODES)[number];

export const MESSAGE_ROLES = Object.freeze(['SYSTEM', 'USER', 'ASSISTANT'] as const);
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export interface TextContentPart {
  readonly text: string;
  readonly type: 'TEXT';
}

export const IMAGE_INPUT_MIME_TYPES = Object.freeze([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const);
export type ImageInputMimeType = (typeof IMAGE_INPUT_MIME_TYPES)[number];

export interface ImageContentPart {
  readonly bytes: Uint8Array;
  readonly detail?: 'AUTO' | 'HIGH' | 'LOW';
  readonly mimeType: ImageInputMimeType;
  readonly type: 'IMAGE';
}

export interface TextMessage {
  readonly content: readonly TextContentPart[];
  readonly role: MessageRole;
}

export interface VisionMessage {
  readonly content: readonly (ImageContentPart | TextContentPart)[];
  readonly role: MessageRole;
}

export interface GenerationOptions {
  readonly maxOutputTokens?: number;
  readonly stopSequences?: readonly string[];
  readonly temperature?: number;
  readonly topP?: number;
}

export type TraceMetadataValue = boolean | number | string;
export interface ProviderCallContext {
  readonly capabilities: ProviderCapabilities;
  readonly configRevision: number;
  readonly modelId: string;
  readonly operation: ProviderOperation;
  readonly protocolMode: ProtocolMode;
  readonly providerId: string;
  readonly requestId: string;
  readonly signal?: AbortSignal;
  readonly timeoutMs: number;
  readonly traceMetadata: Readonly<Record<string, TraceMetadataValue>>;
}

export interface TextGenerationRequest {
  readonly messages: readonly TextMessage[];
  readonly options?: GenerationOptions;
}

export interface StructuredGenerationRequest {
  readonly messages: readonly TextMessage[];
  readonly options?: GenerationOptions;
}

export interface VisionGenerationRequest {
  readonly messages: readonly VisionMessage[];
  readonly options?: GenerationOptions;
}

export const IMAGE_SIZE_HINTS = Object.freeze(['AUTO', 'SQUARE', 'PORTRAIT', 'LANDSCAPE'] as const);
export type ImageSizeHint = (typeof IMAGE_SIZE_HINTS)[number];

export const IMAGE_QUALITY_HINTS = Object.freeze(['AUTO', 'LOW', 'MEDIUM', 'HIGH'] as const);
export type ImageQualityHint = (typeof IMAGE_QUALITY_HINTS)[number];

export const TRISTATE_HINTS = Object.freeze(['UNSPECIFIED', 'ENABLED', 'DISABLED'] as const);
export type TristateHint = (typeof TRISTATE_HINTS)[number];

export interface ImageGenerationRequest {
  readonly count: number;
  readonly exposeRevisedPrompt?: boolean;
  readonly prompt: string;
  readonly qualityHint?: ImageQualityHint;
  readonly sizeHint?: ImageSizeHint;
  readonly transparentBackground?: TristateHint;
}

export const FINISH_REASONS = Object.freeze([
  'STOP',
  'LENGTH',
  'CONTENT_FILTER',
  'TOOL_CALL',
  'INCOMPLETE',
  'UNKNOWN',
] as const);
export type FinishReason = (typeof FINISH_REASONS)[number];

export interface ProviderRefusal {
  readonly reason: 'PROVIDER_REFUSAL';
}

export const PROVIDER_WARNING_CODES = Object.freeze([
  'USAGE_NOT_REPORTED',
  'USAGE_INCOMPLETE',
  'USAGE_TOTAL_CONFLICT',
  'FINISH_REASON_UNKNOWN',
  'OUTPUT_TRUNCATED',
] as const);
export type ProviderWarningCode = (typeof PROVIDER_WARNING_CODES)[number];

export interface TextGenerationResult {
  readonly finishReason: FinishReason;
  readonly latencyMs: number;
  readonly modelId: string;
  readonly outputTruncated: boolean;
  readonly protocolMode: ProtocolMode;
  readonly providerRequestId: string | null;
  readonly refusal: ProviderRefusal | null;
  readonly text: string;
  readonly usage: ProviderUsage;
  readonly warnings: readonly ProviderWarningCode[];
}

export interface StructuredGenerationResult<T> {
  readonly finishReason: FinishReason;
  readonly latencyMs: number;
  readonly modelId: string;
  readonly protocolMode: ProtocolMode;
  readonly providerRequestId: string | null;
  readonly usage: ProviderUsage;
  readonly value: T;
  readonly warnings: readonly ProviderWarningCode[];
}

export interface GeneratedImage {
  readonly bytes: Uint8Array;
  readonly height: number | null;
  readonly mimeType: ImageInputMimeType;
  readonly revisedPrompt: string | null;
  readonly width: number | null;
}

export interface ImageGenerationResult {
  readonly images: readonly GeneratedImage[];
  readonly latencyMs: number;
  readonly modelId: string;
  readonly protocolMode: ProtocolMode;
  readonly providerRequestId: string | null;
  readonly usage: ProviderUsage;
  readonly warnings: readonly ProviderWarningCode[];
}

export interface SchemaIssue {
  readonly actualType?: string;
  readonly code: string;
  readonly expectedType?: string;
  readonly path: readonly (number | string)[];
  readonly rootKeys?: readonly string[];
  readonly rootType?: string;
}

export type SchemaValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly issues: readonly SchemaIssue[]; readonly ok: false };

export interface RuntimeSchema<T> {
  readonly decodeText?: (text: string) => SchemaValidationResult<T>;
  readonly id: string;
  readonly jsonSchema: JsonObject;
  readonly strictObject: true;
  readonly validate: (value: unknown) => SchemaValidationResult<T>;
  readonly version: number;
}

export interface TextGenerationProvider {
  generateText(
    request: TextGenerationRequest,
    context: ProviderCallContext,
  ): Promise<TextGenerationResult>;
}

export interface StructuredGenerationProvider {
  generateStructured<T>(
    request: StructuredGenerationRequest,
    schema: RuntimeSchema<T>,
    context: ProviderCallContext,
  ): Promise<StructuredGenerationResult<T>>;
}

export interface VisionProvider {
  analyzeVision(
    request: VisionGenerationRequest,
    context: ProviderCallContext,
  ): Promise<TextGenerationResult>;
}

export interface ImageGenerationProvider {
  generateImage(
    request: ImageGenerationRequest,
    context: ProviderCallContext,
  ): Promise<ImageGenerationResult>;
}
