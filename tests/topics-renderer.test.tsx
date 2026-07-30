// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TopicPoolPage } from '../apps/web-ui/src/topic-pool-page.js';
import type {
  DesktopBridge,
  TopicActionPreview,
  TopicDetailView,
  TopicPoolWorkspaceView,
  TopicQuotaPlanView,
} from '../packages/shared/src/index.js';

const CONTENT_TYPES = [
  'NON_SPOILER_SINGLE_BOOK_VERDICT',
  'FULL_TRICK_LOGIC_ANALYSIS',
  'CROSS_WORK_COMPARISON',
  'WEB_VS_PUBLISHED_MYSTERY',
  'MYSTERY_AND_CULTURAL_PHENOMENON',
] as const;

const quotas = [10, 8, 6, 3, 3] as const;
const now = '2026-07-30T10:00:00.000Z';

const detail: TopicDetailView = {
  analysisMode: 'PUBLIC_RESEARCH',
  candidateJudgment: '待验证的合成判断',
  candidateState: 'PROPOSED',
  centralQuestion: '<script>只作为文本显示</script>',
  comparisonDimension: null,
  contentType: 'FULL_TRICK_LOGIC_ANALYSIS',
  eligibility: 'ELIGIBLE',
  eligibilityReasonCodes: ['ELIGIBILITY_READY'],
  fingerprint: 'a'.repeat(64),
  history: [],
  ranking: [
    {
      knowledgeState: 'KNOWN',
      reasonCodes: ['EVIDENCE_COVERAGE_HIGH'],
      type: 'EVIDENCE_SUFFICIENCY',
      valueBasisPoints: 9000,
    },
    {
      knowledgeState: 'KNOWN',
      reasonCodes: ['CONTENT_TYPE_FIT'],
      type: 'CONTENT_FIT',
      valueBasisPoints: 8500,
    },
    {
      knowledgeState: 'KNOWN',
      reasonCodes: ['SEMANTICALLY_DISTINCT'],
      type: 'DIFFERENTIATION',
      valueBasisPoints: 8000,
    },
    {
      knowledgeState: 'UNKNOWN',
      reasonCodes: ['COST_UNKNOWN'],
      type: 'ESTIMATED_COST',
      valueBasisPoints: null,
    },
    {
      knowledgeState: 'KNOWN',
      reasonCodes: ['WORKLOAD_VERSIONED_UNITS'],
      type: 'APPROVAL_WORKLOAD',
      valueBasisPoints: 5000,
    },
  ],
  rankingComplete: false,
  requiredPublicLabels: ['公开资料整理', '资料分析评分'],
  revision: 1,
  spoilerLevel: 'FULL_TRICK_ANALYSIS',
  spoilerPolicy: {
    userConfirmationRequired: true,
    warningPlacement: 'COVER_TITLE_AND_BODY_OPENING',
    warningRequired: true,
  },
  stale: false,
  subjects: [
    {
      expressionForm: 'PUBLISHED_EDITION',
      role: 'PRIMARY',
      subjectId: 'work-topic-ui',
      subjectType: 'WORK',
      workId: 'work-topic-ui',
    },
  ],
  topicAngle: '合成完整诡计选题',
  topicId: 'topic-ui',
  totalScoreBasisPoints: 7600,
  versionNumber: 1,
};

function categories(shortfall = true): TopicQuotaPlanView['categories'] {
  return CONTENT_TYPES.map((contentType, index) => {
    const required = quotas[index];
    if (required === undefined) throw new Error('Missing synthetic quota.');
    return {
      archivedCount: index === 0 ? 1 : 0,
      conflicts: [],
      contentType,
      heldCount: index === 0 ? 1 : 0,
      lockedEligibleCount: index === 0 ? 1 : 0,
      required,
      selected: shortfall ? (index === 0 ? 1 : 0) : required,
      shortfall: shortfall ? required - (index === 0 ? 1 : 0) : 0,
    };
  });
}

function plan(
  status: TopicQuotaPlanView['status'],
  versionNumber: number,
  shortfall = true,
): TopicQuotaPlanView {
  return {
    categories: categories(shortfall),
    createdAt: now,
    members: [],
    planVersionId: `topic-plan-ui-${versionNumber}`,
    poolSnapshotHash: String(versionNumber).repeat(64),
    status,
    totalRequired: 30,
    totalSelected: shortfall ? 1 : 30,
    versionNumber,
  };
}

function workspace(overrides: Partial<TopicPoolWorkspaceView> = {}): TopicPoolWorkspaceView {
  return {
    counts: {
      CROSS_WORK_COMPARISON: 0,
      FULL_TRICK_LOGIC_ANALYSIS: 1,
      MYSTERY_AND_CULTURAL_PHENOMENON: 0,
      NON_SPOILER_SINGLE_BOOK_VERDICT: 0,
      WEB_VS_PUBLISHED_MYSTERY: 0,
    },
    currentPlan: plan('INCOMPLETE', 2),
    items: [detail],
    limit: 25,
    offset: 0,
    planHistory: [plan('INCOMPLETE', 2), plan('STALE', 1)],
    profileId: 'primary',
    recentGenerationRuns: [
      {
        createdAt: now,
        externalRequestCount: 0,
        resultCandidateCount: 1,
        revision: 3,
        runId: 'topic-run-ui',
        status: 'SUCCEEDED',
        updatedAt: now,
      },
    ],
    total: 1,
    ...overrides,
  };
}

const statePreview: TopicActionPreview = {
  expiresAt: '2026-07-30T10:05:00.000Z',
  kind: 'STATE_CHANGE',
  preview: {
    action: 'LOCK',
    after: 'LOCKED',
    before: 'PROPOSED',
    expectedRevision: 1,
    kind: 'STATE_CHANGE',
    topicId: 'topic-ui',
  },
  previewHash: 'b'.repeat(64),
  token: 'c'.repeat(43),
};

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    value: undefined,
  });
});

describe('M3 Issue 022 Topic Pool renderer', () => {
  it('shows all five categories, eligibility/ranking/spoiler detail, shortfalls, stale history, and preview/confirm controls', async () => {
    const getTopicPool = vi.fn().mockResolvedValue({ ok: true, value: workspace() });
    const getTopic = vi.fn().mockResolvedValue({ ok: true, value: detail });
    const previewTopicAction = vi.fn().mockResolvedValue({ ok: true, value: statePreview });
    const lockedDetail = { ...detail, candidateState: 'LOCKED' as const, revision: 2 };
    const confirmTopicAction = vi.fn().mockResolvedValue({
      ok: true,
      value: { detail: lockedDetail, kind: 'STATE_CHANGE' },
    });
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        confirmTopicAction,
        getTopic,
        getTopicPool,
        previewTopicAction,
      } as unknown as DesktopBridge,
    });
    const user = userEvent.setup();
    render(<TopicPoolPage />);

    expect(await screen.findByText('合成完整诡计选题')).toBeInTheDocument();
    expect(screen.getByLabelText('五类选题数量').querySelectorAll('button')).toHaveLength(5);
    expect(screen.getByText('候选选题不是内容简报或已批准文章')).toBeInTheDocument();
    expect(screen.getByText(/不是爆款或传播结果预测/iu)).toBeInTheDocument();
    expect(screen.getByText(/不足时保持缺口/iu)).toBeInTheDocument();
    expect(screen.getAllByText('INCOMPLETE').length).toBeGreaterThan(0);
    expect(screen.getByText('STALE')).toBeInTheDocument();
    expect(screen.getByText(/外部请求 0/iu)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /合成完整诡计选题/iu }));
    expect(await screen.findByRole('region', { name: '五项可解释排序' })).toBeInTheDocument();
    for (const label of ['证据充分度', '内容适配度', '差异化', '预计成本', '审批工作量']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByText('未知（不按 0 或最优处理）')).toBeInTheDocument();
    expect(screen.getByText('COVER_TITLE_AND_BODY_OPENING')).toBeInTheDocument();
    expect(screen.getByText('必须显式确认')).toBeInTheDocument();
    expect(screen.getByText('<script>只作为文本显示</script>')).toBeInTheDocument();
    expect(screen.getByText(/公开资料标签：公开资料整理、资料分析评分/iu)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '锁定' }));
    await waitFor(() =>
      expect(previewTopicAction).toHaveBeenCalledWith({
        draft: { action: 'LOCK', expectedRevision: 1, topicId: 'topic-ui' },
        kind: 'STATE_CHANGE',
      }),
    );
    expect(await screen.findByText('请核对本地变更预览')).toBeInTheDocument();
    expect(confirmTopicAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '明确确认' }));
    expect(confirmTopicAction).toHaveBeenCalledWith({
      confirmation: 'APPLY_TOPIC_ACTION',
      executionId: null,
      kind: 'STATE_CHANGE',
      previewHash: statePreview.previewHash,
      token: statePreview.token,
    });
  });

  it('confirms quota planning with an execution identity and reports the recoverable queue state', async () => {
    const quotaPreview: TopicActionPreview = {
      expiresAt: '2026-07-30T10:05:00.000Z',
      kind: 'QUOTA_PLAN',
      preview: {
        categories: categories(),
        kind: 'QUOTA_PLAN',
        maxWorkExposure: 3,
        noOp: false,
        poolSnapshotHash: 'd'.repeat(64),
        status: 'INCOMPLETE',
        totalRequired: 30,
        totalSelected: 1,
        warnings: ['QUOTA_SHORTFALL_OR_CONFLICT'],
      },
      previewHash: 'e'.repeat(64),
      token: 'f'.repeat(43),
    };
    const confirmTopicAction = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        kind: 'QUOTA_PLAN',
        quota: {
          executionId: 'topic-quota-ui',
          expectedPlanStatus: 'INCOMPLETE',
          externalRequestCount: 0,
          planVersionId: null,
          runId: 'topic-quota-run-ui',
          status: 'CONFIRMED',
          totalSelected: 1,
        },
      },
    });
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        confirmTopicAction,
        getTopicPool: vi.fn().mockResolvedValue({ ok: true, value: workspace() }),
        previewTopicAction: vi.fn().mockResolvedValue({ ok: true, value: quotaPreview }),
      } as unknown as DesktopBridge,
    });
    const user = userEvent.setup();
    render(<TopicPoolPage />);
    await screen.findByText('合成完整诡计选题');

    await user.click(screen.getByRole('button', { name: '预览配额计划' }));
    expect(await screen.findByText('请核对本地变更预览')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '明确确认' }));
    expect(confirmTopicAction).toHaveBeenCalledWith({
      confirmation: 'APPLY_TOPIC_ACTION',
      executionId: expect.stringMatching(/^topic-exec-\d+-\d+$/u),
      kind: 'QUOTA_PLAN',
      previewHash: quotaPreview.previewHash,
      token: quotaPreview.token,
    });
    expect(await screen.findByText(/FIRST_30_V1 已进入可恢复队列/iu)).toBeInTheDocument();
  });

  it('renders complete, empty, loading/error, and unconfigured bridge states without hidden generation', async () => {
    const complete = workspace({
      currentPlan: plan('COMPLETE', 3, false),
      items: [],
      planHistory: [plan('COMPLETE', 3, false)],
      recentGenerationRuns: [],
      total: 0,
    });
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getTopicPool: vi.fn().mockResolvedValue({ ok: true, value: complete }),
      } as unknown as DesktopBridge,
    });
    render(<TopicPoolPage />);
    expect(screen.getByText('正在读取本地候选…')).toBeInTheDocument();
    expect(await screen.findByText('当前筛选下没有候选')).toBeInTheDocument();
    expect(screen.getAllByText('COMPLETE').length).toBeGreaterThan(0);
    expect(screen.getByText('尚无生成运行')).toBeInTheDocument();

    cleanup();
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getTopicPool: vi.fn().mockResolvedValue({
          error: {
            code: 'TOPIC_PROFILE_NOT_FOUND',
            message: 'safe',
            retryable: false,
          },
          ok: false,
        }),
      } as unknown as DesktopBridge,
    });
    render(<TopicPoolPage />);
    expect(await screen.findByText('未找到本地用户档案。')).toBeInTheDocument();

    cleanup();
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: undefined,
    });
    render(<TopicPoolPage />);
    expect(await screen.findByText('当前桌面桥接尚未提供 Topic Pool 能力。')).toBeInTheDocument();
    expect(screen.queryByText(/自动发布|生成正文|创建实验/iu)).not.toBeInTheDocument();
  });
});
