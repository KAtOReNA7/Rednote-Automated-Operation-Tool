import type { DatabaseSync } from 'node:sqlite';

import type { SqliteAuthenticityRepository } from '../../packages/db/src/index.js';
import {
  applyReadingState,
  AUTHENTICITY_NOW,
  insertAuthenticityDossier,
  insertAuthenticityWork,
} from './authenticity-fixtures.js';

export type TopicFixtureForm = 'OTHER_VERIFIED' | 'PUBLISHED_EDITION' | 'WEB_SERIALIZED';

export interface TopicReadyWorkFixture {
  readonly claimId: string | null;
  readonly dossierId: string;
  readonly expressionId: string;
  readonly versionId: string;
  readonly workId: string;
}

export function insertTopicReadyWork(
  database: DatabaseSync,
  authenticity: SqliteAuthenticityRepository,
  input: {
    readonly analysisMode?: 'PERSONAL' | 'PUBLIC_RESEARCH';
    readonly contextClaim?: boolean;
    readonly form?: TopicFixtureForm;
    readonly spoilerLevel?: 'FULL_TRICK_ANALYSIS' | 'LIGHT_SPOILER' | 'NO_SPOILER';
    readonly workId: string;
  },
): TopicReadyWorkFixture {
  const analysisMode = input.analysisMode ?? 'PUBLIC_RESEARCH';
  const form = input.form ?? 'PUBLISHED_EDITION';
  const spoilerLevel = input.spoilerLevel ?? 'NO_SPOILER';
  insertAuthenticityWork(database, input.workId, `合成作品 ${input.workId}`);
  const expressionId = `expression-${input.workId}`;
  database
    .prepare(
      `INSERT INTO expressions(
         id, work_id, expression_kind, canonical_title, normalized_title,
         language, catalog_state, revision
       ) VALUES (?, ?, ?, ?, ?, 'zh-CN', 'ACTIVE', 1)`,
    )
    .run(
      expressionId,
      input.workId,
      form === 'WEB_SERIALIZED' ? 'SERIALIZED' : 'ORIGINAL',
      `合成表达 ${input.workId}`,
      `合成表达 ${input.workId}`,
    );
  if (form === 'PUBLISHED_EDITION') {
    database
      .prepare(
        `INSERT INTO book_editions(
           id, expression_id, translated_title, publisher, edition_label,
           format, catalog_state, catalog_revision
         ) VALUES (?, ?, ?, '合成出版社', '合成版', 'PAPER', 'ACTIVE', 1)`,
      )
      .run(`edition-${input.workId}`, expressionId, `合成版本 ${input.workId}`);
  }
  const dossier = insertAuthenticityDossier(
    database,
    input.workId,
    'READY_FOR_CONTENT_BRIEF',
    'dossier-coverage-policy-v1',
  );
  database
    .prepare(
      `INSERT INTO research_dossier_coverage_snapshots(
         id, version_id, coverage_policy_version, input_hash,
         overall_basis_points, required_basis_points, optional_basis_points,
         verified_count, blocked_count, stale_count, insufficient_count,
         gap_count, reason_codes_json, created_at
       ) VALUES (?, ?, 'dossier-coverage-policy-v1', ?, 9200, 9500, 8600,
         8, 0, 0, 0, 0, '[]', ?)`,
    )
    .run(`coverage-${input.workId}`, dossier.versionId, 'c'.repeat(64), AUTHENTICITY_NOW);

  let claimId: string | null = null;
  if (input.contextClaim ?? false) {
    claimId = `context-claim-${input.workId}`;
    const sectionId = `context-section-${input.workId}`;
    database
      .prepare(
        `INSERT INTO research_dossier_sections(
           id, version_id, section_key, position, readiness_required,
           coverage_basis_points, verified_count, blocked_count, stale_count,
           insufficient_count, gap_count, reason_codes_json, created_at
         ) VALUES (?, ?, 'RECEPTION_AND_DISCUSSION', 7, 0,
           10000, 1, 0, 0, 0, 0, '[]', ?)`,
      )
      .run(sectionId, dossier.versionId, AUTHENTICITY_NOW);
    database
      .prepare(
        `INSERT INTO claims(
           id, contract_version, subject_type, subject_id, predicate,
           predicate_version, value_type, value_json, normalized_value,
           scope_json, normalized_scope_hash, policy_version, key_fact,
           claimant_source_id, claimant_source_revision, semantic_fingerprint,
           status, provenance_json, confidence, legacy_conflict_status,
           revision, created_at
         ) VALUES (?, 'atomic-claim-v1', 'WORK', ?, 'official_title',
           1, 'TEXT', ?, ?, '{}', ?, 'fact-policy-v1', 0,
           NULL, NULL, ?, 'ACTIVE', '{"kind":"USER_ENTERED"}',
           NULL, NULL, 1, ?)`,
      )
      .run(
        claimId,
        input.workId,
        JSON.stringify(`合成文化背景 ${input.workId}`),
        `合成文化背景 ${input.workId}`,
        'd'.repeat(64),
        'e'.repeat(64),
        AUTHENTICITY_NOW,
      );
    const entryId = `context-entry-${input.workId}`;
    database
      .prepare(
        `INSERT INTO research_dossier_entries(
           id, version_id, section_id, section_key, entry_kind,
           semantic_key, predicate, display_value, structured_value_json,
           fact_status, source_count, evidence_count, conflict_id, gap_id,
           provenance, revision, created_at, updated_at
         ) VALUES (?, ?, ?, 'RECEPTION_AND_DISCUSSION', 'CONSENSUS',
           ?, 'official_title', ?, ?, 'VERIFIED', 1, 1, NULL, NULL,
           'LOCAL_DETERMINISTIC', 1, ?, ?)`,
      )
      .run(
        entryId,
        dossier.versionId,
        sectionId,
        `culture:${input.workId}`,
        `合成文化背景 ${input.workId}`,
        JSON.stringify({ kind: 'SYNTHETIC_CONTEXT' }),
        AUTHENTICITY_NOW,
        AUTHENTICITY_NOW,
      );
    database
      .prepare(
        `INSERT INTO research_dossier_entry_claims(entry_id, claim_id, claim_revision)
         VALUES (?, ?, 1)`,
      )
      .run(entryId, claimId);
  }

  applyReadingState(
    authenticity,
    {
      confidence: analysisMode === 'PERSONAL' ? 'CLEAR' : 'NOT_APPLICABLE',
      state: analysisMode === 'PERSONAL' ? 'R1_READ_CLEAR' : 'S1_RESEARCH_ONLY',
      workId: input.workId,
    },
    AUTHENTICITY_NOW,
  );
  if (spoilerLevel !== 'NO_SPOILER') {
    authenticity.applySpoiler(
      {
        expectedRevision: 1,
        level: spoilerLevel,
        profileId: 'primary',
        userConfirmed: spoilerLevel === 'FULL_TRICK_ANALYSIS',
        warningIncluded: true,
        workId: input.workId,
      },
      AUTHENTICITY_NOW,
    );
  }
  return Object.freeze({
    claimId,
    dossierId: dossier.dossierId,
    expressionId,
    versionId: dossier.versionId,
    workId: input.workId,
  });
}

export function insertCompleteTopicPortfolio(
  database: DatabaseSync,
  authenticity: SqliteAuthenticityRepository,
): readonly TopicReadyWorkFixture[] {
  const fixtures: TopicReadyWorkFixture[] = [];
  for (let index = 0; index < 10; index += 1) {
    fixtures.push(
      insertTopicReadyWork(database, authenticity, {
        analysisMode: index === 9 ? 'PUBLIC_RESEARCH' : 'PERSONAL',
        contextClaim: index < 3,
        form: index % 2 === 0 ? 'WEB_SERIALIZED' : 'PUBLISHED_EDITION',
        spoilerLevel: 'NO_SPOILER',
        workId: `topic-no-spoiler-${index.toString().padStart(2, '0')}`,
      }),
    );
  }
  for (let index = 0; index < 8; index += 1) {
    fixtures.push(
      insertTopicReadyWork(database, authenticity, {
        analysisMode: index === 7 ? 'PUBLIC_RESEARCH' : 'PERSONAL',
        form: index % 2 === 0 ? 'WEB_SERIALIZED' : 'PUBLISHED_EDITION',
        spoilerLevel: 'FULL_TRICK_ANALYSIS',
        workId: `topic-full-${index.toString().padStart(2, '0')}`,
      }),
    );
  }
  return Object.freeze(fixtures);
}
