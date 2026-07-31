// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FactMappingWorkbench } from '../apps/web-ui/src/fact-mapping-workbench.js';
import {
  FACT_MAPPING_CHECKER_VERSION,
  FACT_MAPPING_CLASSIFICATION_VERSION,
  FACT_MAPPING_CONTRACT_VERSION,
  FACT_MAPPING_SEGMENTATION_VERSION,
  TYPED_FACT_COMPATIBILITY_VERSION,
  factMappingHash,
} from '../packages/quality/src/index.js';
import type {
  DesktopBridge,
  FactMappingClaimChainView,
  FactMappingDetailView,
  FactMappingListView,
} from '../packages/shared/src/index.js';
import { requiredFixtureValue } from './support/copy-fixtures.js';

const HASH = 'a'.repeat(64);

function rollup() {
  return {
    counts: {
      BLOCKING_KEY_FACT: 0,
      CONFLICTED: 0,
      NEEDS_REVIEW: 0,
      NOT_APPLICABLE: 1,
      SATISFIED: 1,
      STALE: 0,
      UNMAPPED_SUPPORTING_FACT: 0,
    },
    reasonCodes: [],
    status: 'PASS' as const,
    warningBoundaryEscapeCount: 0,
  };
}

function detail(): FactMappingDetailView {
  return {
    artifacts: [
      {
        artifactId: 'block-1',
        artifactKind: 'BODY_BLOCK',
        codePointLength: 12,
        coveredStatementCount: 2,
        textHash: HASH,
      },
    ],
    briefVersionId: 'brief-version-1',
    candidates: [
      {
        claimId: 'claim-1',
        current: true,
        evaluationStatus: 'VERIFIED',
        evidenceCount: 2,
        factPolicyReasonCode: 'OFFICIAL_PRIMARY_VERIFIED',
        factPolicySatisfied: true,
        predicate: 'publication_date',
        subjectId: 'work-1',
        subjectType: 'WORK',
        valueSummary: '2024',
        valueType: 'DATE_WITH_PRECISION',
      },
    ],
    checkVersion: {
      checkerVersion: FACT_MAPPING_CHECKER_VERSION,
      createdAt: '2026-07-31T03:30:00.000Z',
      decisionRevision: 2,
      dependencyHash: HASH,
      draftId: 'draft-renderer',
      draftVersionId: 'draft-version-renderer',
      inputHash: HASH,
      rollup: rollup(),
      runId: 'run-1',
      versionId: 'check-version-2',
      versionNumber: 2,
    },
    draftId: 'draft-renderer',
    draftRevision: 2,
    draftVersionId: 'draft-version-renderer',
    history: [
      {
        createdAt: '2026-07-31T03:30:00.000Z',
        current: true,
        dependencyHash: HASH,
        inputHash: HASH,
        reasonCodes: [],
        status: 'PASS',
        versionId: 'check-version-2',
        versionNumber: 2,
      },
      {
        createdAt: '2026-07-31T03:29:00.000Z',
        current: false,
        dependencyHash: 'b'.repeat(64),
        inputHash: 'b'.repeat(64),
        reasonCodes: ['NO_CLAIM'],
        status: 'FACT_BLOCKED',
        versionId: 'check-version-1',
        versionNumber: 1,
      },
    ],
    invalidationReasons: [],
    profileId: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
    rollup: rollup(),
    runs: [
      {
        createdAt: '2026-07-31T03:30:00.000Z',
        draftId: 'draft-renderer',
        executionId: 'execution-1',
        externalRequestCount: 0,
        finishedAt: '2026-07-31T03:30:01.000Z',
        modelExecutionId: null,
        mode: 'LOCAL_MANUAL',
        planId: 'plan-1',
        reasonCode: null,
        revision: 2,
        runId: 'run-1',
        status: 'PASS',
      },
    ],
    statements: [
      {
        artifactId: 'block-1',
        artifactKind: 'BODY_BLOCK',
        claimId: 'claim-1',
        compatibilityReasonCode: 'COMPATIBLE',
        disposition: 'SATISFIED',
        domain: 'DATE_TIME',
        endCodePoint: 10,
        factPolicyReasonCode: 'OFFICIAL_PRIMARY_VERIFIED',
        fragment: '本书于2024年出版。',
        kind: 'FACT',
        materiality: 'KEY_FACT',
        protectedSignals: ['DATE'],
        relation: 'EXACT',
        startCodePoint: 0,
        statementId: 'statement-1',
        statementOrder: 0,
      },
      {
        artifactId: 'block-1',
        artifactKind: 'BODY_BLOCK',
        claimId: null,
        compatibilityReasonCode: null,
        disposition: 'NOT_APPLICABLE',
        domain: 'NOT_APPLICABLE',
        endCodePoint: 12,
        factPolicyReasonCode: null,
        fragment: '我觉得值得推荐。',
        kind: 'OPINION',
        materiality: 'NOT_APPLICABLE',
        protectedSignals: [],
        relation: null,
        startCodePoint: 10,
        statementId: 'statement-2',
        statementOrder: 1,
      },
    ],
    status: 'PASS',
    structuralStatus: 'READY_FOR_QUALITY_PIPELINE',
    versionNumber: 2,
    workIds: ['work-1'],
  };
}

function list(current: FactMappingDetailView): FactMappingListView {
  return {
    items: [
      {
        briefVersionId: current.briefVersionId,
        draftId: current.draftId,
        draftRevision: current.draftRevision,
        draftVersionId: current.draftVersionId,
        profileId: current.profileId,
        status: current.status,
        structuralStatus: current.structuralStatus,
        versionNumber: current.versionNumber,
        workIds: current.workIds,
      },
    ],
    limit: 12,
    offset: 0,
    total: 1,
  };
}

function chain(): FactMappingClaimChainView {
  return {
    claim: {
      claimId: 'claim-1',
      current: true,
      predicate: 'publication_date',
      revision: 1,
      scopeSummary: 'language=zh-CN',
      subjectId: 'work-1',
      subjectType: 'WORK',
      valueSummary: '2024',
      valueType: 'DATE_WITH_PRECISION',
    },
    conflicts: [{ conflictId: 'conflict-1', state: 'RESOLVED' }],
    evaluation: {
      createdAt: '2026-07-31T03:29:00.000Z',
      evaluationId: 'evaluation-1',
      policyVersion: 'fact-policy-v1',
      reasonCode: 'OFFICIAL_PRIMARY_VERIFIED',
      status: 'VERIFIED',
    },
    evidence: [
      {
        excerpt: '合成官方资料：本书于2024年出版。',
        relation: 'SUPPORTS',
        revision: 1,
        source: {
          authorityTier: 'OFFICIAL_PRIMARY',
          availability: 'AVAILABLE',
          contentHashSummary: 'a1b2c3',
          current: true,
          displayHost: 'fixture.invalid',
          independence: 'CONFIRMED_INDEPENDENT',
          language: 'zh-CN',
          lineageGroup: 'official',
          publisherOrSite: '合成出版社',
          revisionId: 'source-1:1',
          title: '合成官方资料',
          useClass: 'KEY_FACT_ELIGIBLE',
        },
        summaryZh: '非证据摘要',
        summaryZhIsEvidence: false,
      },
      {
        excerpt: '另一条资料限定到平装版。',
        relation: 'QUALIFIES',
        revision: 1,
        source: {
          authorityTier: 'INDEPENDENT_SECONDARY',
          availability: 'AVAILABLE',
          contentHashSummary: 'd4e5f6',
          current: true,
          displayHost: 'secondary.invalid',
          independence: 'CONFIRMED_INDEPENDENT',
          language: 'zh-CN',
          lineageGroup: 'secondary',
          publisherOrSite: '合成媒体',
          revisionId: 'source-2:1',
          title: '合成补充资料',
          useClass: 'KEY_FACT_ELIGIBLE',
        },
        summaryZh: null,
        summaryZhIsEvidence: false,
      },
    ],
    statementId: 'statement-1',
  };
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    value: undefined,
  });
});

describe('M3 Issue 026 factual mapping workbench renderer', () => {
  it('renders empty local-first boundaries without downstream actions', async () => {
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getFactMappingChecks: vi.fn(async () => ({
          ok: true,
          value: { items: [], limit: 12, offset: 0, total: 0 },
        })),
      } as unknown as DesktopBridge,
    });
    render(<FactMappingWorkbench />);
    expect(await screen.findByRole('heading', { name: '事实映射工作台' })).toBeInTheDocument();
    expect(screen.getByText(/事实映射通过只代表本项检查通过/u)).toBeInTheDocument();
    expect(screen.getByText(/系统不会自动补写或搜索/u)).toBeInTheDocument();
    expect(screen.getByText(/中文摘要不是证据/u)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /审批|导出|发布|图片|强制通过/u }),
    ).not.toBeInTheDocument();
  });

  it('shows Statement mapping, evidence chain, history and manual decision preview', async () => {
    const current = detail();
    const getChain = vi.fn(async () => ({ ok: true as const, value: chain() }));
    const previewDecision = vi.fn(async () => ({
      ok: true as const,
      value: {
        expiresAt: '2026-07-31T03:35:00.000Z',
        preview: {
          after: {
            claimId: 'claim-1',
            disposition: 'SATISFIED',
            domain: 'DATE_TIME',
            kind: 'FACT',
            materiality: 'KEY_FACT',
            relation: 'EXACT',
          },
          before: {
            claimId: 'claim-1',
            disposition: 'SATISFIED',
            domain: 'DATE_TIME',
            kind: 'FACT',
            materiality: 'KEY_FACT',
            relation: 'EXACT',
          },
          draftId: current.draftId,
          draftVersionId: current.draftVersionId,
          expectedRevision: 2,
          expectedStatus: 'PASS',
          kind: 'CONFIRM_CLASSIFICATION',
          statementId: 'statement-1',
        },
        previewHash: HASH,
        token: 'a'.repeat(43),
      },
    }));
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getFactMappingCheck: vi.fn(async () => ({ ok: true, value: current })),
        getFactMappingChecks: vi.fn(async () => ({
          ok: true,
          value: list(current),
        })),
        getFactMappingClaimChain: getChain,
        previewFactMappingDecision: previewDecision,
      } as unknown as DesktopBridge,
    });
    render(<FactMappingWorkbench />);
    expect(await screen.findByText('本书于2024年出版。')).toBeInTheDocument();
    expect(screen.getByText('Protected signals：DATE')).toBeInTheDocument();
    expect(screen.getByText('OFFICIAL_PRIMARY_VERIFIED')).toBeInTheDocument();
    expect(screen.getByText('不可变版本、input diff 与失效原因')).toBeInTheDocument();
    expect(screen.getByText(/v2 · PASS · current/u)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '展开证据链' }));
    expect(
      await screen.findByRole('heading', {
        name: 'Claim → FactEvaluation → Evidence → SourceRevision',
      }),
    ).toBeInTheDocument();
    expect(screen.getByText(/SUPPORTS/u)).toBeInTheDocument();
    expect(screen.getByText(/QUALIFIES/u)).toBeInTheDocument();
    expect(screen.getByText('非证据中文摘要：非证据摘要')).toBeInTheDocument();
    expect(getChain).toHaveBeenCalledWith({ statementId: 'statement-1' });

    fireEvent.click(
      requiredFixtureValue(
        screen.getAllByRole('button', { name: '确认分类' }).at(0),
        'classification confirmation button',
      ),
    );
    expect(await screen.findByRole('heading', { name: '人工 decision 预览' })).toBeInTheDocument();
    expect(screen.getByText(/token 单次、短期并绑定当前窗口/u)).toBeInTheDocument();
    expect(previewDecision).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedRevision: 2,
        kind: 'CONFIRM_CLASSIFICATION',
        statementId: 'statement-1',
      }),
    );
  });

  it('previews local/model readiness and disables blocked model confirmation', async () => {
    const current = detail();
    const planBase = {
      artifactCount: 1,
      briefVersionId: current.briefVersionId,
      budgetState: 'AVAILABLE' as const,
      cacheState: 'MISS' as const,
      candidateClaimCount: 1,
      candidateEvidenceCount: 2,
      candidateSourceRevisionCount: 2,
      capabilityState: 'UNKNOWN' as const,
      checkerVersion: FACT_MAPPING_CHECKER_VERSION,
      classificationVersion: FACT_MAPPING_CLASSIFICATION_VERSION,
      createdAt: '2026-07-31T03:30:00.000Z',
      credentialState: 'MISSING' as const,
      dependencyHash: HASH,
      draftId: current.draftId,
      draftRevision: current.draftRevision,
      draftVersionId: current.draftVersionId,
      estimatedLocalWrites: 20,
      expiresAt: '2026-07-31T03:35:00.000Z',
      inputCodePointCount: 12,
      inputHash: HASH,
      mappingPolicyVersion: FACT_MAPPING_CONTRACT_VERSION,
      maximumModelRequests: 1 as const,
      mode: 'MODEL_ASSISTED' as const,
      planId: 'plan-renderer',
      profileId: current.profileId,
      protectedSignalCount: 1,
      segmentationVersion: FACT_MAPPING_SEGMENTATION_VERSION,
      statementCount: 2,
      typedCompatibilityVersion: TYPED_FACT_COMPATIBILITY_VERSION,
      workIds: current.workIds,
    };
    const previewAction = vi.fn(async () => ({
      ok: true as const,
      value: {
        expiresAt: '2026-07-31T03:35:00.000Z',
        kind: 'START' as const,
        preview: {
          kind: 'START' as const,
          plan: {
            ...planBase,
            previewHash: factMappingHash(planBase),
          },
          writes: ['FACT_MAPPING 专属表'],
        },
        previewHash: HASH,
        token: 'a'.repeat(43),
      },
    }));
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getFactMappingCheck: vi.fn(async () => ({ ok: true, value: current })),
        getFactMappingChecks: vi.fn(async () => ({
          ok: true,
          value: list(current),
        })),
        previewFactMappingAction: previewAction,
      } as unknown as DesktopBridge,
    });
    render(<FactMappingWorkbench />);
    await screen.findByText('本书于2024年出版。');
    fireEvent.change(screen.getByLabelText('检查模式'), {
      target: { value: 'MODEL_ASSISTED' },
    });
    fireEvent.click(screen.getByRole('button', { name: '预览事实检查' }));
    expect(await screen.findByRole('heading', { name: '检查计划预览' })).toBeInTheDocument();
    expect(screen.getByText(/最大模型请求 1/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '模型能力 / 预算 / 凭据未就绪' })).toBeDisabled();
    await waitFor(() =>
      expect(previewAction).toHaveBeenCalledWith({
        draftId: current.draftId,
        kind: 'START',
        mode: 'MODEL_ASSISTED',
      }),
    );
  });
});
