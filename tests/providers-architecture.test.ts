import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS, migrationChecksum } from '../packages/db/src/index.js';

const root = resolve(import.meta.dirname, '..');

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

const providerProductionSource = [
  'packages/providers/src/contracts.ts',
  'packages/providers/src/capabilities.ts',
  'packages/providers/src/configuration.ts',
  'packages/providers/src/content.ts',
  'packages/providers/src/usage.ts',
  'packages/providers/src/errors.ts',
  'packages/providers/src/retry-policy.ts',
  'packages/providers/src/transport.ts',
  'packages/providers/src/openai-compatible-provider.ts',
  'packages/providers/src/mock-provider.ts',
  'packages/providers/src/capability-probe-contracts.ts',
  'packages/providers/src/capability-probe-plan.ts',
  'packages/providers/src/capability-probe-classifier.ts',
  'packages/providers/src/capability-probe-payloads.ts',
  'packages/providers/src/capability-probe-runner.ts',
  'packages/providers/src/capability-probe-transport.ts',
  'packages/providers/src/capability-guard.ts',
  'packages/providers/src/index.ts',
]
  .map(source)
  .join('\n');

describe('Issue 012 provider architecture and scope', () => {
  it('keeps migration v1-v5 hashes frozen while Issues 013-014 append v6-v7', () => {
    expect(MIGRATIONS.map(({ version }) => version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17,
    ]);
    expect(MIGRATIONS.slice(0, 5).map(migrationChecksum)).toEqual([
      '8964b8727dfb4f244a8c63a47368da3ceb23de945078b37efe161af91acac907',
      'ab3d6d34621f9f29601f1574f624381d78c208f1c36cfda35377d8f82f4c57ce',
      '11dc5ba6496b265cf2945ea7b6b94f59e01428ee253a203596d188b929a222ed',
      'c84c82c50f2170c20154c754d0604319082c6683737624a9c14d3a508315471c',
      '88c29c6160122eea91dc8f3b88c0cd0aafc58f91c3cfd6bcfdd2020209f6d808',
    ]);
  });

  it('uses the existing provider package without OpenAI SDK, Batch, or cloud dependencies', () => {
    const lock = JSON.parse(source('package-lock.json')) as {
      readonly packages: Readonly<Record<string, unknown>>;
    };
    expect(lock.packages).toHaveProperty('packages/providers');
    for (const dependency of [
      'openai',
      '@azure/openai',
      'aws-sdk',
      '@google-cloud/vertexai',
      'bull',
      'bullmq',
    ]) {
      expect(lock.packages).not.toHaveProperty(`node_modules/${dependency}`);
    }
    expect(providerProductionSource).not.toMatch(
      /\/batches\/(?:create|list|cancel)|files\/upload/iu,
    );
  });

  it('keeps provider imports out of renderer, preload, and shared renderer contracts', () => {
    const renderer = [
      source('apps/web-ui/src/app.tsx'),
      source('apps/web-ui/src/settings-page.tsx'),
      source('apps/web-ui/src/local-api-settings.tsx'),
    ].join('\n');
    const preload = source('apps/desktop/src/preload.ts');
    const shared = source('packages/shared/src/index.ts');
    expect(renderer).not.toMatch(/mystery-operations\/providers|packages\/providers/iu);
    expect(preload).not.toMatch(/mystery-operations\/providers|provider invoke/iu);
    expect(shared).not.toMatch(/CredentialResolver|HttpTransport|ImageContentPart|ProviderCall/iu);
  });

  it('does not wire providers into app startup, local API, UI, or a real JobHandler', () => {
    const startup = [
      source('apps/desktop/src/main.ts'),
      source('apps/desktop/src/settings-runtime.ts'),
      source('apps/desktop/src/local-api-runtime.ts'),
    ].join('\n');
    const localApi = [
      source('packages/local-api/src/router.ts'),
      source('packages/shared/src/local-api-contracts.ts'),
    ].join('\n');
    const workflows = [
      source('packages/workflows/src/queue/handler-registry.ts'),
      source('packages/workflows/src/index.ts'),
    ].join('\n');
    expect(startup).not.toMatch(/mystery-operations\/providers|OpenAICompatibleProvider/u);
    expect(localApi).not.toMatch(/provider|generation|model/iu);
    expect(workflows).not.toMatch(/OpenAICompatibleProvider|generateText|generateImage/u);
  });

  it('exports no search, embedding, OCR, Batch, or tool execution method', () => {
    const contracts = source('packages/providers/src/contracts.ts');
    expect(contracts).not.toMatch(/\b(search|embed|ocr|batch|runTool|executeComputerUse)\s*\(/u);
  });

  it('never reads environment credentials, dotenv, proxies, or arbitrary caller headers', () => {
    expect(providerProductionSource).not.toMatch(
      /process\.env|dotenv|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|proxy-agent/iu,
    );
    expect(source('packages/providers/src/contracts.ts')).not.toMatch(
      /headers|authorization|baseUrl|credentialReference/iu,
    );
  });

  it('contains no database writes, cost calculation, or provider diagnostics integration', () => {
    expect(providerProductionSource).not.toMatch(
      /INSERT\s+INTO|UPDATE\s+(?:model_runs|cost_ledger|jobs)|cost_ledger|dollar|price/iu,
    );
    expect(source('packages/settings/src/diagnostics.ts')).not.toMatch(
      /providerContractsAvailable|liveProviderWired|capabilityProbeAvailable/u,
    );
  });

  it('adds test:providers to Windows CI without secret or real provider configuration', () => {
    const workflow = source('.github/workflows/ci.yml');
    expect(workflow).toContain('npm run test:providers');
    expect(workflow).not.toMatch(/OPENAI_API_KEY|CONTENT_AI_API_KEY|PROVIDER_BASE_URL|MODEL_ID/u);
  });
});
