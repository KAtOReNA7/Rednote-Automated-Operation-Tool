import { describe, expect, it } from 'vitest';

import {
  buildDeterministicFactMapping,
  projectFactMappingManualDecision,
  resolveDraftTextLocator,
  type FactMappingEditableBundleV1,
  type MaterializedDraftArtifactV1,
} from '../packages/quality/src/index.js';
import { atomicClaim } from './support/dossier-fixtures.js';
import {
  FACT_MAPPING_NOW,
  candidateRecord,
  candidateSet,
  materializedArtifact,
} from './support/fact-mapping-fixtures.js';

function editable(
  artifacts: readonly MaterializedDraftArtifactV1[],
  mapping: ReturnType<typeof buildDeterministicFactMapping>,
): readonly FactMappingEditableBundleV1[] {
  const artifactMap = new Map(
    artifacts.map((artifact) => [
      `${artifact.artifact.artifactKind}:${artifact.artifact.artifactId}`,
      artifact,
    ]),
  );
  return mapping.statements.map(({ result, signals }) => {
    const artifact = artifactMap.get(
      `${result.statement.locator.artifactKind}:${result.statement.locator.artifactId}`,
    );
    if (artifact === undefined) throw new Error('missing synthetic artifact');
    return Object.freeze({
      fragment: resolveDraftTextLocator(artifact, result.statement.locator),
      result,
      signals,
    });
  });
}

describe('M3 Issue 026 immutable manual review projections', () => {
  it('splits MIXED text without changing Draft text or Unicode locator slices', () => {
    const text = '我觉得这本书值得推荐， 本书于2024年出版。';
    const artifacts = [materializedArtifact(text)];
    const candidates = candidateSet([], { workIds: [] });
    const base = buildDeterministicFactMapping({
      artifacts,
      candidates,
      createdAt: FACT_MAPPING_NOW,
    });
    expect(base.statements[0]?.result.statement.classification.kind).toBe('MIXED');
    const splitAt = Array.from(text).lastIndexOf('本');
    const projection = projectFactMappingManualDecision({
      artifactHash: base.artifactHash,
      artifacts,
      bundles: editable(artifacts, base),
      candidates,
      createdAt: '2026-07-31T03:01:00.000Z',
      decision: {
        draftId: 'draft-1',
        expectedRevision: 0,
        kind: 'SPLIT',
        reason: null,
        splitCodePoint: splitAt,
        statementId: base.statements[0]?.result.statement.statementId ?? '',
      },
      idSeed: 'split-decision',
      warningBoundaryEscapes: [],
    });
    expect(projection.statements).toHaveLength(2);
    expect(projection.statements.map(({ fragment }) => fragment).join('')).toBe(text);
    expect(projection.statements[0]?.fragment.endsWith(' ')).toBe(true);
    expect(projection.statements[0]?.result.statement.locator.endCodePoint).toBe(
      projection.statements[1]?.result.statement.locator.startCodePoint,
    );
    expect(projection.statements.map(({ result }) => result.statement.provenance)).toEqual([
      'USER_DEFINED',
      'USER_DEFINED',
    ]);
  });

  it('requires a bounded reason before downgrading a protected signal to non-fact', () => {
    const artifacts = [materializedArtifact('本书于2024年出版。')];
    const candidates = candidateSet([], { workIds: [] });
    const base = buildDeterministicFactMapping({
      artifacts,
      candidates,
      createdAt: FACT_MAPPING_NOW,
    });
    const decision = {
      domain: 'NOT_APPLICABLE' as const,
      draftId: 'draft-1',
      expectedRevision: 0,
      kind: 'RECLASSIFY' as const,
      materiality: 'NOT_APPLICABLE' as const,
      reason: null,
      statementId: base.statements[0]?.result.statement.statementId ?? '',
      statementKind: 'OPINION' as const,
    };
    expect(() =>
      projectFactMappingManualDecision({
        artifactHash: base.artifactHash,
        artifacts,
        bundles: editable(artifacts, base),
        candidates,
        createdAt: '2026-07-31T03:02:00.000Z',
        decision,
        idSeed: 'protected-without-reason',
        warningBoundaryEscapes: [],
      }),
    ).toThrow(/FACT_MAPPING_PROTECTED_SIGNAL/u);
    const accepted = projectFactMappingManualDecision({
      artifactHash: base.artifactHash,
      artifacts,
      bundles: editable(artifacts, base),
      candidates,
      createdAt: '2026-07-31T03:02:01.000Z',
      decision: {
        ...decision,
        reason: '这是用户自己的阅读时间表达，不是作品出版日期。',
      },
      idSeed: 'protected-with-reason',
      warningBoundaryEscapes: [],
    });
    expect(accepted.after).toMatchObject({
      disposition: 'NOT_APPLICABLE',
      kind: 'OPINION',
    });
    expect(accepted.statements[0]?.signals).toEqual([
      expect.objectContaining({
        acknowledged: true,
        reason: '这是用户自己的阅读时间表达，不是作品出版日期。',
      }),
    ]);
  });

  it('supports unmap, map, reopen and undo as immutable versions', () => {
    const artifacts = [materializedArtifact('本书于2024年出版。')];
    const claim = atomicClaim(
      'claim-manual-date',
      'work-1',
      'publication_date',
      'DATE_WITH_PRECISION',
      Object.freeze({ precision: 'YEAR', value: '2024' }),
    );
    const candidates = candidateSet([candidateRecord(claim)]);
    const base = buildDeterministicFactMapping({
      artifacts,
      candidates,
      createdAt: FACT_MAPPING_NOW,
    });
    expect(base.rollup.status).toBe('PASS');
    const initial = editable(artifacts, base);

    const unmapped = projectFactMappingManualDecision({
      artifactHash: base.artifactHash,
      artifacts,
      bundles: initial,
      candidates,
      createdAt: '2026-07-31T03:03:00.000Z',
      decision: {
        draftId: 'draft-1',
        expectedRevision: 0,
        kind: 'UNMAP_CLAIM',
        reason: '人工重新选择候选。',
        statementId: initial[0]?.result.statement.statementId ?? '',
      },
      idSeed: 'unmap',
      warningBoundaryEscapes: [],
    });
    expect(unmapped.rollup.status).toBe('FACT_BLOCKED');

    const mapped = projectFactMappingManualDecision({
      artifactHash: base.artifactHash,
      artifacts,
      bundles: unmapped.statements,
      candidates,
      createdAt: '2026-07-31T03:03:01.000Z',
      decision: {
        claimId: claim.claimId,
        draftId: 'draft-1',
        expectedRevision: 1,
        kind: 'MAP_CLAIM',
        reason: '已核对本地 current 证据链。',
        relation: 'EXACT',
        statementId: unmapped.statements[0]?.result.statement.statementId ?? '',
      },
      idSeed: 'map',
      warningBoundaryEscapes: [],
    });
    expect(mapped.rollup.status).toBe('PASS');
    expect(mapped.after.claimId).toBe(claim.claimId);

    const reopened = projectFactMappingManualDecision({
      artifactHash: base.artifactHash,
      artifacts,
      bundles: mapped.statements,
      candidates,
      createdAt: '2026-07-31T03:03:02.000Z',
      decision: {
        draftId: 'draft-1',
        expectedRevision: 2,
        kind: 'REOPEN',
        reason: '重新审查分类和映射。',
        statementId: mapped.statements[0]?.result.statement.statementId ?? '',
      },
      idSeed: 'reopen',
      warningBoundaryEscapes: [],
    });
    expect(reopened.rollup.status).toBe('AWAITING_REVIEW');

    const undone = projectFactMappingManualDecision({
      artifactHash: base.artifactHash,
      artifacts,
      bundles: reopened.statements,
      candidates,
      createdAt: '2026-07-31T03:03:03.000Z',
      decision: {
        draftId: 'draft-1',
        expectedRevision: 3,
        kind: 'UNDO',
        reason: '回到已核验版本。',
        statementId: reopened.statements[0]?.result.statement.statementId ?? '',
        targetVersionId: 'synthetic-pass-version',
      },
      idSeed: 'undo',
      replacementBundles: initial,
      warningBoundaryEscapes: [],
    });
    expect(undone.rollup.status).toBe('PASS');
    expect(undone.statements[0]?.result.statement.statementId).not.toBe(
      initial[0]?.result.statement.statementId,
    );
  });
});
