import { createHash, randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import { runInTransaction } from './transaction.js';

export type ModelRunStatus =
  | 'AMBIGUOUS'
  | 'BUDGET_BLOCKED'
  | 'CACHE_HIT'
  | 'CANCELLED'
  | 'CAPABILITY_BLOCKED'
  | 'CORRUPT'
  | 'FAILED'
  | 'IN_FLIGHT'
  | 'PLANNED'
  | 'SUCCEEDED';
export type ModelCostState =
  | 'NOT_INCURRED'
  | 'PROVIDER_REPORTED_USD'
  | 'UNKNOWN_POSSIBLY_INCURRED'
  | 'UNPRICED_USAGE'
  | 'USER_PRICE_TABLE_ESTIMATE';

export interface ModelRunIdentityInput {
  readonly cacheKey: string;
  readonly cachePolicy: 'BYPASS' | 'READ_ONLY' | 'READ_WRITE' | 'REFRESH';
  readonly executionId: string;
  readonly inputHash: string;
  readonly jobId: string | null;
  readonly modelId: string;
  readonly modelRole: string;
  readonly modelSlot: string;
  readonly promptContentHash: string;
  readonly promptTemplateId: string;
  readonly promptVersion: number;
  readonly protocolMode: 'CHAT_COMPLETIONS' | 'IMAGES_GENERATIONS' | 'MOCK' | 'RESPONSES';
  readonly providerConfigFingerprint: string;
  readonly taskKind: string;
}

export interface UsageColumnsInput {
  readonly cacheWriteTokens: number | null;
  readonly cachedInputTokens: number | null;
  readonly imageGenerationCalls: number | null;
  readonly images: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly reasoningTokens: number | null;
  readonly toolCalls: number | null;
  readonly totalTokens: number | null;
  readonly webSearchCalls: number | null;
}

export interface ModelRunRecord {
  readonly cacheEntryId: string | null;
  readonly cacheKey: string;
  readonly costAmountMicroUsd: number | null;
  readonly costState: ModelCostState;
  readonly executionId: string;
  readonly externalRequestCount: number;
  readonly id: string;
  readonly localCacheHit: boolean;
  readonly modelId: string;
  readonly modelSlot: string;
  readonly outcomeCertainty:
    'COMPLETED_INVALID_OUTPUT' | 'MAY_HAVE_EXECUTED' | 'NOT_SENT' | 'REJECTED_BEFORE_EXECUTION';
  readonly protocolMode: string;
  readonly stableErrorCode: string | null;
  readonly status: ModelRunStatus;
  readonly taskKind: string;
  readonly usage: UsageColumnsInput;
}

export interface ModelCacheEntryRecord {
  readonly cacheKey: string;
  readonly contentHash: string;
  readonly id: string;
  readonly managedPath: string;
  readonly outputHash: string;
  readonly outputType: 'IMAGE' | 'STRUCTURED' | 'TEXT' | 'VISION';
  readonly revision: number;
  readonly sizeBytes: number;
  readonly status: 'READY';
}

export interface ModelPriceScheduleRecord {
  readonly cachedInputPerMillionUsd: string | null;
  readonly cacheWritePerMillionUsd: string | null;
  readonly callUsd: string | null;
  readonly id: string;
  readonly imageGenerationCallUsd: string | null;
  readonly imageUsd: string | null;
  readonly inputPerMillionUsd: string | null;
  readonly inputTokensIncludeCachedInput: boolean;
  readonly modelId: string;
  readonly operationKind: string;
  readonly outputPerMillionUsd: string | null;
  readonly protocolMode: string | null;
  readonly providerConfigFingerprint: string;
  readonly searchCallUsd: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly toolUnitUsd: string | null;
  readonly usageSemanticsVersion: string;
  readonly version: number;
}

export interface ModelUnitPolicyRecord {
  readonly id: string;
  readonly maxExternalCallsMonthly: number;
  readonly maxExternalCallsWeekly: number;
  readonly maxImageGenerationCalls: number | null;
  readonly maxImages: number | null;
  readonly maxInputTokens: number | null;
  readonly maxOutputTokens: number | null;
  readonly maxToolCalls: number | null;
  readonly maxWebSearchCalls: number | null;
  readonly revision: number;
  readonly scopeKind: 'GLOBAL' | 'MODEL_ROLE' | 'TASK_KIND';
  readonly scopeValue: string | null;
  readonly status: 'ACTIVE' | 'INACTIVE';
  readonly version: number;
}

export interface ModelBudgetSummary {
  readonly billingMonth: string;
  readonly cacheBytes: number;
  readonly cacheEntries: number;
  readonly cacheHitCount: number;
  readonly estimatedKnownMicroUsd: number;
  readonly hardLimitMicroUsd: number;
  readonly hardStop: boolean;
  readonly outstandingReservationMicroUsd: number;
  readonly providerReportedMicroUsd: number;
  readonly uncertainReservationMicroUsd: number;
  readonly unknownCostCallCount: number;
  readonly warning: boolean;
  readonly warningLimitMicroUsd: number;
}

type RunRow = Readonly<Record<string, number | string | null>>;
const RUN_COLUMNS = `id, execution_id, task_kind, model_slot, model_id, protocol_mode,
  cache_key, cache_entry_id, local_cache_hit, status, outcome_certainty,
  external_request_count, cost_state, cost_amount_microusd, stable_error_code,
  usage_input_tokens, usage_output_tokens, usage_total_tokens, usage_cached_input_tokens,
  usage_cache_write_tokens, usage_reasoning_tokens, usage_images,
  usage_image_generation_calls, usage_web_search_calls, usage_tool_calls`;

function runRecord(row: RunRow): ModelRunRecord {
  return Object.freeze({
    cacheEntryId: row.cache_entry_id as string | null,
    cacheKey: row.cache_key as string,
    costAmountMicroUsd: row.cost_amount_microusd as number | null,
    costState: row.cost_state as ModelCostState,
    executionId: row.execution_id as string,
    externalRequestCount: row.external_request_count as number,
    id: row.id as string,
    localCacheHit: row.local_cache_hit === 1,
    modelId: row.model_id as string,
    modelSlot: row.model_slot as string,
    outcomeCertainty: row.outcome_certainty as ModelRunRecord['outcomeCertainty'],
    protocolMode: row.protocol_mode as string,
    stableErrorCode: row.stable_error_code as string | null,
    status: row.status as ModelRunStatus,
    taskKind: row.task_kind as string,
    usage: Object.freeze({
      cacheWriteTokens: row.usage_cache_write_tokens as number | null,
      cachedInputTokens: row.usage_cached_input_tokens as number | null,
      imageGenerationCalls: row.usage_image_generation_calls as number | null,
      images: row.usage_images as number | null,
      inputTokens: row.usage_input_tokens as number | null,
      outputTokens: row.usage_output_tokens as number | null,
      reasoningTokens: row.usage_reasoning_tokens as number | null,
      toolCalls: row.usage_tool_calls as number | null,
      totalTokens: row.usage_total_tokens as number | null,
      webSearchCalls: row.usage_web_search_calls as number | null,
    }),
  });
}

function pageSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 100) {
    throw new RangeError('page size must be between 1 and 100');
  }
  return value;
}

function tokenHash(value: string): string {
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value)) {
    throw new TypeError('owner token is invalid');
  }
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function identityValues(identity: ModelRunIdentityInput): readonly (number | string | null)[] {
  return [
    identity.executionId,
    identity.jobId,
    identity.taskKind,
    identity.modelRole,
    identity.modelSlot,
    identity.providerConfigFingerprint,
    identity.modelId,
    identity.protocolMode,
    identity.promptTemplateId,
    identity.promptVersion,
    identity.promptContentHash,
    identity.inputHash,
    identity.cacheKey,
    identity.cachePolicy,
  ];
}

export class SqliteModelAccountingRepository {
  readonly #database: DatabaseSync;
  readonly #randomId: () => string;

  public constructor(database: DatabaseSync, randomId: () => string = randomUUID) {
    this.#database = database;
    this.#randomId = randomId;
  }

  public getRunByExecutionId(executionId: string): ModelRunRecord | null {
    const row = this.#database
      .prepare(`SELECT ${RUN_COLUMNS} FROM model_runs WHERE execution_id=?`)
      .get(executionId) as RunRow | undefined;
    return row === undefined ? null : runRecord(row);
  }

  public listRecentRuns(limit = 50): readonly ModelRunRecord[] {
    const rows = this.#database
      .prepare(`SELECT ${RUN_COLUMNS} FROM model_runs ORDER BY created_at DESC,id DESC LIMIT ?`)
      .all(pageSize(limit)) as unknown as readonly RunRow[];
    return Object.freeze(rows.map(runRecord));
  }

  public getReadyCache(cacheKey: string): ModelCacheEntryRecord | null {
    const row = this.#database
      .prepare(
        `SELECT id,cache_key,status,output_type,managed_relative_path,content_hash,
                output_hash,size_bytes,revision
         FROM model_cache_entries WHERE cache_key=? AND status='READY'`,
      )
      .get(cacheKey) as RunRow | undefined;
    return row === undefined
      ? null
      : Object.freeze({
          cacheKey: row.cache_key as string,
          contentHash: row.content_hash as string,
          id: row.id as string,
          managedPath: row.managed_relative_path as string,
          outputHash: row.output_hash as string,
          outputType: row.output_type as ModelCacheEntryRecord['outputType'],
          revision: row.revision as number,
          sizeBytes: row.size_bytes as number,
          status: 'READY',
        });
  }

  public acquireCacheLease(input: {
    readonly cacheKey: string;
    readonly expiresAt: string;
    readonly now: string;
    readonly ownerToken: string;
  }): 'ACQUIRED' | 'READY' | 'WAIT' {
    return runInTransaction(this.#database, () => {
      const current = this.#database
        .prepare(`SELECT status,lease_expires_at FROM model_cache_entries WHERE cache_key=?`)
        .get(input.cacheKey) as RunRow | undefined;
      if (current?.status === 'READY') return 'READY';
      if (
        current?.status === 'IN_FLIGHT' &&
        current.lease_expires_at !== null &&
        (current.lease_expires_at as string) >= input.now
      ) {
        return 'WAIT';
      }
      if (current === undefined) {
        this.#database
          .prepare(
            `INSERT INTO model_cache_entries(
               id,cache_key,status,owner_token_hash,lease_expires_at,last_heartbeat_at,
               created_at,updated_at,revision
             ) VALUES (?,?,'IN_FLIGHT',?,?,?,?,?,0)`,
          )
          .run(
            `cache-${this.#randomId()}`,
            input.cacheKey,
            tokenHash(input.ownerToken),
            input.expiresAt,
            input.now,
            input.now,
            input.now,
          );
      } else {
        this.#database
          .prepare(
            `UPDATE model_cache_entries SET status='IN_FLIGHT',managed_relative_path=NULL,
               content_hash=NULL,output_hash=NULL,size_bytes=NULL,output_type=NULL,
               owner_token_hash=?,lease_expires_at=?,last_heartbeat_at=?,updated_at=?,
               revision=revision+1 WHERE cache_key=?`,
          )
          .run(tokenHash(input.ownerToken), input.expiresAt, input.now, input.now, input.cacheKey);
      }
      return 'ACQUIRED';
    });
  }

  public heartbeatCacheLease(input: {
    readonly cacheKey: string;
    readonly expectedRevision: number;
    readonly expiresAt: string;
    readonly now: string;
    readonly ownerToken: string;
  }): boolean {
    return (
      Number(
        this.#database
          .prepare(
            `UPDATE model_cache_entries SET lease_expires_at=?,last_heartbeat_at=?,
               updated_at=?,revision=revision+1
             WHERE cache_key=? AND status='IN_FLIGHT' AND owner_token_hash=?
               AND revision=? AND lease_expires_at>=?`,
          )
          .run(
            input.expiresAt,
            input.now,
            input.now,
            input.cacheKey,
            tokenHash(input.ownerToken),
            input.expectedRevision,
            input.now,
          ).changes,
      ) === 1
    );
  }

  public markCacheCorrupt(cacheKey: string, now: string): void {
    this.#database
      .prepare(
        `UPDATE model_cache_entries SET status='CORRUPT',owner_token_hash=NULL,
           lease_expires_at=NULL,updated_at=?,revision=revision+1 WHERE cache_key=?`,
      )
      .run(now, cacheKey);
  }

  public releaseCacheLease(input: {
    readonly cacheKey: string;
    readonly now: string;
    readonly ownerToken: string;
    readonly status: 'AMBIGUOUS' | 'EVICTED';
  }): boolean {
    return (
      Number(
        this.#database
          .prepare(
            `UPDATE model_cache_entries SET status=?,owner_token_hash=NULL,
               lease_expires_at=NULL,updated_at=?,revision=revision+1
             WHERE cache_key=? AND status='IN_FLIGHT' AND owner_token_hash=?`,
          )
          .run(input.status, input.now, input.cacheKey, tokenHash(input.ownerToken)).changes,
      ) === 1
    );
  }

  public createTerminalRun(input: {
    readonly cacheEntryId?: string;
    readonly identity: ModelRunIdentityInput;
    readonly localCacheHit?: boolean;
    readonly now: string;
    readonly outputHash?: string;
    readonly stableErrorCode?: string;
    readonly status: 'BUDGET_BLOCKED' | 'CACHE_HIT' | 'CAPABILITY_BLOCKED' | 'CORRUPT';
  }): ModelRunRecord {
    const existing = this.getRunByExecutionId(input.identity.executionId);
    if (existing !== null) {
      if (existing.cacheKey !== input.identity.cacheKey) {
        throw new Error('MODEL_EXECUTION_IDEMPOTENCY_CONFLICT');
      }
      return existing;
    }
    this.#database
      .prepare(
        `INSERT INTO model_runs(
           id,execution_id,job_id,task_kind,model_role,model_slot,
           provider_config_fingerprint,model_id,protocol_mode,prompt_template_id,
           prompt_version,prompt_content_hash,input_hash,cache_key,cache_entry_id,
           output_hash,local_cache_hit,cache_policy,status,outcome_certainty,
           external_request_count,cost_state,stable_error_code,started_at,finished_at,
           created_at,updated_at,revision
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? ,?,'NOT_SENT',0,'NOT_INCURRED',
           ?,?,?,?,?,0)`,
      )
      .run(
        `run-${this.#randomId()}`,
        ...identityValues(input.identity).slice(0, 13),
        input.cacheEntryId ?? null,
        input.outputHash ?? null,
        input.localCacheHit === true ? 1 : 0,
        input.identity.cachePolicy,
        input.status,
        input.stableErrorCode ?? null,
        input.now,
        input.now,
        input.now,
        input.now,
      );
    return this.getRunByExecutionId(input.identity.executionId) as ModelRunRecord;
  }

  public reserveAndCreateRun(input: {
    readonly billingMonth: string;
    readonly identity: ModelRunIdentityInput;
    readonly now: string;
    readonly reservedAmountMicroUsd: number | null;
    readonly unitDemandJson: string;
    readonly userApprovedUnknownCost?: boolean;
    readonly weekKey: string;
  }): { readonly reservationId: string; readonly run: ModelRunRecord } {
    return runInTransaction(this.#database, () => {
      const existing = this.getRunByExecutionId(input.identity.executionId);
      if (existing !== null) {
        if (existing.cacheKey !== input.identity.cacheKey) {
          throw new Error('MODEL_EXECUTION_IDEMPOTENCY_CONFLICT');
        }
        const row = this.#database
          .prepare(`SELECT id FROM model_budget_reservations WHERE execution_id=?`)
          .get(input.identity.executionId) as RunRow | undefined;
        return { reservationId: (row?.id as string | undefined) ?? '', run: existing };
      }
      const settings = this.#database
        .prepare(`SELECT monthly_hard_limit_cents FROM app_settings WHERE id='app'`)
        .get() as RunRow;
      if (input.reservedAmountMicroUsd !== null) {
        const known = this.#database
          .prepare(
            `SELECT coalesce(sum(amount_microusd),0) AS value FROM cost_ledger
             WHERE billing_month=? AND amount_microusd IS NOT NULL`,
          )
          .get(input.billingMonth) as RunRow;
        const held = this.#database
          .prepare(
            `SELECT coalesce(sum(reserved_amount_microusd),0) AS value
             FROM model_budget_reservations WHERE billing_month=?
               AND status IN ('ACTIVE','UNCERTAIN_COMMITTED')
               AND reserved_amount_microusd IS NOT NULL`,
          )
          .get(input.billingMonth) as RunRow;
        const hard = (settings.monthly_hard_limit_cents as number) * 10_000;
        if (
          (known.value as number) + (held.value as number) + input.reservedAmountMicroUsd >=
          hard
        ) {
          throw new Error('BUDGET_HARD_LIMIT_REACHED');
        }
      } else if (
        input.userApprovedUnknownCost !== true &&
        this.findApplicableUnitPolicy(input.identity.taskKind, input.identity.modelRole) === null
      ) {
        throw new Error('BUDGET_UNPRICED_LIMIT_REQUIRED');
      } else if (
        this.findApplicableUnitPolicy(input.identity.taskKind, input.identity.modelRole) !== null
      ) {
        const policy = this.findApplicableUnitPolicy(
          input.identity.taskKind,
          input.identity.modelRole,
        ) as ModelUnitPolicyRecord;
        const monthly = this.#database
          .prepare(
            `SELECT count(*) AS value FROM model_budget_reservations
             WHERE billing_month=? AND status NOT IN ('RELEASED_BEFORE_SEND','CANCELLED_BEFORE_SEND')`,
          )
          .get(input.billingMonth) as RunRow;
        const weekly = this.#database
          .prepare(
            `SELECT count(*) AS value FROM model_budget_reservations
             WHERE week_key=? AND status NOT IN ('RELEASED_BEFORE_SEND','CANCELLED_BEFORE_SEND')`,
          )
          .get(input.weekKey) as RunRow;
        if (
          (monthly.value as number) >= policy.maxExternalCallsMonthly ||
          (weekly.value as number) >= policy.maxExternalCallsWeekly
        ) {
          throw new Error('BUDGET_UNIT_LIMIT_REACHED');
        }
      }
      const runId = `run-${this.#randomId()}`;
      const reservationId = `reservation-${this.#randomId()}`;
      this.#database
        .prepare(
          `INSERT INTO model_runs(
             id,execution_id,job_id,task_kind,model_role,model_slot,
             provider_config_fingerprint,model_id,protocol_mode,prompt_template_id,
             prompt_version,prompt_content_hash,input_hash,cache_key,local_cache_hit,
             cache_policy,status,outcome_certainty,external_request_count,cost_state,
             started_at,created_at,updated_at,revision
           ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,'IN_FLIGHT','NOT_SENT',0,
             'NOT_INCURRED',?,?,?,0)`,
        )
        .run(runId, ...identityValues(input.identity), input.now, input.now, input.now);
      this.#database
        .prepare(
          `INSERT INTO model_budget_reservations(
             id,execution_id,model_run_id,billing_month,week_key,task_kind,status,
             reserved_amount_microusd,unit_demand_json,sent_state,created_at,updated_at,revision
           ) VALUES (?,?,?,?,?,?,'ACTIVE',?,?,'NOT_SENT',?,?,0)`,
        )
        .run(
          reservationId,
          input.identity.executionId,
          runId,
          input.billingMonth,
          input.weekKey,
          input.identity.taskKind,
          input.reservedAmountMicroUsd,
          input.unitDemandJson,
          input.now,
          input.now,
        );
      return {
        reservationId,
        run: this.getRunByExecutionId(input.identity.executionId) as ModelRunRecord,
      };
    });
  }

  public settle(input: {
    readonly cache: {
      readonly cacheKey: string;
      readonly contentHash: string;
      readonly managedPath: string;
      readonly ownerToken: string;
      readonly outputHash: string;
      readonly outputType: ModelCacheEntryRecord['outputType'];
      readonly sizeBytes: number;
    } | null;
    readonly comparisonEstimateMicroUsd: number | null;
    readonly costAmountMicroUsd: number | null;
    readonly costSource: string;
    readonly costState: Exclude<ModelCostState, 'NOT_INCURRED'>;
    readonly executionId: string;
    readonly now: string;
    readonly outcomeCertainty: ModelRunRecord['outcomeCertainty'];
    readonly priceSchedule: ModelPriceScheduleRecord | null;
    readonly status: 'AMBIGUOUS' | 'CANCELLED' | 'FAILED' | 'SUCCEEDED';
    readonly usage: UsageColumnsInput;
  }): ModelRunRecord {
    return runInTransaction(this.#database, () => {
      const run = this.getRunByExecutionId(input.executionId);
      if (run === null) throw new Error('MODEL_RUN_NOT_FOUND');
      let cacheId: string | null = null;
      if (input.cache !== null) {
        const lease = this.#database
          .prepare(`SELECT status,owner_token_hash FROM model_cache_entries WHERE cache_key=?`)
          .get(input.cache.cacheKey) as RunRow | undefined;
        if (
          lease !== undefined &&
          (lease.status !== 'IN_FLIGHT' ||
            lease.owner_token_hash !== tokenHash(input.cache.ownerToken))
        ) {
          throw new Error('MODEL_CACHE_LEASE_LOST');
        }
        cacheId = `cache-${this.#randomId()}`;
        this.#database
          .prepare(
            `INSERT INTO model_cache_entries(
               id,cache_key,status,output_type,managed_relative_path,content_hash,
               output_hash,size_bytes,format_version,created_at,updated_at,revision
             ) VALUES (?,?,'READY',?,?,?,?,?,1,?,?,0)
             ON CONFLICT(cache_key) DO UPDATE SET status='READY',
               output_type=excluded.output_type,managed_relative_path=excluded.managed_relative_path,
               content_hash=excluded.content_hash,output_hash=excluded.output_hash,
               size_bytes=excluded.size_bytes,owner_token_hash=NULL,lease_expires_at=NULL,
               updated_at=excluded.updated_at,revision=model_cache_entries.revision+1`,
          )
          .run(
            cacheId,
            input.cache.cacheKey,
            input.cache.outputType,
            input.cache.managedPath,
            input.cache.contentHash,
            input.cache.outputHash,
            input.cache.sizeBytes,
            input.now,
            input.now,
          );
        const row = this.#database
          .prepare(`SELECT id FROM model_cache_entries WHERE cache_key=?`)
          .get(input.cache.cacheKey) as RunRow;
        cacheId = row.id as string;
      }
      this.#database
        .prepare(
          `UPDATE model_runs SET cache_entry_id=?,output_hash=?,status=?,
             outcome_certainty=?,external_request_count=1,usage_input_tokens=?,
             usage_output_tokens=?,usage_total_tokens=?,usage_cached_input_tokens=?,
             usage_cache_write_tokens=?,usage_reasoning_tokens=?,usage_images=?,
             usage_image_generation_calls=?,usage_web_search_calls=?,usage_tool_calls=?,
             cost_state=?,cost_source=?,cost_amount_microusd=?,price_schedule_version=?,
             finished_at=?,updated_at=?,revision=revision+1
           WHERE execution_id=? AND status='IN_FLIGHT'`,
        )
        .run(
          cacheId,
          input.cache?.outputHash ?? null,
          input.status,
          input.outcomeCertainty,
          input.usage.inputTokens,
          input.usage.outputTokens,
          input.usage.totalTokens,
          input.usage.cachedInputTokens,
          input.usage.cacheWriteTokens,
          input.usage.reasoningTokens,
          input.usage.images,
          input.usage.imageGenerationCalls,
          input.usage.webSearchCalls,
          input.usage.toolCalls,
          input.costState,
          input.costSource,
          input.costAmountMicroUsd,
          input.priceSchedule?.version ?? null,
          input.now,
          input.now,
          input.executionId,
        );
      this.#database
        .prepare(
          `UPDATE model_budget_reservations SET status=?,sent_state=?,settled_at=?,
             updated_at=?,revision=revision+1 WHERE execution_id=? AND status='ACTIVE'`,
        )
        .run(
          input.status === 'AMBIGUOUS' ? 'UNCERTAIN_COMMITTED' : 'SETTLED',
          input.status === 'AMBIGUOUS' ? 'UNKNOWN' : 'SENT',
          input.now,
          input.now,
          input.executionId,
        );
      const updated = this.getRunByExecutionId(input.executionId) as ModelRunRecord;
      this.#database
        .prepare(
          `INSERT OR IGNORE INTO cost_ledger(
             id,settlement_identity,execution_id,model_run_id,billing_month,
             provider_config_fingerprint,model_id,operation_kind,cost_state,cost_source,
             amount_microusd,comparison_estimate_microusd,price_schedule_id,
             price_schedule_version,usage_summary_json,created_at
           ) VALUES (?,?,?, ?,substr(?,1,7),?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          `ledger-${this.#randomId()}`,
          `settlement:${input.executionId}`,
          input.executionId,
          updated.id,
          input.now,
          input.priceSchedule?.providerConfigFingerprint ??
            '0000000000000000000000000000000000000000000000000000000000000000',
          updated.modelId,
          updated.taskKind,
          input.costState,
          input.costSource,
          input.costAmountMicroUsd,
          input.comparisonEstimateMicroUsd,
          input.priceSchedule?.id ?? null,
          input.priceSchedule?.version ?? null,
          JSON.stringify(input.usage),
          input.now,
        );
      return updated;
    });
  }

  public releaseBeforeSend(
    executionId: string,
    status: 'CANCELLED' | 'FAILED',
    stableErrorCode: string,
    now: string,
  ): ModelRunRecord {
    return runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `UPDATE model_runs SET status=?,outcome_certainty='NOT_SENT',
             stable_error_code=?,cost_state='NOT_INCURRED',finished_at=?,updated_at=?,
             revision=revision+1 WHERE execution_id=? AND status='IN_FLIGHT'`,
        )
        .run(status, stableErrorCode, now, now, executionId);
      this.#database
        .prepare(
          `UPDATE model_budget_reservations SET status=?,sent_state='NOT_SENT',
             settled_at=?,updated_at=?,revision=revision+1
           WHERE execution_id=? AND status='ACTIVE'`,
        )
        .run(
          status === 'CANCELLED' ? 'CANCELLED_BEFORE_SEND' : 'RELEASED_BEFORE_SEND',
          now,
          now,
          executionId,
        );
      return this.getRunByExecutionId(executionId) as ModelRunRecord;
    });
  }

  public recoverInterrupted(now: string): number {
    return runInTransaction(this.#database, () => {
      const result = this.#database
        .prepare(
          `UPDATE model_runs SET status='AMBIGUOUS',outcome_certainty='MAY_HAVE_EXECUTED',
             cost_state='UNKNOWN_POSSIBLY_INCURRED',stable_error_code='INTERRUPTED',
             finished_at=?,updated_at=?,revision=revision+1 WHERE status='IN_FLIGHT'`,
        )
        .run(now, now);
      this.#database
        .prepare(
          `UPDATE model_budget_reservations SET status='UNCERTAIN_COMMITTED',
             sent_state='UNKNOWN',updated_at=?,revision=revision+1 WHERE status='ACTIVE'`,
        )
        .run(now);
      this.#database
        .prepare(
          `UPDATE model_cache_entries SET status='AMBIGUOUS',owner_token_hash=NULL,
             lease_expires_at=NULL,updated_at=?,revision=revision+1 WHERE status='IN_FLIGHT'`,
        )
        .run(now);
      return Number(result.changes);
    });
  }

  public getActivePriceSchedule(
    fingerprint: string,
    modelId: string,
    operation: string,
    protocol: string,
  ): ModelPriceScheduleRecord | null {
    const row = this.#database
      .prepare(
        `SELECT * FROM model_price_schedules WHERE provider_config_fingerprint=?
           AND model_id=? AND operation_kind=? AND (protocol_mode=? OR protocol_mode IS NULL)
           AND status='ACTIVE'
         ORDER BY CASE WHEN protocol_mode=? THEN 0 ELSE 1 END,version DESC LIMIT 1`,
      )
      .get(fingerprint, modelId, operation, protocol, protocol) as RunRow | undefined;
    return row === undefined ? null : this.#priceRecord(row);
  }

  public createPriceSchedule(
    input: Omit<ModelPriceScheduleRecord, 'id' | 'status'>,
    now: string,
  ): ModelPriceScheduleRecord {
    const id = `price-${this.#randomId()}`;
    this.#database
      .prepare(
        `INSERT INTO model_price_schedules(
           id,provider_config_fingerprint,model_id,operation_kind,protocol_mode,version,
           currency,usage_semantics_version,input_tokens_include_cached,input_per_million_usd,
           output_per_million_usd,cached_input_per_million_usd,cache_write_per_million_usd,
           image_usd,image_generation_call_usd,web_search_call_usd,tool_unit_usd,call_usd,
           status,effective_at,created_at,revision
         ) VALUES (?,?,?,?,?,?,'USD',?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,?,0)`,
      )
      .run(
        id,
        input.providerConfigFingerprint,
        input.modelId,
        input.operationKind,
        input.protocolMode,
        input.version,
        input.usageSemanticsVersion,
        input.inputTokensIncludeCachedInput ? 1 : 0,
        input.inputPerMillionUsd,
        input.outputPerMillionUsd,
        input.cachedInputPerMillionUsd,
        input.cacheWritePerMillionUsd,
        input.imageUsd,
        input.imageGenerationCallUsd,
        input.searchCallUsd,
        input.toolUnitUsd,
        input.callUsd,
        now,
        now,
      );
    return this.getActivePriceSchedule(
      input.providerConfigFingerprint,
      input.modelId,
      input.operationKind,
      input.protocolMode ?? '',
    ) as ModelPriceScheduleRecord;
  }

  public listPriceSchedules(limit = 50): readonly ModelPriceScheduleRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM model_price_schedules
         ORDER BY created_at DESC,version DESC,id DESC LIMIT ?`,
      )
      .all(pageSize(limit)) as unknown as readonly RunRow[];
    return Object.freeze(rows.map((row) => this.#priceRecord(row)));
  }

  public nextPriceScheduleVersion(
    providerConfigFingerprint: string,
    modelId: string,
    operationKind: string,
    protocolMode: string | null,
  ): number {
    const row = this.#database
      .prepare(
        `SELECT coalesce(max(version),0)+1 AS version FROM model_price_schedules
         WHERE provider_config_fingerprint=? AND model_id=? AND operation_kind=?
           AND protocol_mode IS ?`,
      )
      .get(providerConfigFingerprint, modelId, operationKind, protocolMode) as RunRow;
    return row.version as number;
  }

  public findApplicableUnitPolicy(
    taskKind: string,
    modelRole: string,
  ): ModelUnitPolicyRecord | null {
    const row = this.#database
      .prepare(
        `SELECT * FROM model_unit_budget_policies WHERE status='ACTIVE' AND (
           (scope_kind='TASK_KIND' AND scope_value=?) OR
           (scope_kind='MODEL_ROLE' AND scope_value=?) OR scope_kind='GLOBAL')
         ORDER BY CASE scope_kind WHEN 'TASK_KIND' THEN 0 WHEN 'MODEL_ROLE' THEN 1 ELSE 2 END,
           version DESC LIMIT 1`,
      )
      .get(taskKind, modelRole) as RunRow | undefined;
    return row === undefined ? null : this.#unitRecord(row);
  }

  public createUnitPolicy(
    input: Omit<ModelUnitPolicyRecord, 'id' | 'revision' | 'status'>,
    now: string,
  ): ModelUnitPolicyRecord {
    const id = `units-${this.#randomId()}`;
    this.#database
      .prepare(
        `INSERT INTO model_unit_budget_policies(
           id,scope_kind,scope_value,version,max_external_calls_monthly,
           max_external_calls_weekly,max_input_tokens,max_output_tokens,max_images,
           max_image_generation_calls,max_web_search_calls,max_tool_calls,status,created_at,revision
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'ACTIVE',?,0)`,
      )
      .run(
        id,
        input.scopeKind,
        input.scopeValue,
        input.version,
        input.maxExternalCallsMonthly,
        input.maxExternalCallsWeekly,
        input.maxInputTokens,
        input.maxOutputTokens,
        input.maxImages,
        input.maxImageGenerationCalls,
        input.maxWebSearchCalls,
        input.maxToolCalls,
        now,
      );
    return this.findApplicableUnitPolicy(
      input.scopeKind === 'TASK_KIND' ? (input.scopeValue as string) : '',
      input.scopeKind === 'MODEL_ROLE' ? (input.scopeValue as string) : '',
    ) as ModelUnitPolicyRecord;
  }

  public listUnitPolicies(limit = 50): readonly ModelUnitPolicyRecord[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM model_unit_budget_policies
         ORDER BY created_at DESC,version DESC,id DESC LIMIT ?`,
      )
      .all(pageSize(limit)) as unknown as readonly RunRow[];
    return Object.freeze(rows.map((row) => this.#unitRecord(row)));
  }

  public nextUnitPolicyVersion(scopeKind: string, scopeValue: string | null): number {
    const row = this.#database
      .prepare(
        `SELECT coalesce(max(version),0)+1 AS version FROM model_unit_budget_policies
         WHERE scope_kind=? AND scope_value IS ?`,
      )
      .get(scopeKind, scopeValue) as RunRow;
    return row.version as number;
  }

  public getSettingsRevision(): number {
    const row = this.#database
      .prepare(`SELECT revision FROM app_settings WHERE id='app'`)
      .get() as RunRow;
    return row.revision as number;
  }

  public budgetSummary(month: string): ModelBudgetSummary {
    const ledger = this.#database
      .prepare(
        `SELECT
          coalesce(sum(CASE WHEN cost_state='PROVIDER_REPORTED_USD' THEN amount_microusd ELSE 0 END),0) reported,
          coalesce(sum(CASE WHEN cost_state='USER_PRICE_TABLE_ESTIMATE' THEN amount_microusd ELSE 0 END),0) estimated,
          coalesce(sum(CASE WHEN cost_state IN ('UNPRICED_USAGE','UNKNOWN_POSSIBLY_INCURRED') THEN 1 ELSE 0 END),0) unknowns
         FROM cost_ledger WHERE billing_month=?`,
      )
      .get(month) as RunRow;
    const held = this.#database
      .prepare(
        `SELECT
          coalesce(sum(CASE WHEN status='ACTIVE' THEN reserved_amount_microusd ELSE 0 END),0) outstanding,
          coalesce(sum(CASE WHEN status='UNCERTAIN_COMMITTED' THEN reserved_amount_microusd ELSE 0 END),0) uncertain
         FROM model_budget_reservations WHERE billing_month=?`,
      )
      .get(month) as RunRow;
    const cache = this.#database
      .prepare(
        `SELECT count(*) entries,coalesce(sum(size_bytes),0) bytes
         FROM model_cache_entries WHERE status='READY'`,
      )
      .get() as RunRow;
    const hits = this.#database
      .prepare(
        `SELECT count(*) hits FROM model_runs WHERE local_cache_hit=1 AND substr(created_at,1,7)=?`,
      )
      .get(month) as RunRow;
    const settings = this.#database
      .prepare(
        `SELECT monthly_warning_cents,monthly_hard_limit_cents FROM app_settings WHERE id='app'`,
      )
      .get() as RunRow;
    const warningLimitMicroUsd = (settings.monthly_warning_cents as number) * 10_000;
    const hardLimitMicroUsd = (settings.monthly_hard_limit_cents as number) * 10_000;
    const known =
      (ledger.reported as number) +
      (ledger.estimated as number) +
      (held.outstanding as number) +
      (held.uncertain as number);
    return Object.freeze({
      billingMonth: month,
      cacheBytes: cache.bytes as number,
      cacheEntries: cache.entries as number,
      cacheHitCount: hits.hits as number,
      estimatedKnownMicroUsd: ledger.estimated as number,
      hardLimitMicroUsd,
      hardStop: known >= hardLimitMicroUsd,
      outstandingReservationMicroUsd: held.outstanding as number,
      providerReportedMicroUsd: ledger.reported as number,
      uncertainReservationMicroUsd: held.uncertain as number,
      unknownCostCallCount: ledger.unknowns as number,
      warning: known >= warningLimitMicroUsd,
      warningLimitMicroUsd,
    });
  }

  public previewCacheClear(): {
    readonly bytes: number;
    readonly count: number;
    readonly outputTypes: readonly string[];
  } {
    const totals = this.#database
      .prepare(
        `SELECT count(*) count,coalesce(sum(size_bytes),0) bytes
         FROM model_cache_entries WHERE status IN ('READY','CORRUPT')`,
      )
      .get() as RunRow;
    const types = this.#database
      .prepare(
        `SELECT DISTINCT output_type FROM model_cache_entries
         WHERE status IN ('READY','CORRUPT') AND output_type IS NOT NULL ORDER BY output_type`,
      )
      .all() as unknown as readonly RunRow[];
    return Object.freeze({
      bytes: totals.bytes as number,
      count: totals.count as number,
      outputTypes: Object.freeze(types.map((row) => row.output_type as string)),
    });
  }

  public tombstoneCacheBatch(limit: number, now: string): readonly string[] {
    return runInTransaction(this.#database, () => {
      const rows = this.#database
        .prepare(
          `SELECT managed_relative_path FROM model_cache_entries
           WHERE status IN ('READY','CORRUPT') AND managed_relative_path IS NOT NULL
           ORDER BY updated_at,id LIMIT ?`,
        )
        .all(pageSize(limit)) as unknown as readonly RunRow[];
      for (const row of rows) {
        this.#database
          .prepare(
            `UPDATE model_cache_entries SET status='EVICTED',updated_at=?,
             revision=revision+1 WHERE managed_relative_path=? AND status IN ('READY','CORRUPT')`,
          )
          .run(now, row.managed_relative_path as string);
      }
      return Object.freeze(rows.map((row) => row.managed_relative_path as string));
    });
  }

  public hasReadyCacheReference(managedPath: string): boolean {
    return (
      this.#database
        .prepare(
          `SELECT 1 FROM model_cache_entries
           WHERE managed_relative_path=? AND status='READY' LIMIT 1`,
        )
        .get(managedPath) !== undefined
    );
  }

  #priceRecord(row: RunRow): ModelPriceScheduleRecord {
    return Object.freeze({
      cachedInputPerMillionUsd: row.cached_input_per_million_usd as string | null,
      cacheWritePerMillionUsd: row.cache_write_per_million_usd as string | null,
      callUsd: row.call_usd as string | null,
      id: row.id as string,
      imageGenerationCallUsd: row.image_generation_call_usd as string | null,
      imageUsd: row.image_usd as string | null,
      inputPerMillionUsd: row.input_per_million_usd as string | null,
      inputTokensIncludeCachedInput: row.input_tokens_include_cached === 1,
      modelId: row.model_id as string,
      operationKind: row.operation_kind as string,
      outputPerMillionUsd: row.output_per_million_usd as string | null,
      protocolMode: row.protocol_mode as string | null,
      providerConfigFingerprint: row.provider_config_fingerprint as string,
      searchCallUsd: row.web_search_call_usd as string | null,
      status: row.status as 'ACTIVE' | 'INACTIVE',
      toolUnitUsd: row.tool_unit_usd as string | null,
      usageSemanticsVersion: row.usage_semantics_version as string,
      version: row.version as number,
    });
  }

  #unitRecord(row: RunRow): ModelUnitPolicyRecord {
    return Object.freeze({
      id: row.id as string,
      maxExternalCallsMonthly: row.max_external_calls_monthly as number,
      maxExternalCallsWeekly: row.max_external_calls_weekly as number,
      maxImageGenerationCalls: row.max_image_generation_calls as number | null,
      maxImages: row.max_images as number | null,
      maxInputTokens: row.max_input_tokens as number | null,
      maxOutputTokens: row.max_output_tokens as number | null,
      maxToolCalls: row.max_tool_calls as number | null,
      maxWebSearchCalls: row.max_web_search_calls as number | null,
      revision: row.revision as number,
      scopeKind: row.scope_kind as ModelUnitPolicyRecord['scopeKind'],
      scopeValue: row.scope_value as string | null,
      status: row.status as 'ACTIVE' | 'INACTIVE',
      version: row.version as number,
    });
  }
}
