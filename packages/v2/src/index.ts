import {
  V2ContentError,
  parseContentPackageFields,
  type ContentApprovalRef,
  type ContentExportResult,
  type ContentMutationRequest,
  type ContentPackage,
  type V2ContentErrorCode,
  type ContentWorkspace,
} from './content.js';
import {
  V2InteractionError,
  isInteractionMutationRequest,
  normalizeInteractionText,
  parseInteractionMutationRequest,
  parseInteractionReadRequest,
  utf8Bytes,
  type InteractionCreateResult,
  type InteractionDeletePreview,
  type InteractionItem,
  type InteractionMutationRequest,
  type InteractionReadRequest,
  type InteractionWorkspace,
  type V2InteractionErrorCode,
} from './interaction.js';
export * from './metrics.js';
import {
  METRIC_WINDOWS,
  parseMetricSnapshot,
  type MetricSnapshot,
  type MetricWindow,
  type MetricsReview,
  type StrategyDecisionStatus,
} from './metrics.js';
import {
  V2ProviderActionError,
  parseV2ContentCopyGenerationExecutionRequest,
  parseV2ContentCopyGenerationPreviewRequest,
  parseV2ProviderActionConfirmation,
  parseV2ProviderActionIntent,
  type V2ProviderActionKind,
  type V2ProviderActionConfirmation,
  type V2ProviderActionErrorCode,
  type V2ProviderActionIntent,
  type V2ProviderActionPreview,
  type V2ProviderActionResult,
  type V2ContentCopyGenerationExecutionRequest,
  type V2ContentCopyGenerationPreviewRequest,
  type V2ContentCopyGenerationPreview,
  type V2ContentCopyGenerationResult,
  parseV2ProviderSettingsMutation,
  type V2CapabilityProbePreview,
  type V2CapabilityProbeProgress,
  type V2CapabilityProbeStart,
  type V2ProviderCredentialInput,
  type V2ProviderSettingsDraft,
  type V2ProviderSettingsMutation,
  type V2ProviderSettingsView,
} from './provider-actions.js';

export * from './content.js';
export * from './interaction.js';
export * from './provider-actions.js';

export const V2_SCHEMA_VERSION = 1 as const;
export const V2_DEFAULT_WEEK_KEY = '2026-W31' as const;
export const V2_IPC_CHANNELS = Object.freeze({
  mutate: 'v2:workspace:mutate',
  read: 'v2:workspace:read',
} as const);
export const V2_LIMITS = Object.freeze({
  catalogLimit: 24,
  catalogOffset: 10_000,
  catalogQuery: 256,
  catalogWorkId: 128,
  candidateCount: 40,
  candidateId: 64,
  candidateText: 200,
  conflictCount: 40,
  personaBoundary: 1_000,
  personaText: 500,
  requestBytes: 32_768,
} as const);

export interface V2CatalogWorkSummary {
  readonly canonicalTitle: string;
  readonly editionCount: number;
  readonly expressionCount: number;
  readonly revision: number;
  readonly state: string;
  readonly workId: string;
}

export interface V2CatalogWorkListView {
  readonly hasMore: boolean;
  readonly limit: number;
  readonly offset: number;
  readonly query: string;
  readonly totalWorks: number;
  readonly works: readonly V2CatalogWorkSummary[];
}

export interface V2CatalogWorkDetail extends V2CatalogWorkSummary {
  readonly aliases: readonly {
    readonly kind: string;
    readonly normalized: string;
    readonly raw: string;
  }[];
  readonly expressions: readonly {
    readonly editions: readonly {
      readonly editionId: string;
      readonly identifiers: readonly {
        readonly namespace: string;
        readonly value: string;
      }[];
      readonly label: string | null;
      readonly publisher: string | null;
      readonly state: string;
    }[];
    readonly expressionId: string;
    readonly kind: string;
    readonly language: string | null;
    readonly state: string;
    readonly title: string | null;
  }[];
  readonly observations: readonly {
    readonly factStatus: 'NOT_A_FACT';
    readonly fieldProvenanceCount: number;
    readonly observationId: string;
    readonly originKind: string;
    readonly truthStatus: 'UNVERIFIED';
  }[];
  readonly publicationRelationships: readonly {
    readonly language: string | null;
    readonly objectAgentName: string | null;
    readonly role: string;
    readonly scopeId: string | null;
    readonly scopeType: string | null;
    readonly subjectAgentName: string;
    readonly territory: string | null;
    readonly verificationState: string;
  }[];
  readonly relations: readonly {
    readonly agentName: string;
    readonly role: string;
    readonly scopeId: string;
    readonly scopeType: string;
    readonly verificationState: string;
  }[];
  readonly sourceBoundary: 'MISSING' | 'UNVERIFIED_OBSERVATIONS';
}

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

export type PlanCandidateStatus =
  'CONFLICT' | 'CONFIRMED' | 'EXPORTED' | 'PENDING' | 'PLANNED' | 'SKIPPED';

export interface PlanCandidate {
  readonly book: string;
  readonly conflictWithIds: readonly string[];
  readonly date: string;
  readonly day: string;
  readonly id: string;
  readonly status: PlanCandidateStatus;
  readonly time: string;
  readonly title: string;
}

export const PLAN_FEEDBACK_REASONS = Object.freeze([
  'TOPIC_MISMATCH',
  'REPEATED_ANGLE',
  'NOT_WEEKLY_FOCUS',
  'TIME_UNSUITABLE',
  'OTHER',
] as const);
export type PlanFeedbackReason = (typeof PLAN_FEEDBACK_REASONS)[number];

export interface PlanItemFeedback {
  readonly candidate: PlanCandidate | null;
  readonly candidateId: string;
  readonly details: string;
  readonly feedbackId: string;
  readonly reason: PlanFeedbackReason;
  readonly sourcePlanRevision: number;
  readonly status: 'ADOPTED' | 'CANDIDATE_READY' | 'DISMISSED' | 'RECORDED';
}

export interface WeeklyPlanningBrief {
  readonly revision: number;
  readonly text: string;
}

export interface WeeklyPlan {
  readonly brief: WeeklyPlanningBrief;
  readonly candidates: readonly PlanCandidate[];
  readonly generationBriefRevision: number | null;
  readonly itemFeedback: readonly PlanItemFeedback[];
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

export type PlanRescheduleMode = 'DATE_ONLY' | 'DATE_TIME' | 'TIME_ONLY';

export interface PlanRescheduleFields {
  readonly candidateIds: readonly string[];
  readonly date: string | null;
  readonly expectedRevision: number;
  readonly mode: PlanRescheduleMode;
  readonly staggerMinutes: 0 | 30;
  readonly time: string | null;
  readonly weekKey: string;
}

export interface PlanRescheduleConflictSide {
  readonly candidateId: string;
  readonly date: string;
  readonly time: string;
  readonly title: string;
}

export interface PlanRescheduleConflict {
  readonly existing: PlanRescheduleConflictSide;
  readonly incoming: PlanRescheduleConflictSide;
}

export interface PlanReschedulePreviewItem {
  readonly candidateId: string;
  readonly fromDate: string;
  readonly fromTime: string;
  readonly targetDate: string;
  readonly targetDay: string;
  readonly targetTime: string;
  readonly targetWeekKey: string;
  readonly title: string;
}

export interface PlanReschedulePreview {
  readonly affectedCount: number;
  readonly conflictCount: number;
  readonly conflicts: readonly PlanRescheduleConflict[];
  readonly crossWeekCount: number;
  readonly items: readonly PlanReschedulePreviewItem[];
}

export type V2ReadRequest =
  | { readonly view: 'ACCOUNT_PERSONA' }
  | {
      readonly limit: number;
      readonly offset: number;
      readonly query: string;
      readonly view: 'CATALOG_WORKS';
    }
  | { readonly view: 'CATALOG_WORK'; readonly workId: string }
  | { readonly view: 'WEEKLY_PLAN'; readonly weekKey: string }
  | ({ readonly view: 'PLAN_RESCHEDULE_PREVIEW' } & PlanRescheduleFields)
  | { readonly view: 'CONTENT_PACKAGES'; readonly weekKey: string }
  | ({ readonly view: 'CONTENT_COPY_GENERATION_PREVIEW' } & V2ContentCopyGenerationPreviewRequest)
  | { readonly view: 'METRICS_REVIEW'; readonly snapshotWindow: MetricWindow }
  | { readonly intent: V2ProviderActionIntent; readonly view: 'PROVIDER_ACTION_PREVIEW' }
  | { readonly view: 'PROVIDER_SETTINGS' }
  | { readonly view: 'PROVIDER_CAPABILITY_PROBE_PREVIEW' }
  | { readonly runId: string; readonly view: 'PROVIDER_CAPABILITY_PROBE_PROGRESS' }
  | InteractionReadRequest;

export type V2MutationRequest =
  | {
      readonly action: 'UPDATE_PERSONA';
      readonly expectedRevision: number;
      readonly persona: AccountPersonaFields;
    }
  | {
      readonly action: 'GENERATE_WEEKLY_PLAN';
      readonly expectedRevision: number;
      readonly weekKey: string;
    }
  | {
      readonly action: 'SAVE_WEEKLY_PLANNING_BRIEF';
      readonly briefText: string;
      readonly expectedRevision: number;
      readonly weekKey: string;
    }
  | {
      readonly action: 'RECORD_PLAN_ITEM_FEEDBACK';
      readonly candidateId: string;
      readonly details: string;
      readonly expectedRevision: number;
      readonly reason: PlanFeedbackReason;
      readonly weekKey: string;
    }
  | {
      readonly action: 'ADOPT_PLAN_ITEM_REPLACEMENT';
      readonly candidate: PlanCandidate;
      readonly expectedRevision: number;
      readonly feedbackId: string;
      readonly weekKey: string;
    }
  | {
      readonly action: 'DISMISS_PLAN_ITEM_REPLACEMENT';
      readonly expectedRevision: number;
      readonly feedbackId: string;
      readonly weekKey: string;
    }
  | { readonly action: 'SAVE_METRIC_SNAPSHOTS'; readonly snapshots: readonly MetricSnapshot[] }
  | {
      readonly action: 'DECIDE_STRATEGY_RECOMMENDATION';
      readonly expectedRevision: number;
      readonly id: string;
      readonly status: Exclude<StrategyDecisionStatus, 'STALE'>;
    }
  | {
      readonly action: 'CONFIRM_PLAN_CANDIDATES';
      readonly candidateIds: readonly string[];
      readonly expectedRevision: number;
      readonly weekKey: string;
    }
  | {
      readonly action: 'SKIP_PLAN_CANDIDATES';
      readonly candidateIds: readonly string[];
      readonly expectedRevision: number;
      readonly weekKey: string;
    }
  | ({
      readonly action: 'RESCHEDULE_PLAN_CANDIDATES';
      readonly allowConflicts: boolean;
    } & PlanRescheduleFields)
  | {
      readonly action: 'LOCK_WEEKLY_PLAN';
      readonly expectedRevision: number;
      readonly weekKey: string;
    }
  | {
      readonly action: 'UNLOCK_WEEKLY_PLAN';
      readonly expectedRevision: number;
      readonly weekKey: string;
    }
  | V2ProviderActionConfirmation
  | V2ContentCopyGenerationExecutionRequest
  | V2ProviderSettingsMutation
  | ContentMutationRequest
  | InteractionMutationRequest;

export interface V2ExceptionSummary {
  readonly affectedFields: readonly string[];
  readonly code:
    | V2ContentErrorCode
    | V2InteractionErrorCode
    | V2ProviderActionErrorCode
    | 'CAPABILITY_PROBE_BLOCKED'
    | 'CREDENTIAL_ERROR'
    | 'LOCAL_OPERATION_FAILED'
    | 'SETTINGS_INVALID'
    | 'SETTINGS_NOT_READY'
    | 'PERSISTENCE_UNAVAILABLE'
    | 'PLAN_CONFLICT'
    | 'PLAN_LOCKED';
  readonly message: string;
  readonly severity: 'ERROR' | 'WARNING';
  readonly suggestedAction: string;
}

export type V2Result<T> =
  | { readonly error: V2ExceptionSummary; readonly ok: false }
  | { readonly ok: true; readonly value: T };

type ContentInput<Action extends ContentMutationRequest['action']> = Omit<
  Extract<ContentMutationRequest, { action: Action }>,
  'action'
>;
type InteractionInput<Action extends InteractionMutationRequest['action']> = Omit<
  Extract<InteractionMutationRequest, { action: Action }>,
  'action'
>;
type InteractionCall<Action extends InteractionMutationRequest['action'], Result> = (
  input: InteractionInput<Action>,
) => Promise<V2Result<Result>>;
type InteractionItemCall<Action extends InteractionMutationRequest['action']> = InteractionCall<
  Action,
  InteractionItem
>;

export interface V2Bridge {
  readonly adoptPlanItemReplacement: (input: {
    readonly candidate: PlanCandidate;
    readonly expectedRevision: number;
    readonly feedbackId: string;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly approveContentPackages: (
    input: ContentInput<'APPROVE_CONTENT_PACKAGES'>,
  ) => Promise<V2Result<ContentWorkspace>>;
  readonly confirmPlanCandidates: (input: {
    readonly candidateIds: readonly string[];
    readonly expectedRevision: number;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly confirmProviderAction?: (input: {
    readonly confirmation: 'RUN_PROVIDER_ACTION';
    readonly previewToken: string;
  }) => Promise<V2Result<V2ProviderActionResult>>;
  readonly executeContentCopyGeneration?: (input: {
    readonly previewToken: string;
  }) => Promise<V2Result<V2ContentCopyGenerationResult>>;
  readonly clearProviderCredential?: (input: {
    readonly confirmation: 'DELETE_CONTENT_AI_API_KEY';
  }) => Promise<V2Result<V2ProviderSettingsView>>;
  readonly confirmReplySuggestions: InteractionCall<
    'CONFIRM_REPLY_SUGGESTIONS',
    InteractionWorkspace
  >;
  readonly createInteraction: InteractionCall<'CREATE_INTERACTION', InteractionCreateResult>;
  readonly deleteInteraction: InteractionCall<'DELETE_INTERACTION', InteractionWorkspace>;
  readonly generateWeeklyPlan: (input: {
    readonly expectedRevision: number;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly generateContentPackages: (
    input: ContentInput<'GENERATE_CONTENT_PACKAGES'>,
  ) => Promise<V2Result<ContentWorkspace>>;
  readonly generateReplySuggestion: InteractionItemCall<'GENERATE_REPLY_SUGGESTION'>;
  readonly lockWeeklyPlan: (input: {
    readonly expectedRevision: number;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly unlockWeeklyPlan: (input: {
    readonly expectedRevision: number;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly previewPlanReschedule: (
    input: PlanRescheduleFields,
  ) => Promise<V2Result<PlanReschedulePreview>>;
  readonly previewProviderAction?: (
    input: V2ProviderActionIntent,
  ) => Promise<V2Result<V2ProviderActionPreview>>;
  readonly previewContentCopyGeneration?: (input: {
    readonly selectedPlanItemIds: readonly string[];
    readonly userApprovedUnknownCost: boolean;
    readonly weekKey: string;
  }) => Promise<V2Result<V2ContentCopyGenerationPreview>>;
  readonly previewProviderCapabilityProbe?: () => Promise<V2Result<V2CapabilityProbePreview>>;
  readonly exportContentPackages: (
    input: ContentInput<'EXPORT_CONTENT_PACKAGES'>,
  ) => Promise<V2Result<ContentExportResult>>;
  readonly openContentExport: (
    input: ContentInput<'OPEN_CONTENT_EXPORT'>,
  ) => Promise<V2Result<{ readonly opened: true }>>;
  readonly markInteractionManualSent: InteractionItemCall<'MARK_INTERACTION_MANUAL_SENT'>;
  readonly previewInteractionDelete: (input: {
    readonly itemId: string;
  }) => Promise<V2Result<InteractionDeletePreview>>;
  readonly readContentPackages: (input: {
    readonly weekKey: string;
  }) => Promise<V2Result<ContentWorkspace>>;
  readonly readCatalogWork?: (input: {
    readonly workId: string;
  }) => Promise<V2Result<V2CatalogWorkDetail | null>>;
  readonly readCatalogWorks?: (input: {
    readonly limit: number;
    readonly offset: number;
    readonly query: string;
  }) => Promise<V2Result<V2CatalogWorkListView>>;
  readonly readInteractions: () => Promise<V2Result<InteractionWorkspace>>;
  readonly readMetricsReview?: (input: {
    readonly snapshotWindow: MetricWindow;
  }) => Promise<V2Result<MetricsReview>>;
  readonly saveMetricSnapshots?: (input: {
    readonly snapshots: readonly Omit<MetricSnapshot, 'revision'>[];
  }) => Promise<V2Result<MetricsReview>>;
  readonly decideStrategyRecommendation?: (input: {
    readonly expectedRevision: number;
    readonly id: string;
    readonly status: 'ACCEPTED' | 'REJECTED';
  }) => Promise<V2Result<MetricsReview>>;
  readonly readPersona: () => Promise<V2Result<AccountPersona>>;
  readonly readProviderCapabilityProbeProgress?: (input: {
    readonly runId: string;
  }) => Promise<V2Result<V2CapabilityProbeProgress>>;
  readonly readProviderSettings?: () => Promise<V2Result<V2ProviderSettingsView>>;
  readonly readWeeklyPlan: (input: { readonly weekKey: string }) => Promise<V2Result<WeeklyPlan>>;
  readonly recordPlanItemFeedback: (input: {
    readonly candidateId: string;
    readonly details: string;
    readonly expectedRevision: number;
    readonly reason: PlanFeedbackReason;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly reschedulePlanCandidates: (
    input: PlanRescheduleFields & { readonly allowConflicts: boolean },
  ) => Promise<V2Result<WeeklyPlan>>;
  readonly dismissPlanItemReplacement: (input: {
    readonly expectedRevision: number;
    readonly feedbackId: string;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly saveWeeklyPlanningBrief: (input: {
    readonly briefText: string;
    readonly expectedRevision: number;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly reopenInteraction: InteractionItemCall<'REOPEN_INTERACTION'>;
  readonly saveReplySuggestion: InteractionItemCall<'SAVE_REPLY_SUGGESTION'>;
  readonly saveContentPackage: (
    input: ContentInput<'SAVE_CONTENT_PACKAGE'>,
  ) => Promise<V2Result<ContentPackage>>;
  readonly skipPlanCandidates: (input: {
    readonly candidateIds: readonly string[];
    readonly expectedRevision: number;
    readonly weekKey: string;
  }) => Promise<V2Result<WeeklyPlan>>;
  readonly skipInteraction: InteractionItemCall<'SKIP_INTERACTION'>;
  readonly undoInteractionManualSent: InteractionItemCall<'UNDO_INTERACTION_MANUAL_SENT'>;
  readonly updatePersona: (input: {
    readonly expectedRevision: number;
    readonly persona: AccountPersonaFields;
  }) => Promise<V2Result<AccountPersona>>;
  readonly updateProviderSettings?: (
    input: V2ProviderSettingsDraft,
  ) => Promise<V2Result<V2ProviderSettingsView>>;
  readonly setProviderCredential?: (
    input: V2ProviderCredentialInput,
  ) => Promise<V2Result<V2ProviderSettingsView>>;
  readonly startProviderCapabilityProbe?: (
    input: V2CapabilityProbeStart,
  ) => Promise<V2Result<V2CapabilityProbeProgress>>;
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

function catalogReadRequest(value: Readonly<Record<string, unknown>>): V2ReadRequest | null {
  if (value.view === 'CATALOG_WORKS' && exactKeys(value, ['limit', 'offset', 'query', 'view'])) {
    if (
      typeof value.limit !== 'number' ||
      !Number.isSafeInteger(value.limit) ||
      value.limit < 1 ||
      value.limit > V2_LIMITS.catalogLimit ||
      typeof value.offset !== 'number' ||
      !Number.isSafeInteger(value.offset) ||
      value.offset < 0 ||
      value.offset > V2_LIMITS.catalogOffset ||
      typeof value.query !== 'string' ||
      utf8Bytes(value.query) > V2_LIMITS.catalogQuery ||
      /[\0\r\n]/u.test(value.query)
    ) {
      throw new V2ContractError('INVALID_REQUEST', ['catalog']);
    }
    return {
      limit: value.limit,
      offset: value.offset,
      query: value.query.normalize('NFC').trim(),
      view: value.view,
    };
  }
  if (value.view === 'CATALOG_WORK' && exactKeys(value, ['view', 'workId'])) {
    if (
      typeof value.workId !== 'string' ||
      utf8Bytes(value.workId) > V2_LIMITS.catalogWorkId ||
      !/^[a-z0-9][a-z0-9._:-]*$/iu.test(value.workId)
    ) {
      throw new V2ContractError('INVALID_REQUEST', ['workId']);
    }
    return { view: value.view, workId: value.workId };
  }
  return null;
}

export function parseAccountPersonaFields(value: unknown): AccountPersonaFields {
  if (!isRecord(value) || !exactKeys(value, ['audience', 'boundary', 'name', 'tone'])) {
    throw new V2ContractError('INVALID_REQUEST', ['persona']);
  }
  const affectedFields: string[] = [];
  const readField = (field: keyof AccountPersonaFields, maximum: number): string => {
    try {
      return boundedText(value[field], maximum, field);
    } catch {
      affectedFields.push(field);
      return '';
    }
  };
  const persona = {
    audience: readField('audience', V2_LIMITS.personaText),
    boundary: readField('boundary', V2_LIMITS.personaBoundary),
    name: readField('name', 80),
    tone: readField('tone', V2_LIMITS.personaText),
  };
  if (affectedFields.length > 0) {
    throw new V2ContractError('INVALID_REQUEST', affectedFields);
  }
  return {
    ...persona,
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
  'SKIPPED',
]);
const days = new Set(['周一', '周二', '周三', '周四', '周五', '周六', '周日']);
const dayLabels = Object.freeze([...days]);

function clockTime(value: unknown, field = 'time'): string {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
    throw new V2ContractError('INVALID_REQUEST', [field]);
  }
  return value;
}

function isoDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new V2ContractError('INVALID_REQUEST', ['date']);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new V2ContractError('INVALID_REQUEST', ['date']);
  }
  return value;
}

function conflictIds(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > V2_LIMITS.conflictCount) {
    throw new V2ContractError('INVALID_REQUEST', ['conflictWithIds']);
  }
  const ids = value.map((id) => boundedText(id, V2_LIMITS.candidateId, 'conflictWithIds'));
  if (new Set(ids).size !== ids.length) {
    throw new V2ContractError('INVALID_REQUEST', ['conflictWithIds']);
  }
  return ids;
}

function parseCandidate(value: unknown): PlanCandidate {
  const legacyKeys = ['book', 'date', 'day', 'id', 'status', 'time', 'title'] as const;
  const currentKeys = [...legacyKeys, 'conflictWithIds'] as const;
  if (
    !isRecord(value) ||
    (!exactKeys(value, legacyKeys) && !exactKeys(value, currentKeys)) ||
    !candidateStatuses.has(value.status as PlanCandidateStatus) ||
    typeof value.day !== 'string' ||
    !days.has(value.day) ||
    typeof value.date !== 'string' ||
    !/^(?:(?:[1-9]|1[0-2])\/(?:[1-9]|[12]\d|3[01])|\d{4}-\d{2}-\d{2})$/u.test(value.date)
  ) {
    throw new V2ContractError('INVALID_REQUEST', ['candidates']);
  }
  if (value.date.includes('-')) isoDate(value.date);
  return {
    book: boundedText(value.book, V2_LIMITS.candidateText, 'book'),
    conflictWithIds: conflictIds(value.conflictWithIds ?? []),
    date: value.date,
    day: value.day,
    id: boundedText(value.id, V2_LIMITS.candidateId, 'id'),
    status: value.status as PlanCandidateStatus,
    time: clockTime(value.time),
    title: boundedText(value.title, V2_LIMITS.candidateText, 'title'),
  };
}

function planningBrief(value: unknown): WeeklyPlanningBrief {
  if (!isRecord(value) || !exactKeys(value, ['revision', 'text']))
    throw new V2ContractError('INVALID_REQUEST', ['brief']);
  if (typeof value.text !== 'string' || utf8Bytes(value.text) > 2_000 || value.text.includes('\0'))
    throw new V2ContractError('INVALID_REQUEST', ['briefText']);
  return { revision: revision(value.revision), text: value.text.normalize('NFC').trim() };
}

function itemFeedback(value: unknown): PlanItemFeedback {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      'candidate',
      'candidateId',
      'details',
      'feedbackId',
      'reason',
      'sourcePlanRevision',
      'status',
    ]) ||
    !PLAN_FEEDBACK_REASONS.includes(value.reason as PlanFeedbackReason) ||
    !['ADOPTED', 'CANDIDATE_READY', 'DISMISSED', 'RECORDED'].includes(String(value.status)) ||
    typeof value.details !== 'string' ||
    utf8Bytes(value.details) > 1_000
  )
    throw new V2ContractError('INVALID_REQUEST', ['itemFeedback']);
  return {
    candidate: value.candidate === null ? null : parseCandidate(value.candidate),
    candidateId: boundedText(value.candidateId, V2_LIMITS.candidateId, 'candidateId'),
    details: value.details.normalize('NFC').trim(),
    feedbackId: boundedText(value.feedbackId, 112, 'feedbackId'),
    reason: value.reason as PlanFeedbackReason,
    sourcePlanRevision: revision(value.sourcePlanRevision),
    status: value.status as PlanItemFeedback['status'],
  };
}

export function parseWeeklyPlan(value: unknown): WeeklyPlan {
  const legacyKeys = ['candidates', 'revision', 'schemaVersion', 'status', 'weekKey'] as const;
  const currentKeys = [
    'brief',
    'candidates',
    'generationBriefRevision',
    'itemFeedback',
    'revision',
    'schemaVersion',
    'status',
    'weekKey',
  ] as const;
  if (
    !isRecord(value) ||
    (!exactKeys(value, legacyKeys) && !exactKeys(value, currentKeys)) ||
    value.schemaVersion !== V2_SCHEMA_VERSION ||
    (value.status !== 'DRAFT' && value.status !== 'CONFIRMED') ||
    !Array.isArray(value.candidates) ||
    value.candidates.length === 0 ||
    value.candidates.length > V2_LIMITS.candidateCount ||
    ('itemFeedback' in value &&
      (!Array.isArray(value.itemFeedback) || value.itemFeedback.length > V2_LIMITS.candidateCount))
  ) {
    throw new V2ContractError('INVALID_REQUEST', ['weeklyPlan']);
  }
  const candidates = value.candidates.map(parseCandidate);
  const feedback = (Array.isArray(value.itemFeedback) ? value.itemFeedback : []).map(itemFeedback);
  if (new Set(candidates.map(({ id }) => id)).size !== candidates.length) {
    throw new V2ContractError('INVALID_REQUEST', ['candidateIds']);
  }
  const ids = new Set(candidates.map(({ id }) => id));
  if (
    candidates.some(
      (candidate) =>
        candidate.conflictWithIds.includes(candidate.id) ||
        candidate.conflictWithIds.some((id) => !ids.has(id)),
    )
  ) {
    throw new V2ContractError('INVALID_REQUEST', ['conflictWithIds']);
  }
  return {
    brief: planningBrief(value.brief ?? { revision: 0, text: '' }),
    candidates,
    generationBriefRevision:
      value.generationBriefRevision === undefined || value.generationBriefRevision === null
        ? null
        : revision(value.generationBriefRevision),
    itemFeedback: feedback,
    revision: revision(value.revision),
    schemaVersion: V2_SCHEMA_VERSION,
    status: value.status,
    weekKey: weekKey(value.weekKey),
  };
}

export function parseV2ProviderActionOutput(
  kind: V2ProviderActionKind,
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID');
  if (kind === 'WEEKLY_PLAN') {
    if (!exactKeys(value, ['candidates']) || !Array.isArray(value.candidates))
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidates']);
    try {
      const candidates = value.candidates.map(parseCandidate);
      parseWeeklyPlan({
        candidates,
        revision: 0,
        schemaVersion: V2_SCHEMA_VERSION,
        status: 'DRAFT',
        weekKey: V2_DEFAULT_WEEK_KEY,
      });
      return Object.freeze({ candidates: Object.freeze(candidates) });
    } catch {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidates']);
    }
  }
  if (kind === 'CONTENT_PACKAGES') {
    if (
      !exactKeys(value, ['packages']) ||
      !Array.isArray(value.packages) ||
      (value.packages.length !== 1 && value.packages.length !== 3)
    ) {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
    }
    try {
      return Object.freeze({
        packages: Object.freeze(value.packages.map(parseContentPackageFields)),
      });
    } catch {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
    }
  }
  if (kind === 'CONTENT_COPY_VERSION') {
    if (
      !exactKeys(value, ['packages']) ||
      !Array.isArray(value.packages) ||
      (value.packages.length !== 1 && value.packages.length !== 3)
    )
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
    try {
      return Object.freeze({
        packages: Object.freeze(value.packages.map(parseContentPackageFields)),
      });
    } catch {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['packages']);
    }
  }
  if (kind === 'CONTENT_COVER')
    throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['cover']);
  if (kind === 'PLAN_ITEM_REPLACEMENT') {
    if (!exactKeys(value, ['candidate']))
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidate']);
    try {
      return Object.freeze({ candidate: parseCandidate(value.candidate) });
    } catch {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidate']);
    }
  }
  if (!exactKeys(value, ['replyText']))
    throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['replyText']);
  try {
    return Object.freeze({
      replyText: normalizeInteractionText(value.replyText, 4_000, 'replyText'),
    });
  } catch {
    throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['replyText']);
  }
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

function parseRescheduleFields(value: Readonly<Record<string, unknown>>): PlanRescheduleFields {
  const mode = value.mode;
  if (mode !== 'DATE_TIME' && mode !== 'DATE_ONLY' && mode !== 'TIME_ONLY') {
    throw new V2ContractError('INVALID_REQUEST', ['mode']);
  }
  const date = value.date === null ? null : isoDate(value.date);
  const time = value.time === null ? null : clockTime(value.time);
  if (
    (mode === 'DATE_TIME' && (date === null || time === null)) ||
    (mode === 'DATE_ONLY' && (date === null || time !== null)) ||
    (mode === 'TIME_ONLY' && (date !== null || time === null))
  ) {
    throw new V2ContractError('INVALID_REQUEST', ['date', 'time']);
  }
  if (value.staggerMinutes !== 0 && (value.staggerMinutes !== 30 || mode === 'DATE_ONLY')) {
    throw new V2ContractError('INVALID_REQUEST', ['staggerMinutes']);
  }
  return {
    candidateIds: candidateIds(value.candidateIds),
    date,
    expectedRevision: revision(value.expectedRevision),
    mode,
    staggerMinutes: value.staggerMinutes,
    time,
    weekKey: weekKey(value.weekKey),
  };
}

function contentToken(value: unknown, field: string, maximum = 128): string {
  if (
    typeof value !== 'string' ||
    utf8Bytes(value) > maximum ||
    !/^[a-z0-9][a-z0-9_-]*$/iu.test(value)
  ) {
    throw new V2ContentError('INVALID_REQUEST', [field]);
  }
  return value;
}

function contentApprovals(value: unknown): readonly ContentApprovalRef[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > V2_LIMITS.candidateCount)
    throw new V2ContentError('INVALID_REQUEST', ['items']);
  const items = value.map((item): ContentApprovalRef => {
    if (!isRecord(item) || !exactKeys(item, ['expectedRevision', 'expectedVersionId', 'packageId']))
      throw new V2ContentError('INVALID_REQUEST', ['items']);
    return {
      expectedRevision: revision(item.expectedRevision),
      expectedVersionId: contentToken(item.expectedVersionId, 'expectedVersionId', 112),
      packageId: contentToken(item.packageId, 'packageId', 96),
    };
  });
  if (new Set(items.map(({ packageId }) => packageId)).size !== items.length)
    throw new V2ContentError('INVALID_REQUEST', ['items']);
  return items;
}

export function parseContentMutationRequest(value: unknown): ContentMutationRequest {
  if (!isRecord(value)) throw new V2ContentError('INVALID_REQUEST');
  if (
    value.action === 'GENERATE_CONTENT_PACKAGES' &&
    exactKeys(value, [
      'action',
      'candidateIds',
      'expectedPlanRevision',
      'idempotencyKey',
      'weekKey',
    ])
  ) {
    const ids = candidateIds(value.candidateIds).map((id) => contentToken(id, 'candidateIds', 64));
    if (ids.length !== 3) throw new V2ContentError('INVALID_REQUEST', ['candidateIds']);
    return {
      action: value.action,
      candidateIds: ids,
      expectedPlanRevision: revision(value.expectedPlanRevision),
      idempotencyKey: contentToken(value.idempotencyKey, 'idempotencyKey'),
      weekKey: weekKey(value.weekKey),
    };
  }
  if (
    value.action === 'SAVE_CONTENT_PACKAGE' &&
    exactKeys(value, ['action', 'expectedRevision', 'expectedVersionId', 'fields', 'packageId'])
  ) {
    return {
      action: value.action,
      expectedRevision: revision(value.expectedRevision),
      expectedVersionId: contentToken(value.expectedVersionId, 'expectedVersionId', 112),
      fields: parseContentPackageFields(value.fields),
      packageId: contentToken(value.packageId, 'packageId', 96),
    };
  }
  if (value.action === 'APPROVE_CONTENT_PACKAGES' && exactKeys(value, ['action', 'items']))
    return { action: value.action, items: contentApprovals(value.items) };
  if (
    value.action === 'EXPORT_CONTENT_PACKAGES' &&
    exactKeys(value, ['action', 'idempotencyKey', 'items'])
  ) {
    return {
      action: value.action,
      idempotencyKey: contentToken(value.idempotencyKey, 'idempotencyKey'),
      items: contentApprovals(value.items),
    };
  }
  if (
    value.action === 'OPEN_CONTENT_EXPORT' &&
    exactKeys(value, ['action', 'exportId']) &&
    typeof value.exportId === 'string' &&
    /^r04-[a-f0-9]{24}$/u.test(value.exportId)
  ) {
    return { action: value.action, exportId: value.exportId };
  }
  throw new V2ContentError('INVALID_REQUEST');
}

export function parseV2ReadRequest(value: unknown): V2ReadRequest {
  assertRequestSize(value);
  if (!isRecord(value)) throw new V2ContractError('INVALID_REQUEST');
  const catalogRequest = catalogReadRequest(value);
  if (catalogRequest !== null) return catalogRequest;
  if (value.view === 'CONTENT_COPY_GENERATION_PREVIEW') {
    const request = parseV2ContentCopyGenerationPreviewRequest(value);
    return { ...request, view: value.view };
  }
  if (value.view === 'PROVIDER_ACTION_PREVIEW' && exactKeys(value, ['intent', 'view'])) {
    return { intent: parseV2ProviderActionIntent(value.intent), view: value.view };
  }
  if (
    (value.view === 'PROVIDER_SETTINGS' || value.view === 'PROVIDER_CAPABILITY_PROBE_PREVIEW') &&
    exactKeys(value, ['view'])
  ) {
    return { view: value.view };
  }
  if (
    value.view === 'PROVIDER_CAPABILITY_PROBE_PROGRESS' &&
    exactKeys(value, ['runId', 'view']) &&
    typeof value.runId === 'string' &&
    /^[a-z0-9_-]{1,128}$/iu.test(value.runId)
  ) {
    return { runId: value.runId, view: value.view };
  }
  if (value.view === 'INTERACTIONS' || value.view === 'INTERACTION_DELETE_PREVIEW')
    return parseInteractionReadRequest(value);
  if (value.view === 'ACCOUNT_PERSONA' && exactKeys(value, ['view'])) {
    return { view: 'ACCOUNT_PERSONA' };
  }
  if (value.view === 'WEEKLY_PLAN' && exactKeys(value, ['view', 'weekKey'])) {
    return { view: 'WEEKLY_PLAN', weekKey: weekKey(value.weekKey) };
  }
  if (value.view === 'CONTENT_PACKAGES' && exactKeys(value, ['view', 'weekKey']))
    return { view: value.view, weekKey: weekKey(value.weekKey) };
  if (
    value.view === 'METRICS_REVIEW' &&
    exactKeys(value, ['snapshotWindow', 'view']) &&
    METRIC_WINDOWS.includes(value.snapshotWindow as MetricWindow)
  )
    return { view: value.view, snapshotWindow: value.snapshotWindow as MetricWindow };
  if (
    value.view === 'PLAN_RESCHEDULE_PREVIEW' &&
    exactKeys(value, [
      'candidateIds',
      'date',
      'expectedRevision',
      'mode',
      'staggerMinutes',
      'time',
      'view',
      'weekKey',
    ])
  ) {
    return { view: 'PLAN_RESCHEDULE_PREVIEW', ...parseRescheduleFields(value) };
  }
  throw new V2ContractError('INVALID_REQUEST');
}

export function parseV2MutationRequest(value: unknown): V2MutationRequest {
  assertRequestSize(value);
  if (!isRecord(value)) throw new V2ContractError('INVALID_REQUEST');
  if (value.action === 'EXECUTE_CONTENT_COPY_GENERATION') {
    return parseV2ContentCopyGenerationExecutionRequest(value);
  }
  if (value.action === 'CONFIRM_PROVIDER_ACTION') {
    return parseV2ProviderActionConfirmation(value);
  }
  if (
    typeof value.action === 'string' &&
    [
      'CLEAR_PROVIDER_CREDENTIAL',
      'SET_PROVIDER_CREDENTIAL',
      'START_PROVIDER_CAPABILITY_PROBE',
      'UPDATE_PROVIDER_SETTINGS',
    ].includes(value.action)
  ) {
    try {
      const settings = parseV2ProviderSettingsMutation(value);
      if (settings !== null) return settings;
    } catch {
      throw new V2ContractError('SETTINGS_INVALID');
    }
  }
  if (
    value.action === 'SAVE_METRIC_SNAPSHOTS' &&
    exactKeys(value, ['action', 'snapshots']) &&
    Array.isArray(value.snapshots) &&
    value.snapshots.length >= 1 &&
    value.snapshots.length <= 20
  )
    return { action: value.action, snapshots: value.snapshots.map(parseMetricSnapshot) };
  if (
    value.action === 'DECIDE_STRATEGY_RECOMMENDATION' &&
    exactKeys(value, ['action', 'expectedRevision', 'id', 'status']) &&
    typeof value.id === 'string' &&
    /^[a-zA-Z0-9_-]{1,128}$/u.test(value.id) &&
    typeof value.expectedRevision === 'number' &&
    Number.isSafeInteger(value.expectedRevision) &&
    value.expectedRevision >= 0 &&
    (value.status === 'ACCEPTED' || value.status === 'REJECTED')
  )
    return {
      action: value.action,
      expectedRevision: value.expectedRevision,
      id: value.id,
      status: value.status,
    };
  if (typeof value.action === 'string' && isInteractionMutationRequest({ action: value.action }))
    return parseInteractionMutationRequest(value);
  if (
    typeof value.action === 'string' &&
    [
      'APPROVE_CONTENT_PACKAGES',
      'EXPORT_CONTENT_PACKAGES',
      'GENERATE_CONTENT_PACKAGES',
      'OPEN_CONTENT_EXPORT',
      'SAVE_CONTENT_PACKAGE',
    ].includes(value.action)
  ) {
    return parseContentMutationRequest(value);
  }
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
    (value.action === 'GENERATE_WEEKLY_PLAN' ||
      value.action === 'LOCK_WEEKLY_PLAN' ||
      value.action === 'UNLOCK_WEEKLY_PLAN') &&
    exactKeys(value, ['action', 'expectedRevision', 'weekKey'])
  ) {
    return {
      action: value.action,
      expectedRevision: revision(value.expectedRevision),
      weekKey: weekKey(value.weekKey),
    };
  }
  if (
    value.action === 'SAVE_WEEKLY_PLANNING_BRIEF' &&
    exactKeys(value, ['action', 'briefText', 'expectedRevision', 'weekKey']) &&
    typeof value.briefText === 'string' &&
    utf8Bytes(value.briefText) <= 2_000 &&
    !value.briefText.includes('\0')
  )
    return {
      action: value.action,
      briefText: value.briefText.normalize('NFC').trim(),
      expectedRevision: revision(value.expectedRevision),
      weekKey: weekKey(value.weekKey),
    };
  if (
    value.action === 'RECORD_PLAN_ITEM_FEEDBACK' &&
    exactKeys(value, [
      'action',
      'candidateId',
      'details',
      'expectedRevision',
      'reason',
      'weekKey',
    ]) &&
    PLAN_FEEDBACK_REASONS.includes(value.reason as PlanFeedbackReason) &&
    typeof value.details === 'string' &&
    utf8Bytes(value.details) <= 1_000
  )
    return {
      action: value.action,
      candidateId: boundedText(value.candidateId, V2_LIMITS.candidateId, 'candidateId'),
      details: value.details.normalize('NFC').trim(),
      expectedRevision: revision(value.expectedRevision),
      reason: value.reason as PlanFeedbackReason,
      weekKey: weekKey(value.weekKey),
    };
  if (
    value.action === 'ADOPT_PLAN_ITEM_REPLACEMENT' &&
    exactKeys(value, ['action', 'candidate', 'expectedRevision', 'feedbackId', 'weekKey'])
  )
    return {
      action: value.action,
      candidate: parseCandidate(value.candidate),
      expectedRevision: revision(value.expectedRevision),
      feedbackId: boundedText(value.feedbackId, 112, 'feedbackId'),
      weekKey: weekKey(value.weekKey),
    };
  if (
    value.action === 'DISMISS_PLAN_ITEM_REPLACEMENT' &&
    exactKeys(value, ['action', 'expectedRevision', 'feedbackId', 'weekKey'])
  )
    return {
      action: value.action,
      expectedRevision: revision(value.expectedRevision),
      feedbackId: boundedText(value.feedbackId, 112, 'feedbackId'),
      weekKey: weekKey(value.weekKey),
    };
  if (
    (value.action === 'CONFIRM_PLAN_CANDIDATES' || value.action === 'SKIP_PLAN_CANDIDATES') &&
    exactKeys(value, ['action', 'candidateIds', 'expectedRevision', 'weekKey'])
  ) {
    return {
      action: value.action,
      candidateIds: candidateIds(value.candidateIds),
      expectedRevision: revision(value.expectedRevision),
      weekKey: weekKey(value.weekKey),
    };
  }
  if (
    value.action === 'RESCHEDULE_PLAN_CANDIDATES' &&
    exactKeys(value, [
      'action',
      'allowConflicts',
      'candidateIds',
      'date',
      'expectedRevision',
      'mode',
      'staggerMinutes',
      'time',
      'weekKey',
    ]) &&
    typeof value.allowConflicts === 'boolean'
  ) {
    return {
      action: 'RESCHEDULE_PLAN_CANDIDATES',
      allowConflicts: value.allowConflicts,
      ...parseRescheduleFields(value),
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
  brief: Object.freeze({ revision: 0, text: '' }),
  candidates: Object.freeze(
    defaultPlanRows.map(([id, day, date, time, title, book, status]) =>
      Object.freeze({
        book,
        conflictWithIds: Object.freeze([]),
        date,
        day,
        id,
        status,
        time,
        title,
      }),
    ),
  ),
  generationBriefRevision: null,
  itemFeedback: Object.freeze([]),
  revision: 0,
  schemaVersion: V2_SCHEMA_VERSION,
  status: 'DRAFT',
  weekKey: V2_DEFAULT_WEEK_KEY,
});

function dateText(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function weekDateRange(value: string): {
  readonly endDate: string;
  readonly startDate: string;
} {
  const validated = weekKey(value);
  const year = Number(validated.slice(0, 4));
  const week = Number(validated.slice(6));
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryFourthOffset = (januaryFourth.getUTCDay() + 6) % 7;
  januaryFourth.setUTCDate(januaryFourth.getUTCDate() - januaryFourthOffset + (week - 1) * 7);
  if (isoWeekKey(januaryFourth) !== validated) {
    throw new V2ContractError('INVALID_REQUEST', ['weekKey']);
  }
  const sunday = new Date(januaryFourth);
  sunday.setUTCDate(januaryFourth.getUTCDate() + 6);
  return Object.freeze({ endDate: dateText(sunday), startDate: dateText(januaryFourth) });
}

function mondayOfIsoWeek(value: string): Date {
  return new Date(`${weekDateRange(value).startDate}T00:00:00.000Z`);
}

function isoWeekKey(date: Date): string {
  const thursday = new Date(date.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3 - ((thursday.getUTCDay() + 6) % 7));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 3 - ((firstThursday.getUTCDay() + 6) % 7));
  const number = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604_800_000);
  return `${String(thursday.getUTCFullYear())}-W${String(number).padStart(2, '0')}`;
}

function candidateIsoDate(candidate: PlanCandidate, planWeekKey: string): string {
  if (candidate.date.includes('-')) return isoDate(candidate.date);
  const monday = mondayOfIsoWeek(planWeekKey);
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date(monday.getTime() + offset * 86_400_000);
    const shortDate = `${String(date.getUTCMonth() + 1)}/${String(date.getUTCDate())}`;
    if (shortDate === candidate.date) return dateText(date);
  }
  throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
}

function shiftedSchedule(
  date: string,
  time: string,
  minutes: number,
): {
  readonly date: string;
  readonly day: string;
  readonly time: string;
  readonly weekKey: string;
} {
  const [hours, minute] = time.split(':').map(Number);
  const instant = new Date(`${date}T00:00:00.000Z`);
  instant.setUTCMinutes((hours ?? 0) * 60 + (minute ?? 0) + minutes);
  return {
    date: dateText(instant),
    day: dayLabels[(instant.getUTCDay() + 6) % 7] ?? '周一',
    time: `${String(instant.getUTCHours()).padStart(2, '0')}:${String(
      instant.getUTCMinutes(),
    ).padStart(2, '0')}`,
    weekKey: isoWeekKey(instant),
  };
}

export function previewPlanReschedule(
  plan: WeeklyPlan,
  input: PlanRescheduleFields,
): PlanReschedulePreview {
  const current = parseWeeklyPlan(plan);
  const request = parseRescheduleFields({ ...input });
  if (current.weekKey !== request.weekKey || current.revision !== request.expectedRevision) {
    throw new V2ContractError('REVISION_CONFLICT', ['weeklyPlan']);
  }
  const byId = new Map(current.candidates.map((candidate) => [candidate.id, candidate]));
  const selected = request.candidateIds.map((id) => {
    const candidate = byId.get(id);
    if (candidate === undefined || candidate.status === 'SKIPPED') {
      throw new V2ContractError('INVALID_REQUEST', ['candidateIds']);
    }
    return candidate;
  });
  const items = selected.map((candidate, index): PlanReschedulePreviewItem => {
    const fromDate = candidateIsoDate(candidate, current.weekKey);
    const schedule = shiftedSchedule(
      request.date ?? fromDate,
      request.time ?? candidate.time,
      index * request.staggerMinutes,
    );
    return {
      candidateId: candidate.id,
      fromDate,
      fromTime: candidate.time,
      targetDate: schedule.date,
      targetDay: schedule.day,
      targetTime: schedule.time,
      targetWeekKey: schedule.weekKey,
      title: candidate.title,
    };
  });
  const selectedIds = new Set(request.candidateIds);
  const conflicts: PlanRescheduleConflict[] = [];
  let conflictCount = 0;
  for (let incomingIndex = 0; incomingIndex < items.length; incomingIndex += 1) {
    const incoming = items[incomingIndex];
    if (incoming === undefined) continue;
    for (const existingCandidate of current.candidates) {
      if (existingCandidate.status === 'SKIPPED' || selectedIds.has(existingCandidate.id)) continue;
      const existingDate = candidateIsoDate(existingCandidate, current.weekKey);
      if (existingDate !== incoming.targetDate || existingCandidate.time !== incoming.targetTime)
        continue;
      conflictCount += 1;
      if (conflicts.length < V2_LIMITS.conflictCount) {
        conflicts.push({
          existing: {
            candidateId: existingCandidate.id,
            date: existingDate,
            time: existingCandidate.time,
            title: existingCandidate.title,
          },
          incoming: {
            candidateId: incoming.candidateId,
            date: incoming.targetDate,
            time: incoming.targetTime,
            title: incoming.title,
          },
        });
      }
    }
    for (let otherIndex = incomingIndex + 1; otherIndex < items.length; otherIndex += 1) {
      const other = items[otherIndex];
      if (
        other === undefined ||
        other.targetDate !== incoming.targetDate ||
        other.targetTime !== incoming.targetTime
      )
        continue;
      conflictCount += 1;
      if (conflicts.length < V2_LIMITS.conflictCount) {
        conflicts.push({
          existing: {
            candidateId: incoming.candidateId,
            date: incoming.targetDate,
            time: incoming.targetTime,
            title: incoming.title,
          },
          incoming: {
            candidateId: other.candidateId,
            date: other.targetDate,
            time: other.targetTime,
            title: other.title,
          },
        });
      }
    }
  }
  return Object.freeze({
    affectedCount: items.length,
    conflictCount,
    conflicts: Object.freeze(conflicts),
    crossWeekCount: items.filter(({ targetWeekKey }) => targetWeekKey !== current.weekKey).length,
    items: Object.freeze(items),
  });
}

function personaSeed(persona: AccountPersona): number {
  let seed = 0;
  for (const character of `${persona.name}\n${persona.audience}\n${persona.tone}\n${persona.boundary}`) {
    seed = (seed + (character.codePointAt(0) ?? 0)) % defaultPlanRows.length;
  }
  return seed;
}

export class ScriptedPlanningProvider {
  public generate(input: {
    readonly persona: AccountPersona;
    readonly planRevision: number;
    readonly weekKey: string;
  }): readonly PlanCandidate[] {
    const persona = parseAccountPersona(input.persona);
    const targetWeekKey = weekKey(input.weekKey);
    revision(input.planRevision);
    const monday = mondayOfIsoWeek(targetWeekKey);
    const seed = personaSeed(persona);
    return Object.freeze(
      defaultPlanRows.map((_, index) => {
        const source = defaultPlanRows[(index + seed) % defaultPlanRows.length];
        if (source === undefined) throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
        const dayIndex = Math.floor(index / 3);
        const slotIndex = index % 3;
        const date = new Date(monday.getTime() + dayIndex * 86_400_000);
        return Object.freeze({
          book: source[5],
          conflictWithIds: Object.freeze([]),
          date: dateText(date),
          day: dayLabels[dayIndex] ?? '周一',
          id: `${targetWeekKey}-slot-${String(index + 1).padStart(2, '0')}`,
          status: ([9, 19, 20] as readonly number[]).includes(index) ? 'PENDING' : 'PLANNED',
          time: ['10:00', '14:00', '20:00'][slotIndex] ?? '10:00',
          title: source[4],
        });
      }),
    );
  }
}

export function summarizeV2Workspace(
  persona: AccountPersona,
  plan: WeeklyPlan,
): V2WorkspaceSummary {
  const validatedPersona = parseAccountPersona(persona);
  const validatedPlan = parseWeeklyPlan(plan);
  return Object.freeze({
    conflictCount: validatedPlan.candidates.filter(
      ({ conflictWithIds: conflicts, status }) => status === 'CONFLICT' || conflicts.length > 0,
    ).length,
    confirmedCount: validatedPlan.candidates.filter(({ status }) => status === 'CONFIRMED').length,
    pendingCount: validatedPlan.candidates.filter(({ status }) => status === 'PENDING').length,
    personaRevision: validatedPersona.revision,
    planRevision: validatedPlan.revision,
  });
}

export function weeklyPlanLockReasons(planValue: WeeklyPlan): readonly string[] {
  const plan = parseWeeklyPlan(planValue);
  const active = plan.candidates.filter((candidate) => candidate.status !== 'SKIPPED');
  const reasons: string[] = [];
  const pending = active.filter((candidate) => candidate.status === 'PENDING').length;
  const conflicts = active.filter(
    (candidate) => candidate.status === 'CONFLICT' || candidate.conflictWithIds.length > 0,
  ).length;
  const nonLockable = active.filter(
    (candidate) => !['CONFIRMED', 'EXPORTED'].includes(candidate.status),
  ).length;
  if (pending > 0) reasons.push(`${pending}篇待确认`);
  if (conflicts > 0) reasons.push(`${conflicts}处冲突`);
  if (nonLockable > 0 && pending === 0 && conflicts === 0)
    reasons.push(`${nonLockable}篇尚不可锁定`);
  return Object.freeze(reasons);
}

export interface V2RepositoryPort {
  readonly getOrCreatePersona: (seed: AccountPersona) => AccountPersona;
  readonly getOrCreateWeeklyPlan: (seed: WeeklyPlan, personaSeed: AccountPersona) => WeeklyPlan;
  readonly savePersona: (persona: AccountPersonaFields, expectedRevision: number) => AccountPersona;
  readonly saveWeeklyPlan: (plan: WeeklyPlan, expectedRevision: number) => WeeklyPlan;
  readonly unlockWeeklyPlan: (plan: WeeklyPlan, expectedRevision: number) => WeeklyPlan;
}

function clearConflictLinks(
  candidates: readonly PlanCandidate[],
  removedIds: ReadonlySet<string>,
): readonly PlanCandidate[] {
  return candidates.map((candidate) => {
    const links = removedIds.has(candidate.id)
      ? []
      : candidate.conflictWithIds.filter((id) => !removedIds.has(id));
    return {
      ...candidate,
      conflictWithIds: links,
      status:
        candidate.status === 'CONFLICT' && links.length === 0
          ? ('PLANNED' as const)
          : candidate.status,
    };
  });
}

export class V2ApplicationFacade {
  readonly #planningProvider: ScriptedPlanningProvider;
  readonly #repository: V2RepositoryPort;

  public constructor(
    repository: V2RepositoryPort,
    planningProvider = new ScriptedPlanningProvider(),
  ) {
    this.#planningProvider = planningProvider;
    this.#repository = repository;
  }

  public read(value: unknown): AccountPersona | PlanReschedulePreview | WeeklyPlan {
    const request = parseV2ReadRequest(value);
    if (request.view === 'ACCOUNT_PERSONA') {
      return this.#repository.getOrCreatePersona(DEFAULT_ACCOUNT_PERSONA);
    }
    if (
      request.view === 'CATALOG_WORKS' ||
      request.view === 'CATALOG_WORK' ||
      request.view === 'METRICS_REVIEW' ||
      request.view === 'CONTENT_COPY_GENERATION_PREVIEW' ||
      request.view === 'PROVIDER_ACTION_PREVIEW' ||
      request.view === 'PROVIDER_SETTINGS' ||
      request.view === 'PROVIDER_CAPABILITY_PROBE_PREVIEW' ||
      request.view === 'PROVIDER_CAPABILITY_PROBE_PROGRESS'
    )
      throw new V2ContractError('INVALID_REQUEST');
    if (
      request.view === 'CONTENT_PACKAGES' ||
      request.view === 'INTERACTIONS' ||
      request.view === 'INTERACTION_DELETE_PREVIEW'
    )
      throw new V2ContractError('INVALID_REQUEST');
    const current = this.#readPlan(request.weekKey);
    return request.view === 'WEEKLY_PLAN' ? current : previewPlanReschedule(current, request);
  }

  public mutate(value: unknown): AccountPersona | WeeklyPlan {
    const request = parseV2MutationRequest(value);
    if (request.action === 'UPDATE_PERSONA') {
      this.#repository.getOrCreatePersona(DEFAULT_ACCOUNT_PERSONA);
      return this.#repository.savePersona(request.persona, request.expectedRevision);
    }
    if (
      request.action === 'SAVE_METRIC_SNAPSHOTS' ||
      request.action === 'DECIDE_STRATEGY_RECOMMENDATION' ||
      request.action === 'EXECUTE_CONTENT_COPY_GENERATION' ||
      request.action === 'CONFIRM_PROVIDER_ACTION' ||
      request.action === 'UPDATE_PROVIDER_SETTINGS' ||
      request.action === 'SET_PROVIDER_CREDENTIAL' ||
      request.action === 'CLEAR_PROVIDER_CREDENTIAL' ||
      request.action === 'START_PROVIDER_CAPABILITY_PROBE'
    )
      throw new V2ContractError('INVALID_REQUEST');
    if (
      request.action === 'GENERATE_CONTENT_PACKAGES' ||
      request.action === 'SAVE_CONTENT_PACKAGE' ||
      request.action === 'APPROVE_CONTENT_PACKAGES' ||
      request.action === 'EXPORT_CONTENT_PACKAGES' ||
      request.action === 'OPEN_CONTENT_EXPORT'
    ) {
      throw new V2ContractError('INVALID_REQUEST');
    }
    if (isInteractionMutationRequest(request)) throw new V2ContractError('INVALID_REQUEST');
    const current = this.#readPlan(request.weekKey);
    this.#assertRevision(current, request.expectedRevision);
    if (request.action === 'GENERATE_WEEKLY_PLAN') {
      this.#assertDraft(current);
      const persona = parseAccountPersona(
        this.#repository.getOrCreatePersona(DEFAULT_ACCOUNT_PERSONA),
      );
      const candidates = this.#planningProvider.generate({
        persona,
        planRevision: current.revision,
        weekKey: current.weekKey,
      });
      return this.#repository.saveWeeklyPlan(
        parseWeeklyPlan({ ...current, candidates, status: 'DRAFT' }),
        request.expectedRevision,
      );
    }
    if (request.action === 'SAVE_WEEKLY_PLANNING_BRIEF') {
      this.#assertDraft(current);
      if (current.brief.text === request.briefText) return current;
      return this.#repository.saveWeeklyPlan(
        parseWeeklyPlan({
          ...current,
          brief: { revision: current.brief.revision + 1, text: request.briefText },
        }),
        request.expectedRevision,
      );
    }
    if (request.action === 'RECORD_PLAN_ITEM_FEEDBACK') {
      this.#assertDraft(current);
      if (!current.candidates.some(({ id }) => id === request.candidateId))
        throw new V2ContractError('INVALID_REQUEST', ['candidateId']);
      const feedbackId = `${request.candidateId.slice(0, 72)}-feedback-${current.revision + 1}`;
      return this.#repository.saveWeeklyPlan(
        parseWeeklyPlan({
          ...current,
          itemFeedback: [
            ...current.itemFeedback,
            {
              candidate: null,
              candidateId: request.candidateId,
              details: request.details,
              feedbackId,
              reason: request.reason,
              sourcePlanRevision: current.revision,
              status: 'RECORDED',
            },
          ],
        }),
        request.expectedRevision,
      );
    }
    if (
      request.action === 'ADOPT_PLAN_ITEM_REPLACEMENT' ||
      request.action === 'DISMISS_PLAN_ITEM_REPLACEMENT'
    ) {
      this.#assertDraft(current);
      const feedback = current.itemFeedback.find(
        ({ feedbackId }) => feedbackId === request.feedbackId,
      );
      if (feedback?.status !== 'CANDIDATE_READY' || feedback.candidate === null)
        throw new V2ContractError('INVALID_REQUEST', ['feedbackId']);
      const candidate = request.action === 'ADOPT_PLAN_ITEM_REPLACEMENT' ? request.candidate : null;
      if (candidate !== null && candidate.id !== feedback.candidateId)
        throw new V2ContractError('INVALID_REQUEST', ['candidateId']);
      return this.#repository.saveWeeklyPlan(
        parseWeeklyPlan({
          ...current,
          candidates:
            candidate === null
              ? current.candidates
              : current.candidates.map((item) => (item.id === candidate.id ? candidate : item)),
          itemFeedback: current.itemFeedback.map((item) =>
            item.feedbackId === feedback.feedbackId
              ? {
                  ...item,
                  candidate: candidate ?? item.candidate,
                  status: candidate === null ? 'DISMISSED' : 'ADOPTED',
                }
              : item,
          ),
        }),
        request.expectedRevision,
      );
    }
    if (request.action === 'LOCK_WEEKLY_PLAN') {
      if (current.status === 'CONFIRMED') return current;
      if (weeklyPlanLockReasons(current).length > 0) {
        throw new V2ContractError('PLAN_CONFLICT', ['weeklyPlan']);
      }
      return this.#repository.saveWeeklyPlan(
        parseWeeklyPlan({ ...current, status: 'CONFIRMED' }),
        request.expectedRevision,
      );
    }
    if (request.action === 'UNLOCK_WEEKLY_PLAN') {
      if (current.status === 'DRAFT') return current;
      return this.#repository.unlockWeeklyPlan(
        parseWeeklyPlan({ ...current, status: 'DRAFT' }),
        request.expectedRevision,
      );
    }
    this.#assertDraft(current);
    const selected = new Set(request.candidateIds);
    if (request.candidateIds.some((id) => !current.candidates.some((item) => item.id === id))) {
      throw new V2ContractError('INVALID_REQUEST', ['candidateIds']);
    }
    if (request.action === 'CONFIRM_PLAN_CANDIDATES') {
      const candidates = current.candidates.map((item) =>
        selected.has(item.id) ? { ...item, status: 'CONFIRMED' as const } : item,
      );
      return this.#repository.saveWeeklyPlan(
        parseWeeklyPlan({ ...current, candidates }),
        request.expectedRevision,
      );
    }
    if (request.action === 'SKIP_PLAN_CANDIDATES') {
      const candidates = clearConflictLinks(current.candidates, selected).map((item) =>
        selected.has(item.id) ? { ...item, conflictWithIds: [], status: 'SKIPPED' as const } : item,
      );
      return this.#repository.saveWeeklyPlan(
        parseWeeklyPlan({ ...current, candidates }),
        request.expectedRevision,
      );
    }
    const preview = previewPlanReschedule(current, request);
    if (preview.conflictCount > 0 && !request.allowConflicts) {
      throw new V2ContractError('PLAN_CONFLICT', ['conflicts']);
    }
    const proposed = new Map(preview.items.map((item) => [item.candidateId, item]));
    const links = new Map<string, Set<string>>();
    for (const conflict of preview.conflicts) {
      const existing = links.get(conflict.existing.candidateId) ?? new Set<string>();
      existing.add(conflict.incoming.candidateId);
      links.set(conflict.existing.candidateId, existing);
      const incoming = links.get(conflict.incoming.candidateId) ?? new Set<string>();
      incoming.add(conflict.existing.candidateId);
      links.set(conflict.incoming.candidateId, incoming);
    }
    const candidates = clearConflictLinks(current.candidates, selected).map((item) => {
      const schedule = proposed.get(item.id);
      const conflictWithIds = [
        ...new Set([...(item.conflictWithIds ?? []), ...(links.get(item.id) ?? [])]),
      ].sort();
      const status =
        conflictWithIds.length > 0 && item.status !== 'CONFIRMED' && item.status !== 'EXPORTED'
          ? ('CONFLICT' as const)
          : item.status;
      return schedule === undefined
        ? { ...item, conflictWithIds, status }
        : {
            ...item,
            conflictWithIds,
            date: schedule.targetDate,
            day: schedule.targetDay,
            status,
            time: schedule.targetTime,
          };
    });
    return this.#repository.saveWeeklyPlan(
      parseWeeklyPlan({ ...current, candidates }),
      request.expectedRevision,
    );
  }

  public applyGeneratedWeeklyPlan(
    week: string,
    expectedRevision: number,
    candidatesValue: unknown,
  ): WeeklyPlan {
    const current = this.#readPlan(week);
    this.#assertRevision(current, expectedRevision);
    this.#assertDraft(current);
    if (!Array.isArray(candidatesValue)) {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidates']);
    }
    let generated: readonly PlanCandidate[];
    try {
      const supplied = candidatesValue.map(parseCandidate);
      if (
        supplied.length !== 21 ||
        new Set(supplied.map((candidate) => candidate.id)).size !== 21 ||
        new Set(supplied.map((candidate) => candidate.title.trim())).size !== 21 ||
        supplied.some((candidate) => candidate.title.trim() === '' || candidate.book.trim() === '')
      ) {
        throw new TypeError('Invalid strict weekly plan count.');
      }
      const monday = mondayOfIsoWeek(current.weekKey);
      generated = supplied.map((candidate, index) => {
        const dayIndex = Math.floor(index / 3);
        const slotIndex = index % 3;
        const date = new Date(monday.getTime() + dayIndex * 86_400_000);
        return {
          ...candidate,
          conflictWithIds: [],
          date: dateText(date),
          day: dayLabels[dayIndex] ?? '周一',
          id: `${current.weekKey}-slot-${String(index + 1).padStart(2, '0')}`,
          status: 'PENDING' as const,
          time: (['10:00', '14:00', '20:00'] as const)[slotIndex] ?? '10:00',
        };
      });
      parseWeeklyPlan({ ...current, candidates: generated, status: 'DRAFT' });
    } catch {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidates']);
    }
    return this.#repository.saveWeeklyPlan(
      parseWeeklyPlan({
        ...current,
        candidates: generated,
        generationBriefRevision: current.brief.revision,
        status: 'DRAFT',
      }),
      expectedRevision,
    );
  }

  public stagePlanItemReplacement(
    week: string,
    expectedRevision: number,
    feedbackId: string,
    candidateValue: unknown,
  ): WeeklyPlan {
    const current = this.#readPlan(week);
    this.#assertRevision(current, expectedRevision);
    this.#assertDraft(current);
    const feedback = current.itemFeedback.find((item) => item.feedbackId === feedbackId);
    if (feedback?.status !== 'RECORDED')
      throw new V2ProviderActionError('PROVIDER_ACTION_STALE', ['feedbackId']);
    let candidate: PlanCandidate;
    try {
      candidate = parseCandidate(candidateValue);
    } catch {
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidate']);
    }
    if (candidate.id !== feedback.candidateId || candidate.conflictWithIds.length > 0)
      throw new V2ProviderActionError('PROVIDER_OUTPUT_INVALID', ['candidate']);
    return this.#repository.saveWeeklyPlan(
      parseWeeklyPlan({
        ...current,
        itemFeedback: current.itemFeedback.map((item) =>
          item.feedbackId === feedbackId
            ? { ...item, candidate: { ...candidate, status: 'PENDING' }, status: 'CANDIDATE_READY' }
            : item,
        ),
      }),
      expectedRevision,
    );
  }

  #assertDraft(plan: WeeklyPlan): void {
    if (plan.status === 'CONFIRMED') {
      throw new V2ContractError('PLAN_LOCKED', ['weeklyPlan']);
    }
  }

  #assertRevision(plan: WeeklyPlan, expectedRevision: number): void {
    if (plan.revision !== expectedRevision) {
      throw new V2ContractError('REVISION_CONFLICT', ['weeklyPlan']);
    }
  }

  #readPlan(requestedWeekKey: string): WeeklyPlan {
    const monday = mondayOfIsoWeek(requestedWeekKey);
    return this.#repository.getOrCreateWeeklyPlan(
      {
        ...DEFAULT_WEEKLY_PLAN,
        candidates: DEFAULT_WEEKLY_PLAN.candidates.map((candidate, index) => ({
          ...candidate,
          date: dateText(new Date(monday.getTime() + Math.floor(index / 3) * 86_400_000)),
        })),
        weekKey: requestedWeekKey,
      },
      DEFAULT_ACCOUNT_PERSONA,
    );
  }
}

export function toV2Exception(error: unknown): V2ExceptionSummary {
  if (error instanceof V2ProviderActionError) {
    const messages: Readonly<Record<V2ProviderActionErrorCode, string>> = Object.freeze({
      BUDGET_HARD_STOP: '本地预算硬上限已阻止本次调用。',
      CAPABILITY_STALE: '能力证据已过期，请重新验证后再预览。',
      CAPABILITY_TRANSIENT_FAILURE: '图片服务暂不可用（HTTP 503）；文字相关功能可继续。',
      CAPABILITY_UNKNOWN: '所需能力尚未验证，请先在设置中验证。',
      CAPABILITY_UNSUPPORTED: '当前模型不支持所需能力，请前往设置。',
      CREDENTIAL_NOT_CONFIGURED: '凭据尚未配置或需要重新认证，请前往设置。',
      PROVIDER_NOT_CONFIGURED: 'Provider、Base URL 或模型槽尚未配置完整。',
      PROVIDER_ACTION_BLOCKED: '当前模型设置、能力或业务状态不满足本次操作。',
      PROVIDER_ACTION_CANCELLED: '本次模型操作已取消，未写入业务结果。',
      PROVIDER_ACTION_CONFIG_CHANGED: '预览后 AI 配置已变化，请重新预览。',
      PROVIDER_ACTION_CREDENTIAL_CHANGED: '预览后凭据状态已变化，请重新预览。',
      PROVIDER_ACTION_EXPIRED: '确认已过期，请重新预览。',
      PROVIDER_ACTION_IMAGE_SERVICE_UNAVAILABLE:
        '图片服务当前不可用（HTTP 503），文案不受影响；可稍后单独重试封面。',
      PROVIDER_ACTION_REPLAYED: '该确认已使用，请重新预览。',
      PROVIDER_ACTION_SOURCE_CHANGED: '预览后目标数据已变化，请重新预览。',
      PROVIDER_ACTION_STALE: '预览后业务数据已变化，请重新预览。',
      PROVIDER_ACTION_TARGET_WEEK_CHANGED: '目标周已变化，请重新预览。',
      PROVIDER_ACTION_TOKEN_INVALID: '确认已失效或已使用，请重新预览。',
      PROVIDER_ACTION_UNCERTAIN: '请求结果不确定，系统未写入业务结果，请先检查本地账本。',
      PROVIDER_ACTION_UNKNOWN_FEE_CONSENT_REQUIRED:
        '费用未知，需重新预览并明确授权本次最多 1 个请求。',
      PROVIDER_ACTION_BUDGET_HARD_STOP: '本地预算硬上限已阻止本次调用。',
      UNKNOWN_FEE_CONSENT_REQUIRED: '费用未知，需重新预览并明确授权本次最多 1 个请求。',
      PROVIDER_OUTPUT_INVALID: '模型结果不符合严格合同，系统未写入业务结果。',
    });
    const fieldLabel: Readonly<Record<string, string>> = Object.freeze({
      credentialBinding: '凭据绑定',
      planRevision: '计划版本',
      researchModelId: '研究模型',
      weeklyPlan: '周计划版本',
      writingModelId: '写作模型',
    });
    const affected = error.affectedFields.map((field) => fieldLabel[field] ?? field).join('、');
    const message =
      affected === ''
        ? messages[error.code]
        : error.code === 'PROVIDER_ACTION_CONFIG_CHANGED'
          ? `预览后${affected}已变化，请重新预览。`
          : error.code === 'PROVIDER_ACTION_CREDENTIAL_CHANGED'
            ? `预览后${affected}已变化，请重新预览。`
            : error.code === 'PROVIDER_ACTION_STALE' ||
                error.code === 'PROVIDER_ACTION_SOURCE_CHANGED'
              ? `预览后${affected}已变化，请重新预览。`
              : messages[error.code];
    return {
      affectedFields: error.affectedFields,
      code: error.code,
      message,
      severity: error.code === 'PROVIDER_ACTION_STALE' ? 'WARNING' : 'ERROR',
      suggestedAction:
        error.code === 'PROVIDER_ACTION_UNCERTAIN' ||
        error.code === 'PROVIDER_ACTION_IMAGE_SERVICE_UNAVAILABLE'
          ? '打开设置与模型账本核对后再决定'
          : '检查设置后重新预览',
    };
  }
  if (error instanceof V2InteractionError) {
    const messages = Object.freeze({
      INTERACTION_CORRUPT: '本地互动文件缺失或校验失败，未执行操作。',
      INTERACTION_STATE_INVALID: '当前互动状态不允许执行此操作。',
      INVALID_REQUEST: '互动请求不符合本地合同。',
      REVISION_CONFLICT: '互动项已更新，请重新载入后再试。',
    } satisfies Readonly<Record<V2InteractionErrorCode, string>>);
    return {
      affectedFields: error.affectedFields,
      code: error.code,
      message: messages[error.code],
      severity: error.code === 'REVISION_CONFLICT' ? 'WARNING' : 'ERROR',
      suggestedAction: error.code === 'REVISION_CONFLICT' ? '重新载入互动页' : '检查互动状态后重试',
    };
  }
  if (error instanceof V2ContentError) {
    const messages = Object.freeze({
      CONTENT_CORRUPT: '内容文件缺失或校验失败，未执行操作。',
      CONTENT_NOT_APPROVED: '只能导出当前已批准版本。',
      CONTENT_NOT_READY: '请先锁定周计划，再生成内容包。',
      EXPORT_FAILED: '本地发布包导出失败，未留下成功目录。',
      INVALID_REQUEST: '内容请求不符合本地合同。',
      REVISION_CONFLICT: '内容已更新，请重新载入后再试。',
    } satisfies Readonly<Record<string, string>>);
    return {
      affectedFields: error.affectedFields,
      code: error.code,
      message: messages[error.code],
      severity: error.code === 'REVISION_CONFLICT' ? 'WARNING' : 'ERROR',
      suggestedAction: error.code === 'REVISION_CONFLICT' ? '重新载入内容页' : '检查内容状态后重试',
    };
  }
  if (error instanceof V2ContractError) {
    const revisionConflict = error.code === 'REVISION_CONFLICT';
    const planConflict = error.code === 'PLAN_CONFLICT';
    const locked = error.code === 'PLAN_LOCKED';
    const unavailable = error.code === 'PERSISTENCE_UNAVAILABLE';
    const settingsNotReady = error.code === 'SETTINGS_NOT_READY';
    const settingsInvalid = error.code === 'SETTINGS_INVALID';
    const credentialError = error.code === 'CREDENTIAL_ERROR';
    const capabilityBlocked = error.code === 'CAPABILITY_PROBE_BLOCKED';
    const fieldLabels: Readonly<Record<string, string>> = Object.freeze({
      audience: '目标受众',
      boundary: '内容边界',
      name: '账号名称',
      tone: '表达语气',
    });
    const personaFields = error.affectedFields
      .map((field) => fieldLabels[field])
      .filter((field): field is string => field !== undefined);
    return {
      affectedFields: error.affectedFields,
      code: error.code,
      message: revisionConflict
        ? '本机数据已更新，请重新载入后再试。'
        : planConflict
          ? '检测到时间冲突；尚未修改计划，请复核后再决定。'
          : locked
            ? '周计划已锁定，只能查看，不能继续修改。'
            : unavailable
              ? '本机保存暂时不可用。'
              : settingsNotReady
                ? '本地设置项目尚未就绪，请先完成本地数据目录初始化。'
                : settingsInvalid
                  ? 'Provider 设置不符合现有本地合同，请检查标出的字段。'
                  : credentialError
                    ? '本地凭据操作失败；旧凭据不会回显，请重新输入或稍后重试。'
                    : capabilityBlocked
                      ? '能力探测尚不能开始，请检查凭据、模型与预算政策。'
                      : personaFields.length > 0
                        ? `请填写或修正：${personaFields.join('、')}。`
                        : '请求内容不符合本地合同。',
      severity: revisionConflict || planConflict || locked ? 'WARNING' : 'ERROR',
      suggestedAction: revisionConflict
        ? '重新载入当前页面'
        : planConflict
          ? '返回修改时间，或明确选择仍然应用'
          : locked
            ? '保留当前只读计划'
            : unavailable
              ? '关闭后重新启动应用'
              : settingsNotReady
                ? '完成本地项目初始化'
                : settingsInvalid
                  ? '检查 Base URL、模型 ID 与 revision'
                  : credentialError
                    ? '重新输入凭据或确认清除操作'
                    : capabilityBlocked
                      ? '先查看探测预览中的阻止原因'
                      : '检查字段后重试',
    };
  }
  return {
    affectedFields: [],
    code: 'LOCAL_OPERATION_FAILED',
    message: '本地操作未完成，请重新载入后再试。',
    severity: 'ERROR',
    suggestedAction: '重新载入当前页面；如仍失败再关闭后重新启动应用',
  };
}
