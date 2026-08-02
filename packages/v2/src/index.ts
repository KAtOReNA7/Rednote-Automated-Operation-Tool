export const V2_SCHEMA_VERSION = 1 as const;
export const V2_DEFAULT_WEEK_KEY = '2026-W31' as const;
export const V2_IPC_CHANNELS = Object.freeze({
  mutate: 'v2:workspace:mutate',
  read: 'v2:workspace:read',
} as const);
export const V2_LIMITS = Object.freeze({
  candidateCount: 40,
  candidateId: 64,
  candidateText: 200,
  personaBoundary: 1_000,
  personaText: 500,
  requestBytes: 32_768,
} as const);

export interface AccountPersonaFields {
  readonly audience: string;
  readonly boundary: string;
  readonly name: string;
  readonly tone: string;
}

export interface AccountPersona extends AccountPersonaFields {
  readonly revision: number;
  readonly schemaVersion: typeof V2_SCHEMA_VERSION;
}

export type PlanCandidateStatus = 'CONFLICT' | 'CONFIRMED' | 'EXPORTED' | 'PENDING' | 'PLANNED';

export interface PlanCandidate {
  readonly book: string;
  readonly date: string;
  readonly day: string;
  readonly id: string;
  readonly status: PlanCandidateStatus;
  readonly time: string;
  readonly title: string;
}

export interface WeeklyPlan {
  readonly candidates: readonly PlanCandidate[];
  readonly revision: number;
  readonly schemaVersion: typeof V2_SCHEMA_VERSION;
  readonly status: 'CONFIRMED' | 'DRAFT';
  readonly weekKey: string;
}

export interface V2WorkspaceSummary {
  readonly conflictCount: number;
  readonly confirmedCount: number;
  readonly pendingCount: number;
  readonly personaRevision: number;
  readonly planRevision: number;
}

export type V2ReadRequest =
  { readonly view: 'ACCOUNT_PERSONA' } | { readonly view: 'WEEKLY_PLAN'; readonly weekKey: string };

export type V2MutationRequest =
  | {
      readonly action: 'UPDATE_PERSONA';
      readonly expectedRevision: number;
      readonly persona: AccountPersonaFields;
    }
  | {
      readonly action: 'CONFIRM_PLAN_CANDIDATES';
      readonly candidateIds: readonly string[];
      readonly expectedRevision: number;
      readonly weekKey: string;
    }
  | {
      readonly action: 'RESCHEDULE_PLAN_CANDIDATES';
      readonly candidateIds: readonly string[];
      readonly date: string;
      readonly day: string;
      readonly expectedRevision: number;
      readonly time: string;
      readonly weekKey: string;
    };

export interface V2ExceptionSummary {
  readonly affectedFields: readonly string[];
  readonly code: 'INVALID_REQUEST' | 'PERSISTENCE_UNAVAILABLE' | 'REVISION_CONFLICT';
  readonly message: string;
  readonly severity: 'ERROR' | 'WARNING';
  readonly suggestedAction: string;
}

export type V2Result<T> =
  | { readonly error: V2ExceptionSummary; readonly ok: false }
  | { readonly ok: true; readonly value: T };

export interface V2Bridge {
  readonly confirmPlanCandidates: (input: {
    readonly candidateIds: readonly string[];
    readonly expectedRevision: number;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly readPersona: () => Promise<V2Result<AccountPersona>>;
  readonly readWeeklyPlan: (input: { readonly weekKey: string }) => Promise<V2Result<WeeklyPlan>>;
  readonly reschedulePlanCandidates: (input: {
    readonly candidateIds: readonly string[];
    readonly date: string;
    readonly day: string;
    readonly expectedRevision: number;
    readonly time: string;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly updatePersona: (input: {
    readonly expectedRevision: number;
    readonly persona: AccountPersonaFields;
  }) => Promise<V2Result<AccountPersona>>;
}

export class V2ContractError extends Error {
  public readonly affectedFields: readonly string[];
  public readonly code: V2ExceptionSummary['code'];

  public constructor(code: V2ExceptionSummary['code'], affectedFields: readonly string[] = []) {
    super(code);
    this.name = 'V2ContractError';
    this.code = code;
    this.affectedFields = affectedFields;
  }
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
}

function assertRequestSize(value: unknown): void {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new V2ContractError('INVALID_REQUEST');
  }
  if (serialized === undefined || utf8Bytes(serialized) > V2_LIMITS.requestBytes) {
    throw new V2ContractError('INVALID_REQUEST');
  }
}

function boundedText(value: unknown, maximum: number, field: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    utf8Bytes(value) > maximum ||
    /(?:^|\s)file:/iu.test(value) ||
    /^(?:[a-z]:|[\\/])/iu.test(value) ||
    /\\\\|\/\//u.test(value)
  ) {
    throw new V2ContractError('INVALID_REQUEST', [field]);
  }
  return value;
}

function revision(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new V2ContractError('INVALID_REQUEST', ['expectedRevision']);
  }
  return value;
}

function weekKey(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/u.test(value)) {
    throw new V2ContractError('INVALID_REQUEST', ['weekKey']);
  }
  return value;
}

export function parseAccountPersonaFields(value: unknown): AccountPersonaFields {
  if (!isRecord(value) || !exactKeys(value, ['audience', 'boundary', 'name', 'tone'])) {
    throw new V2ContractError('INVALID_REQUEST', ['persona']);
  }
  return {
    audience: boundedText(value.audience, V2_LIMITS.personaText, 'audience'),
    boundary: boundedText(value.boundary, V2_LIMITS.personaBoundary, 'boundary'),
    name: boundedText(value.name, 80, 'name'),
    tone: boundedText(value.tone, V2_LIMITS.personaText, 'tone'),
  };
}

export function parseAccountPersona(value: unknown): AccountPersona {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['audience', 'boundary', 'name', 'revision', 'schemaVersion', 'tone']) ||
    value.schemaVersion !== V2_SCHEMA_VERSION
  ) {
    throw new V2ContractError('INVALID_REQUEST', ['persona']);
  }
  return {
    ...parseAccountPersonaFields({
      audience: value.audience,
      boundary: value.boundary,
      name: value.name,
      tone: value.tone,
    }),
    revision: revision(value.revision),
    schemaVersion: V2_SCHEMA_VERSION,
  };
}

const candidateStatuses = new Set<PlanCandidateStatus>([
  'CONFLICT',
  'CONFIRMED',
  'EXPORTED',
  'PENDING',
  'PLANNED',
]);
const days = new Set(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);

function parseCandidate(value: unknown): PlanCandidate {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['book', 'date', 'day', 'id', 'status', 'time', 'title']) ||
    !candidateStatuses.has(value.status as PlanCandidateStatus) ||
    typeof value.day !== 'string' ||
    !days.has(value.day) ||
    typeof value.date !== 'string' ||
    !/^(?:[1-9]|1[0-2])\/(?:[1-9]|[12]\d|3[01])$/u.test(value.date) ||
    typeof value.time !== 'string' ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.time)
  ) {
    throw new V2ContractError('INVALID_REQUEST', ['candidates']);
  }
  return {
    book: boundedText(value.book, V2_LIMITS.candidateText, 'book'),
    date: value.date,
    day: value.day,
    id: boundedText(value.id, V2_LIMITS.candidateId, 'id'),
    status: value.status as PlanCandidateStatus,
    time: value.time,
    title: boundedText(value.title, V2_LIMITS.candidateText, 'title'),
  };
}

export function parseWeeklyPlan(value: unknown): WeeklyPlan {
  if (
    !isRecord(value) ||
    !exactKeys(value, ['candidates', 'revision', 'schemaVersion', 'status', 'weekKey']) ||
    value.schemaVersion !== V2_SCHEMA_VERSION ||
    (value.status !== 'DRAFT' && value.status !== 'CONFIRMED') ||
    !Array.isArray(value.candidates) ||
    value.candidates.length === 0 ||
    value.candidates.length > V2_LIMITS.candidateCount
  ) {
    throw new V2ContractError('INVALID_REQUEST', ['weeklyPlan']);
  }
  const candidates = value.candidates.map(parseCandidate);
  if (new Set(candidates.map(({ id }) => id)).size !== candidates.length) {
    throw new V2ContractError('INVALID_REQUEST', ['candidateIds']);
  }
  return {
    candidates,
    revision: revision(value.revision),
    schemaVersion: V2_SCHEMA_VERSION,
    status: value.status,
    weekKey: weekKey(value.weekKey),
  };
}

export function parseV2ReadRequest(value: unknown): V2ReadRequest {
  assertRequestSize(value);
  if (!isRecord(value)) throw new V2ContractError('INVALID_REQUEST');
  if (value.view === 'ACCOUNT_PERSONA' && exactKeys(value, ['view'])) {
    return { view: 'ACCOUNT_PERSONA' };
  }
  if (value.view === 'WEEKLY_PLAN' && exactKeys(value, ['view', 'weekKey'])) {
    return { view: 'WEEKLY_PLAN', weekKey: weekKey(value.weekKey) };
  }
  throw new V2ContractError('INVALID_REQUEST');
}

function candidateIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > V2_LIMITS.candidateCount) {
    throw new V2ContractError('INVALID_REQUEST', ['candidateIds']);
  }
  const ids = value.map((id) => boundedText(id, V2_LIMITS.candidateId, 'candidateIds'));
  if (new Set(ids).size !== ids.length) {
    throw new V2ContractError('INVALID_REQUEST', ['candidateIds']);
  }
  return ids;
}

export function parseV2MutationRequest(value: unknown): V2MutationRequest {
  assertRequestSize(value);
  if (!isRecord(value)) throw new V2ContractError('INVALID_REQUEST');
  if (
    value.action === 'UPDATE_PERSONA' &&
    exactKeys(value, ['action', 'expectedRevision', 'persona'])
  ) {
    return {
      action: 'UPDATE_PERSONA',
      expectedRevision: revision(value.expectedRevision),
      persona: parseAccountPersonaFields(value.persona),
    };
  }
  if (
    value.action === 'CONFIRM_PLAN_CANDIDATES' &&
    exactKeys(value, ['action', 'candidateIds', 'expectedRevision', 'weekKey'])
  ) {
    return {
      action: 'CONFIRM_PLAN_CANDIDATES',
      candidateIds: candidateIds(value.candidateIds),
      expectedRevision: revision(value.expectedRevision),
      weekKey: weekKey(value.weekKey),
    };
  }
  if (
    value.action === 'RESCHEDULE_PLAN_CANDIDATES' &&
    exactKeys(value, [
      'action',
      'candidateIds',
      'date',
      'day',
      'expectedRevision',
      'time',
      'weekKey',
    ]) &&
    typeof value.day === 'string' &&
    days.has(value.day) &&
    typeof value.date === 'string' &&
    /^(?:[1-9]|1[0-2])\/(?:[1-9]|[12]\d|3[01])$/u.test(value.date) &&
    typeof value.time === 'string' &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value.time)
  ) {
    return {
      action: 'RESCHEDULE_PLAN_CANDIDATES',
      candidateIds: candidateIds(value.candidateIds),
      date: value.date,
      day: value.day,
      expectedRevision: revision(value.expectedRevision),
      time: value.time,
      weekKey: weekKey(value.weekKey),
    };
  }
  throw new V2ContractError('INVALID_REQUEST');
}

type PlanRow = readonly [string, string, string, string, string, string, PlanCandidateStatus];
// prettier-ignore
const defaultPlanRows: readonly PlanRow[] = [
  ['mon-1','周一','7/27','10:00','密室诞生之前','《莫格街凶杀案》','EXPORTED'], ['mon-2','周一','7/27','14:00','第一部现代侦探长篇','《月亮宝石》','EXPORTED'], ['mon-3','周一','7/27','20:00','猎犬真的存在吗','《巴斯克维尔的猎犬》','PLANNED'],
  ['tue-1','周二','7/28','10:00','一头红发换来的圈套','《红发会》','EXPORTED'], ['tue-2','周二','7/28','14:00','黄色房间为何无出口','《黄色房间的秘密》','PLANNED'], ['tue-3','周二','7/28','20:00','巴斯克维尔的诅咒传说','《巴斯克维尔的猎犬》','PLANNED'],
  ['wed-1','周三','7/29','10:00','侦探与医生的组合','《四签名》','EXPORTED'], ['wed-2','周三','7/29','14:00','月亮宝石的离奇失窃','《月亮宝石》','PLANNED'], ['wed-3','周三','7/29','20:00','一封旧信里的四个签名','《四签名》','PLANNED'],
  ['thu-1','周四','7/30','10:00','反套路叙述者的魅力','《月亮宝石》','PENDING'], ['thu-2','周四','7/30','14:00','谁在操纵红发会','《红发会》','EXPORTED'], ['thu-3','周四','7/30','20:00','密室与不在场证明','《黄色房间的秘密》','PLANNED'],
  ['fri-1','周五','7/31','10:00','四签名案件的真相线','《四签名》','EXPORTED'], ['fri-2','周五','7/31','14:00','猎犬追踪的科学依据','《巴斯克维尔的猎犬》','PLANNED'], ['fri-3','周五','7/31','20:00','红发会的幕后主谋','《红发会》','CONFLICT'],
  ['sat-1','周六','8/1','10:00','柯南·道尔的创作日常','《巴斯克维尔的猎犬》','EXPORTED'], ['sat-2','周六','8/1','14:00','月亮宝石的多重身份','《月亮宝石》','EXPORTED'], ['sat-3','周六','8/1','20:00','黄色房间的空间逻辑','《黄色房间的秘密》','PLANNED'],
  ['sun-1','周日','8/2','10:00','最后的谜题与真相','《四签名》','PLANNED'], ['sun-2','周日','8/2','14:00','凶手如何布置密室','《莫格街凶杀案》','PENDING'], ['sun-3','周日','8/2','20:00','侦探小说的冷幽默','《红发会》','PENDING'],
];

export const DEFAULT_ACCOUNT_PERSONA: AccountPersona = Object.freeze({
  audience: '喜欢悬疑、推理与文化内容的普通读者',
  boundary: '不提前揭示关键凶手；完整诡计前给醒目剧透警告',
  name: '雾灯书页',
  revision: 0,
  schemaVersion: V2_SCHEMA_VERSION,
  tone: '理性、短句、观点鲜明、少量冷幽默',
});
export const DEFAULT_WEEKLY_PLAN: WeeklyPlan = Object.freeze({
  candidates: Object.freeze(
    defaultPlanRows.map(([id, day, date, time, title, book, status]) =>
      Object.freeze({ book, date, day, id, status, time, title }),
    ),
  ),
  revision: 0,
  schemaVersion: V2_SCHEMA_VERSION,
  status: 'DRAFT',
  weekKey: V2_DEFAULT_WEEK_KEY,
});

export function summarizeV2Workspace(
  persona: AccountPersona,
  plan: WeeklyPlan,
): V2WorkspaceSummary {
  const validatedPersona = parseAccountPersona(persona);
  const validatedPlan = parseWeeklyPlan(plan);
  return Object.freeze({
    conflictCount: validatedPlan.candidates.filter(({ status }) => status === 'CONFLICT').length,
    confirmedCount: validatedPlan.candidates.filter(({ status }) => status === 'CONFIRMED').length,
    pendingCount: validatedPlan.candidates.filter(({ status }) => status === 'PENDING').length,
    personaRevision: validatedPersona.revision,
    planRevision: validatedPlan.revision,
  });
}

export interface V2RepositoryPort {
  readonly getOrCreatePersona: (seed: AccountPersona) => AccountPersona;
  readonly getOrCreateWeeklyPlan: (seed: WeeklyPlan, personaSeed: AccountPersona) => WeeklyPlan;
  readonly savePersona: (persona: AccountPersonaFields, expectedRevision: number) => AccountPersona;
  readonly saveWeeklyPlan: (plan: WeeklyPlan, expectedRevision: number) => WeeklyPlan;
}

export class V2ApplicationFacade {
  readonly #repository: V2RepositoryPort;

  public constructor(repository: V2RepositoryPort) {
    this.#repository = repository;
  }

  public read(value: unknown): AccountPersona | WeeklyPlan {
    const request = parseV2ReadRequest(value);
    return request.view === 'ACCOUNT_PERSONA'
      ? this.#repository.getOrCreatePersona(DEFAULT_ACCOUNT_PERSONA)
      : this.#repository.getOrCreateWeeklyPlan(
          { ...DEFAULT_WEEKLY_PLAN, weekKey: request.weekKey },
          DEFAULT_ACCOUNT_PERSONA,
        );
  }

  public mutate(value: unknown): AccountPersona | WeeklyPlan {
    const request = parseV2MutationRequest(value);
    if (request.action === 'UPDATE_PERSONA') {
      this.#repository.getOrCreatePersona(DEFAULT_ACCOUNT_PERSONA);
      return this.#repository.savePersona(request.persona, request.expectedRevision);
    }
    const current = this.#repository.getOrCreateWeeklyPlan(
      { ...DEFAULT_WEEKLY_PLAN, weekKey: request.weekKey },
      DEFAULT_ACCOUNT_PERSONA,
    );
    const selected = new Set(request.candidateIds);
    if (request.candidateIds.some((id) => !current.candidates.some((item) => item.id === id))) {
      throw new V2ContractError('INVALID_REQUEST', ['candidateIds']);
    }
    const candidates = current.candidates.map((item) =>
      !selected.has(item.id)
        ? item
        : request.action === 'CONFIRM_PLAN_CANDIDATES'
          ? { ...item, status: 'CONFIRMED' as const }
          : { ...item, date: request.date, day: request.day, time: request.time },
    );
    const status = candidates.some(({ status: itemStatus }) =>
      itemStatus === 'PENDING' || itemStatus === 'CONFLICT' ? true : false,
    )
      ? 'DRAFT'
      : 'CONFIRMED';
    return this.#repository.saveWeeklyPlan(
      parseWeeklyPlan({ ...current, candidates, status }),
      request.expectedRevision,
    );
  }
}

export function toV2Exception(error: unknown): V2ExceptionSummary {
  if (error instanceof V2ContractError) {
    const conflict = error.code === 'REVISION_CONFLICT';
    const unavailable = error.code === 'PERSISTENCE_UNAVAILABLE';
    return {
      affectedFields: error.affectedFields,
      code: error.code,
      message: conflict
        ? '本机数据已更新，请重新载入后再试。'
        : unavailable
          ? '本机保存暂时不可用。'
          : '请求内容不符合本地合同。',
      severity: conflict ? 'WARNING' : 'ERROR',
      suggestedAction: conflict
        ? '重新载入当前页面'
        : unavailable
          ? '关闭后重新启动应用'
          : '检查字段后重试',
    };
  }
  return {
    affectedFields: [],
    code: 'PERSISTENCE_UNAVAILABLE',
    message: '本机保存暂时不可用。',
    severity: 'ERROR',
    suggestedAction: '关闭后重新启动应用',
  };
}
