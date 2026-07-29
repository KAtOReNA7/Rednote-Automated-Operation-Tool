import type { DatabaseSync } from 'node:sqlite';

import type {
  SqliteEvidenceRepository,
  SourceClassificationInputV1,
} from '../../packages/db/src/index.js';
import {
  ATOMIC_CLAIM_CONTRACT_VERSION,
  atomicClaimSemanticFingerprint,
  evidenceSemanticHash,
  type AtomicClaimV1,
  type ClaimValueType,
} from '../../packages/evidence/src/index.js';
import {
  EVIDENCE_NOW,
  fullTextEvidence,
  officialClassification,
  syntheticSource,
} from './evidence-fixtures.js';

export const DOSSIER_NOW = '2026-07-29T04:00:00.000Z';

export function atomicClaim(
  claimId: string,
  subjectId: string,
  predicate: string,
  valueType: ClaimValueType,
  value: AtomicClaimV1['value'],
  options: {
    readonly keyFact?: boolean;
    readonly subjectType?: 'EDITION' | 'EXPRESSION' | 'WORK';
  } = {},
): AtomicClaimV1 {
  const base = {
    claimId,
    claimant: null,
    contractVersion: ATOMIC_CLAIM_CONTRACT_VERSION,
    createdAt: DOSSIER_NOW,
    keyFact: options.keyFact ?? true,
    predicate,
    predicateVersion: 1,
    provenance: Object.freeze({ kind: 'MANUAL' as const, runId: null }),
    revision: 1,
    scope: Object.freeze({
      format: null,
      language: null,
      territory: null,
      validFrom: null,
      validTo: null,
    }),
    status: 'ACTIVE' as const,
    subject: Object.freeze({
      id: subjectId,
      type: options.subjectType ?? ('WORK' as const),
    }),
    value,
    valueType,
  };
  return Object.freeze({
    ...base,
    semanticFingerprint: atomicClaimSemanticFingerprint(base),
  });
}

export function insertDossierCatalogFixture(database: DatabaseSync, workId = 'work-dossier'): void {
  database
    .prepare(
      `INSERT INTO books(
         id, canonical_title, work_type, discovery_status
       ) VALUES (?, '版本档案测试作品', 'MYSTERY', 'DISCOVERED')`,
    )
    .run(workId);
}

export function attachOfficialFact(
  repository: SqliteEvidenceRepository,
  claim: AtomicClaimV1,
  sourceId: string,
  text: string,
  classification: SourceClassificationInputV1 = officialClassification(sourceId),
  language = 'ja-JP',
): void {
  repository.createClaim(claim);
  repository.registerSource(syntheticSource(sourceId, text, classification, language));
  const located = fullTextEvidence(sourceId, 1, text);
  repository.addEvidence(
    {
      claimId: claim.claimId,
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
  repository.reconcileClaim(claim.claimId, EVIDENCE_NOW);
}

export function createReadyWorkEvidence(
  database: DatabaseSync,
  repository: SqliteEvidenceRepository,
  workId = 'work-dossier',
): void {
  insertDossierCatalogFixture(database, workId);
  repository.registerSubject('WORK', workId);
  attachOfficialFact(
    repository,
    atomicClaim('claim-title', workId, 'canonical_title', 'TEXT', '版本档案测试作品'),
    'source-title',
    '公式資料：作品名は「版本档案测试作品」である。',
  );
  attachOfficialFact(
    repository,
    atomicClaim(
      'claim-author',
      workId,
      'author',
      'ENTITY_REF',
      Object.freeze({ entityId: 'agent-author', entityType: 'AGENT' }),
    ),
    'source-author',
    '公式資料：著者は合成测试作者である。',
  );
  attachOfficialFact(
    repository,
    atomicClaim(
      'claim-publication',
      workId,
      'publication_date',
      'DATE_WITH_PRECISION',
      Object.freeze({ precision: 'DAY', value: '2026-07-29' }),
    ),
    'source-publication',
    '公式資料：2026年7月29日に刊行された。',
  );
}
