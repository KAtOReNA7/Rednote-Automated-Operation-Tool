import { describe, expect, it } from 'vitest';

import {
  DESKTOP_BRIDGE_KEY,
  DESKTOP_IPC_CHANNELS,
  FOUNDATION_CHECK_KEYS,
} from '../packages/shared/src/index.js';
import {
  parseRendererSmokeTitle,
  resolveSmokeOutputPath,
  SMOKE_TITLE_PREFIX,
} from '../apps/desktop/src/smoke-report.js';
import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';

describe('desktop process contracts', () => {
  it('exposes exactly the fixed desktop and settings IPC allowlist', () => {
    const entries = Object.entries(DESKTOP_IPC_CHANNELS);
    const keys = entries.map(([key]) => key);
    const channels = entries.map(([, channel]) => channel);

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(channels).size).toBe(channels.length);
    expect(
      Object.fromEntries(
        entries.filter(([, channel]) => channel.startsWith('quality:reading-authenticity:')),
      ),
    ).toEqual({
      confirmReadingAuthenticity: 'quality:reading-authenticity:confirm',
      previewReadingAuthenticity: 'quality:reading-authenticity:preview',
    });
    expect(Object.isFrozen(DESKTOP_IPC_CHANNELS)).toBe(true);
  });

  it('uses one stable preload bridge key', () => {
    expect(DESKTOP_BRIDGE_KEY).toBe('rednoteDesktop');
  });

  it('keeps the health result keys explicit and frozen', () => {
    expect(FOUNDATION_CHECK_KEYS).toEqual([
      'backup',
      'cleanup',
      'foreignKeys',
      'migrations',
      'nodeSqlite',
      'queueLifecycle',
      'reopen',
      'wal',
    ]);
    expect(Object.isFrozen(FOUNDATION_CHECK_KEYS)).toBe(true);
  });

  it('accepts only a zero-argument invocation from the exact renderer endpoint', () => {
    expect(
      validateDesktopIpcRequest('rednote://app/index.html', [], 'rednote://app/index.html'),
    ).toBeNull();
  });

  it.each([
    ['https://example.com/', []],
    ['file:///C:/outside.html', []],
    ['rednote://evil/index.html', []],
    ['rednote://app/index.html', ['unexpected']],
  ])('returns a path-free, stack-free error for sender %s and args %#', (sender, args) => {
    const result = validateDesktopIpcRequest(sender, args, 'rednote://app/index.html');
    expect(result).toEqual({
      error: {
        code: 'INVALID_REQUEST',
        message: expect.any(String),
        retryable: false,
      },
      ok: false,
    });
    expect(JSON.stringify(result)).not.toMatch(/[A-Z]:[\\/]|stack|node_modules/iu);
  });

  it('parses a renderer smoke report without accepting extra formats', () => {
    const report = {
      appInfo: true,
      foundation: true,
      localApiBridge: true,
      navigationCount: 11,
      preload: true,
      renderer: true,
      runtimeCapabilities: true,
      windowState: true,
      credentialStatus: true,
      settings: true,
      setupState: true,
    };
    expect(
      parseRendererSmokeTitle(`${SMOKE_TITLE_PREFIX}${encodeURIComponent(JSON.stringify(report))}`),
    ).toEqual(report);
    expect(parseRendererSmokeTitle('ordinary title')).toBeNull();
    expect(parseRendererSmokeTitle(`${SMOKE_TITLE_PREFIX}%7Bbad`)).toBeNull();
  });

  it('rejects malformed renderer smoke field types', () => {
    const invalid = encodeURIComponent(
      JSON.stringify({
        appInfo: true,
        foundation: true,
        localApiBridge: true,
        navigationCount: '11',
        preload: true,
        renderer: true,
        runtimeCapabilities: true,
        windowState: true,
        credentialStatus: true,
        settings: true,
        setupState: true,
      }),
    );
    expect(parseRendererSmokeTitle(`${SMOKE_TITLE_PREFIX}${invalid}`)).toBeNull();
  });

  it.each([
    ['--issue006-smoke-output=C:\\project\\report.json'],
    ['--issue006-smoke-output=relative.json'],
    ['--issue006-smoke-output=C:\\Windows\\Temp\\not-the-required-name.json'],
    ['--issue006-smoke-output=C:\\Windows\\Temp\\issue006-smoke-x.json'],
  ])('rejects untrusted smoke output argument %s', (argument) => {
    expect(resolveSmokeOutputPath([argument])).toBeNull();
  });
});
