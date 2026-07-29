import { describe, expect, it } from 'vitest';

import {
  DOSSIER_COVERAGE_POLICY_VERSION,
  buildDossierProjection,
  type DossierFactInput,
  type DossierProjectionInput,
} from '../packages/dossier/src/index.js';

const hash = (character: string): string => character.repeat(64);

function fact(
  claimId: string,
  predicate: string,
  normalizedValue: string,
  overrides: Partial<DossierFactInput> = {},
): DossierFactInput {
  return Object.freeze({
    claimId,
    claimRevision: 1,
    evaluation: {
      createdAt: '2026-07-29T04:00:00.000Z',
      evaluationId: `evaluation-${claimId}`,
      inputIdentityHash: hash(
        claimId
          .slice(-1)
          .toLowerCase()
          .replace(/[^a-f]/gu, 'a'),
      ),
      policyVersion: 'fact-policy-v1',
      reasonCode: 'OFFICIAL_PRIMARY',
      status: 'VERIFIED',
    },
    evidence: [
      {
        availability: 'AVAILABLE',
        classificationRevision: 1,
        evidenceId: `evidence-${claimId}`,
        evidenceRevision: 1,
        relation: 'SUPPORTS',
        sourceCurrentRevision: 1,
        sourceId: `source-${claimId}`,
        sourceRevision: 1,
        verificationStatus: 'VALIDATED',
      },
    ],
    factPolicyVersion: 'fact-policy-v1',
    keyFact: true,
    multipleAllowed: false,
    normalizedScopeHash: hash('b'),
    normalizedValue,
    predicate,
    semanticFingerprint: hash('c'),
    status: 'ACTIVE',
    structuredValue: normalizedValue,
    ...overrides,
  });
}

function input(facts: readonly DossierFactInput[]): DossierProjectionInput {
  return Object.freeze({
    conflicts: Object.freeze([]),
    factPolicyVersion: 'fact-policy-v1',
    facts: Object.freeze([...facts]),
    notApplicable: Object.freeze([]),
    subject: Object.freeze({ id: 'work-policy', type: 'WORK' }),
    subjectRevision: '1',
  });
}

describe('Dossier Coverage Policy V1', () => {
  it('produces an exact deterministic 6500/10000/0 gold result', () => {
    const facts = [
      fact('claim-a', 'canonical_title', '合成作品'),
      fact('claim-b', 'author', '{"entityId":"agent","entityType":"AGENT"}'),
      fact('claim-c', 'publication_date', '{"precision":"YEAR","value":"2026"}'),
    ];
    const first = buildDossierProjection(input(facts));
    const shuffled = buildDossierProjection(input([...facts].reverse()));
    expect(first.inputHash).toBe(shuffled.inputHash);
    expect(first.coverage).toMatchObject({
      coveragePolicyVersion: DOSSIER_COVERAGE_POLICY_VERSION,
      gapCount: 3,
      optionalBasisPoints: 0,
      overallBasisPoints: 6500,
      requiredBasisPoints: 10_000,
      verifiedCount: 3,
    });
    expect(first.readiness).toBe('READY_FOR_CONTENT_BRIEF');
    expect(first.gaps.map(({ reasonCode, required }) => ({ reasonCode, required }))).toEqual([
      { reasonCode: 'NO_CLAIM', required: false },
      { reasonCode: 'NO_CLAIM', required: false },
      { reasonCode: 'NO_CLAIM', required: false },
    ]);
  });

  it('deduplicates semantic facts and keeps stale/supporting-only outside consensus', () => {
    const duplicate = fact('claim-d', 'canonical_title', '合成作品', {
      semanticFingerprint: hash('d'),
    });
    const stale = fact('claim-e', 'publication_date', '2026', {
      evidence: [
        {
          availability: 'AVAILABLE',
          classificationRevision: 1,
          evidenceId: 'evidence-stale',
          evidenceRevision: 1,
          relation: 'SUPPORTS',
          sourceCurrentRevision: 2,
          sourceId: 'source-stale',
          sourceRevision: 1,
          verificationStatus: 'VALIDATED',
        },
      ],
    });
    const insufficient = fact('claim-f', 'author', 'agent', {
      evaluation: {
        createdAt: '2026-07-29T04:00:00.000Z',
        evaluationId: 'evaluation-insufficient',
        inputIdentityHash: hash('e'),
        policyVersion: 'fact-policy-v1',
        reasonCode: 'SOURCE_INDEPENDENCE_UNKNOWN',
        status: 'SUPPORTED_NOT_VERIFIED',
      },
    });
    const projection = buildDossierProjection(
      input([fact('claim-a', 'canonical_title', '合成作品'), duplicate, stale, insufficient]),
    );
    expect(projection.entries.filter((entry) => entry.entryKind === 'CONSENSUS')).toHaveLength(1);
    expect(projection.entries.find((entry) => entry.entryKind === 'CONSENSUS')?.claimIds).toEqual([
      'claim-a',
      'claim-d',
    ]);
    expect(projection.readiness).toBe('STALE');
    expect(projection.gaps.map((gap) => gap.reasonCode)).toContain('EVIDENCE_STALE');
    expect(projection.gaps.map((gap) => gap.reasonCode)).toContain('SOURCE_INDEPENDENCE_UNKNOWN');
  });

  it('keeps material conflict in disputed and blocks readiness', () => {
    const left = fact('claim-a', 'publication_date', '2026-07-29');
    const right = fact('claim-b', 'publication_date', '2026-08-01');
    const projection = buildDossierProjection({
      ...input([
        fact('claim-c', 'canonical_title', '合成作品'),
        fact('claim-d', 'author', 'agent'),
        left,
        right,
      ]),
      conflicts: [
        {
          claimIds: ['claim-a', 'claim-b'],
          conflictId: 'conflict-publication-date',
          revision: 1,
          state: 'FACT_BLOCKED',
        },
      ],
    });
    const disputed = projection.entries.find((entry) => entry.entryKind === 'DISPUTED');
    expect(disputed).toMatchObject({
      conflictId: 'conflict-publication-date',
      factStatus: 'FACT_BLOCKED',
      sourceCount: 2,
    });
    expect(projection.readiness).toBe('FACT_BLOCKED');
    expect(
      projection.gaps.some((gap) => gap.blocking && gap.reasonCode === 'FACT_CONFLICTED'),
    ).toBe(true);
  });

  it('requires audited NOT_APPLICABLE and excludes AI/copyright from its input shape', () => {
    const complete = [
      fact('claim-a', 'canonical_title', '合成作品'),
      fact('claim-b', 'author', 'agent'),
      fact('claim-c', 'publication_date', '2026'),
    ];
    const projection = buildDossierProjection({
      ...input(complete),
      notApplicable: [
        {
          auditRef: 'audit-user-1',
          reasonCode: 'POLICY_FINITE_RULE',
          semanticKey: 'awards.recognition',
        },
      ],
    });
    expect(projection.gaps.map((gap) => gap.semanticKey)).not.toContain(
      'POLICY:AWARDS:awards.recognition',
    );
    expect(() =>
      buildDossierProjection({
        ...input(complete),
        notApplicable: [
          {
            auditRef: '',
            reasonCode: 'MODEL_GUESSED',
            semanticKey: 'awards.recognition',
          },
        ],
      }),
    ).toThrow(/DOSSIER_INVALID_CONTRACT/u);
    expect(Object.keys(input(complete)).sort()).toEqual([
      'conflicts',
      'factPolicyVersion',
      'facts',
      'notApplicable',
      'subject',
      'subjectRevision',
    ]);
    expect(() =>
      buildDossierProjection({
        ...input(complete),
        aiDisclosure: true,
      } as never),
    ).toThrow(/DOSSIER_INVALID_CONTRACT/u);
    expect(() =>
      buildDossierProjection({
        ...input(complete),
        copyrightRisk: 'HIGH',
      } as never),
    ).toThrow(/DOSSIER_INVALID_CONTRACT/u);
  });

  it('keeps publication relationship outside coverage/readiness and fails low coverage closed', () => {
    const complete = [
      fact('claim-a', 'canonical_title', '合成作品'),
      fact('claim-b', 'author', 'agent'),
      fact('claim-c', 'publication_date', '2026'),
    ];
    const baseline = buildDossierProjection(input(complete));
    const relationship = buildDossierProjection(
      input([
        ...complete,
        fact('claim-d', 'publication_relationship', 'OBSERVED_UNVERIFIED', {
          keyFact: false,
        }),
      ]),
    );
    expect(
      relationship.entries.some((entry) => entry.predicate === 'publication_relationship'),
    ).toBe(true);
    expect(relationship.coverage.overallBasisPoints).toBe(baseline.coverage.overallBasisPoints);
    expect(relationship.coverage.requiredBasisPoints).toBe(baseline.coverage.requiredBasisPoints);
    expect(relationship.readiness).toBe(baseline.readiness);

    const lowCoverage = buildDossierProjection(
      input([fact('claim-title', 'canonical_title', '只有标题')]),
    );
    expect(lowCoverage.coverage.requiredBasisPoints).toBeLessThan(10_000);
    expect(lowCoverage.readiness).toBe('INSUFFICIENT_COVERAGE');
  });
});
