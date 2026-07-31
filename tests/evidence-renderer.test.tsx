// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ResearchPage } from '../apps/web-ui/src/research-page.js';
import type {
  DesktopBridge,
  EvidenceConflictActionPreview,
  EvidenceStateView,
  SourceProcessingPreview,
  SyntheticResearchIntakePreview,
  SyntheticResearchIntakeResult,
} from '../packages/shared/src/index.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteDesktop');
});

const state: EvidenceStateView = {
  claims: [
    {
      claimId: 'claim-ui',
      evaluationStatus: 'FACT_BLOCKED',
      evidence: [
        {
          evidenceId: 'evidence-ui',
          excerpt: '<img src=x onerror=alert(1)> Official publication date: 2026-07-29.',
          language: 'en-US',
          relation: 'SUPPORTS',
          sourceId: 'source-ui',
          sourceRevision: 1,
          summaryZh: '官方页面写明出版日期；此摘要不是证据。',
        },
      ],
      predicate: 'publication_date',
      subjectId: 'work-ui',
      subjectType: 'WORK',
      value: { precision: 'DAY', value: '2026-07-29' },
    },
  ],
  conflicts: [
    {
      claimLeftId: 'claim-ui',
      claimRightId: 'claim-ui-other',
      conflictId: 'conflict-ui',
      revision: 1,
      state: 'FACT_BLOCKED',
    },
  ],
  counts: { claims: 1, conflicts: 1, evaluations: 1, evidence: 1, sources: 1 },
  inbox: [
    {
      factStatus: 'NOT_A_FACT',
      originKind: 'BROWSER_CLIP',
      originRecordId: 'clip-ui',
      suggestedUse: 'CONTEXT_ONLY',
      title: '待分类讨论片段',
      truthStatus: 'UNVERIFIED',
    },
  ],
  processingRuns: [
    {
      costState: 'NOT_INCURRED',
      currentStep: 'RECONCILE',
      externalRequestCount: 0,
      revision: 2,
      runId: 'run-ui',
      status: 'PAUSED',
    },
    {
      costState: 'NOT_INCURRED',
      currentStep: null,
      externalRequestCount: 0,
      revision: 1,
      runId: 'run-budget',
      status: 'BUDGET_BLOCKED',
    },
  ],
  sources: [
    {
      authorityTier: 'OFFICIAL_PRIMARY',
      availability: 'AVAILABLE',
      independenceState: 'CONFIRMED_INDEPENDENT',
      language: 'en-US',
      lineageGroup: 'official-ui',
      originKind: 'SYNTHETIC_FIXTURE',
      revision: 1,
      sourceId: 'source-ui',
      title: '<script>source title</script>',
      useClass: 'KEY_FACT_ELIGIBLE',
    },
  ],
};

const conflictPreview: EvidenceConflictActionPreview = {
  acceptedClaimId: 'claim-ui',
  action: 'ACCEPT_CLAIM',
  affected: {
    claimIds: ['claim-ui', 'claim-ui-other'],
    evidenceIds: ['evidence-ui'],
    sourceRevisionIds: ['source-ui:1'],
    subjects: [{ subjectId: 'work-ui', subjectType: 'WORK' }],
  },
  afterEvaluations: [
    { claimId: 'claim-ui', status: 'VERIFIED' },
    { claimId: 'claim-ui-other', status: 'REJECTED' },
  ],
  beforeEvaluations: [
    { claimId: 'claim-ui', status: 'FACT_BLOCKED' },
    { claimId: 'claim-ui-other', status: 'FACT_BLOCKED' },
  ],
  claimLeftId: 'claim-ui',
  claimRightId: 'claim-ui-other',
  conflictId: 'conflict-ui',
  expiresAt: '2026-07-29T02:05:00.000Z',
  previewHash: 'a'.repeat(64),
  revision: 1,
  state: 'FACT_BLOCKED',
  token: 'token-conflict',
};

const modelPreview: SourceProcessingPreview = {
  estimatedExternalRequests: 2,
  estimatedFee: 'UNKNOWN',
  estimatedLocalWrites: 4,
  expiresAt: '2026-07-29T02:05:00.000Z',
  planHash: 'b'.repeat(64),
  previewHash: 'c'.repeat(64),
  readiness: 'MODEL_UNCONFIGURED',
  runId: 'run-preview',
  sourceRevisionIds: ['source-ui:1'],
  steps: ['CLASSIFY', 'EXTRACT_CLAIMS', 'SUMMARIZE', 'RECONCILE'],
  token: 'token-processing',
};

const syntheticPreview: SyntheticResearchIntakePreview = {
  claimLocators: [
    {
      endCodePoint: 19,
      excerpt: '雾港七号钟楼（合成作品）',
      predicate: 'canonical_title',
      startCodePoint: 6,
    },
    {
      endCodePoint: 30,
      excerpt: '虚构作者甲',
      predicate: 'author',
      startCodePoint: 25,
    },
    {
      endCodePoint: 47,
      excerpt: '2099-04-17',
      predicate: 'publication_date',
      startCodePoint: 37,
    },
  ],
  estimatedExternalRequests: 0,
  estimatedLocalWrites: 24,
  estimatedModelRequests: 0,
  expiresAt: '2026-07-31T04:05:00.000Z',
  feeState: 'NOT_INCURRED',
  inputHash: 'd'.repeat(64),
  labels: ['MANUAL_INPUT', 'SYNTHETIC_ONLY', 'LOCAL_PERSISTED', 'MODEL_UNUSED'],
  previewHash: 'e'.repeat(64),
  token: 'synthetic-preview-token',
};

const syntheticResult: SyntheticResearchIntakeResult = {
  claims: syntheticPreview.claimLocators.map(({ predicate }, index) => ({
    claimId: `synthetic-claim-${index + 1}`,
    evaluationId: `synthetic-evaluation-${index + 1}`,
    predicate,
    status: 'VERIFIED',
  })),
  externalRequestCount: 0,
  feeState: 'NOT_INCURRED',
  labels: syntheticPreview.labels,
  modelRequestCount: 0,
  sourceRevisionId: 'synthetic-source:1',
  workId: 'synthetic-work',
};

describe('Issue 019 Research renderer', () => {
  it('shows source, exact excerpt, non-evidence summary, stale/budget/conflict states as text', async () => {
    const cancel = vi.fn().mockResolvedValue({ ok: true, value: state });
    const bridge = {
      cancelSourceProcessing: cancel,
      getEvidenceState: vi.fn().mockResolvedValue({ ok: true, value: state }),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    const { container } = render(<ResearchPage />);

    expect(await screen.findByText('<script>source title</script>')).toBeInTheDocument();
    expect(screen.getByText(/Official publication date/u)).toBeInTheDocument();
    expect(screen.getByText('官方页面写明出版日期；此摘要不是证据。')).toBeInTheDocument();
    expect(screen.getAllByText('FACT_BLOCKED').length).toBeGreaterThan(0);
    expect(screen.getByText('BUDGET_BLOCKED')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(document.body.textContent).not.toMatch(/[A-Z]:\\|SELECT .* FROM|sk-[A-Za-z0-9]/iu);

    await userEvent.click(screen.getByRole('button', { name: '取消处理' }));
    await waitFor(() => {
      expect(cancel).toHaveBeenCalledWith({
        confirmation: 'CANCEL_SOURCE_PROCESSING',
        expectedRevision: 2,
        runId: 'run-ui',
      });
    });
  });

  it('requires preview, a reason, and explicit confirmation for a conflict decision', async () => {
    const preview = vi.fn().mockResolvedValue({ ok: true, value: conflictPreview });
    const confirm = vi.fn().mockResolvedValue({
      ok: true,
      value: { ...state.conflicts[0], revision: 2, state: 'RESOLVED_ACCEPT' },
    });
    const bridge = {
      confirmEvidenceConflict: confirm,
      getEvidenceState: vi.fn().mockResolvedValue({ ok: true, value: state }),
      previewEvidenceConflict: preview,
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    render(<ResearchPage />);
    await screen.findByText('<script>source title</script>');

    await userEvent.click(screen.getByRole('button', { name: '接受左侧事实' }));
    expect(preview).toHaveBeenCalledWith({
      acceptedClaimId: 'claim-ui',
      action: 'ACCEPT_CLAIM',
      conflictId: 'conflict-ui',
    });
    const confirmButton = await screen.findByRole('button', { name: '确认并写入审计链' });
    expect(confirmButton).toBeDisabled();
    await userEvent.type(screen.getByLabelText('决定理由'), '采用官方不可变版本。');
    await userEvent.click(confirmButton);
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  });

  it('shows model-unconfigured truthfully and keeps confirmation disabled', async () => {
    const preview = vi.fn().mockResolvedValue({ ok: true, value: modelPreview });
    const confirm = vi.fn();
    const bridge = {
      confirmSourceProcessing: confirm,
      getEvidenceState: vi.fn().mockResolvedValue({ ok: true, value: state }),
      previewSourceProcessing: preview,
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    render(<ResearchPage />);
    await screen.findByText('<script>source title</script>');

    await userEvent.click(screen.getByLabelText(/<script>source title<\/script>/u));
    await userEvent.click(screen.getByLabelText(/可选结构化提取/u));
    await userEvent.click(screen.getByRole('button', { name: '预览处理计划' }));
    expect(await screen.findByText('MODEL_UNCONFIGURED')).toBeInTheDocument();
    expect(screen.getByText(/不会降级、猜测或发送请求/u)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '明确确认本地执行' })).toBeDisabled();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('keeps synthetic intake blank, labeled, previewed, and separately confirmed', async () => {
    const preview = vi.fn().mockResolvedValue({ ok: true, value: syntheticPreview });
    const confirm = vi.fn().mockResolvedValue({ ok: true, value: syntheticResult });
    const bridge = {
      confirmSyntheticResearchIntake: confirm,
      getEvidenceState: vi.fn().mockResolvedValue({ ok: true, value: state }),
      previewSyntheticResearchIntake: preview,
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    render(<ResearchPage />);
    await screen.findByText('<script>source title</script>');

    expect(screen.getByLabelText('虚构作品名')).toHaveValue('');
    expect(screen.getByText('手工输入')).toBeInTheDocument();
    expect(screen.getByText('完全合成')).toBeInTheDocument();
    expect(screen.getByText('本地持久化')).toBeInTheDocument();
    expect(screen.getByText('模型未使用')).toBeInTheDocument();
    expect(screen.getByText('外部请求 0')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('虚构作品名'), '雾港七号钟楼（合成作品）');
    await userEvent.type(screen.getByLabelText('虚构作者名'), '虚构作者甲');
    await userEvent.type(screen.getByLabelText('虚构出版日期'), '2099-04-17');
    await userEvent.type(screen.getByLabelText('合成来源标题'), '本地合成作品资料卡');
    await userEvent.type(
      screen.getByLabelText(/短原文/u),
      '作品名：雾港七号钟楼（合成作品）{enter}作者：虚构作者甲{enter}出版日期：2099-04-17',
    );
    await userEvent.click(screen.getByRole('button', { name: '预览 3 条手工事实' }));

    await waitFor(() =>
      expect(preview).toHaveBeenCalledWith({
        draft: {
          authorName: '虚构作者甲',
          publicationDate: '2099-04-17',
          sourceText: '作品名：雾港七号钟楼（合成作品）\n作者：虚构作者甲\n出版日期：2099-04-17',
          sourceTitle: '本地合成作品资料卡',
          workTitle: '雾港七号钟楼（合成作品）',
        },
      }),
    );
    expect(await screen.findByText(/canonical_title \/ author \/ publication_date/u)).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: '确认创建上游研究记录' }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({
        confirmation: 'CREATE_SYNTHETIC_LOCAL_RESEARCH',
        inputHash: syntheticPreview.inputHash,
        previewHash: syntheticPreview.previewHash,
        token: syntheticPreview.token,
      }),
    );
    expect(await screen.findByText(/workId: synthetic-work/u)).toBeVisible();
    expect(
      screen.getByText(/canonical_title=VERIFIED · author=VERIFIED · publication_date=VERIFIED/u),
    ).toBeVisible();
  });
});
