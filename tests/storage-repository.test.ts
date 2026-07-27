import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CATEGORY_DIRECTORY,
  FILE_CATEGORIES,
  parseManagedRelativePath,
  StorageError,
} from '../packages/shared/src/storage-contracts.js';
import { LocalFileRepository } from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
  createTemporaryStoragePath,
} from './support/storage-test-utils.js';

afterEach(cleanTemporaryStorageDirectories);

async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk as Uint8Array));
  }
  return Buffer.concat(chunks);
}

describe('local immutable file repository', () => {
  it('writes buffers, reads streams, returns finite stat metadata and verifies integrity', async () => {
    const { repository, rootPath } = await createStorageTestContext();
    const content = Buffer.from('中文 buffer content', 'utf8');
    const expectedHash = createHash('sha256').update(content).digest('hex');

    const descriptor = await repository.putBuffer(content, {
      category: 'SOURCE_SNAPSHOT',
      displayName: '来源 快照.html',
    });

    expect(descriptor).toEqual({
      category: 'SOURCE_SNAPSHOT',
      createdAt: expect.stringMatching(/Z$/u),
      managedPath: `sources/snapshots/${expectedHash.slice(0, 2)}/${expectedHash}`,
      sanitizedDisplayName: '来源 快照.html',
      sha256: expectedHash,
      sizeBytes: content.byteLength,
      storageName: expectedHash,
    });
    expect(JSON.stringify(descriptor)).not.toContain(rootPath);
    expect(await readStream(repository.openReadStream(descriptor.managedPath))).toEqual(content);
    await expect(repository.statManagedFile(descriptor.managedPath)).resolves.toMatchObject({
      managedPath: descriptor.managedPath,
      sizeBytes: content.byteLength,
    });
    await expect(
      repository.verifyManagedFile(descriptor.managedPath, {
        expectedSha256: descriptor.sha256,
        expectedSizeBytes: descriptor.sizeBytes,
      }),
    ).resolves.toMatchObject({
      managedPath: descriptor.managedPath,
      sha256: descriptor.sha256,
      sizeBytes: descriptor.sizeBytes,
    });
  });

  it('streams a 32 MiB synthetic file with actual hashing and bounded chunks', async () => {
    const { repository } = await createStorageTestContext();
    const chunk = Buffer.alloc(256 * 1024, 0x5a);
    let emittedChunks = 0;
    async function* source(): AsyncGenerator<Buffer> {
      for (let index = 0; index < 128; index += 1) {
        emittedChunks += 1;
        yield chunk;
      }
    }
    const independent = createHash('sha256');
    for (let index = 0; index < 128; index += 1) {
      independent.update(chunk);
    }

    const descriptor = await repository.putStream(source(), {
      category: 'IMPORT',
      displayName: '32 MiB synthetic.bin',
      maxBytes: 32 * 1024 * 1024,
    });

    expect(emittedChunks).toBe(128);
    expect(descriptor.sizeBytes).toBe(32 * 1024 * 1024);
    expect(descriptor.sha256).toBe(independent.digest('hex'));
  });

  it('copies an external regular file without moving, deleting or disclosing its source path', async () => {
    const { repository, rootPath } = await createStorageTestContext();
    const sourceParent = await createTemporaryStoragePath('external');
    const sourcePath = join(sourceParent, '外部 文件.txt');
    const content = 'external immutable content';
    await writeFile(sourcePath, content, 'utf8');

    const descriptor = await repository.ingestExternalFile(sourcePath, {
      category: 'IMPORT',
      displayName: '外部 文件.txt',
    });

    expect(await readFile(sourcePath, 'utf8')).toBe(content);
    expect(JSON.stringify(descriptor)).not.toContain(sourceParent);
    expect(JSON.stringify(descriptor)).not.toContain(rootPath);
    expect(await readStream(repository.openReadStream(descriptor.managedPath))).toEqual(
      Buffer.from(content),
    );
  });

  it('rejects directory and linked import sources', async () => {
    const { repository } = await createStorageTestContext();
    const sourceParent = await createTemporaryStoragePath('source-types');
    await expect(
      repository.ingestExternalFile(sourceParent, {
        category: 'IMPORT',
        displayName: 'directory',
      }),
    ).rejects.toMatchObject({ code: 'FILE_TYPE_NOT_REGULAR' });

    const sourceDirectory = join(sourceParent, 'source-directory');
    const linkedDirectory = join(sourceParent, 'linked-directory');
    const sourcePath = join(sourceDirectory, 'source.txt');
    const linkPath = join(linkedDirectory, 'source.txt');
    await mkdir(sourceDirectory);
    await writeFile(sourcePath, 'source', 'utf8');
    await symlink(
      sourceDirectory,
      linkedDirectory,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(
      repository.ingestExternalFile(linkPath, {
        category: 'IMPORT',
        displayName: 'link.txt',
      }),
    ).rejects.toMatchObject({ code: 'PATH_LINK_NOT_ALLOWED' });
  });

  it('detects source mutation before publishing an imported copy', async () => {
    const { root } = await createStorageTestContext();
    const sourceParent = await createTemporaryStoragePath('changed');
    const sourcePath = join(sourceParent, 'changing.txt');
    await writeFile(sourcePath, 'before', 'utf8');
    const repository = new LocalFileRepository(root, {
      beforeIngestSourceVerification: async () => {
        await writeFile(sourcePath, 'after and larger', 'utf8');
      },
    });

    await expect(
      repository.ingestExternalFile(sourcePath, {
        category: 'IMPORT',
        displayName: 'changing.txt',
      }),
    ).rejects.toMatchObject({ code: 'FILE_CHANGED_DURING_COPY' });
    expect(await readdir(join(root.rootPath, 'imports'))).toEqual([]);
  });

  it('aborts and enforces actual byte limits without a final file or temporary residue', async () => {
    const { repository, rootPath } = await createStorageTestContext();
    const abortController = new AbortController();
    async function* abortingSource(): AsyncGenerator<Buffer> {
      yield Buffer.alloc(32);
      abortController.abort();
      yield Buffer.alloc(32);
    }
    await expect(
      repository.putStream(abortingSource(), {
        category: 'GENERATED_IMAGE',
        displayName: 'cancelled.bin',
        signal: abortController.signal,
      }),
    ).rejects.toMatchObject({ code: 'WRITE_ABORTED' });

    await expect(
      repository.putStream(Readable.from([Buffer.alloc(32), Buffer.alloc(32)]), {
        category: 'IMPORT',
        displayName: 'too-large.bin',
        maxBytes: 63,
      }),
    ).rejects.toMatchObject({ code: 'FILE_TOO_LARGE' });

    expect(
      (await readdir(join(rootPath, 'generated-images'))).filter((name) =>
        name.startsWith('.rednote-tmp-'),
      ),
    ).toEqual([]);
    expect(
      (await readdir(join(rootPath, 'imports'))).filter((name) => name.startsWith('.rednote-tmp-')),
    ).toEqual([]);
  });

  it('distinguishes missing files and integrity corruption without repairing or deleting', async () => {
    const { repository, root } = await createStorageTestContext();
    const missing = parseManagedRelativePath(`imports/aa/${'a'.repeat(64)}`, 'IMPORT');
    await expect(repository.statManagedFile(missing)).rejects.toMatchObject({
      code: 'FILE_MISSING',
    });

    const descriptor = await repository.putBuffer(Buffer.from('original'), {
      category: 'PHOTO_ORIGINAL',
      displayName: 'photo.jpg',
    });
    await writeFile(root.resolve(descriptor.managedPath), 'corrupted', 'utf8');
    await expect(
      repository.verifyManagedFile(descriptor.managedPath, {
        expectedSha256: descriptor.sha256,
        expectedSizeBytes: descriptor.sizeBytes,
      }),
    ).rejects.toMatchObject({ code: 'FILE_INTEGRITY_MISMATCH' });
    expect(await lstat(root.resolve(descriptor.managedPath))).toBeDefined();
  });

  it('keeps every category inside its fixed directory and does not expose arbitrary directories', async () => {
    const { repository } = await createStorageTestContext();
    for (const [index, category] of FILE_CATEGORIES.entries()) {
      const descriptor = await repository.putBuffer(Buffer.from(`category-${index}`), {
        category,
        displayName: `category ${index}.bin`,
      });
      expect(descriptor.managedPath.startsWith(`${CATEGORY_DIRECTORY[category]}/`)).toBe(true);
    }
  });

  it('rejects forged managed paths and link ancestors on reads', async () => {
    const { repository, root } = await createStorageTestContext();
    expect(() => repository.openReadStream('../outside' as never)).toThrow(StorageError);

    const outsideParent = await createTemporaryStoragePath('outside');
    await writeFile(join(outsideParent, 'file'), 'outside', 'utf8');
    const shard = join(root.rootPath, 'imports', 'aa');
    await symlink(outsideParent, shard, process.platform === 'win32' ? 'junction' : 'dir');
    const linked = parseManagedRelativePath(`imports/aa/${'a'.repeat(64)}`, 'IMPORT');
    expect(() => repository.openReadStream(linked)).toThrowError(
      expect.objectContaining({ code: 'PATH_LINK_NOT_ALLOWED' }),
    );
  });
});
