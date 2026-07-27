import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildDiagnosticPreview } from '../packages/settings/src/diagnostics.js';
import type { DiagnosticRuntime, SettingsBundle } from '../packages/settings/src/index.js';
import {
  LocalDiagnosticReportStore,
  initializeProjectDataRoot,
} from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createTemporaryStoragePath,
} from './support/storage-test-utils.js';

const bundle: SettingsBundle = {
  account: {
    bio: 'private biography that must not be exported',
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
    workingName: 'private working name',
  },
  credential: {
    available: true,
    requiresReauth: false,
    status: 'CONFIGURED',
    updatedAt: '2026-07-27T12:00:00.000Z',
  },
  providerCapability: 'UNPROBED',
  settings: {
    credentialReference: 'CONTENT_AI_API_KEY',
    embeddingModelId: 'private-embedding-model',
    imageModelId: null,
    monthlyHardLimitCents: 9_000,
    monthlyWarningCents: 7_000,
    providerBaseUrl: 'https://private-gateway.example/v1',
    providerProtocol: 'OPENAI_COMPATIBLE',
    researchModelId: 'private-research-model',
    reviewModelId: 'private-review-model',
    revision: 4,
    setupState: 'PROVIDER_CONFIGURED_UNVERIFIED',
    updatedAt: '2026-07-27T12:00:00.000Z',
    writingModelId: 'private-writing-model',
  },
};

const runtime: DiagnosticRuntime = {
  appVersion: '0.0.0',
  chromiumVersion: '150.0.0',
  dataRootFormatVersion: 1,
  databaseHealthy: true,
  electronVersion: '43.2.0',
  localApiActiveClientCount: 2,
  localApiEnabled: true,
  localApiPort: 43_119,
  localApiState: 'RUNNING',
  localApiVersion: '1',
  nodeVersion: '24.16.0',
  platformVersion: 'Windows 11 fixture',
  queueHealthy: true,
  safeStorageAvailable: true,
  schemaVersion: 5,
  storageHealthy: true,
};

afterEach(cleanTemporaryStorageDirectories);

describe('basic diagnostic report', () => {
  it('has a stable hash and an exact, deliberately limited schema', () => {
    const first = buildDiagnosticPreview(bundle, runtime);
    const second = buildDiagnosticPreview(bundle, runtime);
    const report = JSON.parse(first.content) as Record<string, unknown>;

    expect(second).toEqual(first);
    expect(first.hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(report).sort()).toEqual([
      'accountStrategy',
      'appVersion',
      'budgets',
      'credential',
      'dataRootFormatVersion',
      'health',
      'localApi',
      'modelsConfigured',
      'provider',
      'runtime',
      'schemaVersion',
      'setupState',
    ]);
    expect(report.accountStrategy).toEqual({ ownership: 'PERSONAL', schemaVersion: 1 });
    expect(report.credential).toEqual({
      configured: true,
      requiresReauth: false,
      safeStorageAvailable: true,
    });
    expect(report.modelsConfigured).toEqual({
      embedding: true,
      image: false,
      research: true,
      review: true,
      writing: true,
    });
    expect(report.localApi).toEqual({
      activeClientCount: 2,
      enabled: true,
      port: 43_119,
      state: 'RUNNING',
      version: '1',
    });
    expect(report.provider).toEqual({
      baseUrlConfigured: true,
      capability: 'UNPROBED',
      protocol: 'OPENAI_COMPATIBLE',
    });
    expect(first.content).not.toMatch(
      /private|CONTENT_AI_API_KEY|https?:\/\/|credentialReference|updatedAt|revision|path|username|authorization|header|body|payload/iu,
    );
  });

  it('writes one JSON file only under the controlled exports/diagnostics directory', async () => {
    const parent = await createTemporaryStoragePath('diagnostic');
    const root = await initializeProjectDataRoot(join(parent, 'project-data'));
    const store = new LocalDiagnosticReportStore(root, {
      randomId: () => 'diagnostic-write-000010',
    });
    const preview = buildDiagnosticPreview(bundle, runtime);

    const managedPath = await store.write(
      preview.content,
      preview.hash,
      '2026-07-27T12:00:00.000Z',
    );
    expect(managedPath).toMatch(
      /^exports\/diagnostics\/basic-diagnostic-2026-07-27T12-00-00\.000Z-[a-f0-9]{12}\.json$/u,
    );
    expect(managedPath).not.toMatch(/\.zip$|\\/u);
    expect(await readFile(join(root.rootPath, ...managedPath.split('/')), 'utf8')).toBe(
      preview.content,
    );
    expect(await readdir(join(root.rootPath, 'exports'))).toEqual(['diagnostics']);
    expect(await readdir(join(root.rootPath, 'exports', 'diagnostics'))).toHaveLength(1);
  });

  it('rejects invalid preview hashes before writing anything', async () => {
    const parent = await createTemporaryStoragePath('diagnostic-invalid');
    const root = await initializeProjectDataRoot(join(parent, 'project-data'));
    const store = new LocalDiagnosticReportStore(root);

    await expect(
      store.write('{}\n', 'not-a-preview-hash', '2026-07-27T12:00:00.000Z'),
    ).rejects.toBeInstanceOf(TypeError);
    expect(await readdir(join(root.rootPath, 'exports'))).toEqual([]);
  });
});
