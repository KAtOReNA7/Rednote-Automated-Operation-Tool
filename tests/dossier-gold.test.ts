import { afterEach, describe, expect, it } from 'vitest';

import { SqliteDossierRepository, SqliteEvidenceRepository } from '../packages/db/src/index.js';
import { evidenceSemanticHash } from '../packages/evidence/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
  insertMinimalDraft,
} from './support/database-test-utils.js';
import {
  DOSSIER_NOW,
  atomicClaim,
  attachOfficialFact,
  createReadyWorkEvidence,
} from './support/dossier-fixtures.js';
import {
  EVIDENCE_NOW,
  fullTextEvidence,
  officialClassification,
  secondaryClassification,
  syntheticSource,
} from './support/evidence-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('Issue 020 synthetic gold dossier', () => {
  it('preserves multilingual provenance through conflict, resolution, versioning and precise stale marking', async () => {
    const { database } = await createInitializedDatabase('gold 档案 空格');
    try {
      let sequence = 0;
      const evidence = new SqliteEvidenceRepository(database, () => `gold-evidence-${++sequence}`);
      createReadyWorkEvidence(database, evidence, 'work-dossier');
      database.exec(`
        INSERT INTO expressions(
          id, work_id, expression_kind, canonical_title, normalized_title,
          language, catalog_state, revision
        ) VALUES (
          'expression-gold', 'work-dossier', 'TRANSLATION', 'Gold Translation',
          'gold translation', 'en-US', 'ACTIVE', 1
        );
        INSERT INTO book_editions(
          id, expression_id, isbn, translated_title, publisher, publication_date,
          edition_label, format, catalog_state, catalog_revision
        ) VALUES
          ('edition-gold-paper', 'expression-gold', '9780000000001', 'Gold Paper',
           'Synthetic Publisher', '2026-07-29', 'First', 'PAPER', 'ACTIVE', 1),
          ('edition-gold-ebook', 'expression-gold', '9780000000002', 'Gold Ebook',
           'Synthetic Publisher', '2026-07-29', 'Digital', 'EBOOK', 'ACTIVE', 1);
      `);
      evidence.registerSubject('EXPRESSION', 'expression-gold');
      evidence.registerSubject('EDITION', 'edition-gold-paper');
      evidence.registerSubject('EDITION', 'edition-gold-ebook');

      const pageCount = atomicClaim(
        'claim-page-count',
        'work-dossier',
        'page_count',
        'INTEGER',
        320,
      );
      evidence.createClaim(pageCount);
      for (const [sourceId, group, language, text] of [
        ['source-secondary-en', 'secondary-en', 'en-US', 'Independent bibliography: 320 pages.'],
        ['source-secondary-ja', 'secondary-ja', 'ja-JP', '独立書誌資料：全320頁。'],
      ] as const) {
        evidence.registerSource(
          syntheticSource(sourceId, text, secondaryClassification(group), language),
        );
        const located = fullTextEvidence(sourceId, 1, text);
        evidence.addEvidence(
          {
            claimId: pageCount.claimId,
            evidenceId: `evidence-${sourceId}`,
            extractedText: text,
            language,
            locator: located.locator,
            relation: 'SUPPORTS',
            summary: {
              excerptHash: located.excerptHash,
              locatorHash: evidenceSemanticHash(located.locator),
              method: 'MANUAL',
              modelExecutionId: null,
              textZh: `中文摘要：${text}`,
            },
          },
          EVIDENCE_NOW,
        );
      }
      expect(evidence.reconcileClaim(pageCount.claimId, EVIDENCE_NOW)).toMatchObject({
        qualifyingSourceIds: ['source-secondary-en', 'source-secondary-ja'],
        reasonCode: 'TWO_INDEPENDENT_SECONDARY',
        status: 'VERIFIED',
      });

      const dependent = atomicClaim(
        'claim-dependent-reprint',
        'work-dossier',
        'series_order',
        'DECIMAL_TEXT',
        '2',
        { keyFact: false },
      );
      evidence.createClaim(dependent);
      for (const [sourceId, independence, useClass] of [
        ['source-reprint-a', 'CONFIRMED_INDEPENDENT', 'KEY_FACT_ELIGIBLE'],
        ['source-reprint-b', 'DEPENDENT', 'KEY_FACT_ELIGIBLE'],
        ['source-context', 'UNKNOWN', 'CONTEXT_ONLY'],
      ] as const) {
        const text = `Synthetic context ${sourceId}`;
        const classification =
          useClass === 'CONTEXT_ONLY'
            ? {
                authorityTier: 'DISCUSSION_CONTEXT' as const,
                classifiedBy: 'SYNTHETIC_FIXTURE' as const,
                independenceState: independence,
                lineageGroup: 'dependent-release',
                reasonCode: 'SYNTHETIC_CONTEXT',
                useClass,
              }
            : secondaryClassification('dependent-release', independence);
        evidence.registerSource(syntheticSource(sourceId, text, classification, 'en-US'));
        const located = fullTextEvidence(sourceId, 1, text);
        evidence.addEvidence(
          {
            claimId: dependent.claimId,
            evidenceId: `evidence-${sourceId}`,
            extractedText: text,
            language: 'en-US',
            locator: located.locator,
            relation: 'SUPPORTS',
            summary: null,
          },
          EVIDENCE_NOW,
        );
      }
      expect(evidence.reconcileClaim(dependent.claimId, EVIDENCE_NOW).status).not.toBe('VERIFIED');

      attachOfficialFact(
        evidence,
        atomicClaim(
          'claim-publication-conflict',
          'work-dossier',
          'publication_date',
          'DATE_WITH_PRECISION',
          Object.freeze({ precision: 'DAY', value: '2026-08-01' }),
        ),
        'source-publication-conflict',
        'Official synthetic correction: publication date is 2026-08-01.',
        officialClassification('official-conflict'),
        'en-US',
      );
      const conflict = evidence.getSummary().conflicts[0];
      expect(conflict).toMatchObject({ state: 'FACT_BLOCKED' });
      if (conflict === undefined) throw new Error('gold conflict missing');

      insertMinimalDraft(database, 'dossier-protected');
      const protectedTables = [
        'topics',
        'content_briefs',
        'drafts',
        'approvals',
        'post_packages',
        'publications',
      ] as const;
      const before = Object.fromEntries(
        protectedTables.map((table) => [
          table,
          database.prepare(`SELECT count(*) AS count FROM ${table}`).get(),
        ]),
      );

      const dossiers = new SqliteDossierRepository(database, () => `gold-dossier-${++sequence}`);
      const firstPlan = dossiers.previewBuild({ id: 'work-dossier', type: 'WORK' }, DOSSIER_NOW);
      expect(firstPlan.readinessAfter).toBe('FACT_BLOCKED');
      const firstConfirmed = dossiers.confirmBuild(
        firstPlan.planId,
        firstPlan.planHash,
        'gold-execution-1',
        '2026-07-29T04:00:10.000Z',
      );
      dossiers.executeBuild(firstConfirmed.payload, '2026-07-29T04:00:20.000Z');
      const first = dossiers.getDossierDetail(firstPlan.dossierId);
      expect(first.versions).toHaveLength(1);
      expect(first.entries.some((entry) => entry.entryKind === 'DISPUTED')).toBe(true);
      expect(
        first.entries.some(
          (entry) =>
            entry.entryKind === 'CONSENSUS' && entry.claimIds.includes('claim-dependent-reprint'),
        ),
      ).toBe(false);
      expect(first.entries.some((entry) => entry.sourceRevisionIds.length > 0)).toBe(true);

      const resolution = evidence.previewConflictAction(
        conflict.conflictId,
        'ACCEPT_CLAIM',
        'claim-publication',
      );
      evidence.applyConflictAction(
        resolution,
        '采用首个官方日期作为合成 gold 事实。',
        'gold-conflict-resolution',
        '2026-07-29T04:01:00.000Z',
      );
      evidence.reconcileClaim('claim-publication', '2026-07-29T04:01:10.000Z');
      expect(dossiers.getDossierDetail(firstPlan.dossierId).dossier.state).toBe('REBUILD_REQUIRED');

      const secondPlan = dossiers.previewBuild(
        { id: 'work-dossier', type: 'WORK' },
        '2026-07-29T04:02:00.000Z',
      );
      const secondConfirmed = dossiers.confirmBuild(
        secondPlan.planId,
        secondPlan.planHash,
        'gold-execution-2',
        '2026-07-29T04:02:10.000Z',
      );
      dossiers.executeBuild(secondConfirmed.payload, '2026-07-29T04:02:20.000Z');
      const second = dossiers.getDossierDetail(firstPlan.dossierId);
      expect(second.versions.map((version) => version.versionNumber)).toEqual([2, 1]);
      expect(second.dossier.readiness).toBe('READY_FOR_CONTENT_BRIEF');
      expect(second.entries.some((entry) => entry.entryKind === 'DISPUTED')).toBe(false);
      if (second.dossier.currentVersionId === null || first.dossier.currentVersionId === null) {
        throw new Error('gold versions missing');
      }
      const goldDossierCounts = database
        .prepare(
          `SELECT
             (SELECT count(*) FROM research_dossiers) AS dossiers,
             (SELECT count(*) FROM research_dossier_versions) AS versions,
             (SELECT count(*) FROM research_dossier_sections) AS sections,
             (SELECT count(*) FROM research_dossier_entries) AS entries,
             (SELECT count(*) FROM research_dossier_gaps) AS gaps,
             (SELECT count(*) FROM research_dossier_dependencies) AS dependencies`,
        )
        .get();
      expect(goldDossierCounts).toEqual({
        dependencies: 68,
        dossiers: 1,
        entries: 10,
        gaps: 8,
        sections: 20,
        versions: 2,
      });
      const goldAggregationCounts = database
        .prepare(
          `SELECT
             versions.version_number AS versionNumber,
             entries.entry_kind AS entryKind,
             count(*) AS count
           FROM research_dossier_entries AS entries
           JOIN research_dossier_versions AS versions
             ON versions.id = entries.version_id
           GROUP BY versions.version_number, entries.entry_kind
           ORDER BY versions.version_number, entries.entry_kind`,
        )
        .all();
      expect(goldAggregationCounts).toEqual([
        { count: 3, entryKind: 'CONSENSUS', versionNumber: 1 },
        { count: 1, entryKind: 'DISPUTED', versionNumber: 1 },
        { count: 1, entryKind: 'GAP', versionNumber: 1 },
        { count: 4, entryKind: 'CONSENSUS', versionNumber: 2 },
        { count: 1, entryKind: 'GAP', versionNumber: 2 },
      ]);
      const goldCoverage = database
        .prepare(
          `SELECT
             versions.version_number AS versionNumber,
             coverage.overall_basis_points AS overallBasisPoints,
             coverage.required_basis_points AS requiredBasisPoints,
             coverage.optional_basis_points AS optionalBasisPoints,
             coverage.verified_count AS verifiedCount,
             coverage.blocked_count AS blockedCount,
             coverage.stale_count AS staleCount,
             coverage.insufficient_count AS insufficientCount,
             coverage.gap_count AS gapCount,
             versions.readiness AS readiness
           FROM research_dossier_coverage_snapshots AS coverage
           JOIN research_dossier_versions AS versions ON versions.id = coverage.version_id
           ORDER BY versions.version_number`,
        )
        .all();
      expect(goldCoverage).toEqual([
        {
          blockedCount: 1,
          gapCount: 5,
          insufficientCount: 1,
          optionalBasisPoints: 5000,
          overallBasisPoints: 5500,
          readiness: 'FACT_BLOCKED',
          requiredBasisPoints: 6153,
          staleCount: 0,
          verifiedCount: 3,
          versionNumber: 1,
        },
        {
          blockedCount: 0,
          gapCount: 3,
          insufficientCount: 1,
          optionalBasisPoints: 5000,
          overallBasisPoints: 8000,
          readiness: 'READY_FOR_CONTENT_BRIEF',
          requiredBasisPoints: 10000,
          staleCount: 0,
          verifiedCount: 4,
          versionNumber: 2,
        },
      ]);
      expect(
        dossiers.diffVersions(
          firstPlan.dossierId,
          second.dossier.currentVersionId,
          first.dossier.currentVersionId,
        ),
      ).toMatchObject({
        fromVersionId: first.dossier.currentVersionId,
        toVersionId: second.dossier.currentVersionId,
      });

      const undo = evidence.previewConflictAction(conflict.conflictId, 'UNDO', null);
      evidence.applyConflictAction(
        undo,
        '撤销以验证只失效相关档案。',
        'gold-conflict-undo',
        '2026-07-29T04:03:00.000Z',
      );
      expect(dossiers.getDossierDetail(firstPlan.dossierId).dossier.state).toBe('REBUILD_REQUIRED');

      evidence.addSourceRevision({
        availability: 'AVAILABLE',
        classification: officialClassification('source-title'),
        contentHash: '9'.repeat(64),
        createdAt: '2026-07-29T04:04:00.000Z',
        extractedTextHash: '9'.repeat(64),
        extractedTextPath: `sources/snapshots/99/${'9'.repeat(64)}.txt`,
        language: 'ja-JP',
        originKind: 'SYNTHETIC_FIXTURE',
        originRecordId: 'fixture-source-title',
        originRevision: 2,
        publishedAt: null,
        publishedAtPrecision: 'UNKNOWN',
        revision: 2,
        sourceId: 'source-title',
        warnings: ['SYNTHETIC_TEST_FIXTURE'],
      });
      expect(
        database
          .prepare(
            `SELECT count(DISTINCT dossier_id) AS count
             FROM research_dossier_invalidations`,
          )
          .get(),
      ).toEqual({ count: 1 });

      const after = Object.fromEntries(
        protectedTables.map((table) => [
          table,
          database.prepare(`SELECT count(*) AS count FROM ${table}`).get(),
        ]),
      );
      expect(after).toEqual(before);
      expect(database.prepare('SELECT count(*) AS count FROM expressions').get()).toEqual({
        count: 1,
      });
      expect(database.prepare('SELECT count(*) AS count FROM book_editions').get()).toEqual({
        count: 2,
      });
      const multilingualSummaries = (
        database
          .prepare(
            `SELECT count(*) AS count FROM claim_evidence
             WHERE language IN ('ja-JP', 'en-US') AND summary_zh IS NOT NULL`,
          )
          .get() as { readonly count: number }
      ).count;
      expect(multilingualSummaries).toBeGreaterThanOrEqual(2);
    } finally {
      database.close();
    }
  }, 30_000);
});
