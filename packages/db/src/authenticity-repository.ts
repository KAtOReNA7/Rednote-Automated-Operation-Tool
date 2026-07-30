import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  AUTHENTICITY_POLICY_VERSION,
  EXPRESSION_PERMISSION_VERSION,
  READING_STATE_CONTRACT_VERSION,
  SCORE_POLICY_VERSION,
  SPOILER_POLICY_VERSION,
  AuthenticityError,
  assertBatchReadingStateDraft,
  assertExperienceAssertionDraft,
  assertReadingStateChangeDraft,
  assertScoreRecordDraft,
  assertSpoilerPreferenceDraft,
  authenticitySemanticHash,
  canonicalAuthenticityJson,
  evaluateExpressionPermission,
  type AuthenticityDependencyType,
  type AuthenticitySpoilerLevel,
  type BatchReadingStateDraft,
  type DossierPermissionInput,
  type ExperienceAssertionDraft,
  type ExperienceAssertionKind,
  type ExpressionPermissionSnapshotV1,
  type ExpressionPermissionState,
  type MemoryConfidence,
  type PublicScoreOrigin,
  type ReadingConfirmationKind,
  type ReadingDatePrecision,
  type ReadingStateChangeDraft,
  type ReadingStateCode,
  type ScoreRecordDraft,
  type SpoilerPreferenceDraft,
} from '@mystery-operations/authenticity';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;

interface ReadingRootRow extends Row {
  readonly book_id: string;
  readonly current_revision_id: string | null;
  readonly current_snapshot_id: string | null;
  readonly id: string;
  readonly profile_id: string;
  readonly revision: number;
}

interface ReadingRevisionRow extends Row {
  readonly confirmation_kind: ReadingConfirmationKind;
  readonly created_at: string;
  readonly edition_id: string | null;
  readonly expression_id: string | null;
  readonly finished_at: string | null;
  readonly finished_at_precision: ReadingDatePrecision;
  readonly id: string;
  readonly last_read_at: string | null;
  readonly last_read_at_precision: ReadingDatePrecision;
  readonly memory_confidence: MemoryConfidence;
  readonly previous_revision_id: string | null;
  readonly provenance: string;
  readonly reading_state_id: string;
  readonly revision: number;
  readonly state: ReadingStateCode;
  readonly user_note: string | null;
}

interface AssertionRootRow extends Row {
  readonly current_revision_id: string | null;
  readonly id: string;
  readonly reading_state_id: string;
  readonly revision: number;
}

interface AssertionRevisionRow extends Row {
  readonly assertion_kind: ExperienceAssertionKind;
  readonly confirmation_scope: string;
  readonly id: string;
  readonly statement: string;
  readonly statement_hash: string;
}

interface SpoilerRootRow extends Row {
  readonly current_revision_id: string;
  readonly id: string;
  readonly revision: number;
}

interface WorkRow extends Row {
  readonly canonical_title: string;
  readonly catalog_revision: number;
  readonly catalog_state: string;
  readonly id: string;
}

interface ProfileRow extends Row {
  readonly id: string;
  readonly ownership: string;
  readonly updated_at: string;
}

const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

export interface AuthenticityPermissionView {
  readonly blockingReasonCodes: readonly string[];
  readonly contentBriefModes: {
    readonly personalExperience: ExpressionPermissionState;
    readonly publicResearchAnalysis: ExpressionPermissionState;
  };
  readonly contentBriefReadiness: ExpressionPermissionState;
  readonly dependencyHash: string;
  readonly evaluatedAt: string;
  readonly firstPersonPermission: ExpressionPermissionState;
  readonly personalExperiencePermission: ExpressionPermissionState;
  readonly personalScorePermission: ExpressionPermissionState;
  readonly publicResearchAnalysisPermission: ExpressionPermissionState;
  readonly researchAnalysisScorePermission: ExpressionPermissionState;
  readonly snapshotId: string | null;
  readonly spoiler: ExpressionPermissionSnapshotV1['spoiler'];
  readonly stale: boolean;
  readonly warningReasonCodes: readonly string[];
}

export interface AuthenticityLibraryItem {
  readonly contentBriefReadiness: ExpressionPermissionState;
  readonly dossierReadiness: string;
  readonly memoryConfidence: MemoryConfidence;
  readonly readingState: ReadingStateCode;
  readonly readingStateId: string | null;
  readonly revision: number;
  readonly snapshotStale: boolean;
  readonly workId: string;
  readonly workTitle: string;
}

export interface AuthenticityLibraryView {
  readonly items: readonly AuthenticityLibraryItem[];
  readonly limit: number;
  readonly offset: number;
  readonly profileId: string;
  readonly total: number;
}

export interface ReadingStateRevisionView {
  readonly confirmationKind: ReadingConfirmationKind;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly finishedAtPrecision: ReadingDatePrecision;
  readonly lastReadAt: string | null;
  readonly lastReadAtPrecision: ReadingDatePrecision;
  readonly memoryConfidence: MemoryConfidence;
  readonly provenance: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly state: ReadingStateCode;
  readonly userNote: string | null;
}

export interface ExperienceAssertionView {
  readonly assertionId: string;
  readonly assertionKind: ExperienceAssertionKind;
  readonly assertionRevision: number;
  readonly confirmationScope: string;
  readonly readingStateRevisionId: string;
  readonly stale: boolean;
  readonly statement: string;
  readonly status: 'CONFIRMED' | 'REVOKED';
  readonly updatedAt: string;
}

export interface PublicScoreView {
  readonly origin: PublicScoreOrigin;
  readonly publicLabel: '个人评分' | '资料分析评分';
  readonly revision: number;
  readonly scoreBasisPoints: number | null;
  readonly status: 'ACTIVE' | 'REVOKED';
}

export interface SpoilerPreferenceView {
  readonly level: AuthenticitySpoilerLevel;
  readonly revision: number;
  readonly userConfirmed: boolean;
  readonly warningIncluded: boolean;
}

export interface AuthenticityWorkDetail {
  readonly assertions: readonly ExperienceAssertionView[];
  readonly dossier: DossierPermissionInput | null;
  readonly editions: readonly {
    readonly editionId: string;
    readonly label: string | null;
    readonly publisher: string | null;
  }[];
  readonly expressions: readonly {
    readonly expressionId: string;
    readonly kind: string;
    readonly language: string | null;
    readonly title: string | null;
  }[];
  readonly history: readonly ReadingStateRevisionView[];
  readonly historyLimit: number;
  readonly historyOffset: number;
  readonly memoryConfidence: MemoryConfidence;
  readonly permission: AuthenticityPermissionView;
  readonly personalScore: PublicScoreView | null;
  readonly profileId: string;
  readonly readingState: ReadingStateCode;
  readonly readingStateId: string | null;
  readonly researchScore: PublicScoreView | null;
  readonly revision: number;
  readonly spoilerPreference: SpoilerPreferenceView;
  readonly workId: string;
  readonly workTitle: string;
}

export interface ReadingStateActionPreview {
  readonly after: {
    readonly memoryConfidence: MemoryConfidence;
    readonly state: ReadingStateCode;
  };
  readonly before: {
    readonly memoryConfidence: MemoryConfidence;
    readonly state: ReadingStateCode;
  };
  readonly draft: ReadingStateChangeDraft;
  readonly kind: 'STATE_CHANGE';
  readonly readingStateId: string | null;
}

export interface ReadingUndoActionPreview {
  readonly expectedRevision: number;
  readonly kind: 'STATE_UNDO';
  readonly profileId: string;
  readonly restore: {
    readonly memoryConfidence: MemoryConfidence;
    readonly state: ReadingStateCode;
  };
  readonly workId: string;
}

export interface AssertionActionPreview {
  readonly draft: ExperienceAssertionDraft;
  readonly kind: 'ASSERTION_CONFIRM';
}

export interface AssertionRevokeActionPreview {
  readonly assertionId: string;
  readonly expectedAssertionRevision: number;
  readonly expectedReadingRevision: number;
  readonly kind: 'ASSERTION_REVOKE';
  readonly profileId: string;
  readonly workId: string;
}

export interface ScoreActionPreview {
  readonly draft: ScoreRecordDraft;
  readonly kind: 'SCORE_CHANGE';
  readonly publicLabel: '个人评分' | '资料分析评分';
}

export interface SpoilerActionPreview {
  readonly draft: SpoilerPreferenceDraft;
  readonly kind: 'SPOILER_CHANGE';
  readonly warningPlacement: string;
  readonly warningRequired: boolean;
}

export interface BatchActionPreview {
  readonly draft: BatchReadingStateDraft;
  readonly items: readonly {
    readonly before: ReadingStateCode;
    readonly expectedRevision: number;
    readonly workId: string;
  }[];
  readonly kind: 'BATCH_STATE_CHANGE';
}

export type AuthenticityActionPreviewPayload =
  | AssertionActionPreview
  | AssertionRevokeActionPreview
  | BatchActionPreview
  | ReadingStateActionPreview
  | ReadingUndoActionPreview
  | ScoreActionPreview
  | SpoilerActionPreview;

export interface BatchApplyResult {
  readonly items: readonly {
    readonly errorCode: string | null;
    readonly ok: boolean;
    readonly revision: number | null;
    readonly workId: string;
  }[];
  readonly succeeded: number;
  readonly failed: number;
}

function identifier(value: string, maximum = 768): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length < 1 ||
    Buffer.byteLength(value, 'utf8') > maximum
  ) {
    throw new AuthenticityError('AUTHENTICITY_INVALID_REQUEST');
  }
  return value;
}

function iso(value: string): string {
  if (!UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new AuthenticityError('AUTHENTICITY_INVALID_REQUEST');
  }
  return value;
}

function boundedInteger(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AuthenticityError('AUTHENTICITY_INVALID_REQUEST');
  }
  return value;
}

function parseStringArray(value: unknown): readonly string[] {
  if (typeof value !== 'string') {
    throw new AuthenticityError('AUTHENTICITY_INVALID_CONTRACT');
  }
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new AuthenticityError('AUTHENTICITY_INVALID_CONTRACT');
  }
  return Object.freeze(parsed);
}

function asBoolean(value: unknown): boolean {
  return value === 1;
}

function errorCode(error: unknown): string {
  return error instanceof AuthenticityError ? error.code : 'AUTHENTICITY_CONFLICT';
}

export class SqliteAuthenticityRepository {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  public listLibrary(
    profileIdValue: string,
    input: { readonly limit: number; readonly offset: number; readonly query: string },
  ): AuthenticityLibraryView {
    const profileId = identifier(profileIdValue, 256);
    this.#requireProfile(profileId);
    const limit = boundedInteger(input.limit, 1, 100);
    const offset = boundedInteger(input.offset, 0, 1_000_000);
    if (typeof input.query !== 'string' || Buffer.byteLength(input.query, 'utf8') > 200) {
      throw new AuthenticityError('AUTHENTICITY_INVALID_REQUEST');
    }
    const query = input.query.trim().toLocaleLowerCase();
    const pattern = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    const rows = this.#database
      .prepare(
        `SELECT
           book.id AS work_id,
           book.canonical_title AS work_title,
           state.id AS reading_state_id,
           state.revision AS reading_revision,
           revision.state AS reading_state,
           revision.memory_confidence,
           COALESCE(dossier.readiness, 'NOT_BUILT') AS dossier_readiness,
           snapshot.content_brief_readiness,
           CASE WHEN snapshot.id IS NOT NULL AND (
             invalidation.id IS NOT NULL OR
             snapshot.snapshot_version <> ? OR
             snapshot.authenticity_policy_version <> ? OR
             snapshot.score_policy_version <> ? OR
             snapshot.spoiler_policy_version <> ?
           ) THEN 1 ELSE 0 END AS snapshot_stale
         FROM books AS book
         LEFT JOIN reading_states AS state
           ON state.book_id = book.id AND state.profile_id = ?
         LEFT JOIN reading_state_revisions AS revision
           ON revision.id = state.current_revision_id
         LEFT JOIN research_dossiers AS dossier
           ON dossier.subject_type = 'WORK' AND dossier.subject_id = book.id
         LEFT JOIN expression_permission_snapshots AS snapshot
           ON snapshot.id = state.current_snapshot_id
         LEFT JOIN expression_permission_invalidations AS invalidation
           ON invalidation.id = (
             SELECT candidate.id
             FROM expression_permission_invalidations AS candidate
             WHERE candidate.snapshot_id = snapshot.id
             ORDER BY candidate.created_at DESC, candidate.id DESC
             LIMIT 1
           )
         WHERE book.catalog_state = 'ACTIVE'
           AND (? = '' OR lower(book.canonical_title) LIKE ? ESCAPE '\\')
         ORDER BY lower(book.canonical_title), book.id
         LIMIT ? OFFSET ?`,
      )
      .all(
        EXPRESSION_PERMISSION_VERSION,
        AUTHENTICITY_POLICY_VERSION,
        SCORE_POLICY_VERSION,
        SPOILER_POLICY_VERSION,
        profileId,
        query,
        pattern,
        limit,
        offset,
      ) as Row[];
    const total = (
      this.#database
        .prepare(
          `SELECT count(*) AS count
           FROM books AS book
           WHERE book.catalog_state = 'ACTIVE'
             AND (? = '' OR lower(book.canonical_title) LIKE ? ESCAPE '\\')`,
        )
        .get(query, pattern) as { readonly count: number }
    ).count;
    return Object.freeze({
      items: Object.freeze(
        rows.map((row) => {
          const stale = asBoolean(row.snapshot_stale);
          return Object.freeze({
            contentBriefReadiness: stale
              ? 'STALE_REVIEW_REQUIRED'
              : ((row.content_brief_readiness as ExpressionPermissionState | null) ?? 'BLOCKED'),
            dossierReadiness: row.dossier_readiness as string,
            memoryConfidence: (row.memory_confidence as MemoryConfidence | null) ?? 'UNKNOWN',
            readingState: (row.reading_state as ReadingStateCode | null) ?? 'UNCLASSIFIED',
            readingStateId: (row.reading_state_id as string | null) ?? null,
            revision: (row.reading_revision as number | null) ?? 0,
            snapshotStale: stale,
            workId: row.work_id as string,
            workTitle: row.work_title as string,
          });
        }),
      ),
      limit,
      offset,
      profileId,
      total,
    });
  }

  public getWorkDetail(
    profileIdValue: string,
    workIdValue: string,
    options: { readonly historyLimit?: number; readonly historyOffset?: number } = {},
  ): AuthenticityWorkDetail {
    const profileId = identifier(profileIdValue, 256);
    const workId = identifier(workIdValue);
    this.#requireProfile(profileId);
    const work = this.#requireWork(workId);
    const historyLimit = boundedInteger(options.historyLimit ?? 25, 1, 100);
    const historyOffset = boundedInteger(options.historyOffset ?? 0, 0, 1_000_000);
    const root = this.#findRoot(profileId, workId);
    const current = root === undefined ? undefined : this.#currentRevision(root);
    const dossier = this.#loadDossier(workId);
    const spoilerPreference =
      root === undefined
        ? Object.freeze({
            level: 'NO_SPOILER' as const,
            revision: 0,
            userConfirmed: false,
            warningIncluded: false,
          })
        : this.#loadSpoilerPreference(root);
    const assertions =
      root === undefined || current === undefined
        ? Object.freeze([])
        : this.#loadAssertions(root, current);
    const permission = this.#loadPermissionView(
      profileId,
      workId,
      root,
      current,
      assertions,
      dossier,
      spoilerPreference,
    );
    const expressions = this.#database
      .prepare(
        `SELECT id, expression_kind, canonical_title, language
         FROM expressions
         WHERE work_id = ? AND catalog_state = 'ACTIVE'
         ORDER BY canonical_title, id
         LIMIT 100`,
      )
      .all(workId) as Row[];
    const editions = this.#database
      .prepare(
        `SELECT edition.id, edition.edition_label, edition.publisher
         FROM book_editions AS edition
         JOIN expressions AS expression ON expression.id = edition.expression_id
         WHERE expression.work_id = ? AND edition.catalog_state = 'ACTIVE'
         ORDER BY edition.edition_label, edition.id
         LIMIT 100`,
      )
      .all(workId) as Row[];
    return Object.freeze({
      assertions,
      dossier,
      editions: Object.freeze(
        editions.map((row) =>
          Object.freeze({
            editionId: row.id as string,
            label: row.edition_label as string | null,
            publisher: row.publisher as string | null,
          }),
        ),
      ),
      expressions: Object.freeze(
        expressions.map((row) =>
          Object.freeze({
            expressionId: row.id as string,
            kind: row.expression_kind as string,
            language: row.language as string | null,
            title: row.canonical_title as string | null,
          }),
        ),
      ),
      history:
        root === undefined
          ? Object.freeze([])
          : this.#loadHistory(root, historyLimit, historyOffset),
      historyLimit,
      historyOffset,
      memoryConfidence: current?.memory_confidence ?? 'UNKNOWN',
      permission,
      personalScore:
        root === undefined ? null : this.#loadPublicScore(root.id as string, 'PERSONAL_SCORE'),
      profileId,
      readingState: current?.state ?? 'UNCLASSIFIED',
      readingStateId: (root?.id as string | undefined) ?? null,
      researchScore:
        root === undefined
          ? null
          : this.#loadPublicScore(root.id as string, 'RESEARCH_ANALYSIS_SCORE'),
      revision: (root?.revision as number | undefined) ?? 0,
      spoilerPreference,
      workId,
      workTitle: work.canonical_title as string,
    });
  }

  public previewStateChange(rawDraft: unknown): ReadingStateActionPreview {
    const draft = assertReadingStateChangeDraft(rawDraft);
    this.#validateSubject(draft.profileId, draft.subject);
    const root = this.#findRoot(draft.profileId, draft.subject.workId);
    const revision = (root?.revision as number | undefined) ?? 0;
    if (revision !== draft.expectedRevision) {
      throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
    }
    const current = root === undefined ? undefined : this.#currentRevision(root);
    return Object.freeze({
      after: Object.freeze({
        memoryConfidence: draft.memoryConfidence,
        state: draft.nextState,
      }),
      before: Object.freeze({
        memoryConfidence: current?.memory_confidence ?? 'UNKNOWN',
        state: current?.state ?? 'UNCLASSIFIED',
      }),
      draft,
      kind: 'STATE_CHANGE',
      readingStateId: (root?.id as string | undefined) ?? null,
    });
  }

  public applyStateChange(rawDraft: unknown, nowValue: string): AuthenticityWorkDetail {
    const draft = assertReadingStateChangeDraft(rawDraft);
    const now = iso(nowValue);
    this.#validateSubject(draft.profileId, draft.subject);
    runInTransaction(this.#database, () => {
      let root = this.#findRoot(draft.profileId, draft.subject.workId);
      const currentRevision = (root?.revision as number | undefined) ?? 0;
      if (currentRevision !== draft.expectedRevision) {
        throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
      }
      if (root === undefined) {
        const readingStateId = this.#id('reading-state');
        this.#database
          .prepare(
            `INSERT INTO reading_states (
              id, profile_id, book_id, revision, created_at, updated_at
            ) VALUES (?, ?, ?, 0, ?, ?)`,
          )
          .run(readingStateId, draft.profileId, draft.subject.workId, now, now);
        this.#createDefaultSpoilerPreference(readingStateId, now);
        root = this.#findRoot(draft.profileId, draft.subject.workId);
      }
      if (root === undefined) throw new AuthenticityError('AUTHENTICITY_CONFLICT');
      this.#insertStateRevision(root, draft, now);
      const refreshed = this.#findRoot(draft.profileId, draft.subject.workId);
      if (refreshed === undefined) throw new AuthenticityError('AUTHENTICITY_CONFLICT');
      this.#publishSnapshot(refreshed, now);
    });
    return this.getWorkDetail(draft.profileId, draft.subject.workId);
  }

  public previewUndo(
    profileIdValue: string,
    workIdValue: string,
    expectedRevisionValue: number,
  ): ReadingUndoActionPreview {
    const profileId = identifier(profileIdValue, 256);
    const workId = identifier(workIdValue);
    const expectedRevision = boundedInteger(expectedRevisionValue, 1, 2_147_483_647);
    const root = this.#requireRoot(profileId, workId);
    if (root.revision !== expectedRevision) {
      throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
    }
    const current = this.#currentRevision(root);
    if (current.previous_revision_id === null) {
      throw new AuthenticityError('AUTHENTICITY_POLICY_BLOCKED');
    }
    const previous = this.#database
      .prepare('SELECT * FROM reading_state_revisions WHERE id = ?')
      .get(current.previous_revision_id) as Row | undefined;
    if (previous === undefined) throw new AuthenticityError('AUTHENTICITY_CONFLICT');
    return Object.freeze({
      expectedRevision,
      kind: 'STATE_UNDO',
      profileId,
      restore: Object.freeze({
        memoryConfidence: previous.memory_confidence as MemoryConfidence,
        state: previous.state as ReadingStateCode,
      }),
      workId,
    });
  }

  public applyUndo(preview: ReadingUndoActionPreview, nowValue: string): AuthenticityWorkDetail {
    const now = iso(nowValue);
    const currentPreview = this.previewUndo(
      preview.profileId,
      preview.workId,
      preview.expectedRevision,
    );
    if (authenticitySemanticHash(currentPreview) !== authenticitySemanticHash(preview)) {
      throw new AuthenticityError('AUTHENTICITY_CONFIRMATION_INVALID');
    }
    runInTransaction(this.#database, () => {
      const root = this.#requireRoot(preview.profileId, preview.workId);
      const current = this.#currentRevision(root);
      const previousRevisionId = current.previous_revision_id;
      if (previousRevisionId === null) {
        throw new AuthenticityError('AUTHENTICITY_CONFLICT');
      }
      const previous = this.#database
        .prepare('SELECT * FROM reading_state_revisions WHERE id = ?')
        .get(previousRevisionId) as ReadingRevisionRow | undefined;
      if (previous === undefined) throw new AuthenticityError('AUTHENTICITY_CONFLICT');
      const nextRevision = (root.revision as number) + 1;
      const revisionId = this.#id('reading-revision');
      this.#database
        .prepare(
          `INSERT INTO reading_state_revisions (
            id, reading_state_id, revision, previous_revision_id, contract_version,
            state, memory_confidence, confirmation_kind,
            finished_at, finished_at_precision, last_read_at, last_read_at_precision,
            expression_id, edition_id, user_note, provenance, provenance_identity,
            legacy_payload_json, created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, 'USER_UNDO',
            ?, ?, ?, ?, ?, ?, ?, 'USER_UI', 'explicit-undo', NULL, ?
          )`,
        )
        .run(
          revisionId,
          root.id,
          nextRevision,
          current.id,
          READING_STATE_CONTRACT_VERSION,
          previous.state,
          previous.memory_confidence,
          previous.finished_at,
          previous.finished_at_precision,
          previous.last_read_at,
          previous.last_read_at_precision,
          previous.expression_id,
          previous.edition_id,
          previous.user_note,
          now,
        );
      this.#database
        .prepare(
          `UPDATE reading_states
           SET current_revision_id = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(revisionId, nextRevision, now, root.id, preview.expectedRevision);
      this.#insertAudit(
        root,
        'STATE_UNDONE',
        nextRevision,
        { restoredFromRevision: previous.revision },
        now,
      );
      const refreshed = this.#requireRoot(preview.profileId, preview.workId);
      this.#publishSnapshot(refreshed, now);
    });
    return this.getWorkDetail(preview.profileId, preview.workId);
  }

  public previewAssertion(rawDraft: unknown): AssertionActionPreview {
    const draft = assertExperienceAssertionDraft(rawDraft);
    const root = this.#requireRoot(draft.profileId, draft.workId);
    const current = this.#currentRevision(root);
    if (root.revision !== draft.expectedReadingRevision || current.state !== 'R2_READ_FUZZY') {
      throw new AuthenticityError(
        root.revision !== draft.expectedReadingRevision
          ? 'AUTHENTICITY_STALE_REVISION'
          : 'AUTHENTICITY_POLICY_BLOCKED',
        { retryable: root.revision !== draft.expectedReadingRevision },
      );
    }
    if (draft.assertionId === null && draft.expectedAssertionRevision !== 0) {
      throw new AuthenticityError('AUTHENTICITY_STALE_REVISION');
    }
    if (draft.assertionId !== null) {
      const assertion = this.#database
        .prepare('SELECT * FROM experience_assertions WHERE id = ? AND reading_state_id = ?')
        .get(draft.assertionId, root.id) as AssertionRootRow | undefined;
      if (assertion === undefined) {
        throw new AuthenticityError('AUTHENTICITY_ASSERTION_NOT_FOUND');
      }
      if (assertion.revision !== draft.expectedAssertionRevision) {
        throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
      }
    }
    return Object.freeze({ draft, kind: 'ASSERTION_CONFIRM' });
  }

  public applyAssertion(rawDraft: unknown, nowValue: string): AuthenticityWorkDetail {
    const preview = this.previewAssertion(rawDraft);
    const draft = preview.draft;
    const now = iso(nowValue);
    runInTransaction(this.#database, () => {
      const root = this.#requireRoot(draft.profileId, draft.workId);
      const assertionId = draft.assertionId ?? this.#id('experience-assertion');
      let assertion = this.#database
        .prepare('SELECT * FROM experience_assertions WHERE id = ?')
        .get(assertionId) as AssertionRootRow | undefined;
      if (assertion === undefined) {
        this.#database
          .prepare(
            `INSERT INTO experience_assertions (
              id, reading_state_id, revision, created_at, updated_at
            ) VALUES (?, ?, 0, ?, ?)`,
          )
          .run(assertionId, root.id, now, now);
        assertion = this.#database
          .prepare('SELECT * FROM experience_assertions WHERE id = ?')
          .get(assertionId) as AssertionRootRow;
      }
      if (assertion.revision !== draft.expectedAssertionRevision) {
        throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
      }
      const revision = (assertion.revision as number) + 1;
      const revisionId = this.#id('assertion-revision');
      this.#database
        .prepare(
          `INSERT INTO experience_assertion_revisions (
            id, assertion_id, revision, previous_revision_id, reading_state_revision_id,
            assertion_kind, confirmation_scope, statement, statement_hash,
            status, provenance, confirmed_at, invalidated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 'USER_UI', ?, NULL, ?)`,
        )
        .run(
          revisionId,
          assertionId,
          revision,
          assertion.current_revision_id,
          root.current_revision_id,
          draft.assertionKind,
          draft.confirmationScope,
          draft.statement,
          authenticitySemanticHash(draft.statement),
          now,
          now,
        );
      this.#database
        .prepare(
          `UPDATE experience_assertions
           SET current_revision_id = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(revisionId, revision, now, assertionId, draft.expectedAssertionRevision);
      this.#insertAudit(
        root,
        'ASSERTION_CONFIRMED',
        root.revision as number,
        { assertionId, assertionKind: draft.assertionKind, assertionRevision: revision },
        now,
      );
      this.#publishSnapshot(this.#requireRoot(draft.profileId, draft.workId), now);
    });
    return this.getWorkDetail(draft.profileId, draft.workId);
  }

  public previewAssertionRevoke(input: {
    readonly assertionId: string;
    readonly expectedAssertionRevision: number;
    readonly expectedReadingRevision: number;
    readonly profileId: string;
    readonly workId: string;
  }): AssertionRevokeActionPreview {
    const profileId = identifier(input.profileId, 256);
    const workId = identifier(input.workId);
    const assertionId = identifier(input.assertionId, 256);
    const expectedReadingRevision = boundedInteger(input.expectedReadingRevision, 1, 2_147_483_647);
    const expectedAssertionRevision = boundedInteger(
      input.expectedAssertionRevision,
      1,
      2_147_483_647,
    );
    const root = this.#requireRoot(profileId, workId);
    if (root.revision !== expectedReadingRevision) {
      throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
    }
    const assertion = this.#database
      .prepare('SELECT * FROM experience_assertions WHERE id = ? AND reading_state_id = ?')
      .get(assertionId, root.id) as AssertionRootRow | undefined;
    if (assertion === undefined) {
      throw new AuthenticityError('AUTHENTICITY_ASSERTION_NOT_FOUND');
    }
    if (assertion.revision !== expectedAssertionRevision) {
      throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
    }
    return Object.freeze({
      assertionId,
      expectedAssertionRevision,
      expectedReadingRevision,
      kind: 'ASSERTION_REVOKE',
      profileId,
      workId,
    });
  }

  public applyAssertionRevoke(
    preview: AssertionRevokeActionPreview,
    nowValue: string,
  ): AuthenticityWorkDetail {
    const now = iso(nowValue);
    this.previewAssertionRevoke(preview);
    runInTransaction(this.#database, () => {
      const root = this.#requireRoot(preview.profileId, preview.workId);
      const assertion = this.#database
        .prepare('SELECT * FROM experience_assertions WHERE id = ?')
        .get(preview.assertionId) as AssertionRootRow;
      const current = this.#database
        .prepare('SELECT * FROM experience_assertion_revisions WHERE id = ?')
        .get(assertion.current_revision_id) as AssertionRevisionRow;
      const revision = (assertion.revision as number) + 1;
      const revisionId = this.#id('assertion-revision');
      this.#database
        .prepare(
          `INSERT INTO experience_assertion_revisions (
            id, assertion_id, revision, previous_revision_id, reading_state_revision_id,
            assertion_kind, confirmation_scope, statement, statement_hash,
            status, provenance, confirmed_at, invalidated_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'REVOKED', 'USER_UI', ?, ?, ?)`,
        )
        .run(
          revisionId,
          assertion.id,
          revision,
          current.id,
          root.current_revision_id,
          current.assertion_kind,
          current.confirmation_scope,
          current.statement,
          current.statement_hash,
          now,
          now,
          now,
        );
      this.#database
        .prepare(
          `UPDATE experience_assertions
           SET current_revision_id = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(revisionId, revision, now, assertion.id, preview.expectedAssertionRevision);
      this.#insertAudit(
        root,
        'ASSERTION_REVOKED',
        root.revision as number,
        { assertionId: assertion.id, assertionRevision: revision },
        now,
      );
      this.#publishSnapshot(root, now);
    });
    return this.getWorkDetail(preview.profileId, preview.workId);
  }

  public previewScore(rawDraft: unknown): ScoreActionPreview {
    const draft = assertScoreRecordDraft(rawDraft);
    const root = this.#requireRoot(draft.profileId, draft.workId);
    if (root.revision !== draft.expectedReadingRevision) {
      throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
    }
    const currentScore = this.#loadPublicScore(root.id as string, draft.origin);
    if ((currentScore?.revision ?? 0) !== draft.expectedRevision) {
      throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
    }
    if (draft.scoreBasisPoints !== null) {
      const permission = this.getWorkDetail(draft.profileId, draft.workId).permission;
      const allowed =
        draft.origin === 'PERSONAL_SCORE'
          ? permission.personalScorePermission === 'ALLOWED' ||
            permission.personalScorePermission === 'ALLOWED_WITH_CONFIRMED_ASSERTIONS_ONLY'
          : permission.researchAnalysisScorePermission === 'RESEARCH_ONLY';
      if (!allowed) throw new AuthenticityError('AUTHENTICITY_POLICY_BLOCKED');
    }
    return Object.freeze({
      draft,
      kind: 'SCORE_CHANGE',
      publicLabel: draft.origin === 'PERSONAL_SCORE' ? '个人评分' : '资料分析评分',
    });
  }

  public applyScore(rawDraft: unknown, nowValue: string): AuthenticityWorkDetail {
    const preview = this.previewScore(rawDraft);
    const draft = preview.draft;
    const now = iso(nowValue);
    runInTransaction(this.#database, () => {
      const root = this.#requireRoot(draft.profileId, draft.workId);
      const nextRevision = draft.expectedRevision + 1;
      if (draft.origin === 'PERSONAL_SCORE') {
        let assertionRevisionId: string | null = null;
        const current = this.#currentRevision(root);
        if (current.state === 'R2_READ_FUZZY') {
          const assertion = this.#database
            .prepare(
              `SELECT revision.id
               FROM experience_assertions AS assertion
               JOIN experience_assertion_revisions AS revision
                 ON revision.id = assertion.current_revision_id
               WHERE assertion.reading_state_id = ?
                 AND revision.reading_state_revision_id = ?
                 AND revision.assertion_kind = 'PERSONAL_SCORE'
                 AND revision.status = 'CONFIRMED'
               ORDER BY assertion.updated_at DESC
               LIMIT 1`,
            )
            .get(root.id, root.current_revision_id) as Row | undefined;
          assertionRevisionId = (assertion?.id as string | undefined) ?? null;
          if (draft.scoreBasisPoints !== null && assertionRevisionId === null) {
            throw new AuthenticityError('AUTHENTICITY_POLICY_BLOCKED');
          }
        }
        this.#database
          .prepare(
            `INSERT INTO personal_score_records (
              id, reading_state_id, reading_state_revision_id, assertion_revision_id,
              revision, score_basis_points, status, provenance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'USER_UI', ?)`,
          )
          .run(
            this.#id('personal-score'),
            root.id,
            root.current_revision_id,
            assertionRevisionId,
            nextRevision,
            draft.scoreBasisPoints,
            draft.scoreBasisPoints === null ? 'REVOKED' : 'ACTIVE',
            now,
          );
        this.#insertAudit(
          root,
          draft.scoreBasisPoints === null ? 'PERSONAL_SCORE_REVOKED' : 'PERSONAL_SCORE_SET',
          root.revision as number,
          { scoreRevision: nextRevision },
          now,
        );
      } else {
        const dossier = this.#loadDossier(draft.workId);
        if (
          draft.scoreBasisPoints !== null &&
          (dossier === null || dossier.readiness !== 'READY_FOR_CONTENT_BRIEF' || dossier.stale)
        ) {
          throw new AuthenticityError('AUTHENTICITY_POLICY_BLOCKED');
        }
        if (dossier === null) throw new AuthenticityError('AUTHENTICITY_POLICY_BLOCKED');
        this.#database
          .prepare(
            `INSERT INTO research_analysis_score_records (
              id, reading_state_id, reading_state_revision_id, dossier_id,
              dossier_version_id, revision, score_basis_points, status,
              public_label, provenance, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '资料分析评分', 'USER_UI', ?)`,
          )
          .run(
            this.#id('research-score'),
            root.id,
            root.current_revision_id,
            dossier.dossierId,
            dossier.versionId,
            nextRevision,
            draft.scoreBasisPoints,
            draft.scoreBasisPoints === null ? 'REVOKED' : 'ACTIVE',
            now,
          );
        this.#insertAudit(
          root,
          draft.scoreBasisPoints === null ? 'RESEARCH_SCORE_REVOKED' : 'RESEARCH_SCORE_SET',
          root.revision as number,
          { scoreRevision: nextRevision },
          now,
        );
      }
    });
    return this.getWorkDetail(draft.profileId, draft.workId);
  }

  public previewSpoiler(rawDraft: unknown): SpoilerActionPreview {
    const draft = assertSpoilerPreferenceDraft(rawDraft);
    const root = this.#requireRoot(draft.profileId, draft.workId);
    const preference = this.#loadSpoilerPreference(root);
    if (preference.revision !== draft.expectedRevision) {
      throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
    }
    const policy = evaluateExpressionPermission(
      this.#permissionInput(
        draft.profileId,
        draft.workId,
        root,
        this.#currentRevision(root),
        this.#loadAssertions(root, this.#currentRevision(root)),
        this.#loadDossier(draft.workId),
        {
          level: draft.level,
          revision: preference.revision,
          userConfirmed: draft.userConfirmed,
          warningIncluded: draft.warningIncluded,
        },
      ),
      '2000-01-01T00:00:00.000Z',
    ).spoiler;
    return Object.freeze({
      draft,
      kind: 'SPOILER_CHANGE',
      warningPlacement: policy.warningPlacement,
      warningRequired: policy.warningRequired,
    });
  }

  public applySpoiler(rawDraft: unknown, nowValue: string): AuthenticityWorkDetail {
    const preview = this.previewSpoiler(rawDraft);
    const draft = preview.draft;
    const now = iso(nowValue);
    runInTransaction(this.#database, () => {
      const root = this.#requireRoot(draft.profileId, draft.workId);
      const preferenceRoot = this.#database
        .prepare(
          `SELECT * FROM reading_spoiler_preferences
           WHERE reading_state_id = ?`,
        )
        .get(root.id) as SpoilerRootRow;
      const revision = (preferenceRoot.revision as number) + 1;
      const revisionId = this.#id('spoiler-revision');
      this.#database
        .prepare(
          `INSERT INTO reading_spoiler_preference_revisions (
            id, preference_id, revision, previous_revision_id, policy_version,
            spoiler_level, warning_included, user_confirmed, provenance, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'USER_UI', ?)`,
        )
        .run(
          revisionId,
          preferenceRoot.id,
          revision,
          preferenceRoot.current_revision_id,
          SPOILER_POLICY_VERSION,
          draft.level,
          draft.warningIncluded ? 1 : 0,
          draft.userConfirmed ? 1 : 0,
          now,
        );
      this.#database
        .prepare(
          `UPDATE reading_spoiler_preferences
           SET current_revision_id = ?, revision = ?, updated_at = ?
           WHERE id = ? AND revision = ?`,
        )
        .run(revisionId, revision, now, preferenceRoot.id, draft.expectedRevision);
      this.#insertAudit(
        root,
        'SPOILER_PREFERENCE_CHANGED',
        root.revision as number,
        { level: draft.level, spoilerRevision: revision },
        now,
      );
      this.#publishSnapshot(root, now);
    });
    return this.getWorkDetail(draft.profileId, draft.workId);
  }

  public previewBatch(rawDraft: unknown): BatchActionPreview {
    const draft = assertBatchReadingStateDraft(rawDraft);
    this.#requireProfile(draft.profileId);
    const items = draft.items.map((item) => {
      this.#requireWork(item.workId);
      const root = this.#findRoot(draft.profileId, item.workId);
      const revision = (root?.revision as number | undefined) ?? 0;
      if (revision !== item.expectedRevision) {
        throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', {
          retryable: true,
          safeDetails: { workId: item.workId },
        });
      }
      const current = root === undefined ? undefined : this.#currentRevision(root);
      return Object.freeze({
        before: current?.state ?? ('UNCLASSIFIED' as const),
        expectedRevision: item.expectedRevision,
        workId: item.workId,
      });
    });
    return Object.freeze({ draft, items: Object.freeze(items), kind: 'BATCH_STATE_CHANGE' });
  }

  public applyBatch(rawDraft: unknown, nowValue: string): BatchApplyResult {
    const draft = assertBatchReadingStateDraft(rawDraft);
    const now = iso(nowValue);
    const items = draft.items.map((item) => {
      try {
        const detail = this.applyStateChange(
          {
            confirmationKind: 'USER_BATCH_EXPLICIT',
            expectedRevision: item.expectedRevision,
            finishedAt: null,
            finishedAtPrecision: 'UNKNOWN',
            lastReadAt: null,
            lastReadAtPrecision: 'UNKNOWN',
            memoryConfidence: draft.memoryConfidence,
            nextState: draft.nextState,
            profileId: draft.profileId,
            provenance: 'USER_UI',
            subject: { editionId: null, expressionId: null, workId: item.workId },
            userNote: null,
          },
          now,
        );
        return Object.freeze({
          errorCode: null,
          ok: true,
          revision: detail.revision,
          workId: item.workId,
        });
      } catch (error) {
        return Object.freeze({
          errorCode: errorCode(error),
          ok: false,
          revision: null,
          workId: item.workId,
        });
      }
    });
    const succeeded = items.filter((item) => item.ok).length;
    return Object.freeze({
      failed: items.length - succeeded,
      items: Object.freeze(items),
      succeeded,
    });
  }

  #createDefaultSpoilerPreference(readingStateId: string, now: string): void {
    const preferenceId = this.#id('spoiler-preference');
    const revisionId = this.#id('spoiler-revision');
    this.#database
      .prepare(
        `INSERT INTO reading_spoiler_preferences (
          id, reading_state_id, revision, created_at, updated_at
        ) VALUES (?, ?, 0, ?, ?)`,
      )
      .run(preferenceId, readingStateId, now, now);
    this.#database
      .prepare(
        `INSERT INTO reading_spoiler_preference_revisions (
          id, preference_id, revision, previous_revision_id, policy_version,
          spoiler_level, warning_included, user_confirmed, provenance, created_at
        ) VALUES (?, ?, 1, NULL, ?, 'NO_SPOILER', 0, 0, 'USER_UI', ?)`,
      )
      .run(revisionId, preferenceId, SPOILER_POLICY_VERSION, now);
    this.#database
      .prepare(
        `UPDATE reading_spoiler_preferences
         SET current_revision_id = ?, revision = 1, updated_at = ?
         WHERE id = ? AND revision = 0`,
      )
      .run(revisionId, now, preferenceId);
  }

  #currentRevision(root: ReadingRootRow): ReadingRevisionRow {
    if (root.current_revision_id === null) {
      throw new AuthenticityError('AUTHENTICITY_CONFLICT');
    }
    const row = this.#database
      .prepare('SELECT * FROM reading_state_revisions WHERE id = ?')
      .get(root.current_revision_id) as ReadingRevisionRow | undefined;
    if (row === undefined) throw new AuthenticityError('AUTHENTICITY_CONFLICT');
    return row;
  }

  #findRoot(profileId: string, workId: string): ReadingRootRow | undefined {
    return this.#database
      .prepare('SELECT * FROM reading_states WHERE profile_id = ? AND book_id = ?')
      .get(profileId, workId) as ReadingRootRow | undefined;
  }

  #id(prefix: string): string {
    return `${prefix}-${this.#idFactory()}`;
  }

  #insertAudit(
    root: ReadingRootRow,
    eventType: string,
    revision: number,
    details: Readonly<Record<string, unknown>>,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO reading_authenticity_audit_events (
          id, event_type, reading_state_id, profile_id, book_id,
          revision, actor, details_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'USER', ?, ?)`,
      )
      .run(
        this.#id('authenticity-audit'),
        eventType,
        root.id,
        root.profile_id,
        root.book_id,
        revision,
        canonicalAuthenticityJson(details),
        now,
      );
  }

  #insertDependency(
    snapshotId: string,
    dependencyType: AuthenticityDependencyType,
    dependencyId: string,
    observedRevision: string,
    now: string,
  ): void {
    const dependencyKey = authenticitySemanticHash({
      dependencyId,
      dependencyType,
      observedRevision,
    });
    this.#database
      .prepare(
        `INSERT INTO expression_permission_dependencies (
          snapshot_id, dependency_type, dependency_id, observed_revision,
          dependency_key, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(snapshotId, dependencyType, dependencyId, observedRevision, dependencyKey, now);
  }

  #insertStateRevision(root: ReadingRootRow, draft: ReadingStateChangeDraft, now: string): void {
    const nextRevision = (root.revision as number) + 1;
    const revisionId = this.#id('reading-revision');
    this.#database
      .prepare(
        `INSERT INTO reading_state_revisions (
          id, reading_state_id, revision, previous_revision_id, contract_version,
          state, memory_confidence, confirmation_kind,
          finished_at, finished_at_precision, last_read_at, last_read_at_precision,
          expression_id, edition_id, user_note, provenance, provenance_identity,
          legacy_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USER_UI', ?, NULL, ?)`,
      )
      .run(
        revisionId,
        root.id,
        nextRevision,
        root.current_revision_id,
        READING_STATE_CONTRACT_VERSION,
        draft.nextState,
        draft.memoryConfidence,
        draft.confirmationKind,
        draft.finishedAt,
        draft.finishedAtPrecision,
        draft.lastReadAt,
        draft.lastReadAtPrecision,
        draft.subject.expressionId,
        draft.subject.editionId,
        draft.userNote,
        draft.confirmationKind === 'USER_BATCH_EXPLICIT' ? 'explicit-batch' : 'explicit-single',
        now,
      );
    const result = this.#database
      .prepare(
        `UPDATE reading_states
         SET current_revision_id = ?, revision = ?, updated_at = ?
         WHERE id = ? AND revision = ?`,
      )
      .run(revisionId, nextRevision, now, root.id, root.revision);
    if (result.changes !== 1) {
      throw new AuthenticityError('AUTHENTICITY_STALE_REVISION', { retryable: true });
    }
    this.#insertAudit(
      { ...root, current_revision_id: revisionId },
      'STATE_CHANGED',
      nextRevision,
      {
        confirmationKind: draft.confirmationKind,
        memoryConfidence: draft.memoryConfidence,
        state: draft.nextState,
      },
      now,
    );
  }

  #loadAssertions(
    root: ReadingRootRow,
    currentRevision: ReadingRevisionRow,
  ): readonly ExperienceAssertionView[] {
    const rows = this.#database
      .prepare(
        `SELECT
           assertion.id AS assertion_id,
           assertion.revision AS assertion_revision,
           assertion.updated_at,
           revision.*
         FROM experience_assertions AS assertion
         JOIN experience_assertion_revisions AS revision
           ON revision.id = assertion.current_revision_id
         WHERE assertion.reading_state_id = ?
         ORDER BY assertion.updated_at DESC, assertion.id
         LIMIT 100`,
      )
      .all(root.id) as Row[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          assertionId: row.assertion_id as string,
          assertionKind: row.assertion_kind as ExperienceAssertionKind,
          assertionRevision: row.assertion_revision as number,
          confirmationScope: row.confirmation_scope as string,
          readingStateRevisionId: row.reading_state_revision_id as string,
          stale: row.reading_state_revision_id !== currentRevision.id || row.status !== 'CONFIRMED',
          statement: row.statement as string,
          status: row.status as 'CONFIRMED' | 'REVOKED',
          updatedAt: row.updated_at as string,
        }),
      ),
    );
  }

  #loadDossier(workId: string): DossierPermissionInput | null {
    const row = this.#database
      .prepare(
        `SELECT
           dossier.id AS dossier_id,
           dossier.current_version_id,
           dossier.readiness,
           dossier.state,
           version.coverage_policy_version
         FROM research_dossiers AS dossier
         LEFT JOIN research_dossier_versions AS version
           ON version.id = dossier.current_version_id
         WHERE dossier.subject_type = 'WORK' AND dossier.subject_id = ?
         LIMIT 1`,
      )
      .get(workId) as Row | undefined;
    if (
      row === undefined ||
      row.current_version_id === null ||
      row.coverage_policy_version === null
    ) {
      return null;
    }
    return Object.freeze({
      coveragePolicyVersion: row.coverage_policy_version as string,
      dossierId: row.dossier_id as string,
      readiness: row.readiness as DossierPermissionInput['readiness'],
      stale: row.state === 'REBUILD_REQUIRED' || row.readiness === 'STALE',
      versionId: row.current_version_id as string,
    });
  }

  #loadHistory(
    root: ReadingRootRow,
    limit: number,
    offset: number,
  ): readonly ReadingStateRevisionView[] {
    const rows = this.#database
      .prepare(
        `SELECT * FROM reading_state_revisions
         WHERE reading_state_id = ?
         ORDER BY revision DESC
         LIMIT ? OFFSET ?`,
      )
      .all(root.id, limit, offset) as Row[];
    return Object.freeze(
      rows.map((row) =>
        Object.freeze({
          confirmationKind: row.confirmation_kind as ReadingConfirmationKind,
          createdAt: row.created_at as string,
          finishedAt: row.finished_at as string | null,
          finishedAtPrecision: row.finished_at_precision as ReadingDatePrecision,
          lastReadAt: row.last_read_at as string | null,
          lastReadAtPrecision: row.last_read_at_precision as ReadingDatePrecision,
          memoryConfidence: row.memory_confidence as MemoryConfidence,
          provenance: row.provenance as string,
          revision: row.revision as number,
          revisionId: row.id as string,
          state: row.state as ReadingStateCode,
          userNote: row.user_note as string | null,
        }),
      ),
    );
  }

  #loadPermissionView(
    profileId: string,
    workId: string,
    root: ReadingRootRow | undefined,
    current: ReadingRevisionRow | undefined,
    assertions: readonly ExperienceAssertionView[],
    dossier: DossierPermissionInput | null,
    spoiler: SpoilerPreferenceView,
  ): AuthenticityPermissionView {
    if (root?.current_snapshot_id !== null && root?.current_snapshot_id !== undefined) {
      const snapshot = this.#database
        .prepare(
          `SELECT snapshot.*,
             CASE WHEN
               snapshot.snapshot_version <> ? OR
               snapshot.authenticity_policy_version <> ? OR
               snapshot.score_policy_version <> ? OR
               snapshot.spoiler_policy_version <> ? OR
               EXISTS (
                 SELECT 1 FROM expression_permission_invalidations AS invalidation
                 WHERE invalidation.snapshot_id = snapshot.id
               )
             THEN 1 ELSE 0 END AS stale
           FROM expression_permission_snapshots AS snapshot
           WHERE snapshot.id = ?`,
        )
        .get(
          EXPRESSION_PERMISSION_VERSION,
          AUTHENTICITY_POLICY_VERSION,
          SCORE_POLICY_VERSION,
          SPOILER_POLICY_VERSION,
          root.current_snapshot_id,
        ) as Row | undefined;
      if (snapshot !== undefined) return this.#mapSnapshot(snapshot);
    }
    const evaluated = evaluateExpressionPermission(
      this.#permissionInput(profileId, workId, root, current, assertions, dossier, spoiler),
      '1970-01-01T00:00:00.000Z',
    );
    const mustBeStale = root !== undefined;
    return Object.freeze({
      blockingReasonCodes: mustBeStale
        ? Object.freeze([...evaluated.blockingReasonCodes, 'SNAPSHOT_STALE'].sort())
        : evaluated.blockingReasonCodes,
      contentBriefModes: mustBeStale
        ? Object.freeze({
            personalExperience: 'STALE_REVIEW_REQUIRED' as const,
            publicResearchAnalysis: 'STALE_REVIEW_REQUIRED' as const,
          })
        : evaluated.contentBriefModes,
      contentBriefReadiness: mustBeStale
        ? 'STALE_REVIEW_REQUIRED'
        : evaluated.contentBriefReadiness,
      dependencyHash: evaluated.dependencyHash,
      evaluatedAt: evaluated.evaluatedAt,
      firstPersonPermission: mustBeStale
        ? 'STALE_REVIEW_REQUIRED'
        : evaluated.firstPersonPermission,
      personalExperiencePermission: mustBeStale
        ? 'STALE_REVIEW_REQUIRED'
        : evaluated.personalExperiencePermission,
      personalScorePermission: mustBeStale
        ? 'STALE_REVIEW_REQUIRED'
        : evaluated.personalScorePermission,
      publicResearchAnalysisPermission: mustBeStale
        ? 'STALE_REVIEW_REQUIRED'
        : evaluated.publicResearchAnalysisPermission,
      researchAnalysisScorePermission: mustBeStale
        ? 'STALE_REVIEW_REQUIRED'
        : evaluated.researchAnalysisScorePermission,
      snapshotId: null,
      spoiler: evaluated.spoiler,
      stale: mustBeStale,
      warningReasonCodes: evaluated.warningReasonCodes,
    });
  }

  #loadPublicScore(readingStateId: string, origin: PublicScoreOrigin): PublicScoreView | null {
    const table =
      origin === 'PERSONAL_SCORE' ? 'personal_score_records' : 'research_analysis_score_records';
    const row = this.#database
      .prepare(
        `SELECT revision, score_basis_points, status
         FROM ${table}
         WHERE reading_state_id = ?
         ORDER BY revision DESC
         LIMIT 1`,
      )
      .get(readingStateId) as Row | undefined;
    if (row === undefined) return null;
    return Object.freeze({
      origin,
      publicLabel: origin === 'PERSONAL_SCORE' ? '个人评分' : '资料分析评分',
      revision: row.revision as number,
      scoreBasisPoints: row.score_basis_points as number | null,
      status: row.status as 'ACTIVE' | 'REVOKED',
    });
  }

  #loadSpoilerPreference(root: ReadingRootRow): SpoilerPreferenceView {
    const row = this.#database
      .prepare(
        `SELECT preference.revision, revision.spoiler_level,
           revision.warning_included, revision.user_confirmed
         FROM reading_spoiler_preferences AS preference
         JOIN reading_spoiler_preference_revisions AS revision
           ON revision.id = preference.current_revision_id
         WHERE preference.reading_state_id = ?`,
      )
      .get(root.id) as Row | undefined;
    if (row === undefined) {
      throw new AuthenticityError('AUTHENTICITY_CONFLICT');
    }
    return Object.freeze({
      level: row.spoiler_level as AuthenticitySpoilerLevel,
      revision: row.revision as number,
      userConfirmed: asBoolean(row.user_confirmed),
      warningIncluded: asBoolean(row.warning_included),
    });
  }

  #mapSnapshot(row: Row): AuthenticityPermissionView {
    const stale = asBoolean(row.stale);
    const stalePermission = 'STALE_REVIEW_REQUIRED' as const;
    const stored = (field: string): ExpressionPermissionState =>
      row[field] as ExpressionPermissionState;
    const spoilerLevel = row.spoiler_level as AuthenticitySpoilerLevel;
    return Object.freeze({
      blockingReasonCodes: stale
        ? Object.freeze(
            [...parseStringArray(row.blocking_reason_codes_json), 'SNAPSHOT_STALE'].sort(),
          )
        : parseStringArray(row.blocking_reason_codes_json),
      contentBriefModes: Object.freeze({
        personalExperience: stale ? stalePermission : stored('personal_content_mode'),
        publicResearchAnalysis: stale ? stalePermission : stored('research_content_mode'),
      }),
      contentBriefReadiness: stale ? stalePermission : stored('content_brief_readiness'),
      dependencyHash: row.dependency_hash as string,
      evaluatedAt: row.evaluated_at as string,
      firstPersonPermission: stale ? stalePermission : stored('first_person_permission'),
      personalExperiencePermission: stale
        ? stalePermission
        : stored('personal_experience_permission'),
      personalScorePermission: stale ? stalePermission : stored('personal_score_permission'),
      publicResearchAnalysisPermission: stale
        ? stalePermission
        : stored('public_research_analysis_permission'),
      researchAnalysisScorePermission: stale
        ? stalePermission
        : stored('research_score_permission'),
      snapshotId: row.id as string,
      spoiler: Object.freeze({
        coreTrickDisclosure: spoilerLevel === 'FULL_TRICK_ANALYSIS',
        endingDisclosure: spoilerLevel === 'FULL_TRICK_ANALYSIS',
        level: spoilerLevel,
        reasonCodes: Object.freeze([]),
        satisfied:
          !asBoolean(row.spoiler_warning_required) ||
          (row.content_brief_readiness !== 'BLOCKED' &&
            row.content_brief_readiness !== 'STALE_REVIEW_REQUIRED'),
        userConfirmationRequired: asBoolean(row.spoiler_user_confirmation_required),
        warningPlacement: row.spoiler_warning_placement as
          'BODY_OPENING' | 'COVER_TITLE_AND_BODY_OPENING' | 'NONE',
        warningRequired: asBoolean(row.spoiler_warning_required),
      }),
      stale,
      warningReasonCodes: parseStringArray(row.warning_reason_codes_json),
    });
  }

  #permissionInput(
    profileId: string,
    workId: string,
    root: ReadingRootRow | undefined,
    current: ReadingRevisionRow | undefined,
    assertions: readonly ExperienceAssertionView[],
    dossier: DossierPermissionInput | null,
    spoiler: SpoilerPreferenceView,
  ): unknown {
    return {
      assertions: assertions.map((assertion) => ({
        assertionId: assertion.assertionId,
        assertionKind: assertion.assertionKind,
        assertionRevision: assertion.assertionRevision,
        readingStateRevisionId: assertion.readingStateRevisionId,
        status: assertion.status,
      })),
      dossier,
      memoryConfidence: current?.memory_confidence ?? 'UNKNOWN',
      profileId,
      readingState: current?.state ?? 'UNCLASSIFIED',
      readingStateRevisionId:
        (current?.id as string | undefined) ?? `unclassified:${profileId}:${workId}`,
      spoilerSelection: {
        level: spoiler.level,
        userConfirmed: spoiler.userConfirmed,
        warningIncluded: spoiler.warningIncluded,
      },
      workId,
    };
  }

  #publishSnapshot(root: ReadingRootRow, now: string): string {
    const current = this.#currentRevision(root);
    const assertions = this.#loadAssertions(root, current);
    const dossier = this.#loadDossier(root.book_id as string);
    const spoiler = this.#loadSpoilerPreference(root);
    const snapshot = evaluateExpressionPermission(
      this.#permissionInput(
        root.profile_id as string,
        root.book_id as string,
        root,
        current,
        assertions,
        dossier,
        spoiler,
      ),
      now,
    );
    const snapshotId = this.#id('permission-snapshot');
    this.#database
      .prepare(
        `INSERT INTO expression_permission_snapshots (
          id, reading_state_id, reading_state_revision_id, snapshot_version,
          authenticity_policy_version, score_policy_version, spoiler_policy_version,
          dossier_id, dossier_version_id, dossier_readiness,
          spoiler_level, spoiler_warning_required, spoiler_warning_placement,
          spoiler_user_confirmation_required,
          personal_experience_permission, first_person_permission,
          public_research_analysis_permission, personal_score_permission,
          research_score_permission, personal_content_mode, research_content_mode,
          content_brief_readiness, blocking_reason_codes_json,
          warning_reason_codes_json, dependency_hash, evaluated_at, published_at
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`,
      )
      .run(
        snapshotId,
        root.id,
        root.current_revision_id,
        EXPRESSION_PERMISSION_VERSION,
        AUTHENTICITY_POLICY_VERSION,
        SCORE_POLICY_VERSION,
        SPOILER_POLICY_VERSION,
        dossier?.dossierId ?? null,
        dossier?.versionId ?? null,
        dossier?.readiness ?? null,
        snapshot.spoiler.level,
        snapshot.spoiler.warningRequired ? 1 : 0,
        snapshot.spoiler.warningPlacement,
        snapshot.spoiler.userConfirmationRequired ? 1 : 0,
        snapshot.personalExperiencePermission,
        snapshot.firstPersonPermission,
        snapshot.publicResearchAnalysisPermission,
        snapshot.personalScorePermission,
        snapshot.researchAnalysisScorePermission,
        snapshot.contentBriefModes.personalExperience,
        snapshot.contentBriefModes.publicResearchAnalysis,
        snapshot.contentBriefReadiness,
        canonicalAuthenticityJson(snapshot.blockingReasonCodes),
        canonicalAuthenticityJson(snapshot.warningReasonCodes),
        snapshot.dependencyHash,
        now,
        now,
      );
    this.#insertDependency(
      snapshotId,
      'READING_STATE',
      root.id as string,
      String(root.revision),
      now,
    );
    for (const assertion of assertions) {
      if (!assertion.stale && assertion.status === 'CONFIRMED') {
        this.#insertDependency(
          snapshotId,
          'EXPERIENCE_ASSERTION',
          assertion.assertionId,
          String(assertion.assertionRevision),
          now,
        );
      }
    }
    if (dossier !== null) {
      this.#insertDependency(
        snapshotId,
        'DOSSIER_VERSION',
        dossier.dossierId,
        dossier.versionId,
        now,
      );
      this.#insertDependency(
        snapshotId,
        'DOSSIER_READINESS',
        dossier.dossierId,
        dossier.readiness,
        now,
      );
    }
    this.#insertDependency(
      snapshotId,
      'AUTHENTICITY_POLICY',
      AUTHENTICITY_POLICY_VERSION,
      AUTHENTICITY_POLICY_VERSION,
      now,
    );
    this.#insertDependency(
      snapshotId,
      'SCORE_POLICY',
      SCORE_POLICY_VERSION,
      SCORE_POLICY_VERSION,
      now,
    );
    this.#insertDependency(
      snapshotId,
      'SPOILER_POLICY',
      SPOILER_POLICY_VERSION,
      String(spoiler.revision),
      now,
    );
    const book = this.#requireWork(root.book_id as string);
    this.#insertDependency(
      snapshotId,
      'CATALOG_SUBJECT',
      root.book_id as string,
      String(book.catalog_revision),
      now,
    );
    const profile = this.#requireProfile(root.profile_id as string);
    this.#insertDependency(
      snapshotId,
      'PROFILE',
      root.profile_id as string,
      profile.updated_at as string,
      now,
    );
    this.#database
      .prepare(
        `UPDATE reading_states SET current_snapshot_id = ?, updated_at = ?
         WHERE id = ? AND current_revision_id = ?`,
      )
      .run(snapshotId, now, root.id, root.current_revision_id);
    this.#insertAudit(
      root,
      'SNAPSHOT_PUBLISHED',
      root.revision as number,
      { dependencyHash: snapshot.dependencyHash, snapshotId },
      now,
    );
    return snapshotId;
  }

  #requireProfile(profileId: string): ProfileRow {
    const row = this.#database
      .prepare('SELECT id, ownership, updated_at FROM account_profiles WHERE id = ?')
      .get(profileId) as ProfileRow | undefined;
    if (row === undefined) throw new AuthenticityError('AUTHENTICITY_PROFILE_NOT_FOUND');
    return row;
  }

  #requireRoot(profileId: string, workId: string): ReadingRootRow {
    this.#requireProfile(profileId);
    this.#requireWork(workId);
    const root = this.#findRoot(profileId, workId);
    if (root === undefined) {
      throw new AuthenticityError('AUTHENTICITY_READING_STATE_NOT_FOUND');
    }
    return root;
  }

  #requireWork(workId: string): WorkRow {
    const row = this.#database
      .prepare(
        `SELECT id, canonical_title, catalog_revision, catalog_state
         FROM books WHERE id = ?`,
      )
      .get(workId) as WorkRow | undefined;
    if (row === undefined || row.catalog_state !== 'ACTIVE') {
      throw new AuthenticityError('AUTHENTICITY_SUBJECT_NOT_FOUND');
    }
    return row;
  }

  #validateSubject(profileId: string, subject: ReadingStateChangeDraft['subject']): void {
    this.#requireProfile(profileId);
    this.#requireWork(subject.workId);
    if ((subject.expressionId === null) !== (subject.editionId === null)) {
      if (subject.editionId !== null && subject.expressionId === null) {
        throw new AuthenticityError('AUTHENTICITY_INVALID_REQUEST');
      }
    }
    if (subject.expressionId !== null) {
      const expression = this.#database
        .prepare(
          `SELECT id FROM expressions
           WHERE id = ? AND work_id = ? AND catalog_state = 'ACTIVE'`,
        )
        .get(subject.expressionId, subject.workId);
      if (expression === undefined) {
        throw new AuthenticityError('AUTHENTICITY_SUBJECT_NOT_FOUND');
      }
    }
    if (subject.editionId !== null) {
      const edition = this.#database
        .prepare(
          `SELECT edition.id
           FROM book_editions AS edition
           JOIN expressions AS expression ON expression.id = edition.expression_id
           WHERE edition.id = ? AND expression.id = ? AND expression.work_id = ?
             AND edition.catalog_state = 'ACTIVE'`,
        )
        .get(subject.editionId, subject.expressionId, subject.workId);
      if (edition === undefined) {
        throw new AuthenticityError('AUTHENTICITY_SUBJECT_NOT_FOUND');
      }
    }
  }
}
