import {
  V2_CONTENT_COPY_WIRE_JSON_SCHEMA,
  V2_SCHEMA_VERSION,
  decodeContentCopyWireText,
  mapContentCopyWireToFields,
  normalizeInteractionText,
  parseAccountPersona,
  parseContentPackageFields,
  parseWeeklyPlan,
  weekDateRange,
  type AccountPersonaFields,
  type ContentPackageFields,
  type MetricWindow,
  type MetricsReview,
  type PlanCandidate,
  type WeeklyPlan,
} from '@mystery-operations/v2';
import type {
  RuntimeSchema,
  TextGenerationResult,
} from '../../../../../packages/providers/src/contracts.js';
import { isProviderError } from '../../../../../packages/providers/src/errors.js';

import {
  WEB_WORKSPACE_SCHEMA_VERSION,
  WebRepositoryError,
  parseWebWorkspaceState,
  type WebContentPackage,
  type WebWorkspaceState,
} from './contracts.js';
import {
  BrowserChatCompletionsProvider,
  type WebProviderPurpose,
  type WebTextProviderPort,
} from './browser-provider.js';
import { BrowserLocalFolderPort } from './folder-port.js';
import {
  BrowserWorkspaceRepository,
  NavigatorWorkspaceLock,
  type LoadedWorkspace,
  type RepositoryOptions,
} from './repository.js';
import {
  WEB_W2_LIMITS,
  metricsReview,
  parseCatalogImport,
  parseClipImport,
  type WebCatalogImport,
  type WebClipImport,
  type WebInteractionKind,
  type WebMetricVersion,
  type WebProviderSettings,
} from './w2-state.js';

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
  readonly nowMs?: () => number;
  readonly providerPort?: WebTextProviderPort;
}

export type WebAiActionKind = 'CAPABILITY_PROBE' | 'CONTENT_COPY' | 'REPLY_SUGGESTION';

export interface WebAiPreview {
  readonly blockers: readonly string[];
  readonly canConfirm: boolean;
  readonly estimatedCostMicrounits: number | null;
  readonly fetchEnabled: false;
  readonly inputHash: string;
  readonly kind: WebAiActionKind;
  readonly maxRequests: 1;
  readonly modelId: string | null;
  readonly searchEnabled: false;
  readonly targetId: string;
  readonly token: string;
  readonly workspaceGeneration: number;
}

export interface WebAiResult {
  readonly fields: ContentPackageFields | null;
  readonly kind: WebAiActionKind;
  readonly modelId: string;
  readonly targetId: string;
  readonly text: string;
  readonly usage: Readonly<{
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
  }>;
}

export interface WebImportPreview {
  readonly duplicateCount: number;
  readonly itemCount: number;
  readonly kind: 'CATALOG' | 'CLIPPER';
  readonly sourceLabel: string;
  readonly token: string;
}

export interface WebDeletePreview {
  readonly itemId: string;
  readonly physicalDeletion: false;
  readonly token: string;
  readonly tombstone: true;
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

const CONTENT_COPY_SCHEMA: RuntimeSchema<unknown> = Object.freeze({
  decodeText: decodeContentCopyWireText,
  id: 'web_content_copy',
  jsonSchema: V2_CONTENT_COPY_WIRE_JSON_SCHEMA,
  strictObject: true,
  validate: (value: unknown) => {
    const decoded = decodeContentCopyWireText(JSON.stringify(value));
    return decoded.ok
      ? { ok: true as const, value: decoded.value }
      : { issues: decoded.issues, ok: false as const };
  },
  version: 1,
});

const CAPABILITY_SCHEMA: RuntimeSchema<unknown> = Object.freeze({
  id: 'web_capability_probe',
  jsonSchema: Object.freeze({
    additionalProperties: false,
    properties: { supported: { type: 'boolean' } },
    required: ['supported'],
    type: 'object',
  }),
  strictObject: true,
  validate: (value: unknown) =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    (value as { supported?: unknown }).supported === true
      ? { ok: true as const, value }
      : {
          issues: [
            {
              actualType: Array.isArray(value) ? 'array' : typeof value,
              code: 'CAPABILITY_PROBE_INVALID',
              expectedType: 'object{supported:true}',
              path: [],
            },
          ],
          ok: false as const,
        },
  version: 1,
});

interface StoredAiPreview extends WebAiPreview {
  readonly revision: number;
}

interface StoredImportPreview extends WebImportPreview {
  readonly contentHash: string;
  readonly generation: number;
  readonly parsed: WebCatalogImport | WebClipImport;
}

function usage(result: TextGenerationResult): WebAiResult['usage'] {
  return Object.freeze({
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
  });
}

function problem(error: unknown): RuntimeProblem {
  if (isProviderError(error)) {
    return {
      code: error.code,
      layer: 'provider',
      message: `AI 服务未完成：${error.code}`,
      recovery: '检查设置、CORS 与网络后重新预览；系统不会自动重试。',
    };
  }
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
  readonly #aiPreviews = new Map<string, StoredAiPreview>();
  readonly #channel: BroadcastChannel | null;
  readonly #createToken: () => string;
  readonly #deletePreviews = new Map<
    string,
    { readonly itemId: string; readonly revision: number }
  >();
  readonly #importPreviews = new Map<string, StoredImportPreview>();
  readonly #listeners = new Set<() => void>();
  readonly #nowMs: () => number;
  readonly #previews = new Map<string, GenerationPreview>();
  readonly #providerPort: WebTextProviderPort;
  readonly #repository: BrowserWorkspaceRepository;
  #epoch = 0;
  #loaded: LoadedWorkspace;
  #pendingWrites = 0;
  #lastProblem: RuntimeProblem | null = null;
  #sessionApiKey: string | null = null;

  private constructor(
    repository: BrowserWorkspaceRepository,
    loaded: LoadedWorkspace,
    options: RuntimeOptions,
  ) {
    this.#repository = repository;
    this.#loaded = loaded;
    this.#createToken = options.createToken ?? (() => crypto.randomUUID());
    this.#nowMs = options.nowMs ?? Date.now;
    this.#providerPort = options.providerPort ?? new BrowserChatCompletionsProvider();
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
    this.#sessionApiKey = null;
    this.#aiPreviews.clear();
    this.#deletePreviews.clear();
    this.#importPreviews.clear();
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
          {
            createdAt: new Date(this.#nowMs()).toISOString(),
            fields,
            modelId: null,
            source: 'LOCAL' as const,
            usage: null,
            version: 1,
            versionId: `${id}-v1`,
          },
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
          createdAt: new Date(this.#nowMs()).toISOString(),
          fields,
          modelId: null,
          source: 'LOCAL' as const,
          usage: null,
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

  public hasSessionApiKey(): boolean {
    return this.#sessionApiKey !== null;
  }

  public setSessionApiKey(value: string): void {
    if (
      value.trim() !== value ||
      value.length < 8 ||
      value.length > 4_096 ||
      Array.from(value).some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127;
      })
    )
      throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '会话 API key 格式无效。');
    this.#sessionApiKey = value;
    this.#aiPreviews.clear();
    this.#emit();
  }

  public clearSessionApiKey(): void {
    this.#sessionApiKey = null;
    this.#aiPreviews.clear();
    this.#emit();
  }

  public async saveProviderSettings(
    draft: Omit<WebProviderSettings, 'capabilityCheckedAt' | 'revision' | 'structuredJson'>,
    expectedRevision: number,
  ): Promise<void> {
    const current = this.#loaded.state.provider;
    if (current.revision !== expectedRevision)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', 'AI 设置已变化。');
    const changed =
      current.baseUrl !== draft.baseUrl || current.writingModelId !== draft.writingModelId;
    await this.#commit({
      ...this.#loaded.state,
      provider: {
        ...draft,
        capabilityCheckedAt: changed ? null : current.capabilityCheckedAt,
        revision: expectedRevision + 1,
        structuredJson: changed
          ? current.structuredJson === 'UNKNOWN'
            ? 'UNKNOWN'
            : 'STALE'
          : current.structuredJson,
      },
    });
    this.#aiPreviews.clear();
  }

  public async previewProviderAction(
    kind: WebAiActionKind,
    targetId: string,
  ): Promise<WebAiPreview> {
    const revision = this.#targetRevision(kind, targetId);
    const inputHash = await this.#aiInputHash(kind, targetId, revision);
    const provider = this.#loaded.state.provider;
    const blockers: string[] = [];
    if (provider.baseUrl === null) blockers.push('尚未配置 HTTPS Base URL。');
    if (provider.writingModelId === null) blockers.push('尚未配置写作模型 ID。');
    if (this.#sessionApiKey === null) blockers.push('本次页面会话尚未输入 API key。');
    if (kind !== 'CAPABILITY_PROBE' && provider.structuredJson !== 'SUPPORTED')
      blockers.push('结构化文本能力尚未确认支持。');
    if (
      provider.estimatedCostPerCallMicrounits === null ||
      provider.budgetPerCallMicrounits === null
    )
      blockers.push('单次费用上界或预算尚未配置。');
    else if (provider.estimatedCostPerCallMicrounits > provider.budgetPerCallMicrounits)
      blockers.push('单次费用上界超过当前预算。');
    const preview: StoredAiPreview = Object.freeze({
      blockers: Object.freeze(blockers),
      canConfirm: blockers.length === 0,
      estimatedCostMicrounits: provider.estimatedCostPerCallMicrounits,
      fetchEnabled: false,
      inputHash,
      kind,
      maxRequests: 1,
      modelId: provider.writingModelId,
      revision,
      searchEnabled: false,
      targetId,
      token: this.#createToken(),
      workspaceGeneration: this.#loaded.generation,
    });
    this.#aiPreviews.set(preview.token, preview);
    return preview;
  }

  public async executeProviderAction(token: string): Promise<WebAiResult> {
    const preview = this.#aiPreviews.get(token);
    this.#aiPreviews.delete(token);
    if (preview === undefined)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', 'AI 预览已失效。');
    if (!preview.canConfirm)
      throw new WebRepositoryError(
        'SCHEMA_INVALID',
        'invariant',
        preview.blockers[0] ?? 'AI 未就绪。',
      );
    const currentHash = await this.#aiInputHash(preview.kind, preview.targetId, preview.revision);
    if (
      preview.workspaceGeneration !== this.#loaded.generation ||
      preview.inputHash !== currentHash
    )
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', 'AI 输入或本地状态已变化。');
    const provider = this.#loaded.state.provider;
    const apiKey = this.#sessionApiKey;
    if (provider.baseUrl === null || provider.writingModelId === null || apiKey === null)
      throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', 'AI 会话设置不完整。');
    const prompts = this.#providerPrompts(preview.kind, preview.targetId);
    let result: TextGenerationResult;
    try {
      result = await this.#providerPort.generate({
        apiKey,
        baseUrl: provider.baseUrl,
        modelId: provider.writingModelId,
        purpose: preview.kind as WebProviderPurpose,
        ...(preview.kind === 'CAPABILITY_PROBE' || preview.kind === 'CONTENT_COPY'
          ? {
              schema: preview.kind === 'CAPABILITY_PROBE' ? CAPABILITY_SCHEMA : CONTENT_COPY_SCHEMA,
            }
          : {}),
        system: prompts.system,
        user: prompts.user,
      });
      this.#lastProblem = null;
    } catch (error) {
      this.#lastProblem = problem(error);
      this.#emit();
      throw error;
    }
    if (result.refusal !== null || result.outputTruncated)
      throw new WebRepositoryError('SCHEMA_INVALID', 'schema', 'AI 输出被拒绝或截断。');
    if (preview.kind === 'CAPABILITY_PROBE') {
      let value: unknown;
      try {
        value = JSON.parse(result.text) as unknown;
      } catch {
        value = null;
      }
      if (
        typeof value !== 'object' ||
        value === null ||
        Array.isArray(value) ||
        (value as { supported?: unknown }).supported !== true
      )
        throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '能力检查输出不符合合同。');
      await this.#commit({
        ...this.#loaded.state,
        provider: {
          ...this.#loaded.state.provider,
          capabilityCheckedAt: new Date(this.#nowMs()).toISOString(),
          revision: this.#loaded.state.provider.revision + 1,
          structuredJson: 'SUPPORTED',
        },
      });
      return Object.freeze({
        fields: null,
        kind: preview.kind,
        modelId: result.modelId,
        targetId: preview.targetId,
        text: '',
        usage: usage(result),
      });
    }
    if (preview.kind === 'CONTENT_COPY') {
      const decoded = decodeContentCopyWireText(result.text);
      if (!decoded.ok) {
        const issue = decoded.issues[0];
        throw new WebRepositoryError(
          'SCHEMA_INVALID',
          'schema',
          `文案输出字段不符合合同：${issue?.path.join('.') || 'root'}。`,
        );
      }
      const queue = this.queue().find((item) => item.package?.id === preview.targetId);
      if (queue === undefined)
        throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '内容包已变化。');
      return Object.freeze({
        fields: mapContentCopyWireToFields(
          decoded.value,
          queue.candidate,
          this.#loaded.state.activeWeekKey,
        ),
        kind: preview.kind,
        modelId: result.modelId,
        targetId: preview.targetId,
        text: '',
        usage: usage(result),
      });
    }
    return Object.freeze({
      fields: null,
      kind: preview.kind,
      modelId: result.modelId,
      targetId: preview.targetId,
      text: normalizeInteractionText(result.text, WEB_W2_LIMITS.replyBytes, 'replyText'),
      usage: usage(result),
    });
  }

  public async saveModelContentResult(
    result: WebAiResult,
    expectedRevision: number,
  ): Promise<void> {
    if (result.kind !== 'CONTENT_COPY' || result.fields === null)
      throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '不是可保存的文案结果。');
    const state = this.#loaded.state;
    const workspace = state.contentByWeek[state.activeWeekKey];
    const current = workspace?.packages.find((item) => item.id === result.targetId);
    if (workspace === undefined || current === undefined || current.revision !== expectedRevision)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '内容版本已变化。');
    const version = current.versions.length + 1;
    const next = {
      ...current,
      revision: current.revision + 1,
      status: 'REVIEW_REQUIRED' as const,
      versions: [
        ...current.versions,
        {
          createdAt: new Date(this.#nowMs()).toISOString(),
          fields: parseContentPackageFields(result.fields),
          modelId: result.modelId,
          source: 'MODEL' as const,
          usage: result.usage,
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
          packages: workspace.packages.map((item) => (item.id === current.id ? next : item)),
        },
      },
    });
  }

  public async approveContent(packageId: string, expectedRevision: number): Promise<void> {
    const state = this.#loaded.state;
    const workspace = state.contentByWeek[state.activeWeekKey];
    const current = workspace?.packages.find((item) => item.id === packageId);
    if (workspace === undefined || current === undefined || current.revision !== expectedRevision)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '内容版本已变化。');
    const latest = current.versions.at(-1);
    if (latest === undefined)
      throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '内容版本缺失。');
    const version = latest.version + 1;
    const next = {
      ...current,
      revision: current.revision + 1,
      status: 'APPROVED' as const,
      versions: [
        ...current.versions,
        {
          ...latest,
          createdAt: new Date(this.#nowMs()).toISOString(),
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

  public async createInteraction(input: {
    readonly kind: WebInteractionKind;
    readonly relatedContentPackageId: string | null;
    readonly userText: string;
  }): Promise<{ readonly duplicate: boolean; readonly itemId: string }> {
    const userText = normalizeInteractionText(
      input.userText,
      WEB_W2_LIMITS.interactionBytes,
      'userText',
    );
    if (
      input.relatedContentPackageId !== null &&
      !this.#allPackages().some((item) => item.id === input.relatedContentPackageId)
    )
      throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '关联内容包不存在。');
    const dedupKey = await sha256(
      JSON.stringify([input.kind, input.relatedContentPackageId, userText]),
    );
    const duplicate = this.#loaded.state.interactions.find((item) => item.dedupKey === dedupKey);
    if (duplicate !== undefined) return { duplicate: true, itemId: duplicate.itemId };
    const itemId = `interaction-${dedupKey.slice(0, 20)}`;
    await this.#commit({
      ...this.#loaded.state,
      interactions: [
        ...this.#loaded.state.interactions,
        {
          createdAt: new Date(this.#nowMs()).toISOString(),
          currentSuggestionVersionId: null,
          dedupKey,
          itemId,
          kind: input.kind,
          manualSentAt: null,
          relatedContentPackageId: input.relatedContentPackageId,
          replies: [],
          revision: 0,
          status: 'NEW',
          userText,
        },
      ],
    });
    return { duplicate: false, itemId };
  }

  public async saveReplyResult(result: WebAiResult, expectedRevision: number): Promise<void> {
    if (result.kind !== 'REPLY_SUGGESTION')
      throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '不是可保存的回复建议。');
    await this.#appendReply(
      result.targetId,
      expectedRevision,
      result.text,
      'MODEL',
      result.modelId,
    );
  }

  public async saveManualReply(
    itemId: string,
    expectedRevision: number,
    text: string,
  ): Promise<void> {
    await this.#appendReply(itemId, expectedRevision, text, 'MANUAL', null);
  }

  public async confirmInteractions(
    items: readonly {
      readonly expectedRevision: number;
      readonly expectedVersionId: string;
      readonly itemId: string;
    }[],
  ): Promise<void> {
    if (items.length < 1 || items.length > 40)
      throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '批量确认数量无效。');
    const ids = new Set(items.map((item) => item.itemId));
    if (ids.size !== items.length)
      throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '批量确认包含重复互动。');
    for (const ref of items) {
      const current = this.#interaction(ref.itemId, ref.expectedRevision);
      if (
        current.status !== 'SUGGESTED' ||
        current.currentSuggestionVersionId !== ref.expectedVersionId
      )
        throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '回复建议版本已变化。');
    }
    await this.#commit({
      ...this.#loaded.state,
      interactions: this.#loaded.state.interactions.map((item) =>
        ids.has(item.itemId)
          ? { ...item, revision: item.revision + 1, status: 'CONFIRMED' as const }
          : item,
      ),
    });
  }

  public previewDeleteInteraction(itemId: string): WebDeletePreview {
    const current = this.#interaction(itemId);
    if (current.status === 'DELETED')
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '互动已删除。');
    const token = this.#createToken();
    this.#deletePreviews.set(token, { itemId, revision: current.revision });
    return Object.freeze({ itemId, physicalDeletion: false, token, tombstone: true });
  }

  public async confirmDeleteInteraction(token: string): Promise<void> {
    const preview = this.#deletePreviews.get(token);
    this.#deletePreviews.delete(token);
    if (preview === undefined)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '删除预览已失效。');
    await this.transitionInteraction(preview.itemId, preview.revision, 'DELETE');
  }

  public async transitionInteraction(
    itemId: string,
    expectedRevision: number,
    action: 'CONFIRM' | 'DELETE' | 'MARK_MANUAL_SENT' | 'REOPEN' | 'SKIP' | 'UNDO_MANUAL_SENT',
  ): Promise<void> {
    const current = this.#interaction(itemId, expectedRevision);
    const allowed: Readonly<Record<typeof action, readonly string[]>> = {
      CONFIRM: ['SUGGESTED'],
      DELETE: ['CONFIRMED', 'MANUAL_SENT', 'NEW', 'SKIPPED', 'SUGGESTED'],
      MARK_MANUAL_SENT: ['CONFIRMED'],
      REOPEN: ['SKIPPED'],
      SKIP: ['NEW', 'SUGGESTED'],
      UNDO_MANUAL_SENT: ['MANUAL_SENT'],
    };
    if (!allowed[action].includes(current.status))
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '互动状态已变化。');
    const status = {
      CONFIRM: 'CONFIRMED',
      DELETE: 'DELETED',
      MARK_MANUAL_SENT: 'MANUAL_SENT',
      REOPEN: current.replies.length > 0 ? 'SUGGESTED' : 'NEW',
      SKIP: 'SKIPPED',
      UNDO_MANUAL_SENT: 'CONFIRMED',
    }[action] as (typeof current)['status'];
    await this.#commit({
      ...this.#loaded.state,
      interactions: this.#loaded.state.interactions.map((item) =>
        item.itemId === itemId
          ? {
              ...item,
              manualSentAt:
                action === 'MARK_MANUAL_SENT'
                  ? new Date(this.#nowMs()).toISOString()
                  : action === 'UNDO_MANUAL_SENT'
                    ? null
                    : item.manualSentAt,
              revision: item.revision + 1,
              status,
            }
          : item,
      ),
    });
  }

  public async previewLibraryImport(
    raw: string,
    kind: 'CATALOG' | 'CLIPPER',
  ): Promise<WebImportPreview> {
    const maximum = kind === 'CATALOG' ? WEB_W2_LIMITS.catalogBytes : WEB_W2_LIMITS.clipBytes;
    if (new TextEncoder().encode(raw).byteLength > maximum)
      throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '导入文件超过大小上限。');
    let value: unknown;
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '导入文件不是有效 JSON。');
    }
    const parsed = kind === 'CATALOG' ? parseCatalogImport(value) : parseClipImport(value);
    if (
      kind === 'CLIPPER' &&
      (parsed as WebClipImport).clipIdentity !== (await sha256((parsed as WebClipImport).sourceUrl))
    )
      throw new WebRepositoryError(
        'SCHEMA_INVALID',
        'schema',
        'Clip identity 与规范化来源 URL 不一致。',
      );
    const contentHash = await sha256(
      kind === 'CLIPPER'
        ? JSON.stringify({ ...(parsed as WebClipImport), capturedAt: null })
        : JSON.stringify(parsed),
    );
    const duplicateCount =
      kind === 'CATALOG'
        ? (parsed as WebCatalogImport).items.filter((item) =>
            this.#loaded.state.library.some((stored) => stored.id === item.id),
          ).length
        : this.#loaded.state.clipReceipts.some(
              (receipt) => receipt.clipIdentity === (parsed as WebClipImport).clipIdentity,
            )
          ? 1
          : 0;
    const preview: StoredImportPreview = Object.freeze({
      contentHash,
      duplicateCount,
      generation: this.#loaded.generation,
      itemCount: kind === 'CATALOG' ? (parsed as WebCatalogImport).items.length : 1,
      kind,
      parsed,
      sourceLabel:
        kind === 'CATALOG'
          ? '本地 Catalog JSON'
          : new URL((parsed as WebClipImport).sourceUrl).hostname,
      token: this.#createToken(),
    });
    this.#importPreviews.set(preview.token, preview);
    return preview;
  }

  public async confirmLibraryImport(token: string): Promise<{ readonly imported: number }> {
    const preview = this.#importPreviews.get(token);
    this.#importPreviews.delete(token);
    if (preview === undefined || preview.generation !== this.#loaded.generation)
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '导入预览已失效。');
    const now = new Date(this.#nowMs()).toISOString();
    if (preview.kind === 'CATALOG') {
      const catalog = preview.parsed as WebCatalogImport;
      const additions = catalog.items.filter((incoming) => {
        const existing = this.#loaded.state.library.find((item) => item.id === incoming.id);
        if (existing === undefined) return true;
        if (
          existing.sourceKind !== 'CATALOG' ||
          existing.title !== incoming.title ||
          existing.author !== incoming.author ||
          existing.summary !== incoming.summary ||
          existing.sourcePath !== incoming.sourcePath
        )
          throw new WebRepositoryError(
            'REVISION_CONFLICT',
            'invariant',
            '同一书库 ID 的内容冲突。',
          );
        return false;
      });
      if (additions.length > 0)
        await this.#commit({
          ...this.#loaded.state,
          library: [
            ...this.#loaded.state.library,
            ...additions.map((item) => ({
              ...item,
              clipIdentity: null,
              createdAt: now,
              revision: 0,
              screenshotDataUrl: null,
              sourceKind: 'CATALOG' as const,
              sourceOrigin: null,
            })),
          ],
        });
      return { imported: additions.length };
    }
    const clip = preview.parsed as WebClipImport;
    const receipt = this.#loaded.state.clipReceipts.find(
      (item) => item.clipIdentity === clip.clipIdentity,
    );
    if (receipt !== undefined) {
      if (receipt.contentHash !== preview.contentHash)
        throw new WebRepositoryError(
          'REVISION_CONFLICT',
          'invariant',
          '同一 Clip 身份的内容冲突。',
        );
      return { imported: 0 };
    }
    const itemId = `clip-${clip.clipIdentity.slice(0, 20)}`;
    await this.#commit({
      ...this.#loaded.state,
      clipReceipts: [
        ...this.#loaded.state.clipReceipts,
        {
          clipIdentity: clip.clipIdentity,
          contentHash: preview.contentHash,
          importedAt: now,
          itemId,
        },
      ],
      library: [
        ...this.#loaded.state.library,
        {
          author: null,
          clipIdentity: clip.clipIdentity,
          createdAt: now,
          id: itemId,
          revision: 0,
          screenshotDataUrl: clip.screenshotDataUrl,
          sourceKind: 'CLIPPER',
          sourceOrigin: new URL(clip.sourceUrl).origin,
          sourcePath: null,
          summary:
            [clip.selectedText, clip.userNote].filter(Boolean).join('\n\n') || '仅保存页面标题。',
          title: clip.pageTitle,
        },
      ],
    });
    return { imported: 1 };
  }

  public async saveMetric(input: Omit<WebMetricVersion, 'revision'>): Promise<void> {
    const revisions = this.#loaded.state.metricSnapshots
      .filter(
        (item) =>
          item.packageId === input.packageId && item.snapshotWindow === input.snapshotWindow,
      )
      .map((item) => item.revision);
    await this.#commit({
      ...this.#loaded.state,
      metricSnapshots: [
        ...this.#loaded.state.metricSnapshots,
        { ...input, revision: Math.max(-1, ...revisions) + 1 },
      ],
    });
  }

  public metrics(window: MetricWindow): MetricsReview {
    return metricsReview(
      this.#loaded.state.metricSnapshots,
      new Map(
        this.#allPackages().map((item) => [item.id, item.versions.at(-1)?.fields.title ?? item.id]),
      ),
      window,
    );
  }

  public async decideStrategy(
    review: MetricsReview,
    status: 'ACCEPTED' | 'REJECTED',
  ): Promise<void> {
    const fingerprint = await sha256(JSON.stringify(review));
    const existing = this.#loaded.state.strategyDecisions.find(
      (item) => item.fingerprint === fingerprint,
    );
    await this.#commit({
      ...this.#loaded.state,
      strategyDecisions: existing
        ? this.#loaded.state.strategyDecisions.map((item) =>
            item.id === existing.id
              ? {
                  ...item,
                  decidedAt: new Date(this.#nowMs()).toISOString(),
                  revision: item.revision + 1,
                  status,
                }
              : item,
          )
        : [
            ...this.#loaded.state.strategyDecisions,
            {
              decidedAt: new Date(this.#nowMs()).toISOString(),
              fingerprint,
              id: `strategy-${fingerprint.slice(0, 20)}`,
              revision: 0,
              status,
            },
          ],
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
      appVersion: 'web-functional-equivalence-2',
      buildCommit: buildInfo.commit,
      builtAt: buildInfo.builtAt,
      browserSupported:
        typeof globalThis.window !== 'undefined' &&
        typeof globalThis.window.showDirectoryPicker === 'function',
      content: {
        missingCount: Math.max(0, (plan?.candidates.length ?? 0) - (content?.packages.length ?? 0)),
        packageCount: content?.packages.length ?? 0,
        weekKey: content?.weekKey ?? state.activeWeekKey,
      },
      generation: this.#loaded.generation,
      invariant: identity.status,
      directoryPermission: 'GRANTED_FOR_SESSION',
      weekIdentity: identity,
      lastError: this.#lastProblem,
      lastSavedAt: this.#loaded.lastSavedAt,
      pendingWrites: this.#pendingWrites,
      provider: {
        capability: state.provider.structuredJson,
        configured: state.provider.baseUrl !== null && state.provider.writingModelId !== null,
        keyConfiguredForSession: this.#sessionApiKey !== null,
        revision: state.provider.revision,
      },
      records: {
        clipReceiptCount: state.clipReceipts.length,
        interactionCount: state.interactions.filter((item) => item.status !== 'DELETED').length,
        libraryCount: state.library.length,
        metricVersionCount: state.metricSnapshots.length,
        strategyDecisionCount: state.strategyDecisions.length,
      },
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

  #allPackages(): readonly WebContentPackage[] {
    return Object.values(this.#loaded.state.contentByWeek).flatMap((workspace) => [
      ...workspace.packages,
    ]);
  }

  async #aiInputHash(kind: WebAiActionKind, targetId: string, revision: number): Promise<string> {
    return sha256(
      JSON.stringify({
        generation: this.#loaded.generation,
        kind,
        providerRevision: this.#loaded.state.provider.revision,
        revision,
        targetId,
        workspaceId: this.#loaded.state.workspaceId,
      }),
    );
  }

  #targetRevision(kind: WebAiActionKind, targetId: string): number {
    if (kind === 'CAPABILITY_PROBE') {
      if (targetId !== 'provider-settings')
        throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '能力检查目标无效。');
      return this.#loaded.state.provider.revision;
    }
    if (kind === 'CONTENT_COPY') {
      const item = this.#allPackages().find((candidate) => candidate.id === targetId);
      if (item === undefined)
        throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '内容包不存在。');
      return item.revision;
    }
    return this.#interaction(targetId).revision;
  }

  #providerPrompts(
    kind: WebAiActionKind,
    targetId: string,
  ): { readonly system: string; readonly user: string } {
    if (kind === 'CAPABILITY_PROBE') {
      return {
        system: '只返回严格 JSON 对象，不要解释。',
        user: '返回 {"supported":true}，用于确认结构化 JSON 输出能力。',
      };
    }
    if (kind === 'CONTENT_COPY') {
      const queue = this.queue().find((item) => item.package?.id === targetId);
      if (queue === undefined)
        throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '内容包不在活动周。');
      const persona = this.#loaded.state.persona;
      return {
        system:
          '你是推理小说内容编辑。只返回包含 title、body、tags、materialNotes 的一个 JSON 对象；不添加说明，不生成封面、置顶评论或平台操作。',
        user: `选题：${queue.candidate.title}\n作品：${queue.candidate.book}\n受众：${persona.audience}\n语气：${persona.tone}\n边界：${persona.boundary}`,
      };
    }
    const item = this.#interaction(targetId);
    return {
      system:
        '生成一条简洁中文回复建议，只返回回复正文；不得声称已经发送，不得执行评论或私信操作。',
      user: `账号：${this.#loaded.state.persona.name}\n语气：${this.#loaded.state.persona.tone}\n类型：${item.kind === 'COMMENT' ? '评论' : '私信'}\n用户原文：${item.userText}`,
    };
  }

  #interaction(itemId: string, expectedRevision?: number) {
    const item = this.#loaded.state.interactions.find((candidate) => candidate.itemId === itemId);
    if (
      item === undefined ||
      (expectedRevision !== undefined && item.revision !== expectedRevision)
    )
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '互动项已变化。');
    return item;
  }

  async #appendReply(
    itemId: string,
    expectedRevision: number,
    value: string,
    source: 'MANUAL' | 'MODEL',
    modelId: string | null,
  ): Promise<void> {
    const current = this.#interaction(itemId, expectedRevision);
    if (!['NEW', 'SKIPPED', 'SUGGESTED'].includes(current.status))
      throw new WebRepositoryError('REVISION_CONFLICT', 'invariant', '当前互动不能追加建议。');
    const text = normalizeInteractionText(value, WEB_W2_LIMITS.replyBytes, 'replyText');
    const version = current.replies.length + 1;
    const versionId = `${current.itemId}-v${version}`;
    await this.#commit({
      ...this.#loaded.state,
      interactions: this.#loaded.state.interactions.map((item) =>
        item.itemId === itemId
          ? {
              ...item,
              currentSuggestionVersionId: versionId,
              replies: [
                ...item.replies,
                {
                  createdAt: new Date(this.#nowMs()).toISOString(),
                  modelId,
                  source,
                  text,
                  version,
                  versionId,
                },
              ],
              revision: item.revision + 1,
              status: 'SUGGESTED' as const,
            }
          : item,
      ),
    });
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
