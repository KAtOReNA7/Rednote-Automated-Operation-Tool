import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  BIBLIOGRAPHY_JOB_TYPE,
  BIBLIOGRAPHY_NORMALIZATION_VERSION,
  BibliographyDiscoveryService,
  CatalogConfirmationBroker,
  CatalogError,
  DISCOVERY_PLAN_VERSION,
  DISCOVERY_PROFILE_VERSION,
  ENTITY_RESOLUTION_RULE_VERSION,
  discoveryPlanHash,
  type DiscoveryPlanV1,
} from '@mystery-operations/catalog';
import {
  JobQueueRepository,
  SqliteCatalogRepository,
  type CatalogRunViewV1,
  type CatalogSummaryViewV1,
  type CatalogWorkDetailV1,
  type UndoDecisionPreviewV1,
  type WorkMergePreviewV1,
  type WorkSplitPreviewV1,
} from '@mystery-operations/db';
import type {
  CancelCatalogDiscoveryInput,
  CatalogActionKind,
  CatalogActionPreview,
  CatalogActionResult,
  CatalogDiscoveryPreview,
  CatalogOriginKind,
  ConfirmCatalogActionInput,
  ConfirmCatalogDiscoveryInput,
  GetCatalogStateInput,
  PreviewCatalogDiscoveryInput,
  PreviewCatalogUndoInput,
  PreviewCatalogWorkMergeInput,
  PreviewCatalogWorkSplitInput,
} from '@mystery-operations/shared';
import {
  JobHandlerRegistry,
  JobQueueService,
  JobWorker,
  registerBibliographyDiscoveryJob,
} from '@mystery-operations/workflows';

interface DiscoveryConfirmation {
  readonly expectedRevision: number;
  readonly planHash: string;
  readonly planId: string;
  readonly runId: string;
}

type CatalogActionConfirmation =
  | { readonly kind: 'MERGE_WORKS'; readonly preview: WorkMergePreviewV1 }
  | { readonly kind: 'SPLIT_WORK'; readonly preview: WorkSplitPreviewV1 }
  | { readonly kind: 'UNDO_DECISION'; readonly preview: UndoDecisionPreviewV1 };

const PROFILE_STRATA = Object.freeze([
  ['japan-mystery', '日本推理', true],
  ['western-mystery', '欧美推理', true],
  ['chinese-publishing', '华语出版', true],
  ['chinese-web', '华语网络', true],
  ['original-language', '原文', false],
  ['translated-language', '译文', false],
  ['paper-format', '纸质版', false],
  ['electronic-format', '电子版', false],
  ['web-serial-format', '网络连载', false],
  ['strong-identifier', '强标识', false],
  ['no-strong-identifier', '无强标识', false],
  ['new-candidate', '新增候选', false],
  ['existing-catalog', '既有书目', false],
  ['time-unknown', '时间未知', false],
] as const);

function actionPreview(
  kind: CatalogActionKind,
  issued: {
    readonly expiresAt: string;
    readonly previewHash: string;
    readonly token: string;
  },
  summary: Readonly<Record<string, number | string | readonly string[]>>,
): CatalogActionPreview {
  return Object.freeze({ ...issued, kind, summary });
}

export class DesktopCatalogRuntime {
  readonly #actions = new CatalogConfirmationBroker<CatalogActionConfirmation>();
  readonly #discovery = new CatalogConfirmationBroker<DiscoveryConfirmation>();
  readonly #queue: JobQueueService;
  readonly #repository: SqliteCatalogRepository;
  readonly #worker: JobWorker;
  #workerPromise: Promise<void> | null = null;

  public constructor(database: DatabaseSync) {
    this.#repository = new SqliteCatalogRepository(database);
    const service = new BibliographyDiscoveryService(this.#repository);
    const registry = new JobHandlerRegistry();
    registerBibliographyDiscoveryJob(registry, service);
    this.#queue = new JobQueueService(new JobQueueRepository(database), registry, {
      allowedJobTypes: [BIBLIOGRAPHY_JOB_TYPE],
    });
    this.#worker = new JobWorker(`catalog-worker-${randomUUID()}`, this.#queue, registry, {
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

  public getState(input: GetCatalogStateInput): CatalogSummaryViewV1 {
    return this.#repository.getSummary(input.limit, input.offset, input.query);
  }

  public getWork(workId: string): CatalogWorkDetailV1 | null {
    return this.#repository.getWorkDetail(workId);
  }

  public previewDiscovery(
    input: PreviewCatalogDiscoveryInput,
    senderId: number,
    windowId: number,
  ): CatalogDiscoveryPreview {
    const now = new Date();
    const profileId = `profile-${randomUUID()}`;
    const planId = `plan-${randomUUID()}`;
    const runId = `run-${randomUUID()}`;
    const scope = {
      originKinds: input.originKinds as readonly CatalogOriginKind[],
      originRecordIds: Object.freeze([]) as readonly string[],
    };
    const origins = this.#repository.listAvailableOrigins(scope, input.maxObservations);
    const target = origins.length === 0 ? 0 : Math.max(1, Math.ceil(origins.length / 4));
    const profile = Object.freeze({
      contractVersion: DISCOVERY_PROFILE_VERSION,
      normalizationVersion: BIBLIOGRAPHY_NORMALIZATION_VERSION,
      profileId,
      purpose: input.purpose,
      resolutionRuleVersion: ENTITY_RESOLUTION_RULE_VERSION,
      revision: 1,
      strata: Object.freeze(
        PROFILE_STRATA.map(([stratumId, label, required], priority) =>
          Object.freeze({
            allowedOriginKinds: Object.freeze([...input.originKinds]),
            gapPolicy: required ? ('REQUIRE_PROCESSED' as const) : ('ALLOW_EXPLAINED' as const),
            label,
            priority,
            required,
            stratumId,
            targetObservations: required ? target : 0,
          }),
        ),
      ),
      synthetic: false as const,
    });
    const withoutHash = {
      contractVersion: DISCOVERY_PLAN_VERSION,
      createdAt: now.toISOString(),
      estimatedExternalRequests: 0 as const,
      estimatedLocalOperations: origins.length,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      inputScope: scope,
      limits: Object.freeze({
        batchSize: input.batchSize,
        maxCandidateComparisons: input.maxObservations * 20,
        maxConcurrency: 1,
        maxDatabaseWrites: Math.max(input.maxObservations * 20, 1),
        maxObservations: input.maxObservations,
        maxRuntimeMs: input.maxRuntimeMs,
      }),
      planId,
      profile,
    };
    const plan: DiscoveryPlanV1 = Object.freeze({
      ...withoutHash,
      planHash: discoveryPlanHash(withoutHash),
    });
    const run = this.#repository.createDiscoveryPreview(plan, runId, origins);
    const issued = this.#discovery.issue(
      {
        expectedRevision: run.revision,
        planHash: plan.planHash,
        planId,
        runId,
      },
      senderId,
      windowId,
    );
    return Object.freeze({
      expiresAt: issued.expiresAt,
      originCount: origins.length,
      planHash: plan.planHash,
      previewHash: issued.previewHash,
      profile: Object.freeze({
        profileId,
        strata: Object.freeze(
          profile.strata.map((stratum) =>
            Object.freeze({
              label: stratum.label,
              required: stratum.required,
              stratumId: stratum.stratumId,
              targetObservations: stratum.targetObservations,
            }),
          ),
        ),
        synthetic: false as const,
      }),
      run,
      token: issued.token,
    });
  }

  public confirmDiscovery(
    input: ConfirmCatalogDiscoveryInput,
    senderId: number,
    windowId: number,
  ): CatalogRunViewV1 {
    if (input.confirmation !== 'START_BIBLIOGRAPHY_DISCOVERY') {
      throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
    }
    const confirmation = this.#discovery.consume(
      input.token,
      input.previewHash,
      senderId,
      windowId,
    );
    if (confirmation.expectedRevision !== input.expectedRevision) {
      throw new CatalogError('CATALOG_STALE_REVISION', { retryable: true });
    }
    const now = new Date().toISOString();
    this.#repository.confirmDiscoveryRun(confirmation.runId, confirmation.expectedRevision, now);
    const executionId = `execution-${randomUUID()}`;
    const job = this.#queue.enqueueJob({
      idempotencyKey: `bibliography:${confirmation.runId}`,
      jobType: BIBLIOGRAPHY_JOB_TYPE,
      maxAttempts: 3,
      payload: {
        executionId,
        planHash: confirmation.planHash,
        planId: confirmation.planId,
        runId: confirmation.runId,
        versions: {
          normalization: BIBLIOGRAPHY_NORMALIZATION_VERSION,
          resolution: ENTITY_RESOLUTION_RULE_VERSION,
        },
      },
      priority: 0,
    });
    this.#repository.attachDiscoveryJob(confirmation.runId, job.id, now);
    return this.#repository.getDiscoveryRun(confirmation.runId);
  }

  public cancelDiscovery(input: CancelCatalogDiscoveryInput): CatalogRunViewV1 {
    if (input.confirmation !== 'CANCEL_BIBLIOGRAPHY_DISCOVERY') {
      throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
    }
    const run = this.#repository.getDiscoveryRun(input.runId);
    if (run.revision !== input.expectedRevision) {
      throw new CatalogError('CATALOG_STALE_REVISION', { retryable: true });
    }
    if (run.jobId !== null && ['CONFIRMED', 'RUNNING'].includes(run.status)) {
      this.#queue.requestCancel(run.jobId);
      return run;
    }
    return this.#repository.cancelDiscoveryRun(
      input.runId,
      input.expectedRevision,
      new Date().toISOString(),
    );
  }

  public previewWorkMerge(
    input: PreviewCatalogWorkMergeInput,
    senderId: number,
    windowId: number,
  ): CatalogActionPreview {
    const preview = this.#repository.previewWorkMerge(
      input.survivorWorkId,
      input.duplicateWorkId,
      input.survivorRevision,
      input.duplicateRevision,
    );
    const issued = this.#actions.issue({ kind: 'MERGE_WORKS', preview }, senderId, windowId);
    return actionPreview('MERGE_WORKS', issued, {
      duplicateWorkId: preview.duplicateWorkId,
      survivorWorkId: preview.survivorWorkId,
      ...preview.affected,
    });
  }

  public previewWorkSplit(
    input: PreviewCatalogWorkSplitInput,
    senderId: number,
    windowId: number,
  ): CatalogActionPreview {
    const preview = this.#repository.previewWorkSplit(
      input.sourceWorkId,
      input.sourceRevision,
      input.expressionIds,
      input.newCanonicalTitle,
    );
    const issued = this.#actions.issue({ kind: 'SPLIT_WORK', preview }, senderId, windowId);
    return actionPreview('SPLIT_WORK', issued, {
      expressionIds: preview.expressionIds,
      newCanonicalTitle: preview.newCanonicalTitle,
      sourceWorkId: preview.sourceWorkId,
    });
  }

  public previewUndo(
    input: PreviewCatalogUndoInput,
    senderId: number,
    windowId: number,
  ): CatalogActionPreview {
    const preview = this.#repository.previewUndoDecision(input.decisionId);
    const issued = this.#actions.issue({ kind: 'UNDO_DECISION', preview }, senderId, windowId);
    return actionPreview('UNDO_DECISION', issued, {
      decisionId: preview.decisionId,
      decisionType: preview.decisionType,
    });
  }

  public confirmAction(
    expectedKind: CatalogActionKind,
    input: ConfirmCatalogActionInput,
    senderId: number,
    windowId: number,
  ): CatalogActionResult {
    if (input.confirmation !== 'APPLY_CATALOG_DECISION') {
      throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
    }
    const action = this.#actions.consume(input.token, input.previewHash, senderId, windowId);
    if (action.kind !== expectedKind) {
      throw new CatalogError('CATALOG_CONFIRMATION_INVALID');
    }
    const now = new Date().toISOString();
    const decisionId =
      action.kind === 'MERGE_WORKS'
        ? this.#repository.mergeWorks(action.preview, now)
        : action.kind === 'SPLIT_WORK'
          ? this.#repository.splitWork(action.preview, `work-${randomUUID()}`, now)
          : this.#repository.undoDecision(action.preview, now);
    return Object.freeze({ decisionId, kind: action.kind });
  }

  public clearWindow(windowId: number): void {
    this.#actions.clearWindow(windowId);
    this.#discovery.clearWindow(windowId);
  }

  public async close(): Promise<void> {
    if (this.#workerPromise === null) return;
    await this.#worker.shutdown(5_000);
    await this.#workerPromise;
    this.#workerPromise = null;
  }
}
