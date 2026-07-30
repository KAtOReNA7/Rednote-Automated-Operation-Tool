// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthenticityLibrary } from '../apps/web-ui/src/authenticity-library.js';
import type {
  AuthenticityActionPreview,
  AuthenticityLibraryView,
  AuthenticityWorkDetail,
  DesktopBridge,
} from '../packages/shared/src/index.js';

const now = '2026-07-30T03:00:00.000Z';
const permission: AuthenticityWorkDetail['permission'] = {
  blockingReasonCodes: [],
  contentBriefModes: {
    personalExperience: 'ALLOWED',
    publicResearchAnalysis: 'RESEARCH_ONLY',
  },
  contentBriefReadiness: 'ALLOWED',
  dependencyHash: 'a'.repeat(64),
  evaluatedAt: now,
  firstPersonPermission: 'ALLOWED',
  personalExperiencePermission: 'ALLOWED',
  personalScorePermission: 'ALLOWED',
  publicResearchAnalysisPermission: 'RESEARCH_ONLY',
  researchAnalysisScorePermission: 'RESEARCH_ONLY',
  snapshotId: 'snapshot-ui',
  spoiler: {
    coreTrickDisclosure: false,
    endingDisclosure: false,
    level: 'NO_SPOILER',
    reasonCodes: [],
    userConfirmationRequired: false,
    warningPlacement: 'NONE',
    warningRequired: false,
  },
  stale: false,
  warningReasonCodes: ['PUBLIC_RESEARCH_LABEL_REQUIRED'],
};

const detail: AuthenticityWorkDetail = {
  assertions: [
    {
      assertionId: 'assertion-ui',
      assertionKind: 'READING_IMPRESSION',
      assertionRevision: 2,
      confirmationScope: 'EXACT_STATEMENT',
      readingStateRevisionId: 'reading-revision-ui',
      stale: true,
      statement: '<script>不会被解释为 HTML</script>',
      status: 'REVOKED',
      updatedAt: now,
    },
  ],
  dossier: {
    coveragePolicyVersion: 'dossier-coverage-policy-v1',
    dossierId: 'dossier-ui',
    readiness: 'READY_FOR_CONTENT_BRIEF',
    stale: false,
    versionId: 'dossier-version-ui',
  },
  editions: [{ editionId: 'edition-ui', label: '合成版', publisher: '合成出版社' }],
  expressions: [
    {
      expressionId: 'expression-ui',
      kind: 'ORIGINAL',
      language: 'zh-CN',
      title: '合成表达',
    },
  ],
  history: [
    {
      confirmationKind: 'USER_EXPLICIT',
      createdAt: now,
      finishedAt: null,
      finishedAtPrecision: 'UNKNOWN',
      lastReadAt: null,
      lastReadAtPrecision: 'UNKNOWN',
      memoryConfidence: 'CLEAR',
      provenance: 'USER_UI',
      revision: 1,
      revisionId: 'reading-revision-ui',
      state: 'R1_READ_CLEAR',
      userNote: null,
    },
  ],
  historyLimit: 50,
  historyOffset: 0,
  memoryConfidence: 'CLEAR',
  permission,
  personalScore: {
    origin: 'PERSONAL_SCORE',
    publicLabel: '个人评分',
    revision: 1,
    scoreBasisPoints: 8800,
    status: 'ACTIVE',
  },
  profileId: 'primary',
  readingState: 'R1_READ_CLEAR',
  readingStateId: 'reading-ui',
  researchScore: {
    origin: 'RESEARCH_ANALYSIS_SCORE',
    publicLabel: '资料分析评分',
    revision: 1,
    scoreBasisPoints: 7600,
    status: 'ACTIVE',
  },
  revision: 1,
  spoilerPreference: {
    level: 'NO_SPOILER',
    revision: 1,
    userConfirmed: false,
    warningIncluded: false,
  },
  workId: 'work-ui',
  workTitle: '合成真实性书',
};

const library: AuthenticityLibraryView = {
  items: [
    {
      contentBriefReadiness: 'ALLOWED',
      dossierReadiness: 'READY_FOR_CONTENT_BRIEF',
      memoryConfidence: 'CLEAR',
      readingState: 'R1_READ_CLEAR',
      readingStateId: 'reading-ui',
      revision: 1,
      snapshotStale: false,
      workId: 'work-ui',
      workTitle: '合成真实性书',
    },
    {
      contentBriefReadiness: 'BLOCKED',
      dossierReadiness: 'INSUFFICIENT_COVERAGE',
      memoryConfidence: 'NOT_APPLICABLE',
      readingState: 'S2_RESEARCH_INSUFFICIENT',
      readingStateId: 'reading-ui-s2',
      revision: 1,
      snapshotStale: false,
      workId: 'work-ui-s2',
      workTitle: '资料不足书',
    },
  ],
  limit: 25,
  offset: 0,
  profileId: 'primary',
  total: 2,
};

const actionPreview: AuthenticityActionPreview = {
  expiresAt: '2026-07-30T03:05:00.000Z',
  kind: 'STATE_CHANGE',
  preview: {
    after: { memoryConfidence: 'PARTIAL', state: 'R2_READ_FUZZY' },
    before: { memoryConfidence: 'CLEAR', state: 'R1_READ_CLEAR' },
    kind: 'STATE_CHANGE',
    readingStateId: 'reading-ui',
  },
  previewHash: 'b'.repeat(64),
  token: 'a'.repeat(43),
};

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    value: undefined,
  });
});

describe('Issue 021 authenticity library renderer', () => {
  it('shows the permission matrix and requires preview/confirm for a state change', async () => {
    const getAuthenticityLibrary = vi.fn().mockResolvedValue({ ok: true, value: library });
    const getAuthenticityWork = vi.fn().mockResolvedValue({ ok: true, value: detail });
    const previewAuthenticityAction = vi.fn().mockResolvedValue({ ok: true, value: actionPreview });
    const confirmAuthenticityAction = vi.fn().mockResolvedValue({
      ok: true,
      value: { batch: null, detail, kind: 'STATE_CHANGE' },
    });
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        confirmAuthenticityAction,
        getAuthenticityLibrary,
        getAuthenticityWork,
        previewAuthenticityAction,
      } as unknown as DesktopBridge,
    });
    const user = userEvent.setup();
    render(<AuthenticityLibrary />);

    expect(await screen.findByText('合成真实性书')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /预览批量分类/iu })).toBeDisabled();
    expect(screen.getByLabelText('批量选择 合成真实性书')).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: /合成真实性书/iu }));

    expect(await screen.findByText('研究就绪度 × 表达权限')).toBeInTheDocument();
    expect(screen.getByText('具体第一人称')).toBeInTheDocument();
    expect(screen.getByText('资料型分析')).toBeInTheDocument();
    expect(screen.getAllByText('个人评分').length).toBeGreaterThan(0);
    expect(screen.getAllByText('资料分析评分').length).toBeGreaterThan(0);
    expect(screen.getByText(/Dossier ready 不等于用户读过/iu)).toBeInTheDocument();
    expect(screen.getByText('<script>不会被解释为 HTML</script>')).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('阅读状态'), 'R2_READ_FUZZY');
    await user.click(screen.getByRole('button', { name: '预览状态变更' }));
    await waitFor(() => expect(previewAuthenticityAction).toHaveBeenCalledTimes(1));
    expect(previewAuthenticityAction.mock.calls[0]?.[0]).toMatchObject({
      draft: {
        expectedRevision: 1,
        memoryConfidence: 'PARTIAL',
        nextState: 'R2_READ_FUZZY',
        profileId: 'primary',
      },
      kind: 'STATE_CHANGE',
    });
    expect(await screen.findByText('请先核对变更预览')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /合成真实性书/iu }));
    await waitFor(() => expect(getAuthenticityWork).toHaveBeenCalledTimes(2));
    expect(screen.queryByText('请先核对变更预览')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('阅读状态'), 'R2_READ_FUZZY');
    await user.click(screen.getByRole('button', { name: '预览状态变更' }));
    expect(await screen.findByText('请先核对变更预览')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '明确确认并保存' }));
    expect(confirmAuthenticityAction).toHaveBeenCalledWith({
      confirmation: 'APPLY_AUTHENTICITY_ACTION',
      kind: 'STATE_CHANGE',
      previewHash: actionPreview.previewHash,
      token: actionPreview.token,
    });
  });

  it('renders empty and bridge-error states without enabling hidden operations', async () => {
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getAuthenticityLibrary: vi.fn().mockResolvedValue({
          ok: true,
          value: { ...library, items: [], total: 0 },
        }),
      } as unknown as DesktopBridge,
    });
    render(<AuthenticityLibrary />);
    expect(await screen.findByText('暂无可管理的 Work。')).toBeInTheDocument();

    cleanup();
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: undefined,
    });
    render(<AuthenticityLibrary />);
    expect(await screen.findByText('当前桌面桥接不支持阅读真实性管理。')).toBeInTheDocument();
    expect(screen.queryByText('系统预测分仅用于内部排序')).not.toBeInTheDocument();
  });
});
