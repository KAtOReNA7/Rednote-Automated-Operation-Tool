import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DESKTOP_IPC_CHANNELS } from '../packages/shared/src/desktop-api.js';
import { PROBE_CAPABILITIES } from '../packages/providers/src/index.js';

const root = resolve(import.meta.dirname, '..');
const source = (path: string): string => readFileSync(resolve(root, path), 'utf8');

describe('Issue 013 capability architecture boundaries', () => {
  it('keeps the renderer Node-free and communicates only through the shared bridge', () => {
    const renderer = [
      source('apps/web-ui/src/provider-capability-settings.tsx'),
      source('apps/web-ui/src/settings-page.tsx'),
    ].join('\n');
    expect(renderer).not.toMatch(
      /node:|electron|mystery-operations\/providers|mystery-operations\/db|fetch\s*\(/iu,
    );
    expect(renderer).toMatch(/window\.rednoteDesktop/iu);
  });

  it('exposes exactly five capability bridge operations with fixed channels', () => {
    const capabilityChannels = Object.entries(DESKTOP_IPC_CHANNELS).filter(([, channel]) =>
      channel.startsWith('providers:'),
    );
    expect(capabilityChannels).toEqual([
      ['getProviderCapabilityState', 'providers:get-capability-state'],
      ['previewProviderCapabilityProbe', 'providers:preview-capability-probe'],
      ['startProviderCapabilityProbe', 'providers:start-capability-probe'],
      ['getProviderCapabilityProbeProgress', 'providers:get-capability-probe-progress'],
      ['cancelProviderCapabilityProbe', 'providers:cancel-capability-probe'],
    ]);
  });

  it('keeps every automatic trigger out of startup, settings save, queue, and timers', () => {
    const startup = source('apps/desktop/src/main.ts');
    const settings = source('packages/settings/src/settings-service.ts');
    const queue = source('packages/workflows/src/queue/worker.ts');
    expect(startup).not.toMatch(/previewProviderCapabilityProbe|startProviderCapabilityProbe/iu);
    expect(settings).not.toMatch(/CapabilityProbe|capability probe transport/iu);
    expect(queue).not.toMatch(/CapabilityProbe|provider capability/iu);
    expect(source('apps/desktop/src/provider-capability-runtime.ts')).not.toMatch(
      /setInterval|cron|scheduleJob/iu,
    );
  });

  it('bundles the desktop main process from current provider sources', () => {
    const viteMain = source('vite.main.config.ts');
    expect(viteMain).toContain("'@mystery-operations/providers'");
    expect(viteMain).toContain("new URL('./packages/providers/src/index.ts', import.meta.url)");
  });

  it('contains no arbitrary endpoint/header/body surface and no Batch mutation path', () => {
    const policy = source('apps/desktop/src/ipc-policy.ts');
    const transport = source('packages/providers/src/capability-probe-transport.ts');
    expect(policy).not.toMatch(/arbitraryEndpoint|customHeaders|requestBody/iu);
    expect(transport).not.toMatch(
      /\/batches\/(?:create|list|retrieve|cancel)|\/files|method:\s*['"]DELETE/iu,
    );
    expect(transport).toMatch(/request\.path === '\/batches'.*HEAD.*OPTIONS/su);
  });

  it('retains all nine finite capabilities and the immutable 32-request limit', () => {
    expect(PROBE_CAPABILITIES).toEqual([
      'batch',
      'imageGeneration',
      'streaming',
      'structuredJson',
      'text',
      'toolCalling',
      'usage',
      'vision',
      'webSearch',
    ]);
    expect(source('packages/providers/src/capability-probe-contracts.ts')).toMatch(
      /maxExternalRequests:\s*32/u,
    );
  });
});
