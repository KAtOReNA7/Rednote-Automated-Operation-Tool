import { link as linkFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { LocalFileRepository } from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';

afterEach(cleanTemporaryStorageDirectories);

function errno(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe('content addressing and concurrent publication', () => {
  it('deduplicates 20 concurrent writes of identical content', async () => {
    const { repository, root } = await createStorageTestContext();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repository.putBuffer(Buffer.from('same immutable bytes'), {
          category: 'SOURCE_SNAPSHOT',
          displayName: `Name ${index}.html`,
        }),
      ),
    );

    expect(new Set(results.map((result) => result.managedPath)).size).toBe(1);
    const first = results[0];
    expect(first).toBeDefined();
    const shard = join(root.rootPath, 'sources', 'snapshots', first?.sha256.slice(0, 2) ?? '');
    expect(await readdir(shard)).toEqual([first?.sha256]);
  });

  it('keeps same display names with different content and Unicode/case variants without overwrite', async () => {
    const { repository, root } = await createStorageTestContext();
    const descriptors = await Promise.all([
      repository.putBuffer(Buffer.from('one'), {
        category: 'PHOTO_ORIGINAL',
        displayName: 'Cover.JPG',
      }),
      repository.putBuffer(Buffer.from('two'), {
        category: 'PHOTO_ORIGINAL',
        displayName: 'cover.jpg',
      }),
      repository.putBuffer(Buffer.from('three'), {
        category: 'PHOTO_ORIGINAL',
        displayName: 'e\u0301.jpg',
      }),
      repository.putBuffer(Buffer.from('four'), {
        category: 'PHOTO_ORIGINAL',
        displayName: 'é.jpg',
      }),
    ]);

    expect(new Set(descriptors.map((descriptor) => descriptor.managedPath)).size).toBe(4);
    for (const descriptor of descriptors) {
      expect(await readFile(root.resolve(descriptor.managedPath))).toBeDefined();
    }
  });

  it('retains every concurrently written different content item', async () => {
    const { repository } = await createStorageTestContext();
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        repository.putBuffer(Buffer.from(`different-${index}`), {
          category: 'GENERATED_IMAGE',
          displayName: 'same name.bin',
        }),
      ),
    );
    expect(new Set(results.map((result) => result.managedPath)).size).toBe(20);
  });

  it('retries only bounded Windows publish errors before success', async () => {
    const { root } = await createStorageTestContext();
    let attempts = 0;
    const repository = new LocalFileRepository(root, {
      publishLink: async (temporaryPath, targetPath) => {
        attempts += 1;
        if (attempts < 4) {
          throw errno('EBUSY');
        }
        await linkFile(temporaryPath, targetPath);
      },
      publishRetryCount: 3,
      retryDelay: async () => undefined,
    });

    await expect(
      repository.putBuffer(Buffer.from('retry'), {
        category: 'IMPORT',
        displayName: 'retry.bin',
      }),
    ).resolves.toMatchObject({ sizeBytes: 5 });
    expect(attempts).toBe(4);
  });

  it('stops after the retry limit, keeps an old target unchanged, and cleans staged files', async () => {
    const { repository, root } = await createStorageTestContext();
    const first = await repository.putBuffer(Buffer.from('old target'), {
      category: 'BACKUP',
      displayName: 'old.bin',
    });
    const oldBytes = await readFile(root.resolve(first.managedPath));
    let attempts = 0;
    const failingRepository = new LocalFileRepository(root, {
      publishLink: async () => {
        attempts += 1;
        throw errno('EPERM');
      },
      publishRetryCount: 2,
      retryDelay: async () => undefined,
    });

    await expect(
      failingRepository.putBuffer(Buffer.from('different target'), {
        category: 'BACKUP',
        displayName: 'old.bin',
      }),
    ).rejects.toMatchObject({ code: 'WRITE_FAILED', retryable: true });
    expect(attempts).toBe(3);
    expect(await readFile(root.resolve(first.managedPath))).toEqual(oldBytes);
    const entries = await readdir(join(root.rootPath, 'backups'));
    expect(entries.filter((entry) => entry.startsWith('.rednote-tmp-'))).toEqual([]);
  });
});
