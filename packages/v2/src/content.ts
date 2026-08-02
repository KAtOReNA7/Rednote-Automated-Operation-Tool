export const V2_CONTENT_SCHEMA_VERSION = 1 as const;
export const V2_CONTENT_COVER_KEYS = ['moonstone', 'morgue', 'yellow-room'] as const;
export const V2_CONTENT_FIELD_KEYS = [
  'cover',
  'title',
  'body',
  'tags',
  'suggestedTime',
  'materialNotes',
] as const;
export const V2_CONTENT_STATUSES = ['APPROVED', 'DRAFT', 'REVIEW_REQUIRED'] as const;

export type ContentCoverKey = (typeof V2_CONTENT_COVER_KEYS)[number];
export type ContentPackageStatus = (typeof V2_CONTENT_STATUSES)[number];
export type ContentFieldKey = (typeof V2_CONTENT_FIELD_KEYS)[number];

export interface ContentPackageFields {
  readonly body: string;
  readonly coverKey: ContentCoverKey;
  readonly materialNotes: string;
  readonly suggestedTime: string;
  readonly tags: readonly string[];
  readonly title: string;
}

export interface ContentPackage {
  readonly candidateId: string;
  readonly fields: ContentPackageFields;
  readonly id: string;
  readonly revision: number;
  readonly schemaVersion: typeof V2_CONTENT_SCHEMA_VERSION;
  readonly status: ContentPackageStatus;
  readonly version: number;
  readonly versionId: string;
  readonly weekKey: string;
}

export interface ContentWorkspace {
  readonly packages: readonly ContentPackage[];
  readonly schemaVersion: typeof V2_CONTENT_SCHEMA_VERSION;
  readonly weekKey: string;
}

export interface ContentApprovalRef {
  readonly expectedRevision: number;
  readonly expectedVersionId: string;
  readonly packageId: string;
}

export interface ContentExportResult {
  readonly exportId: string;
  readonly packageCount: number;
}

export interface ContentBlobRef {
  readonly managedPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export type ContentBlobSet = Readonly<Record<ContentFieldKey, ContentBlobRef>>;

export interface ContentVersionRecord {
  readonly candidateId: string;
  readonly coverKey: ContentCoverKey;
  readonly files: ContentBlobSet;
  readonly packageId: string;
  readonly planRevision: number;
  readonly revision: number;
  readonly status: ContentPackageStatus;
  readonly version: number;
  readonly versionId: string;
  readonly weekKey: string;
}

export interface NewContentVersionRecord extends ContentVersionRecord {
  readonly revision: 0;
  readonly status: 'DRAFT';
  readonly version: 1;
}

export type ContentMutationRequest =
  | {
      readonly action: 'GENERATE_CONTENT_PACKAGES';
      readonly candidateIds: readonly string[];
      readonly expectedPlanRevision: number;
      readonly idempotencyKey: string;
      readonly weekKey: string;
    }
  | {
      readonly action: 'SAVE_CONTENT_PACKAGE';
      readonly expectedRevision: number;
      readonly expectedVersionId: string;
      readonly fields: ContentPackageFields;
      readonly packageId: string;
    }
  | {
      readonly action: 'APPROVE_CONTENT_PACKAGES';
      readonly items: readonly ContentApprovalRef[];
    }
  | {
      readonly action: 'EXPORT_CONTENT_PACKAGES';
      readonly idempotencyKey: string;
      readonly items: readonly ContentApprovalRef[];
    }
  | { readonly action: 'OPEN_CONTENT_EXPORT'; readonly exportId: string };

export type V2ContentErrorCode =
  | 'CONTENT_CORRUPT'
  | 'CONTENT_NOT_APPROVED'
  | 'CONTENT_NOT_READY'
  | 'EXPORT_FAILED'
  | 'INVALID_REQUEST'
  | 'REVISION_CONFLICT';

export class V2ContentError extends Error {
  public readonly affectedFields: readonly string[];
  public readonly code: V2ContentErrorCode;

  public constructor(code: V2ContentErrorCode, affectedFields: readonly string[] = []) {
    super(code);
    this.name = 'V2ContentError';
    this.code = code;
    this.affectedFields = affectedFields;
  }
}

export interface V2ContentRepositoryPort {
  readonly appendVersion: (
    current: ContentVersionRecord,
    files: ContentBlobSet,
    status: 'DRAFT' | 'REVIEW_REQUIRED',
  ) => ContentVersionRecord;
  readonly approve: (items: readonly ContentApprovalRef[]) => readonly ContentVersionRecord[];
  readonly create: (records: readonly NewContentVersionRecord[]) => readonly ContentVersionRecord[];
  readonly get: (packageId: string) => ContentVersionRecord;
  readonly list: (weekKey: string) => readonly ContentVersionRecord[];
}

export interface V2ContentFilePort {
  readonly exportPackages: (
    records: readonly ContentVersionRecord[],
    idempotencyKey: string,
  ) => Promise<ContentExportResult>;
  readonly openExport: (exportId: string) => Promise<void>;
  readonly readFields: (record: ContentVersionRecord) => Promise<ContentPackageFields>;
  readonly writeFields: (fields: ContentPackageFields) => Promise<ContentBlobSet>;
}

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d$/u;

function record(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function keys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join() === [...expected].sort().join();
}

function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}

function text(value: unknown, maximum: number, field: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    utf8Bytes(value) > maximum ||
    [...value].some((character) => {
      const point = character.codePointAt(0) ?? 0;
      return (
        (point <= 0x1f && point !== 0x09 && point !== 0x0a && point !== 0x0d) || point === 0x7f
      );
    })
  ) {
    throw new V2ContentError('INVALID_REQUEST', [field]);
  }
  return value;
}

export function parseContentPackageFields(value: unknown): ContentPackageFields {
  if (
    !record(value) ||
    !keys(value, ['body', 'coverKey', 'materialNotes', 'suggestedTime', 'tags', 'title']) ||
    !V2_CONTENT_COVER_KEYS.includes(value.coverKey as ContentCoverKey) ||
    !Array.isArray(value.tags) ||
    value.tags.length === 0 ||
    value.tags.length > 10
  ) {
    throw new V2ContentError('INVALID_REQUEST', ['fields']);
  }
  const suggestedTime = text(value.suggestedTime, 32, 'suggestedTime');
  const date = DATE_TIME.exec(suggestedTime)?.[1];
  if (date === undefined || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    throw new V2ContentError('INVALID_REQUEST', ['suggestedTime']);
  }
  const tags = value.tags.map((tag) => text(tag, 80, 'tags'));
  if (new Set(tags).size !== tags.length) throw new V2ContentError('INVALID_REQUEST', ['tags']);
  return Object.freeze({
    body: text(value.body, 16_000, 'body'),
    coverKey: value.coverKey as ContentCoverKey,
    materialNotes: text(value.materialNotes, 2_000, 'materialNotes'),
    suggestedTime,
    tags: Object.freeze(tags),
    title: text(value.title, 300, 'title'),
  });
}

export class ScriptedContentProvider {
  public generate(
    candidateIds: readonly string[],
    persona: AccountPersona,
    plan: WeeklyPlan,
  ): readonly ContentPackageFields[] {
    if (plan.status !== 'CONFIRMED' || candidateIds.length !== 3) {
      throw new V2ContentError('CONTENT_NOT_READY', ['weeklyPlan']);
    }
    const selected = candidateIds.map((id) => {
      const candidate = plan.candidates.find((item) => item.id === id);
      if (candidate === undefined) throw new V2ContentError('INVALID_REQUEST', ['candidateIds']);
      return candidate;
    });
    const covers: readonly ContentCoverKey[] = ['morgue', 'yellow-room', 'moonstone'];
    return Object.freeze(
      selected.map((candidate, index) =>
        parseContentPackageFields({
          body: `${persona.name} 面向${persona.audience}整理：${candidate.title}。这是一份完全本地、可继续编辑的 Scripted 内容草稿；表达遵循“${persona.tone}”，并遵守“${persona.boundary}”。`,
          coverKey: covers[index] ?? 'morgue',
          materialNotes: `复用已批准演示封面；关联计划项 ${candidate.id}，不含外部下载或模型素材。`,
          suggestedTime: `${candidateDate(plan, candidate.day, candidate.date)}T${candidate.time}`,
          tags: Object.freeze(['推理小说', candidate.book.replace(/[《》]/gu, ''), '本地草稿']),
          title: candidate.title,
        }),
      ),
    );
  }
}

function sameFields(left: ContentPackageFields, right: ContentPackageFields): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function candidateDate(plan: WeeklyPlan, day: string, storedDate: string): string {
  if (storedDate.includes('-')) return storedDate;
  const year = Number(plan.weekKey.slice(0, 4));
  const week = Number(plan.weekKey.slice(6));
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const mondayOffset = (januaryFourth.getUTCDay() + 6) % 7;
  const dayOffset = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].indexOf(day);
  januaryFourth.setUTCDate(januaryFourth.getUTCDate() - mondayOffset + (week - 1) * 7 + dayOffset);
  return januaryFourth.toISOString().slice(0, 10);
}

export class V2ContentApplication {
  readonly #files: V2ContentFilePort;
  readonly #provider: ScriptedContentProvider;
  readonly #repository: V2ContentRepositoryPort;

  public constructor(
    repository: V2ContentRepositoryPort,
    files: V2ContentFilePort,
    provider = new ScriptedContentProvider(),
  ) {
    this.#repository = repository;
    this.#files = files;
    this.#provider = provider;
  }

  public async read(weekKey: string): Promise<ContentWorkspace> {
    return this.#workspace(weekKey, this.#repository.list(weekKey));
  }

  public async generate(
    request: Extract<ContentMutationRequest, { readonly action: 'GENERATE_CONTENT_PACKAGES' }>,
    persona: AccountPersona,
    plan: WeeklyPlan,
  ): Promise<ContentWorkspace> {
    if (
      plan.status !== 'CONFIRMED' ||
      plan.revision !== request.expectedPlanRevision ||
      plan.weekKey !== request.weekKey
    ) {
      throw new V2ContentError(
        plan.status === 'CONFIRMED' ? 'REVISION_CONFLICT' : 'CONTENT_NOT_READY',
        ['weeklyPlan'],
      );
    }
    const existing = this.#repository.list(request.weekKey);
    const selectedExisting = existing.filter(({ candidateId }) =>
      request.candidateIds.includes(candidateId),
    );
    if (selectedExisting.length === 3) return this.#workspace(request.weekKey, existing);
    if (selectedExisting.length !== 0) throw new V2ContentError('REVISION_CONFLICT', ['packages']);
    const generated = this.#provider.generate(request.candidateIds, persona, plan);
    const records: NewContentVersionRecord[] = [];
    for (const [index, fields] of generated.entries()) {
      const candidateId = request.candidateIds[index];
      if (candidateId === undefined) throw new V2ContentError('INVALID_REQUEST');
      const packageId = `pkg-${request.weekKey.toLowerCase()}-${candidateId}`;
      records.push({
        candidateId,
        coverKey: fields.coverKey,
        files: await this.#files.writeFields(fields),
        packageId,
        planRevision: request.expectedPlanRevision,
        revision: 0,
        status: 'DRAFT',
        version: 1,
        versionId: `${packageId}-v1`,
        weekKey: request.weekKey,
      });
    }
    return this.#workspace(request.weekKey, this.#repository.create(records));
  }

  public async save(
    request: Extract<ContentMutationRequest, { readonly action: 'SAVE_CONTENT_PACKAGE' }>,
  ): Promise<ContentPackage> {
    const current = this.#repository.get(request.packageId);
    this.#assertCurrent(current, request);
    const previousFields = await this.#readFields(current);
    if (sameFields(previousFields, request.fields)) return this.#package(current, previousFields);
    if (request.fields.coverKey !== current.coverKey)
      throw new V2ContentError('INVALID_REQUEST', ['coverKey']);
    const next = this.#repository.appendVersion(
      current,
      await this.#files.writeFields(request.fields),
      current.status === 'APPROVED' ? 'REVIEW_REQUIRED' : 'DRAFT',
    );
    return this.#package(next, request.fields);
  }

  public async approve(items: readonly ContentApprovalRef[]): Promise<ContentWorkspace> {
    const approved = this.#repository.approve(items);
    const weekKey = approved[0]?.weekKey;
    if (weekKey === undefined || approved.some((item) => item.weekKey !== weekKey))
      throw new V2ContentError('INVALID_REQUEST', ['items']);
    return this.#workspace(weekKey, this.#repository.list(weekKey));
  }

  public async export(
    items: readonly ContentApprovalRef[],
    idempotencyKey: string,
  ): Promise<ContentExportResult> {
    const records = items.map((item) => {
      const current = this.#repository.get(item.packageId);
      this.#assertCurrent(current, item);
      if (current.status !== 'APPROVED')
        throw new V2ContentError('CONTENT_NOT_APPROVED', ['items']);
      return current;
    });
    return this.#files.exportPackages(records, idempotencyKey);
  }

  public async openExport(exportId: string): Promise<void> {
    await this.#files.openExport(exportId);
  }

  #assertCurrent(
    current: ContentVersionRecord,
    expected: { readonly expectedRevision: number; readonly expectedVersionId: string },
  ): void {
    if (
      current.revision !== expected.expectedRevision ||
      current.versionId !== expected.expectedVersionId
    ) {
      throw new V2ContentError('REVISION_CONFLICT', ['contentPackage']);
    }
  }

  async #readFields(record: ContentVersionRecord): Promise<ContentPackageFields> {
    try {
      return parseContentPackageFields(await this.#files.readFields(record));
    } catch (error) {
      if (error instanceof V2ContentError) throw error;
      throw new V2ContentError('CONTENT_CORRUPT', ['files']);
    }
  }

  async #workspace(
    weekKey: string,
    records: readonly ContentVersionRecord[],
  ): Promise<ContentWorkspace> {
    const packages: ContentPackage[] = [];
    for (const record of records)
      packages.push(this.#package(record, await this.#readFields(record)));
    return Object.freeze({
      packages: Object.freeze(packages),
      schemaVersion: V2_CONTENT_SCHEMA_VERSION,
      weekKey,
    });
  }

  #package(record: ContentVersionRecord, fields: ContentPackageFields): ContentPackage {
    return Object.freeze({
      candidateId: record.candidateId,
      fields,
      id: record.packageId,
      revision: record.revision,
      schemaVersion: V2_CONTENT_SCHEMA_VERSION,
      status: record.status,
      version: record.version,
      versionId: record.versionId,
      weekKey: record.weekKey,
    });
  }
}
import type { AccountPersona, WeeklyPlan } from './index.js';
