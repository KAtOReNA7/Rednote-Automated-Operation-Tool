import { randomBytes } from 'node:crypto';

import {
  isProviderError,
  type OutcomeCertainty,
  type ProviderError,
} from '@mystery-operations/providers';
import {
  MODEL_RESULT_CACHE_FORMAT,
  MODEL_RESULT_CACHE_FORMAT_VERSION,
  type ModelCacheOutputType,
  type ModelResultCacheEnvelope,
} from '@mystery-operations/storage';

import {
  calculateUserPriceTableCost,
  parseProviderCostObservation,
  type ModelPriceScheduleV1,
} from './accounting.js';
import { modelCacheKey } from './cache-key.js';
import { canonicalJson, canonicalSha256 } from './canonical.js';
import {
  MODEL_CACHE_POLICIES,
  emptyUsageObservation,
  type ModelCapability,
  type ModelExecutionOutputV1,
  type ModelExecutionRequestV1,
  type ModelExecutionResultV1,
  type ProviderCostObservationV1,
  type UsageObservationV1,
} from './types.js';

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_MODEL_OUTPUT_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_COUNT = 8;
const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MODEL_CAPABILITIES = new Set<ModelCapability>([
  'imageGeneration',
  'structuredJson',
  'text',
  'usage',
  'vision',
]);

export interface PersistedCacheEntryV1 {
  readonly cacheKey: string;
  readonly contentHash: string;
  readonly managedPath: string;
  readonly outputHash: string;
  readonly outputType: ModelCacheOutputType;
  readonly sizeBytes: number;
}

export interface ModelExecutionStartV1 {
  readonly priceSchedule: ModelPriceScheduleV1 | null;
  readonly reservationId: string;
}

export interface ModelExecutionPersistence {
  readonly acquireCacheWork?: (cacheKey: string) => 'ACQUIRED' | 'READY' | 'WAIT';
  readonly findExecution: (
    executionId: string,
  ) => { readonly cacheKey: string; readonly result: ModelExecutionResultV1 } | null;
  readonly findReadyCache: (cacheKey: string) => PersistedCacheEntryV1 | null;
  readonly finalizeFailure: (
    request: ModelExecutionRequestV1,
    cacheKey: string,
    result: ModelExecutionResultV1,
  ) => void;
  readonly finalizeSuccess: (
    request: ModelExecutionRequestV1,
    cacheKey: string,
    result: ModelExecutionResultV1,
    cache: PersistedCacheEntryV1 | null,
    reservationId: string,
  ) => void;
  readonly markCacheCorrupt: (cacheKey: string) => void;
  readonly recordCacheHit: (
    request: ModelExecutionRequestV1,
    cacheKey: string,
    output: ModelExecutionOutputV1,
  ) => ModelExecutionResultV1;
  readonly reserveAndStart: (
    request: ModelExecutionRequestV1,
    cacheKey: string,
  ) => ModelExecutionStartV1;
}

export interface ModelExecutionCache {
  readonly read: (
    entry: PersistedCacheEntryV1,
  ) => Promise<ModelResultCacheEnvelope<ModelExecutionOutputV1>>;
  readonly write: (envelope: ModelResultCacheEnvelope<ModelExecutionOutputV1>) => Promise<{
    readonly contentHash: string;
    readonly managedPath: string;
    readonly sizeBytes: number;
  }>;
}

export interface ProviderExecutionObservationV1 {
  readonly cost: ProviderCostObservationV1 | null;
  readonly outcomeCertainty: OutcomeCertainty;
  readonly output: ModelExecutionOutputV1;
  readonly usage: UsageObservationV1;
}

export interface ModelExecutionServiceOptions {
  readonly assertCapability: (
    request: ModelExecutionRequestV1,
    capability: ModelCapability,
  ) => void;
  readonly cache: ModelExecutionCache;
  readonly maxConcurrentExternalRequests?: number;
  readonly now?: () => Date;
  readonly persistence: ModelExecutionPersistence;
  readonly providerInvoker: (
    request: ModelExecutionRequestV1,
    credential: string,
  ) => Promise<ProviderExecutionObservationV1>;
  readonly resolveCredential: () => Promise<string>;
}

function checkedIdentifier(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > MAX_IDENTIFIER_LENGTH ||
    value !== value.trim() ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new TypeError(`${field} is invalid.`);
  }
  return value;
}

function checkedCount(value: unknown, field: string, nullable = false): number | null {
  if (value === null && nullable) {
    return null;
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000) {
    throw new TypeError(`${field} is invalid.`);
  }
  return value as number;
}

function validateUsage(usage: UsageObservationV1): UsageObservationV1 {
  const keys = [
    'cacheWriteTokens',
    'cachedInputTokens',
    'imageGenerationCalls',
    'images',
    'inputTokens',
    'outputTokens',
    'reasoningTokens',
    'source',
    'toolCalls',
    'totalTokens',
    'webSearchCalls',
  ];
  if (Object.keys(usage).sort().join(',') !== keys.sort().join(',')) {
    throw new TypeError('Usage observation shape is invalid.');
  }
  for (const field of keys.filter((field) => field !== 'source')) {
    checkedCount(usage[field as keyof UsageObservationV1], field, true);
  }
  if (usage.source !== 'NOT_REPORTED' && usage.source !== 'PROVIDER') {
    throw new TypeError('Usage source is invalid.');
  }
  return Object.freeze({ ...usage });
}

function exactRequestKeys(request: ModelExecutionRequestV1): void {
  const allowed = new Set([
    'budgetClassification',
    'cachePolicy',
    'deadlineMs',
    'executionId',
    'generationOptions',
    'input',
    'jobId',
    'mediaIdentities',
    'modelId',
    'modelRole',
    'modelSlot',
    'outputSchemaIdentity',
    'parameterVersion',
    'promptIdentity',
    'protocolMode',
    'providerConfigFingerprint',
    'requiredCapabilities',
    'signal',
    'sourceIdentities',
    'taskKind',
    'unitDemandUpperBound',
  ]);
  if (Object.keys(request).some((key) => !allowed.has(key))) {
    throw new TypeError('ModelExecutionRequest contains unsupported fields.');
  }
}

export function validateModelExecutionRequest(
  request: ModelExecutionRequestV1,
): ModelExecutionRequestV1 {
  exactRequestKeys(request);
  for (const [field, value] of [
    ['executionId', request.executionId],
    ['modelId', request.modelId],
    ['modelRole', request.modelRole],
    ['modelSlot', request.modelSlot],
    ['taskKind', request.taskKind],
  ] as const) {
    checkedIdentifier(value, field);
  }
  const unitKeys = [
    'externalCalls',
    'imageGenerationCalls',
    'images',
    'inputTokens',
    'outputTokens',
    'toolCalls',
    'webSearchCalls',
  ];
  if (
    request.budgetClassification !== 'NONESSENTIAL' ||
    !MODEL_CACHE_POLICIES.includes(request.cachePolicy) ||
    !Number.isSafeInteger(request.deadlineMs) ||
    request.deadlineMs < 100 ||
    request.deadlineMs > 600_000 ||
    !Number.isSafeInteger(request.parameterVersion) ||
    request.parameterVersion < 1 ||
    request.requiredCapabilities.length < 1 ||
    request.requiredCapabilities.length > 8 ||
    !request.requiredCapabilities.every((capability) => MODEL_CAPABILITIES.has(capability)) ||
    new Set(request.requiredCapabilities).size !== request.requiredCapabilities.length ||
    request.sourceIdentities.length > 64 ||
    request.mediaIdentities.length > 64 ||
    Object.keys(request.unitDemandUpperBound).sort().join(',') !== unitKeys.sort().join(',') ||
    request.unitDemandUpperBound.externalCalls !== 1 ||
    (/^(?:CAPABILITY_PROBE|WEB_SEARCH|TOOL)(?:_|$)/u.test(request.taskKind) &&
      request.cachePolicy !== 'BYPASS')
  ) {
    throw new TypeError('ModelExecutionRequest is outside the finite contract.');
  }
  canonicalJson(request.input);
  canonicalJson(request.generationOptions);
  for (const field of unitKeys as (
    | 'externalCalls'
    | 'imageGenerationCalls'
    | 'images'
    | 'inputTokens'
    | 'outputTokens'
    | 'toolCalls'
    | 'webSearchCalls'
  )[]) {
    checkedCount(
      request.unitDemandUpperBound[field],
      `unitDemandUpperBound.${field}`,
      field === 'inputTokens' || field === 'outputTokens',
    );
  }
  return request;
}

function validateOutput(output: ModelExecutionOutputV1): ModelExecutionOutputV1 {
  if (output.partial !== false || output.refusal !== false) {
    throw new TypeError('Partial or refused output is not a valid completed result.');
  }
  if (output.type === 'TEXT' || output.type === 'VISION') {
    if (
      typeof output.text !== 'string' ||
      Buffer.byteLength(output.text, 'utf8') > MAX_MODEL_OUTPUT_TEXT_BYTES ||
      typeof output.finishReason !== 'string'
    ) {
      throw new TypeError('Text output is invalid.');
    }
  } else if (output.type === 'STRUCTURED') {
    canonicalJson(output.value);
  } else if (output.type === 'IMAGE') {
    if (output.images.length < 1 || output.images.length > MAX_IMAGE_COUNT) {
      throw new TypeError('Image output count is invalid.');
    }
    let bytes = 0;
    for (const image of output.images) {
      if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(image.base64)) {
        throw new TypeError('Image output encoding is invalid.');
      }
      bytes += Buffer.from(image.base64, 'base64').byteLength;
    }
    if (bytes > MAX_IMAGE_BYTES) {
      throw new TypeError('Image output is too large.');
    }
  } else {
    throw new TypeError('Model output type is invalid.');
  }
  return Object.freeze(output);
}

function failedResult(
  request: ModelExecutionRequestV1,
  status: ModelExecutionResultV1['status'],
  code: string,
  certainty: OutcomeCertainty,
  externalRequestCount: 0 | 1,
  usage = emptyUsageObservation(),
): ModelExecutionResultV1 {
  return Object.freeze({
    costAmountMicroUsd: null,
    costState:
      externalRequestCount === 0
        ? 'NOT_INCURRED'
        : certainty === 'MAY_HAVE_EXECUTED'
          ? 'UNKNOWN_POSSIBLY_INCURRED'
          : 'UNPRICED_USAGE',
    executionId: request.executionId,
    externalRequestCount,
    localCacheHit: false,
    outcomeCertainty: certainty,
    output: null,
    stableErrorCode: code,
    status,
    usage,
  });
}

function providerFailureResult(
  request: ModelExecutionRequestV1,
  error: unknown,
): ModelExecutionResultV1 {
  if (!isProviderError(error)) {
    return failedResult(request, 'AMBIGUOUS', 'MODEL_EXECUTION_INTERNAL', 'MAY_HAVE_EXECUTED', 1);
  }
  const providerError = error as ProviderError;
  const beforeSend =
    providerError.outcomeCertainty === 'NOT_SENT' ||
    providerError.outcomeCertainty === 'REJECTED_BEFORE_EXECUTION';
  const cancelled = providerError.code === 'PROVIDER_ABORTED';
  return failedResult(
    request,
    beforeSend
      ? cancelled
        ? 'CANCELLED_BEFORE_SEND'
        : 'FAILED_BEFORE_SEND'
      : providerError.outcomeCertainty === 'MAY_HAVE_EXECUTED'
        ? 'AMBIGUOUS'
        : cancelled
          ? 'CANCELLED_AFTER_SEND'
          : 'FAILED_AFTER_SEND',
    providerError.code,
    providerError.outcomeCertainty,
    beforeSend ? 0 : 1,
  );
}

export class ModelExecutionService {
  readonly #maxConcurrentExternalRequests: number;
  readonly #inflight = new Map<string, Promise<ModelExecutionResultV1>>();
  readonly #options: ModelExecutionServiceOptions;
  readonly #concurrencyWaiters: (() => void)[] = [];
  #activeExternalRequests = 0;

  public constructor(options: ModelExecutionServiceOptions) {
    this.#options = options;
    this.#maxConcurrentExternalRequests = options.maxConcurrentExternalRequests ?? 4;
    if (
      !Number.isSafeInteger(this.#maxConcurrentExternalRequests) ||
      this.#maxConcurrentExternalRequests < 1 ||
      this.#maxConcurrentExternalRequests > 32
    ) {
      throw new RangeError('maxConcurrentExternalRequests is outside the supported bound.');
    }
  }

  public async execute(requestValue: ModelExecutionRequestV1): Promise<ModelExecutionResultV1> {
    const request = validateModelExecutionRequest(requestValue);
    const cacheKey = modelCacheKey(request);
    const existing = this.#options.persistence.findExecution(request.executionId);
    if (existing !== null) {
      if (existing.cacheKey !== cacheKey) {
        throw new Error('MODEL_EXECUTION_IDEMPOTENCY_CONFLICT');
      }
      return existing.result;
    }

    if (request.cachePolicy === 'READ_WRITE' || request.cachePolicy === 'READ_ONLY') {
      const hit = await this.#readCache(request, cacheKey);
      if (hit !== null) {
        return hit;
      }
    }

    for (const capability of request.requiredCapabilities) {
      try {
        this.#options.assertCapability(request, capability);
      } catch {
        const result = failedResult(
          request,
          'CAPABILITY_BLOCKED',
          'CAPABILITY_BLOCKED',
          'NOT_SENT',
          0,
        );
        this.#options.persistence.finalizeFailure(request, cacheKey, result);
        return result;
      }
    }

    const waiting = this.#inflight.get(cacheKey);
    if (waiting !== undefined) {
      const ownerResult = await waiting;
      if (ownerResult.status === 'SUCCEEDED' && ownerResult.output !== null) {
        return this.#options.persistence.recordCacheHit(request, cacheKey, ownerResult.output);
      }
      return Object.freeze({ ...ownerResult, executionId: request.executionId });
    }

    if (request.cachePolicy === 'READ_WRITE' || request.cachePolicy === 'REFRESH') {
      const claim = this.#options.persistence.acquireCacheWork?.(cacheKey) ?? 'ACQUIRED';
      if (claim === 'READY') {
        const hit = await this.#readCache(request, cacheKey);
        if (hit !== null) return hit;
      } else if (claim === 'WAIT') {
        return failedResult(request, 'IN_FLIGHT', 'MODEL_EXECUTION_IN_FLIGHT', 'NOT_SENT', 0);
      }
    }

    const operation = this.#executeOwner(request, cacheKey);
    this.#inflight.set(cacheKey, operation);
    try {
      return await operation;
    } finally {
      if (this.#inflight.get(cacheKey) === operation) {
        this.#inflight.delete(cacheKey);
      }
    }
  }

  async #readCache(
    request: ModelExecutionRequestV1,
    cacheKey: string,
  ): Promise<ModelExecutionResultV1 | null> {
    const entry = this.#options.persistence.findReadyCache(cacheKey);
    if (entry === null) {
      return null;
    }
    try {
      const envelope = await this.#options.cache.read(entry);
      const output = validateOutput(envelope.output);
      if (canonicalSha256(output) !== entry.outputHash) {
        throw new Error('CACHE_OUTPUT_HASH_MISMATCH');
      }
      return this.#options.persistence.recordCacheHit(request, cacheKey, output);
    } catch {
      this.#options.persistence.markCacheCorrupt(cacheKey);
      const result = failedResult(request, 'CACHE_CORRUPT', 'CACHE_CORRUPT', 'NOT_SENT', 0);
      this.#options.persistence.finalizeFailure(request, cacheKey, result);
      return result;
    }
  }

  async #executeOwner(
    request: ModelExecutionRequestV1,
    cacheKey: string,
  ): Promise<ModelExecutionResultV1> {
    let start: ModelExecutionStartV1;
    try {
      start = this.#options.persistence.reserveAndStart(request, cacheKey);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'BUDGET_BLOCKED';
      const result = failedResult(request, 'BUDGET_BLOCKED', code, 'NOT_SENT', 0);
      this.#options.persistence.finalizeFailure(request, cacheKey, result);
      return result;
    }
    const releaseConcurrency = await this.#acquireConcurrency();
    try {
      if (request.signal?.aborted === true) {
        const result = failedResult(
          request,
          'CANCELLED_BEFORE_SEND',
          'PROVIDER_ABORTED',
          'NOT_SENT',
          0,
        );
        this.#options.persistence.finalizeFailure(request, cacheKey, result);
        return result;
      }
      let credential: string;
      try {
        credential = await this.#options.resolveCredential();
      } catch {
        const result = failedResult(
          request,
          'FAILED_BEFORE_SEND',
          'PROVIDER_CREDENTIAL_UNAVAILABLE',
          'NOT_SENT',
          0,
        );
        this.#options.persistence.finalizeFailure(request, cacheKey, result);
        return result;
      }
      let observation: ProviderExecutionObservationV1;
      try {
        observation = await this.#options.providerInvoker(request, credential);
        observation = {
          ...observation,
          output: validateOutput(observation.output),
          usage: validateUsage(observation.usage),
        };
      } catch (error) {
        const result = providerFailureResult(request, error);
        this.#options.persistence.finalizeFailure(request, cacheKey, result);
        return result;
      }

      const providerAmount = parseProviderCostObservation(observation.cost);
      const calculated =
        providerAmount === null && start.priceSchedule !== null
          ? calculateUserPriceTableCost(observation.usage, start.priceSchedule)
          : null;
      const result: ModelExecutionResultV1 = Object.freeze({
        costAmountMicroUsd: providerAmount ?? calculated?.amountMicroUsd ?? null,
        costState:
          providerAmount !== null
            ? 'PROVIDER_REPORTED_USD'
            : (calculated?.state ?? 'UNPRICED_USAGE'),
        executionId: request.executionId,
        externalRequestCount: 1,
        localCacheHit: false,
        outcomeCertainty: observation.outcomeCertainty,
        output: observation.output,
        stableErrorCode: null,
        status: 'SUCCEEDED',
        usage: observation.usage,
      });
      let cache: PersistedCacheEntryV1 | null = null;
      if (request.cachePolicy === 'READ_WRITE' || request.cachePolicy === 'REFRESH') {
        const outputHash = canonicalSha256(observation.output);
        const envelope: ModelResultCacheEnvelope<ModelExecutionOutputV1> = Object.freeze({
          createdAt: (this.#options.now ?? (() => new Date()))().toISOString(),
          format: MODEL_RESULT_CACHE_FORMAT,
          output: observation.output,
          outputContentHash: outputHash,
          outputType: observation.output.type,
          schemaIdentity: request.outputSchemaIdentity ?? null,
          version: MODEL_RESULT_CACHE_FORMAT_VERSION,
        });
        try {
          const file = await this.#options.cache.write(envelope);
          cache = {
            cacheKey,
            contentHash: file.contentHash,
            managedPath: file.managedPath,
            outputHash,
            outputType: observation.output.type,
            sizeBytes: file.sizeBytes,
          };
        } catch {
          cache = null;
        }
      }
      this.#options.persistence.finalizeSuccess(
        request,
        cacheKey,
        result,
        cache,
        start.reservationId,
      );
      return result;
    } finally {
      releaseConcurrency();
    }
  }

  async #acquireConcurrency(): Promise<() => void> {
    if (this.#activeExternalRequests >= this.#maxConcurrentExternalRequests) {
      await new Promise<void>((resolve) => {
        this.#concurrencyWaiters.push(resolve);
      });
    } else {
      this.#activeExternalRequests += 1;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.#concurrencyWaiters.shift();
      if (next === undefined) this.#activeExternalRequests -= 1;
      else next();
    };
  }
}

export function randomModelExecutionOwnerToken(): string {
  return randomBytes(32).toString('base64url');
}
