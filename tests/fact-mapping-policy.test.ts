import { describe, expect, it } from 'vitest';

import {
  FACT_MAPPING_LIMITS,
  buildClaimCandidateSet,
  buildDeterministicFactMapping,
  checkTypedFactCompatibility,
  evaluateCandidateFactPolicy,
} from '../packages/quality/src/index.js';
import { atomicClaim } from './support/dossier-fixtures.js';
import { requiredFixtureValue } from './support/copy-fixtures.js';
import {
  FACT_MAPPING_NOW,
  candidateRecord,
  candidateSet,
  materializedArtifact,
  syntheticTrace,
  textClaim,
} from './support/fact-mapping-fixtures.js';

describe('M3 Issue 026 typed compatibility, candidate and FactPolicy rules', () => {
  it('matches exact integer, decimal, percent, currency, unit and date values', () => {
    const cases = [
      {
        claim: atomicClaim('integer', 'work-1', 'page_count', 'INTEGER', 320),
        expectedUnit: '页',
        statementText: '全书共320页。',
      },
      {
        claim: atomicClaim('decimal', 'work-1', 'rating', 'DECIMAL_TEXT', '8.5'),
        statementText: '资料评分为8.50分。',
      },
      {
        claim: atomicClaim('percent', 'work-1', 'market_share', 'INTEGER', 80),
        statementText: '公开样本占80%。',
      },
      {
        claim: atomicClaim('currency', 'work-1', 'sales_cny', 'INTEGER', 100),
        statementText: '公开价格为人民币100元。',
      },
      {
        claim: atomicClaim(
          'date',
          'work-1',
          'publication_date',
          'DATE_WITH_PRECISION',
          Object.freeze({ precision: 'DAY', value: '2024-05-01' }),
        ),
        statementText: '本书于2024年5月1日出版。',
      },
    ] as const;
    for (const item of cases) {
      expect(
        checkTypedFactCompatibility({
          claim: item.claim,
          ...('expectedUnit' in item ? { expectedUnit: item.expectedUnit } : {}),
          relation: 'EXACT',
          statementText: item.statementText,
        }),
        item.claim.claimId,
      ).toMatchObject({ compatible: true, reasonCode: 'COMPATIBLE' });
    }
  });

  it('rejects value, unit, currency, comparison and unsupported precision changes', () => {
    const numeric = atomicClaim('numeric', 'work-1', 'sales_count', 'INTEGER', 100);
    expect(
      checkTypedFactCompatibility({
        claim: numeric,
        expectedUnit: '册',
        relation: 'EXACT',
        statementText: '销量达到101册。',
      }),
    ).toMatchObject({ compatible: false, reasonCode: 'NUMERIC_VALUE_MISMATCH' });
    expect(
      checkTypedFactCompatibility({
        claim: numeric,
        expectedUnit: '册',
        relation: 'EXACT',
        statementText: '销量达到100部。',
      }),
    ).toMatchObject({ compatible: false, reasonCode: 'UNIT_MISMATCH' });
    expect(
      checkTypedFactCompatibility({
        claim: atomicClaim('money', 'work-1', 'sales_cny', 'INTEGER', 100),
        relation: 'EXACT',
        statementText: '价格为100美元。',
      }),
    ).toMatchObject({ compatible: false, reasonCode: 'CURRENCY_MISMATCH' });
    expect(
      checkTypedFactCompatibility({
        claim: numeric,
        relation: 'EXACT',
        statementText: '销量超过100册。',
      }),
    ).toMatchObject({ compatible: false, reasonCode: 'COMPARISON_MISMATCH' });
    expect(
      checkTypedFactCompatibility({
        claim: atomicClaim(
          'year',
          'work-1',
          'publication_date',
          'DATE_WITH_PRECISION',
          Object.freeze({ precision: 'YEAR', value: '2024' }),
        ),
        relation: 'EXACT',
        statementText: '本书于2024年5月出版。',
      }),
    ).toMatchObject({ compatible: false, reasonCode: 'DATE_PRECISION_MISMATCH' });
    expect(
      checkTypedFactCompatibility({
        claim: numeric,
        relation: 'EXACT',
        statementText: '销量为1e2册。',
      }),
    ).toMatchObject({ compatible: false, reasonCode: 'INVALID_TYPED_VALUE' });
  });

  it('does not interchange award win, nomination and ranking predicates', () => {
    const award = textClaim('award', 'award_win', '获奖');
    expect(
      checkTypedFactCompatibility({
        claim: award,
        relation: 'EXACT',
        statementText: '本书获奖。',
      }),
    ).toMatchObject({ compatible: true });
    expect(
      checkTypedFactCompatibility({
        claim: award,
        relation: 'EXACT',
        statementText: '本书入围该奖项。',
      }),
    ).toMatchObject({
      compatible: false,
      reasonCode: 'AWARD_PREDICATE_MISMATCH',
    });
    expect(
      checkTypedFactCompatibility({
        claim: award,
        relation: 'EXACT',
        statementText: '本书位列TOP 3。',
      }),
    ).toMatchObject({
      compatible: false,
      reasonCode: 'AWARD_PREDICATE_MISMATCH',
    });
  });

  it('checks subject, predicate and normalized scope before accepting text similarity', () => {
    const claim = atomicClaim('scope', 'work-1', 'publication_date', 'TEXT', '2024年', {
      keyFact: true,
    });
    expect(
      checkTypedFactCompatibility({
        claim,
        expectedSubjectId: 'work-2',
        relation: 'EXACT',
        statementText: '2024年出版。',
      }),
    ).toMatchObject({ relation: 'SUBJECT_MISMATCH' });
    expect(
      checkTypedFactCompatibility({
        claim,
        expectedPredicate: 'award_win',
        relation: 'EXACT',
        statementText: '2024年出版。',
      }),
    ).toMatchObject({ relation: 'PREDICATE_MISMATCH' });
    expect(
      checkTypedFactCompatibility({
        claim,
        relation: 'EXACT',
        statementScope: { language: 'ja-JP' },
        statementText: '2024年出版。',
      }),
    ).toMatchObject({ relation: 'SCOPE_MISMATCH' });
  });

  it('accepts one official primary or two independent secondary lineages only', () => {
    const claim = textClaim('policy', 'canonical_title', '合成作品');
    const official = candidateSet([candidateRecord(claim)]).candidates[0];
    expect(official).toBeDefined();
    expect(evaluateCandidateFactPolicy(requiredFixtureValue(official))).toEqual({
      reasonCode: 'OFFICIAL_PRIMARY_VERIFIED',
      satisfied: true,
    });

    const secondaries = candidateSet([
      candidateRecord(claim, {
        evidence: [
          syntheticTrace(claim, {
            authorityTier: 'INDEPENDENT_SECONDARY',
            lineageGroup: 'secondary-a',
            sourceId: 'secondary-a',
          }),
          syntheticTrace(claim, {
            authorityTier: 'INDEPENDENT_SECONDARY',
            lineageGroup: 'secondary-b',
            sourceId: 'secondary-b',
          }),
        ],
      }),
    ]).candidates[0];
    expect(evaluateCandidateFactPolicy(requiredFixtureValue(secondaries))).toEqual({
      reasonCode: 'TWO_INDEPENDENT_SECONDARIES_VERIFIED',
      satisfied: true,
    });

    const dependent = candidateSet([
      candidateRecord(claim, {
        evidence: [
          syntheticTrace(claim, {
            authorityTier: 'INDEPENDENT_SECONDARY',
            independence: 'DEPENDENT',
            lineageGroup: 'same-lineage',
            originKind: 'BROWSER_CLIP',
            sourceId: 'dependent',
            useClass: 'CONTEXT_ONLY',
          }),
        ],
      }),
    ]).candidates[0];
    expect(evaluateCandidateFactPolicy(requiredFixtureValue(dependent))).toEqual({
      reasonCode: 'DEPENDENT_OR_CONTEXT_ONLY',
      satisfied: false,
    });
  });

  it('blocks unverified, unavailable and contradicting evidence', () => {
    const claim = textClaim('blocked-policy', 'canonical_title', '合成作品');
    const unverified = candidateSet([
      candidateRecord(claim, { evaluationStatus: 'STALE_REVIEW_REQUIRED' }),
    ]).candidates[0];
    expect(evaluateCandidateFactPolicy(requiredFixtureValue(unverified))).toMatchObject({
      reasonCode: 'EVALUATION_NOT_VERIFIED',
      satisfied: false,
    });
    const unavailable = candidateSet([
      candidateRecord(claim, {
        evidence: [syntheticTrace(claim, { availability: 'UNAVAILABLE' })],
      }),
    ]).candidates[0];
    expect(evaluateCandidateFactPolicy(requiredFixtureValue(unavailable))).toMatchObject({
      reasonCode: 'NO_CURRENT_EVIDENCE',
      satisfied: false,
    });
    const contradiction = candidateSet([
      candidateRecord(claim, {
        evidence: [
          syntheticTrace(claim, { sourceId: 'support' }),
          syntheticTrace(claim, {
            relation: 'CONTRADICTS',
            sourceId: 'contradiction',
          }),
        ],
      }),
    ]).candidates[0];
    expect(evaluateCandidateFactPolicy(requiredFixtureValue(contradiction))).toMatchObject({
      reasonCode: 'CONTRADICTING_EVIDENCE',
      satisfied: false,
    });
  });

  it('builds a bounded deterministic allowlist and never borrows a cross-work Claim', () => {
    const work1 = textClaim('work-1-claim', 'canonical_title', '作品甲', 'TEXT', 'work-1');
    const work2 = textClaim('work-2-claim', 'canonical_title', '作品乙', 'TEXT', 'work-2');
    const records = [candidateRecord(work2), candidateRecord(work1)];
    const first = buildClaimCandidateSet(records, {
      allowedClaimIds: new Set(records.map(({ claim }) => claim.claimId)),
      allowedEvidenceIds: new Set(
        records.flatMap(({ evidence }) => evidence.map(({ evidence: item }) => item.evidenceId)),
      ),
      allowedSubjectIds: new Set(['work-1', 'work-2']),
      workIds: new Set(['work-1']),
    });
    const second = buildClaimCandidateSet([...records].reverse(), {
      allowedClaimIds: new Set(records.map(({ claim }) => claim.claimId)),
      allowedEvidenceIds: new Set(
        records.flatMap(({ evidence }) => evidence.map(({ evidence: item }) => item.evidenceId)),
      ),
      allowedSubjectIds: new Set(['work-1', 'work-2']),
      workIds: new Set(['work-1']),
    });
    expect(first.candidates.map(({ claim }) => claim.claimId)).toEqual(['work-1-claim']);
    expect(first).toEqual(second);
  });

  it('truncates a large candidate set deterministically at the frozen V1 limit', () => {
    const records = Array.from({ length: FACT_MAPPING_LIMITS.candidateClaims + 5 }, (_, index) =>
      candidateRecord(
        textClaim(
          `claim-${String(index).padStart(4, '0')}`,
          'synthetic_predicate',
          `value-${index}`,
        ),
      ),
    );
    const set = candidateSet([...records].reverse());
    expect(set.candidates).toHaveLength(FACT_MAPPING_LIMITS.candidateClaims);
    expect(set.truncated).toBe(true);
    expect(set.candidates.map(({ claim }) => claim.claimId)).toEqual(
      [...set.candidates.map(({ claim }) => claim.claimId)].sort(),
    );
  });

  it('aggregates PASS, FACT_BLOCKED and AWAITING_REVIEW without advancing quality', () => {
    const pass = buildDeterministicFactMapping({
      artifacts: [
        materializedArtifact('本书于2024年出版。'),
        materializedArtifact('我觉得这本书值得推荐。', { artifactId: 'opinion' }),
      ],
      candidates: candidateSet([
        candidateRecord(
          atomicClaim(
            'date-pass',
            'work-1',
            'publication_date',
            'DATE_WITH_PRECISION',
            Object.freeze({ precision: 'YEAR', value: '2024' }),
          ),
        ),
      ]),
      createdAt: FACT_MAPPING_NOW,
    });
    expect(pass.rollup.status).toBe('PASS');

    const blocked = buildDeterministicFactMapping({
      artifacts: [materializedArtifact('本书于2024年出版。')],
      candidates: candidateSet([], { workIds: [] }),
      createdAt: FACT_MAPPING_NOW,
    });
    expect(blocked.rollup.status).toBe('FACT_BLOCKED');

    const review = buildDeterministicFactMapping({
      artifacts: [materializedArtifact('本书发表于网络平台。')],
      candidates: candidateSet([], { workIds: [] }),
      createdAt: FACT_MAPPING_NOW,
    });
    expect(review.rollup.status).toBe('AWAITING_REVIEW');
    expect(review.rollup.status).not.toBe('PASS');
  });
});
