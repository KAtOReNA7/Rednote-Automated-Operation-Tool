import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initializeProjectDataRoot,
  LocalFileRepository,
  type ProjectDataRoot,
} from '../../packages/storage/src/index.js';

const temporaryStorageDirectories = new Set<string>();

export async function createTemporaryStoragePath(label = '数据 根'): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), `rednote-issue008-${label}-`));
  temporaryStorageDirectories.add(directory);
  return directory;
}

export async function createStorageTestContext(): Promise<{
  readonly repository: LocalFileRepository;
  readonly root: ProjectDataRoot;
  readonly rootPath: string;
}> {
  const parent = await createTemporaryStoragePath();
  const rootPath = join(parent, 'project-data 中文 空格');
  const root = await initializeProjectDataRoot(rootPath);
  return {
    repository: new LocalFileRepository(root),
    root,
    rootPath,
  };
}

export async function createBackupStorageTestContext(): Promise<{
  readonly backupRoot: string;
  readonly repository: LocalFileRepository;
  readonly root: ProjectDataRoot;
  readonly rootPath: string;
}> {
  const storage = await createStorageTestContext();
  return { ...storage, backupRoot: await createTemporaryStoragePath('backup destination') };
}

export async function cleanTemporaryStorageDirectories(): Promise<void> {
  const paths = [...temporaryStorageDirectories];
  temporaryStorageDirectories.clear();
  await Promise.all(paths.map((path) => rm(path, { force: true, recursive: true })));
}
