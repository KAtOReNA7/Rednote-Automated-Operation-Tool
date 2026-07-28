import { afterEach, describe, expect, it } from 'vitest';

import { DesktopBrowserClipRuntime } from '../apps/desktop/src/browser-clip-runtime.js';
import {
  cleanupLocalApiContexts,
  createLocalApiContext,
  localApiRequest,
  pairOverHttp,
} from './support/local-api-test-utils.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';
import { browserClipFixture } from './clipper-fixtures.js';

afterEach(async () => {
  await cleanupLocalApiContexts();
  await cleanTemporaryStorageDirectories();
});

describe('Issue 017 authenticated loopback ingest', () => {
  it('requires paired origin and bearer token, supports exact preflight, save, and receipt replay', async () => {
    const storage = await createStorageTestContext();
    let runtime: DesktopBrowserClipRuntime | undefined;
    const context = await createLocalApiContext({
      browserClipServiceFactory: (database) => {
        runtime = new DesktopBrowserClipRuntime(database, storage.root);
        return runtime;
      },
    });
    const { origin, token } = await pairOverHttp(context, { label: 'Chrome 侧载验证' });
    const clip = browserClipFixture();

    const unauthenticated = await localApiRequest(context.port, {
      body: JSON.stringify(clip),
      method: 'POST',
      origin,
      path: '/v1/browser-clips',
    });
    expect(unauthenticated.status).toBe(401);
    expect(JSON.parse(unauthenticated.body)).toMatchObject({ code: 'LOCAL_API_AUTH_REQUIRED' });

    const preflight = await localApiRequest(context.port, {
      headers: {
        'Access-Control-Request-Headers': 'authorization, content-type',
        'Access-Control-Request-Method': 'POST',
      },
      method: 'OPTIONS',
      origin,
      path: '/v1/browser-clips',
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe(origin);
    expect(preflight.headers['access-control-allow-headers']).toBe('authorization,content-type');

    const saved = await localApiRequest(context.port, {
      authorization: `Bearer ${token}`,
      body: JSON.stringify(clip),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      method: 'POST',
      origin,
      path: '/v1/browser-clips',
    });
    expect(saved.status, saved.body).toBe(201);
    const receipt = JSON.parse(saved.body).receipt as {
      candidateId: string;
      clipId: string;
      status: string;
    };
    expect(receipt).toMatchObject({ status: 'SUCCEEDED' });
    expect(receipt.clipId).toMatch(/^clip-/u);
    expect(receipt.candidateId).toMatch(/^[0-9a-f]{64}$/u);
    expect(runtime?.listClips()).toHaveLength(1);

    const replay = await localApiRequest(context.port, {
      authorization: `Bearer ${token}`,
      method: 'GET',
      origin,
      path: `/v1/browser-clips/receipts/${clip.captureId}`,
    });
    expect(replay.status).toBe(200);
    expect(JSON.parse(replay.body).receipt).toMatchObject(receipt);
  });

  it('does not expose business routes when no project service is attached', async () => {
    const context = await createLocalApiContext();
    const { origin, token } = await pairOverHttp(context);
    const capabilities = await localApiRequest(context.port, {
      authorization: `Bearer ${token}`,
      origin,
      path: '/v1/capabilities',
    });
    expect(JSON.parse(capabilities.body)).toMatchObject({
      clipperBusinessRoutes: false,
      clipperIssue: '017',
    });
    const response = await localApiRequest(context.port, {
      authorization: `Bearer ${token}`,
      body: JSON.stringify(browserClipFixture()),
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      method: 'POST',
      origin,
      path: '/v1/browser-clips',
    });
    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toMatchObject({ code: 'LOCAL_API_DISABLED' });
  });
});
