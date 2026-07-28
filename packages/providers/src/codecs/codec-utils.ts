import { createHash } from 'node:crypto';

import {
  type FinishReason,
  type JsonObject,
  type ProviderCallContext,
  type ProviderWarningCode,
} from '../contracts.js';
import { ProviderError } from '../errors.js';

export function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

export function parseJsonEnvelope(
  body: string,
  context: ProviderCallContext,
): Readonly<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body) as unknown;
  } catch {
    throw new ProviderError('PROVIDER_INVALID_JSON', {
      causeCategory: 'PROTOCOL',
      details: {
        characterCount: body.length,
        contentHash: createHash('sha256').update(body, 'utf8').digest('hex'),
      },
      modelId: context.modelId,
      operation: context.operation,
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      providerId: context.providerId,
      requestId: context.requestId,
      retryDisposition: 'RETRY_MANUAL',
    });
  }
  const record = asRecord(parsed);
  if (record === null) {
    throw protocolError(context, 'RESPONSE_ENVELOPE_INVALID');
  }
  return record;
}

export function protocolError(context: ProviderCallContext, reason: string): ProviderError {
  return new ProviderError('PROVIDER_PROTOCOL_ERROR', {
    causeCategory: 'PROTOCOL',
    details: { reason },
    modelId: context.modelId,
    operation: context.operation,
    outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
    providerId: context.providerId,
    requestId: context.requestId,
    retryDisposition: 'RETRY_MANUAL',
  });
}

export function safeProviderRequestId(
  envelopeValue: unknown,
  headerValue: string | null,
): string | null {
  for (const value of [envelopeValue, headerValue]) {
    if (typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/u.test(value)) {
      return value;
    }
  }
  return null;
}

export function normalizeFinishReason(value: unknown): {
  readonly finishReason: FinishReason;
  readonly outputTruncated: boolean;
  readonly warnings: readonly ProviderWarningCode[];
} {
  switch (value) {
    case 'stop':
    case 'completed':
      return { finishReason: 'STOP', outputTruncated: false, warnings: [] };
    case 'length':
    case 'max_output_tokens':
      return {
        finishReason: 'LENGTH',
        outputTruncated: true,
        warnings: ['OUTPUT_TRUNCATED'],
      };
    case 'content_filter':
      return { finishReason: 'CONTENT_FILTER', outputTruncated: false, warnings: [] };
    case 'tool_calls':
    case 'function_call':
      return { finishReason: 'TOOL_CALL', outputTruncated: false, warnings: [] };
    case 'incomplete':
      return { finishReason: 'INCOMPLETE', outputTruncated: false, warnings: [] };
    default:
      return {
        finishReason: 'UNKNOWN',
        outputTruncated: false,
        warnings: ['FINISH_REASON_UNKNOWN'],
      };
  }
}

export function optionsToJson(
  options:
    | {
        readonly maxOutputTokens?: number;
        readonly stopSequences?: readonly string[];
        readonly temperature?: number;
        readonly topP?: number;
      }
    | undefined,
  dialect: 'CHAT_COMPLETIONS' | 'RESPONSES',
): JsonObject {
  if (options === undefined) {
    return {};
  }
  const result: Record<string, number | readonly string[]> = {};
  if (options.maxOutputTokens !== undefined) {
    result[dialect === 'RESPONSES' ? 'max_output_tokens' : 'max_completion_tokens'] =
      options.maxOutputTokens;
  }
  if (options.temperature !== undefined) {
    result.temperature = options.temperature;
  }
  if (options.topP !== undefined) {
    result.top_p = options.topP;
  }
  if (options.stopSequences !== undefined) {
    result.stop = options.stopSequences;
  }
  return result;
}

export function mergeWarnings(
  ...groups: readonly (readonly ProviderWarningCode[])[]
): readonly ProviderWarningCode[] {
  return Object.freeze([...new Set(groups.flat())]);
}
