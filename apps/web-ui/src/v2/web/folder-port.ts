import { WebRepositoryError } from './contracts.js';

export interface LocalFolderPort {
  readonly displayName: string;
  read(relativePath: string): Promise<Uint8Array | null>;
  write(relativePath: string, bytes: Uint8Array, mode: 'create' | 'replace'): Promise<void>;
}

const SEGMENT = /^[^\\/:*?"<>|.][^\\/:*?"<>|]{0,119}$/u;

export function pathSegments(relativePath: string): readonly string[] {
  if (
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.includes('..') ||
    /^[A-Za-z]:/u.test(relativePath) ||
    /^\w+:\/\//u.test(relativePath)
  ) {
    throw new WebRepositoryError('INVALID_PATH', 'schema', '本地文件路径必须位于所选目录内。');
  }
  const segments = relativePath.split('/');
  if (segments.length === 0 || segments.some((segment) => !SEGMENT.test(segment))) {
    throw new WebRepositoryError('INVALID_PATH', 'schema', '本地文件路径不符合合同。');
  }
  return segments;
}

export function assertWriteTarget(relativePath: string, mode: 'create' | 'replace'): void {
  pathSegments(relativePath);
  const allowed =
    mode === 'replace'
      ? /^state\/index-[ab]\.json$/u.test(relativePath)
      : relativePath === 'rednote-workspace.json' ||
        /^state\/snapshots\/\d{8}\.json$/u.test(relativePath);
  if (!allowed) {
    throw new WebRepositoryError(
      'INVALID_PATH',
      'schema',
      '本地文件写入目标不在工作区 allowlist 中。',
    );
  }
}

export class BrowserLocalFolderPort implements LocalFolderPort {
  public readonly displayName: string;

  public constructor(private readonly root: FileSystemDirectoryHandle) {
    this.displayName = root.name;
  }

  public async read(relativePath: string): Promise<Uint8Array | null> {
    const { directory, name } = await this.#parent(relativePath, false);
    try {
      const handle = await directory.getFileHandle(name);
      return new Uint8Array(await (await handle.getFile()).arrayBuffer());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotFoundError') return null;
      throw new WebRepositoryError(
        'DIRECTORY_NOT_WRITABLE',
        'permission',
        '无法读取所选数据目录。',
      );
    }
  }

  public async write(
    relativePath: string,
    bytes: Uint8Array,
    mode: 'create' | 'replace',
  ): Promise<void> {
    assertWriteTarget(relativePath, mode);
    const { directory, name } = await this.#parent(relativePath, true);
    try {
      if (mode === 'create') {
        try {
          await directory.getFileHandle(name);
          throw new WebRepositoryError('REVISION_CONFLICT', 'repository', '目标快照已经存在。');
        } catch (error) {
          if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
        }
      }
      const handle = await directory.getFileHandle(name, { create: true });
      const writable = await handle.createWritable({ keepExistingData: false });
      try {
        await writable.write(new Uint8Array(bytes).buffer);
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
    } catch (error) {
      if (error instanceof WebRepositoryError) throw error;
      throw new WebRepositoryError(
        'DIRECTORY_NOT_WRITABLE',
        'permission',
        '无法写入所选数据目录。',
      );
    }
  }

  async #parent(
    relativePath: string,
    create: boolean,
  ): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
    const parts = [...pathSegments(relativePath)];
    const name = parts.pop();
    if (name === undefined) throw new WebRepositoryError('INVALID_PATH', 'schema', '缺少文件名。');
    let directory = this.root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, { create });
    return { directory, name };
  }
}

export async function queryReadWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  return (
    handle as FileSystemDirectoryHandle & {
      queryPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
    }
  ).queryPermission({ mode: 'readwrite' });
}

export async function requestReadWritePermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState> {
  return (
    handle as FileSystemDirectoryHandle & {
      requestPermission(options: { mode: 'readwrite' }): Promise<PermissionState>;
    }
  ).requestPermission({ mode: 'readwrite' });
}
