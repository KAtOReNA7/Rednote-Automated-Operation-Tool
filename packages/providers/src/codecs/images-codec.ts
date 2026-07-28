import {
  type GeneratedImage,
  type ImageGenerationRequest,
  type ImageGenerationResult,
  type ImageInputMimeType,
  type JsonObject,
  type ProviderCallContext,
} from '../contracts.js';
import { assertImageBytes } from '../content.js';
import { ProviderError } from '../errors.js';
import { PROVIDER_LIMITS } from '../response-limits.js';
import { applyUsageCapability, parseProviderUsage } from '../usage.js';
import {
  asRecord,
  parseJsonEnvelope,
  protocolError,
  safeProviderRequestId,
} from './codec-utils.js';

const SIZE_VALUES = Object.freeze({
  AUTO: 'auto',
  LANDSCAPE: '1536x1024',
  PORTRAIT: '1024x1536',
  SQUARE: '1024x1024',
} as const);

function detectMime(bytes: Uint8Array): ImageInputMimeType | null {
  const candidates: readonly ImageInputMimeType[] = [
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
  ];
  const neutralIdentity = {
    modelId: 'image',
    operation: 'IMAGE_GENERATION',
    providerId: 'image',
    requestId: 'image',
  };
  return (
    candidates.find((mimeType) => {
      try {
        assertImageBytes({ bytes, mimeType }, neutralIdentity, bytes.byteLength);
        return true;
      } catch {
        return false;
      }
    }) ?? null
  );
}

export function encodeImagesGeneration(
  request: ImageGenerationRequest,
  context: ProviderCallContext,
): JsonObject {
  const body: Record<string, JsonObject[keyof JsonObject]> = {
    model: context.modelId,
    n: request.count,
    prompt: request.prompt,
    response_format: 'b64_json',
  };
  if (request.sizeHint !== undefined) {
    body.size = SIZE_VALUES[request.sizeHint];
  }
  if (request.qualityHint !== undefined) {
    body.quality = request.qualityHint.toLowerCase();
  }
  if (request.transparentBackground === 'ENABLED') {
    body.background = 'transparent';
  } else if (request.transparentBackground === 'DISABLED') {
    body.background = 'opaque';
  }
  return body;
}

function decodeBase64(
  value: string,
  context: ProviderCallContext,
): { readonly bytes: Uint8Array; readonly mimeType: ImageInputMimeType } {
  const estimatedBytes = Math.ceil(value.length / 4) * 3;
  if (
    value.length === 0 ||
    estimatedBytes > PROVIDER_LIMITS.maxImageOutputBytes ||
    !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)
  ) {
    throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', {
      causeCategory: 'PROTOCOL',
      details: { estimatedBytes, limitBytes: PROVIDER_LIMITS.maxImageOutputBytes },
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      providerId: context.providerId,
      requestId: context.requestId,
      retryDisposition: 'RETRY_MANUAL',
    });
  }
  const bytes = Uint8Array.from(Buffer.from(value, 'base64'));
  const mimeType = detectMime(bytes);
  if (mimeType === null || bytes.byteLength > PROVIDER_LIMITS.maxImageOutputBytes) {
    throw protocolError(context, 'IMAGE_BYTES_INVALID');
  }
  return { bytes, mimeType };
}

export function decodeImagesGeneration(
  body: string,
  request: ImageGenerationRequest,
  context: ProviderCallContext,
  latencyMs: number,
  headerRequestId: string | null,
): ImageGenerationResult {
  const envelope = parseJsonEnvelope(body, context);
  if (!Array.isArray(envelope.data) || envelope.data.length === 0) {
    throw protocolError(context, 'IMAGE_DATA_MISSING');
  }
  if (envelope.data.length > PROVIDER_LIMITS.maxImageOutputCount) {
    throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', {
      causeCategory: 'PROTOCOL',
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      providerId: context.providerId,
      requestId: context.requestId,
      retryDisposition: 'RETRY_MANUAL',
    });
  }
  const images: GeneratedImage[] = [];
  let totalBytes = 0;
  for (const value of envelope.data) {
    const item = asRecord(value);
    if (item === null || typeof item.b64_json !== 'string') {
      if (typeof item?.url === 'string') {
        throw new ProviderError('PROVIDER_UNSUPPORTED_OUTPUT_VARIANT', {
          causeCategory: 'PROTOCOL',
          modelId: context.modelId,
          operation: context.operation,
          outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
          providerId: context.providerId,
          requestId: context.requestId,
          retryDisposition: 'RETRY_MANUAL',
        });
      }
      throw protocolError(context, 'IMAGE_OUTPUT_INVALID');
    }
    const decoded = decodeBase64(item.b64_json, context);
    totalBytes += decoded.bytes.byteLength;
    if (totalBytes > PROVIDER_LIMITS.maxImageOutputTotalBytes) {
      throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', {
        causeCategory: 'PROTOCOL',
        modelId: context.modelId,
        operation: context.operation,
        outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
        providerId: context.providerId,
        requestId: context.requestId,
        retryDisposition: 'RETRY_MANUAL',
      });
    }
    images.push(
      Object.freeze({
        bytes: decoded.bytes,
        height:
          Number.isSafeInteger(item.height) && (item.height as number) > 0
            ? (item.height as number)
            : null,
        mimeType: decoded.mimeType,
        revisedPrompt:
          request.exposeRevisedPrompt === true && typeof item.revised_prompt === 'string'
            ? item.revised_prompt.slice(0, 20_000)
            : null,
        width:
          Number.isSafeInteger(item.width) && (item.width as number) > 0
            ? (item.width as number)
            : null,
      }),
    );
  }
  const usage = applyUsageCapability(
    parseProviderUsage(envelope.usage, 'IMAGES_GENERATIONS', context),
    context.capabilities.usage,
  );
  return Object.freeze({
    images: Object.freeze(images),
    latencyMs,
    modelId: context.modelId,
    protocolMode: 'IMAGES_GENERATIONS',
    providerRequestId: safeProviderRequestId(envelope.id, headerRequestId),
    usage,
    warnings: usage.warnings,
  });
}
