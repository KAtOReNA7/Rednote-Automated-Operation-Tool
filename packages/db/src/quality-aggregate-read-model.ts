import type { DatabaseSync } from 'node:sqlite';

import {
  evaluateQualityReadiness,
  type QualityReadinessCheckType,
  type QualityReadinessResult,
  type QualityReadinessSourceInput,
  type QualityReadinessSourceStatus,
} from '@mystery-operations/quality';

import { SqliteCopyIntegrityRepository } from './copy-integrity-repository.js';
import { SqliteCopyRepository, type CopyDetailView } from './copy-repository.js';
import {
  SqliteFactMappingRepository,
  type FactMappingDisplayStatus,
} from './fact-mapping-repository.js';
import { SqliteReadingAuthenticityRepository } from './reading-authenticity-repository.js';
import { SqliteSpoilerQualityRepository } from './spoiler-quality-repository.js';

interface HeadRow {
  readonly current_status: CopyDetailView['status'];
  readonly current_version_id: string;
  readonly draft_revision: number;
}

export interface QualityAggregateDetailView {
  readonly detail: CopyDetailView;
  readonly qualityReadiness: QualityReadinessResult;
}

function savedReason(status: QualityReadinessSourceStatus) {
  return status === 'STALE'
    ? ('SAVED_RESULT_STALE' as const)
    : status === 'NOT_RUN'
      ? ('SAVED_RESULT_MISSING' as const)
      : ('SAVED_EXACT_CURRENT' as const);
}

function savedSource(
  checkType: QualityReadinessCheckType,
  status: QualityReadinessSourceStatus,
  draftInvalidated: boolean,
): QualityReadinessSourceInput {
  const effective = draftInvalidated && status !== 'NOT_RUN' ? 'STALE' : status;
  return Object.freeze({
    capability: 'AVAILABLE' as const,
    checkType,
    reason:
      draftInvalidated && effective === 'STALE'
        ? 'CURRENT_DRAFT_INVALIDATED'
        : savedReason(effective),
    status: effective,
  });
}

function unavailableSource(checkType: QualityReadinessCheckType): QualityReadinessSourceInput {
  return Object.freeze({
    capability: 'UNAVAILABLE' as const,
    checkType,
    reason: 'SOURCE_UNAVAILABLE' as const,
    status: 'NOT_RUN' as const,
  });
}

function normalizeFact(status: FactMappingDisplayStatus): QualityReadinessSourceStatus {
  const statuses: Readonly<Record<FactMappingDisplayStatus, QualityReadinessSourceStatus>> = {
    AWAITING_REVIEW: 'REVIEW_REQUIRED',
    FACT_BLOCKED: 'BLOCKED',
    PASS: 'PASS',
    STALE: 'STALE',
    UNCHECKED: 'NOT_RUN',
  };
  return statuses[status];
}

export class SqliteQualityAggregateReadModel {
  readonly #copy: SqliteCopyRepository;
  readonly #database: DatabaseSync;
  readonly #factMapping: SqliteFactMappingRepository;
  readonly #integrity: SqliteCopyIntegrityRepository;
  readonly #reading: SqliteReadingAuthenticityRepository;
  readonly #spoiler: SqliteSpoilerQualityRepository;

  public constructor(database: DatabaseSync) {
    this.#database = database;
    this.#copy = new SqliteCopyRepository(database);
    this.#factMapping = new SqliteFactMappingRepository(database);
    this.#reading = new SqliteReadingAuthenticityRepository(database);
    this.#spoiler = new SqliteSpoilerQualityRepository(database);
    this.#integrity = new SqliteCopyIntegrityRepository(database);
  }

  public get(
    draftId: string,
    options: {
      readonly now: string;
      readonly runLimit?: number;
      readonly runOffset?: number;
      readonly versionLimit?: number;
      readonly versionOffset?: number;
    },
  ): QualityAggregateDetailView {
    if (this.#database.isTransaction) throw new Error('QUALITY_READINESS_TRANSACTION_CONFLICT');
    this.#database.exec('BEGIN');
    try {
      const detail = this.#copy.get(draftId, options);
      const head = this.#database
        .prepare(
          `SELECT head.current_version_id, head.draft_revision, version.status AS current_status
             FROM content_draft_heads AS head
             JOIN content_draft_versions AS version ON version.id = head.current_version_id
            WHERE head.draft_id = ?`,
        )
        .get(detail.draftId) as HeadRow | undefined;
      if (head === undefined) throw new Error('QUALITY_READINESS_CURRENT_DRAFT_UNAVAILABLE');
      const invalidated = detail.invalidationReasons.length > 0;
      const structure = this.#structureSource(detail, head.current_status);
      const readyForChecks =
        detail.state === 'ACTIVE' &&
        head.current_status === 'READY_FOR_QUALITY_PIPELINE' &&
        detail.validation.valid;
      const childSources = readyForChecks
        ? this.#currentSources(detail, options.now, invalidated)
        : this.#notReadySources(detail.draftId);
      if (head.draft_revision !== detail.revision) {
        throw new Error('QUALITY_READINESS_CURRENT_DRAFT_CHANGED');
      }
      const qualityReadiness = evaluateQualityReadiness({
        draft: {
          draftId: detail.draftId,
          revision: detail.revision,
          status: detail.status,
          versionId: head.current_version_id,
        },
        fullSpoilerReviewRequired: detail.payload.brief.spoilerPlan.level === 'FULL_TRICK_ANALYSIS',
        sources: [
          structure,
          childSources.factMapping,
          childSources.reading,
          childSources.spoiler,
          childSources.duplication,
          childSources.titleBody,
          {
            capability: 'DEFERRED_029B',
            checkType: 'INTERNAL_CONSISTENCY',
            reason: 'DEFERRED_029B',
            status: 'NOT_RUN',
          },
        ],
      });
      this.#database.exec('COMMIT');
      return Object.freeze({ detail, qualityReadiness });
    } catch (error) {
      if (this.#database.isTransaction) this.#database.exec('ROLLBACK');
      throw error;
    }
  }

  #currentSources(draft: CopyDetailView, now: string, invalidated: boolean) {
    const safe = (
      checkType: QualityReadinessCheckType,
      read: () => QualityReadinessSourceStatus,
    ) => {
      try {
        return savedSource(checkType, read(), invalidated);
      } catch {
        return unavailableSource(checkType);
      }
    };
    const factMapping = safe('FACT_MAPPING', () =>
      normalizeFact(this.#factMapping.get(draft.draftId).status),
    );
    const reading = safe(
      'READING_AUTHENTICITY',
      () => this.#reading.prepare(draft.draftId, draft.revision, now).savedStatus,
    );
    const spoiler = safe(
      'SPOILER',
      () => this.#spoiler.prepare(draft.draftId, draft.revision, now).savedStatus,
    );
    let duplication = unavailableSource('DUPLICATION');
    let titleBody = unavailableSource('TITLE_BODY_CONSISTENCY');
    try {
      const statuses = this.#integrity.prepare(draft.draftId, draft.revision, now).savedStatuses;
      duplication = savedSource('DUPLICATION', statuses.DUPLICATION, invalidated);
      titleBody = savedSource(
        'TITLE_BODY_CONSISTENCY',
        statuses.TITLE_BODY_CONSISTENCY,
        invalidated,
      );
    } catch {
      // A bounded unavailable row is safer than leaking repository errors through the renderer.
    }
    return { duplication, factMapping, reading, spoiler, titleBody };
  }

  #notReadySources(draftId: string) {
    const prior = (checkType: QualityReadinessCheckType) => {
      const exists =
        checkType === 'FACT_MAPPING'
          ? this.#database
              .prepare(`SELECT 1 FROM fact_mapping_checks WHERE draft_id = ? LIMIT 1`)
              .get(draftId) !== undefined
          : this.#database
              .prepare(`SELECT 1 FROM quality_checks WHERE draft_id = ? AND check_type = ? LIMIT 1`)
              .get(draftId, checkType) !== undefined;
      return savedSource(checkType, exists ? 'STALE' : 'NOT_RUN', false);
    };
    return {
      duplication: prior('DUPLICATION'),
      factMapping: prior('FACT_MAPPING'),
      reading: prior('READING_AUTHENTICITY'),
      spoiler: prior('SPOILER'),
      titleBody: prior('TITLE_BODY_CONSISTENCY'),
    };
  }

  #structureSource(
    detail: CopyDetailView,
    currentStatus: CopyDetailView['status'],
  ): QualityReadinessSourceInput {
    if (detail.invalidationReasons.length > 0) {
      return {
        capability: 'AVAILABLE',
        checkType: 'STRUCTURED_OUTPUT',
        reason: 'CURRENT_DRAFT_INVALIDATED',
        status: 'STALE',
      };
    }
    if (!detail.validation.valid || currentStatus === 'STRUCTURE_INVALID') {
      return {
        capability: 'AVAILABLE',
        checkType: 'STRUCTURED_OUTPUT',
        reason: 'CURRENT_STRUCTURE_INVALID',
        status: 'BLOCKED',
      };
    }
    if (detail.state === 'ACTIVE' && currentStatus === 'READY_FOR_QUALITY_PIPELINE') {
      return {
        capability: 'AVAILABLE',
        checkType: 'STRUCTURED_OUTPUT',
        reason: 'CURRENT_STRUCTURE_VALID',
        status: 'PASS',
      };
    }
    return {
      capability: 'AVAILABLE',
      checkType: 'STRUCTURED_OUTPUT',
      reason: 'CURRENT_DRAFT_NOT_READY',
      status: 'NOT_RUN',
    };
  }
}
