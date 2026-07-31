import { describe, expect, it } from 'vitest';

import {
  buildDeterministicFactMapping,
  buildWarningBoundaryEscapes,
  FACT_MAPPING_QUALITY_SUMMARY,
} from '../packages/quality/src/index.js';
import { completeCopyPayload } from './support/copy-fixtures.js';
import {
  FACT_MAPPING_NOW,
  candidateRecord,
  candidateSet,
  materializedArtifact,
  syntheticTrace,
  textClaim,
} from './support/fact-mapping-fixtures.js';

describe('M3 Issue 026 synthetic factual-mapping gold cases', () => {
  it('passes a non-spoiler single-book verdict with two verified facts and two opinions', () => {
    const title = textClaim('claim-title', 'canonical_title', '合成作品');
    const award = textClaim('claim-award', 'award_win', '合成大奖');
    const result = buildDeterministicFactMapping({
      artifacts: [
        materializedArtifact('《合成作品》', {
          artifactId: 'selected-title',
          artifactKind: 'SELECTED_TITLE',
        }),
        materializedArtifact('《合成作品》获得合成大奖。', {
          artifactId: 'award-block',
        }),
        materializedArtifact('我觉得这本书值得推荐。', {
          artifactId: 'opinion-1',
        }),
        materializedArtifact('我认为它的节奏很精彩。', {
          artifactId: 'opinion-2',
        }),
      ],
      candidates: candidateSet([candidateRecord(title), candidateRecord(award)]),
      createdAt: FACT_MAPPING_NOW,
    });
    expect(result.rollup).toMatchObject({
      counts: {
        NOT_APPLICABLE: 2,
        SATISFIED: 2,
      },
      status: 'PASS',
    });
    expect(
      result.statements.filter(
        ({ result: item }) => item.statement.classification.materiality === 'KEY_FACT',
      ),
    ).toHaveLength(2);
    expect(FACT_MAPPING_QUALITY_SUMMARY.passDoesNotAdvanceOverallQuality).toBe(true);
  });

  it('passes full-analysis plot facts while keeping analysis and a pure warning non-factual', () => {
    const plot = textClaim('claim-plot', 'structure_type', '倒叙');
    const payload = completeCopyPayload('FULL_TRICK_LOGIC_ANALYSIS');
    const result = buildDeterministicFactMapping({
      artifacts: [
        materializedArtifact('本书结构为倒叙。', {
          artifactId: 'plot-fact',
        }),
        materializedArtifact('叙事意味着读者会重新理解伏笔。', {
          artifactId: 'analysis-1',
        }),
        materializedArtifact('这个视角显示出线索组织的层次。', {
          artifactId: 'analysis-2',
        }),
        materializedArtifact('完整诡计分析', {
          artifactId: 'warning-label',
        }),
      ],
      candidates: candidateSet([candidateRecord(plot)]),
      createdAt: FACT_MAPPING_NOW,
      warningBoundaryEscapes: buildWarningBoundaryEscapes(payload),
    });
    expect(result.statements.map(({ result: item }) => item.statement.classification.kind)).toEqual(
      ['FACT', 'ANALYTICAL_JUDGMENT', 'ANALYTICAL_JUDGMENT', 'LABEL_OR_WARNING'],
    );
    expect(result.rollup.status).toBe('PASS');
    expect(result.rollup.warningBoundaryEscapeCount).toBe(0);
  });

  it('keeps cross-work candidate scopes separate and surfaces subject mismatch as blocked', () => {
    const work1 = textClaim('claim-work-1-title', 'canonical_title', '作品甲', 'TEXT', 'work-1');
    const work2 = textClaim('claim-work-2-title', 'canonical_title', '作品乙', 'TEXT', 'work-2');
    const candidates = candidateSet([candidateRecord(work1), candidateRecord(work2)], {
      workIds: ['work-1', 'work-2'],
    });
    const pass = buildDeterministicFactMapping({
      artifacts: [
        materializedArtifact('《作品甲》', {
          artifactId: 'work-1',
          workIds: ['work-1'],
        }),
        materializedArtifact('《作品乙》', {
          artifactId: 'work-2',
          workIds: ['work-2'],
        }),
      ],
      candidates,
      createdAt: FACT_MAPPING_NOW,
    });
    expect(pass.rollup.status).toBe('PASS');
    expect(pass.statements.map(({ result }) => result.mapping?.claimId)).toEqual([
      'claim-work-1-title',
      'claim-work-2-title',
    ]);

    const mismatch = buildDeterministicFactMapping({
      artifacts: [
        materializedArtifact('《作品乙》', {
          artifactId: 'borrowed-work',
          workIds: ['work-1'],
        }),
      ],
      candidates,
      createdAt: FACT_MAPPING_NOW,
    });
    expect(mismatch.rollup.status).toBe('FACT_BLOCKED');
    expect(mismatch.statements[0]?.result.mapping).toBeNull();
  });

  it('blocks a key fact with NO_CLAIM and creates no research or source record', () => {
    const result = buildDeterministicFactMapping({
      artifacts: [materializedArtifact('本书于2024年出版。')],
      candidates: candidateSet([], { workIds: [] }),
      createdAt: FACT_MAPPING_NOW,
    });
    expect(result.rollup).toMatchObject({
      counts: { BLOCKING_KEY_FACT: 1 },
      reasonCodes: ['NO_CLAIM'],
      status: 'FACT_BLOCKED',
    });
  });

  it('blocks a material conflict and retains supporting and contradicting traces', () => {
    const claim = textClaim('claim-conflict', 'award_win', '合成大奖');
    const record = candidateRecord(claim, {
      evaluationStatus: 'CONFLICTED',
      evidence: [
        syntheticTrace(claim, { relation: 'SUPPORTS', sourceId: 'supports' }),
        syntheticTrace(claim, {
          relation: 'CONTRADICTS',
          sourceId: 'contradicts',
        }),
        syntheticTrace(claim, {
          relation: 'QUALIFIES',
          sourceId: 'qualifies',
        }),
      ],
    });
    const candidates = candidateSet([record]);
    const result = buildDeterministicFactMapping({
      artifacts: [materializedArtifact('本书获得合成大奖。')],
      candidates,
      createdAt: FACT_MAPPING_NOW,
    });
    expect(result.rollup.status).toBe('FACT_BLOCKED');
    expect(result.rollup.counts.CONFLICTED).toBe(1);
    expect(candidates.candidates[0]?.evidence.map(({ evidence }) => evidence.relation)).toEqual([
      'CONTRADICTS',
      'QUALIFIES',
      'SUPPORTS',
    ]);
  });

  it('keeps an unresolved supporting fact in AWAITING_REVIEW rather than PASS', () => {
    const result = buildDeterministicFactMapping({
      artifacts: [materializedArtifact('本书发表于网络平台。')],
      candidates: candidateSet([], { workIds: [] }),
      createdAt: FACT_MAPPING_NOW,
    });
    expect(result.rollup).toMatchObject({
      counts: { UNMAPPED_SUPPORTING_FACT: 1 },
      status: 'AWAITING_REVIEW',
    });
  });
});
