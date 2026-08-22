import { DEFAULT_ACCOUNT_PERSONA } from '@mystery-operations/v2';

import {
  WEB_WORKSPACE_FORMAT,
  WEB_WORKSPACE_SCHEMA_VERSION,
  WebRepositoryError,
  newWorkspaceState,
  parseWebIndex,
  parseWebManifest,
  parseWebSnapshot,
  parseWebWorkspaceState,
  type WebSnapshotEnvelope,
  type WebWorkspaceIndex,
  type WebWorkspaceManifest,
  type WebWorkspaceState,
} from './contracts.js';
import type { LocalFolderPort } from './folder-port.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const MANIFEST_PATH = 'rednote-workspace.json';
const INDEX_PATHS = ['state/index-a.json', 'state/index-b.json'] as const;
const INITIAL_SNAPSHOT_PATH = 'state/snapshots/00000001.json';

export interface WorkspaceLock {
  run<T>(workspaceId: string, operation: () => Promise<T>): Promise<T>;
}

export interface LoadedWorkspace {
  readonly generation: number;
  readonly index: WebWorkspaceIndex;
  readonly lastSavedAt: string;
  readonly recoveryWarning: string | null;
  readonly state: WebWorkspaceState;
}

export interface RepositoryOptions {
  readonly createId?: () => string;
  readonly lock: WorkspaceLock;
  readonly now?: () => Date;
}

async function digest(bytes: Uint8Array): Promise<string> {
  const value = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer);
  return [...new Uint8Array(value)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function encode(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function decode(bytes: Uint8Array): unknown {
  return JSON.parse(decoder.decode(bytes)) as unknown;
}

export class NavigatorWorkspaceLock implements WorkspaceLock {
  public async run<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
    if (navigator.locks === undefined) {
      throw new WebRepositoryError('WRITE_LOCKED', 'repository', '浏览器不支持安全写锁。');
    }
    let result: T | undefined;
    await navigator.locks.request(
      `rednote-workspace-${workspaceId}`,
      { ifAvailable: true, mode: 'exclusive' },
      async (lock) => {
        if (lock === null)
          throw new WebRepositoryError(
            'WRITE_LOCKED',
            'repository',
            '另一个标签页正在保存，请稍后重试。',
          );
        result = await operation();
      },
    );
    if (result === undefined)
      throw new WebRepositoryError('WRITE_LOCKED', 'repository', '未能取得安全写锁。');
    return result;
  }
}

export class BrowserWorkspaceRepository {
  readonly #createId: () => string;
  readonly #lock: WorkspaceLock;
  readonly #now: () => Date;

  public constructor(
    readonly folder: LocalFolderPort,
    options: RepositoryOptions,
  ) {
    this.#createId = options.createId ?? (() => `ws_${crypto.randomUUID().replaceAll('-', '')}`);
    this.#lock = options.lock;
    this.#now = options.now ?? (() => new Date());
  }

  public async connect(expectedWorkspaceId?: string): Promise<LoadedWorkspace> {
    const manifestBytes = await this.folder.read(MANIFEST_PATH);
    if (manifestBytes === null) {
      if (expectedWorkspaceId !== undefined)
        throw new WebRepositoryError(
          'INVALID_WORKSPACE',
          'repository',
          '重新选择的目录不是原工作区。',
        );
      const manifest: WebWorkspaceManifest = {
        createdAt: this.#now().toISOString(),
        format: WEB_WORKSPACE_FORMAT,
        schemaVersion: WEB_WORKSPACE_SCHEMA_VERSION,
        workspaceId: this.#createId(),
      };
      const activeWeekKey = BrowserWorkspaceRepository.currentShanghaiWeekKey(this.#now());
      await this.folder.write(MANIFEST_PATH, encode(manifest), 'create');
      return this.#writeInitial(
        newWorkspaceState(manifest.workspaceId, activeWeekKey, DEFAULT_ACCOUNT_PERSONA),
      );
    }
    let manifest: WebWorkspaceManifest;
    try {
      manifest = parseWebManifest(decode(manifestBytes));
    } catch (error) {
      if (error instanceof WebRepositoryError) throw error;
      throw new WebRepositoryError('INVALID_WORKSPACE', 'schema', '工作区标识文件已损坏。');
    }
    if (expectedWorkspaceId !== undefined && manifest.workspaceId !== expectedWorkspaceId) {
      throw new WebRepositoryError(
        'INVALID_WORKSPACE',
        'repository',
        '重新选择的目录与原工作区身份不一致。',
      );
    }
    try {
      return await this.load(manifest.workspaceId);
    } catch (error) {
      if (!(error instanceof WebRepositoryError) || error.code !== 'RECOVERY_FAILED') throw error;
      return this.#resumeInitialization(manifest);
    }
  }

  public async load(workspaceId: string): Promise<LoadedWorkspace> {
    const candidates: { index: WebWorkspaceIndex; slot: string }[] = [];
    let invalidIndex = false;
    for (const slot of INDEX_PATHS) {
      const bytes = await this.folder.read(slot);
      if (bytes === null) continue;
      try {
        const index = parseWebIndex(decode(bytes));
        if (index.workspaceId !== workspaceId) throw new Error('identity');
        candidates.push({ index, slot });
      } catch {
        invalidIndex = true;
      }
    }
    candidates.sort((left, right) => right.index.generation - left.index.generation);
    let invalidSnapshot = false;
    for (const candidate of candidates) {
      const snapshotBytes = await this.folder.read(candidate.index.snapshotPath);
      if (
        snapshotBytes === null ||
        snapshotBytes.byteLength !== candidate.index.bytes ||
        (await digest(snapshotBytes)) !== candidate.index.sha256
      ) {
        invalidSnapshot = true;
        continue;
      }
      try {
        const snapshot = parseWebSnapshot(decode(snapshotBytes));
        if (
          snapshot.workspaceId !== workspaceId ||
          snapshot.generation !== candidate.index.generation
        )
          throw new Error('identity');
        return {
          generation: snapshot.generation,
          index: candidate.index,
          lastSavedAt: snapshot.savedAt,
          recoveryWarning: invalidIndex || invalidSnapshot ? '已回退到上一份可验证状态。' : null,
          state: snapshot.state,
        };
      } catch {
        invalidSnapshot = true;
      }
    }
    throw new WebRepositoryError(
      'RECOVERY_FAILED',
      'repository',
      '没有可验证的状态快照；原目录未被覆盖。',
    );
  }

  public async commit(
    nextValue: WebWorkspaceState,
    expectedGeneration: number,
  ): Promise<LoadedWorkspace> {
    const next = parseWebWorkspaceState(nextValue);
    return this.#lock.run(next.workspaceId, async () => {
      const current = await this.load(next.workspaceId);
      if (current.generation !== expectedGeneration) {
        throw new WebRepositoryError(
          'REVISION_CONFLICT',
          'repository',
          '工作区已被其他标签页更新，请先刷新。',
        );
      }
      return this.#write(next, expectedGeneration + 1);
    });
  }

  async #writeInitial(state: WebWorkspaceState): Promise<LoadedWorkspace> {
    return this.#lock.run(state.workspaceId, () => this.#write(state, 1));
  }

  async #resumeInitialization(manifest: WebWorkspaceManifest): Promise<LoadedWorkspace> {
    return this.#lock.run(manifest.workspaceId, async () => {
      try {
        return await this.load(manifest.workspaceId);
      } catch (error) {
        if (!(error instanceof WebRepositoryError) || error.code !== 'RECOVERY_FAILED') throw error;
      }

      const indexBytes = await Promise.all(INDEX_PATHS.map((path) => this.folder.read(path)));
      let hasValidIndex = false;
      for (const bytes of indexBytes) {
        if (bytes === null) continue;
        let index: WebWorkspaceIndex;
        try {
          index = parseWebIndex(decode(bytes));
        } catch {
          continue;
        }
        if (
          index.workspaceId !== manifest.workspaceId ||
          index.generation !== 1 ||
          index.snapshotPath !== INITIAL_SNAPSHOT_PATH
        ) {
          throw this.#initialRecoveryFailure();
        }
        hasValidIndex = true;
      }
      if (hasValidIndex) throw this.#initialRecoveryFailure();

      const initialState = this.#initialState(manifest);
      const snapshotBytes = await this.folder.read(INITIAL_SNAPSHOT_PATH);
      if (snapshotBytes === null) {
        if (indexBytes.some((bytes) => bytes !== null)) throw this.#initialRecoveryFailure();
        const loaded = await this.#write(initialState, 1);
        return { ...loaded, recoveryWarning: '已安全续接未完成的首次初始化。' };
      }

      let snapshot: WebSnapshotEnvelope;
      try {
        snapshot = parseWebSnapshot(decode(snapshotBytes));
      } catch {
        throw this.#initialRecoveryFailure();
      }
      if (
        snapshot.generation !== 1 ||
        snapshot.workspaceId !== manifest.workspaceId ||
        snapshot.state.workspaceId !== manifest.workspaceId ||
        snapshot.state.activeWeekKey !== initialState.activeWeekKey ||
        Object.keys(snapshot.state.plans).length !== 0 ||
        Object.keys(snapshot.state.contentByWeek).length !== 0 ||
        JSON.stringify(snapshot.state.persona) !== JSON.stringify(initialState.persona)
      ) {
        throw this.#initialRecoveryFailure();
      }

      const index: WebWorkspaceIndex = {
        bytes: snapshotBytes.byteLength,
        generation: 1,
        schemaVersion: WEB_WORKSPACE_SCHEMA_VERSION,
        sha256: await digest(snapshotBytes),
        snapshotPath: INITIAL_SNAPSHOT_PATH,
        workspaceId: manifest.workspaceId,
      };
      await this.folder.write(INDEX_PATHS[0], encode(index), 'replace');
      const loaded = await this.load(manifest.workspaceId);
      return { ...loaded, recoveryWarning: '已安全续接未完成的首次初始化。' };
    });
  }

  #initialState(manifest: WebWorkspaceManifest): WebWorkspaceState {
    const createdAt = new Date(manifest.createdAt);
    if (!Number.isFinite(createdAt.getTime())) throw this.#initialRecoveryFailure();
    return newWorkspaceState(
      manifest.workspaceId,
      BrowserWorkspaceRepository.currentShanghaiWeekKey(createdAt),
      DEFAULT_ACCOUNT_PERSONA,
    );
  }

  #initialRecoveryFailure(): WebRepositoryError {
    return new WebRepositoryError(
      'RECOVERY_FAILED',
      'repository',
      '首次初始化材料无法安全证明；原目录未被覆盖。',
    );
  }

  async #write(state: WebWorkspaceState, generation: number): Promise<LoadedWorkspace> {
    const snapshot: WebSnapshotEnvelope = {
      generation,
      savedAt: this.#now().toISOString(),
      schemaVersion: WEB_WORKSPACE_SCHEMA_VERSION,
      state,
      workspaceId: state.workspaceId,
    };
    const snapshotBytes = encode(snapshot);
    const snapshotPath = `state/snapshots/${String(generation).padStart(8, '0')}.json`;
    await this.folder.write(snapshotPath, snapshotBytes, 'create');
    const readback = await this.folder.read(snapshotPath);
    if (
      readback === null ||
      readback.byteLength !== snapshotBytes.byteLength ||
      (await digest(readback)) !== (await digest(snapshotBytes))
    ) {
      throw new WebRepositoryError(
        'DIRECTORY_NOT_WRITABLE',
        'repository',
        '新快照写入后校验失败，上一状态保持有效。',
      );
    }
    parseWebSnapshot(decode(readback));
    const index: WebWorkspaceIndex = {
      bytes: snapshotBytes.byteLength,
      generation,
      schemaVersion: WEB_WORKSPACE_SCHEMA_VERSION,
      sha256: await digest(snapshotBytes),
      snapshotPath,
      workspaceId: state.workspaceId,
    };
    await this.folder.write(
      INDEX_PATHS[(generation - 1) % 2] ?? INDEX_PATHS[0],
      encode(index),
      'replace',
    );
    return { generation, index, lastSavedAt: snapshot.savedAt, recoveryWarning: null, state };
  }

  public static currentShanghaiWeekKey(now = new Date()): string {
    const parts = new Intl.DateTimeFormat('en-CA', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
    }).formatToParts(now);
    const find = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
    const date = new Date(`${find('year')}-${find('month')}-${find('day')}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 3 - ((date.getUTCDay() + 6) % 7));
    const first = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
    first.setUTCDate(first.getUTCDate() + 3 - ((first.getUTCDay() + 6) % 7));
    const week = 1 + Math.round((date.getTime() - first.getTime()) / 604_800_000);
    return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
  }
}
