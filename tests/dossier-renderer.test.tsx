// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DossierWorkspace } from '../apps/web-ui/src/dossier-workspace.js';
import type {
  DesktopBridge,
  DossierBuildPreview,
  DossierDetailStateView,
  DossierListStateView,
} from '../packages/shared/src/index.js';

const now = '2026-07-29T04:00:00.000Z';
const inputHash = 'a'.repeat(64);
const dossier = {
  contractVersion: 'research-dossier-v1',
  createdAt: now,
  currentVersionId: 'version-ui-2',
  currentVersionNumber: 2,
  dossierId: 'dossier-ui',
  invalidationReasons: [],
  readiness: 'READY_FOR_CONTENT_BRIEF',
  revision: 4,
  state: 'CURRENT',
  subject: { id: '<script>work-ui</script>', type: 'WORK' },
  updatedAt: now,
} as const;

const sections = [
  {
    blockedCount: 0,
    coverageBasisPoints: 10_000,
    entryCount: 1,
    gapCount: 0,
    insufficientCount: 0,
    position: 0,
    readinessRequired: true,
    reasonCodes: [],
    section: 'IDENTITY',
    sectionId: 'section-ui-identity',
    staleCount: 0,
    verifiedCount: 1,
    versionId: 'version-ui-2',
  },
  {
    blockedCount: 0,
    coverageBasisPoints: 0,
    entryCount: 0,
    gapCount: 1,
    insufficientCount: 0,
    position: 9,
    readinessRequired: false,
    reasonCodes: ['NO_CLAIM'],
    section: 'RESEARCH_GAPS',
    sectionId: 'section-ui-gaps',
    staleCount: 0,
    verifiedCount: 0,
    versionId: 'version-ui-2',
  },
] as const;

const detail: DossierDetailStateView = {
  coverage: {
    blockedCount: 0,
    coveragePolicyVersion: 'dossier-coverage-policy-v1',
    gapCount: 1,
    inputHash,
    insufficientCount: 0,
    optionalBasisPoints: 0,
    overallBasisPoints: 6500,
    reasonCodes: ['OPTIONAL_GAPS_REMAIN'],
    requiredBasisPoints: 10_000,
    sections: sections.map((section) => ({
      basisPoints: section.coverageBasisPoints,
      blockedCount: section.blockedCount,
      gapCount: section.gapCount,
      insufficientCount: section.insufficientCount,
      reasonCodes: section.reasonCodes,
      section: section.section,
      staleCount: section.staleCount,
      verifiedCount: section.verifiedCount,
    })),
    staleCount: 0,
    verifiedCount: 1,
  },
  dossier,
  entries: [
    {
      claimIds: ['claim-ui-title'],
      conflictId: null,
      createdAt: now,
      displayValue: '<img src=x onerror=alert(1)> 合成作品',
      entryId: 'entry-ui-title',
      entryKind: 'CONSENSUS',
      evidenceCount: 1,
      evidenceIds: ['evidence-ui-title'],
      factEvaluationIds: ['evaluation-ui-title'],
      factStatus: 'VERIFIED',
      gapId: null,
      predicate: 'canonical_title',
      provenance: 'LOCAL_DETERMINISTIC',
      revision: 1,
      section: 'IDENTITY',
      semanticKey: 'identity.canonical_title',
      sourceCount: 1,
      sourceRevisionIds: ['source-ui-title:1'],
      structuredValue: '合成作品',
      updatedAt: now,
      versionId: 'version-ui-2',
    },
  ],
  entryLimit: 100,
  entryOffset: 0,
  gaps: [
    {
      auditRef: null,
      blocking: false,
      claimIds: [],
      createdAt: now,
      gapId: 'gap-ui-awards',
      reasonCode: 'NO_CLAIM',
      required: false,
      section: 'AWARDS',
      semanticKey: 'awards.recognition',
      versionId: 'version-ui-2',
    },
  ],
  runs: [
    {
      costState: 'NOT_INCURRED',
      createdAt: now,
      dossierId: 'dossier-ui',
      errorCode: null,
      executionId: 'execution-ui',
      externalRequestCount: 0,
      inputHash,
      jobId: 'job-ui',
      planId: 'plan-ui',
      resultVersionId: null,
      revision: 2,
      runId: 'run-ui',
      status: 'RUNNING',
      updatedAt: now,
    },
  ],
  sections,
  versions: [
    {
      buildMode: 'INCREMENTAL',
      buildRunId: 'run-ui-2',
      coveragePolicyVersion: 'dossier-coverage-policy-v1',
      createdAt: now,
      dossierId: 'dossier-ui',
      factPolicyVersion: 'fact-policy-v1',
      inputHash,
      isCurrent: true,
      previousVersionId: 'version-ui-1',
      publishedAt: now,
      readiness: 'READY_FOR_CONTENT_BRIEF',
      reasonCodes: [],
      revision: 1,
      schemaVersion: 'research-dossier-schema-v1',
      versionId: 'version-ui-2',
      versionNumber: 2,
      warnings: [],
    },
    {
      buildMode: 'INITIAL',
      buildRunId: 'run-ui-1',
      coveragePolicyVersion: 'dossier-coverage-policy-v1',
      createdAt: now,
      dossierId: 'dossier-ui',
      factPolicyVersion: 'fact-policy-v1',
      inputHash: 'b'.repeat(64),
      isCurrent: false,
      previousVersionId: null,
      publishedAt: now,
      readiness: 'INSUFFICIENT_COVERAGE',
      reasonCodes: ['REQUIRED_COVERAGE_BELOW_THRESHOLD'],
      revision: 1,
      schemaVersion: 'research-dossier-schema-v1',
      versionId: 'version-ui-1',
      versionNumber: 1,
      warnings: [],
    },
  ],
};

const list: DossierListStateView = {
  items: [{ dossier, subjectLabel: '合成档案作品' }],
  limit: 50,
  offset: 0,
  total: 1,
};

const preview: DossierBuildPreview = {
  expiresAt: '2026-07-29T04:05:00.000Z',
  plan: {
    budgetConclusion: 'NOT_APPLICABLE',
    buildMode: 'INCREMENTAL',
    contractVersion: 'dossier-build-plan-v1',
    counts: {
      claimCount: 1,
      conflictCount: 0,
      dependencyCount: 5,
      evidenceCount: 1,
      gapCount: 1,
    },
    createdAt: now,
    diff: {
      addedSemanticKeys: [],
      removedSemanticKeys: [],
      updatedSemanticKeys: ['identity.canonical_title'],
    },
    dossierId: 'dossier-ui',
    estimatedLocalWrites: 20,
    estimatedModelRequests: 0,
    expectedCurrentVersionId: 'version-ui-2',
    expectedDossierRevision: 4,
    expiresAt: '2026-07-29T04:05:00.000Z',
    inputHash,
    noOp: false,
    planHash: 'c'.repeat(64),
    planId: 'plan-ui-next',
    readinessAfter: 'READY_FOR_CONTENT_BRIEF',
    readinessBefore: 'READY_FOR_CONTENT_BRIEF',
    sectionCoverageAfter: detail.coverage?.sections ?? [],
    sectionCoverageBefore: detail.coverage?.sections ?? [],
    subject: dossier.subject,
  },
  previewHash: 'd'.repeat(64),
  token: 'e'.repeat(43),
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteDesktop');
});

describe('Issue 020 Dossier renderer', () => {
  it('shows current version, exact coverage, gaps and trace identities without rendering markup', async () => {
    const bridge = {
      getDossier: vi.fn().mockResolvedValue({ ok: true, value: detail }),
      listDossiers: vi.fn().mockResolvedValue({ ok: true, value: list }),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    const { container } = render(<DossierWorkspace />);

    expect(await screen.findByText('合成档案作品')).toBeInTheDocument();
    expect(await screen.findByText('65%')).toBeInTheDocument();
    expect(screen.getByText('共识')).toBeInTheDocument();
    expect(screen.getByText('claim-ui-title')).toBeInTheDocument();
    expect(screen.getByText('evidence-ui-title')).toBeInTheDocument();
    expect(screen.getByText('source-ui-title:1')).toBeInTheDocument();
    expect(screen.getByText('NO_CLAIM')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(document.body.textContent).not.toMatch(/[A-Z]:\\|sk-[A-Za-z0-9]/u);
  });

  it('requires a preview and explicit confirmation before queueing an ID-only build', async () => {
    const confirm = vi.fn().mockResolvedValue({ ok: true, value: detail.runs[0] });
    const previewBuild = vi.fn().mockResolvedValue({ ok: true, value: preview });
    const bridge = {
      confirmDossierBuild: confirm,
      getDossier: vi.fn().mockResolvedValue({ ok: true, value: detail }),
      listDossiers: vi.fn().mockResolvedValue({ ok: true, value: list }),
      previewDossierBuild: previewBuild,
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    render(<DossierWorkspace />);
    await screen.findByText('合成档案作品');

    expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '预览构建' }));
    expect(await screen.findByText(/模型请求 0/u)).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: '明确确认本地构建' }));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith({
        confirmation: 'START_DOSSIER_BUILD',
        planHash: preview.plan.planHash,
        previewHash: preview.previewHash,
        token: preview.token,
      }),
    );
  });

  it('renders rebuild-required and supports bounded current-version diff and cancellation', async () => {
    const staleDetail: DossierDetailStateView = {
      ...detail,
      dossier: {
        ...dossier,
        invalidationReasons: ['SOURCE_REVISION_CHANGED'],
        readiness: 'BUILD_REQUIRED',
        state: 'REBUILD_REQUIRED',
      },
    };
    const staleList: DossierListStateView = {
      ...list,
      items: [{ dossier: staleDetail.dossier, subjectLabel: '合成档案作品' }],
    };
    const cancel = vi.fn().mockResolvedValue({
      ok: true,
      value: { ...detail.runs[0], revision: 3, status: 'CANCEL_REQUESTED' },
    });
    const compare = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        addedSemanticKeys: ['identity.author'],
        fromVersionId: 'version-ui-1',
        removedSemanticKeys: [],
        toVersionId: 'version-ui-2',
        updatedSemanticKeys: ['identity.canonical_title'],
      },
    });
    const bridge = {
      cancelDossierBuild: cancel,
      diffDossierVersions: compare,
      getDossier: vi.fn().mockResolvedValue({ ok: true, value: staleDetail }),
      listDossiers: vi.fn().mockResolvedValue({ ok: true, value: staleList }),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    render(<DossierWorkspace />);

    expect(await screen.findByText('重建原因')).toBeInTheDocument();
    expect(screen.getByText('SOURCE_REVISION_CHANGED')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '比较当前版本' }));
    expect(await screen.findByText('新增 1')).toBeInTheDocument();
    expect(compare).toHaveBeenCalledWith({
      dossierId: 'dossier-ui',
      fromVersionId: 'version-ui-1',
      toVersionId: 'version-ui-2',
    });
    await userEvent.click(screen.getByRole('button', { name: '取消' }));
    await waitFor(() =>
      expect(cancel).toHaveBeenCalledWith({
        confirmation: 'CANCEL_DOSSIER_BUILD',
        expectedRevision: 2,
        runId: 'run-ui',
      }),
    );
  });

  it('renders loading, empty, error and the complete bounded readiness state matrix', async () => {
    const deferred: {
      resolve?: (value: { readonly ok: true; readonly value: DossierListStateView }) => void;
    } = {};
    const loadingBridge = {
      listDossiers: vi.fn(
        () =>
          new Promise((resolve) => {
            deferred.resolve = resolve;
          }),
      ),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: loadingBridge,
    });
    render(<DossierWorkspace />);
    expect(screen.getByText('正在读取本地索引…')).toBeInTheDocument();
    if (deferred.resolve === undefined) throw new Error('list resolver missing');
    deferred.resolve({ ok: true, value: { items: [], limit: 50, offset: 0, total: 0 } });
    expect(await screen.findByText('尚未构建 Dossier')).toBeInTheDocument();
    cleanup();

    const states = [
      'NOT_BUILT',
      'FACT_BLOCKED',
      'INSUFFICIENT_COVERAGE',
      'STALE',
      'READY_FOR_CONTENT_BRIEF',
    ] as const;
    const matrix: DossierListStateView = {
      items: states.map((readiness, index) => ({
        dossier: {
          ...dossier,
          currentVersionId: readiness === 'NOT_BUILT' ? null : `version-matrix-${index}`,
          currentVersionNumber: readiness === 'NOT_BUILT' ? null : index + 1,
          dossierId: `dossier-matrix-${index}`,
          readiness,
          state: readiness === 'NOT_BUILT' ? 'NOT_BUILT' : 'CURRENT',
          subject: { id: `work-matrix-${index}`, type: 'WORK' },
        },
        subjectLabel: `状态样本 ${index}`,
      })),
      limit: 50,
      offset: 0,
      total: states.length,
    };
    const matrixBridge = {
      getDossier: vi.fn().mockResolvedValue({ ok: true, value: detail }),
      listDossiers: vi.fn().mockResolvedValue({ ok: true, value: matrix }),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: matrixBridge,
    });
    render(<DossierWorkspace />);
    for (const label of ['尚未构建', '事实冲突阻断', '覆盖不足', '版本已过期', '可进入内容简报']) {
      expect((await screen.findAllByText(label)).length).toBeGreaterThan(0);
    }
    cleanup();

    const errorBridge = {
      listDossiers: vi.fn().mockResolvedValue({
        error: {
          code: 'DOSSIER_NOT_FOUND',
          message: 'internal detail must not be required',
          retryable: false,
        },
        ok: false,
      }),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: errorBridge,
    });
    render(<DossierWorkspace />);
    expect(await screen.findByText('没有找到该 Dossier 或对应研究对象。')).toBeInTheDocument();
  });
});
