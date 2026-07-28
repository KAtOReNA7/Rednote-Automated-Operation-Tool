import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';
import {
  ScriptedFetchTransport,
  type FetchTransportResponseV1,
} from '../packages/fetch/src/index.js';
import { enabledFetchProfile } from './fetch-fixtures.js';

describe('Issue 016 egress boundaries', () => {
  it('uses only explicit scripted transport in the unit path', async () => {
    const body = Buffer.from('offline response', 'utf8');
    const scriptedResponse: FetchTransportResponseV1 = {
      body,
      contentDisposition: null,
      contentType: 'text/plain; charset=utf-8',
      decodedBytes: body.byteLength,
      location: null,
      rawBytes: body.byteLength,
      remoteAddress: '127.0.0.1',
      retryAfterSeconds: null,
      statusCode: 200,
    };
    const transport = new ScriptedFetchTransport([scriptedResponse]);
    const response = await transport.fetch({
      deadlineAt: Date.now() + 1_000,
      kind: 'PAGE',
      pinnedTarget: {
        addresses: [{ address: '127.0.0.1', family: 4 }],
        dnsPolicyVersion: 'fetch-dns-public-only-v1',
        hostname: 'fixture.example.test',
        selectedAddress: { address: '127.0.0.1', family: 4 },
      },
      profile: enabledFetchProfile(),
      url: new URL('https://fixture.example.test/article'),
    });
    expect(response).toBe(scriptedResponse);
    expect(transport.calls).toHaveLength(1);
  });

  it('rejects secret-like keys, raw URLs and arbitrary controls at Fetch IPC', () => {
    const sender = 'rednote://app/index.html';
    const valid = {
      enabled: false,
      expectedRevision: 1,
      globalMaxConcurrent: 2,
      maxRequestsPerWindow: 30,
      minIntervalMs: 2_000,
      windowMs: 60_000,
    };
    expect(validateDesktopIpcRequest(sender, [valid], sender, 'updateFetchPolicy')).toBeNull();
    for (const extra of [
      { url: 'https://example.test' },
      { proxy: 'http://127.0.0.1' },
      { authorization: 'secret' },
      { cookie: 'session=secret' },
      { userAgent: 'browser disguise' },
      { robotsOverride: true },
      { rejectUnauthorized: false },
    ]) {
      expect(
        validateDesktopIpcRequest(sender, [{ ...valid, ...extra }], sender, 'updateFetchPolicy'),
      ).toMatchObject({ error: { code: 'INVALID_REQUEST' }, ok: false });
    }
  });

  it('keeps startup, renderer and queue wiring free of automatic Fetch execution', async () => {
    const files = [
      'apps/desktop/src/main.ts',
      'apps/desktop/src/preload.ts',
      'apps/web-ui/src/fetch-policy-settings.tsx',
      'apps/web-ui/src/fetch-run-panel.tsx',
    ];
    const source = (
      await Promise.all(files.map((path) => readFile(join(process.cwd(), path), 'utf8')))
    ).join('\n');
    expect(source).not.toMatch(/\.execute\s*\(|FETCH_PUBLIC_PAGE_V1.*enqueue|auto.*fetch/iu);
    expect(source).not.toMatch(/openai|api\.xiaohongshu|xhs|rednote\.com/iu);
  });
});
