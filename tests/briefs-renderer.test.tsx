// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ContentProductionPage } from '../apps/web-ui/src/content-production-page.js';
import type {
  BriefDetailView,
  BriefListView,
  DesktopBridge,
} from '../packages/shared/src/index.js';
import { readyBriefDraft } from './support/brief-fixtures.js';

function counts(ready = 0): BriefListView['counts'] {
  return {
    AUTHENTICITY_BLOCKED: 0,
    DOSSIER_NOT_READY: 0,
    DRAFT_INCOMPLETE: 0,
    EVIDENCE_MAPPING_INCOMPLETE: 0,
    EXPERIMENT_MISMATCH: 0,
    FACT_BLOCKED: 0,
    READY_FOR_DRAFT_GENERATION: ready,
    SPOILER_POLICY_INCOMPLETE: 0,
    STALE: 0,
  };
}

function detail(): BriefDetailView {
  const draft = readyBriefDraft('NON_SPOILER_SINGLE_BOOK_VERDICT');
  return {
    briefId: 'brief-renderer',
    dependencies: [],
    draft,
    evidencePage: {
      items: draft.evidenceMap,
      limit: 10,
      offset: 0,
      total: draft.evidenceMap.length,
    },
    experimentBound: false,
    generationRuns: [
      {
        briefId: 'brief-renderer',
        costState: 'NOT_INCURRED',
        executionId: 'brief-renderer-execution',
        externalRequestCount: 0,
        planId: 'brief-renderer-plan',
        resultVersionId: null,
        revision: 1,
        runId: 'brief-renderer-run',
        stableErrorCode: null,
        status: 'CONFIRMED',
      },
    ],
    generationPage: { limit: 10, offset: 0, total: 1 },
    history: [
      {
        action: 'SAVE_EDIT',
        createdAt: '2026-07-30T13:20:00.000Z',
        fromState: 'ACTIVE',
        revision: 2,
        toState: 'ACTIVE',
      },
    ],
    historyPage: { limit: 10, offset: 0, total: 1 },
    invalidationReasons: [],
    profileId: draft.profileId,
    readiness: 'READY_FOR_DRAFT_GENERATION',
    readinessReasonCodes: [],
    revision: 2,
    stale: false,
    state: 'ACTIVE',
    topicId: draft.topicId,
    updatedAt: '2026-07-30T13:20:00.000Z',
    versionHistory: {
      items: [
        {
          changeKinds: ['targetAudience'],
          createdAt: '2026-07-30T13:10:00.000Z',
          isCurrent: false,
          readiness: 'DRAFT_INCOMPLETE',
          status: 'DRAFT',
          versionId: 'brief-renderer-version-1',
          versionNumber: 1,
        },
        {
          changeKinds: ['targetAudience'],
          createdAt: '2026-07-30T13:20:00.000Z',
          isCurrent: true,
          readiness: 'READY_FOR_DRAFT_GENERATION',
          status: 'USER_CONFIRMED',
          versionId: 'brief-renderer-version',
          versionNumber: 2,
        },
      ],
      limit: 30,
      offset: 0,
      total: 2,
    },
    versionNumber: 2,
  };
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    value: undefined,
  });
});

describe('M3 Issue 024 content production renderer', () => {
  it('renders the empty local-scaffold state without exposing downstream generators', async () => {
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getBriefs: vi.fn(async () => ({
          ok: true,
          value: { counts: counts(), items: [], limit: 100, offset: 0, total: 0 },
        })),
      } as unknown as DesktopBridge,
    });
    render(<ContentProductionPage />);
    expect(
      await screen.findByRole('heading', { name: '把研究证据压成可控结构，保留人的判断' }),
    ).toBeInTheDocument();
    expect(await screen.findByText('从 Topic 开始')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /生成标题|生成正文|生成图片|质量评审/u }),
    ).not.toBeInTheDocument();
  });

  it('shows evidence, provenance, locks, authenticity, score, spoiler and experiment boundaries', async () => {
    const current = detail();
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getBrief: vi.fn(async () => ({ ok: true, value: current })),
        getBriefs: vi.fn(async () => ({
          ok: true,
          value: {
            counts: counts(1),
            items: [
              {
                briefId: current.briefId,
                experimentBound: false,
                profileId: current.profileId,
                readiness: current.readiness,
                revision: current.revision,
                stale: false,
                state: current.state,
                topicId: current.topicId,
                updatedAt: current.updatedAt,
                versionNumber: current.versionNumber,
              },
            ],
            limit: 100,
            offset: 0,
            total: 1,
          },
        })),
      } as unknown as DesktopBridge,
    });
    render(<ContentProductionPage />);
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: current.topicId })).toBeInTheDocument(),
    );
    expect(screen.getByRole('heading', { name: '字段级证据链' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '字段来源与锁' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '支撑论点编辑器' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '最强反方与限定' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '必需结构槽位' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '禁用表达' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '版本历史' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '操作历史' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '结构候选任务历史' })).toBeInTheDocument();
    expect(screen.getByText('个人评分、资料分析评分与内部预测严格隔离')).toBeInTheDocument();
    expect(screen.getByText('绑定只约束结构；不代表效果、显著性或 winner')).toBeInTheDocument();
    expect(screen.getByText('公开资料整理或资料分析评分不代表个人阅读体验。')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo 到此版本' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '克隆为新 Draft' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '预览取消' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '预览结构生成' })).toBeEnabled();
    fireEvent.change(screen.getByPlaceholderText('新增用户自定义禁用表达'), {
      target: { value: '不要使用空洞钩子' },
    });
    fireEvent.click(screen.getByRole('button', { name: '添加' }));
    expect(screen.getByText('不要使用空洞钩子')).toBeInTheDocument();
  });

  it('creates a local scaffold from a locked eligible Topic using IDs only', async () => {
    const previewBriefAction = vi.fn(async () => ({
      ok: true as const,
      value: {
        expiresAt: '2026-07-30T13:30:00.000Z',
        kind: 'CREATE_SCAFFOLD' as const,
        preview: {
          evidenceRefCount: 0,
          experimentBound: false,
          kind: 'CREATE_SCAFFOLD' as const,
          profileId: 'NON_SPOILER_SINGLE_BOOK_VERDICT' as const,
          readiness: 'DRAFT_INCOMPLETE' as const,
          readinessReasonCodes: ['TARGET_AUDIENCE_INCOMPLETE'],
          subjectCount: 1,
          topicId: 'topic-renderer-create',
        },
        previewHash: 'a'.repeat(64),
        token: 'a'.repeat(43),
      },
    }));
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getBriefs: vi.fn(async () => ({
          ok: true,
          value: { counts: counts(), items: [], limit: 100, offset: 0, total: 0 },
        })),
        getTopicPool: vi.fn(async () => ({
          ok: true,
          value: {
            counts: {
              CROSS_WORK_COMPARISON: 0,
              FULL_TRICK_LOGIC_ANALYSIS: 0,
              MYSTERY_AND_CULTURAL_PHENOMENON: 0,
              NON_SPOILER_SINGLE_BOOK_VERDICT: 1,
              WEB_VS_PUBLISHED_MYSTERY: 0,
            },
            currentPlan: null,
            items: [
              {
                analysisMode: 'PUBLIC_RESEARCH',
                candidateState: 'LOCKED',
                contentType: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
                eligibility: 'ELIGIBLE',
                eligibilityReasonCodes: [],
                fingerprint: 'f'.repeat(64),
                rankingComplete: true,
                revision: 2,
                spoilerLevel: 'NO_SPOILER',
                stale: false,
                topicAngle: '合成无剧透判断',
                topicId: 'topic-renderer-create',
                totalScoreBasisPoints: 8500,
                versionNumber: 1,
              },
            ],
            limit: 100,
            offset: 0,
            planHistory: [],
            profileId: 'primary',
            recentGenerationRuns: [],
            total: 1,
          },
        })),
        previewBriefAction,
      } as unknown as DesktopBridge,
    });
    render(<ContentProductionPage />);
    const create = await screen.findByRole('button', { name: /合成无剧透判断/u });
    fireEvent.click(create);
    await waitFor(() =>
      expect(previewBriefAction).toHaveBeenCalledWith({
        assignmentPlanId: null,
        kind: 'CREATE_SCAFFOLD',
        topicId: 'topic-renderer-create',
      }),
    );
    expect(await screen.findByRole('heading', { name: '创建纯本地 scaffold' })).toBeInTheDocument();
  });
});
