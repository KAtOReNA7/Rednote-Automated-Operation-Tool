// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CopyWorkbench } from '../apps/web-ui/src/copy-workbench.js';
import { evaluateQualityReadiness } from '../packages/quality/src/index.js';
import type {
  CopyDraftDetailView,
  CopyDraftListView,
  DesktopBridge,
} from '../packages/shared/src/index.js';
import { completeCopyPayload } from './support/copy-fixtures.js';

function fixture(): { readonly detail: CopyDraftDetailView; readonly list: CopyDraftListView } {
  const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
  const qualityReadiness = evaluateQualityReadiness({
    draft: {
      draftId: 'draft-quality-renderer',
      revision: 6,
      status: 'READY_FOR_QUALITY_PIPELINE',
      versionId: 'draft-quality-version-6',
    },
    fullSpoilerReviewRequired: false,
    sources: [
      {
        capability: 'AVAILABLE',
        checkType: 'STRUCTURED_OUTPUT',
        reason: 'CURRENT_STRUCTURE_VALID',
        status: 'PASS',
      },
      ...(
        [
          'FACT_MAPPING',
          'READING_AUTHENTICITY',
          'SPOILER',
          'DUPLICATION',
          'TITLE_BODY_CONSISTENCY',
        ] as const
      ).map((checkType) => ({
        capability: 'AVAILABLE' as const,
        checkType,
        reason: 'SAVED_EXACT_CURRENT' as const,
        status: 'PASS' as const,
      })),
      {
        capability: 'DEFERRED_029B',
        checkType: 'INTERNAL_CONSISTENCY',
        reason: 'DEFERRED_029B',
        status: 'NOT_RUN',
      },
    ],
  });
  const detail: CopyDraftDetailView = {
    briefId: payload.brief.briefId,
    draftId: 'draft-quality-renderer',
    invalidationReasons: [],
    payload,
    profileId: payload.profileId,
    qualityReadiness,
    revision: 6,
    runs: [],
    state: 'ACTIVE',
    status: 'READY_FOR_QUALITY_PIPELINE',
    updatedAt: '2026-08-01T17:00:00.000Z',
    validation: {
      evaluatedAt: '2026-08-01T17:00:00.000Z',
      policyVersion: 'draft-structural-validation-v1',
      reasonCodes: [],
      valid: true,
    },
    versionHistory: {
      items: [
        {
          changeKinds: ['USER_EDIT'],
          createdAt: '2026-08-01T17:00:00.000Z',
          isCurrent: true,
          sourceKind: 'MANUAL',
          status: 'READY_FOR_QUALITY_PIPELINE',
          versionId: 'draft-quality-version-6',
          versionNumber: 6,
        },
      ],
      limit: 20,
      offset: 0,
      total: 1,
    },
    versionNumber: 6,
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
      items: [detail],
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

describe('M3 Issue 030 Copy Workbench quality readiness card', () => {
  it('shows seven honest saved-state rows and only offers a read refresh', async () => {
    const current = fixture();
    const getCopyDraft = vi.fn(async () => ({ ok: true as const, value: current.detail }));
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getBriefs: vi.fn(async () => ({
          ok: true,
          value: { counts: {} as never, items: [], limit: 100, offset: 0, total: 0 },
        })),
        getCopyDraft,
        getCopyDrafts: vi.fn(async () => ({ ok: true, value: current.list })),
      } as unknown as DesktopBridge,
    });

    render(<CopyWorkbench />);
    (await screen.findByRole('button', { name: /NON_SPOILER_SINGLE_BOOK_VERDICT/iu })).click();
    const card = await screen.findByRole('region', { name: '质量就绪总览' });
    expect(card).toHaveTextContent('需要重点人工复核');
    expect(card).toHaveTextContent('FOCUSED_CANDIDATE');
    expect(within(card).getAllByRole('listitem')).toHaveLength(7);
    expect(card).toHaveTextContent('INTERNAL_CONSISTENCY · NOT_RUN');
    expect(card).toHaveTextContent('029B 保持 DEFERRED');
    expect(
      within(card).queryByRole('button', { name: /审批|跳过|导出|发布|一键通过/u }),
    ).toBeNull();
    expect(card).not.toHaveTextContent(/已审批|全部质量通过|可导出|可发布/u);

    within(card).getByRole('button', { name: '刷新质量总览' }).click();
    await waitFor(() => expect(getCopyDraft).toHaveBeenCalledTimes(2));
  });
});
