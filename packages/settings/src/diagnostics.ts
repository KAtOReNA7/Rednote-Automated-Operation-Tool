import { createHash } from 'node:crypto';

import type { DiagnosticPreview, DiagnosticRuntime, SettingsBundle } from './contracts.js';

interface BasicDiagnosticReport {
  readonly accountStrategy: {
    readonly ownership: 'PERSONAL';
    readonly schemaVersion: 1;
  };
  readonly appVersion: string;
  readonly budgets: {
    readonly monthlyHardLimitCents: number;
    readonly monthlyWarningCents: number;
  };
  readonly credential: {
    readonly configured: boolean;
    readonly requiresReauth: boolean;
    readonly safeStorageAvailable: boolean;
  };
  readonly dataRootFormatVersion: number;
  readonly health: {
    readonly database: boolean;
    readonly queue: boolean;
    readonly storage: boolean;
  };
  readonly modelsConfigured: {
    readonly embedding: boolean;
    readonly image: boolean;
    readonly research: boolean;
    readonly review: boolean;
    readonly writing: boolean;
  };
  readonly provider: {
    readonly baseUrlConfigured: boolean;
    readonly capability: 'UNPROBED';
    readonly protocol: 'OPENAI_COMPATIBLE';
  };
  readonly runtime: {
    readonly chromiumVersion: string;
    readonly electronVersion: string;
    readonly nodeVersion: string;
    readonly platformVersion: string;
  };
  readonly schemaVersion: number;
  readonly setupState: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function buildDiagnosticPreview(
  bundle: SettingsBundle,
  runtime: DiagnosticRuntime,
): DiagnosticPreview {
  const report: BasicDiagnosticReport = {
    accountStrategy: {
      ownership: 'PERSONAL',
      schemaVersion: 1,
    },
    appVersion: runtime.appVersion,
    budgets: {
      monthlyHardLimitCents: bundle.settings.monthlyHardLimitCents,
      monthlyWarningCents: bundle.settings.monthlyWarningCents,
    },
    credential: {
      configured: bundle.credential.status === 'CONFIGURED',
      requiresReauth: bundle.credential.requiresReauth,
      safeStorageAvailable: runtime.safeStorageAvailable,
    },
    dataRootFormatVersion: runtime.dataRootFormatVersion,
    health: {
      database: runtime.databaseHealthy,
      queue: runtime.queueHealthy,
      storage: runtime.storageHealthy,
    },
    modelsConfigured: {
      embedding: bundle.settings.embeddingModelId !== null,
      image: bundle.settings.imageModelId !== null,
      research: bundle.settings.researchModelId !== null,
      review: bundle.settings.reviewModelId !== null,
      writing: bundle.settings.writingModelId !== null,
    },
    provider: {
      baseUrlConfigured: bundle.settings.providerBaseUrl !== null,
      capability: 'UNPROBED',
      protocol: 'OPENAI_COMPATIBLE',
    },
    runtime: {
      chromiumVersion: runtime.chromiumVersion,
      electronVersion: runtime.electronVersion,
      nodeVersion: runtime.nodeVersion,
      platformVersion: runtime.platformVersion,
    },
    schemaVersion: runtime.schemaVersion,
    setupState: bundle.settings.setupState,
  };
  const content = `${stableJson(report)}\n`;
  return {
    content,
    hash: createHash('sha256').update(content, 'utf8').digest('hex'),
  };
}
