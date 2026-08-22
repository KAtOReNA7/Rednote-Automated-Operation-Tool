import {
  V2_SCHEMA_VERSION,
  parseAccountPersona,
  parseContentPackageFields,
  parseWeeklyPlan,
  weekDateRange,
  type AccountPersonaFields,
  type ContentPackageFields,
  type PlanCandidate,
  type WeeklyPlan,
} from '@mystery-operations/v2';

import {
  WEB_WORKSPACE_SCHEMA_VERSION,
  WebRepositoryError,
  parseWebWorkspaceState,
  type WebContentPackage,
  type WebWorkspaceState,
} from './contracts.js';
import { BrowserLocalFolderPort } from './folder-port.js';
import {
  BrowserWorkspaceRepository,
  NavigatorWorkspaceLock,
  type LoadedWorkspace,
  type RepositoryOptions,
} from './repository.js';

export type WebRuntimeErrorLayer =
  'invariant' | 'permission' | 'provider' | 'repository' | 'schema' | 'ui';

export interface RuntimeProblem {
  readonly code: string;
  readonly layer: WebRuntimeErrorLayer;
  readonly message: string;
  readonly recovery: string;
}

export interface ContentQueueItem {
  readonly candidate: PlanCandidate;
  readonly package: WebContentPackage | null;
  readonly state: 'HAS_VERSION' | 'MISSING';
}

export interface GenerationPreview {
  readonly candidateIds: readonly string[];
  readonly inputHash: string;
  readonly maxRequests: 0;
  readonly planRevision: number;
  readonly token: string;
  readonly weekKey: string;
}

export interface RuntimeView {
  readonly directoryName: string;
  readonly generation: number;
  readonly lastProblem: RuntimeProblem | null;
  readonly lastSavedAt: string;
  readonly pendingWrites: number;
  readonly recoveryWarning: string | null;
  readonly snapshotHashPrefix: string;
  readonly state: WebWorkspaceState;
  readonly writeLockState: 'IDLE' | 'WRITING';
}

export interface WeekInvariantFacts {
  readonly activeWeekKey: string;
  readonly contentWeekKey: string | null;
  readonly layer: 'invariant' | null;
  readonly planWeekKey: string | null;
  readonly status: 'PASS' | 'WEEK_IDENTITY_MISMATCH';
}

export interface RuntimeOptions extends Partial<RepositoryOptions> {
  readonly channelFactory?: (name: string) => BroadcastChannel | null;
  readonly createToken?: () => string;
}

const CONTENT_TITLES = [
  ['密室诞生之前', '《莫格街凶杀案》'],
  ['第一部现代侦探长篇', '《月亮宝石》'],
  ['猎犬真的存在吗', '《巴斯克维尔的猎犬》'],
  ['一头红发换来的圈套', '《红发会》'],
  ['黄色房间为何无出口', '《黄色房间的秘密》'],
  ['巴斯克维尔的诅咒传说', '《巴斯克维尔的猎犬》'],
  ['侦探与医生的组合', '《四签名》'],
  ['月亮宝石的离奇失窃', '《月亮宝石》'],
  ['一封旧信里的四个签名', '《四签名》'],
  ['反套路叙述者的魅力', '《月亮宝石》'],
  ['谁在操纵红发会', '《红发会》'],
  ['密室与不在场证明', '《黄色房间的秘密》'],
  ['四签名案件的真相线', '《四签名》'],
  ['猎犬追踪的科学依据', '《巴斯克维尔的猎犬》'],
  ['红发会的幕后主谋', '《红发会》'],
  ['柯南·道尔的创作日常', '《巴斯克维尔的猎犬》'],
  ['月亮宝石的多重身份', '《月亮宝石》'],
  ['黄色房间的空间逻辑', '《黄色房间的秘密》'],
  ['最后的谜题与真相', '《四签名》'],
  ['凶手如何布置密室', '《莫格街凶杀案》'],
  ['侦探小说的冷幽默', '《红发会》'],
] as const;
const TIMES = ['10:00', '14:00', '20:00'] as const;
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

function nextWeekKey(weekKey: string): string {
  const date = new Date(`${weekDateRange(weekKey).startDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 7);
  return BrowserWorkspaceRepository.currentShanghaiWeekKey(date);
}

export function weekInvariantFacts(state: WebWorkspaceState): WeekInvariantFacts {
  const planWeekKey = state.plans[state.activeWeekKey]?.weekKey ?? null;
  const contentWeekKey = state.contentByWeek[state.activeWeekKey]?.weekKey ?? null;
  const status =
    planWeekKey !== null &&
    planWeekKey === state.activeWeekKey &&
    (contentWeekKey === null || contentWeekKey === state.activeWeekKey)
      ? 'PASS'
      : 'WEEK_IDENTITY_MISMATCH';
  return Object.freeze({
    activeWeekKey: state.activeWeekKey,
    contentWeekKey,
    layer: status === 'PASS' ? null : 'invariant',
    planWeekKey,
    status,
  });
}

function buildPlan(weekKey: string): WeeklyPlan {
  const monday = new Date(`${weekDateRange(weekKey).startDate}T00:00:00Z`);
  const candidates = CONTENT_TITLES.map(([title, book], index) => {
    const dayIndex = Math.floor(index / 3);
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + dayIndex);
    return {
      book,
      conflictWithIds: [],
      date: date.toISOString().slice(0, 10),
      day: DAYS[dayIndex] ?? '周一',
      id: `${weekKey.toLowerCase()}-${String(index + 1).padStart(2, '0')}`,
      status: 'PENDING' as const,
      time: TIMES[index % 3] ?? '10:00',
      title,
    };
  });
  return parseWeeklyPlan({
    brief: { revision: 0, text: '' },
    candidates,
    generationBriefRevision: null,
    itemFeedback: [],
    revision: 0,
    schemaVersion: V2_SCHEMA_VERSION,
    status: 'DRAFT',
    weekKey,
  });
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function problem(error: unknown): RuntimeProblem {
  if (error instanceof WebRepositoryError) {
    return {
      code: error.code,
      layer: error.stage,
      message: error.message,
      recovery:
        error.code === 'REVISION_CONFLICT' ? '重新载入后再操作。' : '检查目录权限或导出脱敏诊断。',
    };
  }
  return {
    code: 'LOCAL_OPERATION_FAILED',
    layer: 'ui',
    message: '本地操作未完成。',
    recovery: '重新载入后重试。',
  };
}

export class WebWorkspaceRuntime {
  readonly #channel: BroadcastChannel | null;
  readonly #createToken: () => string;
  readonly #listeners = new Set<() => void>();
  readonly #previews = new Map<string, GenerationPreview>();
  readonly #repository: BrowserWorkspaceRepository;
  #epoch = 0;
  #loaded: LoadedWorkspace;
  #pendingWrites = 0;
  #lastProblem: RuntimeProblem | null = null;

  private constructor(
    repository: BrowserWorkspaceRepository,
    loaded: LoadedWorkspace,
    options: RuntimeOptions,
  ) {
    this.#repository = repository;
    this.#loaded = loaded;
    this.#createToken = options.createToken ?? (() => crypto.randomUUID());
    this.#channel = (options.channelFactory ?? ((name) => new BroadcastChannel(name)))(
      `rednote-web-${loaded.state.workspaceId}`,
    );
    if (this.#channel !== null) this.#channel.onmessage = () => void this.refresh();
  }

  public static async connect(
    handle: FileSystemDirectoryHandle,
    expectedWorkspaceId?: string,
    options: RuntimeOptions = {},
  ): Promise<WebWorkspaceRuntime> {
    const repository = new BrowserWorkspaceRepository(new BrowserLocalFolderPort(handle), {
      ...(options.createId === undefined ? {} : { createId: options.createId }),
      lock: options.lock ?? new NavigatorWorkspaceLock(),
      ...(options.now === undefined ? {} : { now: options.now }),
    });
    return new WebWorkspaceRuntime(
      repository,
      await repository.connect(expectedWorkspaceId),
      options,
    );
  }

  public static async connectPort(
    repository: BrowserWorkspaceRepository,
    options: RuntimeOptions = {},
  ): Promise<WebWorkspaceRuntime> {
    return new WebWorkspaceRuntime(repository, await repository.connect(), options);
  }

  public get view(): RuntimeView {
    return Object.freeze({
      directoryName: this.#repository.folder.displayName,
      generation: this.#loaded.generation,
      lastProblem: this.#lastProblem,
      lastSavedAt: this.#loaded.lastSavedAt,
      pendingWrites: this.#pendingWrites,
      recoveryWarning: this.#loaded.recoveryWarning,
      snapshotHashPrefix: this.#loaded.index.sha256.slice(0, 12),
      state: this.#loaded.state,
      writeLockState: this.#pendingWrites > 0 ? 'WRITING' : 'IDLE',
    });
  }

  public subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  public close(): void {
    this.#channel?.close();
    this.#listeners.clear();
  }

  public queue(): readonly ContentQueueItem[] {
    const state = this.#loaded.state;
    const plan = state.plans[state.activeWeekKey];
    const workspace = state.contentByWeek[state.activeWeekKey];
    if (plan === undefined) return [];
    if (workspace !== undefined && workspace.weekKey !== state.activeWeekKey)
      throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '内容页周身份不一致。');
    const packages = new Map(workspace?.packages.map((item) => [item.candidateId, item]));
    return plan.candidates.map((candidate) => ({
      candidate,
      package: packages.get(candidate.id) ?? null,
      state: packages.has(candidate.id) ? 'HAS_VERSION' : 'MISSING',
    }));
  }

  public async savePersona(fields: AccountPersonaFields, expectedRevision: number): Promise<void> {
    const current = this.#loaded.state.persona;
    if (current.revision !== expectedRevision)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '人设 revision 已变化。');
    const persona = parseAccountPersona({
      ...fields,
      revision: expectedRevision + 1,
      schemaVersion: V2_SCHEMA_VERSION,
    });
    await this.#commit({ ...this.#loaded.state, persona });
  }

  public async ensurePlan(weekKey = this.#loaded.state.activeWeekKey): Promise<void> {
    if (this.#loaded.state.plans[weekKey] !== undefined) return;
    await this.#commit({
      ...this.#loaded.state,
      plans: { ...this.#loaded.state.plans, [weekKey]: buildPlan(weekKey) },
    });
  }

  public async saveBrief(text: string): Promise<void> {
    const plan = this.#activePlan();
    if (plan.status !== 'DRAFT')
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '已锁定计划不能修改 Brief。');
    const next = parseWeeklyPlan({
      ...plan,
      brief: { revision: plan.brief.revision + 1, text },
      revision: plan.revision + 1,
    });
    await this.#savePlan(next);
  }

  public async confirmAllCandidates(): Promise<void> {
    const plan = this.#activePlan();
    if (plan.status !== 'DRAFT')
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '已锁定计划不能再次确认。');
    const next = parseWeeklyPlan({
      ...plan,
      candidates: plan.candidates.map((item) => ({
        ...item,
        status: item.status === 'SKIPPED' ? 'SKIPPED' : 'CONFIRMED',
      })),
      revision: plan.revision + 1,
    });
    await this.#savePlan(next);
  }

  public async lockPlan(): Promise<void> {
    const plan = this.#activePlan();
    if (
      plan.candidates.length !== 21 ||
      plan.candidates.some((item) => item.status !== 'CONFIRMED')
    )
      throw new WebRepositoryError(
        'SCHEMA_INVALID',
        'invariant',
        '必须先确认同周全部 21 个计划项。',
      );
    await this.#savePlan(
      parseWeeklyPlan({ ...plan, revision: plan.revision + 1, status: 'CONFIRMED' }),
    );
  }

  public async switchWeek(weekKey: string): Promise<void> {
    this.#epoch += 1;
    this.#previews.clear();
    await this.#commit({ ...this.#loaded.state, activeWeekKey: weekKey });
  }

  public suggestedNextWeek(): string {
    return nextWeekKey(this.#loaded.state.activeWeekKey);
  }

  public activeWeekHeading(now = new Date()): string {
    const active = this.#loaded.state.activeWeekKey;
    const current = BrowserWorkspaceRepository.currentShanghaiWeekKey(now);
    return active === current
      ? '本周计划'
      : active === nextWeekKey(current)
        ? '下周计划'
        : `${active} 计划`;
  }

  public activeWeekRange(): { readonly endDate: string; readonly startDate: string } {
    return weekDateRange(this.#loaded.state.activeWeekKey);
  }

  public async previewGeneration(candidateIdsValue: readonly string[]): Promise<GenerationPreview> {
    const candidateIds = [...candidateIdsValue];
    if (
      candidateIds.length < 1 ||
      candidateIds.length > 3 ||
      new Set(candidateIds).size !== candidateIds.length
    )
      throw new WebRepositoryError(
        'SCHEMA_INVALID',
        'invariant',
        '每次只能选择 1—3 个不同的待生成项。',
      );
    const plan = this.#activePlan();
    if (plan.status !== 'CONFIRMED')
      throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '计划尚未锁定。');
    const missing = new Set(
      this.queue()
        .filter((item) => item.state === 'MISSING')
        .map((item) => item.candidate.id),
    );
    if (candidateIds.some((id) => !missing.has(id)))
      throw new WebRepositoryError(
        'REVISION_CONFLICT',
        'invariant',
        '候选已生成、跨周或不再可用。',
      );
    const inputHash = await sha256(
      JSON.stringify({
        candidateIds,
        generation: this.#loaded.generation,
        planRevision: plan.revision,
        weekKey: plan.weekKey,
      }),
    );
    const preview: GenerationPreview = Object.freeze({
      candidateIds: Object.freeze(candidateIds),
      inputHash,
      maxRequests: 0,
      planRevision: plan.revision,
      token: this.#createToken(),
      weekKey: plan.weekKey,
    });
    this.#previews.set(preview.token, preview);
    return preview;
  }

  public async executeGeneration(token: string): Promise<void> {
    const preview = this.#previews.get(token);
    this.#previews.delete(token);
    if (preview === undefined)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '生成预览已失效。');
    const plan = this.#activePlan();
    if (
      preview.weekKey !== this.#loaded.state.activeWeekKey ||
      preview.planRevision !== plan.revision
    )
      throw new WebRepositoryError(
        'REVISION_CONFLICT',
        'invariant',
        '活动周或计划 revision 已变化。',
      );
    const expectedHash = await sha256(
      JSON.stringify({
        candidateIds: [...preview.candidateIds],
        generation: this.#loaded.generation,
        planRevision: plan.revision,
        weekKey: plan.weekKey,
      }),
    );
    if (expectedHash !== preview.inputHash)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '生成输入已变化。');
    const queue = new Map(this.queue().map((item) => [item.candidate.id, item]));
    const created = preview.candidateIds.map((candidateId) => {
      const item = queue.get(candidateId);
      if (item === undefined || item.state !== 'MISSING')
        throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '候选不再可生成。');
      const fields = parseContentPackageFields({
        body: `${this.#loaded.state.persona.name} 面向${this.#loaded.state.persona.audience}整理：${item.candidate.title}。这是零费用的本地结构化草稿，可继续编辑；表达遵循“${this.#loaded.state.persona.tone}”，并遵守“${this.#loaded.state.persona.boundary}”。`,
        coverKey: 'morgue',
        materialNotes: `本地计划项 ${candidateId}；未调用模型、Search、Fetch 或图片服务。`,
        suggestedTime: `${item.candidate.date}T${item.candidate.time}`,
        tags: ['推理小说', item.candidate.book.replace(/[《》]/gu, ''), '本地草稿'],
        title: item.candidate.title,
      });
      const id = `pkg-${plan.weekKey.toLowerCase()}-${candidateId}`;
      return {
        candidateId,
        id,
        revision: 0,
        status: 'DRAFT' as const,
        versions: [
          { createdAt: new Date().toISOString(), fields, version: 1, versionId: `${id}-v1` },
        ],
        weekKey: plan.weekKey,
      };
    });
    const current = this.#loaded.state.contentByWeek[plan.weekKey]?.packages ?? [];
    await this.#commit({
      ...this.#loaded.state,
      contentByWeek: {
        ...this.#loaded.state.contentByWeek,
        [plan.weekKey]: { packages: [...current, ...created], weekKey: plan.weekKey },
      },
    });
  }

  public async saveContentVersion(
    packageId: string,
    fieldsValue: ContentPackageFields,
    expectedRevision: number,
  ): Promise<void> {
    const state = this.#loaded.state;
    const workspace = state.contentByWeek[state.activeWeekKey];
    const current = workspace?.packages.find((item) => item.id === packageId);
    if (workspace === undefined || current === undefined || current.revision !== expectedRevision)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '内容版本已变化。');
    const fields = parseContentPackageFields(fieldsValue);
    const version = current.versions.length + 1;
    const next = {
      ...current,
      revision: current.revision + 1,
      status:
        current.status === 'REVIEW_REQUIRED' ? ('REVIEW_REQUIRED' as const) : ('DRAFT' as const),
      versions: [
        ...current.versions,
        {
          createdAt: new Date().toISOString(),
          fields,
          version,
          versionId: `${current.id}-v${version}`,
        },
      ],
    };
    await this.#commit({
      ...state,
      contentByWeek: {
        ...state.contentByWeek,
        [state.activeWeekKey]: {
          ...workspace,
          packages: workspace.packages.map((item) => (item.id === packageId ? next : item)),
        },
      },
    });
  }

  public diagnostics(): Record<string, unknown> {
    const state = this.#loaded.state;
    const plan = state.plans[state.activeWeekKey];
    const content = state.contentByWeek[state.activeWeekKey];
    const buildInfo =
      typeof __REDNOTE_BUILD_INFO__ === 'undefined'
        ? { builtAt: 'test-runtime', commit: 'test-runtime' }
        : __REDNOTE_BUILD_INFO__;
    const identity = weekInvariantFacts(state);
    return {
      activeWeekKey: state.activeWeekKey,
      appVersion: 'web-foundation-1',
      buildCommit: buildInfo.commit,
      builtAt: buildInfo.builtAt,
      browserSupported: typeof window.showDirectoryPicker === 'function',
      content: {
        missingCount: Math.max(0, (plan?.candidates.length ?? 0) - (content?.packages.length ?? 0)),
        packageCount: content?.packages.length ?? 0,
        weekKey: content?.weekKey ?? state.activeWeekKey,
      },
      generation: this.#loaded.generation,
      invariant: identity.status,
      directoryName: this.#repository.folder.displayName,
      directoryPermission: 'GRANTED_FOR_SESSION',
      weekIdentity: identity,
      lastError: this.#lastProblem,
      lastSavedAt: this.#loaded.lastSavedAt,
      pendingWrites: this.#pendingWrites,
      plan: {
        candidateCount: plan?.candidates.length ?? 0,
        revision: plan?.revision ?? null,
        status: plan?.status ?? 'MISSING',
        weekKey: plan?.weekKey ?? state.activeWeekKey,
      },
      repositorySchemaVersion: WEB_WORKSPACE_SCHEMA_VERSION,
      snapshotHashPrefix: this.#loaded.index.sha256.slice(0, 12),
      workspaceIdPrefix: state.workspaceId.slice(0, 12),
      writeLockState: this.#pendingWrites > 0 ? 'WRITING' : 'IDLE',
    };
  }

  public async refresh(): Promise<void> {
    const epoch = this.#epoch;
    const workspaceId = this.#loaded.state.workspaceId;
    const activeWeekKey = this.#loaded.state.activeWeekKey;
    const loaded = await this.#repository.load(workspaceId);
    if (
      epoch !== this.#epoch ||
      activeWeekKey !== this.#loaded.state.activeWeekKey ||
      loaded.generation <= this.#loaded.generation
    )
      return;
    this.#loaded = loaded;
    this.#emit();
  }

  async #savePlan(plan: WeeklyPlan): Promise<void> {
    await this.#commit({
      ...this.#loaded.state,
      plans: { ...this.#loaded.state.plans, [plan.weekKey]: plan },
    });
  }

  #activePlan(): WeeklyPlan {
    const state = this.#loaded.state;
    const plan = state.plans[state.activeWeekKey];
    if (plan === undefined || plan.weekKey !== state.activeWeekKey)
      throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '活动周尚无一致的计划。');
    return plan;
  }

  async #commit(next: WebWorkspaceState): Promise<void> {
    this.#pendingWrites += 1;
    this.#emit();
    try {
      this.#loaded = await this.#repository.commit(
        parseWebWorkspaceState(next),
        this.#loaded.generation,
      );
      this.#lastProblem = null;
      this.#channel?.postMessage({ generation: this.#loaded.generation });
    } catch (error) {
      this.#lastProblem = problem(error);
      throw error;
    } finally {
      this.#pendingWrites -= 1;
      this.#emit();
    }
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: {
      mode?: 'read' | 'readwrite';
    }) => Promise<FileSystemDirectoryHandle>;
  }
}
