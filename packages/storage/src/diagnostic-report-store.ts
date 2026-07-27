import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import type { DiagnosticReportStore } from '@mystery-operations/settings';
import {
  formatManagedRelativePath,
  parseManagedRelativePath,
  sanitizeFileName,
} from '@mystery-operations/shared/storage';

import type { ProjectDataRoot } from './project-data-root.js';

export interface LocalDiagnosticReportStoreOptions {
  readonly randomId?: () => string;
}

export class LocalDiagnosticReportStore implements DiagnosticReportStore {
  readonly #randomId: () => string;
  readonly #root: ProjectDataRoot;

  public constructor(root: ProjectDataRoot, options: LocalDiagnosticReportStoreOptions = {}) {
    this.#root = root;
    this.#randomId = options.randomId ?? randomUUID;
  }

  public async write(content: string, hash: string, createdAt: string): Promise<string> {
    if (!/^[a-f0-9]{64}$/u.test(hash)) {
      throw new TypeError('Diagnostic preview hash is invalid.');
    }
    const directory = join(this.#root.rootPath, 'exports', 'diagnostics');
    mkdirSync(directory, { recursive: true });
    const timestamp = createdAt.replaceAll(':', '-');
    const fileName = sanitizeFileName(
      `basic-diagnostic-${timestamp}-${hash.slice(0, 12)}.json`,
      120,
    );
    const finalPath = join(directory, fileName);
    const temporaryPath = join(directory, `.rednote-diagnostic-${this.#randomId()}.tmp`);
    let handle: number | undefined;
    try {
      handle = openSync(temporaryPath, 'wx', 0o600);
      writeFileSync(handle, content, 'utf8');
      fsyncSync(handle);
      closeSync(handle);
      handle = undefined;
      renameSync(temporaryPath, finalPath);
      const managed = parseManagedRelativePath(`exports/diagnostics/${fileName}`, 'EXPORT');
      return formatManagedRelativePath(managed);
    } catch (error) {
      if (handle !== undefined) {
        closeSync(handle);
      }
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Only the exact temporary file is eligible for cleanup.
      }
      throw error;
    }
  }
}
