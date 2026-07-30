import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  COPY_FORMAT_POLICY_VERSION,
  COPY_GENERATION_POLICY_VERSION,
  COPY_OUTPUT_SCHEMA_VERSION,
  COPY_PROFILE_REGISTRY_VERSION,
  COPY_PROMPT_TEMPLATE_VERSION,
  COPY_REWRITE_POLICY_VERSION,
  COPY_STRUCTURAL_VALIDATION_VERSION,
  COPY_VOICE_POLICY_VERSION,
  CopyError,
  applyCopyModelCandidate,
  applyScopedRewrite,
  assertContentDraftPayload,
  copySemanticHash,
  createCopyMutationPlan,
  structuralStatus,
  validateDraftStructure,
  type ContentDraftPayloadV1,
  type CopyDraftStatus,
  type CopyFieldLockState,
  type CopyMutationJobPayloadV1,
  type CopyMutationPlanV1,
  type CopyMutationRunV1,
  type CopyRewriteScopeV1,
  type DraftStructuralValidationV1,
} from '@mystery-operations/copy';

import { runInTransaction } from './transaction.js';

type Row = Record<string, unknown>;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const ZERO_HASH = '0'.repeat(64);

interface HeadRow extends Row {
  readonly brief_id: string;
  readonly brief_version_id: string;
  readonly created_at: string;
  readonly current_version_id: string;
  readonly draft_id: string;
  readonly draft_revision: number;
  readonly draft_state: 'ACTIVE' | 'ARCHIVED';
  readonly profile_id: ContentDraftPayloadV1['profileId'];
  readonly status: CopyDraftStatus;
  readonly structural_reason_codes_json: string;
  readonly structural_valid: 0 | 1;
  readonly updated_at: string;
  readonly version_number: number;
}

interface VersionRow extends Row {
  readonly brief_version_id: string;
  readonly change_kinds_json: string;
  readonly content_hash: string;
  readonly created_at: string;
  readonly dependency_hash: string;
  readonly draft_id: string;
  readonly format_policy_version: string;
  readonly generation_policy_version: string;
  readonly id: string;
  readonly input_hash: string;
  readonly lock_snapshot_hash: string;
  readonly output_hash: string | null;
  readonly payload_json: string;
  readonly previous_version_id: string | null;
  readonly profile_id: ContentDraftPayloadV1['profileId'];
  readonly profile_version: string;
  readonly prompt_template_version: string | null;
  readonly rewrite_policy_version: string;
  readonly schema_version: string;
  readonly source_kind: 'LEGACY' | 'MANUAL' | 'MODEL' | 'REWRITE';
  readonly status: CopyDraftStatus;
  readonly structural_policy_version: string;
  readonly structural_reason_codes_json: string;
  readonly structural_valid: 0 | 1;
  readonly style_version: string;
  readonly version_number: number;
}

interface RunRow extends Row {
  readonly cache_state: CopyMutationRunV1['cacheState'];
  readonly cost_state: CopyMutationRunV1['costState'];
  readonly created_at: string;
  readonly draft_id: string;
  readonly execution_id: string;
  readonly external_request_count: 0 | 1;
  readonly finished_at: string | null;
  readonly id: string;
  readonly model_execution_id: string | null;
  readonly model_identity_json: string | null;
  readonly operation: 'FULL_GENERATION' | 'REWRITE';
  readonly output_hash: string | null;
  readonly plan_id: string;
  readonly policy_version: string;
  readonly prompt_template_version: string;
  readonly result_version_id: string | null;
  readonly schema_version: string;
  readonly status: CopyMutationRunV1['status'];
  readonly style_version: string;
  readonly usage_state: CopyMutationRunV1['usageState'];
}

interface PlanRow extends Row {
  readonly budget_state: CopyMutationPlanV1['budgetState'];
  readonly capability_state: CopyMutationPlanV1['capabilityState'];
  readonly created_at: string;
  readonly dependency_hash: string;
  readonly draft_id: string;
  readonly expected_draft_revision: number;
  readonly expires_at: string;
  readonly id: string;
  readonly input_hash: string;
  readonly lock_snapshot_hash: string;
  readonly operation: CopyMutationPlanV1['operation'];
  readonly preview_hash: string;
  readonly rewrite_instruction_json: string | null;
  readonly rewrite_scope_json: string | null;
  readonly version_id: string;
}

export interface CopyListItem {
  readonly briefId: string;
  readonly draftId: string;
  readonly profileId: ContentDraftPayloadV1['profileId'];
  readonly revision: number;
  readonly state: 'ACTIVE' | 'ARCHIVED';
  readonly status: CopyDraftStatus;
  readonly updatedAt: string;
  readonly versionNumber: number;
}

export interface CopyListView {
  readonly counts: Readonly<Record<CopyDraftStatus, number>>;
  readonly items: readonly CopyListItem[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface CopyDetailView extends CopyListItem {
  readonly invalidationReasons: readonly string[];
  readonly payload: ContentDraftPayloadV1;
  readonly runs: readonly CopyMutationRunV1[];
  readonly validation: DraftStructuralValidationV1;
  readonly versionHistory: {
    readonly items: readonly {
      readonly changeKinds: readonly string[];
      readonly createdAt: string;
      readonly isCurrent: boolean;
      readonly sourceKind: VersionRow['source_kind'];
      readonly status: CopyDraftStatus;
      readonly versionId: string;
      readonly versionNumber: number;
    }[];
    readonly limit: number;
    readonly offset: number;
    readonly total: number;
  };
}

export interface CopyVersionDiff {
  readonly changedFields: readonly string[];
  readonly fromVersionId: string;
  readonly toVersionId: string;
}

export interface CopyMutationExecution {
  readonly payload: ContentDraftPayloadV1;
  readonly plan: CopyMutationPlanV1;
  readonly run: CopyMutationRunV1;
}

function identifier(value: string, maximum = 512): string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length < 1 ||
    Buffer.byteLength(value, 'utf8') > maximum
  ) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return value;
}

function iso(value: string): string {
  if (!UTC.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return value;
}

function page(value: number, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CopyError('COPY_INVALID_CONTRACT');
  }
  return value;
}

function strings(value: unknown): readonly string[] {
  if (typeof value !== 'string') throw new CopyError('COPY_CONFLICT');
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) {
    throw new CopyError('COPY_CONFLICT');
  }
  return Object.freeze(parsed);
}

function payload(value: unknown): ContentDraftPayloadV1 {
  if (typeof value !== 'string') throw new CopyError('COPY_CONFLICT');
  return assertContentDraftPayload(JSON.parse(value) as unknown);
}

function validation(
  row: Pick<
    VersionRow,
    'created_at' | 'structural_policy_version' | 'structural_reason_codes_json' | 'structural_valid'
  >,
): DraftStructuralValidationV1 {
  if (row.structural_policy_version !== COPY_STRUCTURAL_VALIDATION_VERSION) {
    throw new CopyError('COPY_CONFLICT');
  }
  return Object.freeze({
    evaluatedAt: row.created_at,
    policyVersion: COPY_STRUCTURAL_VALIDATION_VERSION,
    reasonCodes: strings(row.structural_reason_codes_json),
    valid: row.structural_valid === 1,
  });
}

function runView(row: RunRow): CopyMutationRunV1 {
  return Object.freeze({
    cacheState: row.cache_state,
    costState: row.cost_state,
    createdAt: row.created_at,
    draftId: row.draft_id,
    executionId: row.execution_id,
    externalRequestCount: row.external_request_count,
    finishedAt: row.finished_at,
    modelExecutionId: row.model_execution_id,
    modelIdentity:
      row.model_identity_json === null
        ? null
        : (JSON.parse(row.model_identity_json) as CopyMutationRunV1['modelIdentity']),
    outputHash: row.output_hash,
    planId: row.plan_id,
    policyVersion: row.policy_version as CopyMutationRunV1['policyVersion'],
    promptTemplateVersion: row.prompt_template_version,
    resultVersionId: row.result_version_id,
    runId: row.id,
    schemaVersion: row.schema_version as typeof COPY_OUTPUT_SCHEMA_VERSION,
    status: row.status,
    styleVersion: row.style_version as typeof COPY_VOICE_POLICY_VERSION,
    usageState: row.usage_state,
  });
}

function changedFields(
  left: ContentDraftPayloadV1,
  right: ContentDraftPayloadV1,
): readonly string[] {
  return Object.freeze(
    [
      'titles',
      'selectedTitleId',
      'blocks',
      'tags',
      'pinnedComment',
      'spoilerWarnings',
      'fieldStates',
    ].filter(
      (field) =>
        copySemanticHash(left[field as keyof ContentDraftPayloadV1]) !==
        copySemanticHash(right[field as keyof ContentDraftPayloadV1]),
    ),
  );
}

export class SqliteCopyRepository {
  readonly #database: DatabaseSync;
  readonly #idFactory: () => string;

  public constructor(database: DatabaseSync, idFactory: () => string = randomUUID) {
    this.#database = database;
    this.#idFactory = idFactory;
  }

  public list(input: {
    readonly briefId?: string | null;
    readonly limit: number;
    readonly offset: number;
    readonly profileId?: ContentDraftPayloadV1['profileId'] | null;
    readonly query?: string;
    readonly state?: 'ACTIVE' | 'ARCHIVED' | null;
    readonly status?: CopyDraftStatus | null;
  }): CopyListView {
    const limit = page(input.limit, 1, 100);
    const offset = page(input.offset, 0, 1_000_000);
    const query = (input.query ?? '').trim().slice(0, 200);
    const filters: string[] = [];
    const values: (string | number)[] = [];
    if (input.briefId) {
      filters.push('root.brief_id = ?');
      values.push(identifier(input.briefId));
    }
    if (input.profileId) {
      filters.push('version.profile_id = ?');
      values.push(input.profileId);
    }
    if (input.state) {
      filters.push('head.draft_state = ?');
      values.push(input.state);
    }
    if (input.status) {
      filters.push('version.status = ?');
      values.push(input.status);
    }
    if (query.length > 0) {
      filters.push("(root.id LIKE ? ESCAPE '\\' OR root.title LIKE ? ESCAPE '\\')");
      const escaped = `%${query.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
      values.push(escaped, escaped);
    }
    const where = filters.length === 0 ? '' : `WHERE ${filters.join(' AND ')}`;
    const from = `
      FROM drafts AS root
      JOIN content_draft_heads AS head ON head.draft_id = root.id
      JOIN content_draft_versions AS version ON version.id = head.current_version_id
    `;
    const total = Number(
      (
        this.#database.prepare(`SELECT count(*) AS total ${from} ${where}`).get(...values) as {
          readonly total: number;
        }
      ).total,
    );
    const rows = this.#database
      .prepare(
        `SELECT root.id AS draft_id, root.brief_id, version.profile_id, version.status,
                version.version_number, head.draft_revision, head.draft_state, head.updated_at
           ${from} ${where}
          ORDER BY head.updated_at DESC, root.id ASC
          LIMIT ? OFFSET ?`,
      )
      .all(...values, limit, offset) as unknown as readonly (Row & {
      readonly brief_id: string;
      readonly draft_id: string;
      readonly draft_revision: number;
      readonly draft_state: 'ACTIVE' | 'ARCHIVED';
      readonly profile_id: ContentDraftPayloadV1['profileId'];
      readonly status: CopyDraftStatus;
      readonly updated_at: string;
      readonly version_number: number;
    })[];
    const statuses: readonly CopyDraftStatus[] = [
      'MANUAL_DRAFT',
      'MODEL_CANDIDATE',
      'STRUCTURE_INVALID',
      'READY_FOR_QUALITY_PIPELINE',
      'STALE',
      'SUPERSEDED',
      'ARCHIVED',
    ];
    const countRows = this.#database
      .prepare(
        `SELECT version.status, count(*) AS total ${from}
          GROUP BY version.status`,
      )
      .all() as unknown as readonly {
      readonly status: CopyDraftStatus;
      readonly total: number;
    }[];
    const countMap = new Map(countRows.map((row) => [row.status, Number(row.total)]));
    return Object.freeze({
      counts: Object.freeze(
        Object.fromEntries(statuses.map((status) => [status, countMap.get(status) ?? 0])) as Record<
          CopyDraftStatus,
          number
        >,
      ),
      items: Object.freeze(
        rows.map((row) =>
          Object.freeze({
            briefId: row.brief_id,
            draftId: row.draft_id,
            profileId: row.profile_id,
            revision: row.draft_revision,
            state: row.draft_state,
            status: row.status,
            updatedAt: row.updated_at,
            versionNumber: row.version_number,
          }),
        ),
      ),
      limit,
      offset,
      total,
    });
  }

  public get(
    draftIdValue: string,
    options: {
      readonly runLimit?: number;
      readonly runOffset?: number;
      readonly versionLimit?: number;
      readonly versionOffset?: number;
    } = {},
  ): CopyDetailView {
    const draftId = identifier(draftIdValue);
    const head = this.#head(draftId);
    const current = this.#version(head.current_version_id);
    if (current.source_kind === 'LEGACY') {
      throw new CopyError(
        'COPY_CONFLICT',
        'Legacy Draft is preserved as STRUCTURE_INVALID and must be replaced by a manual scaffold.',
      );
    }
    const currentPayload = payload(current.payload_json);
    const versionLimit = page(options.versionLimit ?? 20, 1, 100);
    const versionOffset = page(options.versionOffset ?? 0, 0, 1_000_000);
    const runLimit = page(options.runLimit ?? 20, 1, 100);
    const runOffset = page(options.runOffset ?? 0, 0, 1_000_000);
    const versions = this.#database
      .prepare(
        `SELECT * FROM content_draft_versions
          WHERE draft_id = ?
          ORDER BY version_number DESC
          LIMIT ? OFFSET ?`,
      )
      .all(draftId, versionLimit, versionOffset) as unknown as readonly VersionRow[];
    const versionTotal = Number(
      (
        this.#database
          .prepare('SELECT count(*) AS total FROM content_draft_versions WHERE draft_id = ?')
          .get(draftId) as { readonly total: number }
      ).total,
    );
    const runs = this.#database
      .prepare(
        `SELECT * FROM content_draft_mutation_runs
          WHERE draft_id = ?
          ORDER BY created_at DESC
          LIMIT ? OFFSET ?`,
      )
      .all(draftId, runLimit, runOffset) as unknown as readonly RunRow[];
    const invalidations = this.#database
      .prepare(
        `SELECT reason_code FROM content_draft_invalidations
          WHERE draft_id = ? AND version_id = ?
          ORDER BY created_at DESC LIMIT 100`,
      )
      .all(draftId, current.id) as unknown as readonly { readonly reason_code: string }[];
    return Object.freeze({
      briefId: head.brief_id,
      draftId,
      invalidationReasons: Object.freeze(invalidations.map(({ reason_code }) => reason_code)),
      payload: currentPayload,
      profileId: current.profile_id,
      revision: head.draft_revision,
      runs: Object.freeze(runs.map((row) => runView(row))),
      state: head.draft_state,
      status: invalidations.length > 0 ? 'STALE' : current.status,
      updatedAt: head.updated_at,
      validation: validation(current),
      versionHistory: Object.freeze({
        items: Object.freeze(
          versions.map((row) =>
            Object.freeze({
              changeKinds: strings(row.change_kinds_json),
              createdAt: row.created_at,
              isCurrent: row.id === head.current_version_id,
              sourceKind: row.source_kind,
              status: row.status,
              versionId: row.id,
              versionNumber: row.version_number,
            }),
          ),
        ),
        limit: versionLimit,
        offset: versionOffset,
        total: versionTotal,
      }),
      versionNumber: current.version_number,
    });
  }

  public createManualScaffold(payloadValue: unknown, nowValue: string): CopyDetailView {
    const content = assertContentDraftPayload(payloadValue);
    const now = iso(nowValue);
    const draftId = this.#idFactory();
    const versionId = this.#idFactory();
    const validationResult = validateDraftStructure(content, now);
    return runInTransaction(this.#database, () => {
      this.#database
        .prepare(
          `INSERT INTO drafts (
             id, brief_id, version, title, body, tags_json, pinned_comment,
             generation_run_id, user_edited, status, created_at
           ) VALUES (?, ?, 1, ?, ?, '[]', NULL, NULL, 1, 'DRAFTING', ?)`,
        )
        .run(draftId, content.brief.briefId, '未命名文案', '待填写', now);
      this.#insertVersion({
        changeKinds: ['CREATE_MANUAL_SCAFFOLD'],
        content,
        draftId,
        previousVersionId: null,
        sourceKind: 'MANUAL',
        status: validationResult.valid
          ? structuralStatus('MANUAL', validationResult)
          : 'MANUAL_DRAFT',
        validation: validationResult,
        versionId,
        versionNumber: 1,
        now,
      });
      this.#database
        .prepare(
          `INSERT INTO content_draft_heads (
             draft_id, current_version_id, draft_revision, draft_state, updated_at
           ) VALUES (?, ?, 0, 'ACTIVE', ?)`,
        )
        .run(draftId, versionId, now);
      this.#transition(draftId, versionId, 0, 'CREATE_MANUAL_SCAFFOLD', null, 'ACTIVE', now);
      this.#audit(draftId, versionId, null, 'CREATE_MANUAL_SCAFFOLD', {}, now);
      return this.get(draftId);
    });
  }

  public saveVersion(
    draftIdValue: string,
    expectedRevisionValue: number,
    payloadValue: unknown,
    changeKinds: readonly string[],
    nowValue: string,
    sourceKind: 'MANUAL' | 'MODEL' | 'REWRITE' = 'MANUAL',
  ): CopyDetailView {
    const draftId = identifier(draftIdValue);
    const expectedRevision = page(expectedRevisionValue, 0, Number.MAX_SAFE_INTEGER);
    const next = assertContentDraftPayload(payloadValue);
    const now = iso(nowValue);
    return runInTransaction(this.#database, () => {
      const head = this.#head(draftId);
      if (head.draft_revision !== expectedRevision || head.draft_state !== 'ACTIVE') {
        throw new CopyError('COPY_STALE_REVISION', 'Draft revision is stale.', true);
      }
      const current = this.#version(head.current_version_id);
      const currentPayload = payload(current.payload_json);
      this.#assertSystemAndUserLocks(currentPayload, next);
      if (copySemanticHash(currentPayload) === copySemanticHash(next)) return this.get(draftId);
      const result = validateDraftStructure(next, now);
      const versionId = this.#idFactory();
      this.#insertVersion({
        changeKinds,
        content: next,
        draftId,
        previousVersionId: current.id,
        sourceKind,
        status: structuralStatus(sourceKind === 'MODEL' ? 'MODEL' : 'MANUAL', result),
        validation: result,
        versionId,
        versionNumber: current.version_number + 1,
        now,
      });
      const changed = this.#database
        .prepare(
          `UPDATE content_draft_heads
              SET current_version_id = ?, draft_revision = draft_revision + 1, updated_at = ?
            WHERE draft_id = ? AND draft_revision = ?`,
        )
        .run(versionId, now, draftId, expectedRevision);
      if (Number(changed.changes) !== 1)
        throw new CopyError('COPY_STALE_REVISION', undefined, true);
      this.#transition(
        draftId,
        versionId,
        expectedRevision + 1,
        changeKinds.join('+'),
        'ACTIVE',
        'ACTIVE',
        now,
      );
      this.#audit(draftId, versionId, null, changeKinds.join('+'), {}, now);
      return this.get(draftId);
    });
  }

  public changeFieldLock(
    draftIdValue: string,
    expectedRevision: number,
    fieldPathValue: string,
    lockState: Extract<CopyFieldLockState, 'EDITABLE' | 'USER_LOCKED'>,
    now: string,
  ): CopyDetailView {
    const draftId = identifier(draftIdValue);
    const fieldPath = identifier(fieldPathValue);
    const detail = this.get(draftId);
    const current = detail.payload.fieldStates.find(({ path }) => path === fieldPath);
    if (current === undefined || current.lock === 'SYSTEM_LOCKED') {
      throw new CopyError('COPY_LOCKED_FIELD');
    }
    return this.saveVersion(
      draftId,
      expectedRevision,
      {
        ...detail.payload,
        fieldStates: detail.payload.fieldStates.map((field) =>
          field.path === fieldPath
            ? { ...field, lock: lockState, provenance: 'USER_CONFIRMED' as const }
            : field,
        ),
      },
      [lockState === 'USER_LOCKED' ? 'LOCK_FIELD' : 'UNLOCK_FIELD'],
      now,
    );
  }

  public reorderBlocks(
    draftIdValue: string,
    expectedRevision: number,
    blockIds: readonly string[],
    now: string,
  ): CopyDetailView {
    const detail = this.get(draftIdValue);
    const currentIds = detail.payload.blocks.map(({ blockId }) => blockId);
    if (
      blockIds.length !== currentIds.length ||
      new Set(blockIds).size !== blockIds.length ||
      currentIds.some((id) => !blockIds.includes(id))
    ) {
      throw new CopyError('COPY_INVALID_CONTRACT');
    }
    const byId = new Map(detail.payload.blocks.map((block) => [block.blockId, block]));
    const blocks = blockIds.map((id, order) => {
      const block = byId.get(id);
      if (block === undefined) throw new CopyError('COPY_INVALID_CONTRACT');
      return { ...block, order };
    });
    return this.saveVersion(
      detail.draftId,
      expectedRevision,
      {
        ...detail.payload,
        blocks,
      },
      ['REORDER_BLOCKS'],
      now,
    );
  }

  public undo(
    draftIdValue: string,
    expectedRevision: number,
    targetVersionIdValue: string,
    now: string,
  ): CopyDetailView {
    const draftId = identifier(draftIdValue);
    const target = this.#version(identifier(targetVersionIdValue));
    if (target.draft_id !== draftId || target.source_kind === 'LEGACY') {
      throw new CopyError('COPY_NOT_FOUND');
    }
    return this.saveVersion(
      draftId,
      expectedRevision,
      payload(target.payload_json),
      ['UNDO'],
      now,
      'MANUAL',
    );
  }

  public setArchived(
    draftIdValue: string,
    expectedRevisionValue: number,
    archived: boolean,
    nowValue: string,
  ): CopyDetailView {
    const draftId = identifier(draftIdValue);
    const expectedRevision = page(expectedRevisionValue, 0, Number.MAX_SAFE_INTEGER);
    const now = iso(nowValue);
    return runInTransaction(this.#database, () => {
      const head = this.#head(draftId);
      const from = head.draft_state;
      const to = archived ? 'ARCHIVED' : 'ACTIVE';
      if (from === to) return this.get(draftId);
      const result = this.#database
        .prepare(
          `UPDATE content_draft_heads
              SET draft_state = ?, draft_revision = draft_revision + 1, updated_at = ?
            WHERE draft_id = ? AND draft_revision = ?`,
        )
        .run(to, now, draftId, expectedRevision);
      if (Number(result.changes) !== 1) throw new CopyError('COPY_STALE_REVISION', undefined, true);
      this.#transition(
        draftId,
        head.current_version_id,
        expectedRevision + 1,
        archived ? 'ARCHIVE' : 'RESTORE',
        from,
        to,
        now,
      );
      this.#audit(
        draftId,
        head.current_version_id,
        null,
        archived ? 'ARCHIVE' : 'RESTORE',
        {},
        now,
      );
      return this.get(draftId);
    });
  }

  public diffVersions(
    draftIdValue: string,
    fromVersionIdValue: string,
    toVersionIdValue: string,
  ): CopyVersionDiff {
    const draftId = identifier(draftIdValue);
    const from = this.#version(identifier(fromVersionIdValue));
    const to = this.#version(identifier(toVersionIdValue));
    if (from.draft_id !== draftId || to.draft_id !== draftId) throw new CopyError('COPY_NOT_FOUND');
    return Object.freeze({
      changedFields: changedFields(payload(from.payload_json), payload(to.payload_json)),
      fromVersionId: from.id,
      toVersionId: to.id,
    });
  }

  public previewMutation(input: {
    readonly budgetState: CopyMutationPlanV1['budgetState'];
    readonly capabilityState: CopyMutationPlanV1['capabilityState'];
    readonly draftId: string;
    readonly expectedRevision: number;
    readonly expiresAt: string;
    readonly operation: CopyMutationPlanV1['operation'];
    readonly rewriteInstruction?: string | null;
    readonly rewriteScope?: CopyRewriteScopeV1 | null;
    readonly now: string;
  }): CopyMutationPlanV1 {
    const detail = this.get(input.draftId);
    if (detail.revision !== input.expectedRevision || detail.state !== 'ACTIVE') {
      throw new CopyError('COPY_STALE_REVISION', undefined, true);
    }
    const current = detail.versionHistory.items.find(({ isCurrent }) => isCurrent);
    if (current === undefined) throw new CopyError('COPY_NOT_FOUND');
    if (
      input.capabilityState !== 'SUPPORTED' ||
      input.budgetState !== 'AVAILABLE' ||
      detail.status === 'STALE'
    ) {
      const plan = createCopyMutationPlan({
        ...input,
        draftId: detail.draftId,
        expectedDraftRevision: input.expectedRevision,
        expectedVersionId: current.versionId,
        payload: detail.payload,
        planId: this.#idFactory(),
      });
      this.#insertPlan(plan, input.now);
      return plan;
    }
    const plan = createCopyMutationPlan({
      ...input,
      draftId: detail.draftId,
      expectedDraftRevision: input.expectedRevision,
      expectedVersionId: current.versionId,
      payload: detail.payload,
      planId: this.#idFactory(),
    });
    this.#insertPlan(plan, input.now);
    return plan;
  }

  public confirmMutation(
    planIdValue: string,
    previewHashValue: string,
    executionIdValue: string,
    nowValue: string,
  ): { readonly payload: CopyMutationJobPayloadV1; readonly run: CopyMutationRunV1 } {
    const planId = identifier(planIdValue);
    const previewHash = identifier(previewHashValue, 64);
    const executionId = identifier(executionIdValue, 128);
    const now = iso(nowValue);
    return runInTransaction(this.#database, () => {
      const plan = this.#plan(planId);
      const head = this.#head(plan.draft_id);
      if (
        plan.preview_hash !== previewHash ||
        Date.parse(plan.expires_at) <= Date.parse(now) ||
        head.draft_revision !== plan.expected_draft_revision ||
        head.current_version_id !== plan.version_id ||
        plan.capability_state !== 'SUPPORTED' ||
        plan.budget_state !== 'AVAILABLE'
      ) {
        throw new CopyError('COPY_GENERATION_BLOCKED');
      }
      const existing = this.#database
        .prepare('SELECT * FROM content_draft_mutation_runs WHERE execution_id = ?')
        .get(executionId) as RunRow | undefined;
      if (existing !== undefined)
        return { payload: this.#jobPayload(plan, executionId), run: runView(existing) };
      const runId = this.#idFactory();
      this.#database
        .prepare(
          `INSERT INTO content_draft_mutation_runs (
             id, execution_id, plan_id, draft_id, job_id, operation, status,
             prompt_template_version, schema_version, style_version, profile_version,
             policy_version, model_execution_id, model_identity_json, cache_state,
             usage_state, cost_state, external_request_count, output_hash,
             result_version_id, stable_error_code, created_at, updated_at, finished_at
           ) VALUES (
             ?, ?, ?, ?, NULL, ?, 'CONFIRMED',
             ?, ?, ?, ?, ?, NULL, NULL, 'NOT_CHECKED',
             'NONE', 'NOT_INCURRED', 0, NULL, NULL, NULL, ?, ?, NULL
           )`,
        )
        .run(
          runId,
          executionId,
          plan.id,
          plan.draft_id,
          plan.operation,
          COPY_PROMPT_TEMPLATE_VERSION,
          COPY_OUTPUT_SCHEMA_VERSION,
          COPY_VOICE_POLICY_VERSION,
          COPY_PROFILE_REGISTRY_VERSION,
          plan.operation === 'FULL_GENERATION'
            ? COPY_GENERATION_POLICY_VERSION
            : COPY_REWRITE_POLICY_VERSION,
          now,
          now,
        );
      this.#audit(plan.draft_id, plan.version_id, runId, 'CONFIRM_MUTATION', {}, now);
      return {
        payload: this.#jobPayload(plan, executionId),
        run: runView(this.#run(executionId)),
      };
    });
  }

  public markMutationQueued(executionIdValue: string, jobIdValue: string, nowValue: string) {
    const executionId = identifier(executionIdValue, 128);
    const jobId = identifier(jobIdValue);
    const now = iso(nowValue);
    this.#database
      .prepare(
        `UPDATE content_draft_mutation_runs
            SET job_id = ?, status = 'QUEUED', updated_at = ?
          WHERE execution_id = ? AND status = 'CONFIRMED'`,
      )
      .run(jobId, now, executionId);
    return runView(this.#run(executionId));
  }

  public loadMutationExecution(executionIdValue: string): CopyMutationExecution {
    const run = this.#run(identifier(executionIdValue, 128));
    const plan = this.#plan(run.plan_id);
    const version = this.#version(plan.version_id);
    return Object.freeze({
      payload: payload(version.payload_json),
      plan: this.#planView(plan, payload(version.payload_json)),
      run: runView(run),
    });
  }

  public markMutationRunning(executionIdValue: string, nowValue: string): CopyMutationRunV1 {
    const executionId = identifier(executionIdValue, 128);
    const now = iso(nowValue);
    this.#database
      .prepare(
        `UPDATE content_draft_mutation_runs
            SET status = 'RUNNING', external_request_count = 1, updated_at = ?
          WHERE execution_id = ? AND status IN ('CONFIRMED', 'QUEUED', 'PAUSED')`,
      )
      .run(now, executionId);
    return runView(this.#run(executionId));
  }

  public publishMutationCandidate(
    executionIdValue: string,
    candidateValue: unknown,
    externalRequestCount: 0 | 1,
    model: CopyMutationRunV1['modelIdentity'],
    modelExecutionId: string | null,
    cacheState: CopyMutationRunV1['cacheState'],
    usageState: CopyMutationRunV1['usageState'],
    costState: CopyMutationRunV1['costState'],
    nowValue: string,
  ): CopyMutationRunV1 {
    const executionId = identifier(executionIdValue, 128);
    const now = iso(nowValue);
    return runInTransaction(this.#database, () => {
      const execution = this.loadMutationExecution(executionId);
      if (['SUCCEEDED', 'NO_OP'].includes(execution.run.status)) return execution.run;
      const head = this.#head(execution.run.draftId);
      if (
        head.draft_revision !== execution.plan.expectedDraftRevision ||
        head.current_version_id !== execution.plan.expectedVersionId ||
        execution.plan.inputHash !== copySemanticHash(execution.payload) ||
        execution.plan.lockSnapshotHash !== copySemanticHash(execution.payload.fieldStates) ||
        execution.plan.dependencyHash !== copySemanticHash(execution.payload.brief.dependencies)
      ) {
        return this.#finishRun(
          executionId,
          'FAILED',
          'COPY_INPUT_STALE',
          externalRequestCount,
          costState,
          now,
        );
      }
      const candidate = applyCopyModelCandidate(execution.payload, candidateValue);
      const next =
        execution.plan.operation === 'REWRITE'
          ? applyScopedRewrite(execution.payload, candidate, execution.plan.rewriteScope)
          : candidate;
      this.#assertSystemAndUserLocks(execution.payload, next);
      if (copySemanticHash(next) === copySemanticHash(execution.payload)) {
        return this.#finishRun(executionId, 'NO_OP', null, externalRequestCount, costState, now, {
          cacheState,
          model,
          modelExecutionId,
          outputHash: copySemanticHash(next),
          usageState,
        });
      }
      const result = validateDraftStructure(next, now);
      if (!result.valid) {
        return this.#finishRun(
          executionId,
          'FAILED',
          'COPY_STRUCTURE_INVALID',
          externalRequestCount,
          costState,
          now,
          {
            cacheState,
            model,
            modelExecutionId,
            outputHash: copySemanticHash(next),
            usageState,
          },
        );
      }
      const current = this.#version(head.current_version_id);
      const versionId = this.#idFactory();
      this.#insertVersion({
        changeKinds: [
          execution.plan.operation === 'FULL_GENERATION' ? 'FULL_GENERATION' : 'REWRITE',
        ],
        content: next,
        draftId: head.draft_id,
        previousVersionId: current.id,
        sourceKind: execution.plan.operation === 'FULL_GENERATION' ? 'MODEL' : 'REWRITE',
        status: 'READY_FOR_QUALITY_PIPELINE',
        validation: result,
        versionId,
        versionNumber: current.version_number + 1,
        now,
        modelExecutionId,
        promptTemplateVersion: COPY_PROMPT_TEMPLATE_VERSION,
        outputHash: copySemanticHash(next),
      });
      const updated = this.#database
        .prepare(
          `UPDATE content_draft_heads
              SET current_version_id = ?, draft_revision = draft_revision + 1, updated_at = ?
            WHERE draft_id = ? AND draft_revision = ? AND current_version_id = ?`,
        )
        .run(
          versionId,
          now,
          head.draft_id,
          execution.plan.expectedDraftRevision,
          execution.plan.expectedVersionId,
        );
      if (Number(updated.changes) !== 1) {
        throw new CopyError('COPY_STALE_REVISION', undefined, true);
      }
      this.#database
        .prepare(
          `UPDATE content_draft_mutation_runs
              SET status = 'SUCCEEDED', external_request_count = ?, model_execution_id = ?,
                  model_identity_json = ?, cache_state = ?, usage_state = ?, cost_state = ?,
                  output_hash = ?, result_version_id = ?, stable_error_code = NULL,
                  updated_at = ?, finished_at = ?
            WHERE execution_id = ?`,
        )
        .run(
          externalRequestCount,
          modelExecutionId,
          model === null ? null : JSON.stringify(model),
          cacheState,
          usageState,
          costState,
          copySemanticHash(next),
          versionId,
          now,
          now,
          executionId,
        );
      this.#transition(
        head.draft_id,
        versionId,
        head.draft_revision + 1,
        execution.plan.operation,
        'ACTIVE',
        'ACTIVE',
        now,
      );
      this.#audit(head.draft_id, versionId, execution.run.runId, execution.plan.operation, {}, now);
      return runView(this.#run(executionId));
    });
  }

  public stopMutation(
    executionIdValue: string,
    status: 'PAUSED' | 'CANCELLED' | 'FAILED' | 'AMBIGUOUS',
    errorCode: string,
    externalRequestCount: 0 | 1,
    costState: CopyMutationRunV1['costState'],
    nowValue: string,
  ): CopyMutationRunV1 {
    return this.#finishRun(
      identifier(executionIdValue, 128),
      status,
      identifier(errorCode, 128),
      externalRequestCount,
      costState,
      iso(nowValue),
    );
  }

  public cancelMutation(
    runIdValue: string,
    nowValue: string,
  ): { readonly jobId: string | null; readonly run: CopyMutationRunV1 } {
    const runId = identifier(runIdValue);
    const now = iso(nowValue);
    const row = this.#database
      .prepare('SELECT * FROM content_draft_mutation_runs WHERE id = ?')
      .get(runId) as (RunRow & { readonly job_id: string | null }) | undefined;
    if (row === undefined) throw new CopyError('COPY_NOT_FOUND');
    if (row.status === 'RUNNING') {
      return {
        jobId: row.job_id,
        run: this.#finishRun(
          row.execution_id,
          'AMBIGUOUS',
          'CANCEL_REQUESTED_AFTER_SEND',
          1,
          'UNKNOWN_POSSIBLY_INCURRED',
          now,
        ),
      };
    }
    return {
      jobId: row.job_id,
      run: this.#finishRun(
        row.execution_id,
        'CANCELLED',
        'CANCELLED_BEFORE_SEND',
        0,
        'NOT_INCURRED',
        now,
      ),
    };
  }

  public recoverInterrupted(nowValue: string): {
    readonly ambiguous: number;
    readonly paused: number;
  } {
    const now = iso(nowValue);
    const ambiguous = this.#database
      .prepare(
        `UPDATE content_draft_mutation_runs
            SET status = 'AMBIGUOUS', stable_error_code = 'PROCESS_RESTARTED_AFTER_SEND',
                cost_state = 'UNKNOWN_POSSIBLY_INCURRED', updated_at = ?, finished_at = ?
          WHERE status = 'RUNNING' OR external_request_count = 1`,
      )
      .run(now, now);
    const paused = this.#database
      .prepare(
        `UPDATE content_draft_mutation_runs
            SET status = 'PAUSED', stable_error_code = 'PROCESS_RESTARTED_BEFORE_SEND',
                updated_at = ?
          WHERE status IN ('CONFIRMED', 'QUEUED') AND external_request_count = 0`,
      )
      .run(now);
    return Object.freeze({
      ambiguous: Number(ambiguous.changes),
      paused: Number(paused.changes),
    });
  }

  public invalidateDependency(input: {
    readonly dependencyId: string;
    readonly dependencyType: string;
    readonly observedRevision: string;
    readonly reasonCode: string;
    readonly now: string;
  }): number {
    const now = iso(input.now);
    const dependencies = this.#database
      .prepare(
        `SELECT dependency.draft_id, dependency.version_id
           FROM content_draft_dependencies AS dependency
           JOIN content_draft_heads AS head
             ON head.draft_id = dependency.draft_id
            AND head.current_version_id = dependency.version_id
          WHERE dependency.dependency_type = ? AND dependency.dependency_id = ?`,
      )
      .all(
        identifier(input.dependencyType),
        identifier(input.dependencyId),
      ) as unknown as readonly {
      readonly draft_id: string;
      readonly version_id: string;
    }[];
    return runInTransaction(this.#database, () => {
      let inserted = 0;
      for (const dependency of dependencies) {
        const event = `${input.dependencyType}:${input.dependencyId}:${input.observedRevision}:${dependency.version_id}`;
        const result = this.#database
          .prepare(
            `INSERT OR IGNORE INTO content_draft_invalidations (
               id, event_identity, draft_id, version_id, dependency_type,
               dependency_id, observed_revision, reason_code, created_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            this.#idFactory(),
            event,
            dependency.draft_id,
            dependency.version_id,
            input.dependencyType,
            input.dependencyId,
            identifier(input.observedRevision),
            identifier(input.reasonCode),
            now,
          );
        inserted += Number(result.changes);
      }
      return inserted;
    });
  }

  #head(draftId: string): HeadRow {
    const row = this.#database
      .prepare(
        `SELECT root.id AS draft_id, root.brief_id, head.current_version_id,
                head.draft_revision, head.draft_state, head.updated_at,
                version.brief_version_id, version.profile_id, version.status,
                version.version_number, version.structural_valid,
                version.structural_reason_codes_json, version.created_at
           FROM drafts AS root
           JOIN content_draft_heads AS head ON head.draft_id = root.id
           JOIN content_draft_versions AS version ON version.id = head.current_version_id
          WHERE root.id = ?`,
      )
      .get(draftId) as HeadRow | undefined;
    if (row === undefined) throw new CopyError('COPY_NOT_FOUND');
    return row;
  }

  #version(versionId: string): VersionRow {
    const row = this.#database
      .prepare('SELECT * FROM content_draft_versions WHERE id = ?')
      .get(versionId) as VersionRow | undefined;
    if (row === undefined) throw new CopyError('COPY_NOT_FOUND');
    return row;
  }

  #plan(planId: string): PlanRow {
    const row = this.#database
      .prepare('SELECT * FROM content_draft_mutation_plans WHERE id = ?')
      .get(planId) as PlanRow | undefined;
    if (row === undefined) throw new CopyError('COPY_NOT_FOUND');
    return row;
  }

  #run(executionId: string): RunRow {
    const row = this.#database
      .prepare('SELECT * FROM content_draft_mutation_runs WHERE execution_id = ?')
      .get(executionId) as RunRow | undefined;
    if (row === undefined) throw new CopyError('COPY_NOT_FOUND');
    return row;
  }

  #insertVersion(input: {
    readonly changeKinds: readonly string[];
    readonly content: ContentDraftPayloadV1;
    readonly draftId: string;
    readonly modelExecutionId?: string | null;
    readonly now: string;
    readonly outputHash?: string | null;
    readonly previousVersionId: string | null;
    readonly promptTemplateVersion?: string | null;
    readonly sourceKind: VersionRow['source_kind'];
    readonly status: CopyDraftStatus;
    readonly validation: DraftStructuralValidationV1;
    readonly versionId: string;
    readonly versionNumber: number;
  }): void {
    const content = assertContentDraftPayload(input.content);
    const contentHash = copySemanticHash(content);
    const inputHash = content.brief.briefInputHash;
    const dependencyHash = copySemanticHash(content.brief.dependencies);
    const lockHash = copySemanticHash(content.fieldStates);
    this.#database
      .prepare(
        `INSERT INTO content_draft_versions (
           id, draft_id, version_number, previous_version_id, brief_version_id,
           profile_id, payload_json, content_hash, source_kind, status,
           structural_valid, structural_reason_codes_json, structural_policy_version,
           contract_version, schema_version, format_policy_version, profile_version,
           style_version, generation_policy_version, rewrite_policy_version,
           prompt_template_version, model_execution_id, input_hash, dependency_hash,
           lock_snapshot_hash, output_hash, change_kinds_json, created_at
         ) VALUES (
           ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
         )`,
      )
      .run(
        input.versionId,
        input.draftId,
        input.versionNumber,
        input.previousVersionId,
        content.brief.briefVersionId,
        content.profileId,
        JSON.stringify(content),
        contentHash,
        input.sourceKind,
        input.status,
        input.validation.valid ? 1 : 0,
        JSON.stringify(input.validation.reasonCodes),
        COPY_STRUCTURAL_VALIDATION_VERSION,
        content.contractVersion,
        COPY_OUTPUT_SCHEMA_VERSION,
        COPY_FORMAT_POLICY_VERSION,
        COPY_PROFILE_REGISTRY_VERSION,
        COPY_VOICE_POLICY_VERSION,
        COPY_GENERATION_POLICY_VERSION,
        COPY_REWRITE_POLICY_VERSION,
        input.promptTemplateVersion ?? null,
        input.modelExecutionId ?? null,
        inputHash,
        dependencyHash,
        lockHash,
        input.outputHash ?? null,
        JSON.stringify(input.changeKinds),
        input.now,
      );
    for (const [order, title] of content.titles.entries()) {
      this.#database
        .prepare(
          `INSERT INTO content_draft_titles (
             version_id, title_id, title_kind, title_order, title_text, provenance
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.versionId, title.titleId, title.kind, order, title.text, title.provenance);
      this.#insertLineage(input.versionId, 'TITLE', title.titleId, title.lineage);
    }
    for (const block of content.blocks) {
      this.#database
        .prepare(
          `INSERT INTO content_draft_blocks (
             version_id, block_id, block_kind, block_order, block_text, provenance
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(input.versionId, block.blockId, block.kind, block.order, block.text, block.provenance);
      this.#insertLineage(input.versionId, 'BLOCK', block.blockId, block.lineage);
    }
    for (const [order, tag] of content.tags.entries()) {
      this.#database
        .prepare(
          `INSERT INTO content_draft_tags (
             version_id, tag_id, tag_order, tag_text, normalized_tag, provenance
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.versionId,
          tag.tagId,
          order,
          tag.text,
          tag.text.toLocaleLowerCase('zh-CN'),
          tag.provenance,
        );
      this.#insertLineage(input.versionId, 'TAG', tag.tagId, tag.lineage);
    }
    if (content.pinnedComment !== null) {
      this.#database
        .prepare(
          `INSERT INTO content_draft_pinned_comments (
             version_id, comment_text, provenance
           ) VALUES (?, ?, ?)`,
        )
        .run(input.versionId, content.pinnedComment.text, content.pinnedComment.provenance);
      this.#insertLineage(
        input.versionId,
        'COMMENT',
        'pinned-comment',
        content.pinnedComment.lineage,
      );
    }
    const warnings = content.spoilerWarnings;
    this.#database
      .prepare(
        `INSERT INTO content_draft_spoiler_warnings (
           version_id, cover_warning_text, title_warning_marker,
           body_opening_warning_text, pinned_comment_warning_text, provenance
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.versionId,
        warnings.coverWarningText,
        warnings.titleWarningMarker,
        warnings.bodyOpeningWarningText,
        warnings.pinnedCommentWarningText,
        warnings.provenance,
      );
    for (const field of content.fieldStates) {
      this.#database
        .prepare(
          `INSERT INTO content_draft_field_states (
             version_id, field_path, provenance, lock_state
           ) VALUES (?, ?, ?, ?)`,
        )
        .run(input.versionId, field.path, field.provenance, field.lock);
    }
    for (const dependency of content.brief.dependencies) {
      this.#database
        .prepare(
          `INSERT INTO content_draft_dependencies (
             id, draft_id, version_id, dependency_type, dependency_id,
             dependency_revision, dependency_hash, current_at_creation
           ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        )
        .run(
          this.#idFactory(),
          input.draftId,
          input.versionId,
          dependency.dependencyType,
          dependency.dependencyId,
          dependency.observedRevision,
          dependency.dependencyHash,
        );
    }
  }

  #insertLineage(
    versionId: string,
    artifactKind: 'TITLE' | 'BLOCK' | 'TAG' | 'COMMENT',
    artifactId: string,
    refs: ContentDraftPayloadV1['titles'][number]['lineage'],
  ): void {
    for (const [order, ref] of refs.entries()) {
      this.#database
        .prepare(
          `INSERT INTO content_draft_lineage_refs (
             id, version_id, artifact_kind, artifact_id, lineage_order,
             brief_field_path, argument_id, structure_slot_id, work_id,
             evidence_ref_ids_json, experience_assertion_id, provenance, input_hash
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#idFactory(),
          versionId,
          artifactKind,
          artifactId,
          order,
          ref.briefFieldPath,
          ref.argumentId,
          ref.structureSlotId,
          ref.workId,
          JSON.stringify(ref.evidenceRefIds),
          ref.experienceAssertionId,
          ref.provenance,
          ref.inputHash,
        );
    }
  }

  #assertSystemAndUserLocks(current: ContentDraftPayloadV1, next: ContentDraftPayloadV1): void {
    const locked = current.fieldStates.filter(({ lock }) => lock !== 'EDITABLE');
    for (const field of locked) {
      const value = (content: ContentDraftPayloadV1): unknown => {
        if (field.path === 'brief' || field.path.startsWith('brief.')) return content.brief;
        if (
          [
            'contractVersion',
            'formatPolicyVersion',
            'profileId',
            'profileVersion',
            'schemaVersion',
            'voicePolicyVersion',
          ].includes(field.path)
        ) {
          return content[field.path as keyof ContentDraftPayloadV1];
        }
        if (field.path === 'selectedTitle') {
          return content.titles.find(({ titleId }) => titleId === content.selectedTitleId);
        }
        if (field.path.startsWith('blocks.')) {
          const id = field.path.slice('blocks.'.length);
          return content.blocks.find(({ blockId }) => blockId === id);
        }
        if (field.path === 'tags') return content.tags;
        if (field.path === 'pinnedComment') return content.pinnedComment;
        if (field.path === 'spoilerWarnings') return content.spoilerWarnings;
        return undefined;
      };
      if (copySemanticHash(value(current)) !== copySemanticHash(value(next))) {
        throw new CopyError('COPY_LOCKED_FIELD');
      }
    }
  }

  #insertPlan(plan: CopyMutationPlanV1, nowValue: string): void {
    const now = iso(nowValue);
    this.#database
      .prepare(
        `INSERT INTO content_draft_mutation_plans (
           id, draft_id, version_id, operation, rewrite_scope_json,
           rewrite_instruction_json, expected_draft_revision, input_hash,
           dependency_hash, lock_snapshot_hash, preview_hash, capability_state,
           budget_state, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.planId,
        plan.draftId,
        plan.expectedVersionId,
        plan.operation,
        plan.rewriteScope === null ? null : JSON.stringify(plan.rewriteScope),
        plan.rewriteInstruction === null
          ? null
          : JSON.stringify({ direction: plan.rewriteInstruction.slice(0, 1_000) }),
        plan.expectedDraftRevision,
        plan.inputHash,
        plan.dependencyHash,
        plan.lockSnapshotHash,
        plan.previewHash,
        plan.capabilityState,
        plan.budgetState,
        plan.expiresAt,
        now,
      );
  }

  #planView(row: PlanRow, content: ContentDraftPayloadV1): CopyMutationPlanV1 {
    const instruction =
      row.rewrite_instruction_json === null
        ? null
        : (JSON.parse(row.rewrite_instruction_json) as { readonly direction: string }).direction;
    return createCopyMutationPlan({
      budgetState: row.budget_state,
      capabilityState: row.capability_state,
      draftId: row.draft_id,
      expectedDraftRevision: row.expected_draft_revision,
      expectedVersionId: row.version_id,
      expiresAt: row.expires_at,
      operation: row.operation,
      payload: content,
      planId: row.id,
      rewriteInstruction: instruction,
      rewriteScope:
        row.rewrite_scope_json === null
          ? null
          : (JSON.parse(row.rewrite_scope_json) as CopyRewriteScopeV1),
    });
  }

  #jobPayload(plan: PlanRow, executionId: string): CopyMutationJobPayloadV1 {
    return Object.freeze({
      dependencyHash: plan.dependency_hash,
      draftId: plan.draft_id,
      executionId,
      expectedDraftRevision: plan.expected_draft_revision,
      expectedVersionId: plan.version_id,
      inputHash: plan.input_hash,
      jobType: plan.operation === 'FULL_GENERATION' ? 'COPY_GENERATE_V1' : 'COPY_REWRITE_V1',
      lockSnapshotHash: plan.lock_snapshot_hash,
      planId: plan.id,
      previewHash: plan.preview_hash,
      rewriteScope:
        plan.rewrite_scope_json === null
          ? null
          : (JSON.parse(plan.rewrite_scope_json) as CopyRewriteScopeV1),
      schemaVersion: 1,
    });
  }

  #finishRun(
    executionId: string,
    status: 'PAUSED' | 'NO_OP' | 'CANCELLED' | 'FAILED' | 'AMBIGUOUS',
    errorCode: string | null,
    externalRequestCount: 0 | 1,
    costState: CopyMutationRunV1['costState'],
    now: string,
    detail: {
      readonly cacheState?: CopyMutationRunV1['cacheState'];
      readonly model?: CopyMutationRunV1['modelIdentity'];
      readonly modelExecutionId?: string | null;
      readonly outputHash?: string | null;
      readonly usageState?: CopyMutationRunV1['usageState'];
    } = {},
  ): CopyMutationRunV1 {
    this.#database
      .prepare(
        `UPDATE content_draft_mutation_runs
            SET status = ?, stable_error_code = ?, external_request_count = ?,
                cost_state = ?, cache_state = ?, usage_state = ?,
                model_execution_id = ?, model_identity_json = ?, output_hash = ?,
                updated_at = ?, finished_at = CASE WHEN ? = 'PAUSED' THEN NULL ELSE ? END
          WHERE execution_id = ?`,
      )
      .run(
        status,
        errorCode,
        externalRequestCount,
        costState,
        detail.cacheState ?? 'NOT_CHECKED',
        detail.usageState ?? 'NONE',
        detail.modelExecutionId ?? null,
        detail.model === undefined || detail.model === null ? null : JSON.stringify(detail.model),
        detail.outputHash ?? null,
        now,
        status,
        now,
        executionId,
      );
    return runView(this.#run(executionId));
  }

  #transition(
    draftId: string,
    versionId: string | null,
    revision: number,
    action: string,
    fromState: string | null,
    toState: string,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO content_draft_transitions (
           id, draft_id, version_id, revision, action, from_state, to_state, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(this.#idFactory(), draftId, versionId, revision, action, fromState, toState, now);
  }

  #audit(
    draftId: string,
    versionId: string | null,
    runId: string | null,
    action: string,
    detail: Readonly<Record<string, unknown>>,
    now: string,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO content_draft_audit_events (
           id, event_identity, draft_id, version_id, mutation_run_id,
           action, detail_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.#idFactory(),
        `${action}:${draftId}:${versionId ?? 'none'}:${this.#idFactory()}`,
        draftId,
        versionId,
        runId,
        action,
        JSON.stringify(detail),
        now,
      );
  }
}

export const COPY_PROTECTED_TABLES = Object.freeze([
  'assets',
  'quality_checks',
  'approvals',
  'post_packages',
  'publications',
] as const);

export const COPY_REPOSITORY_INVARIANTS = Object.freeze({
  currentSwitchTransactional: true,
  legacyDraftStatus: 'STRUCTURE_INVALID',
  maximumExternalRequests: 1,
  protectedTablesWritten: Object.freeze([]),
  zeroHashUsedOnlyForLegacyMigration: ZERO_HASH,
});
