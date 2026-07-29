import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  DOSSIER_JOB_TYPE,
  DossierConfirmationBroker,
  DossierError,
  type DossierBuildPlan,
} from '@mystery-operations/dossier';
import {
  JobQueueRepository,
  SqliteDossierRepository,
  type DossierDetailView,
  type DossierListView,
  type DossierVersionDiff,
} from '@mystery-operations/db';
import type {
  CancelDossierBuildInput,
  ConfirmDossierBuildInput,
  DiffDossierVersionsInput,
  DossierBuildPreview,
  DossierBuildRun,
  GetDossierInput,
  ListDossiersInput,
  PreviewDossierBuildInput,
} from '@mystery-operations/shared';
import {
  JobHandlerRegistry,
  JobQueueService,
  JobRecoveryService,
  JobWorker,
  registerDossierBuildJob,
} from '@mystery-operations/workflows';

interface DossierConfirmation {
  readonly executionId: string;
  readonly plan: DossierBuildPlan;
}

export class DesktopDossierRuntime {
  readonly #confirmations = new DossierConfirmationBroker<DossierConfirmation>();
  readonly #queue: JobQueueService;
  readonly #repository: SqliteDossierRepository;
  readonly #worker: JobWorker;
  #workerPromise: Promise<void> | null = null;

  public constructor(database: DatabaseSync) {
    this.#repository = new SqliteDossierRepository(database);
    const registry = new JobHandlerRegistry();
    registerDossierBuildJob(registry, this.#repository);
    this.#queue = new JobQueueService(new JobQueueRepository(database), registry, {
      allowedJobTypes: [DOSSIER_JOB_TYPE],
    });
    new JobRecoveryService(this.#queue).recoverExpiredLeases();
    this.#worker = new JobWorker(`dossier-worker-${randomUUID()}`, this.#queue, registry, {
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

  public list(input: ListDossiersInput): DossierListView {
    return this.#repository.listDossiers(input.limit, input.offset);
  }

  public get(input: GetDossierInput): DossierDetailView {
    return this.#repository.getDossierDetail(input.dossierId, input.entryLimit, input.entryOffset);
  }

  public preview(
    input: PreviewDossierBuildInput,
    senderId: number,
    windowId: number,
  ): DossierBuildPreview {
    const plan = this.#repository.previewBuild(
      { id: input.subjectId, type: input.subjectType },
      new Date().toISOString(),
    );
    const issued = this.#confirmations.issue(
      { executionId: `dossier-execution-${randomUUID()}`, plan },
      senderId,
      windowId,
    );
    return Object.freeze({
      expiresAt: issued.expiresAt,
      plan,
      previewHash: issued.previewHash,
      token: issued.token,
    });
  }

  public confirm(
    input: ConfirmDossierBuildInput,
    senderId: number,
    windowId: number,
  ): DossierBuildRun {
    if (input.confirmation !== 'START_DOSSIER_BUILD') {
      throw new DossierError('DOSSIER_CONFIRMATION_INVALID');
    }
    const confirmation = this.#confirmations.consume(
      input.token,
      input.previewHash,
      senderId,
      windowId,
    );
    if (confirmation.plan.planHash !== input.planHash) {
      throw new DossierError('DOSSIER_CONFIRMATION_INVALID');
    }
    const now = new Date().toISOString();
    const confirmed = this.#repository.confirmBuild(
      confirmation.plan.planId,
      confirmation.plan.planHash,
      confirmation.executionId,
      now,
    );
    if (!confirmed.enqueue || confirmed.payload === null) return confirmed.run;
    const job = this.#queue.enqueueJob({
      idempotencyKey: `dossier:${confirmation.executionId}`,
      jobType: DOSSIER_JOB_TYPE,
      maxAttempts: 3,
      payload: confirmed.payload,
      priority: 0,
    });
    return this.#repository.markQueued(confirmation.executionId, job.id, now);
  }

  public cancel(input: CancelDossierBuildInput): DossierBuildRun {
    if (input.confirmation !== 'CANCEL_DOSSIER_BUILD') {
      throw new DossierError('DOSSIER_CONFIRMATION_INVALID');
    }
    const run = this.#repository.requestCancel(
      input.runId,
      input.expectedRevision,
      new Date().toISOString(),
    );
    if (run.jobId !== null) this.#queue.requestCancel(run.jobId);
    return run;
  }

  public diff(input: DiffDossierVersionsInput): DossierVersionDiff {
    return this.#repository.diffVersions(input.dossierId, input.toVersionId, input.fromVersionId);
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
