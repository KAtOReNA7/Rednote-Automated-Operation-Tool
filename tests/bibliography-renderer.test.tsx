// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LibraryPage } from '../apps/web-ui/src/library-page.js';
import type {
  CatalogDiscoveryPreview,
  CatalogSummaryView,
  DesktopBridge,
} from '../packages/shared/src/index.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteDesktop');
});

const summary: CatalogSummaryView = {
  counts: {
    editions: 3,
    expressions: 2,
    observations: 4,
    openReviewCases: 1,
    works: 1,
  },
  coverage: [
    {
      conflictCount: 1,
      editionCount: 3,
      exactLinkCount: 1,
      expressionCount: 2,
      gapReason: 'TARGET_NOT_REACHED',
      invalidIdentifierCount: 1,
      label: '日本推理',
      manualDecisionCount: 0,
      observationCount: 4,
      plannedObservations: 5,
      postResolutionCount: 2,
      preResolutionCount: 4,
      provenanceCompleteCount: 4,
      rejectedCount: 0,
      required: true,
      reviewCount: 1,
      stratumId: 'japan-mystery',
      synthetic: true,
      unresolvedCount: 1,
      workCount: 1,
    },
  ],
  latestRun: {
    executionId: 'execution-ui',
    externalRequestCount: 0,
    jobId: 'job-ui',
    planId: 'plan-ui',
    revision: 4,
    runId: 'run-ui',
    status: 'COMPLETED_WITH_GAPS',
    synthetic: true,
  },
  reviewCases: [
    {
      candidateEntityId: 'work-ui',
      caseId: 'case-ui',
      entityType: 'WORK',
      observationId: 'observation-ui',
      outcome: 'PROBABLE_REVIEW',
      revision: 1,
    },
  ],
  synthetic: true,
  works: [
    {
      canonicalTitle: '<img src=x onerror=alert(1)>',
      editionCount: 3,
      expressionCount: 2,
      revision: 1,
      state: 'ACTIVE',
      workId: 'work-ui',
    },
  ],
};

const discoveryPreview: CatalogDiscoveryPreview = {
  expiresAt: '2026-07-29T00:05:00.000Z',
  originCount: 4,
  planHash: 'a'.repeat(64),
  previewHash: 'b'.repeat(64),
  profile: {
    profileId: 'profile-ui',
    strata: [
      {
        label: '日本推理',
        required: true,
        stratumId: 'japan-mystery',
        targetObservations: 1,
      },
    ],
    synthetic: false,
  },
  run: {
    executionId: null,
    externalRequestCount: 0,
    jobId: null,
    planId: 'plan-ui-preview',
    revision: 1,
    runId: 'run-ui-preview',
    status: 'PREVIEWED',
    synthetic: false,
  },
  token: 'a'.repeat(43),
};

describe('Issue 018 Library renderer', () => {
  it('shows real counts, explicit synthetic/gap/review state and treats fields as text', async () => {
    const bridge = {
      getCatalogState: vi.fn().mockResolvedValue({ ok: true, value: summary }),
      getCatalogWork: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          ...summary.works[0],
          aliases: [{ kind: 'TRANSLATED', normalized: 'alias', raw: '<script>alias</script>' }],
          expressions: [
            {
              editions: [
                {
                  editionId: 'edition-ui',
                  identifiers: [{ namespace: 'ISBN_13', value: '9780306406157' }],
                  label: '合成版',
                  publisher: '合成出版社',
                  state: 'ACTIVE',
                },
              ],
              expressionId: 'expression-ui',
              kind: 'TRANSLATION',
              language: 'zh-CN',
              state: 'ACTIVE',
              title: '合成译文',
            },
          ],
          observationIds: ['observation-ui'],
          observations: [
            {
              factStatus: 'NOT_A_FACT',
              fieldProvenanceCount: 1,
              observationId: 'observation-ui',
              originKind: 'SYNTHETIC_FIXTURE',
              truthStatus: 'UNVERIFIED',
            },
          ],
          publicationRelationships: [],
          relations: [],
        },
      }),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    const { container } = render(<LibraryPage />);

    expect(await screen.findByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('TARGET_NOT_REACHED')).toBeInTheDocument();
    expect(screen.getAllByText(/SYNTHETIC/u).length).toBeGreaterThan(0);
    expect(screen.getByText('PROBABLE_REVIEW')).toBeInTheDocument();
    expect(screen.getByText(/出版关系都不参与门禁/u)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();

    await userEvent.click(screen.getByText('<img src=x onerror=alert(1)>'));
    expect(await screen.findByText(/<script>alias<\/script>/u)).toBeInTheDocument();
    expect(screen.getByText(/UNVERIFIED\/NOT_A_FACT/u)).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(document.body.textContent).not.toMatch(/[A-Z]:\\|SELECT .* FROM/iu);
  });

  it('requires preview then explicit confirmation before starting a local run', async () => {
    const preview = vi.fn().mockResolvedValue({ ok: true, value: discoveryPreview });
    const confirm = vi.fn().mockResolvedValue({
      ok: true,
      value: { ...discoveryPreview.run, status: 'CONFIRMED' },
    });
    const bridge = {
      confirmCatalogDiscovery: confirm,
      getCatalogState: vi.fn().mockResolvedValue({
        ok: true,
        value: { ...summary, latestRun: null, synthetic: false },
      }),
      previewCatalogDiscovery: preview,
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    render(<LibraryPage />);
    await screen.findByText('<img src=x onerror=alert(1)>');

    await userEvent.click(screen.getByRole('button', { name: '预览发现计划' }));
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        maxObservations: 500,
        originKinds: ['SEARCH_CANDIDATE', 'FETCH_DOCUMENT', 'BROWSER_CLIP_CANDIDATE'],
      }),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByText('4 条本地候选')).toBeInTheDocument();
    expect(screen.getByText(/外部请求估算：0/u)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: '确认进入本地队列' }));
    await waitFor(() => {
      expect(confirm).toHaveBeenCalledWith({
        confirmation: 'START_BIBLIOGRAPHY_DISCOVERY',
        expectedRevision: 1,
        previewHash: 'b'.repeat(64),
        token: 'a'.repeat(43),
      });
    });
  });
});
