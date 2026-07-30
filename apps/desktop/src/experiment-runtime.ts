import type { DatabaseSync } from 'node:sqlite';

import {
  EXPERIMENT_CONFIRMATION_LITERAL,
  ExperimentConfirmationBroker,
  ExperimentError,
  assertExperimentDesignDraft,
  validateExperimentDesign,
  type ExperimentDesignDraft,
} from '@mystery-operations/experiments';
import {
  SqliteExperimentRepository,
  type ExperimentActionPreview as RepositoryActionPreview,
  type ExperimentAssignmentPreview as RepositoryAssignmentPreview,
} from '@mystery-operations/db';
import type {
  ConfirmExperimentActionInput,
  ExperimentActionPreview,
  ExperimentActionPreviewView,
  ExperimentActionResult,
  ExperimentDetailView,
  ExperimentListView,
  GetExperimentInput,
  GetExperimentsInput,
  PreviewExperimentActionInput,
} from '@mystery-operations/shared';

type ExperimentRuntimePayload =
  | {
      readonly design: ExperimentDesignDraft;
      readonly kind: 'CREATE_DRAFT';
      readonly profileId: string;
    }
  | {
      readonly kind: 'SAVE_ASSIGNMENT';
      readonly preview: RepositoryAssignmentPreview;
    }
  | {
      readonly kind: 'STATE_ACTION';
      readonly preview: RepositoryActionPreview;
    }
  | {
      readonly design: ExperimentDesignDraft;
      readonly expectedRevision: number;
      readonly experimentId: string;
      readonly kind: 'CLONE_VERSION';
    };

function designPreview(
  kind: 'CREATE_DRAFT' | 'CLONE_VERSION',
  design: ExperimentDesignDraft,
): ExperimentActionPreviewView {
  const validation = validateExperimentDesign(design);
  return Object.freeze({
    armCount: design.primaryVariable.arms.length,
    designHash: validation.designHash,
    futureBoundVariable: validation.futureBoundVariable,
    kind,
    minimumDistinctWorkCount: design.samplePlan.minimumDistinctWorkCount,
    name: design.name,
    primaryMetricId: design.primaryMetric.metricId,
    primaryVariableKind: design.primaryVariable.kind,
    targetTopicCount: design.samplePlan.targetTopicIds.length,
    warningCodes: Object.freeze([
      'EXPERIMENT_NOT_EXECUTED',
      'NO_EFFECT_CONCLUSION',
      'SMALL_SAMPLE_NO_POWER_CLAIM',
      ...(validation.futureBoundVariable ? ['FUTURE_CAPABILITY_NOT_IMPLEMENTED'] : []),
    ]),
    workSnapshotCount: design.popularitySnapshots.length,
  });
}

function publicPreview(payload: ExperimentRuntimePayload): ExperimentActionPreviewView {
  switch (payload.kind) {
    case 'CREATE_DRAFT':
    case 'CLONE_VERSION':
      return designPreview(payload.kind, payload.design);
    case 'SAVE_ASSIGNMENT': {
      const limit = Math.min(100, payload.preview.result.units.length);
      return Object.freeze({
        armCounts: payload.preview.result.armCounts,
        assignmentHash: payload.preview.result.assignmentHash,
        distinctWorkCount: payload.preview.result.distinctWorkCount,
        expectedRevision: payload.preview.expectedRevision,
        imbalanceByStratum: payload.preview.result.imbalanceByStratum,
        kind: payload.kind,
        reasonCodes: payload.preview.result.reasonCodes,
        shortfallByArm: payload.preview.result.shortfallByArm,
        status: payload.preview.result.status,
        unitPage: Object.freeze({
          limit,
          offset: 0,
          total: payload.preview.result.units.length,
          truncated: payload.preview.result.units.length > limit,
        }),
        units: Object.freeze(
          payload.preview.result.units.slice(0, limit).map((unit) =>
            Object.freeze({
              armId: unit.armId,
              popularityStratum: unit.popularityStratum,
              topicId: unit.topicId,
              workId: unit.workId,
            }),
          ),
        ),
      });
    }
    case 'STATE_ACTION':
      return Object.freeze({
        action: payload.preview.action,
        after: payload.preview.after,
        assignmentReady: payload.preview.assignmentReady,
        before: payload.preview.before,
        expectedRevision: payload.preview.expectedRevision,
        kind: payload.kind,
        lockedMeansExecution: false,
      });
  }
}

export class DesktopExperimentRuntime {
  readonly #clock: () => Date;
  readonly #confirmations: ExperimentConfirmationBroker<ExperimentRuntimePayload>;
  readonly #repository: SqliteExperimentRepository;

  public constructor(database: DatabaseSync, clock: () => Date = () => new Date()) {
    this.#clock = clock;
    this.#confirmations = new ExperimentConfirmationBroker(clock);
    this.#repository = new SqliteExperimentRepository(database);
  }

  public list(input: GetExperimentsInput): ExperimentListView {
    return this.#repository.list(input.profileId, {
      limit: input.limit,
      offset: input.offset,
      query: input.query,
      state: input.state,
    });
  }

  public get(input: GetExperimentInput): ExperimentDetailView {
    return this.#repository.get(input.experimentId, input);
  }

  public preview(
    input: PreviewExperimentActionInput,
    senderId: number,
    windowId: number,
  ): ExperimentActionPreview {
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
    input: ConfirmExperimentActionInput,
    senderId: number,
    windowId: number,
  ): ExperimentActionResult {
    if (input.confirmation !== EXPERIMENT_CONFIRMATION_LITERAL) {
      throw new ExperimentError('EXPERIMENT_CONFIRMATION_INVALID');
    }
    const payload = this.#confirmations.consume(input.token, input.previewHash, senderId, windowId);
    if (payload.kind !== input.kind) {
      throw new ExperimentError('EXPERIMENT_CONFIRMATION_INVALID');
    }
    const now = this.#clock().toISOString();
    switch (payload.kind) {
      case 'CREATE_DRAFT':
        return Object.freeze({
          detail: this.#repository.createDraft(payload.profileId, payload.design, now),
          kind: payload.kind,
        });
      case 'SAVE_ASSIGNMENT':
        return Object.freeze({
          detail: this.#repository.saveAssignment(payload.preview, now),
          kind: payload.kind,
        });
      case 'STATE_ACTION':
        return Object.freeze({
          detail: this.#repository.applyAction(payload.preview, now),
          kind: payload.kind,
        });
      case 'CLONE_VERSION':
        return Object.freeze({
          detail: this.#repository.cloneVersion(
            payload.experimentId,
            payload.expectedRevision,
            payload.design,
            now,
          ),
          kind: payload.kind,
        });
    }
  }

  public clearWindow(windowId: number): void {
    this.#confirmations.clearWindow(windowId);
  }

  #previewPayload(input: PreviewExperimentActionInput): ExperimentRuntimePayload {
    switch (input.kind) {
      case 'CREATE_DRAFT':
        return Object.freeze({
          design: assertExperimentDesignDraft(input.design),
          kind: input.kind,
          profileId: input.profileId,
        });
      case 'SAVE_ASSIGNMENT':
        return Object.freeze({
          kind: input.kind,
          preview: this.#repository.previewAssignment(input.experimentId),
        });
      case 'STATE_ACTION':
        return Object.freeze({
          kind: input.kind,
          preview: this.#repository.previewAction(
            input.experimentId,
            input.action,
            input.expectedRevision,
          ),
        });
      case 'CLONE_VERSION': {
        const current = this.#repository.get(input.experimentId);
        if (current.revision !== input.expectedRevision) {
          throw new ExperimentError('EXPERIMENT_STALE_REVISION');
        }
        return Object.freeze({
          design: assertExperimentDesignDraft(input.design),
          expectedRevision: input.expectedRevision,
          experimentId: input.experimentId,
          kind: input.kind,
        });
      }
    }
  }
}
