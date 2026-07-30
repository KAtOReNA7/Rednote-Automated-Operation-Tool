import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  COPY_CONFIRMATION_LITERAL,
  COPY_GENERATE_JOB_TYPE,
  COPY_REWRITE_JOB_TYPE,
  CopyConfirmationBroker,
  CopyError,
  assertContentDraftPayload,
  buildManualCopyScaffold,
  copySemanticHash,
  validateDraftStructure,
  type ContentDraftPayloadV1,
  type CopyMutationPlanV1,
} from '@mystery-operations/copy';
import {
  JobQueueRepository,
  SqliteBriefRepository,
  SqliteCopyRepository,
} from '@mystery-operations/db';
import type {
  ConfirmCopyActionInput,
  CopyActionPreview,
  CopyActionPreviewView,
  CopyActionResult,
  CopyDraftDetailView,
  CopyDraftListView,
  CopyDraftVersionDiffView,
  DiffCopyDraftVersionsInput,
  GetCopyDraftInput,
  GetCopyDraftsInput,
  PreviewCopyActionInput,
} from '@mystery-operations/shared';
import {
  CopyGenerationService,
  JobHandlerRegistry,
  JobQueueService,
  JobRecoveryService,
  JobWorker,
  registerCopyMutationJobs,
  type CopyModelSlotV1,
  type ModelExecutionService,
} from '@mystery-operations/workflows';

type CopyInputFor<K extends PreviewCopyActionInput['kind']> = PreviewCopyActionInput & {
  readonly kind: K;
};

type CopyRuntimePayload =
  | {
      readonly briefHash: string;
      readonly input: CopyInputFor<'CREATE_MANUAL_SCAFFOLD'>;
      readonly kind: 'CREATE_MANUAL_SCAFFOLD';
      readonly scaffold: ContentDraftPayloadV1;
    }
  | {
      readonly input: CopyInputFor<'SAVE_VERSION'>;
      readonly kind: 'SAVE_VERSION';
    }
  | {
      readonly input: CopyInputFor<'LOCK_FIELD' | 'UNLOCK_FIELD'>;
      readonly kind: 'LOCK_FIELD' | 'UNLOCK_FIELD';
    }
  | {
      readonly input: CopyInputFor<'REORDER_BLOCKS'>;
      readonly kind: 'REORDER_BLOCKS';
    }
  | {
      readonly input: CopyInputFor<'UNDO'>;
      readonly kind: 'UNDO';
    }
  | {
      readonly input: CopyInputFor<'ARCHIVE' | 'RESTORE'>;
      readonly kind: 'ARCHIVE' | 'RESTORE';
    }
  | {
      readonly input: CopyInputFor<'PREVIEW_GENERATION' | 'PREVIEW_REWRITE'>;
      readonly kind: 'PREVIEW_GENERATION' | 'PREVIEW_REWRITE';
      readonly plan: CopyMutationPlanV1;
    }
  | {
      readonly input: CopyInputFor<'CANCEL_MUTATION'>;
      readonly kind: 'CANCEL_MUTATION';
    };

function changedFields(left: ContentDraftPayloadV1, right: ContentDraftPayloadV1) {
  return Object.freeze(
    [
      'titles',
      'selectedTitleId',
      'blocks',
      'tags',
      'pinnedComment',
      'spoilerWarnings',
      'fieldStates',
    ].filter(
      (field) =>
        copySemanticHash(left[field as keyof ContentDraftPayloadV1]) !==
        copySemanticHash(right[field as keyof ContentDraftPayloadV1]),
    ),
  );
}

export interface DesktopCopyRuntimeOptions {
  readonly budgetState?: () => CopyMutationPlanV1['budgetState'];
  readonly capabilityState?: () => CopyMutationPlanV1['capabilityState'];
  readonly clock?: () => Date;
  readonly modelExecutionService?: ModelExecutionService;
  readonly modelSlot?: CopyModelSlotV1;
}

export class DesktopCopyRuntime {
  readonly #briefs: SqliteBriefRepository;
  readonly #budgetState: () => CopyMutationPlanV1['budgetState'];
  readonly #capabilityState: () => CopyMutationPlanV1['capabilityState'];
  readonly #clock: () => Date;
  readonly #confirmations: CopyConfirmationBroker<CopyRuntimePayload>;
  readonly #queue: JobQueueService;
  readonly #repository: SqliteCopyRepository;
  readonly #worker: JobWorker;
  #workerPromise: Promise<void> | null = null;

  public constructor(database: DatabaseSync, options: DesktopCopyRuntimeOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#budgetState = options.budgetState ?? (() => 'UNKNOWN');
    this.#capabilityState = options.capabilityState ?? (() => 'UNKNOWN');
    this.#confirmations = new CopyConfirmationBroker({ now: () => this.#clock().getTime() });
    this.#briefs = new SqliteBriefRepository(database);
    this.#repository = new SqliteCopyRepository(database);
    this.#repository.recoverInterrupted(this.#clock().toISOString());
    const registry = new JobHandlerRegistry();
    registerCopyMutationJobs(
      registry,
      new CopyGenerationService({
        ...(options.modelExecutionService === undefined
          ? {}
          : { modelExecutionService: options.modelExecutionService }),
        ...(options.modelSlot === undefined ? {} : { modelSlot: options.modelSlot }),
        persistence: this.#repository,
      }),
    );
    this.#queue = new JobQueueService(new JobQueueRepository(database), registry, {
      allowedJobTypes: [COPY_GENERATE_JOB_TYPE, COPY_REWRITE_JOB_TYPE],
    });
    new JobRecoveryService(this.#queue).recoverExpiredLeases();
    this.#worker = new JobWorker(`copy-worker-${randomUUID()}`, this.#queue, registry, {
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

  public list(input: GetCopyDraftsInput): CopyDraftListView {
    return this.#repository.list(input);
  }

  public get(input: GetCopyDraftInput): CopyDraftDetailView {
    return this.#repository.get(input.draftId, input);
  }

  public diff(input: DiffCopyDraftVersionsInput): CopyDraftVersionDiffView {
    return this.#repository.diffVersions(input.draftId, input.fromVersionId, input.toVersionId);
  }

  public preview(
    input: PreviewCopyActionInput,
    senderId: number,
    windowId: number,
  ): CopyActionPreview {
    const payload = this.#previewPayload(input);
    const issued = this.#confirmations.issue(payload, senderId, windowId);
    return Object.freeze({
      expiresAt: issued.expiresAt,
      kind: payload.kind,
      preview: this.#publicPreview(payload),
      previewHash: issued.previewHash,
      token: issued.token,
    });
  }

  public confirm(
    input: ConfirmCopyActionInput,
    senderId: number,
    windowId: number,
  ): CopyActionResult {
    if (input.confirmation !== COPY_CONFIRMATION_LITERAL) {
      throw new CopyError('COPY_CONFIRMATION_INVALID');
    }
    const payload = this.#confirmations.consume(input.token, input.previewHash, senderId, windowId);
    if (payload.kind !== input.kind) throw new CopyError('COPY_CONFIRMATION_INVALID');
    const now = this.#clock().toISOString();
    switch (payload.kind) {
      case 'CREATE_MANUAL_SCAFFOLD': {
        if (input.executionId !== null) throw new CopyError('COPY_CONFIRMATION_INVALID');
        const current = this.#scaffold(payload.input.briefId);
        if (
          copySemanticHash(current.scaffold) !== copySemanticHash(payload.scaffold) ||
          current.briefHash !== payload.briefHash
        ) {
          throw new CopyError('COPY_STALE_REVISION', undefined, true);
        }
        return Object.freeze({
          detail: this.#repository.createManualScaffold(payload.scaffold, now),
          kind: payload.kind,
        });
      }
      case 'SAVE_VERSION':
        if (input.executionId !== null) throw new CopyError('COPY_CONFIRMATION_INVALID');
        return Object.freeze({
          detail: this.#repository.saveVersion(
            payload.input.draftId,
            payload.input.expectedRevision,
            payload.input.payload,
            ['USER_EDIT'],
            now,
          ),
          kind: payload.kind,
        });
      case 'LOCK_FIELD':
      case 'UNLOCK_FIELD':
        if (input.executionId !== null) throw new CopyError('COPY_CONFIRMATION_INVALID');
        return Object.freeze({
          detail: this.#repository.changeFieldLock(
            payload.input.draftId,
            payload.input.expectedRevision,
            payload.input.fieldPath,
            payload.kind === 'LOCK_FIELD' ? 'USER_LOCKED' : 'EDITABLE',
            now,
          ),
          kind: payload.kind,
        });
      case 'REORDER_BLOCKS':
        if (input.executionId !== null) throw new CopyError('COPY_CONFIRMATION_INVALID');
        return Object.freeze({
          detail: this.#repository.reorderBlocks(
            payload.input.draftId,
            payload.input.expectedRevision,
            payload.input.blockIds,
            now,
          ),
          kind: payload.kind,
        });
      case 'UNDO':
        if (input.executionId !== null) throw new CopyError('COPY_CONFIRMATION_INVALID');
        return Object.freeze({
          detail: this.#repository.undo(
            payload.input.draftId,
            payload.input.expectedRevision,
            payload.input.targetVersionId,
            now,
          ),
          kind: payload.kind,
        });
      case 'ARCHIVE':
      case 'RESTORE':
        if (input.executionId !== null) throw new CopyError('COPY_CONFIRMATION_INVALID');
        return Object.freeze({
          detail: this.#repository.setArchived(
            payload.input.draftId,
            payload.input.expectedRevision,
            payload.kind === 'ARCHIVE',
            now,
          ),
          kind: payload.kind,
        });
      case 'PREVIEW_GENERATION':
      case 'PREVIEW_REWRITE': {
        if (input.executionId === null) throw new CopyError('COPY_CONFIRMATION_INVALID');
        const prepared = this.#repository.confirmMutation(
          payload.plan.planId,
          payload.plan.previewHash,
          input.executionId,
          now,
        );
        const job = this.#queue.enqueueJob({
          idempotencyKey: `copy:${input.executionId}`,
          jobType:
            payload.kind === 'PREVIEW_GENERATION' ? COPY_GENERATE_JOB_TYPE : COPY_REWRITE_JOB_TYPE,
          maxAttempts: 1,
          payload: prepared.payload,
          priority: 0,
        });
        const run = this.#repository.markMutationQueued(input.executionId, job.id, now);
        return Object.freeze({
          kind: payload.kind,
          mutation: Object.freeze({ enqueueRequired: true as const, run }),
        });
      }
      case 'CANCEL_MUTATION': {
        if (input.executionId !== null) throw new CopyError('COPY_CONFIRMATION_INVALID');
        const cancelled = this.#repository.cancelMutation(payload.input.runId, now);
        if (cancelled.jobId !== null) this.#queue.requestCancel(cancelled.jobId);
        return Object.freeze({ kind: payload.kind, run: cancelled.run });
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

  #previewPayload(input: PreviewCopyActionInput): CopyRuntimePayload {
    switch (input.kind) {
      case 'CREATE_MANUAL_SCAFFOLD': {
        const scaffold = this.#scaffold(input.briefId);
        return Object.freeze({ input, kind: input.kind, ...scaffold });
      }
      case 'SAVE_VERSION':
        assertContentDraftPayload(input.payload);
        this.#repository.get(input.draftId);
        return Object.freeze({ input, kind: input.kind });
      case 'LOCK_FIELD':
      case 'UNLOCK_FIELD':
      case 'REORDER_BLOCKS':
      case 'UNDO':
      case 'ARCHIVE':
      case 'RESTORE':
      case 'CANCEL_MUTATION':
        return Object.freeze({ input, kind: input.kind }) as CopyRuntimePayload;
      case 'PREVIEW_GENERATION':
        return Object.freeze({
          input: { ...input, kind: 'PREVIEW_GENERATION' as const },
          kind: input.kind,
          plan: this.#repository.previewMutation({
            budgetState: this.#budgetState(),
            capabilityState: this.#capabilityState(),
            draftId: input.draftId,
            expectedRevision: input.expectedRevision,
            expiresAt: new Date(this.#clock().getTime() + 5 * 60 * 1_000).toISOString(),
            now: this.#clock().toISOString(),
            operation: 'FULL_GENERATION',
          }),
        });
      case 'PREVIEW_REWRITE':
        return Object.freeze({
          input,
          kind: input.kind,
          plan: this.#repository.previewMutation({
            budgetState: this.#budgetState(),
            capabilityState: this.#capabilityState(),
            draftId: input.draftId,
            expectedRevision: input.expectedRevision,
            expiresAt: new Date(this.#clock().getTime() + 5 * 60 * 1_000).toISOString(),
            now: this.#clock().toISOString(),
            operation: 'REWRITE',
            rewriteInstruction: input.instruction,
            rewriteScope: input.scope,
          }),
        });
    }
  }

  #publicPreview(payload: CopyRuntimePayload): CopyActionPreviewView {
    switch (payload.kind) {
      case 'CREATE_MANUAL_SCAFFOLD': {
        const result = validateDraftStructure(payload.scaffold, this.#clock().toISOString());
        return Object.freeze({
          briefId: payload.input.briefId,
          kind: payload.kind,
          profileId: payload.scaffold.profileId,
          structuralReasonCodes: result.reasonCodes,
        });
      }
      case 'SAVE_VERSION': {
        const current = this.#repository.get(payload.input.draftId);
        const result = validateDraftStructure(payload.input.payload, this.#clock().toISOString());
        return Object.freeze({
          changedFields: changedFields(current.payload, payload.input.payload),
          draftId: payload.input.draftId,
          expectedRevision: payload.input.expectedRevision,
          kind: payload.kind,
          structuralReasonCodes: result.reasonCodes,
        });
      }
      case 'LOCK_FIELD':
      case 'UNLOCK_FIELD':
        return Object.freeze({
          draftId: payload.input.draftId,
          expectedRevision: payload.input.expectedRevision,
          fieldPath: payload.input.fieldPath,
          kind: payload.kind,
        });
      case 'REORDER_BLOCKS':
        return Object.freeze({
          blockIds: payload.input.blockIds,
          draftId: payload.input.draftId,
          expectedRevision: payload.input.expectedRevision,
          kind: payload.kind,
        });
      case 'UNDO':
        return Object.freeze({
          draftId: payload.input.draftId,
          expectedRevision: payload.input.expectedRevision,
          kind: payload.kind,
          targetVersionId: payload.input.targetVersionId,
        });
      case 'ARCHIVE':
      case 'RESTORE':
        return Object.freeze({
          draftId: payload.input.draftId,
          expectedRevision: payload.input.expectedRevision,
          kind: payload.kind,
        });
      case 'PREVIEW_GENERATION':
      case 'PREVIEW_REWRITE':
        return Object.freeze({
          ...payload.plan,
          kind: payload.kind,
          noNetworkBeforeConfirmation: true as const,
        });
      case 'CANCEL_MUTATION':
        return Object.freeze({ kind: payload.kind, runId: payload.input.runId });
    }
  }

  #scaffold(briefId: string): {
    readonly briefHash: string;
    readonly scaffold: ContentDraftPayloadV1;
  } {
    const detail = this.#briefs.get(briefId, {
      evidenceLimit: 100,
      evidenceOffset: 0,
      generationLimit: 1,
      generationOffset: 0,
      historyLimit: 1,
      historyOffset: 0,
      versionLimit: 1,
      versionOffset: 0,
    });
    if (detail.readiness !== 'READY_FOR_DRAFT_GENERATION' || detail.stale) {
      throw new CopyError('COPY_GENERATION_BLOCKED');
    }
    const current = detail.versionHistory.items.find(({ isCurrent }) => isCurrent);
    if (current === undefined) throw new CopyError('COPY_CONFLICT');
    const briefHash = copySemanticHash(detail.draft);
    return Object.freeze({
      briefHash,
      scaffold: buildManualCopyScaffold({
        briefId: detail.briefId,
        briefInputHash: briefHash,
        briefLockHash: copySemanticHash(detail.draft.fieldStates),
        briefVersionId: current.versionId,
        dependencies: detail.dependencies,
        draft: detail.draft,
      }),
    });
  }
}
