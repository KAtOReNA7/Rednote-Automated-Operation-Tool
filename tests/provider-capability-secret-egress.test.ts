import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const root = resolve(import.meta.dirname, '..');

function source(path: string): Buffer {
  return readFileSync(resolve(root, path));
}

async function terminal(runtime: ProviderCapabilityRuntime, runId: string): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (runtime.getProgress(runId).status !== 'RUNNING') {
      return;
    }
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 10));
  }
  throw new Error('Capability egress fixture did not finish.');
}

afterEach(cleanTemporaryDatabases);

describe('Issue 013 exact 50-target capability secret egress matrix', () => {
  it('keeps a runtime-random synthetic credential out of every non-transport target', async () => {
    const secret = syntheticInvalidCredential();
    const fixture = await startCapabilityProbeFixture({ expectedCredential: secret });
    const { database, databasePath } = await createInitializedDatabase('capability egress');
    database
      .prepare(
        `UPDATE app_settings
         SET provider_base_url = ?, credential_reference = 'CONTENT_AI_API_KEY',
             research_model_id = 'egress-model', writing_model_id = 'egress-model',
             review_model_id = 'egress-model', image_model_id = 'egress-image',
             setup_state = 'PROVIDER_CONFIGURED_UNVERIFIED',
             credential_binding_version = 1, revision = revision + 1,
             updated_at = '2026-07-28T00:00:00.000Z'
         WHERE id = 'app'`,
      )
      .run(fixture.baseUrl);
    const settings = new SqliteSettingsRepository(database);
    const runtime = new ProviderCapabilityRuntime(
      new SqliteProviderCapabilityRepository(database),
      () => settings.getBundle().settings,
      async () => secret,
    );
    runtime.initialize();
    try {
      const preview = runtime.preview(
        { includeToolCalling: false, profile: 'CORE', selectedCapabilities: [] },
        41,
        42,
      );
      const started = await runtime.start(
        {
          confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
          credentialBindingVersion: preview.credentialBindingVersion,
          planHash: preview.planHash,
          settingsRevision: preview.settingsRevision,
          startToken: preview.startToken,
        },
        41,
        42,
      );
      await terminal(runtime, started.runId);
      const progress = runtime.getProgress(started.runId);
      const state = runtime.getState();
      database.exec('PRAGMA wal_checkpoint(PASSIVE)');

      const query = (sql: string): Buffer =>
        Buffer.from(JSON.stringify(database.prepare(sql).all()), 'utf8');
      const targets = [
        ['database file', readFileSync(databasePath)],
        ['database WAL', readFileSync(`${databasePath}-wal`)],
        ['database SHM', readFileSync(`${databasePath}-shm`)],
        ['probe runs rows', query('SELECT * FROM provider_capability_probe_runs')],
        ['probe entries rows', query('SELECT * FROM provider_capability_entries')],
        ['schema migrations rows', query('SELECT * FROM schema_migrations')],
        ['app settings rows', query('SELECT * FROM app_settings')],
        ['audit rows', query('SELECT * FROM audit_events')],
        ['job payload rows', query('SELECT payload_json FROM jobs')],
        ['job result rows', query('SELECT result_json FROM jobs')],
        ['job error rows', query('SELECT last_error FROM jobs')],
        ['model run rows', query('SELECT * FROM model_runs')],
        ['cost ledger rows', query('SELECT * FROM cost_ledger')],
        ['source rows', query('SELECT * FROM sources')],
        ['post package rows', query('SELECT * FROM post_packages')],
        ['preview DTO', Buffer.from(JSON.stringify(preview))],
        ['start DTO', Buffer.from(JSON.stringify(started))],
        ['progress DTO', Buffer.from(JSON.stringify(progress))],
        ['state DTO', Buffer.from(JSON.stringify(state))],
        ['history DTO', Buffer.from(JSON.stringify(state.history))],
        ['entries DTO', Buffer.from(JSON.stringify(state.entries))],
        ['safe error DTO', Buffer.from(JSON.stringify({ code: 'PROBE_STALE' }))],
        ['diagnostic summary', Buffer.from(JSON.stringify({ capability: state.derivedState }))],
        [
          'audit summary',
          Buffer.from(JSON.stringify({ completed: 1, sent: progress.sentRequestCount })),
        ],
        ['renderer component source', source('apps/web-ui/src/provider-capability-settings.tsx')],
        ['settings page source', source('apps/web-ui/src/settings-page.tsx')],
        ['preload source', source('apps/desktop/src/preload.ts')],
        ['IPC source', source('apps/desktop/src/ipc.ts')],
        ['IPC policy source', source('apps/desktop/src/ipc-policy.ts')],
        ['desktop runtime source', source('apps/desktop/src/provider-capability-runtime.ts')],
        [
          'provider contracts source',
          source('packages/providers/src/capability-probe-contracts.ts'),
        ],
        ['provider planner source', source('packages/providers/src/capability-probe-plan.ts')],
        [
          'provider classifier source',
          source('packages/providers/src/capability-probe-classifier.ts'),
        ],
        ['provider payload source', source('packages/providers/src/capability-probe-payloads.ts')],
        ['provider runner source', source('packages/providers/src/capability-probe-runner.ts')],
        [
          'provider transport source',
          source('packages/providers/src/capability-probe-transport.ts'),
        ],
        ['provider guard source', source('packages/providers/src/capability-guard.ts')],
        ['DB repository source', source('packages/db/src/provider-capability-repository.ts')],
        ['migration source', source('packages/db/src/migrations.ts')],
        ['shared DTO source', source('packages/shared/src/desktop-api.ts')],
        ['package manifest', source('package.json')],
        ['lockfile', source('package-lock.json')],
        ['CI workflow', source('.github/workflows/ci.yml')],
        ['implementation plan', source('docs/m2-issue013-implementation-plan.md')],
        ['acceptance map', source('docs/m2-issue013-acceptance-map.md')],
        ['ADR', source('docs/adr/0009-provider-capability-probing.md')],
        ['capability contract', source('docs/contracts/provider-capabilities-v1.md')],
        ['source smoke script', source('scripts/run-electron-smoke.mjs')],
        ['packaged smoke script', source('scripts/run-packaged-smoke.mjs')],
        ['smoke fixture source', source('scripts/issue013-capability-smoke-fixture.mjs')],
      ] as const;

      expect(targets).toHaveLength(50);
      expect(new Set(targets.map(([name]) => name)).size).toBe(50);
      const encoded = Buffer.from(secret, 'utf8');
      expect(
        targets.filter(([, content]) => content.indexOf(encoded) >= 0).map(([name]) => name),
      ).toEqual([]);
      expect(fixture.requests.every((request) => request.authorizationPresent)).toBe(true);
    } finally {
      await runtime.close();
      database.close();
      await fixture.close();
    }
  });
});
