export const V2_PROVIDER_ACTION_KINDS = Object.freeze([
  'WEEKLY_PLAN',
  'CONTENT_PACKAGES',
  'CONTENT_COPY_VERSION',
  'CONTENT_COVER',
  'REPLY_SUGGESTION',
] as const);
export type V2ProviderActionKind = (typeof V2_PROVIDER_ACTION_KINDS)[number];
export type V2ProviderModelSlot = 'image' | 'research' | 'writing';

export const V2_PROVIDER_ACTION_LIMITS = Object.freeze({
  candidateCount: 40,
  inputBytes: 24_000,
  tokenLength: 96,
  tokenTtlMs: 2 * 60_000,
} as const);

export type V2ProviderActionIntent =
  | {
      readonly expectedRevision: number;
      readonly kind: 'WEEKLY_PLAN';
      readonly userApprovedUnknownCost?: boolean;
      readonly weekKey: string;
    }
  | {
      readonly items: readonly {
        readonly expectedRevision: number;
        readonly expectedVersionId: string;
        readonly packageId: string;
      }[];
      readonly kind: 'CONTENT_COPY_VERSION';
      readonly userApprovedUnknownCost?: boolean;
      readonly weekKey: string;
    }
  | {
      readonly expectedRevision: number;
      readonly expectedVersionId: string;
      readonly kind: 'CONTENT_COVER';
      readonly packageId: string;
      readonly userApprovedUnknownCost?: boolean;
      readonly weekKey: string;
    }
  | {
      readonly candidateIds: readonly string[];
      readonly expectedPlanRevision: number;
      readonly idempotencyKey: string;
      readonly kind: 'CONTENT_PACKAGES';
      readonly weekKey: string;
      readonly userApprovedUnknownCost?: boolean;
    }
  | {
      readonly expectedRevision: number;
      readonly idempotencyKey: string;
      readonly itemId: string;
      readonly kind: 'REPLY_SUGGESTION';
      readonly userApprovedUnknownCost?: boolean;
    };

export interface V2ProviderActionPreview {
  readonly blockReasons: readonly string[];
  readonly budgetState: V2BudgetState;
  readonly canConfirm: boolean;
  readonly capabilityState: V2StructuredJsonState;
  readonly credentialState: V2CredentialState;
  readonly expiresAt: string;
  readonly feeEstimateMicroUsd: string | null;
  readonly fetchEnabled: false;
  readonly kind: V2ProviderActionKind;
  readonly modelId: string | null;
  readonly modelSlot: V2ProviderModelSlot;
  readonly protocolMode: 'CHAT_COMPLETIONS' | 'IMAGES_GENERATIONS' | 'RESPONSES' | null;
  readonly previewToken: string | null;
  readonly providerConfigured: boolean;
  readonly unknownCostApproved?: boolean;
  readonly requestCount: 1;
  readonly searchEnabled: false;
  readonly summary: string;
  readonly targetEndDate?: string;
  readonly targetStartDate?: string;
  readonly targetWeekKey?: string;
}

export type V2ProviderActionReadiness = Omit<
  V2ProviderActionPreview,
  | 'expiresAt'
  | 'kind'
  | 'previewToken'
  | 'requestCount'
  | 'searchEnabled'
  | 'fetchEnabled'
  | 'summary'
>;

export interface V2ProviderActionConfirmation {
  readonly action: 'CONFIRM_PROVIDER_ACTION';
  readonly confirmation: 'RUN_PROVIDER_ACTION';
  readonly previewToken: string;
}

export interface V2ProviderActionExecutionRequest {
  readonly executionId: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly kind: V2ProviderActionKind;
  readonly modelSlot: V2ProviderModelSlot;
  readonly userApprovedUnknownCost?: boolean;
}

export interface V2ProviderActionExecutionResult {
  readonly costAmountMicroUsd: number | null;
  readonly costState:
    | 'NOT_INCURRED'
    | 'PROVIDER_REPORTED_USD'
    | 'UNKNOWN_POSSIBLY_INCURRED'
    | 'UNPRICED_USAGE'
    | 'USER_PRICE_TABLE_ESTIMATE';
  readonly externalRequestCount: 0 | 1;
  readonly outcomeCertainty:
    'COMPLETED_INVALID_OUTPUT' | 'MAY_HAVE_EXECUTED' | 'NOT_SENT' | 'REJECTED_BEFORE_EXECUTION';
  readonly output: unknown;
  readonly stableErrorCode: string | null;
  readonly status: 'BLOCKED' | 'CANCELLED' | 'OUTCOME_UNCERTAIN' | 'SUCCEEDED';
  readonly modelRunId?: string | null;
}

export interface V2ProviderActionResult {
  readonly costAmountMicroUsd: number | null;
  readonly costState: V2ProviderActionExecutionResult['costState'];
  readonly externalRequestCount: 0 | 1;
  readonly kind: V2ProviderActionKind;
  readonly status: 'SUCCEEDED';
}

export type V2ProviderActionErrorCode =
  | 'PROVIDER_ACTION_BLOCKED'
  | 'PROVIDER_ACTION_CANCELLED'
  | 'PROVIDER_ACTION_STALE'
  | 'PROVIDER_ACTION_TOKEN_INVALID'
  | 'PROVIDER_ACTION_UNCERTAIN'
  | 'PROVIDER_OUTPUT_INVALID';

export class V2ProviderActionError extends Error {
  public constructor(
    public readonly code: V2ProviderActionErrorCode,
    public readonly affectedFields: readonly string[] = [],
  ) {
    super(code);
    this.name = 'V2ProviderActionError';
  }
}

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function token(value: unknown, field: string, maximum = 128): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[a-z0-9_-]+$/iu.test(value)
  ) {
    throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID', [field]);
  }
  return value;
}

function revision(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new V2ProviderActionError('PROVIDER_ACTION_STALE', [field]);
  }
  return value as number;
}

function weekKey(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/u.test(value)) {
    throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED', ['weekKey']);
  }
  return value;
}

export function parseV2ProviderActionIntent(value: unknown): V2ProviderActionIntent {
  if (!record(value)) throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED');
  if (!('userApprovedUnknownCost' in value)) value = { ...value, userApprovedUnknownCost: false };
  if (!record(value)) throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED');
  if (
    value.kind === 'WEEKLY_PLAN' &&
    exactKeys(value, ['expectedRevision', 'kind', 'userApprovedUnknownCost', 'weekKey']) &&
    typeof value.userApprovedUnknownCost === 'boolean'
  ) {
    return {
      expectedRevision: revision(value.expectedRevision, 'expectedRevision'),
      kind: value.kind,
      weekKey: weekKey(value.weekKey),
      userApprovedUnknownCost: value.userApprovedUnknownCost,
    };
  }
  if (
    value.kind === 'CONTENT_PACKAGES' &&
    exactKeys(value, [
      'candidateIds',
      'expectedPlanRevision',
      'idempotencyKey',
      'kind',
      'userApprovedUnknownCost',
      'weekKey',
    ]) &&
    typeof value.userApprovedUnknownCost === 'boolean' &&
    Array.isArray(value.candidateIds) &&
    value.candidateIds.length === 3
  ) {
    const candidateIds = value.candidateIds.map((id) => token(id, 'candidateIds', 64));
    if (new Set(candidateIds).size !== candidateIds.length) {
      throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED', ['candidateIds']);
    }
    return {
      candidateIds,
      expectedPlanRevision: revision(value.expectedPlanRevision, 'expectedPlanRevision'),
      idempotencyKey: token(value.idempotencyKey, 'idempotencyKey'),
      kind: value.kind,
      weekKey: weekKey(value.weekKey),
      userApprovedUnknownCost: value.userApprovedUnknownCost,
    };
  }
  if (
    value.kind === 'CONTENT_COPY_VERSION' &&
    exactKeys(value, ['items', 'kind', 'userApprovedUnknownCost', 'weekKey']) &&
    typeof value.userApprovedUnknownCost === 'boolean' &&
    Array.isArray(value.items) &&
    (value.items.length === 1 || value.items.length === 3)
  ) {
    const items = value.items.map((item) => {
      if (!record(item) || !exactKeys(item, ['expectedRevision', 'expectedVersionId', 'packageId']))
        throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED', ['items']);
      return Object.freeze({
        expectedRevision: revision(item.expectedRevision, 'expectedRevision'),
        expectedVersionId: token(item.expectedVersionId, 'expectedVersionId'),
        packageId: token(item.packageId, 'packageId'),
      });
    });
    if (new Set(items.map(({ packageId }) => packageId)).size !== items.length)
      throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED', ['items']);
    return {
      items: Object.freeze(items),
      kind: value.kind,
      userApprovedUnknownCost: value.userApprovedUnknownCost,
      weekKey: weekKey(value.weekKey),
    };
  }
  if (
    value.kind === 'CONTENT_COVER' &&
    exactKeys(value, [
      'expectedRevision',
      'expectedVersionId',
      'kind',
      'packageId',
      'userApprovedUnknownCost',
      'weekKey',
    ]) &&
    typeof value.userApprovedUnknownCost === 'boolean'
  ) {
    return {
      expectedRevision: revision(value.expectedRevision, 'expectedRevision'),
      expectedVersionId: token(value.expectedVersionId, 'expectedVersionId'),
      kind: value.kind,
      packageId: token(value.packageId, 'packageId'),
      userApprovedUnknownCost: value.userApprovedUnknownCost,
      weekKey: weekKey(value.weekKey),
    };
  }
  if (
    value.kind === 'REPLY_SUGGESTION' &&
    exactKeys(value, [
      'expectedRevision',
      'idempotencyKey',
      'itemId',
      'kind',
      'userApprovedUnknownCost',
    ]) &&
    typeof value.userApprovedUnknownCost === 'boolean'
  ) {
    return {
      expectedRevision: revision(value.expectedRevision, 'expectedRevision'),
      idempotencyKey: token(value.idempotencyKey, 'idempotencyKey'),
      itemId: token(value.itemId, 'itemId'),
      kind: value.kind,
      userApprovedUnknownCost: value.userApprovedUnknownCost,
    };
  }
  throw new V2ProviderActionError('PROVIDER_ACTION_BLOCKED');
}

export function parseV2ProviderActionConfirmation(value: unknown): V2ProviderActionConfirmation {
  if (
    !record(value) ||
    !exactKeys(value, ['action', 'confirmation', 'previewToken']) ||
    value.action !== 'CONFIRM_PROVIDER_ACTION' ||
    value.confirmation !== 'RUN_PROVIDER_ACTION'
  ) {
    throw new V2ProviderActionError('PROVIDER_ACTION_TOKEN_INVALID');
  }
  return {
    action: value.action,
    confirmation: value.confirmation,
    previewToken: token(value.previewToken, 'previewToken', V2_PROVIDER_ACTION_LIMITS.tokenLength),
  };
}

export const V2_PROVIDER_OUTPUT_JSON_SCHEMAS = Object.freeze({
  CONTENT_PACKAGES: {
    additionalProperties: false,
    properties: {
      packages: {
        items: {
          additionalProperties: false,
          properties: {
            body: { maxLength: 16_000, minLength: 1, type: 'string' },
            coverKey: { enum: ['moonstone', 'morgue', 'yellow-room'], type: 'string' },
            materialNotes: { maxLength: 2_000, minLength: 1, type: 'string' },
            suggestedTime: { maxLength: 32, minLength: 1, type: 'string' },
            tags: {
              items: { maxLength: 80, minLength: 1, type: 'string' },
              maxItems: 10,
              minItems: 1,
              type: 'array',
            },
            title: { maxLength: 300, minLength: 1, type: 'string' },
          },
          required: ['body', 'coverKey', 'materialNotes', 'suggestedTime', 'tags', 'title'],
          type: 'object',
        },
        maxItems: 3,
        minItems: 3,
        type: 'array',
      },
    },
    required: ['packages'],
    type: 'object',
  },
  CONTENT_COPY_VERSION: {
    additionalProperties: false,
    properties: {
      packages: {
        items: {
          additionalProperties: false,
          properties: {
            body: { maxLength: 16_000, minLength: 1, type: 'string' },
            coverKey: { enum: ['moonstone', 'morgue', 'yellow-room'], type: 'string' },
            materialNotes: { maxLength: 2_000, minLength: 1, type: 'string' },
            suggestedTime: { maxLength: 32, minLength: 1, type: 'string' },
            tags: {
              items: { maxLength: 80, minLength: 1, type: 'string' },
              maxItems: 10,
              minItems: 1,
              type: 'array',
            },
            title: { maxLength: 300, minLength: 1, type: 'string' },
          },
          required: ['body', 'coverKey', 'materialNotes', 'suggestedTime', 'tags', 'title'],
          type: 'object',
        },
        maxItems: 3,
        minItems: 1,
        type: 'array',
      },
    },
    required: ['packages'],
    type: 'object',
  },
  REPLY_SUGGESTION: {
    additionalProperties: false,
    properties: { replyText: { maxLength: 4_000, minLength: 1, type: 'string' } },
    required: ['replyText'],
    type: 'object',
  },
  WEEKLY_PLAN: {
    additionalProperties: false,
    properties: {
      candidates: {
        items: {
          additionalProperties: false,
          properties: {
            book: { maxLength: 200, minLength: 1, type: 'string' },
            conflictWithIds: {
              items: { maxLength: 64, minLength: 1, type: 'string' },
              maxItems: 40,
              type: 'array',
            },
            date: { maxLength: 10, minLength: 8, type: 'string' },
            day: { enum: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'], type: 'string' },
            id: { maxLength: 64, minLength: 1, type: 'string' },
            status: { enum: ['CONFLICT', 'PENDING', 'PLANNED'], type: 'string' },
            time: { maxLength: 5, minLength: 5, type: 'string' },
            title: { maxLength: 200, minLength: 1, type: 'string' },
          },
          required: ['book', 'conflictWithIds', 'date', 'day', 'id', 'status', 'time', 'title'],
          type: 'object',
        },
        maxItems: 40,
        minItems: 1,
        type: 'array',
      },
    },
    required: ['candidates'],
    type: 'object',
  },
} as const);

export function providerActionSummary(kind: V2ProviderActionKind): string {
  if (kind === 'WEEKLY_PLAN') return '使用 research 模型槽生成下一周计划候选。';
  if (kind === 'CONTENT_PACKAGES') return '使用 writing 模型槽生成 3 个六字段内容包。';
  if (kind === 'CONTENT_COPY_VERSION')
    return '使用 writing 模型槽为当前内容创建一个待复核文案版本。';
  if (kind === 'CONTENT_COVER') return '使用 image 模型槽生成当前内容的新封面版本。';
  return '使用 writing 模型槽生成一条可编辑回复建议；不会自动发送。';
}

export function providerActionModelSlot(kind: V2ProviderActionKind): V2ProviderModelSlot {
  if (kind === 'CONTENT_COVER') return 'image';
  return kind === 'WEEKLY_PLAN' ? 'research' : 'writing';
}

export type V2CredentialState = 'CONFIGURED' | 'NOT_CONFIGURED' | 'REAUTH_REQUIRED';
export type V2StructuredJsonState = 'STALE' | 'SUPPORTED' | 'UNKNOWN' | 'UNSUPPORTED';
export type V2BudgetState = 'ALLOWED' | 'BLOCKED' | 'UNKNOWN';

export interface V2StructuredProtocolCandidate {
  readonly protocolMode: 'CHAT_COMPLETIONS' | 'RESPONSES';
  readonly stale: boolean;
  readonly state: 'SUPPORTED' | 'UNKNOWN' | 'UNSUPPORTED';
}

export function selectV2StructuredProtocol(
  candidates: readonly V2StructuredProtocolCandidate[],
): Readonly<{
  protocolMode: 'CHAT_COMPLETIONS' | 'RESPONSES' | null;
  state: V2StructuredJsonState;
}> {
  const current = candidates.filter((candidate) => !candidate.stale);
  if (current.length === 0) {
    return Object.freeze({
      protocolMode: null,
      state: candidates.length > 0 ? ('STALE' as const) : ('UNKNOWN' as const),
    });
  }
  const supported =
    current.find(
      (candidate) => candidate.state === 'SUPPORTED' && candidate.protocolMode === 'RESPONSES',
    ) ??
    current.find(
      (candidate) =>
        candidate.state === 'SUPPORTED' && candidate.protocolMode === 'CHAT_COMPLETIONS',
    );
  return Object.freeze({
    protocolMode: supported?.protocolMode ?? null,
    state:
      supported !== undefined
        ? ('SUPPORTED' as const)
        : current.every((candidate) => candidate.state === 'UNSUPPORTED')
          ? ('UNSUPPORTED' as const)
          : ('UNKNOWN' as const),
  });
}

export interface V2CapabilitySlotView {
  readonly modelId: string | null;
  readonly protocolMode: 'CHAT_COMPLETIONS' | 'IMAGES_GENERATIONS' | 'RESPONSES' | null;
  readonly state: V2StructuredJsonState;
}
export interface V2CapabilityProbeProgress {
  readonly completedRequestCount: number;
  readonly plannedRequestCount: number;
  readonly runId: string;
  readonly sentRequestCount: number;
  readonly status: 'CANCELLED' | 'FAILED' | 'INTERRUPTED' | 'PARTIAL' | 'RUNNING' | 'SUCCEEDED';
}
export type V2CapabilityProbeSummaryState =
  | 'CANCELLED'
  | 'COMPLETE'
  | 'FAILED'
  | 'NONE_CONFIRMED'
  | 'NOT_RUN'
  | 'PARTIAL'
  | 'RUNNING'
  | 'STALE';
export interface V2CapabilityProbeStepDiagnostic {
  readonly capability: 'imageGeneration' | 'structuredJson';
  readonly deduplicated: boolean;
  readonly diagnosticCode: string;
  readonly errorCode?: string | null;
  readonly errorParam?: string | null;
  readonly errorType?: string | null;
  readonly httpStatus: number | null;
  readonly mappedSlots: readonly V2ProviderModelSlot[];
  readonly modelId: string;
  readonly observedAt: string | null;
  readonly protocolMode: 'CHAT_COMPLETIONS' | 'NOT_APPLICABLE' | 'RESPONSES';
  readonly receivedContentType?: string | null;
  readonly requestId?: string | null;
  readonly reason: string;
  readonly sent: boolean;
  readonly stale: boolean;
  readonly state: 'SUPPORTED' | 'UNKNOWN' | 'UNSUPPORTED';
  readonly transportVariant?:
    'NONSTANDARD_MIME_JSON' | 'REJECTED' | 'SSE_NORMALIZED' | 'STANDARD_JSON' | null;
}
export interface V2CapabilityProbeRunDiagnostic {
  readonly completedAt: string | null;
  readonly completedRequestCount: number;
  readonly costState: 'UNKNOWN';
  readonly fetchEnabled: false;
  readonly plannedRequestCount: number;
  readonly runId: string;
  readonly searchEnabled: false;
  readonly sentRequestCount: number;
  readonly startedAt: string;
  readonly status: V2CapabilityProbeProgress['status'];
}
export interface V2CapabilityProbePreview {
  readonly budgetReady: boolean;
  readonly credentialBindingVersion: number;
  readonly expiresAt: string;
  readonly feeEstimate: 'UNKNOWN';
  readonly planHash: string;
  readonly requestCount: number;
  readonly settingsRevision: number;
  readonly startToken: string;
  readonly modelIds?: readonly string[];
  readonly fetchEnabled: false;
  readonly searchEnabled: false;
  readonly userApprovedUnknownCost?: boolean;
}
export interface V2ProviderSettingsView {
  readonly accounting: {
    readonly hardLimitMicroUsd: string;
    readonly hardStop: boolean;
    readonly priceReadyForContent: boolean;
    readonly priceReadyForReply: boolean;
    readonly priceReadyForWeeklyPlan: boolean;
    readonly warning: boolean;
  };
  readonly capabilityProbe: {
    readonly activeRun: V2CapabilityProbeProgress | null;
    readonly diagnosticText: string;
    readonly derivedState: string;
    readonly latestRun: V2CapabilityProbeRunDiagnostic | null;
    readonly steps: readonly V2CapabilityProbeStepDiagnostic[];
    readonly summaryState: V2CapabilityProbeSummaryState;
  };
  readonly credentialState: V2CredentialState;
  readonly providerBaseUrl: string | null;
  readonly providerConfigured: boolean;
  readonly research: V2CapabilitySlotView;
  readonly revision: number;
  readonly setupAvailable: boolean;
  readonly writing: V2CapabilitySlotView;
  readonly image?: V2CapabilitySlotView;
}
export interface V2ProviderSettingsDraft {
  readonly expectedRevision: number;
  readonly providerBaseUrl: string | null;
  readonly researchModelId: string | null;
  readonly writingModelId: string | null;
  readonly imageModelId: string | null;
}
export interface V2ProviderCredentialInput {
  readonly plaintext: string;
}
export interface V2CapabilityProbeStart {
  readonly confirmation: 'START_PROVIDER_CAPABILITY_PROBE';
  readonly credentialBindingVersion: number;
  readonly planHash: string;
  readonly settingsRevision: number;
  readonly startToken: string;
  readonly userApprovedUnknownCost: boolean;
}
export type V2ProviderSettingsMutation =
  | ({ readonly action: 'UPDATE_PROVIDER_SETTINGS' } & V2ProviderSettingsDraft)
  | ({ readonly action: 'SET_PROVIDER_CREDENTIAL' } & V2ProviderCredentialInput)
  | {
      readonly action: 'CLEAR_PROVIDER_CREDENTIAL';
      readonly confirmation: 'DELETE_CONTENT_AI_API_KEY';
    }
  | ({ readonly action: 'START_PROVIDER_CAPABILITY_PROBE' } & V2CapabilityProbeStart);

function settingsRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function settingsExact(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
}
function settingsRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError('INVALID_REQUEST');
  return value as number;
}
function settingsNullableText(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length > maximum ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  )
    throw new TypeError('INVALID_REQUEST');
  return value;
}
function settingsToken(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9_-]{1,128}$/iu.test(value))
    throw new TypeError('INVALID_REQUEST');
  return value;
}
export function parseV2ProviderSettingsMutation(value: unknown): V2ProviderSettingsMutation | null {
  if (!settingsRecord(value) || typeof value.action !== 'string') return null;
  if (
    value.action === 'UPDATE_PROVIDER_SETTINGS' &&
    settingsExact(value, [
      'action',
      'expectedRevision',
      'providerBaseUrl',
      'researchModelId',
      'writingModelId',
      'imageModelId',
    ])
  ) {
    return {
      action: value.action,
      expectedRevision: settingsRevision(value.expectedRevision),
      providerBaseUrl: settingsNullableText(value.providerBaseUrl, 2_048),
      researchModelId: settingsNullableText(value.researchModelId, 200),
      writingModelId: settingsNullableText(value.writingModelId, 200),
      imageModelId: settingsNullableText(value.imageModelId, 200),
    };
  }
  if (value.action === 'SET_PROVIDER_CREDENTIAL' && settingsExact(value, ['action', 'plaintext'])) {
    const plaintext = settingsNullableText(value.plaintext, 16_384);
    if (plaintext === null || plaintext.trim() === '') throw new TypeError('INVALID_REQUEST');
    return { action: value.action, plaintext };
  }
  if (
    value.action === 'CLEAR_PROVIDER_CREDENTIAL' &&
    settingsExact(value, ['action', 'confirmation']) &&
    value.confirmation === 'DELETE_CONTENT_AI_API_KEY'
  )
    return { action: value.action, confirmation: value.confirmation };
  if (
    value.action === 'START_PROVIDER_CAPABILITY_PROBE' &&
    settingsExact(value, [
      'action',
      'confirmation',
      'credentialBindingVersion',
      'planHash',
      'settingsRevision',
      'startToken',
      'userApprovedUnknownCost',
    ]) &&
    value.confirmation === 'START_PROVIDER_CAPABILITY_PROBE' &&
    typeof value.userApprovedUnknownCost === 'boolean'
  ) {
    return {
      action: value.action,
      confirmation: value.confirmation,
      credentialBindingVersion: settingsRevision(value.credentialBindingVersion),
      planHash: settingsToken(value.planHash),
      settingsRevision: settingsRevision(value.settingsRevision),
      startToken: settingsToken(value.startToken),
      userApprovedUnknownCost: value.userApprovedUnknownCost,
    };
  }
  throw new TypeError('INVALID_REQUEST');
}
