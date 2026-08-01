// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyWorkbench } from '../apps/web-ui/src/copy-workbench.js';
import type {
  CopyDraftDetailView,
  CopyDraftListView,
  CopyIntegrityReadModel,
  DesktopBridge,
} from '../packages/shared/src/index.js';
import { completeCopyPayload } from './support/copy-fixtures.js';

function fixture(): { readonly detail: CopyDraftDetailView; readonly list: CopyDraftListView } {
  const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
  const detail: CopyDraftDetailView = {
    briefId: payload.brief.briefId,
    draftId: 'draft-integrity-renderer',
    invalidationReasons: [],
    payload,
    profileId: payload.profileId,
    revision: 5,
    runs: [],
    state: 'ACTIVE',
    status: 'READY_FOR_QUALITY_PIPELINE',
    updatedAt: '2026-08-01T15:00:00.000Z',
    validation: {
      evaluatedAt: '2026-08-01T15:00:00.000Z',
      policyVersion: 'draft-structural-validation-v1',
      reasonCodes: [],
      valid: true,
    },
    versionHistory: {
      items: [
        {
          changeKinds: ['USER_EDIT'],
          createdAt: '2026-08-01T15:00:00.000Z',
          isCurrent: true,
          sourceKind: 'MANUAL',
          status: 'READY_FOR_QUALITY_PIPELINE',
          versionId: 'draft-integrity-version-5',
          versionNumber: 5,
        },
      ],
      limit: 20,
      offset: 0,
      total: 1,
    },
    versionNumber: 5,
  };
  const item = {
    briefId: detail.briefId,
    draftId: detail.draftId,
    profileId: detail.profileId,
    revision: detail.revision,
    state: detail.state,
    status: detail.status,
    updatedAt: detail.updatedAt,
    versionNumber: detail.versionNumber,
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
      items: [item],
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

describe('Issue 029A Copy workbench composite card', () => {
  it('previews and confirms two summaries without score, semantic or workflow claims', async () => {
    const current = fixture();
    const readModel: CopyIntegrityReadModel = {
      briefVersionId: current.detail.payload.brief.briefVersionId,
      checks: [
        {
          checkType: 'DUPLICATION',
          counts: { blocked: 0, reviewRequired: 1 },
          evaluationStatus: 'REVIEW_REQUIRED',
          findings: [
            {
              disposition: 'REVIEW_REQUIRED',
              locator: {
                artifactId: 'body-1',
                artifactKind: 'BODY_BLOCK',
                draftVersionId: 'draft-integrity-version-5',
                endCodePoint: 8,
                locatorVersion: 'draft-text-locator-v1',
                selectedTextHash: 'a'.repeat(64),
                startCodePoint: 2,
                textHash: 'b'.repeat(64),
              },
              matchedDraftId: 'draft-history',
              matchedDraftVersionId: 'draft-history-version',
              matchedIdentityHash: 'c'.repeat(64),
              reasonCode: 'HISTORICAL_OVERLAP_CANDIDATE',
              ruleVersion: 'copy-integrity-policy-v1',
              similarityBasisPoints: 8_500,
              suggestionCode: 'REWRITE_OR_CONFIRM',
            },
          ],
          reasonCodes: ['HISTORICAL_OVERLAP_CANDIDATE'],
          savedStatus: 'NOT_RUN',
          truncated: false,
        },
        {
          checkType: 'TITLE_BODY_CONSISTENCY',
          counts: { blocked: 0, reviewRequired: 0 },
          evaluationStatus: 'PASS',
          findings: [],
          reasonCodes: [],
          savedStatus: 'NOT_RUN',
          truncated: false,
        },
      ],
      draftId: current.detail.draftId,
      draftRevision: current.detail.revision,
      draftVersionId: 'draft-integrity-version-5',
      evaluatedAt: '2026-08-01T15:01:00.000Z',
      internalConsistencyStatus: 'NOT_RUN',
      structuralOutputStatus: 'PASS',
    };
    const previewCopyIntegrity = vi.fn(async () => ({
      ok: true as const,
      value: {
        expiresAt: '2026-08-01T15:06:00.000Z',
        preview: {
          costState: 'NOT_APPLICABLE' as const,
          externalRequestCount: 0 as const,
          readModel,
          writes: [
            'APPEND_DUPLICATION_QUALITY_CHECK',
            'APPEND_TITLE_BODY_CONSISTENCY_QUALITY_CHECK',
          ] as const,
        },
        previewHash: 'd'.repeat(64),
        token: 'e'.repeat(43),
      },
    }));
    const confirmCopyIntegrity = vi.fn(async () => ({
      ok: true as const,
      value: {
        readModel: {
          ...readModel,
          checks: [
            { ...readModel.checks[0], savedStatus: 'REVIEW_REQUIRED' as const },
            { ...readModel.checks[1], savedStatus: 'PASS' as const },
          ] as const,
        },
      },
    }));
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        confirmCopyIntegrity,
        getBriefs: vi.fn(async () => ({
          ok: true,
          value: { counts: {} as never, items: [], limit: 100, offset: 0, total: 0 },
        })),
        getCopyDraft: vi.fn(async () => ({ ok: true, value: current.detail })),
        getCopyDrafts: vi.fn(async () => ({ ok: true, value: current.list })),
        previewCopyIntegrity,
      } as unknown as DesktopBridge,
    });

    render(<CopyWorkbench />);
    (await screen.findByRole('button', { name: /NON_SPOILER_SINGLE_BOOK_VERDICT/iu })).click();
    const card = await screen.findByRole('region', { name: 'Copy Integrity 确定性子集' });
    expect(within(card).getByText(/INTERNAL_CONSISTENCY/u)).toHaveTextContent('NOT_RUN');
    expect(card).toHaveTextContent('不判断语义');
    expect(screen.getAllByRole('region', { name: 'Copy Integrity 确定性子集' })).toHaveLength(1);
    within(card).getByRole('button', { name: '预览 Copy Integrity' }).click();

    await waitFor(() => expect(previewCopyIntegrity).toHaveBeenCalledTimes(1));
    expect(previewCopyIntegrity).toHaveBeenCalledWith({
      draftId: current.detail.draftId,
      expectedRevision: current.detail.revision,
    });
    await waitFor(() => expect(card).toHaveTextContent('HISTORICAL_OVERLAP_CANDIDATE'));
    expect(within(card).queryByRole('button', { name: /改写|审批|导出|发布/u })).toBeNull();
    within(card).getByRole('button', { name: '确认保存两类摘要' }).click();

    await waitFor(() => expect(confirmCopyIntegrity).toHaveBeenCalledTimes(1));
    expect(confirmCopyIntegrity).toHaveBeenCalledWith({
      confirmation: 'SAVE_COPY_INTEGRITY_CHECKS',
      expectedRevision: 5,
      previewHash: 'd'.repeat(64),
      token: 'e'.repeat(43),
    });
    expect(card).toHaveTextContent('已保存 REVIEW_REQUIRED');
    expect(card).toHaveTextContent('不代表质量通过或可发布');
    expect(card).not.toHaveTextContent(/整稿质量已通过|可以发布|已可发布/u);
  });
});
