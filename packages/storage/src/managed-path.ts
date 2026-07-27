import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  type FileCategory,
  type ManagedRelativePath,
  parseManagedRelativePath,
  StorageError,
} from '@mystery-operations/shared/storage';

export function resolveManagedPath(rootPath: string, path: ManagedRelativePath): string {
  if (!isAbsolute(rootPath)) {
    throw new StorageError('ROOT_PATH_INVALID');
  }

  const root = resolve(rootPath);
  const candidate = resolve(root, ...path.split('/'));
  const fromRoot = relative(root, candidate);
  if (
    fromRoot.length === 0 ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new StorageError('PATH_OUTSIDE_ROOT');
  }
  return candidate;
}

export function relativePathFromManagedAbsolutePath(
  rootPath: string,
  absolutePath: string,
  expectedCategory?: FileCategory,
): ManagedRelativePath {
  if (!isAbsolute(rootPath) || !isAbsolute(absolutePath)) {
    throw new StorageError('PATH_INVALID');
  }
  const root = resolve(rootPath);
  const candidate = resolve(absolutePath);
  const fromRoot = relative(root, candidate);
  if (
    fromRoot.length === 0 ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new StorageError('PATH_OUTSIDE_ROOT');
  }
  return parseManagedRelativePath(fromRoot.split(sep).join('/'), expectedCategory);
}
