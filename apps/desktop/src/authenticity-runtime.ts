import type { DatabaseSync } from 'node:sqlite';

import {
  AuthenticityConfirmationBroker,
  AuthenticityError,
} from '@mystery-operations/authenticity';
import {
  SqliteAuthenticityRepository,
  type AuthenticityActionPreviewPayload,
} from '@mystery-operations/db';
import type {
  AuthenticityActionPreview,
  AuthenticityActionPreviewView,
  AuthenticityActionResult,
  AuthenticityLibraryView,
  AuthenticityWorkDetail,
  ConfirmAuthenticityActionInput,
  GetAuthenticityLibraryInput,
  GetAuthenticityWorkInput,
  PreviewAuthenticityActionInput,
} from '@mystery-operations/shared';

function publicPreview(payload: AuthenticityActionPreviewPayload): AuthenticityActionPreviewView {
  switch (payload.kind) {
    case 'STATE_CHANGE':
      return Object.freeze({
        after: payload.after,
        before: payload.before,
        kind: payload.kind,
        readingStateId: payload.readingStateId,
      });
    case 'STATE_UNDO':
      return Object.freeze({
        expectedRevision: payload.expectedRevision,
        kind: payload.kind,
        restore: payload.restore,
        workId: payload.workId,
      });
    case 'ASSERTION_CONFIRM':
      return Object.freeze({
        assertionKind: payload.draft.assertionKind,
        kind: payload.kind,
        statement: payload.draft.statement,
      });
    case 'ASSERTION_REVOKE':
      return Object.freeze({
        assertionId: payload.assertionId,
        kind: payload.kind,
      });
    case 'SCORE_CHANGE':
      return Object.freeze({
        kind: payload.kind,
        publicLabel: payload.publicLabel,
        scoreBasisPoints: payload.draft.scoreBasisPoints,
      });
    case 'SPOILER_CHANGE':
      return Object.freeze({
        kind: payload.kind,
        level: payload.draft.level,
        warningPlacement: payload.warningPlacement,
        warningRequired: payload.warningRequired,
      });
    case 'BATCH_STATE_CHANGE':
      return Object.freeze({
        items: payload.items,
        kind: payload.kind,
        nextState: payload.draft.nextState,
      });
  }
}

export class DesktopAuthenticityRuntime {
  readonly #confirmations = new AuthenticityConfirmationBroker<AuthenticityActionPreviewPayload>();
  readonly #repository: SqliteAuthenticityRepository;

  public constructor(database: DatabaseSync) {
    this.#repository = new SqliteAuthenticityRepository(database);
  }

  public list(input: GetAuthenticityLibraryInput): AuthenticityLibraryView {
    return this.#repository.listLibrary(input.profileId, {
      limit: input.limit,
      offset: input.offset,
      query: input.query,
    });
  }

  public get(input: GetAuthenticityWorkInput): AuthenticityWorkDetail {
    return this.#repository.getWorkDetail(input.profileId, input.workId, {
      historyLimit: input.historyLimit,
      historyOffset: input.historyOffset,
    });
  }

  public preview(
    input: PreviewAuthenticityActionInput,
    senderId: number,
    windowId: number,
  ): AuthenticityActionPreview {
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
    input: ConfirmAuthenticityActionInput,
    senderId: number,
    windowId: number,
  ): AuthenticityActionResult {
    if (input.confirmation !== 'APPLY_AUTHENTICITY_ACTION') {
      throw new AuthenticityError('AUTHENTICITY_CONFIRMATION_INVALID');
    }
    const payload = this.#confirmations.consume(input.token, input.previewHash, senderId, windowId);
    if (payload.kind !== input.kind) {
      throw new AuthenticityError('AUTHENTICITY_CONFIRMATION_INVALID');
    }
    const now = new Date().toISOString();
    switch (payload.kind) {
      case 'STATE_CHANGE':
        return Object.freeze({
          batch: null,
          detail: this.#repository.applyStateChange(payload.draft, now),
          kind: payload.kind,
        });
      case 'STATE_UNDO':
        return Object.freeze({
          batch: null,
          detail: this.#repository.applyUndo(payload, now),
          kind: payload.kind,
        });
      case 'ASSERTION_CONFIRM':
        return Object.freeze({
          batch: null,
          detail: this.#repository.applyAssertion(payload.draft, now),
          kind: payload.kind,
        });
      case 'ASSERTION_REVOKE':
        return Object.freeze({
          batch: null,
          detail: this.#repository.applyAssertionRevoke(payload, now),
          kind: payload.kind,
        });
      case 'SCORE_CHANGE':
        return Object.freeze({
          batch: null,
          detail: this.#repository.applyScore(payload.draft, now),
          kind: payload.kind,
        });
      case 'SPOILER_CHANGE':
        return Object.freeze({
          batch: null,
          detail: this.#repository.applySpoiler(payload.draft, now),
          kind: payload.kind,
        });
      case 'BATCH_STATE_CHANGE':
        return Object.freeze({
          batch: this.#repository.applyBatch(payload.draft, now),
          detail: null,
          kind: payload.kind,
        });
    }
  }

  public clearWindow(windowId: number): void {
    this.#confirmations.clearWindow(windowId);
  }

  #previewPayload(input: PreviewAuthenticityActionInput): AuthenticityActionPreviewPayload {
    switch (input.kind) {
      case 'STATE_CHANGE':
        return this.#repository.previewStateChange(input.draft);
      case 'STATE_UNDO':
        return this.#repository.previewUndo(input.profileId, input.workId, input.expectedRevision);
      case 'ASSERTION_CONFIRM':
        return this.#repository.previewAssertion(input.draft);
      case 'ASSERTION_REVOKE':
        return this.#repository.previewAssertionRevoke(input);
      case 'SCORE_CHANGE':
        return this.#repository.previewScore(input.draft);
      case 'SPOILER_CHANGE':
        return this.#repository.previewSpoiler(input.draft);
      case 'BATCH_STATE_CHANGE':
        return this.#repository.previewBatch(input.draft);
    }
  }
}
