// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyWorkbench } from '../apps/web-ui/src/copy-workbench.js';
import type {
  CopyDraftDetailView,
  CopyDraftListView,
  DesktopBridge,
  SpoilerQualityReadModel,
} from '../packages/shared/src/index.js';
import { completeCopyPayload } from './support/copy-fixtures.js';

function fixture(): { readonly detail: CopyDraftDetailView; readonly list: CopyDraftListView } {
  const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
  const detail: CopyDraftDetailView = {
    briefId: payload.brief.briefId,
    draftId: 'draft-spoiler-renderer',
    invalidationReasons: [],
    payload,
    profileId: payload.profileId,
    revision: 5,
    runs: [],
    state: 'ACTIVE',
    status: 'READY_FOR_QUALITY_PIPELINE',
    updatedAt: '2026-08-01T11:00:00.000Z',
    validation: {
      evaluatedAt: '2026-08-01T11:00:00.000Z',
      policyVersion: 'draft-structural-validation-v1',
      reasonCodes: [],
      valid: true,
    },
    versionHistory: {
      items: [
        {
          changeKinds: ['USER_EDIT'],
          createdAt: '2026-08-01T11:00:00.000Z',
          isCurrent: true,
          sourceKind: 'MANUAL',
          status: 'READY_FOR_QUALITY_PIPELINE',
          versionId: 'draft-spoiler-version-5',
          versionNumber: 5,
        },
      ],
      limit: 20,
      offset: 0,
      total: 1,
    },
    versionNumber: 5,
  };
  return {
    detail,
    list: {
      counts: {
        ARCHIVED: 0,
        MANUAL_DRAFT: 0,
        MODEL_CANDIDATE: 0,
        READY_FOR_QUALITY_PIPELINE: 1,
        STALE: 0,
        STRUCTURE_INVALID: 0,
        SUPERSEDED: 0,
      },
      items: [
        {
          briefId: detail.briefId,
          draftId: detail.draftId,
          profileId: detail.profileId,
          revision: detail.revision,
          state: detail.state,
          status: detail.status,
          updatedAt: detail.updatedAt,
          versionNumber: detail.versionNumber,
        },
      ],
      limit: 12,
      offset: 0,
      total: 1,
    },
  };
}

afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: undefined });
});

describe('Issue 028 Copy workbench spoiler subset card', () => {
  it('previews and confirms a bounded summary without semantic-safety or workflow claims', async () => {
    const current = fixture();
    const readModel: SpoilerQualityReadModel = {
      draftId: current.detail.draftId,
      draftRevision: current.detail.revision,
      draftVersionId: 'draft-spoiler-version-5',
      evaluatedAt: '2026-08-01T11:01:00.000Z',
      evaluationStatus: 'REVIEW_REQUIRED',
      findings: [
        {
          artifactId: 'body-1',
          disposition: 'REVIEW_REQUIRED',
          endCodePoint: 8,
          reasonCode: 'ANSWER_STYLE_CANDIDATE',
          ruleVersion: 'spoiler-candidate-detector-v1',
          selectedTextHash: 'a'.repeat(64),
          startCodePoint: 2,
          surface: 'BODY_BLOCK',
          textHash: 'b'.repeat(64),
        },
      ],
      reasonCodes: ['ANSWER_STYLE_CANDIDATE'],
      savedStatus: 'NOT_RUN',
      truncated: false,
    };
    const previewSpoilerQuality = vi.fn(async () => ({
      ok: true as const,
      value: {
        expiresAt: '2026-08-01T11:06:00.000Z',
        preview: {
          costState: 'NOT_APPLICABLE' as const,
          externalRequestCount: 0 as const,
          readModel,
          writes: ['APPEND_QUALITY_CHECK'] as const,
        },
        previewHash: 'c'.repeat(64),
        token: 'd'.repeat(43),
      },
    }));
    const confirmSpoilerQuality = vi.fn(async () => ({
      ok: true as const,
      value: { readModel: { ...readModel, savedStatus: 'REVIEW_REQUIRED' as const } },
    }));
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        confirmSpoilerQuality,
        getBriefs: vi.fn(async () => ({
          ok: true,
          value: { counts: {} as never, items: [], limit: 100, offset: 0, total: 0 },
        })),
        getCopyDraft: vi.fn(async () => ({ ok: true, value: current.detail })),
        getCopyDrafts: vi.fn(async () => ({ ok: true, value: current.list })),
        previewSpoilerQuality,
      } as unknown as DesktopBridge,
    });

    render(<CopyWorkbench />);
    (await screen.findByRole('button', { name: /NON_SPOILER_SINGLE_BOOK_VERDICT/iu })).click();
    const section = await screen.findByRole('region', { name: '剧透确定性子集检查' });
    expect(within(section).getByText(/确定性子集/u)).toBeInTheDocument();
    expect(within(section).getByText(/不代表完整剧情语义判断或发布许可/u)).toBeInTheDocument();
    expect(section).not.toHaveTextContent(/全文安全|可导出/u);
    within(section).getByRole('button', { name: '预览剧透检查' }).click();

    await waitFor(() => expect(previewSpoilerQuality).toHaveBeenCalledTimes(1));
    expect(previewSpoilerQuality).toHaveBeenCalledWith({
      draftId: current.detail.draftId,
      expectedRevision: current.detail.revision,
    });
    expect(await within(section).findByText(/ANSWER_STYLE_CANDIDATE/u)).toHaveTextContent(
      'BODY_BLOCK [2, 8)',
    );
    expect(within(section).queryByRole('button', { name: /修文|审批|导出|发布/u })).toBeNull();
    within(section).getByRole('button', { name: '确认保存剧透摘要' }).click();
    await waitFor(() => expect(confirmSpoilerQuality).toHaveBeenCalledTimes(1));
    expect(confirmSpoilerQuality).toHaveBeenCalledWith({
      confirmation: 'SAVE_SPOILER_QUALITY_CHECK',
      expectedRevision: 5,
      previewHash: 'c'.repeat(64),
      token: 'd'.repeat(43),
    });
    expect(within(section).getByText(/已保存：REVIEW_REQUIRED/u)).toBeInTheDocument();
  });
});
