// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ExperimentManagementPage } from '../apps/web-ui/src/experiment-management-page.js';
import type {
  DesktopBridge,
  ExperimentActionPreview,
  ExperimentDetailView,
  ExperimentListView,
} from '../packages/shared/src/index.js';
import { experimentDraft } from './support/experiment-fixtures.js';

const NOW = '2026-07-30T10:00:00.000Z';
const design = experimentDraft(3);

function detail(overrides: Partial<ExperimentDetailView> = {}): ExperimentDetailView {
  return {
    assignment: {
      armCounts: { control: 2, treatment: 1 },
      assignmentHash: 'a'.repeat(64),
      distinctWorkCount: 3,
      imbalanceByStratum: { HOT: 1, WARM: 0 },
      shortfallByArm: { control: 0, treatment: 0 },
      status: 'READY_TO_LOCK',
      strataCounts: { COLD: 0, HOT: 2, UNKNOWN: 0, WARM: 1 },
      unitCount: 3,
    },
    assignmentStatus: 'READY_TO_LOCK',
    design,
    designVersionId: 'experiment-design-ui-v1',
    experimentId: 'experiment-ui',
    history: [
      {
        action: 'ASSIGNMENT_READY',
        createdAt: NOW,
        from: 'DRAFT',
        revision: 2,
        to: 'ASSIGNMENT_READY',
      },
      {
        action: 'CREATE',
        createdAt: NOW,
        from: null,
        revision: 1,
        to: 'DRAFT',
      },
    ],
    historyPage: { limit: 24, offset: 0, total: 2 },
    invalidationReasons: [],
    lockedMeansExecution: false,
    name: '合成单变量内容结构实验',
    primaryMetricId: 'SAVE_RATE',
    primaryVariableKind: 'CONTENT_STRUCTURE',
    resultAvailability: 'NOT_EXECUTED_NO_EFFECT_CONCLUSION',
    revision: 2,
    stale: false,
    state: 'ASSIGNMENT_READY',
    updatedAt: NOW,
    versionHistory: {
      items: [
        {
          changeKinds: ['INITIAL_DESIGN'],
          createdAt: NOW,
          designHash: 'd'.repeat(64),
          designVersionId: 'experiment-design-ui-v1',
          isCurrent: true,
          name: '合成单变量内容结构实验',
          previousVersionId: null,
          primaryMetricId: 'SAVE_RATE',
          primaryVariableKind: 'CONTENT_STRUCTURE',
          versionNumber: 1,
        },
      ],
      limit: 24,
      offset: 0,
      total: 1,
    },
    versionNumber: 1,
    ...overrides,
  };
}

function workspace(item = detail()): ExperimentListView {
  return {
    items: [
      {
        assignmentStatus: item.assignmentStatus,
        experimentId: item.experimentId,
        name: item.name,
        primaryMetricId: item.primaryMetricId,
        primaryVariableKind: item.primaryVariableKind,
        revision: item.revision,
        stale: item.stale,
        state: item.state,
        updatedAt: item.updatedAt,
        versionNumber: item.versionNumber,
      },
    ],
    limit: 24,
    offset: 0,
    profileId: 'primary',
    total: 1,
  };
}

const assignmentPreview: ExperimentActionPreview = {
  expiresAt: '2026-07-30T10:05:00.000Z',
  kind: 'SAVE_ASSIGNMENT',
  preview: {
    armCounts: { control: 2, treatment: 1 },
    assignmentHash: 'a'.repeat(64),
    distinctWorkCount: 3,
    expectedRevision: 2,
    imbalanceByStratum: { HOT: 1, WARM: 0 },
    kind: 'SAVE_ASSIGNMENT',
    reasonCodes: ['ASSIGNMENT_BALANCED', 'REPLICATION_READY', 'NO_EFFECT_CONCLUSION'],
    shortfallByArm: { control: 0, treatment: 0 },
    status: 'READY_TO_LOCK',
    unitPage: { limit: 3, offset: 0, total: 3, truncated: false },
    units: [
      {
        armId: 'control',
        popularityStratum: 'HOT',
        topicId: 'experiment-topic-1',
        workId: 'experiment-work-1',
      },
      {
        armId: 'treatment',
        popularityStratum: 'HOT',
        topicId: 'experiment-topic-2',
        workId: 'experiment-work-2',
      },
      {
        armId: 'control',
        popularityStratum: 'WARM',
        topicId: 'experiment-topic-3',
        workId: 'experiment-work-3',
      },
    ],
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

describe('M3 Issue 023 experiment management renderer', () => {
  it('shows the single-variable contract, hypothesis, strata, balance, history, and explicit no-result state', async () => {
    const current = detail();
    const getExperiments = vi.fn().mockResolvedValue({ ok: true, value: workspace(current) });
    const getExperiment = vi.fn().mockResolvedValue({ ok: true, value: current });
    const previewExperimentAction = vi.fn().mockResolvedValue({
      ok: true,
      value: assignmentPreview,
    });
    const confirmExperimentAction = vi.fn().mockResolvedValue({
      ok: true,
      value: { detail: current, kind: 'SAVE_ASSIGNMENT' },
    });
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        confirmExperimentAction,
        getExperiment,
        getExperiments,
        previewExperimentAction,
      } as unknown as DesktopBridge,
    });
    const user = userEvent.setup();
    render(<ExperimentManagementPage />);

    expect(await screen.findByText('合成单变量内容结构实验')).toBeInTheDocument();
    expect(screen.getByText(/精确一个 primary variable/iu)).toBeInTheDocument();
    expect(screen.getByText(/无效果结论 · 无 winner/iu)).toBeInTheDocument();
    expect(screen.getByText(/UNKNOWN ≠ COLD/iu)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /合成单变量内容结构实验/iu }));
    expect(await screen.findByText('Falsifiable hypothesis')).toBeInTheDocument();
    expect(screen.getByText('Control / Treatment')).toBeInTheDocument();
    expect(screen.getByText('Controlled conditions')).toBeInTheDocument();
    expect(screen.getByText('Popularity strata snapshots')).toBeInTheDocument();
    expect(screen.getByText(/热度仅作分层/iu)).toBeInTheDocument();
    expect(screen.getByText('Assignment plan')).toBeInTheDocument();
    expect(screen.getByText('Immutable design versions & diff')).toBeInTheDocument();
    expect(screen.getByText('State transition history')).toBeInTheDocument();
    expect(screen.getByText(/Controlled-condition diff：PASS/iu)).toBeInTheDocument();
    expect(screen.getAllByText('尚未执行').length).toBeGreaterThan(0);
    expect(screen.getAllByText('READY_TO_LOCK').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '预览确定性分配' }));
    await waitFor(() =>
      expect(previewExperimentAction).toHaveBeenCalledWith({
        experimentId: current.experimentId,
        kind: 'SAVE_ASSIGNMENT',
      }),
    );
    expect(await screen.findByText('确认前预览 · SAVE_ASSIGNMENT')).toBeInTheDocument();
    expect(confirmExperimentAction).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '确认本次本地操作' }));
    expect(confirmExperimentAction).toHaveBeenCalledWith({
      confirmation: 'APPLY_EXPERIMENT_ACTION',
      kind: 'SAVE_ASSIGNMENT',
      previewHash: assignmentPreview.previewHash,
      token: assignmentPreview.token,
    });
  });

  it('renders stale and empty states without claiming automatic reassignment', async () => {
    const currentAssignment = detail().assignment;
    if (currentAssignment === null) throw new Error('Missing synthetic assignment.');
    const stale = detail({
      assignment: {
        ...currentAssignment,
        status: 'STALE',
      },
      assignmentStatus: 'STALE',
      invalidationReasons: ['TOPIC_CHANGED'],
      stale: true,
      state: 'STALE',
    });
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getExperiment: vi.fn().mockResolvedValue({ ok: true, value: stale }),
        getExperiments: vi.fn().mockResolvedValue({ ok: true, value: workspace(stale) }),
      } as unknown as DesktopBridge,
    });
    const user = userEvent.setup();
    const rendered = render(<ExperimentManagementPage />);
    await user.click(await screen.findByRole('button', { name: /合成单变量内容结构实验/iu }));
    expect(await screen.findByText(/系统不会自动重排或解锁/iu)).toBeInTheDocument();
    expect(screen.getByText('TOPIC_CHANGED')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'LOCK' })).not.toBeInTheDocument();

    rendered.unmount();
    Object.defineProperty(window, 'rednoteDesktop', {
      configurable: true,
      value: {
        getExperiments: vi.fn().mockResolvedValue({
          ok: true,
          value: { ...workspace(), items: [], total: 0 },
        }),
      } as unknown as DesktopBridge,
    });
    render(<ExperimentManagementPage />);
    expect(await screen.findByText('还没有实验')).toBeInTheDocument();
  });
});
