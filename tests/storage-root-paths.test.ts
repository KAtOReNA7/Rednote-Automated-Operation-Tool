import { lstat, mkdir, readFile, readdir, rm, rmdir, symlink, writeFile } from 'node:fs/promises';
import { join, parse } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  CATEGORY_DIRECTORY,
  FILE_CATEGORIES,
  formatManagedRelativePath,
  isManagedRelativePath,
  managedPathForContent,
  parseManagedRelativePath,
  sanitizeFileName,
  StorageError,
} from '../packages/shared/src/storage-contracts.js';
import {
  DATA_ROOT_FORMAT,
  DATA_ROOT_FORMAT_VERSION,
  DATA_ROOT_MARKER_FILE,
  initializeProjectDataRoot,
  openProjectDataRoot,
  relativePathFromManagedAbsolutePath,
  REQUIRED_DATA_DIRECTORIES,
  resolveManagedPath,
} from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createTemporaryStoragePath,
} from './support/storage-test-utils.js';

afterEach(cleanTemporaryStorageDirectories);

function errorCode(error: unknown): string | undefined {
  return error instanceof StorageError ? error.code : undefined;
}

describe('ProjectDataRoot', () => {
  it('initializes an explicit missing root with a minimal marker and complete fixed layout', async () => {
    const parent = await createTemporaryStoragePath();
    const rootPath = join(parent, 'project-data 中文 空格');
    const root = await initializeProjectDataRoot(rootPath, {
      now: () => new Date('2026-07-27T00:00:00.000Z'),
      randomId: () => '00000000-0000-4000-8000-000000000008',
    });
    const marker = JSON.parse(await readFile(join(rootPath, DATA_ROOT_MARKER_FILE), 'utf8')) as {
      readonly [key: string]: unknown;
    };

    expect(root.rootPath).toBe(rootPath);
    expect(marker).toEqual({
      createdAt: '2026-07-27T00:00:00.000Z',
      format: DATA_ROOT_FORMAT,
      instanceId: '00000000-0000-4000-8000-000000000008',
      version: DATA_ROOT_FORMAT_VERSION,
    });
    expect(JSON.stringify(marker)).not.toContain(rootPath);
    expect(JSON.stringify(marker)).not.toContain(process.env.USERNAME ?? '__missing__');
    for (const directory of REQUIRED_DATA_DIRECTORIES) {
      expect((await lstat(join(rootPath, ...directory.split('/')))).isDirectory()).toBe(true);
    }
  });

  it('initializes an existing empty directory, reopens it, and safely repairs missing directories', async () => {
    const rootPath = await createTemporaryStoragePath('empty');
    const first = await initializeProjectDataRoot(rootPath);
    await rmdir(join(rootPath, 'sources', 'screenshots'));
    await writeFile(join(rootPath, '保留.txt'), 'user data', 'utf8');

    const second = await openProjectDataRoot(rootPath);

    expect(second.marker.instanceId).toBe(first.marker.instanceId);
    expect(await readFile(join(rootPath, '保留.txt'), 'utf8')).toBe('user data');
    expect((await lstat(join(rootPath, 'sources', 'screenshots'))).isDirectory()).toBe(true);
  });

  it('keeps two explicit roots independent', async () => {
    const parent = await createTemporaryStoragePath('independent');
    const first = await initializeProjectDataRoot(join(parent, 'one'));
    const second = await initializeProjectDataRoot(join(parent, 'two'));

    expect(first.rootPath).not.toBe(second.rootPath);
    expect(first.marker.instanceId).not.toBe(second.marker.instanceId);
  });

  it('returns one stable instance id for concurrent initialization', async () => {
    const parent = await createTemporaryStoragePath('concurrent');
    const rootPath = join(parent, 'project-data');
    const roots = await Promise.all(
      Array.from({ length: 20 }, () => initializeProjectDataRoot(rootPath)),
    );

    expect(new Set(roots.map((root) => root.marker.instanceId))).toHaveLength(1);
    expect((await readdir(rootPath)).filter((name) => name.startsWith('.rednote-marker-'))).toEqual(
      [],
    );
  });

  it('rejects implicit, relative and filesystem-root paths', async () => {
    await expect(initializeProjectDataRoot('')).rejects.toMatchObject({
      code: 'ROOT_PATH_INVALID',
    });
    await expect(initializeProjectDataRoot('relative/project-data')).rejects.toMatchObject({
      code: 'ROOT_PATH_INVALID',
    });
    await expect(initializeProjectDataRoot(parse(process.cwd()).root)).rejects.toMatchObject({
      code: 'ROOT_IS_FILESYSTEM_ROOT',
    });
    if (process.platform === 'win32') {
      await expect(initializeProjectDataRoot('C:\\')).rejects.toMatchObject({
        code: 'ROOT_IS_FILESYSTEM_ROOT',
      });
    }
  });

  it('does not take over a non-empty unmarked directory', async () => {
    const rootPath = await createTemporaryStoragePath('not-owned');
    await writeFile(join(rootPath, 'existing.txt'), 'keep', 'utf8');

    await expect(initializeProjectDataRoot(rootPath)).rejects.toMatchObject({
      code: 'ROOT_NOT_OWNED',
    });
    expect(await readFile(join(rootPath, 'existing.txt'), 'utf8')).toBe('keep');
  });

  it('rejects unsupported marker versions and format identifiers', async () => {
    const versionRoot = await createTemporaryStoragePath('version');
    await writeFile(
      join(versionRoot, DATA_ROOT_MARKER_FILE),
      JSON.stringify({
        createdAt: '2026-07-27T00:00:00.000Z',
        format: DATA_ROOT_FORMAT,
        instanceId: '00000000-0000-4000-8000-000000000008',
        version: 99,
      }),
    );
    await expect(openProjectDataRoot(versionRoot)).rejects.toMatchObject({
      code: 'ROOT_FORMAT_UNSUPPORTED',
    });

    const formatRoot = await createTemporaryStoragePath('format');
    await writeFile(
      join(formatRoot, DATA_ROOT_MARKER_FILE),
      JSON.stringify({
        createdAt: '2026-07-27T00:00:00.000Z',
        format: 'other-format',
        instanceId: '00000000-0000-4000-8000-000000000008',
        version: 1,
      }),
    );
    await expect(openProjectDataRoot(formatRoot)).rejects.toMatchObject({
      code: 'ROOT_FORMAT_UNSUPPORTED',
    });
  });

  it('rejects required paths occupied by files or directory links', async () => {
    const fileParent = await createTemporaryStoragePath('file-conflict');
    const fileRoot = await initializeProjectDataRoot(join(fileParent, 'data'));
    await rm(join(fileRoot.rootPath, 'imports'), { recursive: true });
    await writeFile(join(fileRoot.rootPath, 'imports'), 'conflict', 'utf8');
    await expect(openProjectDataRoot(fileRoot.rootPath)).rejects.toMatchObject({
      code: 'ROOT_LAYOUT_CONFLICT',
    });

    const linkParent = await createTemporaryStoragePath('link-conflict');
    const linkRoot = await initializeProjectDataRoot(join(linkParent, 'data'));
    const target = join(linkParent, 'outside');
    await mkdir(target);
    await rm(join(linkRoot.rootPath, 'exports'), { recursive: true });
    await symlink(
      target,
      join(linkRoot.rootPath, 'exports'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(openProjectDataRoot(linkRoot.rootPath)).rejects.toMatchObject({
      code: 'PATH_LINK_NOT_ALLOWED',
    });
  });

  it('proves current Windows long-path behavior without changing system policy', async () => {
    const parent = await createTemporaryStoragePath('long');
    let rootPath = parent;
    let index = 0;
    while (rootPath.length <= 275) {
      rootPath = join(rootPath, `${String(index).padStart(2, '0')}-${'长'.repeat(36)}`);
      index += 1;
    }
    const root = await initializeProjectDataRoot(rootPath);
    expect(root.rootPath.length).toBeGreaterThan(260);
    expect((await lstat(join(root.rootPath, 'generated-images'))).isDirectory()).toBe(true);
  });
});

describe('ManagedRelativePath', () => {
  it('maps every category to one authoritative managed directory', () => {
    const hash = 'a'.repeat(64);
    for (const category of FILE_CATEGORIES) {
      const path = managedPathForContent(category, hash);
      expect(formatManagedRelativePath(path)).toBe(`${CATEGORY_DIRECTORY[category]}/aa/${hash}`);
      expect(isManagedRelativePath(path, category)).toBe(true);
    }
  });

  it.each([
    '/absolute/path',
    'C:\\absolute',
    'C:drive-relative',
    '\\\\server\\share',
    '\\\\?\\C:\\device-path',
    'file:///escape',
    '../escape',
    'sources/snapshots/../../escape',
    'sources\\snapshots/..\\escape',
    'sources/snapshots//file',
    'sources/snapshots/./file',
    'sources/snapshots/file/',
    'sources/snapshots/\u0000file',
  ])('rejects unsafe persisted path %s', (value) => {
    expect(() => parseManagedRelativePath(value)).toThrow(StorageError);
    try {
      parseManagedRelativePath(value);
    } catch (error) {
      expect(errorCode(error)).toBe('PATH_INVALID');
    }
  });

  it('uses path containment rather than a string-prefix check', async () => {
    const parent = await createTemporaryStoragePath('containment');
    const root = join(parent, 'root');
    const managed = parseManagedRelativePath('imports/aa/file');
    const absolute = resolveManagedPath(root, managed);

    expect(absolute).toBe(join(root, 'imports', 'aa', 'file'));
    expect(relativePathFromManagedAbsolutePath(root, absolute, 'IMPORT')).toBe(managed);
    expect(() =>
      relativePathFromManagedAbsolutePath(root, join(parent, 'root-escape', 'imports', 'file')),
    ).toThrowError(expect.objectContaining({ code: 'PATH_OUTSIDE_ROOT' }));
  });
});

describe('Windows-safe file names', () => {
  it('preserves Chinese, Japanese, emoji and normal spaces deterministically', () => {
    expect(sanitizeFileName(' 迷雾 東京 😀.png')).toBe(' 迷雾 東京 😀.png');
    expect(sanitizeFileName(' 迷雾 東京 😀.png')).toBe(sanitizeFileName(' 迷雾 東京 😀.png'));
  });

  it('sanitizes reserved characters, control characters and trailing endings', () => {
    expect(sanitizeFileName('a<b>c:d"e|f?g*.txt. ')).toBe('a_b_c_d_e_f_g_.txt');
    expect(sanitizeFileName('a\u0001b.txt')).toBe('a_b.txt');
    expect(() => sanitizeFileName('a/b.txt')).toThrowError(
      expect.objectContaining({ code: 'FILE_NAME_INVALID' }),
    );
    expect(() => sanitizeFileName('a\\b.txt')).toThrowError(
      expect.objectContaining({ code: 'FILE_NAME_INVALID' }),
    );
    expect(() => sanitizeFileName('\u0000')).toThrowError(
      expect.objectContaining({ code: 'FILE_NAME_INVALID' }),
    );
  });

  it.each([
    'CON',
    'prn.txt',
    'AUX.log',
    'nul.data',
    'COM1',
    'com9.jpg',
    'LPT1',
    'lpt9.csv',
    'COM¹.txt',
    'COM².txt',
    'COM³.txt',
    'LPT¹.txt',
    'LPT².txt',
    'LPT³.txt',
  ])('neutralizes reserved device name %s', (value) => {
    expect(sanitizeFileName(value)).toMatch(/^_/u);
  });

  it('rejects dot segments and uses a safe fallback after sanitization', () => {
    expect(() => sanitizeFileName('.')).toThrowError(
      expect.objectContaining({ code: 'FILE_NAME_INVALID' }),
    );
    expect(() => sanitizeFileName('..')).toThrowError(
      expect.objectContaining({ code: 'FILE_NAME_INVALID' }),
    );
    expect(sanitizeFileName('***')).toBe('___');
    expect(sanitizeFileName('   ')).toBe('file');
  });

  it('separately limits base and extension without splitting a surrogate pair', () => {
    const value = sanitizeFileName(`${'a'.repeat(200)}😀.verylongextensionvalue`, 40);
    expect(value.length).toBeLessThanOrEqual(40);
    expect(value).not.toMatch(/[\ud800-\udbff]$/u);
    expect(value).toMatch(/\.verylongextensio$/u);
  });
});
