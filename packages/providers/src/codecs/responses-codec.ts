import {
  type JsonObject,
  type ProviderCallContext,
  type RuntimeSchema,
  type TextGenerationRequest,
  type TextGenerationResult,
  type VisionGenerationRequest,
} from '../contracts.js';
import { ProviderError } from '../errors.js';
import { PROVIDER_LIMITS } from '../response-limits.js';
import { applyUsageCapability, parseProviderUsage } from '../usage.js';
import {
  asRecord,
  mergeWarnings,
  normalizeFinishReason,
  optionsToJson,
  parseJsonEnvelope,
  protocolError,
  safeProviderRequestId,
} from './codec-utils.js';

function role(value: string): string {
  return value.toLowerCase();
}

function textInput(request: TextGenerationRequest): readonly JsonObject[] {
  return request.messages.map((message) => ({
    content: message.content.map((part) => ({ text: part.text, type: 'input_text' })),
    role: role(message.role),
  }));
}

function visionInput(request: VisionGenerationRequest): readonly JsonObject[] {
  return request.messages.map((message) => ({
    content: message.content.map((part) =>
      part.type === 'TEXT'
        ? { text: part.text, type: 'input_text' }
        : {
            detail: part.detail?.toLowerCase() ?? 'auto',
            image_url: `data:${part.mimeType};base64,${Buffer.from(part.bytes).toString('base64')}`,
            type: 'input_image',
          },
    ),
    role: role(message.role),
  }));
}

export function encodeResponsesText(
  request: TextGenerationRequest,
  context: ProviderCallContext,
  schema?: RuntimeSchema<unknown>,
): JsonObject {
  const body: Record<string, JsonObject[keyof JsonObject]> = {
    input: textInput(request),
    model: context.modelId,
    stream: false,
    ...optionsToJson(request.options, 'RESPONSES'),
  };
  if (schema !== undefined) {
    body.text = {
      format: {
        name: `${schema.id}_v${schema.version}`,
        schema: schema.jsonSchema,
        strict: true,
        type: 'json_schema',
      },
    };
  }
  return body;
}

export function encodeResponsesVision(
  request: VisionGenerationRequest,
  context: ProviderCallContext,
): JsonObject {
  return {
    input: visionInput(request),
    model: context.modelId,
    ...optionsToJson(request.options, 'RESPONSES'),
  };
}

export function decodeResponsesText(
  body: string,
  context: ProviderCallContext,
  latencyMs: number,
  headerRequestId: string | null,
): TextGenerationResult {
  const envelope = parseJsonEnvelope(body, context);
  const output = Array.isArray(envelope.output) ? envelope.output : [];
  const textParts: string[] = [];
  let refused = false;
  for (const item of output) {
    const record = asRecord(item);
    if (record?.type !== 'message' || !Array.isArray(record.content)) {
      continue;
    }
    for (const content of record.content) {
      const part = asRecord(content);
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        textParts.push(part.text);
      } else if (part?.type === 'refusal') {
        refused = true;
      }
    }
  }
  if (textParts.length === 0 && !refused) {
    throw protocolError(context, 'TEXT_OUTPUT_MISSING');
  }
  const text = textParts.join('');
  if (text.length > PROVIDER_LIMITS.maxOutputCharacters) {
    throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', {
      causeCategory: 'PROTOCOL',
      details: { characterCount: text.length },
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      providerId: context.providerId,
      requestId: context.requestId,
      retryDisposition: 'RETRY_MANUAL',
    });
  }
  const incomplete = asRecord(envelope.incomplete_details);
  const finish = normalizeFinishReason(
    envelope.status === 'incomplete' ? (incomplete?.reason ?? 'incomplete') : envelope.status,
  );
  const usage = applyUsageCapability(
    parseProviderUsage(envelope.usage, 'RESPONSES', context),
    context.capabilities.usage,
  );
  return Object.freeze({
    finishReason: finish.finishReason,
    latencyMs,
    modelId: context.modelId,
    outputTruncated: finish.outputTruncated,
    protocolMode: 'RESPONSES',
    providerRequestId: safeProviderRequestId(envelope.id, headerRequestId),
    refusal: refused ? Object.freeze({ reason: 'PROVIDER_REFUSAL' as const }) : null,
    text,
    usage,
    warnings: mergeWarnings(finish.warnings, usage.warnings),
  });
}
