import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  MODEL_RESULT_CACHE_FORMAT,
  MODEL_RESULT_CACHE_FORMAT_VERSION,
  ModelResultCacheStore,
  initializeProjectDataRoot,
} from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createTemporaryStoragePath,
} from './support/storage-test-utils.js';

afterEach(cleanTemporaryStorageDirectories);

describe('Issue 014 controlled model result cache storage', () => {
  it('writes a content-addressed envelope and verifies size, file hash and output hash', async () => {
    const root = await initializeProjectDataRoot(
      join(await createTemporaryStoragePath('模型 cache 中文 😀'), 'project'),
    );
    const store = new ModelResultCacheStore(root);
    const envelope = {
      createdAt: '2026-07-28T00:00:00.000Z',
      format: MODEL_RESULT_CACHE_FORMAT,
      output: {
        finishReason: 'stop',
        partial: false as const,
        refusal: false as const,
        text: 'local output',
        type: 'TEXT' as const,
      },
      outputContentHash: 'a'.repeat(64),
      outputType: 'TEXT' as const,
      schemaIdentity: null,
      version: MODEL_RESULT_CACHE_FORMAT_VERSION,
    } as const;
    const file = await store.write(envelope);
    expect(file.managedPath).toMatch(/^cache\/model-results\/[a-f0-9/.-]+$/u);
    expect(file.managedPath).not.toContain('local output');
    await expect(
      store.read(file.managedPath, {
        expectedFileHash: file.sha256,
        expectedOutputHash: envelope.outputContentHash,
        expectedOutputType: 'TEXT',
        expectedSizeBytes: file.sizeBytes,
        parseOutput: (value) => value,
      }),
    ).resolves.toMatchObject({ outputType: 'TEXT' });
  });

  it('fails closed after tampering and deletes only an exact controlled cache file', async () => {
    const root = await initializeProjectDataRoot(
      join(await createTemporaryStoragePath('cache tamper'), 'project'),
    );
    const store = new ModelResultCacheStore(root);
    const file = await store.write({
      createdAt: '2026-07-28T00:00:00.000Z',
      format: MODEL_RESULT_CACHE_FORMAT,
      output: {
        finishReason: 'stop',
        partial: false,
        refusal: false,
        text: 'safe',
        type: 'TEXT',
      },
      outputContentHash: 'b'.repeat(64),
      outputType: 'TEXT',
      schemaIdentity: null,
      version: MODEL_RESULT_CACHE_FORMAT_VERSION,
    });
    const nativePath = root.resolve(file.managedPath);
    const original = await readFile(nativePath);
    await writeFile(nativePath, Buffer.concat([original, Buffer.from('tamper')]));
    await expect(
      store.read(file.managedPath, {
        expectedFileHash: file.sha256,
        expectedOutputHash: 'b'.repeat(64),
        expectedOutputType: 'TEXT',
        expectedSizeBytes: file.sizeBytes,
        parseOutput: (value) => value,
      }),
    ).rejects.toMatchObject({ code: 'FILE_INTEGRITY_MISMATCH' });
    store.deleteExact(file.managedPath);
    expect(() => root.resolve(file.managedPath)).not.toThrow();
    expect(() => store.deleteExact('exports/not-cache.json')).toThrow();
  });

  it('enforces a finite total-byte quota before publishing another cache file', async () => {
    const root = await initializeProjectDataRoot(
      join(await createTemporaryStoragePath('cache quota'), 'project'),
    );
    const store = new ModelResultCacheStore(root, { maximumTotalBytes: 32 });
    await expect(
      store.write({
        createdAt: '2026-07-28T00:00:00.000Z',
        format: MODEL_RESULT_CACHE_FORMAT,
        output: {
          finishReason: 'stop',
          partial: false,
          refusal: false,
          text: 'larger than the deliberately tiny quota',
          type: 'TEXT',
        },
        outputContentHash: 'c'.repeat(64),
        outputType: 'TEXT',
        schemaIdentity: null,
        version: MODEL_RESULT_CACHE_FORMAT_VERSION,
      }),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED' });
  });
});
