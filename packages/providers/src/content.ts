import {
  IMAGE_INPUT_MIME_TYPES,
  IMAGE_QUALITY_HINTS,
  IMAGE_SIZE_HINTS,
  MESSAGE_ROLES,
  PROVIDER_OPERATIONS,
  PROTOCOL_MODES,
  TRISTATE_HINTS,
  type GenerationOptions,
  type ImageContentPart,
  type ImageGenerationRequest,
  type ImageInputMimeType,
  type JsonValue,
  type ProviderCallContext,
  type ProviderOperation,
  type RuntimeSchema,
  type SchemaIssue,
  type TextGenerationRequest,
  type TextMessage,
  type VisionGenerationRequest,
} from './contracts.js';
import { ProviderError } from './errors.js';
import { assertSecretFreeMetadata } from './redaction.js';
import { PROVIDER_LIMITS } from './response-limits.js';

interface ErrorIdentity {
  readonly modelId: string;
  readonly operation: string;
  readonly providerId: string;
  readonly requestId: string;
}

function requestError(
  identity: ErrorIdentity,
  details: Readonly<Record<string, boolean | number | string>> = {},
): ProviderError {
  return new ProviderError('PROVIDER_INVALID_REQUEST', {
    causeCategory: 'VALIDATION',
    details,
    modelId: identity.modelId,
    operation: identity.operation,
    outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
    providerId: identity.providerId,
    requestId: identity.requestId,
    retryDisposition: 'DO_NOT_RETRY',
  });
}

function hasDisallowedControl(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 8 || (codePoint >= 11 && codePoint <= 31) || codePoint === 127;
  });
}

function validIdentifier(value: string): boolean {
  return (
    value.trim() === value &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value) &&
    !hasDisallowedControl(value)
  );
}

function validModelId(value: string): boolean {
  return (
    value.trim() === value &&
    value.length > 0 &&
    value.length <= 200 &&
    !hasDisallowedControl(value)
  );
}

export function validateCallContext(
  context: ProviderCallContext,
  expectedOperation: ProviderOperation,
): void {
  const fallback: ErrorIdentity = {
    modelId: typeof context.modelId === 'string' ? context.modelId : '',
    operation: expectedOperation,
    providerId: typeof context.providerId === 'string' ? context.providerId : 'unavailable',
    requestId: typeof context.requestId === 'string' ? context.requestId : 'unavailable',
  };
  if (
    context.operation !== expectedOperation ||
    !PROVIDER_OPERATIONS.includes(context.operation) ||
    !PROTOCOL_MODES.includes(context.protocolMode) ||
    !validIdentifier(context.requestId) ||
    !validIdentifier(context.providerId) ||
    !validModelId(context.modelId) ||
    !Number.isSafeInteger(context.configRevision) ||
    context.configRevision < 0 ||
    !Number.isSafeInteger(context.timeoutMs) ||
    context.timeoutMs < 1 ||
    context.timeoutMs > 300_000
  ) {
    throw requestError(fallback);
  }
  try {
    assertSecretFreeMetadata(context.traceMetadata);
  } catch {
    throw requestError(fallback, { reason: 'TRACE_METADATA_INVALID' });
  }
  if (context.signal?.aborted === true) {
    throw new ProviderError('PROVIDER_ABORTED', {
      causeCategory: 'ABORT',
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty: 'NOT_SENT',
      providerId: context.providerId,
      requestId: context.requestId,
      retryDisposition: 'DO_NOT_RETRY',
    });
  }
}

export function validateGenerationOptions(
  options: GenerationOptions | undefined,
  identity: ErrorIdentity,
): void {
  if (options === undefined) {
    return;
  }
  if (
    (options.temperature !== undefined &&
      (!Number.isFinite(options.temperature) ||
        options.temperature < 0 ||
        options.temperature > 2)) ||
    (options.topP !== undefined &&
      (!Number.isFinite(options.topP) || options.topP <= 0 || options.topP > 1)) ||
    (options.maxOutputTokens !== undefined &&
      (!Number.isSafeInteger(options.maxOutputTokens) ||
        options.maxOutputTokens < 1 ||
        options.maxOutputTokens > 1_000_000))
  ) {
    throw requestError(identity, { reason: 'GENERATION_OPTIONS_INVALID' });
  }
  if (options.stopSequences !== undefined) {
    if (
      options.stopSequences.length === 0 ||
      options.stopSequences.length > PROVIDER_LIMITS.maxStopSequences ||
      options.stopSequences.some(
        (value) =>
          typeof value !== 'string' ||
          value.length === 0 ||
          value.length > 200 ||
          hasDisallowedControl(value),
      )
    ) {
      throw requestError(identity, { reason: 'STOP_SEQUENCES_INVALID' });
    }
  }
}

function validateMessages(messages: readonly TextMessage[], identity: ErrorIdentity): number {
  if (messages.length === 0 || messages.length > PROVIDER_LIMITS.maxMessages) {
    throw requestError(identity, { reason: 'MESSAGE_COUNT_INVALID' });
  }
  let totalCharacters = 0;
  for (const message of messages) {
    if (!MESSAGE_ROLES.includes(message.role) || message.content.length === 0) {
      throw requestError(identity, { reason: 'MESSAGE_INVALID' });
    }
    for (const part of message.content) {
      if (
        part.type !== 'TEXT' ||
        typeof part.text !== 'string' ||
        part.text.trim().length === 0 ||
        part.text.length > PROVIDER_LIMITS.maxTextPartCharacters ||
        hasDisallowedControl(part.text)
      ) {
        throw requestError(identity, { reason: 'TEXT_PART_INVALID' });
      }
      totalCharacters += part.text.length;
      if (totalCharacters > PROVIDER_LIMITS.maxTotalTextCharacters) {
        throw requestError(identity, { reason: 'TOTAL_TEXT_TOO_LARGE' });
      }
    }
  }
  return totalCharacters;
}

export function validateTextRequest(request: TextGenerationRequest, identity: ErrorIdentity): void {
  validateMessages(request.messages, identity);
  validateGenerationOptions(request.options, identity);
}

function matchesImageMagic(bytes: Uint8Array, mimeType: ImageInputMimeType): boolean {
  if (mimeType === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/gif') {
    const signature = new TextDecoder().decode(bytes.slice(0, 6));
    return signature === 'GIF87a' || signature === 'GIF89a';
  }
  return (
    bytes.length >= 12 &&
    new TextDecoder().decode(bytes.slice(0, 4)) === 'RIFF' &&
    new TextDecoder().decode(bytes.slice(8, 12)) === 'WEBP'
  );
}

export function assertImageBytes(
  part: Pick<ImageContentPart, 'bytes' | 'mimeType'>,
  identity: ErrorIdentity,
  maxBytes: number,
): void {
  if (
    !(part.bytes instanceof Uint8Array) ||
    !IMAGE_INPUT_MIME_TYPES.includes(part.mimeType) ||
    part.bytes.byteLength === 0 ||
    part.bytes.byteLength > maxBytes ||
    !matchesImageMagic(part.bytes, part.mimeType)
  ) {
    throw requestError(identity, { reason: 'IMAGE_BYTES_INVALID' });
  }
}

export function validateVisionRequest(
  request: VisionGenerationRequest,
  identity: ErrorIdentity,
): void {
  if (request.messages.length === 0 || request.messages.length > PROVIDER_LIMITS.maxMessages) {
    throw requestError(identity, { reason: 'MESSAGE_COUNT_INVALID' });
  }
  let imageCount = 0;
  let imageBytes = 0;
  let textCharacters = 0;
  for (const message of request.messages) {
    if (!MESSAGE_ROLES.includes(message.role) || message.content.length === 0) {
      throw requestError(identity, { reason: 'MESSAGE_INVALID' });
    }
    for (const part of message.content) {
      if (part.type === 'TEXT') {
        if (
          part.text.trim().length === 0 ||
          part.text.length > PROVIDER_LIMITS.maxTextPartCharacters ||
          hasDisallowedControl(part.text)
        ) {
          throw requestError(identity, { reason: 'TEXT_PART_INVALID' });
        }
        textCharacters += part.text.length;
      } else if (part.type === 'IMAGE') {
        assertImageBytes(part, identity, PROVIDER_LIMITS.maxInputImageBytes);
        if (
          part.detail !== undefined &&
          !(['AUTO', 'HIGH', 'LOW'] as const).includes(part.detail)
        ) {
          throw requestError(identity, { reason: 'IMAGE_DETAIL_INVALID' });
        }
        imageCount += 1;
        imageBytes += part.bytes.byteLength;
      } else {
        throw requestError(identity, { reason: 'CONTENT_PART_INVALID' });
      }
    }
  }
  if (
    imageCount === 0 ||
    imageCount > PROVIDER_LIMITS.maxImageCount ||
    imageBytes > PROVIDER_LIMITS.maxInputImageTotalBytes ||
    textCharacters > PROVIDER_LIMITS.maxTotalTextCharacters
  ) {
    throw requestError(identity, { reason: 'VISION_LIMIT_INVALID' });
  }
  validateGenerationOptions(request.options, identity);
}

export function validateImageGenerationRequest(
  request: ImageGenerationRequest,
  identity: ErrorIdentity,
): void {
  if (
    typeof request.prompt !== 'string' ||
    request.prompt.trim().length === 0 ||
    request.prompt.length > PROVIDER_LIMITS.maxImagePromptCharacters ||
    hasDisallowedControl(request.prompt) ||
    !Number.isSafeInteger(request.count) ||
    request.count < 1 ||
    request.count > PROVIDER_LIMITS.maxImageOutputCount ||
    (request.sizeHint !== undefined && !IMAGE_SIZE_HINTS.includes(request.sizeHint)) ||
    (request.qualityHint !== undefined && !IMAGE_QUALITY_HINTS.includes(request.qualityHint)) ||
    (request.transparentBackground !== undefined &&
      !TRISTATE_HINTS.includes(request.transparentBackground)) ||
    (request.exposeRevisedPrompt !== undefined && typeof request.exposeRevisedPrompt !== 'boolean')
  ) {
    throw requestError(identity, { reason: 'IMAGE_REQUEST_INVALID' });
  }
}

export interface JsonLimitResult {
  readonly characterCount: number;
  readonly nodeCount: number;
}

export function validateJsonValueLimits(value: unknown, identity: ErrorIdentity): JsonLimitResult {
  let characterCount = 0;
  let nodeCount = 0;
  const visit = (current: unknown, depth: number): void => {
    nodeCount += 1;
    if (depth > PROVIDER_LIMITS.maxJsonDepth || nodeCount > PROVIDER_LIMITS.maxJsonNodes) {
      throw requestError(identity, { reason: 'JSON_STRUCTURE_TOO_LARGE' });
    }
    if (typeof current === 'string') {
      characterCount += current.length;
      if (
        current.length > PROVIDER_LIMITS.maxJsonStringCharacters ||
        characterCount > PROVIDER_LIMITS.maxOutputCharacters
      ) {
        throw requestError(identity, { reason: 'JSON_STRING_TOO_LARGE' });
      }
      return;
    }
    if (
      current === null ||
      typeof current === 'boolean' ||
      (typeof current === 'number' && Number.isFinite(current))
    ) {
      return;
    }
    if (Array.isArray(current)) {
      if (current.length > PROVIDER_LIMITS.maxJsonArrayItems) {
        throw requestError(identity, { reason: 'JSON_ARRAY_TOO_LARGE' });
      }
      for (const item of current) {
        visit(item, depth + 1);
      }
      return;
    }
    if (typeof current === 'object') {
      for (const [key, item] of Object.entries(current)) {
        characterCount += key.length;
        if (
          key.length > 200 ||
          characterCount > PROVIDER_LIMITS.maxOutputCharacters ||
          hasDisallowedControl(key)
        ) {
          throw requestError(identity, { reason: 'JSON_KEY_INVALID' });
        }
        visit(item, depth + 1);
      }
      return;
    }
    throw requestError(identity, { reason: 'JSON_VALUE_INVALID' });
  };
  visit(value, 0);
  return { characterCount, nodeCount };
}

export function validateRuntimeSchema<T>(schema: RuntimeSchema<T>, identity: ErrorIdentity): void {
  if (
    !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(schema.id) ||
    !Number.isSafeInteger(schema.version) ||
    schema.version < 1 ||
    schema.strictObject !== true ||
    typeof schema.validate !== 'function' ||
    (schema.decodeText !== undefined && typeof schema.decodeText !== 'function') ||
    typeof schema.jsonSchema !== 'object' ||
    schema.jsonSchema === null ||
    Array.isArray(schema.jsonSchema) ||
    schema.jsonSchema.type !== 'object' ||
    schema.jsonSchema.additionalProperties !== false
  ) {
    throw requestError(identity, { reason: 'RUNTIME_SCHEMA_INVALID' });
  }
  validateJsonValueLimits(schema.jsonSchema satisfies JsonValue, identity);
}

export function sanitizeSchemaIssues(issues: readonly SchemaIssue[]): readonly SchemaIssue[] {
  return Object.freeze(
    issues.slice(0, 8).map((issue) =>
      Object.freeze({
        ...(typeof issue.actualType === 'string'
          ? { actualType: issue.actualType.slice(0, 64) }
          : {}),
        code: /^[A-Z][A-Z0-9_]{0,63}$/u.test(issue.code) ? issue.code : 'SCHEMA_VALIDATION_FAILED',
        ...(typeof issue.expectedType === 'string'
          ? { expectedType: issue.expectedType.slice(0, 64) }
          : {}),
        path: Object.freeze(
          issue.path
            .slice(0, 8)
            .map((part) =>
              typeof part === 'number'
                ? Number.isSafeInteger(part)
                  ? part
                  : 0
                : /^[A-Za-z0-9_-]{1,64}$/u.test(part)
                  ? part
                  : 'field',
            ),
        ),
        ...(Array.isArray(issue.rootKeys)
          ? {
              rootKeys: Object.freeze(
                issue.rootKeys
                  .slice(0, 12)
                  .map((key) => (/^[A-Za-z0-9_-]{1,64}$/u.test(key) ? key : 'field')),
              ),
            }
          : {}),
        ...(typeof issue.rootType === 'string' ? { rootType: issue.rootType.slice(0, 64) } : {}),
      }),
    ),
  );
}
