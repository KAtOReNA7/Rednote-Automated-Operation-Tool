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

function chatTextMessages(request: TextGenerationRequest): readonly JsonObject[] {
  return request.messages.map((message) => ({
    content: message.content.map((part) => ({ text: part.text, type: 'text' })),
    role: role(message.role),
  }));
}

function chatVisionMessages(request: VisionGenerationRequest): readonly JsonObject[] {
  return request.messages.map((message) => ({
    content: message.content.map((part) =>
      part.type === 'TEXT'
        ? { text: part.text, type: 'text' }
        : {
            image_url: {
              detail: part.detail?.toLowerCase() ?? 'auto',
              url: `data:${part.mimeType};base64,${Buffer.from(part.bytes).toString('base64')}`,
            },
            type: 'image_url',
          },
    ),
    role: role(message.role),
  }));
}

export function encodeChatCompletionsText(
  request: TextGenerationRequest,
  context: ProviderCallContext,
  schema?: RuntimeSchema<unknown>,
): JsonObject {
  const body: Record<string, JsonObject[keyof JsonObject]> = {
    messages: chatTextMessages(request),
    model: context.modelId,
    stream: false,
    ...optionsToJson(request.options, 'CHAT_COMPLETIONS'),
  };
  if (schema !== undefined) {
    body.response_format = {
      json_schema: {
        name: `${schema.id}_v${schema.version}`,
        schema: schema.jsonSchema,
        strict: true,
      },
      type: 'json_schema',
    };
  }
  return body;
}

export function encodeChatCompletionsVision(
  request: VisionGenerationRequest,
  context: ProviderCallContext,
): JsonObject {
  return {
    messages: chatVisionMessages(request),
    model: context.modelId,
    ...optionsToJson(request.options, 'CHAT_COMPLETIONS'),
  };
}

export function decodeChatCompletionsText(
  body: string,
  context: ProviderCallContext,
  latencyMs: number,
  headerRequestId: string | null,
): TextGenerationResult {
  const envelope = parseJsonEnvelope(body, context);
  const choices = Array.isArray(envelope.choices) ? envelope.choices : [];
  const first = asRecord(choices[0]);
  const message = asRecord(first?.message);
  const content = message?.content;
  const refusal = message?.refusal;
  if (typeof content !== 'string' && typeof refusal !== 'string') {
    throw protocolError(context, 'TEXT_OUTPUT_MISSING');
  }
  if (typeof content === 'string' && content.length > PROVIDER_LIMITS.maxOutputCharacters) {
    throw new ProviderError('PROVIDER_RESPONSE_TOO_LARGE', {
      causeCategory: 'PROTOCOL',
      details: { characterCount: content.length },
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      providerId: context.providerId,
      requestId: context.requestId,
      retryDisposition: 'RETRY_MANUAL',
    });
  }
  const finish = normalizeFinishReason(first?.finish_reason);
  const usage = applyUsageCapability(
    parseProviderUsage(envelope.usage, 'CHAT_COMPLETIONS', context),
    context.capabilities.usage,
  );
  return Object.freeze({
    finishReason: finish.finishReason,
    latencyMs,
    modelId: context.modelId,
    outputTruncated: finish.outputTruncated,
    protocolMode: 'CHAT_COMPLETIONS',
    providerRequestId: safeProviderRequestId(envelope.id, headerRequestId),
    refusal:
      typeof refusal === 'string' ? Object.freeze({ reason: 'PROVIDER_REFUSAL' as const }) : null,
    text: typeof content === 'string' ? content : '',
    usage,
    warnings: mergeWarnings(finish.warnings, usage.warnings),
  });
}
