import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  FACT_MAPPING_CONFIRMATION,
  FACT_MAPPING_JOB_TYPE,
  FactMappingConfirmationBroker,
  FactMappingError,
  type FactMappingPlanV1,
} from '@mystery-operations/quality';
import { JobQueueRepository, SqliteFactMappingRepository } from '@mystery-operations/db';
import type {
  ConfirmFactMappingActionInput,
  ConfirmFactMappingDecisionInput,
  FactMappingActionPreview,
  FactMappingActionResult,
  FactMappingClaimChainView,
  FactMappingDetailView,
  FactMappingDecisionPreview,
  FactMappingDecisionResult,
  FactMappingListView,
  GetFactMappingCheckInput,
  GetFactMappingChecksInput,
  GetFactMappingClaimChainInput,
  PreviewFactMappingActionInput,
  PreviewFactMappingDecisionInput,
} from '@mystery-operations/shared';
import {
  FactMappingCheckService,
  JobHandlerRegistry,
  JobQueueService,
  JobRecoveryService,
  JobWorker,
  registerFactMappingCheckJob,
  type FactMappingModelSlotV1,
  type ModelExecutionService,
} from '@mystery-operations/workflows';

type RuntimePayload =
  | {
      readonly kind: 'START';
      readonly plan: FactMappingPlanV1;
    }
  | {
      readonly executionId: string;
      readonly expectedRevision: number;
      readonly kind: 'CANCEL';
    }
  | {
      readonly decision: PreviewFactMappingDecisionInput;
      readonly preview: FactMappingDecisionPreview['preview'];
    };

export interface DesktopFactMappingRuntimeOptions {
  readonly budgetState?: () => FactMappingPlanV1['budgetState'];
  readonly cacheState?: () => FactMappingPlanV1['cacheState'];
  readonly capabilityState?: () => FactMappingPlanV1['capabilityState'];
  readonly clock?: () => Date;
  readonly credentialState?: () => FactMappingPlanV1['credentialState'];
  readonly modelExecutionService?: ModelExecutionService;
  readonly modelSlot?: FactMappingModelSlotV1;
}

export class DesktopFactMappingRuntime {
  readonly #budgetState: () => FactMappingPlanV1['budgetState'];
  readonly #cacheState: () => FactMappingPlanV1['cacheState'];
  readonly #capabilityState: () => FactMappingPlanV1['capabilityState'];
  readonly #clock: () => Date;
  readonly #confirmations: FactMappingConfirmationBroker<RuntimePayload>;
  readonly #credentialState: () => FactMappingPlanV1['credentialState'];
  readonly #queue: JobQueueService;
  readonly #repository: SqliteFactMappingRepository;
  readonly #worker: JobWorker;
  #workerPromise: Promise<void> | null = null;

  public constructor(database: DatabaseSync, options: DesktopFactMappingRuntimeOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#budgetState = options.budgetState ?? (() => 'UNKNOWN');
    this.#cacheState = options.cacheState ?? (() => 'UNKNOWN');
    this.#capabilityState = options.capabilityState ?? (() => 'UNKNOWN');
    this.#credentialState = options.credentialState ?? (() => 'UNKNOWN');
    this.#confirmations = new FactMappingConfirmationBroker({
      now: () => this.#clock().getTime(),
    });
    this.#repository = new SqliteFactMappingRepository(database);
    this.#repository.recoverInterrupted(this.#clock().toISOString());
    const registry = new JobHandlerRegistry();
    registerFactMappingCheckJob(
      registry,
      new FactMappingCheckService({
        ...(options.modelExecutionService === undefined
          ? {}
          : { modelExecutionService: options.modelExecutionService }),
        ...(options.modelSlot === undefined ? {} : { modelSlot: options.modelSlot }),
        now: () => this.#clock().toISOString(),
        persistence: this.#repository,
      }),
    );
    this.#queue = new JobQueueService(new JobQueueRepository(database), registry, {
      allowedJobTypes: [FACT_MAPPING_JOB_TYPE],
    });
    new JobRecoveryService(this.#queue).recoverExpiredLeases();
    this.#worker = new JobWorker(`fact-mapping-worker-${randomUUID()}`, this.#queue, registry, {
      concurrency: 1,
      heartbeatIntervalMilliseconds: 1_000,
      leaseDurationMilliseconds: 5_000,
      pollingIntervalMilliseconds: 250,
    });
  }

  public start(): void {
    if (this.#workerPromise !== null) return;
    this.#workerPromise = this.#worker.start();
    void this.#workerPromise.catch(() => undefined);
  }

  public list(input: GetFactMappingChecksInput): FactMappingListView {
    return this.#repository.list({
      limit: input.limit,
      offset: input.offset,
      ...(input.status === null ? {} : { status: input.status }),
    });
  }

  public get(input: GetFactMappingCheckInput): FactMappingDetailView {
    return this.#repository.get(input.draftId);
  }

  public getClaimChain(input: GetFactMappingClaimChainInput): FactMappingClaimChainView {
    return this.#repository.getClaimChain(input.statementId);
  }

  public preview(
    input: PreviewFactMappingActionInput,
    senderId: number,
    windowId: number,
  ): FactMappingActionPreview {
    let payload: RuntimePayload;
    if (input.kind === 'START') {
      const preview = this.#repository.previewStart({
        draftId: input.draftId,
        mode: input.mode,
        now: this.#clock().toISOString(),
        ...(input.mode === 'MODEL_ASSISTED'
          ? {
              readiness: {
                budgetState: this.#budgetState(),
                cacheState: this.#cacheState(),
                capabilityState: this.#capabilityState(),
                credentialState: this.#credentialState(),
              },
            }
          : {}),
      });
      payload = Object.freeze({ kind: 'START', plan: preview.plan });
      const issued = this.#confirmations.issue(payload, senderId, windowId);
      return Object.freeze({
        expiresAt: issued.expiresAt,
        kind: input.kind,
        preview: Object.freeze({
          kind: 'START',
          plan: preview.plan,
          writes: preview.writes,
        }),
        previewHash: issued.previewHash,
        token: issued.token,
      });
    }
    payload = Object.freeze({
      executionId: input.executionId,
      expectedRevision: input.expectedRevision,
      kind: 'CANCEL',
    });
    const issued = this.#confirmations.issue(payload, senderId, windowId);
    return Object.freeze({
      expiresAt: issued.expiresAt,
      kind: input.kind,
      preview: payload,
      previewHash: issued.previewHash,
      token: issued.token,
    });
  }

  public confirm(
    input: ConfirmFactMappingActionInput,
    senderId: number,
    windowId: number,
  ): FactMappingActionResult {
    if (input.confirmation !== FACT_MAPPING_CONFIRMATION || input.executionId === null) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_INVALID');
    }
    const payload = this.#confirmations.consume(input.token, input.previewHash, senderId, windowId);
    if (!('kind' in payload) || payload.kind !== input.kind) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_INVALID');
    }
    if (payload.kind === 'CANCEL') {
      if (payload.executionId !== input.executionId) {
        throw new FactMappingError('FACT_MAPPING_CONFIRMATION_INVALID');
      }
      const jobId = this.#repository.jobIdForExecution(payload.executionId);
      const run = this.#repository.cancelRun({
        executionId: payload.executionId,
        expectedRevision: payload.expectedRevision,
        now: this.#clock().toISOString(),
      });
      if (jobId !== null) this.#queue.requestCancel(jobId);
      return Object.freeze({
        kind: 'CANCEL',
        run,
      });
    }
    if (payload.plan.mode === 'MODEL_ASSISTED') {
      if (
        payload.plan.capabilityState !== 'SUPPORTED' ||
        payload.plan.budgetState !== 'AVAILABLE' ||
        payload.plan.credentialState !== 'AVAILABLE'
      ) {
        throw new FactMappingError('FACT_MAPPING_MODEL_BLOCKED');
      }
    }
    const prepared = this.#repository.prepareQueuedStart({
      executionId: input.executionId,
      now: this.#clock().toISOString(),
      planId: payload.plan.planId,
      previewHash: payload.plan.previewHash,
    });
    const job = this.#queue.enqueueJob({
      idempotencyKey: `fact-mapping:${input.executionId}`,
      jobType: FACT_MAPPING_JOB_TYPE,
      maxAttempts: 1,
      payload: prepared.payload,
      priority: 0,
    });
    return Object.freeze({
      enqueueRequired: true as const,
      kind: 'START',
      run: this.#repository.markRunQueued(input.executionId, job.id, this.#clock().toISOString()),
    });
  }

  public previewDecision(
    input: PreviewFactMappingDecisionInput,
    senderId: number,
    windowId: number,
  ): FactMappingDecisionPreview {
    const preview = this.#repository.previewDecision(input, this.#clock().toISOString());
    const issued = this.#confirmations.issue(
      Object.freeze({ decision: input, preview }),
      senderId,
      windowId,
    );
    return Object.freeze({
      expiresAt: issued.expiresAt,
      preview,
      previewHash: issued.previewHash,
      token: issued.token,
    });
  }

  public confirmDecision(
    input: ConfirmFactMappingDecisionInput,
    senderId: number,
    windowId: number,
  ): FactMappingDecisionResult {
    if (input.confirmation !== FACT_MAPPING_CONFIRMATION) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_INVALID');
    }
    const payload = this.#confirmations.consume(input.token, input.previewHash, senderId, windowId);
    if (!('decision' in payload) || payload.decision.kind !== input.kind) {
      throw new FactMappingError('FACT_MAPPING_CONFIRMATION_INVALID');
    }
    return this.#repository.applyDecision({
      decision: payload.decision,
      executionId: input.executionId,
      now: this.#clock().toISOString(),
      previewHash: input.previewHash,
    });
  }

  public clearWindow(windowId: number): void {
    this.#confirmations.clearWindow(windowId);
  }

  public async close(): Promise<void> {
    if (this.#workerPromise === null) return;
    await this.#worker.shutdown(5_000);
    await this.#workerPromise;
    this.#workerPromise = null;
  }
}
