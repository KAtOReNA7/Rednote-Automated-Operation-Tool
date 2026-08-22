import {
  parseAccountPersona,
  parseContentPackageFields,
  parseWeeklyPlan,
  type AccountPersona,
  type AccountPersonaFields,
  type ContentPackageFields,
  type WeeklyPlan,
} from '@mystery-operations/v2';

import {
  emptyW2Slices,
  parseW2Slices,
  type WebClipReceipt,
  type WebInteractionItem,
  type WebLibraryItem,
  type WebMetricVersion,
  type WebProviderSettings,
  type WebStrategyDecision,
} from './w2-state.js';

export const WEB_WORKSPACE_SCHEMA_VERSION = 2 as const;
export const WEB_WORKSPACE_LEGACY_SCHEMA_VERSION = 1 as const;
export const WEB_WORKSPACE_FORMAT = 'rednote-web-workspace' as const;

export interface WebContentVersion {
  readonly createdAt: string;
  readonly fields: ContentPackageFields;
  readonly modelId: string | null;
  readonly source: 'LOCAL' | 'MODEL';
  readonly usage: Readonly<{
    readonly inputTokens: number | null;
    readonly outputTokens: number | null;
  }> | null;
  readonly version: number;
  readonly versionId: string;
}

export interface WebContentPackage {
  readonly candidateId: string;
  readonly id: string;
  readonly revision: number;
  readonly status: 'APPROVED' | 'DRAFT' | 'REVIEW_REQUIRED';
  readonly versions: readonly WebContentVersion[];
  readonly weekKey: string;
}

export interface WebContentWorkspace {
  readonly packages: readonly WebContentPackage[];
  readonly weekKey: string;
}

export interface WebWorkspaceState {
  readonly activeWeekKey: string;
  readonly clipReceipts: readonly WebClipReceipt[];
  readonly contentByWeek: Readonly<Record<string, WebContentWorkspace>>;
  readonly interactions: readonly WebInteractionItem[];
  readonly library: readonly WebLibraryItem[];
  readonly metricSnapshots: readonly WebMetricVersion[];
  readonly persona: AccountPersona;
  readonly plans: Readonly<Record<string, WeeklyPlan>>;
  readonly provider: WebProviderSettings;
  readonly schemaVersion: typeof WEB_WORKSPACE_SCHEMA_VERSION;
  readonly strategyDecisions: readonly WebStrategyDecision[];
  readonly workspaceId: string;
}

export interface WebWorkspaceStateV1 {
  readonly activeWeekKey: string;
  readonly contentByWeek: Readonly<Record<string, WebContentWorkspaceV1>>;
  readonly persona: AccountPersona;
  readonly plans: Readonly<Record<string, WeeklyPlan>>;
  readonly schemaVersion: typeof WEB_WORKSPACE_LEGACY_SCHEMA_VERSION;
  readonly workspaceId: string;
}

export interface WebContentVersionV1 {
  readonly createdAt: string;
  readonly fields: ContentPackageFields;
  readonly version: number;
  readonly versionId: string;
}

export interface WebContentPackageV1 {
  readonly candidateId: string;
  readonly id: string;
  readonly revision: number;
  readonly status: 'DRAFT' | 'REVIEW_REQUIRED';
  readonly versions: readonly WebContentVersionV1[];
  readonly weekKey: string;
}

export interface WebContentWorkspaceV1 {
  readonly packages: readonly WebContentPackageV1[];
  readonly weekKey: string;
}

export interface WebWorkspaceManifest {
  readonly createdAt: string;
  readonly format: typeof WEB_WORKSPACE_FORMAT;
  readonly schemaVersion:
    typeof WEB_WORKSPACE_LEGACY_SCHEMA_VERSION | typeof WEB_WORKSPACE_SCHEMA_VERSION;
  readonly workspaceId: string;
}

export interface WebSnapshotEnvelope {
  readonly generation: number;
  readonly savedAt: string;
  readonly schemaVersion: typeof WEB_WORKSPACE_SCHEMA_VERSION;
  readonly state: WebWorkspaceState;
  readonly workspaceId: string;
}

export interface WebWorkspaceIndex {
  readonly bytes: number;
  readonly generation: number;
  readonly schemaVersion:
    typeof WEB_WORKSPACE_LEGACY_SCHEMA_VERSION | typeof WEB_WORKSPACE_SCHEMA_VERSION;
  readonly sha256: string;
  readonly snapshotPath: string;
  readonly workspaceId: string;
}

export interface WebSnapshotEnvelopeV1 {
  readonly generation: number;
  readonly savedAt: string;
  readonly schemaVersion: typeof WEB_WORKSPACE_LEGACY_SCHEMA_VERSION;
  readonly state: WebWorkspaceStateV1;
  readonly workspaceId: string;
}

export type AnyWebSnapshotEnvelope = WebSnapshotEnvelope | WebSnapshotEnvelopeV1;

export type WebRepositoryErrorCode =
  | 'DIRECTORY_NOT_WRITABLE'
  | 'INVALID_PATH'
  | 'INVALID_WORKSPACE'
  | 'RECOVERY_FAILED'
  | 'REVISION_CONFLICT'
  | 'SCHEMA_INVALID'
  | 'WRITE_LOCKED';

export class WebRepositoryError extends Error {
  public constructor(
    public readonly code: WebRepositoryErrorCode,
    public readonly stage: 'invariant' | 'permission' | 'repository' | 'schema',
    message: string,
  ) {
    super(message);
    this.name = 'WebRepositoryError';
  }
}

const ISO_WEEK = /^\d{4}-W(?:0[1-9]|[1-4]\d|5[0-3])$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return (
    actual.length === keys.length && [...keys].sort().every((key, index) => actual[index] === key)
  );
}

function text(value: unknown, pattern?: RegExp): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    (pattern && !pattern.test(value))
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '本地文件字段不符合合同。');
  }
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '本地文件数字字段不符合合同。');
  }
  return value as number;
}

export function assertWeekKey(value: unknown): string {
  return text(value, ISO_WEEK);
}

export function parseWebManifest(value: unknown): WebWorkspaceManifest {
  if (!record(value) || !exact(value, ['createdAt', 'format', 'schemaVersion', 'workspaceId'])) {
    throw new WebRepositoryError(
      'INVALID_WORKSPACE',
      'schema',
      '所选目录不是受支持的 Rednote 工作区。',
    );
  }
  if (
    value.format !== WEB_WORKSPACE_FORMAT ||
    (value.schemaVersion !== WEB_WORKSPACE_LEGACY_SCHEMA_VERSION &&
      value.schemaVersion !== WEB_WORKSPACE_SCHEMA_VERSION)
  ) {
    throw new WebRepositoryError('INVALID_WORKSPACE', 'schema', '工作区格式或版本不受支持。');
  }
  return Object.freeze({
    createdAt: text(value.createdAt),
    format: WEB_WORKSPACE_FORMAT,
    schemaVersion: value.schemaVersion,
    workspaceId: text(value.workspaceId, SAFE_ID),
  });
}

export function parseWebIndex(value: unknown): WebWorkspaceIndex {
  if (
    !record(value) ||
    !exact(value, ['bytes', 'generation', 'schemaVersion', 'sha256', 'snapshotPath', 'workspaceId'])
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '状态索引不符合合同。');
  }
  const snapshotPath = text(value.snapshotPath);
  if (!/^state\/snapshots\/\d{8}\.json$/u.test(snapshotPath)) {
    throw new WebRepositoryError('INVALID_PATH', 'schema', '状态索引包含非法相对路径。');
  }
  return Object.freeze({
    bytes: integer(value.bytes, 2),
    generation: integer(value.generation, 1),
    schemaVersion:
      value.schemaVersion === WEB_WORKSPACE_SCHEMA_VERSION ||
      value.schemaVersion === WEB_WORKSPACE_LEGACY_SCHEMA_VERSION
        ? value.schemaVersion
        : (() => {
            throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '状态索引版本不受支持。');
          })(),
    sha256: text(value.sha256, SHA256),
    snapshotPath,
    workspaceId: text(value.workspaceId, SAFE_ID),
  });
}

function parseContentVersionV1(value: unknown): WebContentVersionV1 {
  if (!record(value) || !exact(value, ['createdAt', 'fields', 'version', 'versionId'])) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容版本不符合合同。');
  }
  return Object.freeze({
    createdAt: text(value.createdAt),
    fields: parseContentPackageFields(value.fields),
    version: integer(value.version, 1),
    versionId: text(value.versionId),
  });
}

function parseContentVersion(value: unknown): WebContentVersion {
  if (
    !record(value) ||
    !exact(value, ['createdAt', 'fields', 'modelId', 'source', 'usage', 'version', 'versionId'])
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容版本不符合合同。');
  }
  if (value.source !== 'LOCAL' && value.source !== 'MODEL') {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容版本来源不受支持。');
  }
  let usage: WebContentVersion['usage'] = null;
  if (value.usage !== null) {
    if (!record(value.usage) || !exact(value.usage, ['inputTokens', 'outputTokens'])) {
      throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容版本用量不符合合同。');
    }
    const tokenValue = (candidate: unknown): number | null =>
      candidate === null ? null : integer(candidate);
    usage = Object.freeze({
      inputTokens: tokenValue(value.usage.inputTokens),
      outputTokens: tokenValue(value.usage.outputTokens),
    });
  }
  return Object.freeze({
    createdAt: text(value.createdAt),
    fields: parseContentPackageFields(value.fields),
    modelId: value.modelId === null ? null : text(value.modelId),
    source: value.source,
    usage,
    version: integer(value.version, 1),
    versionId: text(value.versionId),
  });
}

function parseContentPackageV1(value: unknown): WebContentPackageV1 {
  if (
    !record(value) ||
    !exact(value, ['candidateId', 'id', 'revision', 'status', 'versions', 'weekKey']) ||
    !Array.isArray(value.versions) ||
    value.versions.length === 0 ||
    value.versions.length > 100
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容包不符合合同。');
  }
  const versions = value.versions.map(parseContentVersionV1);
  const revision = integer(value.revision);
  if (
    versions.some((item, index) => item.version !== index + 1) ||
    versions.at(-1)?.version !== revision + 1
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容版本链不连续。');
  }
  if (value.status !== 'DRAFT' && value.status !== 'REVIEW_REQUIRED') {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容状态不受支持。');
  }
  return Object.freeze({
    candidateId: text(value.candidateId),
    id: text(value.id),
    revision,
    status: value.status,
    versions: Object.freeze(versions),
    weekKey: assertWeekKey(value.weekKey),
  });
}

function parseContentPackage(value: unknown): WebContentPackage {
  if (
    !record(value) ||
    !exact(value, ['candidateId', 'id', 'revision', 'status', 'versions', 'weekKey']) ||
    !Array.isArray(value.versions) ||
    value.versions.length === 0 ||
    value.versions.length > 100
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容包不符合合同。');
  }
  const versions = value.versions.map(parseContentVersion);
  const revision = integer(value.revision);
  if (
    versions.some((item, index) => item.version !== index + 1) ||
    versions.at(-1)?.version !== revision + 1
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容版本链不连续。');
  }
  if (!['APPROVED', 'DRAFT', 'REVIEW_REQUIRED'].includes(String(value.status))) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容状态不受支持。');
  }
  return Object.freeze({
    candidateId: text(value.candidateId),
    id: text(value.id),
    revision,
    status: value.status as WebContentPackage['status'],
    versions: Object.freeze(versions),
    weekKey: assertWeekKey(value.weekKey),
  });
}

function parseContentWorkspaceV1(value: unknown, expectedWeekKey: string): WebContentWorkspaceV1 {
  if (!record(value) || !exact(value, ['packages', 'weekKey']) || !Array.isArray(value.packages)) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容工作区不符合合同。');
  }
  const weekKey = assertWeekKey(value.weekKey);
  const packages = value.packages.map(parseContentPackageV1);
  if (
    weekKey !== expectedWeekKey ||
    packages.some((item) => item.weekKey !== weekKey) ||
    new Set(packages.map((item) => item.candidateId)).size !== packages.length
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '内容工作区的周身份不一致。');
  }
  return Object.freeze({ packages: Object.freeze(packages), weekKey });
}

function parseContentWorkspace(value: unknown, expectedWeekKey: string): WebContentWorkspace {
  if (!record(value) || !exact(value, ['packages', 'weekKey']) || !Array.isArray(value.packages)) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '内容工作区不符合合同。');
  }
  const weekKey = assertWeekKey(value.weekKey);
  const packages = value.packages.map(parseContentPackage);
  if (
    weekKey !== expectedWeekKey ||
    packages.some((item) => item.weekKey !== weekKey) ||
    new Set(packages.map((item) => item.candidateId)).size !== packages.length
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '内容工作区的周身份不一致。');
  }
  return Object.freeze({ packages: Object.freeze(packages), weekKey });
}

function parsePlans(value: unknown): Readonly<Record<string, WeeklyPlan>> {
  if (!record(value))
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '计划集合不符合合同。');
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([key, plan]) => {
        const weekKey = assertWeekKey(key);
        const parsed = parseWeeklyPlan(plan);
        if (parsed.weekKey !== weekKey)
          throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '计划周身份不一致。');
        return [weekKey, parsed];
      }),
    ),
  );
}

export function parseWebWorkspaceStateV1(value: unknown): WebWorkspaceStateV1 {
  if (
    !record(value) ||
    !exact(value, [
      'activeWeekKey',
      'contentByWeek',
      'persona',
      'plans',
      'schemaVersion',
      'workspaceId',
    ]) ||
    !record(value.contentByWeek) ||
    value.schemaVersion !== WEB_WORKSPACE_LEGACY_SCHEMA_VERSION
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', 'W1 工作区快照不符合合同。');
  }
  const plans = parsePlans(value.plans);
  const contentByWeek = Object.fromEntries(
    Object.entries(value.contentByWeek).map(([key, content]) => {
      const weekKey = assertWeekKey(key);
      const parsed = parseContentWorkspaceV1(content, weekKey);
      const candidateIds = new Set(plans[weekKey]?.candidates.map((item) => item.id) ?? []);
      if (parsed.packages.some((item) => !candidateIds.has(item.candidateId))) {
        throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '内容包未关联同周计划项。');
      }
      return [weekKey, parsed];
    }),
  );
  return Object.freeze({
    activeWeekKey: assertWeekKey(value.activeWeekKey),
    contentByWeek: Object.freeze(contentByWeek),
    persona: parseAccountPersona(value.persona),
    plans,
    schemaVersion: WEB_WORKSPACE_LEGACY_SCHEMA_VERSION,
    workspaceId: text(value.workspaceId, SAFE_ID),
  });
}

export function parseWebWorkspaceState(value: unknown): WebWorkspaceState {
  if (
    !record(value) ||
    !exact(value, [
      'activeWeekKey',
      'clipReceipts',
      'contentByWeek',
      'interactions',
      'library',
      'metricSnapshots',
      'persona',
      'plans',
      'provider',
      'schemaVersion',
      'strategyDecisions',
      'workspaceId',
    ]) ||
    !record(value.contentByWeek) ||
    value.schemaVersion !== WEB_WORKSPACE_SCHEMA_VERSION
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '工作区快照不符合合同。');
  }
  const plans = parsePlans(value.plans);
  const contentByWeek = Object.fromEntries(
    Object.entries(value.contentByWeek).map(([key, content]) => {
      const weekKey = assertWeekKey(key);
      const parsed = parseContentWorkspace(content, weekKey);
      const candidateIds = new Set(plans[weekKey]?.candidates.map((item) => item.id) ?? []);
      if (parsed.packages.some((item) => !candidateIds.has(item.candidateId))) {
        throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '内容包未关联同周计划项。');
      }
      return [weekKey, parsed];
    }),
  );
  const activeWeekKey = assertWeekKey(value.activeWeekKey);
  const packageStatuses = new Map(
    Object.values(contentByWeek).flatMap((workspace) =>
      workspace.packages.map((item) => [item.id, item.status] as const),
    ),
  );
  let slices;
  try {
    slices = parseW2Slices(
      {
        clipReceipts: value.clipReceipts,
        interactions: value.interactions,
        library: value.library,
        metricSnapshots: value.metricSnapshots,
        provider: value.provider,
        strategyDecisions: value.strategyDecisions,
      },
      packageStatuses,
    );
  } catch {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', 'W2 业务状态不符合合同。');
  }
  return Object.freeze({
    activeWeekKey,
    ...slices,
    contentByWeek: Object.freeze(contentByWeek),
    persona: parseAccountPersona(value.persona),
    plans: Object.freeze(plans),
    schemaVersion: WEB_WORKSPACE_SCHEMA_VERSION,
    workspaceId: text(value.workspaceId, SAFE_ID),
  });
}

export function parseWebSnapshot(value: unknown): WebSnapshotEnvelope {
  if (
    !record(value) ||
    !exact(value, ['generation', 'savedAt', 'schemaVersion', 'state', 'workspaceId']) ||
    value.schemaVersion !== WEB_WORKSPACE_SCHEMA_VERSION
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '状态快照不符合合同。');
  }
  const state = parseWebWorkspaceState(value.state);
  const workspaceId = text(value.workspaceId, SAFE_ID);
  if (state.workspaceId !== workspaceId)
    throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '快照工作区身份不一致。');
  return Object.freeze({
    generation: integer(value.generation, 1),
    savedAt: text(value.savedAt),
    schemaVersion: WEB_WORKSPACE_SCHEMA_VERSION,
    state,
    workspaceId,
  });
}

export function parseAnyWebSnapshot(value: unknown): AnyWebSnapshotEnvelope {
  if (
    !record(value) ||
    !exact(value, ['generation', 'savedAt', 'schemaVersion', 'state', 'workspaceId'])
  ) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '状态快照不符合合同。');
  }
  if (value.schemaVersion === WEB_WORKSPACE_SCHEMA_VERSION) return parseWebSnapshot(value);
  if (value.schemaVersion !== WEB_WORKSPACE_LEGACY_SCHEMA_VERSION) {
    throw new WebRepositoryError('SCHEMA_INVALID', 'schema', '状态快照版本不受支持。');
  }
  const state = parseWebWorkspaceStateV1(value.state);
  const workspaceId = text(value.workspaceId, SAFE_ID);
  if (state.workspaceId !== workspaceId)
    throw new WebRepositoryError('SCHEMA_INVALID', 'invariant', '快照工作区身份不一致。');
  return Object.freeze({
    generation: integer(value.generation, 1),
    savedAt: text(value.savedAt),
    schemaVersion: WEB_WORKSPACE_LEGACY_SCHEMA_VERSION,
    state,
    workspaceId,
  });
}

export function migrateWebWorkspaceState(value: WebWorkspaceStateV1): WebWorkspaceState {
  const slices = emptyW2Slices();
  return parseWebWorkspaceState({
    activeWeekKey: value.activeWeekKey,
    ...slices,
    contentByWeek: Object.fromEntries(
      Object.entries(value.contentByWeek).map(([weekKey, workspace]) => [
        weekKey,
        {
          packages: workspace.packages.map((item) => ({
            ...item,
            versions: item.versions.map((version) => ({
              ...version,
              modelId: null,
              source: 'LOCAL',
              usage: null,
            })),
          })),
          weekKey,
        },
      ]),
    ),
    persona: value.persona,
    plans: value.plans,
    schemaVersion: WEB_WORKSPACE_SCHEMA_VERSION,
    workspaceId: value.workspaceId,
  });
}

export function newWorkspaceState(
  workspaceId: string,
  activeWeekKey: string,
  persona: AccountPersona,
): WebWorkspaceState {
  return parseWebWorkspaceState({
    activeWeekKey,
    ...emptyW2Slices(),
    contentByWeek: {},
    persona,
    plans: {},
    schemaVersion: WEB_WORKSPACE_SCHEMA_VERSION,
    workspaceId,
  });
}

export type { AccountPersona, AccountPersonaFields, ContentPackageFields, WeeklyPlan };
