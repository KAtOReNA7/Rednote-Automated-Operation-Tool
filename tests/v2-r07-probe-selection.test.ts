import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: { getAppPath: () => '.' },
  BrowserWindow: { fromWebContents: () => null },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: async () => '' },
}));

import { selectV2R07ProbeCapabilities } from '../apps/desktop/src/settings-runtime.js';
import type { ProviderCapabilityStateView } from '../packages/shared/src/index.js';

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

    expect(selectV2R07ProbeCapabilities(entries).selectedCapabilities).toEqual(['imageGeneration']);
    const imageEntry = entries[2];
    if (imageEntry === undefined) throw new Error('Expected image capability fixture.');
    expect(
      selectV2R07ProbeCapabilities([...entries.slice(0, 2), { ...imageEntry, state: 'SUPPORTED' }]),
    ).toEqual(expect.objectContaining({ selectedCapabilities: [] }));
  });
});
