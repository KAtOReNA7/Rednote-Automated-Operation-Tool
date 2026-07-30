import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  TOPIC_GENERATE_JOB_TYPE,
  TOPIC_QUOTA_PLAN_JOB_TYPE,
  TOPIC_CONTENT_TYPES,
  TopicConfirmationBroker,
  TopicError,
} from '@mystery-operations/topics';
import {
  JobQueueRepository,
  SqliteTopicRepository,
  type TopicBatchStatePreview,
  type TopicGenerationCancelPreview,
  type TopicGenerationRepositoryPreview,
  type TopicQuotaRepositoryPreview,
  type TopicStateActionPreview,
} from '@mystery-operations/db';
import type {
  ConfirmTopicActionInput,
  GetTopicInput,
  GetTopicPoolInput,
  PreviewTopicActionInput,
  TopicActionPreview,
  TopicActionPreviewView,
  TopicActionResult,
  TopicDetailView,
  TopicPoolWorkspaceView,
} from '@mystery-operations/shared';
import {
  JobHandlerRegistry,
  JobQueueService,
  JobRecoveryService,
  JobWorker,
  registerTopicPlanningJobs,
} from '@mystery-operations/workflows';

type TopicRuntimePayload =
  | { readonly kind: 'GENERATE'; readonly preview: TopicGenerationRepositoryPreview }
  | {
      readonly kind: 'STATE_CHANGE' | 'STATE_UNDO';
      readonly preview: TopicStateActionPreview;
    }
  | { readonly kind: 'BATCH_STATE_CHANGE'; readonly preview: TopicBatchStatePreview }
  | { readonly kind: 'QUOTA_PLAN'; readonly preview: TopicQuotaRepositoryPreview }
  | { readonly kind: 'CANCEL_GENERATION'; readonly preview: TopicGenerationCancelPreview };

function publicPreview(payload: TopicRuntimePayload): TopicActionPreviewView {
  switch (payload.kind) {
    case 'GENERATE':
      return Object.freeze({
        counts: payload.preview.counts,
        deduplicationLimit: payload.preview.deduplicationLimit,
        estimatedLocalWrites: payload.preview.estimatedLocalWrites,
        estimatedModelRequests: 0,
        expectedPolicyVersions: payload.preview.expectedPolicyVersions,
        inputWorkCount: payload.preview.inputWorkCount,
        kind: payload.kind,
        localCombinationUpperBound: payload.preview.localCombinationUpperBound,
        modelExecutionState: payload.preview.modelExecutionState,
        planHash: payload.preview.planHash,
      });
    case 'STATE_CHANGE':
    case 'STATE_UNDO':
      return Object.freeze({
        action: payload.preview.action,
        after: payload.preview.after,
        before: payload.preview.before,
        expectedRevision: payload.preview.expectedRevision,
        kind: payload.kind,
        topicId: payload.preview.topicId,
      });
    case 'BATCH_STATE_CHANGE':
      return Object.freeze({
        action: payload.preview.action,
        items: Object.freeze(
          payload.preview.items.map((item) =>
            Object.freeze({
              after: item.after,
              before: item.before,
              expectedRevision: item.expectedRevision,
              topicId: item.topicId,
            }),
          ),
        ),
        kind: payload.kind,
      });
    case 'QUOTA_PLAN':
      return Object.freeze({
        categories: Object.freeze(
          TOPIC_CONTENT_TYPES.map((type) => payload.preview.result.categories[type]),
        ),
        kind: payload.kind,
        maxWorkExposure: payload.preview.maxWorkExposure,
        noOp: payload.preview.noOp,
        poolSnapshotHash: payload.preview.result.poolSnapshotHash,
        status: payload.preview.result.status,
        totalRequired: 30,
        totalSelected: payload.preview.result.totalSelected,
        warnings: payload.preview.result.warnings,
      });
    case 'CANCEL_GENERATION':
      return Object.freeze({
        expectedRevision: payload.preview.expectedRevision,
        kind: payload.kind,
        runId: payload.preview.runId,
      });
  }
}

export class DesktopTopicRuntime {
  readonly #clock: () => Date;
  readonly #confirmations: TopicConfirmationBroker<TopicRuntimePayload>;
  readonly #queue: JobQueueService;
  readonly #repository: SqliteTopicRepository;
  readonly #worker: JobWorker;
  #workerPromise: Promise<void> | null = null;

  public constructor(database: DatabaseSync, clock: () => Date = () => new Date()) {
    this.#clock = clock;
    this.#confirmations = new TopicConfirmationBroker<TopicRuntimePayload>(clock);
    this.#repository = new SqliteTopicRepository(database);
    const registry = new JobHandlerRegistry();
    registerTopicPlanningJobs(registry, this.#repository);
    this.#queue = new JobQueueService(new JobQueueRepository(database), registry, {
      allowedJobTypes: [TOPIC_GENERATE_JOB_TYPE, TOPIC_QUOTA_PLAN_JOB_TYPE],
    });
    new JobRecoveryService(this.#queue).recoverExpiredLeases();
    this.#worker = new JobWorker(`topic-worker-${randomUUID()}`, this.#queue, registry, {
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

  public list(input: GetTopicPoolInput): TopicPoolWorkspaceView {
    const pool = this.#repository.listPool(input.profileId, {
      contentType: input.contentType,
      eligibility: input.eligibility,
      limit: input.limit,
      offset: input.offset,
      query: input.query,
      state: input.state,
    });
    return Object.freeze({
      ...pool,
      currentPlan: this.#repository.getCurrentQuotaPlan(input.profileId),
      planHistory: this.#repository.listQuotaPlanHistory(input.profileId, 20),
      recentGenerationRuns: this.#repository.listGenerationRuns(input.profileId, 20),
    });
  }

  public get(input: GetTopicInput): TopicDetailView {
    return this.#repository.getTopic(input.topicId, input.historyLimit);
  }

  public preview(
    input: PreviewTopicActionInput,
    senderId: number,
    windowId: number,
  ): TopicActionPreview {
    const payload = this.#previewPayload(input);
    const issued = this.#confirmations.issue(payload, senderId, windowId);
    return Object.freeze({
      expiresAt: issued.expiresAt,
      kind: payload.kind,
      preview: publicPreview(payload),
      previewHash: issued.previewHash,
      token: issued.token,
    });
  }

  public confirm(
    input: ConfirmTopicActionInput,
    senderId: number,
    windowId: number,
  ): TopicActionResult {
    if (input.confirmation !== 'APPLY_TOPIC_ACTION') {
      throw new TopicError('TOPIC_CONFIRMATION_INVALID');
    }
    const payload = this.#confirmations.consume(input.token, input.previewHash, senderId, windowId);
    if (payload.kind !== input.kind) throw new TopicError('TOPIC_CONFIRMATION_INVALID');
    const now = this.#clock().toISOString();
    switch (payload.kind) {
      case 'GENERATE':
        if (input.executionId === null) throw new TopicError('TOPIC_CONFIRMATION_INVALID');
        {
          const prepared = this.#repository.prepareGeneration(
            payload.preview,
            input.executionId,
            now,
          );
          if (prepared.enqueue && prepared.payload !== null) {
            const job = this.#queue.enqueueJob({
              idempotencyKey: `topic-generation:${input.executionId}`,
              jobType: TOPIC_GENERATE_JOB_TYPE,
              maxAttempts: 3,
              payload: prepared.payload,
              priority: 0,
            });
            this.#repository.markGenerationQueued(input.executionId, job.id, now);
          }
          return Object.freeze({
            generation: prepared.run,
            kind: payload.kind,
          });
        }
      case 'STATE_CHANGE':
      case 'STATE_UNDO':
        if (input.executionId !== null) throw new TopicError('TOPIC_CONFIRMATION_INVALID');
        return Object.freeze({
          detail: this.#repository.applyStateChange(payload.preview, now),
          kind: payload.kind,
        });
      case 'BATCH_STATE_CHANGE':
        if (input.executionId !== null) throw new TopicError('TOPIC_CONFIRMATION_INVALID');
        return Object.freeze({
          batch: this.#repository.applyBatchState(payload.preview, now),
          kind: payload.kind,
        });
      case 'QUOTA_PLAN':
        if (input.executionId === null) throw new TopicError('TOPIC_CONFIRMATION_INVALID');
        {
          const prepared = this.#repository.prepareQuotaPlanJob(
            payload.preview,
            input.executionId,
            now,
          );
          if (prepared.enqueue && prepared.payload !== null) {
            const job = this.#queue.enqueueJob({
              idempotencyKey: `topic-quota:${input.executionId}`,
              jobType: TOPIC_QUOTA_PLAN_JOB_TYPE,
              maxAttempts: 3,
              payload: prepared.payload,
              priority: 0,
            });
            this.#repository.markQuotaPlanQueued(input.executionId, job.id, now);
          }
          return Object.freeze({
            kind: payload.kind,
            quota: Object.freeze({
              executionId: prepared.executionId,
              expectedPlanStatus: payload.preview.result.status,
              externalRequestCount: 0,
              planVersionId: prepared.planVersionId,
              runId: prepared.runId,
              status: prepared.status,
              totalSelected: payload.preview.result.totalSelected,
            }),
          });
        }
      case 'CANCEL_GENERATION':
        if (input.executionId !== null) throw new TopicError('TOPIC_CONFIRMATION_INVALID');
        {
          const cancelled = this.#repository.cancelGeneration(
            payload.preview.runId,
            payload.preview.expectedRevision,
            now,
          );
          if (cancelled.jobId !== null) this.#queue.requestCancel(cancelled.jobId);
          return Object.freeze({
            kind: payload.kind,
            run: Object.freeze({
              revision: cancelled.revision,
              runId: cancelled.runId,
              status: cancelled.status,
            }),
          });
        }
    }
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

  #previewPayload(input: PreviewTopicActionInput): TopicRuntimePayload {
    switch (input.kind) {
      case 'GENERATE':
        return Object.freeze({
          kind: input.kind,
          preview: this.#repository.previewGeneration(input.profileId, this.#clock().toISOString()),
        });
      case 'STATE_CHANGE':
        return Object.freeze({
          kind: input.kind,
          preview: this.#repository.previewStateChange(input.draft),
        });
      case 'STATE_UNDO':
        return Object.freeze({
          kind: input.kind,
          preview: this.#repository.previewUndo(input.topicId, input.expectedRevision),
        });
      case 'BATCH_STATE_CHANGE':
        return Object.freeze({
          kind: input.kind,
          preview: this.#repository.previewBatchState(input.draft),
        });
      case 'QUOTA_PLAN':
        return Object.freeze({
          kind: input.kind,
          preview: this.#repository.previewQuotaPlan(input.profileId, input.maxWorkExposure),
        });
      case 'CANCEL_GENERATION':
        return Object.freeze({
          kind: input.kind,
          preview: this.#repository.previewCancelGeneration(input.runId, input.expectedRevision),
        });
    }
  }
}
