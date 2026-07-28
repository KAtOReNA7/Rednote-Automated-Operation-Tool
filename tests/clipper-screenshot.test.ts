import { afterEach, describe, expect, it } from 'vitest';

import {
  decodeBrowserClipScreenshot,
  DesktopBrowserClipRuntime,
} from '../apps/desktop/src/browser-clip-runtime.js';
import { SqliteLocalApiRepository } from '../packages/db/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';
import { browserClipFixture, ONE_PIXEL_PNG_DATA_URL } from './clipper-fixtures.js';

afterEach(async () => {
  cleanTemporaryDatabases();
  await cleanTemporaryStorageDirectories();
});

describe('Issue 017 optional visible-viewport screenshot', () => {
  it('validates image identity and stores only a managed content-addressed path', async () => {
    const decoded = decodeBrowserClipScreenshot(ONE_PIXEL_PNG_DATA_URL);
    expect(decoded).toMatchObject({ height: 1, mime: 'image/png', width: 1 });

    const { database } = await createInitializedDatabase('clip screenshot');
    const storage = await createStorageTestContext();
    const origin = 'chrome-extension://cccccccccccccccccccccccccccccccc';
    const client = new SqliteLocalApiRepository(database).pairClient({
      clientLabel: 'Edge 真实侧载',
      extensionOrigin: origin,
      id: 'screenshot-client',
      pairedAt: '2026-07-28T08:00:00.000Z',
      tokenDigest: Buffer.alloc(32, 9),
    });
    try {
      const runtime = new DesktopBrowserClipRuntime(database, storage.root);
      const response = await runtime.create(
        {
          extensionOrigin: origin,
          id: client.id,
          lastUsedAt: null,
          revision: 0,
          tokenDigest: Buffer.alloc(32, 9),
        },
        origin,
        browserClipFixture({
          captureId: '22222222-2222-4222-8222-222222222222',
          screenshot: { dataUrl: ONE_PIXEL_PNG_DATA_URL },
        }),
      );
      const clipId = response.receipt.clipId;
      expect(clipId).toMatch(/^clip-/u);
      if (clipId === null) throw new Error('A succeeded screenshot capture must create a clip.');
      const row = database
        .prepare(
          `SELECT screenshot_path, screenshot_hash, screenshot_bytes,
                  screenshot_width, screenshot_height
           FROM clips WHERE id = ?`,
        )
        .get(clipId);
      expect(row).toMatchObject({
        screenshot_bytes: decoded.bytes.length,
        screenshot_hash: decoded.sha256,
        screenshot_height: 1,
        screenshot_width: 1,
      });
      expect((row as { screenshot_path: string }).screenshot_path).toMatch(
        /^sources\/screenshots\//u,
      );
      expect((row as { screenshot_path: string }).screenshot_path).not.toContain(storage.rootPath);
      const read = await runtime.readScreenshot(clipId);
      expect(Buffer.from(read?.bytes ?? [])).toEqual(decoded.bytes);
    } finally {
      database.close();
    }
  });

  it('rejects MIME/magic mismatches and malformed base64', () => {
    expect(() =>
      decodeBrowserClipScreenshot(ONE_PIXEL_PNG_DATA_URL.replace('image/png', 'image/jpeg')),
    ).toThrowError('CLIPPER_SCREENSHOT_INVALID');
    expect(() => decodeBrowserClipScreenshot('data:image/png;base64,AAAA')).toThrowError();
  });
});
