import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  SOURCE_PROCESSING_PLAN_VERSION,
  EvidenceConfirmationBroker,
  EvidenceError,
  sourceProcessingPlanHash,
  type FactConflictAction,
  type SourceProcessingPlanV1,
} from '@mystery-operations/evidence';
import {
  SqliteEvidenceRepository,
  type EvidenceSummaryViewV1,
  type FactConflictPreviewV1,
  type FactConflictViewV1,
} from '@mystery-operations/db';
import type {
  CancelSourceProcessingInput,
  ConfirmEvidenceConflictInput,
  ConfirmSourceProcessingInput,
  EvidenceConflictActionPreview,
  GetEvidenceStateInput,
  PreviewEvidenceConflictInput,
  PreviewSourceProcessingInput,
  SourceProcessingPreview,
} from '@mystery-operations/shared';

interface ProcessingConfirmation {
  readonly executionId: string;
  readonly plan: SourceProcessingPlanV1;
  readonly runId: string;
}

export class DesktopEvidenceRuntime {
  readonly #conflicts = new EvidenceConfirmationBroker<FactConflictPreviewV1>();
  readonly #processing = new EvidenceConfirmationBroker<ProcessingConfirmation>();
  readonly #repository: SqliteEvidenceRepository;

  public constructor(database: DatabaseSync) {
    this.#repository = new SqliteEvidenceRepository(database);
  }

  public getState(input: GetEvidenceStateInput): EvidenceSummaryViewV1 {
    return this.#repository.getSummary(input.limit, input.offset);
  }

  public previewConflict(
    input: PreviewEvidenceConflictInput,
    senderId: number,
    windowId: number,
  ): EvidenceConflictActionPreview {
    const preview = this.#repository.previewConflictAction(
      input.conflictId,
      input.action as FactConflictAction,
      input.acceptedClaimId,
    );
    const issued = this.#conflicts.issue(preview, senderId, windowId);
    return Object.freeze({
      acceptedClaimId: preview.acceptedClaimId,
      action: preview.action,
      affected: preview.affected,
      afterEvaluations: preview.afterEvaluations,
      beforeEvaluations: preview.beforeEvaluations,
      claimLeftId: preview.claimLeftId,
      claimRightId: preview.claimRightId,
      conflictId: preview.conflictId,
      expiresAt: issued.expiresAt,
      previewHash: issued.previewHash,
      revision: preview.revision,
      state: preview.state,
      token: issued.token,
    });
  }

  public confirmConflict(
    input: ConfirmEvidenceConflictInput,
    senderId: number,
    windowId: number,
  ): FactConflictViewV1 {
    if (input.confirmation !== 'APPLY_FACT_CONFLICT_DECISION') {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    const preview = this.#conflicts.consume(input.token, input.previewHash, senderId, windowId);
    return this.#repository.applyConflictAction(
      preview,
      input.reason,
      `fact-decision-${randomUUID()}`,
      new Date().toISOString(),
    );
  }

  public previewProcessing(
    input: PreviewSourceProcessingInput,
    senderId: number,
    windowId: number,
  ): SourceProcessingPreview {
    this.#repository.assertSourceRevisionIds(input.sourceRevisionIds);
    const now = new Date();
    const modelSteps = input.includeModelSteps
      ? (['EXTRACT_CLAIMS', 'SUMMARIZE'] as const)
      : ([] as const);
    const steps = Object.freeze(['CLASSIFY', ...modelSteps, 'RECONCILE'] as const);
    const withoutHash = {
      contractVersion: SOURCE_PROCESSING_PLAN_VERSION,
      createdAt: now.toISOString(),
      estimatedExternalRequests: modelSteps.length * input.sourceRevisionIds.length,
      estimatedFee: 'UNKNOWN' as const,
      estimatedLocalWrites: input.sourceRevisionIds.length * 4,
      expiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
      limits: Object.freeze({
        maxClaims: 256,
        maxConcurrency: 1,
        maxEvidencePerClaim: 64,
        maxFragmentBytes: 256 * 1024,
        maxRuntimeMs: 60 * 60_000,
      }),
      planId: `evidence-plan-${randomUUID()}`,
      sourceRevisionIds: Object.freeze([...input.sourceRevisionIds]),
      steps,
    };
    const plan: SourceProcessingPlanV1 = Object.freeze({
      ...withoutHash,
      planHash: sourceProcessingPlanHash(withoutHash),
    });
    const runId = `evidence-run-${randomUUID()}`;
    const issued = this.#processing.issue(
      { executionId: `evidence-execution-${randomUUID()}`, plan, runId },
      senderId,
      windowId,
    );
    return Object.freeze({
      estimatedExternalRequests: plan.estimatedExternalRequests,
      estimatedFee: 'UNKNOWN',
      estimatedLocalWrites: plan.estimatedLocalWrites,
      expiresAt: issued.expiresAt,
      planHash: plan.planHash,
      previewHash: issued.previewHash,
      readiness: input.includeModelSteps ? 'MODEL_UNCONFIGURED' : 'LOCAL_READY',
      runId,
      sourceRevisionIds: plan.sourceRevisionIds,
      steps: plan.steps,
      token: issued.token,
    });
  }

  public confirmProcessing(
    input: ConfirmSourceProcessingInput,
    senderId: number,
    windowId: number,
  ): EvidenceSummaryViewV1 {
    if (input.confirmation !== 'START_SOURCE_PROCESSING') {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    const confirmation = this.#processing.consume(
      input.token,
      input.previewHash,
      senderId,
      windowId,
    );
    if (confirmation.plan.planHash !== input.planHash) {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    if (
      confirmation.plan.steps.includes('EXTRACT_CLAIMS') ||
      confirmation.plan.steps.includes('SUMMARIZE')
    ) {
      throw new EvidenceError('EVIDENCE_POLICY_BLOCKED');
    }
    this.#repository.saveProcessingPlan(
      confirmation.plan,
      confirmation.runId,
      confirmation.executionId,
    );
    const now = new Date().toISOString();
    this.#repository.confirmProcessingRun(confirmation.runId, 1, now);
    const claimIds = this.#repository.listClaimIdsForSourceRevisions(
      confirmation.plan.sourceRevisionIds,
    );
    for (const claimId of claimIds) {
      this.#repository.reconcileClaim(claimId, now);
    }
    this.#repository.finishProcessingRun(
      confirmation.runId,
      2,
      'SUCCEEDED',
      ['CLASSIFY', 'RECONCILE'],
      0,
      'NOT_INCURRED',
      null,
      now,
    );
    return this.#repository.getSummary();
  }

  public cancelProcessing(input: CancelSourceProcessingInput): EvidenceSummaryViewV1 {
    if (input.confirmation !== 'CANCEL_SOURCE_PROCESSING') {
      throw new EvidenceError('EVIDENCE_CONFIRMATION_INVALID');
    }
    this.#repository.requestProcessingCancel(
      input.runId,
      input.expectedRevision,
      new Date().toISOString(),
    );
    return this.#repository.getSummary();
  }

  public clearWindow(windowId: number): void {
    this.#conflicts.clearWindow(windowId);
    this.#processing.clearWindow(windowId);
  }
}
