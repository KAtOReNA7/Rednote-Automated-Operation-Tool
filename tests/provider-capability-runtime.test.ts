import { afterEach, describe, expect, it } from 'vitest';

import {
  SqliteProviderCapabilityRepository,
  SqliteSettingsRepository,
} from '../packages/db/src/index.js';
import { ProviderCapabilityRuntime } from '../apps/desktop/src/provider-capability-runtime.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  startCapabilityProbeFixture,
  syntheticInvalidCredential,
} from './support/capability-probe-fixture.js';

afterEach(cleanTemporaryDatabases);

async function waitForTerminal(
  runtime: ProviderCapabilityRuntime,
  runId: string,
): Promise<ReturnType<ProviderCapabilityRuntime['getProgress']>> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    const progress = runtime.getProgress(runId);
    if (progress.status !== 'RUNNING') {
      return progress;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Capability probe did not reach a terminal state.');
}

function configure(
  database: Awaited<ReturnType<typeof createInitializedDatabase>>['database'],
  baseUrl: string,
): void {
  database
    .prepare(
      `UPDATE app_settings
       SET provider_base_url = ?, credential_reference = 'CONTENT_AI_API_KEY',
           research_model_id = 'fixture-model',
           writing_model_id = 'fixture-model',
           review_model_id = 'fixture-model',
           image_model_id = 'fixture-image',
           setup_state = 'PROVIDER_CONFIGURED_UNVERIFIED',
           credential_binding_version = 1,
           revision = revision + 1,
           updated_at = '2026-07-28T00:00:00.000Z'
       WHERE id = 'app'`,
    )
    .run(baseUrl);
}

describe('Issue 013 main-process capability runtime', () => {
  it('does no automatic egress, consumes one bound token, and persists a safe current matrix', async () => {
    const credential = syntheticInvalidCredential();
    const fixture = await startCapabilityProbeFixture({ expectedCredential: credential });
    const { database } = await createInitializedDatabase();
    configure(database, fixture.baseUrl);
    const settings = new SqliteSettingsRepository(database);
    const runtime = new ProviderCapabilityRuntime(
      new SqliteProviderCapabilityRepository(database),
      () => settings.getBundle().settings,
      async () => credential,
    );
    runtime.initialize();
    try {
      expect(fixture.requests).toHaveLength(0);
      const preview = runtime.preview(
        { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
        71,
        81,
      );
      expect(fixture.requests).toHaveLength(0);
      expect(preview).toMatchObject({
        feeEstimate: 'UNKNOWN',
        profile: 'CORE',
        settingsRevision: 1,
      });

      const progress = await runtime.start(
        {
          confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
          credentialBindingVersion: preview.credentialBindingVersion,
          planHash: preview.planHash,
          settingsRevision: preview.settingsRevision,
          startToken: preview.startToken,
        },
        71,
        81,
      );
      expect((await waitForTerminal(runtime, progress.runId)).status).toBe('SUCCEEDED');
      expect(fixture.requests).toHaveLength(preview.requestCount);

      const state = runtime.getState();
      expect(state.derivedState).toBe('PROBE_COMPLETE');
      expect(state.entries.some((entry) => entry.capability === 'text')).toBe(true);
      const serialized = JSON.stringify(state);
      expect(serialized).not.toContain(fixture.baseUrl);
      expect(state.entries.some((entry) => entry.modelId === 'fixture-model')).toBe(true);
      expect(serialized).not.toContain(credential);

      await expect(
        runtime.start(
          {
            confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
            credentialBindingVersion: preview.credentialBindingVersion,
            planHash: preview.planHash,
            settingsRevision: preview.settingsRevision,
            startToken: preview.startToken,
          },
          71,
          81,
        ),
      ).rejects.toMatchObject({ code: 'PROBE_INVALID_REQUEST' });
    } finally {
      await runtime.close();
      database.close();
      await fixture.close();
    }
  });

  it('invalidates a preview after configuration changes before resolving credentials', async () => {
    const { database } = await createInitializedDatabase();
    configure(database, 'http://127.0.0.1:43119/v1');
    const settings = new SqliteSettingsRepository(database);
    let credentialResolveCount = 0;
    const runtime = new ProviderCapabilityRuntime(
      new SqliteProviderCapabilityRepository(database),
      () => settings.getBundle().settings,
      async () => {
        credentialResolveCount += 1;
        return syntheticInvalidCredential();
      },
    );
    runtime.initialize();
    try {
      const preview = runtime.preview(
        { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
        1,
        2,
      );
      database
        .prepare(
          `UPDATE app_settings
           SET provider_base_url = 'http://127.0.0.1:43120/v1',
               revision = revision + 1,
               updated_at = '2026-07-28T00:00:01.000Z'
           WHERE id = 'app'`,
        )
        .run();
      await expect(
        runtime.start(
          {
            confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
            credentialBindingVersion: preview.credentialBindingVersion,
            planHash: preview.planHash,
            settingsRevision: preview.settingsRevision,
            startToken: preview.startToken,
          },
          1,
          2,
        ),
      ).rejects.toMatchObject({ code: 'PROBE_STALE' });
      expect(credentialResolveCount).toBe(0);
    } finally {
      await runtime.close();
      database.close();
    }
  });

  it('enforces one app-wide run and cancel aborts all remaining steps', async () => {
    const credential = syntheticInvalidCredential();
    const fixture = await startCapabilityProbeFixture({
      delayMilliseconds: 250,
      expectedCredential: credential,
    });
    const { database } = await createInitializedDatabase();
    configure(database, fixture.baseUrl);
    const settings = new SqliteSettingsRepository(database);
    const runtime = new ProviderCapabilityRuntime(
      new SqliteProviderCapabilityRepository(database),
      () => settings.getBundle().settings,
      async () => credential,
    );
    runtime.initialize();
    try {
      const first = runtime.preview(
        { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
        3,
        4,
      );
      const second = runtime.preview(
        { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
        3,
        4,
      );
      const running = await runtime.start(
        {
          confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
          credentialBindingVersion: first.credentialBindingVersion,
          planHash: first.planHash,
          settingsRevision: first.settingsRevision,
          startToken: first.startToken,
        },
        3,
        4,
      );
      await expect(
        runtime.start(
          {
            confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
            credentialBindingVersion: second.credentialBindingVersion,
            planHash: second.planHash,
            settingsRevision: second.settingsRevision,
            startToken: second.startToken,
          },
          3,
          4,
        ),
      ).rejects.toMatchObject({ code: 'PROBE_ALREADY_RUNNING' });

      runtime.cancel({
        confirmation: 'CANCEL_PROVIDER_CAPABILITY_PROBE',
        runId: running.runId,
      });
      const terminal = await waitForTerminal(runtime, running.runId);
      expect(terminal.status).toBe('CANCELLED');
      expect(fixture.requests.length).toBeLessThanOrEqual(1);
    } finally {
      await runtime.close();
      database.close();
      await fixture.close();
    }
  });

  it('invalidates leases owned by a closed window', async () => {
    const { database } = await createInitializedDatabase();
    configure(database, 'http://127.0.0.1:43119/v1');
    const settings = new SqliteSettingsRepository(database);
    const runtime = new ProviderCapabilityRuntime(
      new SqliteProviderCapabilityRepository(database),
      () => settings.getBundle().settings,
      async () => syntheticInvalidCredential(),
    );
    runtime.initialize();
    try {
      const preview = runtime.preview(
        { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
        8,
        9,
      );
      runtime.clearWindow(9);
      await expect(
        runtime.start(
          {
            confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
            credentialBindingVersion: preview.credentialBindingVersion,
            planHash: preview.planHash,
            settingsRevision: preview.settingsRevision,
            startToken: preview.startToken,
          },
          8,
          9,
        ),
      ).rejects.toMatchObject({ code: 'PROBE_INVALID_REQUEST' });
    } finally {
      await runtime.close();
      database.close();
    }
  });
});
