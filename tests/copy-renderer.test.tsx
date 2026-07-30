// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyWorkbench } from '../apps/web-ui/src/copy-workbench.js';
import type {
  CopyDraftDetailView,
  CopyDraftListView,
  DesktopBridge,
} from '../packages/shared/src/index.js';
import { completeCopyPayload } from './support/copy-fixtures.js';

function counts(ready = 0): CopyDraftListView['counts'] {
  return {
    ARCHIVED: 0,
    MANUAL_DRAFT: 0,
    MODEL_CANDIDATE: 0,
    READY_FOR_QUALITY_PIPELINE: ready,
    STALE: 0,
    STRUCTURE_INVALID: 0,
    SUPERSEDED: 0,
  };
}

function detail(): CopyDraftDetailView {
  const payload = completeCopyPayload('FULL_TRICK_LOGIC_ANALYSIS');
  return {
    briefId: payload.brief.briefId,
    draftId: 'draft-renderer',
    invalidationReasons: [],
    payload,
    profileId: payload.profileId,
    revision: 2,
    runs: [
      {
        cacheState: 'NOT_CHECKED',
        costState: 'UNKNOWN_POSSIBLY_INCURRED',
        createdAt: '2026-07-30T14:00:00.000Z',
        draftId: 'draft-renderer',
        executionId: 'copy-execution-renderer',
        externalRequestCount: 1,
        finishedAt: '2026-07-30T14:01:00.000Z',
        modelExecutionId: 'copy-execution-renderer',
        modelIdentity: null,
        outputHash: null,
        planId: 'copy-plan-renderer',
        policyVersion: 'copy-generation-policy-v1',
        promptTemplateVersion: 'copy-prompt-template-v1',
        resultVersionId: null,
        runId: 'copy-run-renderer',
        schemaVersion: 'copy-output-schema-v1',
        status: 'AMBIGUOUS',
        styleVersion: 'account-voice-policy-v1',
        usageState: 'UNKNOWN',
      },
    ],
    state: 'ACTIVE',
    status: 'READY_FOR_QUALITY_PIPELINE',
    updatedAt: '2026-07-30T14:02:00.000Z',
    validation: {
      evaluatedAt: '2026-07-30T14:02:00.000Z',
      policyVersion: 'draft-structural-validation-v1',
      reasonCodes: [],
      valid: true,
    },
    versionHistory: {
      items: [
        {
          changeKinds: ['CREATE_MANUAL_SCAFFOLD'],
          createdAt: '2026-07-30T14:00:00.000Z',
          isCurrent: false,
          sourceKind: 'MANUAL',
          status: 'MANUAL_DRAFT',
          versionId: 'draft-version-1',
          versionNumber: 1,
        },
        {
          changeKinds: ['USER_EDIT'],
          createdAt: '2026-07-30T14:02:00.000Z',
          isCurrent: true,
          sourceKind: 'MANUAL',
          status: 'READY_FOR_QUALITY_PIPELINE',
          versionId: 'draft-version-2',
          versionNumber: 2,
        },
      ],
      limit: 20,
      offset: 0,
      total: 2,
    },
    versionNumber: 2,
  };
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: undefined });
});

describe('M3 Issue 025 copy workbench renderer', () => {
  it('renders empty manual path and explicit quality boundaries', async () => {
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getBriefs: vi.fn(async () => ({
          ok: true,
          value: {
            counts: {
              AUTHENTICITY_BLOCKED: 0,
              DOSSIER_NOT_READY: 0,
              DRAFT_INCOMPLETE: 0,
              EVIDENCE_MAPPING_INCOMPLETE: 0,
              EXPERIMENT_MISMATCH: 0,
              FACT_BLOCKED: 0,
              READY_FOR_DRAFT_GENERATION: 0,
              SPOILER_POLICY_INCOMPLETE: 0,
              STALE: 0,
            },
            items: [],
            limit: 100,
            offset: 0,
            total: 0,
          },
        })),
        getCopyDrafts: vi.fn(async () => ({
          ok: true,
          value: { counts: counts(), items: [], limit: 12, offset: 0, total: 0 },
        })),
      } as unknown as DesktopBridge,
    });
    render(<CopyWorkbench />);
    expect(await screen.findByRole('heading', { name: '文案工作台' })).toBeInTheDocument();
    expect(
      screen.getByText(/事实、真实性、剧透、重复度与标题正文一致性尚未检查/u),
    ).toBeInTheDocument();
    expect(screen.getByText('READY_FOR_QUALITY_PIPELINE ≠ 可发布')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /审批|导出|发布|生成图片/u }),
    ).not.toBeInTheDocument();
  });

  it('shows title, blocks, tags, comment, warnings, lineage, locks, rewrite and history', async () => {
    const current = detail();
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getBriefs: vi.fn(async () => ({
          ok: true,
          value: { counts: {} as never, items: [], limit: 100, offset: 0, total: 0 },
        })),
        getCopyDraft: vi.fn(async () => ({ ok: true, value: current })),
        getCopyDrafts: vi.fn(async () => ({
          ok: true,
          value: {
            counts: counts(1),
            items: [
              {
                briefId: current.briefId,
                draftId: current.draftId,
                profileId: current.profileId,
                revision: current.revision,
                state: current.state,
                status: current.status,
                updatedAt: current.updatedAt,
                versionNumber: current.versionNumber,
              },
            ],
            limit: 12,
            offset: 0,
            total: 1,
          },
        })),
      } as unknown as DesktopBridge,
    });
    render(<CopyWorkbench />);
    const item = await screen.findByRole('button', { name: /待质量检查.*FULL_TRICK/isu });
    item.click();
    await waitFor(() => expect(screen.getByText(/Draft v2/u)).toBeInTheDocument());
    expect(screen.getByText('剧透警告文本 artifacts（不生成图片）')).toBeInTheDocument();
    expect(screen.getByText('Brief lineage 与权限快照')).toBeInTheDocument();
    expect(screen.getByText('字段 provenance / lock')).toBeInTheDocument();
    expect(screen.getByText('有限局部重写')).toBeInTheDocument();
    expect(screen.getByText('不可变版本')).toBeInTheDocument();
    expect(screen.getByText('生成 / 重写历史')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '预览完整生成' })).toBeEnabled();
  });
});
