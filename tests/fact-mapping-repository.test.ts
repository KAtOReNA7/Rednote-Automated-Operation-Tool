import { afterEach, describe, expect, it } from 'vitest';

import { SqliteEvidenceRepository, SqliteFactMappingRepository } from '../packages/db/src/index.js';
import { evidenceSemanticHash, type ClaimEvidenceV1 } from '../packages/evidence/src/index.js';
import { factMappingHash } from '../packages/quality/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import { createReadyCopyRepositoryFixture, requiredFixtureValue } from './support/copy-fixtures.js';
import {
  dateClaim,
  fullTextEvidence,
  officialClassification,
  syntheticSource,
} from './support/evidence-fixtures.js';

afterEach(cleanTemporaryDatabases);

describe('M3 Issue 026 fact mapping repository', () => {
  it('previews and publishes a local immutable check without changing protected domains', async () => {
    const { database } = await createInitializedDatabase('fact mapping local');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'fact-map-local');
      const repository = new SqliteFactMappingRepository(database);
      const protectedTables = [
        'sources',
        'source_revisions',
        'claims',
        'claim_evidence',
        'fact_evaluations',
        'content_draft_versions',
        'content_brief_versions',
        'approvals',
        'post_packages',
      ] as const;
      const before = Object.fromEntries(
        protectedTables.map((table) => [
          table,
          (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
            .count,
        ]),
      );

      const preview = repository.previewStart({
        draftId: fixture.created.draftId,
        mode: 'LOCAL_MANUAL',
        now: '2026-07-31T02:00:00.000Z',
      });
      expect(preview.plan).toMatchObject({
        maximumModelRequests: 0,
        mode: 'LOCAL_MANUAL',
      });
      const execution = repository.confirmLocalStart({
        executionId: 'fact-map-local-execution',
        now: '2026-07-31T02:00:01.000Z',
        planId: preview.plan.planId,
        previewHash: preview.plan.previewHash,
      });
      expect(['AWAITING_REVIEW', 'FACT_BLOCKED', 'PASS']).toContain(
        execution.checkVersion.rollup.status,
      );
      const replay = repository.confirmLocalStart({
        executionId: 'fact-map-local-execution',
        now: '2026-07-31T02:00:02.000Z',
        planId: preview.plan.planId,
        previewHash: preview.plan.previewHash,
      });
      expect(replay.run.runId).toBe(execution.run.runId);

      const detail = repository.get(fixture.created.draftId);
      expect(detail.status).not.toBe('UNCHECKED');
      expect(detail.artifacts.length).toBeGreaterThan(3);
      expect(detail.statements.length).toBeGreaterThan(0);
      expect(detail.statements.every(({ fragment }) => fragment.length > 0)).toBe(true);
      const summary = database
        .prepare(
          `SELECT draft_version_id, fact_mapping_version_id, legacy_unresolved
           FROM quality_checks WHERE check_type = 'FACT_MAPPING'`,
        )
        .get() as Record<string, unknown>;
      expect(summary).toMatchObject({
        draft_version_id: preview.plan.draftVersionId,
        fact_mapping_version_id: execution.checkVersion.versionId,
        legacy_unresolved: 0,
      });

      const after = Object.fromEntries(
        protectedTables.map((table) => [
          table,
          (database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as { count: number })
            .count,
        ]),
      );
      expect(after).toEqual(before);
    } finally {
      database.close();
    }
  });

  it('uses reverse-dependency and current-check indexes', async () => {
    const { database } = await createInitializedDatabase('fact mapping query plans');
    try {
      const repository = new SqliteFactMappingRepository(database);
      const details = repository
        .queryPlanEvidence()
        .map(({ detail }) => detail)
        .join('\n');
      expect(details).toMatch(/idx_fact_mapping_dependency_reverse/iu);
      expect(details).toMatch(/idx_fact_mapping_invalidation_version/iu);
      expect(details).toMatch(/sqlite_autoindex_fact_mapping_checks_2|draft_id/iu);
    } finally {
      database.close();
    }
  });

  it('publishes a confirmed classification as a new immutable decision version', async () => {
    const { database } = await createInitializedDatabase('fact mapping manual decision');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'fact-map-decision');
      const repository = new SqliteFactMappingRepository(database);
      const start = repository.previewStart({
        draftId: fixture.created.draftId,
        mode: 'LOCAL_MANUAL',
        now: '2026-07-31T02:10:00.000Z',
      });
      repository.confirmLocalStart({
        executionId: 'fact-map-decision-start',
        now: '2026-07-31T02:10:01.000Z',
        planId: start.plan.planId,
        previewHash: start.plan.previewHash,
      });
      const detail = repository.get(fixture.created.draftId);
      const statement = detail.statements.find(
        (item) => item.kind !== 'FACT' && item.protectedSignals.length === 0,
      );
      expect(statement).toBeDefined();
      const decision = {
        draftId: fixture.created.draftId,
        expectedRevision: detail.checkVersion?.decisionRevision ?? -1,
        kind: 'CONFIRM_CLASSIFICATION' as const,
        reason: null,
        statementId: statement?.statementId ?? '',
      };
      const preview = repository.previewDecision(decision, '2026-07-31T02:10:02.000Z');
      const applied = repository.applyDecision({
        decision,
        executionId: 'fact-map-decision-apply',
        now: '2026-07-31T02:10:03.000Z',
        previewHash: factMappingHash({ decision, preview }),
      });
      expect(applied.detail.history).toHaveLength(2);
      expect(applied.detail.checkVersion?.decisionRevision).toBe(1);
      expect(
        database.prepare(`SELECT count(*) AS count FROM fact_mapping_decisions`).get(),
      ).toMatchObject({ count: 1 });
      expect(() =>
        database
          .prepare(
            `UPDATE fact_mapping_statements SET statement_kind = 'RHETORICAL'
             WHERE id = (SELECT id FROM fact_mapping_statements LIMIT 1)`,
          )
          .run(),
      ).toThrow(/immutable/iu);
    } finally {
      database.close();
    }
  });

  it('shows the complete bounded Claim—Evaluation—Evidence—SourceRevision chain', async () => {
    const { database } = await createInitializedDatabase('fact mapping trace chain');
    try {
      const fixture = createReadyCopyRepositoryFixture(database, 'fact-map-trace');
      const workId = requiredFixtureValue(
        fixture.created.payload.brief.workIds.at(0),
        'Draft work',
      );
      const evidence = new SqliteEvidenceRepository(database);
      const sourceText = '合成官方资料：本书于2024年出版。';
      const source = syntheticSource('fact-map-official', sourceText, officialClassification());
      const located = fullTextEvidence(source.sourceId, 1, sourceText);
      evidence.registerSubject('WORK', workId);
      evidence.registerSource(source);
      evidence.createClaim(dateClaim('fact-map-publication-date', workId, '2024'));
      evidence.addEvidence(
        {
          claimId: 'fact-map-publication-date',
          evidenceId: 'fact-map-official-evidence',
          extractedText: sourceText,
          language: 'zh-CN',
          locator: located.locator,
          relation: 'SUPPORTS' satisfies ClaimEvidenceV1['relation'],
          summary: {
            excerptHash: located.excerptHash,
            locatorHash: evidenceSemanticHash(located.locator),
            method: 'MANUAL',
            modelExecutionId: null,
            textZh: '中文摘要仅便于阅读，不是证据。',
          },
        },
        '2026-07-31T02:20:00.000Z',
      );
      expect(
        evidence.reconcileClaim('fact-map-publication-date', '2026-07-31T02:20:01.000Z'),
      ).toMatchObject({ reasonCode: 'OFFICIAL_PRIMARY', status: 'VERIFIED' });

      const firstBlock = requiredFixtureValue(
        fixture.created.payload.blocks.at(0),
        'first Draft block',
      );
      const edited = fixture.copy.saveVersion(
        fixture.created.draftId,
        fixture.created.revision,
        {
          ...fixture.created.payload,
          blocks: fixture.created.payload.blocks.map((block) =>
            block.blockId === firstBlock.blockId ? { ...block, text: '本书于2024年出版。' } : block,
          ),
        },
        ['USER_EDIT'],
        '2026-07-31T02:20:02.000Z',
      );
      const repository = new SqliteFactMappingRepository(database);
      const preview = repository.previewStart({
        draftId: edited.draftId,
        mode: 'LOCAL_MANUAL',
        now: '2026-07-31T02:20:03.000Z',
      });
      repository.confirmLocalStart({
        executionId: 'fact-map-trace-execution',
        now: '2026-07-31T02:20:04.000Z',
        planId: preview.plan.planId,
        previewHash: preview.plan.previewHash,
      });
      const mapped = requiredFixtureValue(
        repository
          .get(edited.draftId)
          .statements.find(({ claimId }) => claimId === 'fact-map-publication-date'),
        'mapped factual Statement',
      );
      const chain = repository.getClaimChain(mapped.statementId);
      expect(chain).toMatchObject({
        claim: {
          claimId: 'fact-map-publication-date',
          current: true,
          predicate: 'publication_date',
        },
        evaluation: {
          reasonCode: 'OFFICIAL_PRIMARY',
          status: 'VERIFIED',
        },
      });
      expect(chain.evidence).toHaveLength(1);
      expect(chain.evidence[0]).toMatchObject({
        excerpt: sourceText,
        relation: 'SUPPORTS',
        source: {
          authorityTier: 'OFFICIAL_PRIMARY',
          current: true,
          displayHost: 'fixture.invalid',
          revisionId: 'fact-map-official:1',
          useClass: 'KEY_FACT_ELIGIBLE',
        },
        summaryZhIsEvidence: false,
      });
      expect(JSON.stringify(chain)).not.toMatch(/sources\/snapshots|https?:\/\//iu);
    } finally {
      database.close();
    }
  });
});
