import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  CONTENT_BRIEF_CONFIRMATION_LITERAL,
  CONTENT_BRIEF_FORBIDDEN_REGISTRY_VERSION,
  CONTENT_BRIEF_GENERATE_JOB_TYPE,
  CONTENT_BRIEF_GENERATION_PROMPT_VERSION,
  CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
  CONTENT_BRIEF_READINESS_POLICY_VERSION,
  BriefConfirmationBroker,
  BriefError,
  assertContentBriefDraft,
  briefSemanticHash,
  buildLocalBriefScaffold,
  canonicalBriefJson,
  evaluateBriefReadiness,
  type BriefDependency,
  type BriefGenerationPlan,
  type BriefReadinessContext,
  type ContentBriefDraft,
} from '@mystery-operations/briefs';
import { JobQueueRepository, SqliteBriefRepository } from '@mystery-operations/db';
import type {
  BriefActionPreview,
  BriefActionPreviewView,
  BriefActionResult,
  BriefDetailView,
  BriefListView,
  ConfirmBriefActionInput,
  GetBriefInput,
  GetBriefsInput,
  PreviewBriefActionInput,
} from '@mystery-operations/shared';
import {
  ContentBriefGenerationService,
  JobHandlerRegistry,
  JobQueueService,
  JobRecoveryService,
  JobWorker,
  registerContentBriefGenerationJob,
} from '@mystery-operations/workflows';

type BriefInputFor<K extends PreviewBriefActionInput['kind']> = PreviewBriefActionInput & {
  readonly kind: K;
};

type BriefRuntimePayload =
  | {
      readonly context: BriefReadinessContext;
      readonly scaffoldInput: Parameters<typeof buildLocalBriefScaffold>[0];
      readonly input: BriefInputFor<'CREATE_SCAFFOLD'>;
      readonly kind: 'CREATE_SCAFFOLD';
    }
  | {
      readonly context: BriefReadinessContext;
      readonly input: BriefInputFor<'SAVE_EDIT'>;
      readonly kind: 'SAVE_EDIT';
    }
  | {
      readonly input: BriefInputFor<'LOCK_FIELD' | 'UNLOCK_FIELD'>;
      readonly kind: 'LOCK_FIELD' | 'UNLOCK_FIELD';
    }
  | {
      readonly input: BriefInputFor<'CLONE' | 'UNDO'>;
      readonly kind: 'CLONE' | 'UNDO';
    }
  | {
      readonly input: BriefInputFor<'ARCHIVE' | 'RESTORE'>;
      readonly kind: 'ARCHIVE' | 'RESTORE';
    }
  | {
      readonly input: BriefInputFor<'PREVIEW_GENERATION'>;
      readonly kind: 'PREVIEW_GENERATION';
      readonly plan: BriefGenerationPlan;
    }
  | {
      readonly input: BriefInputFor<'CANCEL_GENERATION'>;
      readonly kind: 'CANCEL_GENERATION';
    };

function changedFieldCount(current: unknown, next: unknown): number {
  if (
    current === null ||
    next === null ||
    typeof current !== 'object' ||
    typeof next !== 'object' ||
    Array.isArray(current) ||
    Array.isArray(next)
  ) {
    return canonicalBriefJson(current) === canonicalBriefJson(next) ? 0 : 1;
  }
  const currentRecord = current as Readonly<Record<string, unknown>>;
  const nextRecord = next as Readonly<Record<string, unknown>>;
  return [...new Set([...Object.keys(currentRecord), ...Object.keys(nextRecord)])].filter(
    (key) => canonicalBriefJson(currentRecord[key]) !== canonicalBriefJson(nextRecord[key]),
  ).length;
}

function runtimeDependencies(draft: ContentBriefDraft): readonly BriefDependency[] {
  const values: {
    readonly id: string;
    readonly revision: string;
    readonly type: BriefDependency['dependencyType'];
  }[] = [
    { id: draft.topicVersionId, revision: '1', type: 'TOPIC_VERSION' },
    {
      id: draft.expressionPolicy.permissionSnapshotId,
      revision: String(draft.expressionPolicy.permissionRevision),
      type: 'EXPRESSION_PERMISSION',
    },
    {
      id: 'reading-authenticity-policy-v1',
      revision: '1',
      type: 'AUTHENTICITY_POLICY',
    },
    {
      id: CONTENT_BRIEF_PROFILE_REGISTRY_VERSION,
      revision: '1',
      type: 'PROFILE_POLICY',
    },
    {
      id: CONTENT_BRIEF_READINESS_POLICY_VERSION,
      revision: '1',
      type: 'READINESS_POLICY',
    },
    {
      id: CONTENT_BRIEF_FORBIDDEN_REGISTRY_VERSION,
      revision: '1',
      type: 'FORBIDDEN_POLICY',
    },
    { id: draft.schemaVersion, revision: '1', type: 'SCHEMA_POLICY' },
    {
      id: CONTENT_BRIEF_GENERATION_PROMPT_VERSION,
      revision: '1',
      type: 'PROMPT_POLICY',
    },
    {
      id: draft.spoilerPlan.level,
      revision: '1',
      type: 'SPOILER_POLICY',
    },
    { id: draft.topicId, revision: '1', type: 'TOPIC_STATE' },
    { id: draft.topicId, revision: '1', type: 'TOPIC_ELIGIBILITY' },
    {
      id: draft.scorePlan.kind,
      revision: '1',
      type: 'SCORE_POLICY',
    },
    {
      id: briefSemanticHash(draft.fieldStates),
      revision: '1',
      type: 'LOCK_SNAPSHOT',
    },
  ];
  for (const subject of draft.subjects) {
    values.push({ id: subject.workId, revision: '1', type: 'WORK_IDENTITY' });
    if (subject.expressionId !== null) {
      values.push({ id: subject.expressionId, revision: '1', type: 'EXPRESSION_IDENTITY' });
    }
    if (subject.editionId !== null) {
      values.push({ id: subject.editionId, revision: '1', type: 'EDITION_IDENTITY' });
    }
  }
  for (const assertionId of draft.expressionPolicy.r2AssertionIds) {
    values.push({ id: assertionId, revision: '1', type: 'R2_ASSERTION' });
  }
  for (const reference of draft.evidenceMap) {
    values.push(
      { id: reference.dossierVersionId, revision: '1', type: 'DOSSIER_VERSION' },
      { id: reference.dossierEntryId, revision: '1', type: 'DOSSIER_ENTRY' },
      { id: reference.claimId, revision: '1', type: 'CLAIM' },
      { id: reference.factEvaluationId, revision: '1', type: 'FACT_EVALUATION' },
      { id: reference.evidenceLocatorId, revision: '1', type: 'EVIDENCE_LOCATOR' },
      { id: reference.sourceRevisionId, revision: '1', type: 'SOURCE_REVISION' },
    );
  }
  if (draft.experimentBinding !== null) {
    values.push(
      {
        id: draft.experimentBinding.designVersionId,
        revision: '1',
        type: 'EXPERIMENT_DESIGN',
      },
      {
        id: draft.experimentBinding.assignmentPlanId,
        revision: '1',
        type: 'EXPERIMENT_ASSIGNMENT',
      },
    );
  }
  const unique = new Map(values.map((value) => [`${value.type}:${value.id}`, value] as const));
  return Object.freeze(
    [...unique.values()]
      .sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`))
      .map((value) =>
        Object.freeze({
          dependencyHash: briefSemanticHash(value),
          dependencyId: value.id,
          dependencyType: value.type,
          observedRevision: value.revision,
        }),
      ),
  );
}

export interface DesktopBriefRuntimeOptions {
  readonly budgetState?: () => BriefGenerationPlan['budgetState'];
  readonly capabilityState?: () => BriefGenerationPlan['capabilityState'];
  readonly clock?: () => Date;
}

export class DesktopBriefRuntime {
  readonly #budgetState: () => BriefGenerationPlan['budgetState'];
  readonly #capabilityState: () => BriefGenerationPlan['capabilityState'];
  readonly #clock: () => Date;
  readonly #confirmations: BriefConfirmationBroker<BriefRuntimePayload>;
  readonly #queue: JobQueueService;
  readonly #repository: SqliteBriefRepository;
  readonly #worker: JobWorker;
  #workerPromise: Promise<void> | null = null;

  public constructor(database: DatabaseSync, options: DesktopBriefRuntimeOptions = {}) {
    this.#clock = options.clock ?? (() => new Date());
    this.#budgetState = options.budgetState ?? (() => 'UNKNOWN');
    this.#capabilityState = options.capabilityState ?? (() => 'UNKNOWN');
    this.#confirmations = new BriefConfirmationBroker(this.#clock);
    this.#repository = new SqliteBriefRepository(database);
    this.#repository.recoverInterrupted(this.#clock().toISOString());
    const registry = new JobHandlerRegistry();
    registerContentBriefGenerationJob(
      registry,
      new ContentBriefGenerationService({
        persistence: this.#repository,
        readinessContext: (execution): BriefReadinessContext =>
          this.#repository.deriveReadinessContext(execution.draft),
      }),
    );
    this.#queue = new JobQueueService(new JobQueueRepository(database), registry, {
      allowedJobTypes: [CONTENT_BRIEF_GENERATE_JOB_TYPE],
    });
    new JobRecoveryService(this.#queue).recoverExpiredLeases();
    this.#worker = new JobWorker(`brief-worker-${randomUUID()}`, this.#queue, registry, {
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

  public list(input: GetBriefsInput): BriefListView {
    return this.#repository.list(input);
  }

  public get(input: GetBriefInput): BriefDetailView {
    return this.#repository.get(input.briefId, input);
  }

  public preview(
    input: PreviewBriefActionInput,
    senderId: number,
    windowId: number,
  ): BriefActionPreview {
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
    input: ConfirmBriefActionInput,
    senderId: number,
    windowId: number,
  ): BriefActionResult {
    if (input.confirmation !== CONTENT_BRIEF_CONFIRMATION_LITERAL) {
      throw new BriefError('BRIEF_CONFIRMATION_INVALID');
    }
    const payload = this.#confirmations.consume(input.token, input.previewHash, senderId, windowId);
    if (payload.kind !== input.kind) throw new BriefError('BRIEF_CONFIRMATION_INVALID');
    const now = this.#clock().toISOString();
    switch (payload.kind) {
      case 'CREATE_SCAFFOLD':
        if (input.executionId !== null) throw new BriefError('BRIEF_CONFIRMATION_INVALID');
        {
          const scaffoldInput = this.#repository.prepareScaffoldFromTopic(
            payload.input.topicId,
            payload.input.assignmentPlanId,
          );
          if (canonicalBriefJson(scaffoldInput) !== canonicalBriefJson(payload.scaffoldInput)) {
            throw new BriefError('BRIEF_STALE_REVISION', true);
          }
          const draft = buildLocalBriefScaffold(scaffoldInput);
          return Object.freeze({
            detail: this.#repository.createScaffold(
              scaffoldInput,
              this.#repository.deriveReadinessContext(draft),
              runtimeDependencies(draft),
              now,
            ),
            kind: payload.kind,
          });
        }
      case 'SAVE_EDIT':
        if (input.executionId !== null) throw new BriefError('BRIEF_CONFIRMATION_INVALID');
        return Object.freeze({
          detail: this.#repository.saveDraft(
            payload.input.briefId,
            payload.input.expectedRevision,
            payload.input.draft,
            payload.context,
            now,
          ),
          kind: payload.kind,
        });
      case 'LOCK_FIELD':
      case 'UNLOCK_FIELD':
        if (input.executionId !== null) throw new BriefError('BRIEF_CONFIRMATION_INVALID');
        return Object.freeze({
          detail: this.#repository.changeFieldLock(
            payload.input.briefId,
            payload.input.expectedRevision,
            payload.input.fieldPath,
            payload.kind === 'LOCK_FIELD' ? 'USER_LOCKED' : 'EDITABLE',
            now,
          ),
          kind: payload.kind,
        });
      case 'CLONE':
      case 'UNDO':
        if (input.executionId !== null) throw new BriefError('BRIEF_CONFIRMATION_INVALID');
        return Object.freeze({
          detail:
            payload.kind === 'CLONE'
              ? this.#repository.cloneVersion(
                  payload.input.briefId,
                  payload.input.expectedRevision,
                  payload.input.targetVersionId,
                  now,
                )
              : this.#repository.undo(
                  payload.input.briefId,
                  payload.input.expectedRevision,
                  payload.input.targetVersionId,
                  now,
                ),
          kind: payload.kind,
        });
      case 'ARCHIVE':
      case 'RESTORE':
        if (input.executionId !== null) throw new BriefError('BRIEF_CONFIRMATION_INVALID');
        return Object.freeze({
          detail: this.#repository.setArchived(
            payload.input.briefId,
            payload.input.expectedRevision,
            payload.kind === 'ARCHIVE',
            now,
          ),
          kind: payload.kind,
        });
      case 'PREVIEW_GENERATION': {
        if (input.executionId === null) throw new BriefError('BRIEF_CONFIRMATION_INVALID');
        const prepared = this.#repository.confirmGeneration(
          payload.plan.planId,
          payload.plan.previewHash,
          input.executionId,
          now,
        );
        const job = this.#queue.enqueueJob({
          idempotencyKey: `content-brief:${input.executionId}`,
          jobType: CONTENT_BRIEF_GENERATE_JOB_TYPE,
          maxAttempts: 1,
          payload: prepared.payload,
          priority: 0,
        });
        const run = this.#repository.markGenerationQueued(input.executionId, job.id, now);
        return Object.freeze({
          generation: Object.freeze({ enqueueRequired: true, run }),
          kind: payload.kind,
        });
      }
      case 'CANCEL_GENERATION': {
        if (input.executionId !== null) throw new BriefError('BRIEF_CONFIRMATION_INVALID');
        const cancelled = this.#repository.cancelGeneration(
          payload.input.runId,
          payload.input.expectedRevision,
          now,
        );
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

  #previewPayload(input: PreviewBriefActionInput): BriefRuntimePayload {
    switch (input.kind) {
      case 'CREATE_SCAFFOLD': {
        const scaffoldInput = this.#repository.prepareScaffoldFromTopic(
          input.topicId,
          input.assignmentPlanId,
        );
        const draft = buildLocalBriefScaffold(scaffoldInput);
        return Object.freeze({
          context: this.#repository.deriveReadinessContext(draft),
          input,
          kind: input.kind,
          scaffoldInput,
        });
      }
      case 'SAVE_EDIT':
        assertContentBriefDraft(input.draft);
        this.#repository.get(input.briefId);
        return Object.freeze({
          context: this.#repository.deriveReadinessContext(input.draft),
          input,
          kind: input.kind,
        });
      case 'LOCK_FIELD':
      case 'UNLOCK_FIELD':
      case 'CLONE':
      case 'UNDO':
      case 'ARCHIVE':
      case 'RESTORE':
      case 'CANCEL_GENERATION':
        return Object.freeze({ input, kind: input.kind }) as BriefRuntimePayload;
      case 'PREVIEW_GENERATION':
        return Object.freeze({
          input: { ...input, kind: 'PREVIEW_GENERATION' as const },
          kind: input.kind,
          plan: this.#repository.previewGeneration(
            input.briefId,
            input.expectedRevision,
            this.#capabilityState(),
            this.#budgetState(),
            this.#clock().toISOString(),
          ),
        });
    }
  }

  #publicPreview(payload: BriefRuntimePayload): BriefActionPreviewView {
    switch (payload.kind) {
      case 'CREATE_SCAFFOLD': {
        const draft = buildLocalBriefScaffold(payload.scaffoldInput);
        const readiness = evaluateBriefReadiness(
          draft,
          payload.context,
          this.#clock().toISOString(),
        );
        return Object.freeze({
          evidenceRefCount: draft.evidenceMap.length,
          experimentBound: draft.experimentBinding !== null,
          kind: payload.kind,
          profileId: draft.profileId,
          readiness: readiness.status,
          readinessReasonCodes: readiness.reasonCodes,
          subjectCount: draft.subjects.length,
          topicId: draft.topicId,
        });
      }
      case 'SAVE_EDIT': {
        const current = this.#repository.get(payload.input.briefId);
        const readiness = evaluateBriefReadiness(
          payload.input.draft,
          payload.context,
          this.#clock().toISOString(),
        );
        return Object.freeze({
          briefId: payload.input.briefId,
          changedFieldCount: changedFieldCount(current.draft, payload.input.draft),
          expectedRevision: payload.input.expectedRevision,
          kind: payload.kind,
          readiness: readiness.status,
          readinessReasonCodes: readiness.reasonCodes,
        });
      }
      case 'LOCK_FIELD':
      case 'UNLOCK_FIELD':
        return Object.freeze({
          briefId: payload.input.briefId,
          expectedRevision: payload.input.expectedRevision,
          fieldPath: payload.input.fieldPath,
          kind: payload.kind,
        });
      case 'CLONE':
      case 'UNDO':
        return Object.freeze({
          briefId: payload.input.briefId,
          expectedRevision: payload.input.expectedRevision,
          kind: payload.kind,
          targetVersionId: payload.input.targetVersionId,
        });
      case 'ARCHIVE':
      case 'RESTORE':
        return Object.freeze({
          briefId: payload.input.briefId,
          expectedRevision: payload.input.expectedRevision,
          kind: payload.kind,
        });
      case 'PREVIEW_GENERATION':
        return Object.freeze({
          ...payload.plan,
          kind: payload.kind,
          modelConfigured: payload.plan.capabilityState === 'SUPPORTED',
          noNetworkBeforeConfirmation: true,
        });
      case 'CANCEL_GENERATION':
        return Object.freeze({
          expectedRevision: payload.input.expectedRevision,
          kind: payload.kind,
          runId: payload.input.runId,
        });
    }
  }
}
