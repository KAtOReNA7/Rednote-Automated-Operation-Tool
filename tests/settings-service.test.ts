import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CREDENTIAL_CLEAR_CONFIRMATION,
  SettingsError,
  SettingsService,
  normalizeModelId,
  normalizeProviderBaseUrl,
  parseDollarsToCents,
} from '../packages/settings/src/index.js';
import type {
  DiagnosticReportStore,
  NonSecretSettingsDraft,
} from '../packages/settings/src/index.js';
import { cleanTemporaryDatabases } from './support/database-test-utils.js';
import {
  FakeCredentialStore,
  createSettingsDatabase,
  runtimeUnusableValue,
} from './support/settings-test-utils.js';

const openDatabases: DatabaseSync[] = [];

class MemoryDiagnosticStore implements DiagnosticReportStore {
  public writes: Array<{ content: string; hash: string }> = [];

  public async write(content: string, hash: string): Promise<string> {
    this.writes.push({ content, hash });
    return `exports/diagnostics/basic-${hash.slice(0, 12)}.json`;
  }
}

function runtime() {
  return {
    appVersion: '0.0.0',
    chromiumVersion: '150',
    dataRootFormatVersion: 1,
    databaseHealthy: true,
    electronVersion: '43.2.0',
    localApiActiveClientCount: 0,
    localApiEnabled: false,
    localApiPort: 43_119,
    localApiState: 'DISABLED',
    localApiVersion: '1',
    nodeVersion: '24',
    platformVersion: 'Windows',
    queueHealthy: true,
    safeStorageAvailable: true,
    schemaVersion: 6,
    storageHealthy: true,
  } as const;
}

function draft(expectedRevision = 0): NonSecretSettingsDraft {
  return {
    account: { bio: '本地简介', workingName: '谜案观察员' },
    budget: { hardLimitDollars: '90.00', warningDollars: '70.25' },
    expectedRevision,
    models: {
      embedding: null,
      image: 'image/model-v1',
      research: 'research:model-v1',
      review: 'review.model-v1',
      writing: 'writing_model-v1',
    },
    providerBaseUrl: 'HTTPS://Gateway.Example/v1/',
  };
}

async function context() {
  const { database, repository } = await createSettingsDatabase();
  openDatabases.push(database);
  const credentials = new FakeCredentialStore();
  const diagnostics = new MemoryDiagnosticStore();
  const service = new SettingsService(repository, credentials, {
    clock: { now: () => new Date('2026-07-27T12:34:56.000Z') },
    diagnosticRuntime: runtime,
    diagnosticStore: diagnostics,
  });
  return { credentials, database, diagnostics, repository, service };
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const database of openDatabases.splice(0)) {
    database.close();
  }
  cleanTemporaryDatabases();
});

describe('settings validation', () => {
  it.each([
    ['https://EXAMPLE.test/', 'https://example.test'],
    ['https://example.test/v1///', 'https://example.test/v1'],
    ['http://localhost:8080/v1/', 'http://localhost:8080/v1'],
    ['http://127.0.0.1/v1', 'http://127.0.0.1/v1'],
    ['http://[::1]:8080/v1/', 'http://[::1]:8080/v1'],
    ['', null],
  ])('normalizes provider URL %s', (input, expected) => {
    expect(normalizeProviderBaseUrl(input)).toBe(expected);
  });

  it.each([
    'http://example.test/v1',
    'https://user:pass@example.test/v1',
    'https://example.test/v1?query=1',
    'https://example.test/v1#fragment',
    'ftp://example.test/v1',
    `https://example.test/${'x'.repeat(2_100)}`,
    'https://example.test/\ncontrol',
  ])('rejects unsafe provider URL without network access: %s', (value) => {
    expect(() => normalizeProviderBaseUrl(value)).toThrow(
      expect.objectContaining({ code: 'PROVIDER_URL_INVALID' }),
    );
  });

  it('validates model ids without inferring any capability', () => {
    expect(normalizeModelId('  vendor/model-v1:latest  ')).toBe('vendor/model-v1:latest');
    expect(normalizeModelId(null)).toBeNull();
    expect(() => normalizeModelId(`model-${'x'.repeat(200)}`)).toThrow(
      expect.objectContaining({ code: 'MODEL_ID_INVALID' }),
    );
    expect(() => normalizeModelId('model\nname')).toThrow(
      expect.objectContaining({ code: 'MODEL_ID_INVALID' }),
    );
  });

  it('parses exact decimal dollars to integer cents and rejects ambiguous numbers', () => {
    expect(parseDollarsToCents('80', true)).toBe(8_000);
    expect(parseDollarsToCents('0.01', false)).toBe(1);
    for (const value of ['NaN', 'Infinity', '1e2', '0.001', '1.', '.5', '-1', '01']) {
      expect(() => parseDollarsToCents(value, true), value).toThrow(
        expect.objectContaining({ code: 'BUDGET_INVALID' }),
      );
    }
  });
});

describe('SettingsService persistence and concurrency', () => {
  it('reads safe local defaults without a credential or fabricated capability', async () => {
    const test = await context();
    await expect(test.service.getSettings()).resolves.toMatchObject({
      account: {
        occupationDisclosure: 'DEFERRED',
        ownership: 'PERSONAL',
      },
      credential: {
        status: 'NOT_CONFIGURED',
      },
      providerCapability: 'UNPROBED',
      settings: {
        credentialReference: null,
        monthlyHardLimitCents: 10_000,
        monthlyWarningCents: 8_000,
      },
    });
  });

  it('persists normalized non-secret settings and account strategy in one transaction', async () => {
    const test = await context();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const saved = await test.service.updateNonSecretSettings(draft());

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saved).toMatchObject({
      account: {
        bio: '本地简介',
        contentScope: {
          excluded: ['偶像', '音乐', '演唱会', '泛娱乐', '粉圈'],
          focus: '推理小说',
        },
        occupationDisclosure: 'DEFERRED',
        ownership: 'PERSONAL',
        tone: {
          humor: '少量冷幽默',
          sentenceStyle: '短句直接',
          voice: '观点鲜明',
        },
        workingName: '谜案观察员',
      },
      providerCapability: 'UNPROBED',
      settings: {
        imageModelId: 'image/model-v1',
        monthlyHardLimitCents: 9_000,
        monthlyWarningCents: 7_025,
        providerBaseUrl: 'https://gateway.example/v1',
        revision: 1,
        setupState: 'PROVIDER_CONFIG_INCOMPLETE',
      },
    });
    expect(test.database.prepare('SELECT count(*) AS count FROM model_runs').get()).toEqual({
      count: 0,
    });
    expect(test.database.prepare('SELECT count(*) AS count FROM cost_ledger').get()).toEqual({
      count: 0,
    });
    expect(test.database.prepare('SELECT count(*) AS count FROM jobs').get()).toEqual({ count: 0 });
  });

  it('rejects stale revisions without last-write-wins', async () => {
    const test = await context();
    await test.service.updateNonSecretSettings(draft());
    await expect(test.service.updateNonSecretSettings(draft())).rejects.toMatchObject({
      code: 'SETTINGS_REVISION_CONFLICT',
      retryable: true,
    });
    expect(test.repository.getBundle().settings.revision).toBe(1);
  });

  it('rolls back the settings update if the account write fails', async () => {
    const test = await context();
    test.database.exec(`
      CREATE TRIGGER fail_issue010_account_update
      BEFORE UPDATE ON account_profiles
      WHEN NEW.id = 'primary'
      BEGIN
        SELECT RAISE(ABORT, 'synthetic account failure');
      END;
    `);
    expect(() =>
      test.repository.update({
        account: {
          bio: '',
          contentScope: {
            excluded: ['偶像', '音乐', '演唱会', '泛娱乐', '粉圈'],
            focus: '推理小说',
            schemaVersion: 1,
          },
          occupationDisclosure: 'DEFERRED',
          ownership: 'PERSONAL',
          tone: {
            humor: '少量冷幽默',
            schemaVersion: 1,
            sentenceStyle: '短句直接',
            voice: '观点鲜明',
          },
          workingName: '不会提交',
        },
        credentialReference: null,
        embeddingModelId: null,
        expectedRevision: 0,
        imageModelId: null,
        monthlyHardLimitCents: 10_000,
        monthlyWarningCents: 8_000,
        providerBaseUrl: null,
        researchModelId: null,
        reviewModelId: null,
        setupState: 'LOCAL_PROJECT_READY',
        updatedAt: '2026-07-27T12:34:56.000Z',
        writingModelId: null,
      }),
    ).toThrow(/synthetic account failure/iu);
    expect(test.repository.getBundle().settings.revision).toBe(0);
  });

  it('sets and clears only the fixed credential reference while returning status only', async () => {
    const test = await context();
    const value = runtimeUnusableValue();
    const status = await test.service.setCredential(value);
    expect(status).toEqual({
      available: true,
      requiresReauth: false,
      status: 'CONFIGURED',
    });
    expect(test.repository.getBundle().settings).toMatchObject({
      credentialReference: 'CONTENT_AI_API_KEY',
      revision: 1,
    });
    const cleared = await test.service.clearCredential(CREDENTIAL_CLEAR_CONFIRMATION);
    expect(cleared.status).toBe('NOT_CONFIGURED');
    expect(test.repository.getBundle().settings).toMatchObject({
      credentialReference: null,
      revision: 2,
    });
    await expect(test.service.clearCredential('wrong')).rejects.toBeInstanceOf(SettingsError);
  });

  it('marks reauthentication without preventing local settings reads', async () => {
    const test = await context();
    test.credentials.reauth = true;
    const result = await test.service.getSettings();
    expect(result.settings.setupState).toBe('CREDENTIAL_REAUTH_REQUIRED');
    expect(result.credential.requiresReauth).toBe(true);
  });
});

describe('basic diagnostic report', () => {
  it('builds stable safe content and exports only the current preview hash', async () => {
    const test = await context();
    const first = await test.service.buildDiagnosticPreview();
    const second = await test.service.buildDiagnosticPreview();
    expect(second).toEqual(first);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.parse(first.content)).toMatchObject({
      credential: { configured: false, safeStorageAvailable: true },
      localApi: { activeClientCount: 0, enabled: false, port: 43_119 },
      provider: { baseUrlConfigured: false, capability: 'UNPROBED' },
      schemaVersion: 6,
    });
    await expect(test.service.exportDiagnosticReport(first.hash)).resolves.toEqual({
      managedPath: `exports/diagnostics/basic-${first.hash.slice(0, 12)}.json`,
      previewHash: first.hash,
    });
  });

  it('invalidates an old preview after settings change', async () => {
    const test = await context();
    const preview = await test.service.buildDiagnosticPreview();
    await test.service.updateNonSecretSettings(draft());
    await expect(test.service.exportDiagnosticReport(preview.hash)).rejects.toMatchObject({
      code: 'DIAGNOSTIC_STALE',
    });
  });
});
