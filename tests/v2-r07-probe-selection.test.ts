import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '.' },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: async () => '' },
}));

import { selectV2R07ProbeCapabilities } from '../apps/desktop/src/settings-runtime.js';
import { buildCapabilityProbePlan } from '../packages/providers/src/index.js';
import type { ProviderCapabilityStateView } from '../packages/shared/src/index.js';
import { deriveV2ProviderServiceState } from '../packages/v2/src/index.js';

describe('V2 R07 default capability selection', () => {
  it('only rechecks the unknown image capability when text has current CHAT evidence', () => {
    const entries = [
      {
        capability: 'structuredJson',
        modelSlot: 'RESEARCH',
        stale: false,
        state: 'SUPPORTED',
      },
      {
        capability: 'structuredJson',
        modelSlot: 'WRITING',
        stale: false,
        state: 'SUPPORTED',
      },
      {
        capability: 'imageGeneration',
        modelSlot: 'IMAGE',
        stale: false,
        state: 'UNKNOWN',
      },
    ] as unknown as ProviderCapabilityStateView['entries'];

    const selection = selectV2R07ProbeCapabilities(entries);
    expect(selection.selectedCapabilities).toEqual(['imageGeneration']);
    const retryPlan = buildCapabilityProbePlan(
      {
        baseUrl: 'http://127.0.0.1:43119/v1',
        credentialBindingVersion: 2,
        models: {
          image: 'image-model',
          provider: null,
          research: 'text-model',
          review: null,
          writing: 'text-model',
        },
        protocol: 'OPENAI_COMPATIBLE',
        settingsRevision: 3,
      },
      selection,
    );
    expect(retryPlan).toMatchObject({ requestCount: 1 });
    expect(retryPlan.steps).toEqual([
      expect.objectContaining({ capability: 'imageGeneration', modelSlots: ['IMAGE'] }),
    ]);
    const imageEntry = entries[2];
    if (imageEntry === undefined) throw new Error('Expected image capability fixture.');
    expect(
      selectV2R07ProbeCapabilities([...entries.slice(0, 2), { ...imageEntry, state: 'SUPPORTED' }]),
    ).toEqual(expect.objectContaining({ selectedCapabilities: [] }));
  });

  it('projects independent capability slots into ready, degraded, and blocked service states', () => {
    expect(
      deriveV2ProviderServiceState({
        credentialState: 'CONFIGURED',
        imageState: 'TRANSIENT_FAILURE',
        providerConfigured: true,
        researchState: 'SUPPORTED',
        writingState: 'SUPPORTED',
      }),
    ).toEqual({ imageReady: false, overallState: 'DEGRADED', textReady: true });
    expect(
      deriveV2ProviderServiceState({
        credentialState: 'CONFIGURED',
        imageState: 'SUPPORTED',
        providerConfigured: true,
        researchState: 'SUPPORTED',
        writingState: 'SUPPORTED',
      }),
    ).toEqual({ imageReady: true, overallState: 'READY', textReady: true });
    expect(
      deriveV2ProviderServiceState({
        credentialState: 'REAUTH_REQUIRED',
        imageState: 'SUPPORTED',
        providerConfigured: true,
        researchState: 'SUPPORTED',
        writingState: 'SUPPORTED',
      }),
    ).toEqual({ imageReady: true, overallState: 'BLOCKED', textReady: true });
    expect(
      deriveV2ProviderServiceState({
        credentialState: 'CONFIGURED',
        globalBlockingFailure: true,
        imageState: 'UNKNOWN',
        providerConfigured: true,
        researchState: 'SUPPORTED',
        writingState: 'SUPPORTED',
      }),
    ).toEqual({ imageReady: false, overallState: 'BLOCKED', textReady: true });
  });
});
