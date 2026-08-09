export const V2_PROVIDER_ACTION_KINDS = Object.freeze([
  'WEEKLY_PLAN',
  'CONTENT_PACKAGES',
  'REPLY_SUGGESTION',
] as const);
export type V2ProviderActionKind = (typeof V2_PROVIDER_ACTION_KINDS)[number];
export type V2ProviderModelSlot = 'research' | 'writing';

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
      readonly weekKey: string;
    }
  | {
      readonly candidateIds: readonly string[];
      readonly expectedPlanRevision: number;
      readonly idempotencyKey: string;
      readonly kind: 'CONTENT_PACKAGES';
      readonly weekKey: string;
    }
  | {
      readonly expectedRevision: number;
      readonly idempotencyKey: string;
      readonly itemId: string;
      readonly kind: 'REPLY_SUGGESTION';
    };

export interface V2ProviderActionPreview {
  readonly expiresAt: string;
  readonly feeEstimate: 'UNKNOWN';
  readonly fetchEnabled: false;
  readonly kind: V2ProviderActionKind;
  readonly modelSlot: V2ProviderModelSlot;
  readonly previewToken: string;
  readonly requestCount: 1;
  readonly searchEnabled: false;
  readonly summary: string;
}

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
  if (value.kind === 'WEEKLY_PLAN' && exactKeys(value, ['expectedRevision', 'kind', 'weekKey'])) {
    return {
      expectedRevision: revision(value.expectedRevision, 'expectedRevision'),
      kind: value.kind,
      weekKey: weekKey(value.weekKey),
    };
  }
  if (
    value.kind === 'CONTENT_PACKAGES' &&
    exactKeys(value, [
      'candidateIds',
      'expectedPlanRevision',
      'idempotencyKey',
      'kind',
      'weekKey',
    ]) &&
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
    };
  }
  if (
    value.kind === 'REPLY_SUGGESTION' &&
    exactKeys(value, ['expectedRevision', 'idempotencyKey', 'itemId', 'kind'])
  ) {
    return {
      expectedRevision: revision(value.expectedRevision, 'expectedRevision'),
      idempotencyKey: token(value.idempotencyKey, 'idempotencyKey'),
      itemId: token(value.itemId, 'itemId'),
      kind: value.kind,
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
  return '使用 writing 模型槽生成一条可编辑回复建议；不会自动发送。';
}

export function providerActionModelSlot(kind: V2ProviderActionKind): V2ProviderModelSlot {
  return kind === 'WEEKLY_PLAN' ? 'research' : 'writing';
}
