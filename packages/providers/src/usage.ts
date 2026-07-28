import { type ProviderWarningCode } from './contracts.js';
import { ProviderError } from './errors.js';

export interface ProviderUsage {
  readonly cachedInputTokens: number | null;
  readonly complete: boolean;
  readonly imageInputCount: number | null;
  readonly imageOutputCount: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly providerReported: boolean;
  readonly reasoningTokens: number | null;
  readonly totalTokens: number | null;
  readonly warnings: readonly ProviderWarningCode[];
}

export type UsageDialect = 'CHAT_COMPLETIONS' | 'IMAGES_GENERATIONS' | 'RESPONSES';

export interface UsageIdentity {
  readonly modelId: string;
  readonly operation: string;
  readonly providerId: string;
  readonly requestId: string;
}

export function emptyProviderUsage(): ProviderUsage {
  return Object.freeze({
    cachedInputTokens: null,
    complete: false,
    imageInputCount: null,
    imageOutputCount: null,
    inputTokens: null,
    outputTokens: null,
    providerReported: false,
    reasoningTokens: null,
    totalTokens: null,
    warnings: Object.freeze(['USAGE_NOT_REPORTED'] as const),
  });
}

export function applyUsageCapability(
  usage: ProviderUsage,
  capability: 'SUPPORTED' | 'UNKNOWN' | 'UNSUPPORTED',
): ProviderUsage {
  if (capability === 'SUPPORTED' || !usage.complete) {
    return usage;
  }
  return Object.freeze({
    ...usage,
    complete: false,
    warnings: Object.freeze([...new Set([...usage.warnings, 'USAGE_INCOMPLETE' as const])]),
  });
}

function objectValue(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : null;
}

function optionalCount(value: unknown, field: string, identity: UsageIdentity): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new ProviderError('PROVIDER_INVALID_USAGE', {
      causeCategory: 'PROTOCOL',
      details: { field },
      modelId: identity.modelId,
      operation: identity.operation,
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      providerId: identity.providerId,
      requestId: identity.requestId,
      retryDisposition: 'RETRY_MANUAL',
    });
  }
  return value as number;
}

export function parseProviderUsage(
  value: unknown,
  dialect: UsageDialect,
  identity: UsageIdentity,
): ProviderUsage {
  if (value === undefined || value === null) {
    return emptyProviderUsage();
  }
  const usage = objectValue(value);
  if (usage === null) {
    throw new ProviderError('PROVIDER_INVALID_USAGE', {
      causeCategory: 'PROTOCOL',
      modelId: identity.modelId,
      operation: identity.operation,
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
      providerId: identity.providerId,
      requestId: identity.requestId,
      retryDisposition: 'RETRY_MANUAL',
    });
  }
  const inputDetails = objectValue(usage.input_tokens_details);
  const outputDetails = objectValue(usage.output_tokens_details);
  const inputTokens = optionalCount(
    dialect === 'CHAT_COMPLETIONS' ? usage.prompt_tokens : usage.input_tokens,
    'inputTokens',
    identity,
  );
  const outputTokens = optionalCount(
    dialect === 'CHAT_COMPLETIONS' ? usage.completion_tokens : usage.output_tokens,
    'outputTokens',
    identity,
  );
  const totalTokens = optionalCount(usage.total_tokens, 'totalTokens', identity);
  const cachedInputTokens = optionalCount(
    dialect === 'CHAT_COMPLETIONS'
      ? objectValue(usage.prompt_tokens_details)?.cached_tokens
      : inputDetails?.cached_tokens,
    'cachedInputTokens',
    identity,
  );
  const reasoningTokens = optionalCount(
    dialect === 'CHAT_COMPLETIONS'
      ? objectValue(usage.completion_tokens_details)?.reasoning_tokens
      : outputDetails?.reasoning_tokens,
    'reasoningTokens',
    identity,
  );
  const imageInputCount = optionalCount(usage.image_input_count, 'imageInputCount', identity);
  const imageOutputCount = optionalCount(usage.image_output_count, 'imageOutputCount', identity);
  const warnings: ProviderWarningCode[] = [];
  if (
    totalTokens !== null &&
    inputTokens !== null &&
    outputTokens !== null &&
    inputTokens + outputTokens !== totalTokens
  ) {
    warnings.push('USAGE_TOTAL_CONFLICT');
  }
  const complete =
    inputTokens !== null &&
    outputTokens !== null &&
    totalTokens !== null &&
    !warnings.includes('USAGE_TOTAL_CONFLICT');
  if (!complete) {
    warnings.push('USAGE_INCOMPLETE');
  }
  return Object.freeze({
    cachedInputTokens,
    complete,
    imageInputCount,
    imageOutputCount,
    inputTokens,
    outputTokens,
    providerReported: true,
    reasoningTokens,
    totalTokens,
    warnings: Object.freeze(warnings),
  });
}
