import { WebRepositoryError } from '../../apps/web-ui/src/v2/web/contracts.js';
import {
  assertWriteTarget,
  pathSegments,
  type LocalFolderPort,
} from '../../apps/web-ui/src/v2/web/folder-port.js';
import type { WorkspaceLock } from '../../apps/web-ui/src/v2/web/repository.js';

export class MemoryFolder implements LocalFolderPort {
  public readonly displayName = '合成 RednoteData';
  public failPath: string | null = null;
  public readonly files = new Map<string, Uint8Array>();
  public writes = 0;

  public async read(path: string): Promise<Uint8Array | null> {
    pathSegments(path);
    const value = this.files.get(path);
    return value === undefined ? null : new Uint8Array(value);
  }

  public async write(path: string, bytes: Uint8Array, mode: 'create' | 'replace'): Promise<void> {
    assertWriteTarget(path, mode);
    if (this.failPath === path) throw new Error('SYNTHETIC_INTERRUPTION');
    if (mode === 'create' && this.files.has(path)) throw new Error('EXISTS');
    this.writes += 1;
    this.files.set(path, new Uint8Array(bytes));
  }

  public corrupt(path: string): void {
    this.files.set(path, new TextEncoder().encode('{"truncated":'));
  }
}

export class MemoryLock implements WorkspaceLock {
  public available = true;
  public async run<T>(_workspaceId: string, operation: () => Promise<T>): Promise<T> {
    if (!this.available) throw new WebRepositoryError('WRITE_LOCKED', 'repository', 'busy');
    this.available = false;
    try {
      return await operation();
    } finally {
      this.available = true;
    }
  }
}
