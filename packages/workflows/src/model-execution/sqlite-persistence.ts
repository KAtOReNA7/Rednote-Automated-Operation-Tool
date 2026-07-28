import type {
  ModelPriceScheduleRecord,
  ModelRunIdentityInput,
  SqliteModelAccountingRepository,
} from '@mystery-operations/db';
import type { ModelResultCacheStore } from '@mystery-operations/storage';

import {
  assertDemandCoveredByUnitPolicy,
  calculateUserPriceTableCost,
  utcBillingMonth,
  utcWeekKey,
  validatePriceSchedule,
  type ModelPriceScheduleV1,
} from './accounting.js';
import { canonicalSha256 } from './canonical.js';
import {
  randomModelExecutionOwnerToken,
  type ModelExecutionCache,
  type ModelExecutionPersistence,
  type PersistedCacheEntryV1,
} from './service.js';
import {
  emptyUsageObservation,
  type ModelExecutionOutputV1,
  type ModelExecutionRequestV1,
  type ModelExecutionResultV1,
  type UsageObservationV1,
} from './types.js';

function scheduleValue(record: ModelPriceScheduleRecord): ModelPriceScheduleV1 {
  return {
    cachedInputPerMillionUsd: record.cachedInputPerMillionUsd,
    cacheWritePerMillionUsd: record.cacheWritePerMillionUsd,
    callUsd: record.callUsd,
    currency: 'USD',
    imageGenerationCallUsd: record.imageGenerationCallUsd,
    imageUsd: record.imageUsd,
    inputPerMillionUsd: record.inputPerMillionUsd,
    inputTokensIncludeCachedInput: record.inputTokensIncludeCachedInput,
    operationKind: record.operationKind,
    outputPerMillionUsd: record.outputPerMillionUsd,
    protocolMode: record.protocolMode,
    providerConfigFingerprint: record.providerConfigFingerprint,
    searchCallUsd: record.searchCallUsd,
    toolUnitUsd: record.toolUnitUsd,
    usageSemanticsVersion: record.usageSemanticsVersion,
    version: record.version,
  };
}

function identity(request: ModelExecutionRequestV1, cacheKey: string): ModelRunIdentityInput {
  return {
    cacheKey,
    cachePolicy: request.cachePolicy,
    executionId: request.executionId,
    inputHash: canonicalSha256(request.input),
    jobId: request.jobId ?? null,
    modelId: request.modelId,
    modelRole: request.modelRole,
    modelSlot: request.modelSlot,
    promptContentHash: request.promptIdentity.contentHash,
    promptTemplateId: request.promptIdentity.id,
    promptVersion: request.promptIdentity.version,
    protocolMode: request.protocolMode,
    providerConfigFingerprint: request.providerConfigFingerprint,
    taskKind: request.taskKind,
  };
}

function resultFromRun(run: ReturnType<SqliteModelAccountingRepository['getRunByExecutionId']>) {
  if (run === null) return null;
  const status: ModelExecutionResultV1['status'] =
    run.status === 'IN_FLIGHT'
      ? 'IN_FLIGHT'
      : run.status === 'CACHE_HIT'
        ? 'CACHE_HIT'
        : run.status === 'SUCCEEDED'
          ? 'SUCCEEDED'
          : run.status === 'BUDGET_BLOCKED'
            ? 'BUDGET_BLOCKED'
            : run.status === 'CAPABILITY_BLOCKED'
              ? 'CAPABILITY_BLOCKED'
              : run.status === 'CORRUPT'
                ? 'CACHE_CORRUPT'
                : run.status === 'AMBIGUOUS'
                  ? 'AMBIGUOUS'
                  : run.status === 'CANCELLED'
                    ? run.externalRequestCount === 0
                      ? 'CANCELLED_BEFORE_SEND'
                      : 'CANCELLED_AFTER_SEND'
                    : run.externalRequestCount === 0
                      ? 'FAILED_BEFORE_SEND'
                      : 'FAILED_AFTER_SEND';
  return Object.freeze({
    costAmountMicroUsd: run.costAmountMicroUsd,
    costState: run.costState,
    executionId: run.executionId,
    externalRequestCount: run.externalRequestCount === 0 ? 0 : 1,
    localCacheHit: run.localCacheHit,
    outcomeCertainty: run.outcomeCertainty,
    output: null,
    stableErrorCode: run.stableErrorCode,
    status,
    usage: Object.freeze({ ...run.usage, source: 'NOT_REPORTED' as const }),
  }) satisfies ModelExecutionResultV1;
}

export class SqliteModelExecutionPersistence implements ModelExecutionPersistence {
  readonly #now: () => Date;
  readonly #ownerTokens = new Map<string, string>();
  readonly #repository: SqliteModelAccountingRepository;

  public constructor(
    repository: SqliteModelAccountingRepository,
    now: () => Date = () => new Date(),
  ) {
    this.#repository = repository;
    this.#now = now;
  }

  public findExecution(executionId: string) {
    const run = this.#repository.getRunByExecutionId(executionId);
    const result = resultFromRun(run);
    return run === null || result === null ? null : { cacheKey: run.cacheKey, result };
  }

  public acquireCacheWork(cacheKey: string): 'ACQUIRED' | 'READY' | 'WAIT' {
    const now = this.#now();
    const ownerToken = randomModelExecutionOwnerToken();
    const result = this.#repository.acquireCacheLease({
      cacheKey,
      expiresAt: new Date(now.getTime() + 30_000).toISOString(),
      now: now.toISOString(),
      ownerToken,
    });
    if (result === 'ACQUIRED') this.#ownerTokens.set(cacheKey, ownerToken);
    return result;
  }

  public findReadyCache(cacheKey: string): PersistedCacheEntryV1 | null {
    const record = this.#repository.getReadyCache(cacheKey);
    return record === null
      ? null
      : {
          cacheKey,
          contentHash: record.contentHash,
          managedPath: record.managedPath,
          outputHash: record.outputHash,
          outputType: record.outputType,
          sizeBytes: record.sizeBytes,
        };
  }

  public markCacheCorrupt(cacheKey: string): void {
    this.#repository.markCacheCorrupt(cacheKey, this.#now().toISOString());
  }

  public reserveAndStart(request: ModelExecutionRequestV1, cacheKey: string) {
    const now = this.#now();
    const stored = this.#repository.getActivePriceSchedule(
      request.providerConfigFingerprint,
      request.modelId,
      request.taskKind,
      request.protocolMode,
    );
    const priceSchedule = stored === null ? null : scheduleValue(stored);
    if (priceSchedule !== null) validatePriceSchedule(priceSchedule);
    const upperUsage: UsageObservationV1 = {
      cacheWriteTokens: null,
      cachedInputTokens: null,
      imageGenerationCalls: request.unitDemandUpperBound.imageGenerationCalls,
      images: request.unitDemandUpperBound.images,
      inputTokens: request.unitDemandUpperBound.inputTokens,
      outputTokens: request.unitDemandUpperBound.outputTokens,
      reasoningTokens: null,
      source: 'NOT_REPORTED',
      toolCalls: request.unitDemandUpperBound.toolCalls,
      totalTokens: null,
      webSearchCalls: request.unitDemandUpperBound.webSearchCalls,
    };
    const estimated =
      priceSchedule === null ? null : calculateUserPriceTableCost(upperUsage, priceSchedule);
    if (estimated?.amountMicroUsd === null || estimated === null) {
      const policy = this.#repository.findApplicableUnitPolicy(request.taskKind, request.modelRole);
      assertDemandCoveredByUnitPolicy(
        request.unitDemandUpperBound,
        policy === null
          ? null
          : {
              maxExternalCallsMonthly: policy.maxExternalCallsMonthly,
              maxExternalCallsWeekly: policy.maxExternalCallsWeekly,
              maxImageGenerationCalls: policy.maxImageGenerationCalls,
              maxImages: policy.maxImages,
              maxInputTokens: policy.maxInputTokens,
              maxOutputTokens: policy.maxOutputTokens,
              maxToolCalls: policy.maxToolCalls,
              maxWebSearchCalls: policy.maxWebSearchCalls,
            },
      );
    }
    const started = this.#repository.reserveAndCreateRun({
      billingMonth: utcBillingMonth(now),
      identity: identity(request, cacheKey),
      now: now.toISOString(),
      reservedAmountMicroUsd: estimated?.amountMicroUsd ?? null,
      unitDemandJson: JSON.stringify(request.unitDemandUpperBound),
      weekKey: utcWeekKey(now),
    });
    return { priceSchedule, reservationId: started.reservationId };
  }

  public recordCacheHit(
    request: ModelExecutionRequestV1,
    cacheKey: string,
    output: ModelExecutionOutputV1,
  ): ModelExecutionResultV1 {
    const entry = this.#repository.getReadyCache(cacheKey);
    if (entry === null) throw new Error('CACHE_ENTRY_NOT_READY');
    const run = this.#repository.createTerminalRun({
      cacheEntryId: entry.id,
      identity: identity(request, cacheKey),
      localCacheHit: true,
      now: this.#now().toISOString(),
      outputHash: entry.outputHash,
      status: 'CACHE_HIT',
    });
    return Object.freeze({
      costAmountMicroUsd: null,
      costState: 'NOT_INCURRED',
      executionId: run.executionId,
      externalRequestCount: 0,
      localCacheHit: true,
      outcomeCertainty: 'NOT_SENT',
      output,
      stableErrorCode: null,
      status: 'CACHE_HIT',
      usage: emptyUsageObservation(),
    });
  }

  public finalizeFailure(
    request: ModelExecutionRequestV1,
    cacheKey: string,
    result: ModelExecutionResultV1,
  ): void {
    const current = this.#repository.getRunByExecutionId(request.executionId);
    if (current === null) {
      this.#repository.createTerminalRun({
        identity: identity(request, cacheKey),
        now: this.#now().toISOString(),
        stableErrorCode: result.stableErrorCode ?? result.status,
        status:
          result.status === 'BUDGET_BLOCKED'
            ? 'BUDGET_BLOCKED'
            : result.status === 'CAPABILITY_BLOCKED'
              ? 'CAPABILITY_BLOCKED'
              : 'CORRUPT',
      });
    } else if (result.externalRequestCount === 0) {
      this.#repository.releaseBeforeSend(
        request.executionId,
        result.status.startsWith('CANCELLED') ? 'CANCELLED' : 'FAILED',
        result.stableErrorCode ?? result.status,
        this.#now().toISOString(),
      );
    } else {
      this.#repository.settle({
        cache: null,
        comparisonEstimateMicroUsd: null,
        costAmountMicroUsd: null,
        costSource: 'UNKNOWN',
        costState:
          result.costState === 'UNKNOWN_POSSIBLY_INCURRED'
            ? 'UNKNOWN_POSSIBLY_INCURRED'
            : 'UNPRICED_USAGE',
        executionId: request.executionId,
        now: this.#now().toISOString(),
        outcomeCertainty: result.outcomeCertainty,
        priceSchedule: null,
        status: result.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'FAILED',
        usage: result.usage,
      });
    }
    this.#releaseCacheWork(
      cacheKey,
      result.outcomeCertainty === 'MAY_HAVE_EXECUTED' ? 'AMBIGUOUS' : 'EVICTED',
    );
  }

  public finalizeSuccess(
    request: ModelExecutionRequestV1,
    cacheKey: string,
    result: ModelExecutionResultV1,
    cache: PersistedCacheEntryV1 | null,
    reservationId: string,
  ): void {
    void reservationId;
    const ownerToken = this.#ownerTokens.get(cacheKey);
    const cacheWithOwner =
      cache === null
        ? null
        : {
            ...cache,
            ownerToken:
              ownerToken ??
              (() => {
                throw new Error('MODEL_CACHE_LEASE_LOST');
              })(),
          };
    const stored = this.#repository.getActivePriceSchedule(
      request.providerConfigFingerprint,
      request.modelId,
      request.taskKind,
      request.protocolMode,
    );
    this.#repository.settle({
      cache: cacheWithOwner,
      comparisonEstimateMicroUsd: null,
      costAmountMicroUsd: result.costAmountMicroUsd,
      costSource:
        result.costState === 'PROVIDER_REPORTED_USD'
          ? 'PROVIDER_REPORTED'
          : result.costState === 'USER_PRICE_TABLE_ESTIMATE'
            ? 'USER_PRICE_TABLE'
            : 'NO_PRICE',
      costState: result.costState === 'NOT_INCURRED' ? 'UNPRICED_USAGE' : result.costState,
      executionId: request.executionId,
      now: this.#now().toISOString(),
      outcomeCertainty: result.outcomeCertainty,
      priceSchedule: stored,
      status: 'SUCCEEDED',
      usage: result.usage,
    });
    if (cache === null)
      this.#releaseCacheWork(request.cachePolicy === 'BYPASS' ? '' : cacheKey, 'EVICTED');
    else this.#ownerTokens.delete(cacheKey);
  }

  #releaseCacheWork(cacheKey: string, status: 'AMBIGUOUS' | 'EVICTED'): void {
    const ownerToken = this.#ownerTokens.get(cacheKey);
    if (ownerToken === undefined || cacheKey.length === 0) return;
    this.#repository.releaseCacheLease({
      cacheKey,
      now: this.#now().toISOString(),
      ownerToken,
      status,
    });
    this.#ownerTokens.delete(cacheKey);
  }
}

export class LocalModelExecutionCache implements ModelExecutionCache {
  readonly #store: ModelResultCacheStore;

  public constructor(store: ModelResultCacheStore) {
    this.#store = store;
  }

  public read(entry: PersistedCacheEntryV1) {
    return this.#store.read(entry.managedPath, {
      expectedFileHash: entry.contentHash,
      expectedOutputHash: entry.outputHash,
      expectedOutputType: entry.outputType,
      expectedSizeBytes: entry.sizeBytes,
      parseOutput: (value) => value as ModelExecutionOutputV1,
    });
  }

  public async write(envelope: Parameters<ModelExecutionCache['write']>[0]) {
    const file = await this.#store.write(envelope);
    return {
      contentHash: file.sha256,
      managedPath: file.managedPath,
      sizeBytes: file.sizeBytes,
    };
  }
}
