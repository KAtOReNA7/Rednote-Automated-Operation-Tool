import { describe, expect, it } from 'vitest';

import {
  FACT_POLICY_VERSION,
  detectMaterialConflict,
  evaluateFactPolicy,
  type FactPolicyEvidenceV1,
} from '../packages/evidence/src/index.js';

function evidence(
  sourceId: string,
  authorityTier: FactPolicyEvidenceV1['authorityTier'],
  lineageGroup: string,
  independence: FactPolicyEvidenceV1['independence'] = 'CONFIRMED_INDEPENDENT',
  useClass: FactPolicyEvidenceV1['useClass'] = 'KEY_FACT_ELIGIBLE',
): FactPolicyEvidenceV1 {
  return Object.freeze({
    availability: 'AVAILABLE',
    authorityTier,
    independence,
    lineageGroup,
    locatorValid: true,
    relation: 'SUPPORTS',
    sourceId,
    sourceRevision: 1,
    useClass,
  });
}

function policy(items: readonly FactPolicyEvidenceV1[], overrides = {}) {
  return evaluateFactPolicy({
    evidence: items,
    policyVersion: FACT_POLICY_VERSION,
    stale: false,
    unresolvedMaterialConflict: false,
    ...overrides,
  });
}

function dateComparable(claimId: string, value: string, scope = 'scope', multipleAllowed = false) {
  return {
    claimId,
    multipleAllowed,
    normalizedScopeHash: scope,
    policyVersion: FACT_POLICY_VERSION,
    predicate: 'publication_date',
    subjectId: 'work-1',
    subjectType: 'WORK',
    value,
    valueType: 'DATE' as const,
  };
}

describe('Issue 019 FactPolicy and deterministic material conflicts', () => {
  it('verifies one official primary source', () => {
    const result = policy([evidence('official', 'OFFICIAL_PRIMARY', 'official')]);
    expect(result).toMatchObject({ reason: 'OFFICIAL_PRIMARY', status: 'VERIFIED' });
  });

  it('verifies two confirmed independent secondary sources', () => {
    const result = policy([
      evidence('secondary-a', 'INDEPENDENT_SECONDARY', 'group-a'),
      evidence('secondary-b', 'INDEPENDENT_SECONDARY', 'group-b'),
    ]);
    expect(result).toMatchObject({
      confirmedIndependentSecondaryCount: 2,
      reason: 'TWO_INDEPENDENT_SECONDARY',
      status: 'VERIFIED',
    });
  });

  it('does not double-count two reprints in one lineage group', () => {
    const result = policy([
      evidence('reprint-a', 'INDEPENDENT_SECONDARY', 'same-release'),
      evidence('reprint-b', 'INDEPENDENT_SECONDARY', 'same-release'),
    ]);
    expect(result).toMatchObject({
      confirmedIndependentSecondaryCount: 1,
      status: 'SUPPORTED_NOT_VERIFIED',
    });
  });

  it('does not count UNKNOWN or DEPENDENT independence as a second source', () => {
    const result = policy([
      evidence('unknown', 'INDEPENDENT_SECONDARY', 'group-a', 'UNKNOWN'),
      evidence('dependent', 'INDEPENDENT_SECONDARY', 'group-b', 'DEPENDENT'),
    ]);
    expect(result.confirmedIndependentSecondaryCount).toBe(0);
    expect(result.status).toBe('SUPPORTED_NOT_VERIFIED');
  });

  it('keeps discussion and social clips context-only', () => {
    const result = policy([
      evidence('clip-context', 'DISCUSSION_CONTEXT', 'clip-context', 'UNKNOWN', 'CONTEXT_ONLY'),
    ]);
    expect(result).toMatchObject({ reason: 'CONTEXT_ONLY', status: 'INSUFFICIENT' });
  });

  it('shows SUPPORTING_ONLY without satisfying the key-fact threshold', () => {
    expect(
      evaluateFactPolicy({
        evidence: [
          evidence(
            'official-supporting',
            'OFFICIAL_PRIMARY',
            'official-supporting',
            'CONFIRMED_INDEPENDENT',
            'SUPPORTING_ONLY',
          ),
        ],
        policyVersion: FACT_POLICY_VERSION,
        stale: false,
        unresolvedMaterialConflict: false,
      }),
    ).toMatchObject({
      reason: 'VALID_SUPPORT_INSUFFICIENT',
      status: 'SUPPORTED_NOT_VERIFIED',
    });
  });

  it('does not accept AI, copyright, or publication-relationship metadata as policy inputs', () => {
    const base = {
      evidence: [evidence('official', 'OFFICIAL_PRIMARY', 'official')],
      policyVersion: FACT_POLICY_VERSION,
      stale: false,
      unresolvedMaterialConflict: false,
    } as const;
    const evaluation = evaluateFactPolicy(base);
    const withForbiddenMetadata = evaluateFactPolicy({
      ...base,
      aiDisclosure: true,
      copyrightRisk: 'HIGH',
      publicationRelationship: 'LICENSEE',
    } as typeof base);
    expect(withForbiddenMetadata).toEqual(evaluation);
  });

  it('rejects model memory without evidence and blocks unresolved material conflict', () => {
    expect(policy([], { modelMemoryOnly: true })).toMatchObject({
      reason: 'MODEL_MEMORY_REJECTED',
      status: 'REJECTED',
    });
    expect(
      policy([evidence('official', 'OFFICIAL_PRIMARY', 'official')], {
        unresolvedMaterialConflict: true,
      }),
    ).toMatchObject({ reason: 'CONFLICT_BLOCKED', status: 'FACT_BLOCKED' });
  });

  it('marks changed, unavailable, or retracted evidence stale', () => {
    expect(
      policy([evidence('old', 'OFFICIAL_PRIMARY', 'official')], { stale: true }),
    ).toMatchObject({ reason: 'STALE_REVISION', status: 'STALE_REVIEW_REQUIRED' });
    expect(
      policy([
        {
          ...evidence('retracted', 'OFFICIAL_PRIMARY', 'official'),
          availability: 'RETRACTED',
        },
      ]),
    ).toMatchObject({ reason: 'SOURCE_UNAVAILABLE', status: 'STALE_REVIEW_REQUIRED' });
  });

  it('rejects an invalid locator instead of silently using the excerpt', () => {
    expect(
      policy([
        {
          ...evidence('bad-locator', 'OFFICIAL_PRIMARY', 'official'),
          locatorValid: false,
        },
      ]),
    ).toMatchObject({ reason: 'LOCATOR_INVALID', status: 'REJECTED' });
  });

  it('detects incompatible publication dates as material conflicts', () => {
    expect(
      detectMaterialConflict(
        dateComparable('claim-a', '2026-07-29'),
        dateComparable('claim-b', '2026-08-01'),
      ),
    ).toMatchObject({ conflict: true, reason: 'MATERIAL_VALUE_DIFFERENCE' });
  });

  it('does not flag compatible date precision or different scope', () => {
    expect(
      detectMaterialConflict(
        dateComparable('claim-year', '2026'),
        dateComparable('claim-day', '2026-07-29'),
      ),
    ).toMatchObject({ conflict: false, reason: 'COMPATIBLE_DATE_PRECISION' });
    expect(
      detectMaterialConflict(
        dateComparable('claim-cn', '2026-07-29', 'scope-cn'),
        dateComparable('claim-jp', '2026-08-01', 'scope-jp'),
      ),
    ).toMatchObject({ conflict: false, reason: 'DIFFERENT_SCOPE' });
  });

  it('does not flag aliases resolved to one canonical entity or allowed multivalue sets', () => {
    const base = {
      claimId: 'claim-agent-a',
      multipleAllowed: false,
      normalizedScopeHash: 'scope',
      policyVersion: FACT_POLICY_VERSION,
      predicate: 'creator',
      subjectId: 'work-1',
      subjectType: 'WORK',
      value: { entityId: 'agent-canonical', entityType: 'AGENT' as const },
      valueType: 'ENTITY_REF' as const,
    };
    expect(detectMaterialConflict(base, { ...base, claimId: 'claim-agent-b' })).toMatchObject({
      conflict: false,
      reason: 'IDENTICAL_VALUE',
    });
    expect(
      detectMaterialConflict(
        {
          ...base,
          claimId: 'claim-publisher-a',
          multipleAllowed: true,
          predicate: 'publisher_name',
          value: 'Publisher A',
          valueType: 'TEXT',
        },
        {
          ...base,
          claimId: 'claim-publisher-b',
          multipleAllowed: true,
          predicate: 'publisher_name',
          value: 'Publisher B',
          valueType: 'TEXT',
        },
      ),
    ).toMatchObject({ conflict: false, reason: 'MULTIVALUE_ALLOWED' });
  });
});
