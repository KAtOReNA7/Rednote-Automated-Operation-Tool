import type { DatabaseSync } from 'node:sqlite';

import {
  AuthenticityConfirmationBroker,
  AuthenticityError,
} from '@mystery-operations/authenticity';
import {
  SqliteSpoilerQualityRepository,
  type SpoilerQualityPreparedCheck,
} from '@mystery-operations/db';
import {
  SPOILER_QUALITY_CONFIRMATION_LITERAL,
  SpoilerQualityError,
  type SpoilerQualityEvaluation,
} from '@mystery-operations/quality';
import type {
  ConfirmSpoilerQualityInput,
  PreviewSpoilerQualityInput,
  SpoilerQualityPreview,
  SpoilerQualityReadModel,
  SpoilerQualityResult,
} from '@mystery-operations/shared';

type ConfirmationPayload = Pick<
  SpoilerQualityEvaluation,
  'draftId' | 'draftRevision' | 'draftVersionId' | 'inputHash'
>;

function readModel(prepared: SpoilerQualityPreparedCheck): SpoilerQualityReadModel {
  const { evaluation } = prepared;
  return Object.freeze({
    draftId: evaluation.draftId,
    draftRevision: evaluation.draftRevision,
    draftVersionId: evaluation.draftVersionId,
    evaluatedAt: evaluation.evaluatedAt,
    evaluationStatus: evaluation.status,
    findings: Object.freeze(evaluation.findings.map((finding) => Object.freeze({ ...finding }))),
    reasonCodes: evaluation.reasonCodes,
    savedStatus: prepared.savedStatus,
    truncated: evaluation.truncated,
  });
}

export class DesktopSpoilerQualityRuntime {
  readonly #clock: () => Date;
  readonly #confirmations: AuthenticityConfirmationBroker<ConfirmationPayload>;
  readonly #repository: SqliteSpoilerQualityRepository;

  public constructor(database: DatabaseSync, clock: () => Date = () => new Date()) {
    this.#clock = clock;
    this.#confirmations = new AuthenticityConfirmationBroker(clock);
    this.#repository = new SqliteSpoilerQualityRepository(database);
  }

  public preview(
    input: PreviewSpoilerQualityInput,
    senderId: number,
    windowId: number,
  ): SpoilerQualityPreview {
    const prepared = this.#repository.prepare(
      input.draftId,
      input.expectedRevision,
      this.#clock().toISOString(),
    );
    const payload: ConfirmationPayload = Object.freeze({
      draftId: prepared.evaluation.draftId,
      draftRevision: prepared.evaluation.draftRevision,
      draftVersionId: prepared.evaluation.draftVersionId,
      inputHash: prepared.evaluation.inputHash,
    });
    const issued = this.#confirmations.issue(payload, senderId, windowId);
    return Object.freeze({
      expiresAt: issued.expiresAt,
      preview: Object.freeze({
        costState: 'NOT_APPLICABLE' as const,
        externalRequestCount: 0 as const,
        readModel: readModel(prepared),
        writes: Object.freeze(['APPEND_QUALITY_CHECK'] as const),
      }),
      previewHash: issued.previewHash,
      token: issued.token,
    });
  }

  public confirm(
    input: ConfirmSpoilerQualityInput,
    senderId: number,
    windowId: number,
  ): SpoilerQualityResult {
    if (input.confirmation !== SPOILER_QUALITY_CONFIRMATION_LITERAL) {
      throw new SpoilerQualityError('SPOILER_QUALITY_CONFIRMATION_INVALID');
    }
    let payload: ConfirmationPayload;
    try {
      payload = this.#confirmations.consume(input.token, input.previewHash, senderId, windowId);
    } catch (error) {
      if (error instanceof AuthenticityError) {
        throw new SpoilerQualityError('SPOILER_QUALITY_CONFIRMATION_INVALID');
      }
      throw error;
    }
    if (payload.draftRevision !== input.expectedRevision) {
      throw new SpoilerQualityError('SPOILER_QUALITY_CONFIRMATION_INVALID');
    }
    return Object.freeze({
      readModel: readModel(this.#repository.confirm(payload, this.#clock().toISOString())),
    });
  }

  public clearWindow(windowId: number): void {
    this.#confirmations.clearWindow(windowId);
  }
}
