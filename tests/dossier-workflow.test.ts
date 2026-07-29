import { describe, expect, it, vi } from 'vitest';

import {
  DossierBuildService,
  createDossierBuildJobHandler,
} from '../packages/workflows/src/index.js';

const payload = {
  dossierId: 'dossier-workflow',
  executionId: 'execution-workflow',
  expectedDossierRevision: 2,
  inputHash: 'a'.repeat(64),
  planHash: 'b'.repeat(64),
  planId: 'plan-workflow',
  subjectId: 'work-workflow',
  subjectType: 'WORK' as const,
};

describe('DOSSIER_BUILD_V1 workflow', () => {
  it('runs locally with zero external requests and reuses execution identity', async () => {
    const executeBuild = vi.fn((payloadValue: unknown) => {
      expect(payloadValue).toEqual(payload);
      return {
        noOp: false,
        run: { runId: 'run-workflow' },
        versionId: 'version-workflow',
      };
    });
    const service = new DossierBuildService({
      now: () => '2026-07-29T04:00:00.000Z',
      persistence: {
        cancelExecution: vi.fn(),
        executeBuild: executeBuild as never,
        failBuild: vi.fn(),
      },
    });
    await expect(service.execute(payload, async () => 'CONTINUE')).resolves.toEqual({
      costState: 'NOT_INCURRED',
      externalRequestCount: 0,
      noOp: false,
      runId: 'run-workflow',
      status: 'SUCCEEDED',
      versionId: 'version-workflow',
    });
    expect(executeBuild).toHaveBeenCalledTimes(1);
    expect(executeBuild.mock.calls[0]?.[0]).toEqual(payload);
  });

  it('cooperates with pause and cancel before local publish', async () => {
    const executeBuild = vi.fn();
    const cancelExecution = vi.fn(() => ({ runId: 'run-cancelled' }));
    const service = new DossierBuildService({
      now: () => '2026-07-29T04:00:00.000Z',
      persistence: {
        cancelExecution,
        executeBuild: executeBuild as never,
        failBuild: vi.fn(),
      },
    });
    await expect(service.execute(payload, async () => 'PAUSE')).resolves.toMatchObject({
      status: 'PAUSED',
    });
    await expect(service.execute(payload, async () => 'CANCEL')).resolves.toEqual({
      costState: 'NOT_INCURRED',
      externalRequestCount: 0,
      noOp: false,
      runId: 'run-cancelled',
      status: 'CANCELLED',
      versionId: null,
    });
    expect(executeBuild).not.toHaveBeenCalled();
    expect(cancelExecution).toHaveBeenCalledWith('execution-workflow', '2026-07-29T04:00:00.000Z');
  });

  it('registers a narrow handler and sanitizes dossier errors', async () => {
    const service = new DossierBuildService({
      persistence: {
        cancelExecution: vi.fn(),
        executeBuild: vi.fn(() => {
          throw new Error('unexpected internal detail');
        }) as never,
        failBuild: vi.fn(),
      },
    });
    const handler = createDossierBuildJobHandler(service);
    await expect(
      handler(payload, {
        heartbeat: async () => 'CONTINUE',
        job: {} as never,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow('unexpected internal detail');
    await expect(
      handler(
        { ...payload, excerpt: 'forbidden' },
        {
          heartbeat: async () => 'CONTINUE',
          job: {} as never,
          signal: new AbortController().signal,
        },
      ),
    ).rejects.toMatchObject({ code: 'DOSSIER_INVALID_REQUEST' });
  });
});
