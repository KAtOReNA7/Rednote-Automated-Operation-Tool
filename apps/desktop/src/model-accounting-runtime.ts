import { randomBytes } from 'node:crypto';

import type { SqliteModelAccountingRepository } from '@mystery-operations/db';
import type {
  ConfirmModelCacheClearInput,
  ConfirmModelCacheClearResult,
  CreateModelPriceScheduleInput,
  CreateModelUnitPolicyInput,
  ModelAccountingView,
  ModelCacheClearPreview,
  ModelPriceScheduleView,
  ModelUnitPolicyView,
} from '@mystery-operations/shared';
import { StorageError } from '@mystery-operations/shared/storage';
import type { ModelResultCacheStore } from '@mystery-operations/storage';
import { parseDecimalRational, utcBillingMonth } from '@mystery-operations/workflows';

const PREVIEW_TTL_MS = 5 * 60_000;
const CACHE_DELETE_BATCH = 100;
const MAX_POLICY_UNITS = 1_000_000_000;

export type ModelAccountingErrorCode =
  | 'MODEL_ACCOUNTING_INVALID_REQUEST'
  | 'MODEL_ACCOUNTING_STALE'
  | 'MODEL_CACHE_CLEAR_INVALID'
  | 'MODEL_CACHE_CLEAR_STALE';

export class ModelAccountingError extends Error {
  public readonly code: ModelAccountingErrorCode;
  public readonly retryable = false;

  public constructor(code: ModelAccountingErrorCode) {
    super(code);
    this.name = 'ModelAccountingError';
    this.code = code;
  }
}

interface ClearLease {
  readonly bytes: number;
  readonly count: number;
  readonly expiresAtMs: number;
  readonly senderId: number;
  readonly windowId: number;
}

function priceView(value: ReturnType<SqliteModelAccountingRepository['createPriceSchedule']>) {
  return Object.freeze({
    id: value.id,
    modelId: value.modelId,
    operationKind: value.operationKind,
    protocolMode: value.protocolMode,
    status: value.status,
    version: value.version,
  }) satisfies ModelPriceScheduleView;
}

function policyView(value: ReturnType<SqliteModelAccountingRepository['createUnitPolicy']>) {
  return Object.freeze({
    id: value.id,
    maxExternalCallsMonthly: value.maxExternalCallsMonthly,
    maxExternalCallsWeekly: value.maxExternalCallsWeekly,
    scopeKind: value.scopeKind,
    scopeValue: value.scopeValue,
    status: value.status,
    version: value.version,
  }) satisfies ModelUnitPolicyView;
}

function assertNullableDecimal(value: string | null): void {
  if (value !== null) parseDecimalRational(value);
}

function assertUnit(value: number | null): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > MAX_POLICY_UNITS)) {
    throw new ModelAccountingError('MODEL_ACCOUNTING_INVALID_REQUEST');
  }
}

export class DesktopModelAccountingRuntime {
  readonly #cache: ModelResultCacheStore;
  readonly #now: () => Date;
  readonly #providerFingerprint: () => string;
  readonly #repository: SqliteModelAccountingRepository;
  readonly #tokens = new Map<string, ClearLease>();

  public constructor(
    repository: SqliteModelAccountingRepository,
    cache: ModelResultCacheStore,
    now: () => Date = () => new Date(),
    providerFingerprint: () => string = () => '0'.repeat(64),
  ) {
    this.#repository = repository;
    this.#cache = cache;
    this.#now = now;
    this.#providerFingerprint = providerFingerprint;
  }

  public getView(): ModelAccountingView {
    const summary = this.#repository.budgetSummary(utcBillingMonth(this.#now()));
    return Object.freeze({
      ...Object.fromEntries(
        Object.entries(summary).map(([key, value]) => [
          key,
          key.endsWith('MicroUsd') ? String(value) : value,
        ]),
      ),
      priceSchedules: this.#repository.listPriceSchedules().map(priceView),
      recentRuns: this.#repository.listRecentRuns().map((run) => ({
        costAmountMicroUsd: run.costAmountMicroUsd === null ? null : String(run.costAmountMicroUsd),
        costState: run.costState,
        executionId: run.executionId,
        externalRequestCount: run.externalRequestCount,
        localCacheHit: run.localCacheHit,
        modelId: run.modelId,
        modelSlot: run.modelSlot,
        protocolMode: run.protocolMode,
        stableErrorCode: run.stableErrorCode,
        status: run.status,
        taskKind: run.taskKind,
      })),
      unitPolicies: this.#repository.listUnitPolicies().map(policyView),
    }) as unknown as ModelAccountingView;
  }

  public previewCacheClear(senderId: number, windowId: number): ModelCacheClearPreview {
    this.#removeExpiredTokens();
    const totals = this.#repository.previewCacheClear();
    const previewToken = randomBytes(32).toString('base64url');
    const expiresAtMs = this.#now().getTime() + PREVIEW_TTL_MS;
    this.#tokens.set(previewToken, {
      bytes: totals.bytes,
      count: totals.count,
      expiresAtMs,
      senderId,
      windowId,
    });
    return Object.freeze({
      ...totals,
      expiresAt: new Date(expiresAtMs).toISOString(),
      previewToken,
    });
  }

  public confirmCacheClear(
    input: ConfirmModelCacheClearInput,
    senderId: number,
    windowId: number,
  ): ConfirmModelCacheClearResult {
    const lease = this.#tokens.get(input.previewToken);
    this.#tokens.delete(input.previewToken);
    if (
      input.confirmation !== 'CLEAR_MODEL_RESULT_CACHE' ||
      lease === undefined ||
      lease.expiresAtMs < this.#now().getTime() ||
      lease.senderId !== senderId ||
      lease.windowId !== windowId ||
      lease.bytes !== input.expectedBytes ||
      lease.count !== input.expectedCount
    ) {
      throw new ModelAccountingError('MODEL_CACHE_CLEAR_INVALID');
    }
    const current = this.#repository.previewCacheClear();
    if (current.bytes !== lease.bytes || current.count !== lease.count) {
      throw new ModelAccountingError('MODEL_CACHE_CLEAR_STALE');
    }
    let tombstonedEntries = 0;
    let deletedFiles = 0;
    let orphanFiles = 0;
    for (;;) {
      const paths = this.#repository.tombstoneCacheBatch(
        CACHE_DELETE_BATCH,
        this.#now().toISOString(),
      );
      tombstonedEntries += paths.length;
      for (const path of new Set(paths)) {
        if (this.#repository.hasReadyCacheReference(path)) continue;
        try {
          this.#cache.deleteExact(path);
          deletedFiles += 1;
        } catch (error) {
          if (error instanceof StorageError) orphanFiles += 1;
          else throw error;
        }
      }
      if (paths.length < CACHE_DELETE_BATCH) break;
    }
    return Object.freeze({ deletedFiles, orphanFiles, tombstonedEntries });
  }

  public createPriceSchedule(input: CreateModelPriceScheduleInput): ModelPriceScheduleView {
    if (input.expectedSettingsRevision !== this.#repository.getSettingsRevision()) {
      throw new ModelAccountingError('MODEL_ACCOUNTING_STALE');
    }
    const rates = [
      input.cachedInputPerMillionUsd,
      input.cacheWritePerMillionUsd,
      input.callUsd,
      input.imageGenerationCallUsd,
      input.imageUsd,
      input.inputPerMillionUsd,
      input.outputPerMillionUsd,
      input.searchCallUsd,
      input.toolUnitUsd,
    ];
    for (const value of rates) {
      assertNullableDecimal(value);
    }
    if (rates.every((value) => value === null)) {
      throw new ModelAccountingError('MODEL_ACCOUNTING_INVALID_REQUEST');
    }
    const providerConfigFingerprint = this.#providerFingerprint();
    if (/^0{64}$/u.test(providerConfigFingerprint)) {
      throw new ModelAccountingError('MODEL_ACCOUNTING_INVALID_REQUEST');
    }
    const version = this.#repository.nextPriceScheduleVersion(
      providerConfigFingerprint,
      input.modelId,
      input.operationKind,
      input.protocolMode,
    );
    return priceView(
      this.#repository.createPriceSchedule(
        {
          ...input,
          providerConfigFingerprint,
          version,
        },
        this.#now().toISOString(),
      ),
    );
  }

  public createUnitPolicy(input: CreateModelUnitPolicyInput): ModelUnitPolicyView {
    if (input.expectedSettingsRevision !== this.#repository.getSettingsRevision()) {
      throw new ModelAccountingError('MODEL_ACCOUNTING_STALE');
    }
    if (input.maxExternalCallsMonthly < 1 || input.maxExternalCallsWeekly < 1) {
      throw new ModelAccountingError('MODEL_ACCOUNTING_INVALID_REQUEST');
    }
    for (const value of [
      input.maxExternalCallsMonthly,
      input.maxExternalCallsWeekly,
      input.maxImageGenerationCalls,
      input.maxImages,
      input.maxInputTokens,
      input.maxOutputTokens,
      input.maxToolCalls,
      input.maxWebSearchCalls,
    ]) {
      assertUnit(value);
    }
    const version = this.#repository.nextUnitPolicyVersion(input.scopeKind, input.scopeValue);
    return policyView(
      this.#repository.createUnitPolicy(
        {
          ...input,
          version,
        },
        this.#now().toISOString(),
      ),
    );
  }

  public clearWindow(windowId: number): void {
    for (const [token, lease] of this.#tokens) {
      if (lease.windowId === windowId) this.#tokens.delete(token);
    }
  }

  #removeExpiredTokens(): void {
    const now = this.#now().getTime();
    for (const [token, lease] of this.#tokens) {
      if (lease.expiresAtMs < now) this.#tokens.delete(token);
    }
  }
}
