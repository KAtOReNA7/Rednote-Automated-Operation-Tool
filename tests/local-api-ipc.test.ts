import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DESKTOP_IPC_CHANNELS, type DesktopBridge } from '../packages/shared/src/index.js';
import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';

const RENDERER = 'rednote://app/index.html';
const projectRoot = resolve(import.meta.dirname, '..');

describe('Issue 011 narrow IPC policy', () => {
  it('publishes exactly six fixed local API channels', () => {
    expect(
      Object.fromEntries(
        Object.entries(DESKTOP_IPC_CHANNELS).filter(([key]) =>
          key.toLowerCase().includes('localapi'),
        ),
      ),
    ).toEqual({
      cancelLocalApiPairing: 'local-api:cancel-pairing',
      getLocalApiStatus: 'local-api:get-status',
      listLocalApiClients: 'local-api:list-clients',
      revokeLocalApiClient: 'local-api:revoke-client',
      startLocalApiPairing: 'local-api:start-pairing',
      updateLocalApiSettings: 'local-api:update-settings',
    });
  });

  it.each([
    ['getLocalApiStatus', []],
    ['listLocalApiClients', []],
    ['startLocalApiPairing', []],
    ['cancelLocalApiPairing', [{ pairingSessionId: 'pairing-session-000011' }]],
    ['updateLocalApiSettings', [{ enabled: true, expectedRevision: 0, port: 43_119 }]],
    [
      'revokeLocalApiClient',
      [
        {
          clientId: 'client-id-000011',
          confirmation: 'REVOKE_LOCAL_API_CLIENT',
          expectedRevision: 0,
        },
      ],
    ],
  ] as const)('accepts the exact %s input shape', (operation, args) => {
    expect(validateDesktopIpcRequest(RENDERER, args, RENDERER, operation)).toBeNull();
  });

  it('rejects untrusted senderFrame URLs for every local API method', () => {
    for (const operation of [
      'getLocalApiStatus',
      'listLocalApiClients',
      'startLocalApiPairing',
    ] as const) {
      expect(
        validateDesktopIpcRequest('https://example.test', [], RENDERER, operation),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    }
  });

  it.each([
    { enabled: true, expectedRevision: 0, host: '0.0.0.0', port: 43_119 },
    { bindAddress: '127.0.0.1', enabled: true, expectedRevision: 0, port: 43_119 },
    { enabled: true, expectedRevision: 0, origin: 'chrome-extension://x', port: 43_119 },
    { enabled: true, expectedRevision: 0, port: 43_119, token: 'forbidden' },
    { enabled: true, expectedRevision: 0, port: 43_119, url: 'http://127.0.0.1' },
    { enabled: true, expectedRevision: 0, path: 'C:\\forbidden', port: 43_119 },
  ])('rejects renderer-controlled authority fields: %#', (input) => {
    expect(
      validateDesktopIpcRequest(RENDERER, [input], RENDERER, 'updateLocalApiSettings'),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
  });

  it.each([
    { enabled: true, expectedRevision: 0, port: 1_023 },
    { enabled: true, expectedRevision: 0, port: 65_536 },
    { enabled: true, expectedRevision: -1, port: 43_119 },
    { enabled: 'true', expectedRevision: 0, port: 43_119 },
    { enabled: true, expectedRevision: 0, port: 43_119.5 },
  ])('rejects invalid enable/port/revision inputs: %#', (input) => {
    expect(
      validateDesktopIpcRequest(RENDERER, [input], RENDERER, 'updateLocalApiSettings'),
    ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  });

  it('requires bounded identifiers and explicit revoke confirmation', () => {
    for (const input of [
      { pairingSessionId: '' },
      { pairingSessionId: 'C:\\path' },
      { pairingSessionId: 'x'.repeat(129) },
    ]) {
      expect(
        validateDesktopIpcRequest(RENDERER, [input], RENDERER, 'cancelLocalApiPairing'),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    }
    for (const input of [
      { clientId: 'client-id-000011', confirmation: 'YES', expectedRevision: 0 },
      {
        clientId: 'client-id-000011',
        confirmation: 'REVOKE_LOCAL_API_CLIENT',
        expectedRevision: -1,
      },
    ]) {
      expect(
        validateDesktopIpcRequest(RENDERER, [input], RENDERER, 'revokeLocalApiClient'),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
    }
  });

  it('exposes only typed bridge calls and never raw ipcRenderer/http/net/crypto/db', () => {
    const preload = readFileSync(resolve(projectRoot, 'apps/desktop/src/preload.ts'), 'utf8');
    const bridgeKeys: readonly (keyof DesktopBridge)[] = [
      'getLocalApiStatus',
      'updateLocalApiSettings',
      'startLocalApiPairing',
      'cancelLocalApiPairing',
      'listLocalApiClients',
      'revokeLocalApiClient',
    ];
    for (const key of bridgeKeys) {
      expect(preload).toContain(`${key}:`);
    }
    expect(preload).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer/iu);
    expect(preload).not.toMatch(/from ['"]node:(?:http|net|crypto|sqlite)['"]/iu);
  });

  it('binds pairing IPC to the actual sender window in main', () => {
    const source = readFileSync(resolve(projectRoot, 'apps/desktop/src/ipc.ts'), 'utf8');
    const pairingRegion = source.slice(
      source.indexOf("'startLocalApiPairing'"),
      source.indexOf("'listLocalApiClients'"),
    );
    expect(pairingRegion).toMatch(/window\.webContents\.id\s*!==\s*event\.sender\.id/gu);
    expect(pairingRegion).toContain('window.id');
  });
});
