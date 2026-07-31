// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyWorkbench } from '../apps/web-ui/src/copy-workbench.js';
import type {
  CopyDraftDetailView,
  CopyDraftListView,
  DesktopBridge,
  ReadingAuthenticityReadModel,
} from '../packages/shared/src/index.js';
import { completeCopyPayload, requiredFixtureValue } from './support/copy-fixtures.js';

function fixture(): { readonly detail: CopyDraftDetailView; readonly list: CopyDraftListView } {
  const original = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
  const selectedId = requiredFixtureValue(original.selectedTitleId);
  const payload = {
    ...original,
    titles: original.titles.map((title) =>
      title.titleId === selectedId ? { ...title, text: '我读完后认为它很稳。' } : title,
    ),
  };
  const detail: CopyDraftDetailView = {
    briefId: payload.brief.briefId,
    draftId: 'draft-reading-renderer',
    invalidationReasons: [],
    payload,
    profileId: payload.profileId,
    revision: 3,
    runs: [],
    state: 'ACTIVE',
    status: 'READY_FOR_QUALITY_PIPELINE',
    updatedAt: '2026-07-31T04:00:00.000Z',
    validation: {
      evaluatedAt: '2026-07-31T04:00:00.000Z',
      policyVersion: 'draft-structural-validation-v1',
      reasonCodes: [],
      valid: true,
    },
    versionHistory: {
      items: [
        {
          changeKinds: ['USER_EDIT'],
          createdAt: '2026-07-31T04:00:00.000Z',
          isCurrent: true,
          sourceKind: 'MANUAL',
          status: 'READY_FOR_QUALITY_PIPELINE',
          versionId: 'draft-reading-version-3',
          versionNumber: 3,
        },
      ],
      limit: 20,
      offset: 0,
      total: 1,
    },
    versionNumber: 3,
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

describe('Issue 027 copy workbench reading authenticity section', () => {
  it('previews a located finding and confirms only the summary without editing controls', async () => {
    const current = fixture();
    const readModel: ReadingAuthenticityReadModel = {
      draftId: current.detail.draftId,
      draftRevision: current.detail.revision,
      draftVersionId: 'draft-reading-version-3',
      evaluatedAt: '2026-07-31T04:01:00.000Z',
      evaluationStatus: 'BLOCKED',
      findings: [
        {
          artifactId: requiredFixtureValue(current.detail.payload.selectedTitleId),
          artifactKind: 'SELECTED_TITLE',
          disposition: 'BLOCKED',
          draftVersionId: 'draft-reading-version-3',
          endCodePoint: 4,
          reasonCode: 'UNSUPPORTED_FIRSTHAND_EXPERIENCE',
          selectedTextHash: 'a'.repeat(64),
          startCodePoint: 0,
          textHash: 'b'.repeat(64),
        },
      ],
      reasonCodes: ['UNSUPPORTED_FIRSTHAND_EXPERIENCE'],
      savedStatus: 'NOT_RUN',
      truncated: false,
    };
    const previewReadingAuthenticity = vi.fn(async () => ({
      ok: true as const,
      value: {
        expiresAt: '2026-07-31T04:06:00.000Z',
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
    const confirmReadingAuthenticity = vi.fn(async () => ({
      ok: true as const,
      value: { readModel: { ...readModel, savedStatus: 'BLOCKED' as const } },
    }));
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        confirmReadingAuthenticity,
        getBriefs: vi.fn(async () => ({
          ok: true,
          value: { counts: {} as never, items: [], limit: 100, offset: 0, total: 0 },
        })),
        getCopyDraft: vi.fn(async () => ({ ok: true, value: current.detail })),
        getCopyDrafts: vi.fn(async () => ({ ok: true, value: current.list })),
        previewReadingAuthenticity,
      } as unknown as DesktopBridge,
    });

    render(<CopyWorkbench />);
    (await screen.findByRole('button', { name: /NON_SPOILER_SINGLE_BOOK_VERDICT/iu })).click();
    const section = await screen.findByRole('region', { name: '真实性与评分检查' });
    expect(within(section).getByText(/尚未读取/u)).toBeInTheDocument();
    expect(within(section).getByText(/检查不修改文案/u)).toBeInTheDocument();
    within(section).getByRole('button', { name: '预览检查' }).click();

    await waitFor(() => expect(previewReadingAuthenticity).toHaveBeenCalledTimes(1));
    expect(previewReadingAuthenticity).toHaveBeenCalledWith({
      draftId: current.detail.draftId,
      expectedRevision: current.detail.revision,
    });
    expect(await within(section).findByText(/UNSUPPORTED_FIRSTHAND_EXPERIENCE/u)).toHaveTextContent(
      '我读完后',
    );
    expect(within(section).queryByRole('button', { name: /修文|审批|导出|发布/u })).toBeNull();
    within(section).getByRole('button', { name: '确认保存摘要' }).click();
    await waitFor(() => expect(confirmReadingAuthenticity).toHaveBeenCalledTimes(1));
    expect(confirmReadingAuthenticity).toHaveBeenCalledWith({
      confirmation: 'SAVE_READING_AUTHENTICITY_CHECK',
      expectedRevision: 3,
      previewHash: 'c'.repeat(64),
      token: 'd'.repeat(43),
    });
    expect(within(section).getByText(/已保存：BLOCKED/u)).toBeInTheDocument();
  });
});
