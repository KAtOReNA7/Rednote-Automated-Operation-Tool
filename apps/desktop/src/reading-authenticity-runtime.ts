import type { DatabaseSync } from 'node:sqlite';

import {
  AuthenticityConfirmationBroker,
  AuthenticityError,
} from '@mystery-operations/authenticity';
import {
  SqliteReadingAuthenticityRepository,
  type ReadingAuthenticityPreparedCheck,
} from '@mystery-operations/db';
import {
  READING_AUTHENTICITY_CONFIRMATION_LITERAL,
  ReadingAuthenticityError,
  type ReadingAuthenticityEvaluation,
} from '@mystery-operations/quality';
import type {
  ConfirmReadingAuthenticityInput,
  PreviewReadingAuthenticityInput,
  ReadingAuthenticityPreview,
  ReadingAuthenticityReadModel,
  ReadingAuthenticityResult,
} from '@mystery-operations/shared';

type ConfirmationPayload = Pick<
  ReadingAuthenticityEvaluation,
  'draftId' | 'draftRevision' | 'draftVersionId' | 'inputHash'
>;

function readModel(prepared: ReadingAuthenticityPreparedCheck): ReadingAuthenticityReadModel {
  const { evaluation } = prepared;
  return Object.freeze({
    draftId: evaluation.draftId,
    draftRevision: evaluation.draftRevision,
    draftVersionId: evaluation.draftVersionId,
    evaluatedAt: evaluation.evaluatedAt,
    evaluationStatus: evaluation.status,
    findings: Object.freeze(
      evaluation.findings.map(({ disposition, locator, reasonCode }) =>
        Object.freeze({
          artifactId: locator.artifactId,
          artifactKind: locator.artifactKind,
          disposition,
          draftVersionId: locator.draftVersionId,
          endCodePoint: locator.endCodePoint,
          reasonCode,
          selectedTextHash: locator.selectedTextHash,
          startCodePoint: locator.startCodePoint,
          textHash: locator.textHash,
        }),
      ),
    ),
    reasonCodes: evaluation.reasonCodes,
    savedStatus: prepared.savedStatus,
    truncated: evaluation.truncated,
  });
}

export class DesktopReadingAuthenticityRuntime {
  readonly #clock: () => Date;
  readonly #confirmations: AuthenticityConfirmationBroker<ConfirmationPayload>;
  readonly #repository: SqliteReadingAuthenticityRepository;

  public constructor(database: DatabaseSync, clock: () => Date = () => new Date()) {
    this.#clock = clock;
    this.#confirmations = new AuthenticityConfirmationBroker(clock);
    this.#repository = new SqliteReadingAuthenticityRepository(database);
  }

  public preview(
    input: PreviewReadingAuthenticityInput,
    senderId: number,
    windowId: number,
  ): ReadingAuthenticityPreview {
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
    input: ConfirmReadingAuthenticityInput,
    senderId: number,
    windowId: number,
  ): ReadingAuthenticityResult {
    if (input.confirmation !== READING_AUTHENTICITY_CONFIRMATION_LITERAL) {
      throw new ReadingAuthenticityError('READING_AUTHENTICITY_CONFIRMATION_INVALID');
    }
    let payload: ConfirmationPayload;
    try {
      payload = this.#confirmations.consume(input.token, input.previewHash, senderId, windowId);
    } catch (error) {
      if (error instanceof AuthenticityError) {
        throw new ReadingAuthenticityError('READING_AUTHENTICITY_CONFIRMATION_INVALID');
      }
      throw error;
    }
    if (payload.draftRevision !== input.expectedRevision) {
      throw new ReadingAuthenticityError('READING_AUTHENTICITY_CONFIRMATION_INVALID');
    }
    return Object.freeze({
      readModel: readModel(this.#repository.confirm(payload, this.#clock().toISOString())),
    });
  }

  public clearWindow(windowId: number): void {
    this.#confirmations.clearWindow(windowId);
  }
}
