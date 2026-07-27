import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { isAbsolute, join, parse, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

import {
  type PreparedProjectRoot,
  type ProjectLocatorRecord,
  type ProjectLocatorState,
  type ProjectLocatorStore,
  SettingsError,
} from '@mystery-operations/settings';

import { openProjectDataRoot } from './project-data-root.js';

export const PROJECT_LOCATOR_FORMAT = 'rednote-project-locator' as const;
export const PROJECT_LOCATOR_VERSION = 1 as const;
export const PROJECT_LOCATOR_SUBDIRECTORY = 'local-settings' as const;
export const PROJECT_LOCATOR_FILE = 'project-locator.json' as const;

export interface LocalProjectLocatorOptions {
  readonly beforePublish?: () => void;
  readonly randomId?: () => string;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
}

function parseRecord(value: unknown): ProjectLocatorRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new SettingsError('PROJECT_LOCATOR_INVALID');
  }
  const record = value as Readonly<Record<string, unknown>>;
  if (
    !exactKeys(record, [
      'activeDataRoot',
      'format',
      'projectInstanceId',
      'revision',
      'updatedAt',
      'version',
    ]) ||
    record.format !== PROJECT_LOCATOR_FORMAT ||
    record.version !== PROJECT_LOCATOR_VERSION ||
    typeof record.activeDataRoot !== 'string' ||
    !isAbsolute(record.activeDataRoot) ||
    record.activeDataRoot !== resolve(record.activeDataRoot) ||
    resolve(record.activeDataRoot) === parse(resolve(record.activeDataRoot)).root ||
    typeof record.projectInstanceId !== 'string' ||
    record.projectInstanceId.length < 8 ||
    typeof record.revision !== 'number' ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 0 ||
    typeof record.updatedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(record.updatedAt)
  ) {
    throw new SettingsError('PROJECT_LOCATOR_INVALID');
  }
  return record as unknown as ProjectLocatorRecord;
}

function syncDirectory(path: string): void {
  let handle: number | undefined;
  try {
    handle = openSync(path, 'r');
    fsyncSync(handle);
  } catch (error) {
    if (process.platform !== 'win32' || (!isErrno(error, 'EPERM') && !isErrno(error, 'EINVAL'))) {
      throw error;
    }
  } finally {
    if (handle !== undefined) {
      closeSync(handle);
    }
  }
}

export class LocalProjectLocator implements ProjectLocatorStore {
  readonly #beforePublish?: () => void;
  readonly #directory: string;
  readonly #path: string;
  readonly #randomId: () => string;

  public constructor(userDataPath: string, options: LocalProjectLocatorOptions = {}) {
    if (!isAbsolute(userDataPath) || resolve(userDataPath) === parse(resolve(userDataPath)).root) {
      throw new SettingsError('PROJECT_LOCATOR_INVALID');
    }
    this.#directory = join(resolve(userDataPath), PROJECT_LOCATOR_SUBDIRECTORY);
    this.#path = join(this.#directory, PROJECT_LOCATOR_FILE);
    this.#randomId = options.randomId ?? randomUUID;
    if (options.beforePublish !== undefined) {
      this.#beforePublish = options.beforePublish;
    }
  }

  public async read(): Promise<ProjectLocatorState> {
    if (!existsSync(this.#path)) {
      return { status: 'NOT_CONFIGURED' };
    }
    let record: ProjectLocatorRecord;
    try {
      const status = lstatSync(this.#path);
      if (!status.isFile() || status.isSymbolicLink()) {
        throw new SettingsError('PROJECT_LOCATOR_INVALID');
      }
      record = parseRecord(JSON.parse(readFileSync(this.#path, 'utf8')) as unknown);
    } catch (error) {
      return {
        code: error instanceof SettingsError ? error.code : ('PROJECT_LOCATOR_INVALID' as const),
        status: 'RECOVERY_REQUIRED',
      };
    }
    if (!existsSync(record.activeDataRoot)) {
      return { code: 'PROJECT_ROOT_MISSING', status: 'RECOVERY_REQUIRED' };
    }
    try {
      const root = await openProjectDataRoot(record.activeDataRoot);
      if (root.marker.instanceId !== record.projectInstanceId) {
        return { code: 'PROJECT_INSTANCE_MISMATCH', status: 'RECOVERY_REQUIRED' };
      }
      return {
        displayPath: record.activeDataRoot,
        record,
        status: 'READY',
      };
    } catch {
      return { code: 'PROJECT_LOCATOR_INVALID', status: 'RECOVERY_REQUIRED' };
    }
  }

  public async activate(
    root: PreparedProjectRoot,
    expectedRevision: number | null,
    updatedAt: string,
  ): Promise<ProjectLocatorRecord> {
    const current = await this.read();
    const currentRevision = current.status === 'READY' ? current.record.revision : null;
    if (current.status === 'RECOVERY_REQUIRED' || currentRevision !== expectedRevision) {
      throw new SettingsError('DATA_ROOT_SWITCH_CONFLICT', { retryable: true });
    }
    if (root.instanceId.length < 8 || !isAbsolute(root.rootPath)) {
      throw new SettingsError('DATA_ROOT_SELECTION_INVALID');
    }
    const verified = await openProjectDataRoot(root.rootPath);
    if (verified.marker.instanceId !== root.instanceId) {
      throw new SettingsError('PROJECT_INSTANCE_MISMATCH');
    }
    const record: ProjectLocatorRecord = {
      activeDataRoot: verified.rootPath,
      format: PROJECT_LOCATOR_FORMAT,
      projectInstanceId: verified.marker.instanceId,
      revision: (currentRevision ?? -1) + 1,
      updatedAt,
      version: PROJECT_LOCATOR_VERSION,
    };
    mkdirSync(this.#directory, { recursive: true });
    const temporaryPath = join(this.#directory, `.project-locator-${this.#randomId()}.tmp`);
    let handle: number | undefined;
    try {
      handle = openSync(temporaryPath, 'wx', 0o600);
      writeFileSync(handle, `${JSON.stringify(record)}\n`, 'utf8');
      fsyncSync(handle);
      closeSync(handle);
      handle = undefined;
      this.#beforePublish?.();
      renameSync(temporaryPath, this.#path);
      syncDirectory(this.#directory);
      return record;
    } catch (error) {
      if (handle !== undefined) {
        closeSync(handle);
      }
      try {
        unlinkSync(temporaryPath);
      } catch (cleanupError) {
        if (!isErrno(cleanupError, 'ENOENT')) {
          // Preserve the original failure and leave existing locator untouched.
        }
      }
      throw new SettingsError('DATA_ROOT_SWITCH_CONFLICT', {
        cause: error,
        retryable: true,
      });
    }
  }
}

export function projectLocatorPathForTesting(userDataPath: string): string {
  return join(resolve(userDataPath), PROJECT_LOCATOR_SUBDIRECTORY, PROJECT_LOCATOR_FILE);
}
