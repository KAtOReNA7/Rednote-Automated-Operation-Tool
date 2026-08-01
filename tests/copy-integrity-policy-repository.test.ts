import { afterEach, describe, expect, it } from 'vitest';

import {
  COPY_INTEGRITY_CHECKER_VERSION,
  CopyIntegrityError,
  evaluateCopyIntegrity,
  factMappingHash,
  type EvaluateCopyIntegrityInput,
} from '../packages/quality/src/index.js';
import { SqliteCopyIntegrityRepository } from '../packages/db/src/index.js';
import { copySemanticHash, type ContentDraftPayloadV1 } from '../packages/copy/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  completeCopyPayload,
  createReadyCopyRepositoryFixture,
  requiredFixtureValue,
} from './support/copy-fixtures.js';

const NOW = '2026-08-01T12:00:00.000Z';
const HASH = 'a'.repeat(64);

afterEach(cleanTemporaryDatabases);

function evaluatorInput(
  payload: ContentDraftPayloadV1,
  overrides: Partial<EvaluateCopyIntegrityInput> = {},
): EvaluateCopyIntegrityInput {
  return {
    brief: {
      briefId: payload.brief.briefId,
      currentDependencyHash: 'b'.repeat(64),
      currentInputHash: 'c'.repeat(64),
      currentLockHash: 'd'.repeat(64),
      currentVersionId: payload.brief.briefVersionId,
      exactDependencyHash: 'b'.repeat(64),
      exactInputHash: 'c'.repeat(64),
      exactLockHash: 'd'.repeat(64),
      exactVersionId: payload.brief.briefVersionId,
    },
    corpusEligibleCount: 0,
    corpusTruncated: false,
    current: {
      contentHash: copySemanticHash(payload),
      draftId: 'draft-current',
      draftRevision: 3,
      draftState: 'ACTIVE',
      draftStatus: 'READY_FOR_QUALITY_PIPELINE',
      draftVersionId: 'draft-version-current',
      inputHash: HASH,
      payload,
      structuralPolicyVersion: 'draft-structural-validation-v1',
      structuralReasonCodes: [],
      structuralValid: true,
    },
    evaluatedAt: NOW,
    historical: [],
    publications: {
      exactPublishedDraftVersionIds: [],
      total: 0,
      unavailableLineageCount: 0,
    },
    ...overrides,
  };
}

function check(
  evaluation: ReturnType<typeof evaluateCopyIntegrity>,
  type: 'DUPLICATION' | 'TITLE_BODY_CONSISTENCY',
) {
  return requiredFixtureValue(evaluation.checks.find(({ checkType }) => checkType === type));
}

describe('Issue 029A deterministic Copy Integrity policy', () => {
  it('has a time-independent exact input identity and exposes no source text', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const first = evaluateCopyIntegrity(evaluatorInput(payload));
    const later = evaluateCopyIntegrity({
      ...evaluatorInput(payload),
      evaluatedAt: '2026-08-01T13:00:00.000Z',
    });
    expect(first.inputHash).toBe(later.inputHash);
    expect(first).toMatchObject({
      internalConsistencyStatus: 'NOT_RUN',
      structuralOutputStatus: 'PASS',
    });
    expect(JSON.stringify(first)).not.toContain(requiredFixtureValue(payload.blocks[0]).text);
    expect(first.checks.map(({ checkType }) => checkType)).toEqual([
      'DUPLICATION',
      'TITLE_BODY_CONSISTENCY',
    ]);
  });

  it('blocks provable exact reuse but keeps overlap, truncation and unavailable publication lineage in review', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const firstBlock = requiredFixtureValue(payload.blocks[0]);
    const secondBlock = requiredFixtureValue(payload.blocks[1]);
    const duplicated = {
      ...payload,
      blocks: payload.blocks.map((block) =>
        block.blockId === secondBlock.blockId ? { ...block, text: firstBlock.text } : block,
      ),
    };
    const current = evaluateCopyIntegrity(evaluatorInput(duplicated));
    expect(check(current, 'DUPLICATION')).toMatchObject({ status: 'BLOCKED' });
    expect(check(current, 'DUPLICATION').reasonCodes).toContain('CURRENT_EXACT_DUPLICATE');
    expect(check(current, 'DUPLICATION').findings[0]).toMatchObject({
      disposition: 'BLOCKED',
      locator: { artifactKind: 'BODY_BLOCK', startCodePoint: 0 },
    });

    const historical = {
      contentHash: copySemanticHash(payload),
      draftId: 'draft-other',
      draftVersionId: 'draft-version-other',
      payload,
    };
    const crossRoot = evaluateCopyIntegrity(
      evaluatorInput(payload, { corpusEligibleCount: 1, historical: [historical] }),
    );
    expect(check(crossRoot, 'DUPLICATION').reasonCodes).toContain(
      'HISTORICAL_COLLECTION_EXACT_DUPLICATE',
    );

    const inherited = Array.from({ length: 64 }, (_, index) => ({
      ...historical,
      draftId: 'draft-current',
      draftVersionId: 'old-version-' + index,
    }));
    const incomplete = evaluateCopyIntegrity(
      evaluatorInput(payload, {
        corpusEligibleCount: 65,
        corpusTruncated: true,
        historical: inherited,
        publications: {
          exactPublishedDraftVersionIds: [],
          total: 1,
          unavailableLineageCount: 1,
        },
      }),
    );
    expect(check(incomplete, 'DUPLICATION')).toMatchObject({
      status: 'REVIEW_REQUIRED',
      truncated: true,
    });
    expect(check(incomplete, 'DUPLICATION').reasonCodes).toEqual(
      expect.arrayContaining(['CORPUS_TRUNCATED', 'PUBLISHED_BASELINE_UNAVAILABLE']),
    );
  });

  it('uses authoritative lineage for structural blocks and never upgrades lexical uncertainty to semantic PASS', () => {
    const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
    const selectedId = requiredFixtureValue(payload.selectedTitleId);
    const noTitleLineage: ContentDraftPayloadV1 = {
      ...payload,
      titles: payload.titles.map((title) =>
        title.titleId === selectedId ? { ...title, lineage: [] } : title,
      ),
    };
    const result = check(
      evaluateCopyIntegrity(evaluatorInput(noTitleLineage)),
      'TITLE_BODY_CONSISTENCY',
    );
    expect(result.status).toBe('REVIEW_REQUIRED');
    expect(result.reasonCodes).toContain('TITLE_LINEAGE_MISSING');
    expect(result.findings.every(({ disposition }) => disposition !== 'BLOCKED')).toBe(true);
  });
});

describe('Issue 029A Copy Integrity repository', () => {
  it('previews without writes and atomically appends two bounded content-addressed summaries', async () => {
    const { database } = await createInitializedDatabase('copy integrity repository');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'copy-integrity');
      const repository = new SqliteCopyIntegrityRepository(database);
      const preview = repository.prepare(fixture.created.draftId, fixture.created.revision, NOW);
      expect(preview.savedStatuses).toEqual({
        DUPLICATION: 'NOT_RUN',
        TITLE_BODY_CONSISTENCY: 'NOT_RUN',
      });
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 0,
      });

      const confirmed = repository.confirm(preview.evaluation, '2026-08-01T12:00:01.000Z');
      repository.confirm(preview.evaluation, '2026-08-01T12:00:02.000Z');
      expect(confirmed.savedStatuses).toEqual({
        DUPLICATION: confirmed.evaluation.checks[0].status,
        TITLE_BODY_CONSISTENCY: confirmed.evaluation.checks[1].status,
      });
      const rows = database
        .prepare(
          `SELECT check_type, draft_version_id, details_json, checker_version, input_hash,
             legacy_unresolved, fact_mapping_version_id, fact_mapping_run_id
           FROM quality_checks ORDER BY check_type`,
        )
        .all() as readonly Record<string, unknown>[];
      expect(rows.map((row) => row.check_type)).toEqual(['DUPLICATION', 'TITLE_BODY_CONSISTENCY']);
      for (const row of rows) {
        expect(row).toMatchObject({
          checker_version: COPY_INTEGRITY_CHECKER_VERSION,
          draft_version_id: preview.evaluation.draftVersionId,
          fact_mapping_run_id: null,
          fact_mapping_version_id: null,
          input_hash: preview.evaluation.inputHash,
          legacy_unresolved: 0,
        });
        expect(Buffer.byteLength(row.details_json as string, 'utf8')).toBeLessThanOrEqual(4_096);
        expect(row.details_json).not.toMatch(
          /payload_json|authorization|secret|[A-Z]:\\|\\\\|\bSELECT\b/iu,
        );
      }
      expect(rows).toHaveLength(2);

      const selectedId = requiredFixtureValue(fixture.created.payload.selectedTitleId);
      const next = fixture.copy.saveVersion(
        fixture.created.draftId,
        fixture.created.revision,
        {
          ...fixture.created.payload,
          titles: fixture.created.payload.titles.map((title) =>
            title.titleId === selectedId ? { ...title, text: title.text + '（新版本）' } : title,
          ),
        },
        ['USER_EDIT'],
        '2026-08-01T12:01:00.000Z',
      );
      expect(() => repository.confirm(preview.evaluation, NOW)).toThrow(
        /COPY_INTEGRITY_STALE_REVISION/u,
      );
      expect(repository.prepare(next.draftId, next.revision, NOW).savedStatuses).toEqual({
        DUPLICATION: 'STALE',
        TITLE_BODY_CONSISTENCY: 'STALE',
      });
    } finally {
      database.close();
    }
  });

  it('fails closed on a content-address collision and rolls back the companion insert', async () => {
    const { database } = await createInitializedDatabase('copy integrity collision');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'copy-integrity-collision');
      const repository = new SqliteCopyIntegrityRepository(database);
      const preview = repository.prepare(fixture.created.draftId, fixture.created.revision, NOW);
      const id =
        'copy-integrity-' +
        factMappingHash({
          checkerVersion: COPY_INTEGRITY_CHECKER_VERSION,
          checkType: 'DUPLICATION',
          draftVersionId: preview.evaluation.draftVersionId,
          inputHash: preview.evaluation.inputHash,
        });
      database
        .prepare(
          `INSERT INTO quality_checks(
             id, draft_id, draft_version_id, check_type, result, severity, details_json,
             checker_version, input_hash, legacy_unresolved, created_at
           ) VALUES (?, ?, ?, 'DUPLICATION', 'PASS', 'INFO', ?, ?, ?, 0, ?)`,
        )
        .run(
          id,
          preview.evaluation.draftId,
          preview.evaluation.draftVersionId,
          JSON.stringify({ schemaVersion: 1, status: 'PASS', tampered: true }),
          COPY_INTEGRITY_CHECKER_VERSION,
          preview.evaluation.inputHash,
          NOW,
        );
      expect(() => repository.confirm(preview.evaluation, NOW)).toThrow(CopyIntegrityError);
      expect(database.prepare(`SELECT count(*) AS count FROM quality_checks`).get()).toEqual({
        count: 1,
      });
    } finally {
      database.close();
    }
  });
});
