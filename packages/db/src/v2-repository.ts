import type { DatabaseSync } from 'node:sqlite';

import {
  parseAccountPersona,
  parseWeeklyPlan,
  V2ContractError,
  V2ContentError,
  V2_CONTENT_COVER_KEYS,
  V2_CONTENT_FIELD_KEYS,
  V2_CONTENT_STATUSES,
  V2_SCHEMA_VERSION,
  type AccountPersona,
  type AccountPersonaFields,
  type ContentApprovalRef,
  type ContentBlobRef,
  type ContentBlobSet,
  type ContentCoverKey,
  type ContentPackageStatus,
  type ContentVersionRecord,
  type GeneratedCoverRef,
  type InteractionBlobRef,
  type InteractionDeletePreview,
  type InteractionKind,
  type InteractionRecord,
  type InteractionStatus,
  type InteractionVersionRef,
  type NewContentVersionRecord,
  type V2ContentRepositoryPort,
  type V2InteractionRepositoryPort,
  type V2RepositoryPort,
  type WeeklyPlan,
  V2InteractionError,
  V2_INTERACTION_KINDS,
  V2MetricsError,
  type MetricSnapshot,
} from '@mystery-operations/v2';
import { parseManagedRelativePath } from '@mystery-operations/shared/storage';

import { runInTransaction } from './transaction.js';

interface PersonaRow {
  readonly persona_audience: string;
  readonly persona_boundary: string;
  readonly persona_name: string;
  readonly persona_tone: string;
  readonly revision: number;
  readonly schema_version: number;
}

interface PlanRow {
  readonly candidates_json: string;
  readonly plan_status: string;
  readonly revision: number;
  readonly schema_version: number;
  readonly week_key: string;
}

interface ContentRow {
  readonly candidate_id: string;
  readonly cover_key: string;
  readonly files_json: string;
  readonly package_id: string;
  readonly plan_revision: number;
  readonly revision: number;
  readonly status: string;
  readonly version: number;
  readonly version_id: string;
  readonly week_key: string;
  readonly copy_model_run_id: string | null;
  readonly created_at: string;
  readonly generated_cover_height: number | null;
  readonly generated_cover_mime: string | null;
  readonly generated_cover_path: string | null;
  readonly generated_cover_sha256: string | null;
  readonly generated_cover_width: number | null;
  readonly cover_model_run_id: string | null;
  readonly copy_model_id: string | null;
  readonly cover_model_id: string | null;
  readonly copy_cost_state: string | null;
  readonly cover_cost_state: string | null;
}

interface InteractionRow {
  readonly current_suggestion_version: number | null;
  readonly dedup_key: string;
  readonly item_id: string;
  readonly kind: string;
  readonly provider_kind: string | null;
  readonly related_content_package_id: string | null;
  readonly reply_path: string | null;
  readonly reply_sha256: string | null;
  readonly reply_size_bytes: number | null;
  readonly revision: number;
  readonly source: string;
  readonly status: string;
  readonly user_text_path: string;
  readonly user_text_sha256: string;
  readonly user_text_size_bytes: number;
  readonly version_id: string | null;
  readonly model_run_id: string | null;
}

const DEFAULT_WORKSPACE_ID = 'v2-local-workspace';

function decodePersona(row: PersonaRow): AccountPersona {
  return parseAccountPersona({
    audience: row.persona_audience,
    boundary: row.persona_boundary,
    name: row.persona_name,
    revision: row.revision,
    schemaVersion: row.schema_version,
    tone: row.persona_tone,
  });
}

function decodePlan(row: PlanRow): WeeklyPlan {
  let candidates: unknown;
  try {
    candidates = JSON.parse(row.candidates_json) as unknown;
  } catch {
    throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
  }
  return parseWeeklyPlan({
    candidates,
    revision: row.revision,
    schemaVersion: row.schema_version,
    status: row.plan_status,
    weekKey: row.week_key,
  });
}

function samePersona(left: AccountPersona, right: AccountPersonaFields): boolean {
  return (
    left.audience === right.audience &&
    left.boundary === right.boundary &&
    left.name === right.name &&
    left.tone === right.tone
  );
}

function candidatesJson(plan: WeeklyPlan): string {
  const encoded = JSON.stringify(plan.candidates);
  if (Buffer.byteLength(encoded, 'utf8') > 32_768) {
    throw new V2ContractError('INVALID_REQUEST', ['candidates']);
  }
  return encoded;
}

function decodeFiles(encoded: string): ContentBlobSet {
  let values: unknown;
  try {
    values = JSON.parse(encoded) as unknown;
  } catch {
    throw new V2ContentError('CONTENT_CORRUPT', ['files']);
  }
  if (!Array.isArray(values) || values.length !== V2_CONTENT_FIELD_KEYS.length)
    throw new V2ContentError('CONTENT_CORRUPT', ['files']);
  const result = {} as Record<(typeof V2_CONTENT_FIELD_KEYS)[number], ContentBlobRef>;
  for (const [index, key] of V2_CONTENT_FIELD_KEYS.entries()) {
    const ref = values[index] as Partial<ContentBlobRef> | undefined;
    if (
      typeof ref !== 'object' ||
      ref === null ||
      Object.keys(ref).sort().join() !== 'managedPath,sha256,sizeBytes' ||
      typeof ref?.managedPath !== 'string' ||
      typeof ref.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(ref.sha256) ||
      !Number.isSafeInteger(ref.sizeBytes) ||
      (ref.sizeBytes ?? 0) < 1
    )
      throw new V2ContentError('CONTENT_CORRUPT', ['files']);
    result[key] = {
      managedPath: parseManagedRelativePath(ref.managedPath, 'EXPORT'),
      sha256: ref.sha256,
      sizeBytes: ref.sizeBytes,
    } as ContentBlobRef;
  }
  return result;
}

function encodeFiles(files: ContentBlobSet): string {
  for (const key of V2_CONTENT_FIELD_KEYS)
    parseManagedRelativePath(files[key].managedPath, 'EXPORT');
  const encoded = JSON.stringify(V2_CONTENT_FIELD_KEYS.map((key) => files[key]));
  if (Buffer.byteLength(encoded, 'utf8') > 4096)
    throw new V2ContentError('INVALID_REQUEST', ['files']);
  return encoded;
}

function decodeContent(row: ContentRow): ContentVersionRecord {
  if (
    !V2_CONTENT_COVER_KEYS.includes(row.cover_key as ContentCoverKey) ||
    !V2_CONTENT_STATUSES.includes(row.status as ContentPackageStatus) ||
    !Number.isSafeInteger(row.revision) ||
    !Number.isSafeInteger(row.version) ||
    !Number.isSafeInteger(row.plan_revision)
  ) {
    throw new V2ContentError('CONTENT_CORRUPT');
  }
  const coverValues = [
    row.generated_cover_path,
    row.generated_cover_mime,
    row.generated_cover_sha256,
    row.generated_cover_width,
    row.generated_cover_height,
  ];
  if (
    !coverValues.every((value) => value === null) &&
    !coverValues.every((value) => value !== null)
  )
    throw new V2ContentError('CONTENT_CORRUPT', ['cover']);
  const generatedCover: GeneratedCoverRef | null =
    row.generated_cover_path === null
      ? null
      : {
          height: row.generated_cover_height as number,
          managedPath: parseManagedRelativePath(row.generated_cover_path, 'GENERATED_IMAGE'),
          mimeType: row.generated_cover_mime as 'image/png',
          modelRunId: row.cover_model_run_id,
          sha256: row.generated_cover_sha256 as string,
          width: row.generated_cover_width as number,
        };
  return {
    candidateId: row.candidate_id,
    copyModelRunId: row.copy_model_run_id,
    copyModelId: row.copy_model_id,
    coverModelId: row.cover_model_id,
    copyCostState: row.copy_cost_state,
    coverCostState: row.cover_cost_state,
    coverKey: row.cover_key as ContentCoverKey,
    createdAt: row.created_at,
    files: decodeFiles(row.files_json),
    generatedCover,
    packageId: row.package_id,
    planRevision: row.plan_revision,
    revision: row.revision,
    status: row.status as ContentPackageStatus,
    version: row.version,
    versionId: row.version_id,
    weekKey: row.week_key,
  };
}

function decodeInteractionBlob(
  managedPath: string,
  sha256: string,
  sizeBytes: number,
): InteractionBlobRef {
  if (!/^[a-f0-9]{64}$/u.test(sha256) || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1)
    throw new V2InteractionError('INTERACTION_CORRUPT');
  return {
    managedPath: parseManagedRelativePath(managedPath, 'IMPORT'),
    sha256,
    sizeBytes,
  };
}

function decodeInteraction(row: InteractionRow): InteractionRecord {
  if (
    !V2_INTERACTION_KINDS.includes(row.kind as InteractionKind) ||
    !/^(?:CONFIRMED|DELETED|MANUAL_SENT|NEW|SKIPPED|SUGGESTED)$/u.test(row.status) ||
    row.source !== 'USER_PASTE' ||
    !/^[a-f0-9]{64}$/u.test(row.dedup_key) ||
    !Number.isSafeInteger(row.revision)
  )
    throw new V2InteractionError('INTERACTION_CORRUPT');
  const noSuggestion = row.current_suggestion_version === null;
  if (
    noSuggestion !==
    [row.version_id, row.reply_path, row.reply_sha256, row.reply_size_bytes].every(
      (value) => value === null,
    )
  )
    throw new V2InteractionError('INTERACTION_CORRUPT');
  if (!noSuggestion && !/^(?:MODEL|SCRIPTED)$/u.test(row.provider_kind ?? ''))
    throw new V2InteractionError('INTERACTION_CORRUPT');
  return {
    currentSuggestion: noSuggestion
      ? null
      : {
          files: decodeInteractionBlob(
            row.reply_path as string,
            row.reply_sha256 as string,
            row.reply_size_bytes as number,
          ),
          version: row.current_suggestion_version as number,
          versionId: row.version_id as string,
          modelRunId: row.model_run_id,
          providerKind: row.provider_kind as 'MODEL' | 'SCRIPTED',
        },
    dedupKey: row.dedup_key,
    itemId: row.item_id,
    kind: row.kind as InteractionKind,
    relatedContentPackageId: row.related_content_package_id,
    revision: row.revision,
    status: row.status as InteractionStatus,
    userText: decodeInteractionBlob(
      row.user_text_path,
      row.user_text_sha256,
      row.user_text_size_bytes,
    ),
  };
}

export class SqliteV2Repository
  implements V2ContentRepositoryPort, V2InteractionRepositoryPort, V2RepositoryPort
{
  readonly #database: DatabaseSync;
  readonly #now: () => Date;
  readonly #workspaceId: string;

  public constructor(
    database: DatabaseSync,
    options: { readonly now?: () => Date; readonly workspaceId?: string } = {},
  ) {
    const workspaceId = options.workspaceId ?? DEFAULT_WORKSPACE_ID;
    if (!/^[a-z0-9-]{1,64}$/u.test(workspaceId)) {
      throw new V2ContractError('INVALID_REQUEST', ['workspaceId']);
    }
    this.#database = database;
    this.#now = options.now ?? (() => new Date());
    this.#workspaceId = workspaceId;
  }

  public getOrCreatePersona(seed: AccountPersona): AccountPersona {
    const validated = parseAccountPersona(seed);
    return runInTransaction(this.#database, () => {
      const existing = this.#readPersona();
      if (existing !== null) return existing;
      const timestamp = this.#timestamp();
      this.#database
        .prepare(
          `INSERT INTO v2_workspaces(
             workspace_id, persona_name, persona_audience, persona_tone, persona_boundary,
             schema_version, revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#workspaceId,
          validated.name,
          validated.audience,
          validated.tone,
          validated.boundary,
          V2_SCHEMA_VERSION,
          validated.revision,
          timestamp,
          timestamp,
        );
      return this.#requiredPersona();
    });
  }

  public getOrCreateWeeklyPlan(seed: WeeklyPlan, personaSeed: AccountPersona): WeeklyPlan {
    this.getOrCreatePersona(personaSeed);
    const validated = parseWeeklyPlan(seed);
    return runInTransaction(this.#database, () => {
      const existing = this.#readPlan(validated.weekKey);
      if (existing !== null) return existing;
      const timestamp = this.#timestamp();
      this.#database
        .prepare(
          `INSERT INTO v2_weekly_plan_snapshots(
             workspace_id, week_key, plan_status, candidates_json, schema_version,
             revision, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#workspaceId,
          validated.weekKey,
          validated.status,
          candidatesJson(validated),
          V2_SCHEMA_VERSION,
          validated.revision,
          timestamp,
          timestamp,
        );
      return this.#requiredPlan(validated.weekKey);
    });
  }

  public savePersona(persona: AccountPersonaFields, expectedRevision: number): AccountPersona {
    const validated = parseAccountPersona({
      ...persona,
      revision: expectedRevision,
      schemaVersion: V2_SCHEMA_VERSION,
    });
    return runInTransaction(this.#database, () => {
      const current = this.#requiredPersona();
      if (current.revision !== expectedRevision) {
        throw new V2ContractError('REVISION_CONFLICT', ['persona']);
      }
      if (samePersona(current, validated)) return current;
      const next = parseAccountPersona({ ...validated, revision: current.revision + 1 });
      const result = this.#database
        .prepare(
          `UPDATE v2_workspaces
           SET persona_name = ?, persona_audience = ?, persona_tone = ?, persona_boundary = ?,
               revision = ?, updated_at = ?
           WHERE workspace_id = ? AND revision = ?`,
        )
        .run(
          next.name,
          next.audience,
          next.tone,
          next.boundary,
          next.revision,
          this.#timestamp(),
          this.#workspaceId,
          expectedRevision,
        );
      if (result.changes !== 1) throw new V2ContractError('REVISION_CONFLICT', ['persona']);
      return this.#requiredPersona();
    });
  }

  public saveWeeklyPlan(plan: WeeklyPlan, expectedRevision: number): WeeklyPlan {
    const validated = parseWeeklyPlan(plan);
    return runInTransaction(this.#database, () => {
      const current = this.#requiredPlan(validated.weekKey);
      if (current.revision !== expectedRevision) {
        throw new V2ContractError('REVISION_CONFLICT', ['weeklyPlan']);
      }
      const nextJson = candidatesJson(validated);
      if (current.status === validated.status && candidatesJson(current) === nextJson)
        return current;
      const next = parseWeeklyPlan({ ...validated, revision: current.revision + 1 });
      const result = this.#database
        .prepare(
          `UPDATE v2_weekly_plan_snapshots
           SET plan_status = ?, candidates_json = ?, revision = ?, updated_at = ?
           WHERE workspace_id = ? AND week_key = ? AND revision = ?`,
        )
        .run(
          next.status,
          candidatesJson(next),
          next.revision,
          this.#timestamp(),
          this.#workspaceId,
          next.weekKey,
          expectedRevision,
        );
      if (result.changes !== 1) throw new V2ContractError('REVISION_CONFLICT', ['weeklyPlan']);
      return this.#requiredPlan(next.weekKey);
    });
  }

  public unlockWeeklyPlan(plan: WeeklyPlan, expectedRevision: number): WeeklyPlan {
    const validated = parseWeeklyPlan(plan);
    return runInTransaction(this.#database, () => {
      const current = this.#requiredPlan(validated.weekKey);
      if (current.revision !== expectedRevision || current.status !== 'CONFIRMED') {
        throw new V2ContractError('REVISION_CONFLICT', ['weeklyPlan']);
      }
      const historyRow = this.#database
        .prepare(
          `SELECT locked_history_json FROM v2_weekly_plan_snapshots
           WHERE workspace_id = ? AND week_key = ?`,
        )
        .get(this.#workspaceId, validated.weekKey) as { locked_history_json: string | null };
      const history =
        historyRow.locked_history_json === null ? [] : JSON.parse(historyRow.locked_history_json);
      if (!Array.isArray(history)) throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
      const snapshot = {
        candidates: current.candidates,
        revision: current.revision,
        status: current.status,
      };
      const nextHistory = JSON.stringify([...history, snapshot]);
      if (Buffer.byteLength(nextHistory, 'utf8') > 32_768)
        throw new V2ContractError('INVALID_REQUEST', ['weeklyPlan']);
      const next = parseWeeklyPlan({ ...validated, revision: current.revision + 1 });
      const result = this.#database
        .prepare(
          `UPDATE v2_weekly_plan_snapshots
           SET plan_status = ?, candidates_json = ?, locked_history_json = ?, revision = ?, updated_at = ?
           WHERE workspace_id = ? AND week_key = ? AND revision = ?`,
        )
        .run(
          next.status,
          candidatesJson(next),
          nextHistory,
          next.revision,
          this.#timestamp(),
          this.#workspaceId,
          next.weekKey,
          expectedRevision,
        );
      if (result.changes !== 1) throw new V2ContractError('REVISION_CONFLICT', ['weeklyPlan']);
      return this.#requiredPlan(next.weekKey);
    });
  }

  public list(requestedWeekKey: string): readonly ContentVersionRecord[] {
    return this.#database
      .prepare(this.#contentSelect(`WHERE package.workspace_id = ? AND package.week_key = ?`))
      .all(this.#workspaceId, requestedWeekKey)
      .map((row) => decodeContent(row as unknown as ContentRow));
  }

  public get(packageId: string): ContentVersionRecord {
    const row = this.#database
      .prepare(this.#contentSelect(`WHERE package.workspace_id = ? AND package.package_id = ?`))
      .get(this.#workspaceId, packageId) as ContentRow | undefined;
    if (row === undefined) throw new V2ContentError('INVALID_REQUEST', ['packageId']);
    return decodeContent(row);
  }

  public create(records: readonly NewContentVersionRecord[]): readonly ContentVersionRecord[] {
    if (
      records.length < 1 ||
      records.length > 3 ||
      new Set(records.map(({ packageId }) => packageId)).size !== records.length
    ) {
      throw new V2ContentError('INVALID_REQUEST', ['packages']);
    }
    return runInTransaction(this.#database, () => {
      const timestamp = this.#timestamp();
      for (const record of records) {
        this.#database
          .prepare(
            `INSERT INTO v2_content_packages(
               workspace_id, package_id, week_key, candidate_id, plan_revision,
               current_version, revision, created_at, updated_at
             ) VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)`,
          )
          .run(
            this.#workspaceId,
            record.packageId,
            record.weekKey,
            record.candidateId,
            record.planRevision,
            timestamp,
            timestamp,
          );
        this.#insertVersion(record, timestamp);
      }
      return this.list(records[0]?.weekKey ?? '');
    });
  }

  public appendVersion(
    expected: ContentVersionRecord,
    files: ContentBlobSet,
    status: 'DRAFT' | 'REVIEW_REQUIRED',
    provenance: {
      readonly copyModelRunId?: string | null;
      readonly generatedCover?: GeneratedCoverRef | null;
    } = {},
  ): ContentVersionRecord {
    return runInTransaction(this.#database, () => {
      const current = this.get(expected.packageId);
      if (current.revision !== expected.revision || current.versionId !== expected.versionId) {
        throw new V2ContentError('REVISION_CONFLICT', ['contentPackage']);
      }
      const version = current.version + 1;
      const timestamp = this.#timestamp();
      this.#insertVersion(
        {
          ...current,
          copyModelRunId: provenance.copyModelRunId ?? current.copyModelRunId ?? null,
          files,
          generatedCover: provenance.generatedCover ?? current.generatedCover ?? null,
          revision: current.revision + 1,
          status,
          version,
          versionId: `${current.packageId}-v${version}`,
        },
        timestamp,
      );
      const result = this.#database
        .prepare(
          `UPDATE v2_content_packages
           SET current_version = ?, revision = revision + 1, updated_at = ?
           WHERE workspace_id = ? AND package_id = ? AND revision = ?`,
        )
        .run(version, timestamp, this.#workspaceId, current.packageId, current.revision);
      if (result.changes !== 1) throw new V2ContentError('REVISION_CONFLICT', ['contentPackage']);
      return this.get(current.packageId);
    });
  }

  public approve(items: readonly ContentApprovalRef[]): readonly ContentVersionRecord[] {
    return runInTransaction(this.#database, () => {
      const current = items.map((item) => {
        const record = this.get(item.packageId);
        if (
          record.revision !== item.expectedRevision ||
          record.versionId !== item.expectedVersionId
        ) {
          throw new V2ContentError('REVISION_CONFLICT', ['items']);
        }
        return record;
      });
      if (new Set(current.map(({ weekKey }) => weekKey)).size !== 1) {
        throw new V2ContentError('INVALID_REQUEST', ['items']);
      }
      const timestamp = this.#timestamp();
      for (const record of current) {
        if (record.status === 'APPROVED') continue;
        const versionResult = this.#database
          .prepare(
            `UPDATE v2_content_package_versions SET status = 'APPROVED', approved_at = ?
             WHERE workspace_id = ? AND package_id = ? AND version = ?
               AND status IN ('DRAFT', 'REVIEW_REQUIRED')`,
          )
          .run(timestamp, this.#workspaceId, record.packageId, record.version);
        const packageResult = this.#database
          .prepare(
            `UPDATE v2_content_packages SET revision = revision + 1, updated_at = ?
             WHERE workspace_id = ? AND package_id = ? AND revision = ?`,
          )
          .run(timestamp, this.#workspaceId, record.packageId, record.revision);
        if (versionResult.changes !== 1 || packageResult.changes !== 1) {
          throw new V2ContentError('REVISION_CONFLICT', ['items']);
        }
      }
      return current.map(({ packageId }) => this.get(packageId));
    });
  }

  public listInteractions(): readonly InteractionRecord[] {
    return this.#database
      .prepare(
        this.#interactionSelect(
          `WHERE item.workspace_id = ? AND item.status <> 'DELETED' ORDER BY item.created_at, item.item_id`,
        ),
      )
      .all(this.#workspaceId)
      .map((row) => decodeInteraction(row as unknown as InteractionRow));
  }

  public getInteraction(itemId: string): InteractionRecord {
    const row = this.#database
      .prepare(
        this.#interactionSelect(
          `WHERE item.workspace_id = ? AND item.item_id = ? AND item.status <> 'DELETED'`,
        ),
      )
      .get(this.#workspaceId, itemId) as InteractionRow | undefined;
    if (row === undefined) throw new V2InteractionError('INVALID_REQUEST', ['itemId']);
    return decodeInteraction(row);
  }

  public findInteractionByDedup(dedupKey: string): InteractionRecord | null {
    const row = this.#database
      .prepare(this.#interactionSelect(`WHERE item.workspace_id = ? AND item.dedup_key = ?`))
      .get(this.#workspaceId, dedupKey) as InteractionRow | undefined;
    return row === undefined ? null : decodeInteraction(row);
  }

  public contentPackageExists(packageId: string): boolean {
    return (
      this.#database
        .prepare(`SELECT 1 FROM v2_content_packages WHERE workspace_id = ? AND package_id = ?`)
        .get(this.#workspaceId, packageId) !== undefined
    );
  }

  public listMetricSnapshots(): readonly MetricSnapshot[] {
    return this.#database
      .prepare(
        `SELECT package_id, snapshot_window, published_at, views, likes, collections, comments, new_followers, revision
       FROM v2_metric_snapshots WHERE workspace_id = ? ORDER BY package_id, snapshot_window`,
      )
      .all(this.#workspaceId)
      .map((row) => {
        const value = row as Record<string, unknown>;
        return {
          packageId: value.package_id as string,
          snapshotWindow: value.snapshot_window as MetricSnapshot['snapshotWindow'],
          publishedAt: value.published_at as string,
          views: value.views as number,
          likes: value.likes as number,
          collections: value.collections as number,
          comments: value.comments as number,
          newFollowers: value.new_followers as number,
          revision: value.revision as number,
          expectedRevision: value.revision as number,
        };
      });
  }

  public saveMetricSnapshots(snapshots: readonly MetricSnapshot[]): readonly MetricSnapshot[] {
    return runInTransaction(this.#database, () => {
      const unique = new Set<string>();
      for (const snapshot of snapshots) {
        const key = `${snapshot.packageId}:${snapshot.snapshotWindow}`;
        if (unique.has(key)) throw new V2MetricsError('INVALID_REQUEST', ['snapshots']);
        unique.add(key);
        const content = this.get(snapshot.packageId);
        if (content.status !== 'APPROVED')
          throw new V2MetricsError('PACKAGE_NOT_APPROVED', ['packageId']);
        const current = this.#database
          .prepare(
            `SELECT revision, published_at, views, likes, collections, comments, new_followers FROM v2_metric_snapshots
           WHERE workspace_id = ? AND package_id = ? AND snapshot_window = ?`,
          )
          .get(this.#workspaceId, snapshot.packageId, snapshot.snapshotWindow) as
          Record<string, unknown> | undefined;
        if (current === undefined) {
          if (snapshot.expectedRevision !== 0)
            throw new V2MetricsError('METRICS_CONFLICT', ['expectedRevision']);
          this.#database
            .prepare(
              `INSERT INTO v2_metric_snapshots(workspace_id,package_id,snapshot_window,published_at,views,likes,collections,comments,new_followers,revision,created_at,updated_at)
            VALUES (?,?,?,?,?,?,?,?,?,0,?,?)`,
            )
            .run(
              this.#workspaceId,
              snapshot.packageId,
              snapshot.snapshotWindow,
              snapshot.publishedAt,
              snapshot.views,
              snapshot.likes,
              snapshot.collections,
              snapshot.comments,
              snapshot.newFollowers,
              this.#timestamp(),
              this.#timestamp(),
            );
        } else {
          if (current.revision !== snapshot.expectedRevision)
            throw new V2MetricsError('METRICS_CONFLICT', ['expectedRevision']);
          const same = [
            'published_at',
            'views',
            'likes',
            'collections',
            'comments',
            'new_followers',
          ].every(
            (key) =>
              String(current[key]) ===
              String(
                (
                  {
                    published_at: snapshot.publishedAt,
                    views: snapshot.views,
                    likes: snapshot.likes,
                    collections: snapshot.collections,
                    comments: snapshot.comments,
                    new_followers: snapshot.newFollowers,
                  } as Record<string, unknown>
                )[key],
              ),
          );
          if (!same)
            this.#database
              .prepare(
                `UPDATE v2_metric_snapshots SET published_at=?,views=?,likes=?,collections=?,comments=?,new_followers=?,revision=revision+1,updated_at=? WHERE workspace_id=? AND package_id=? AND snapshot_window=? AND revision=?`,
              )
              .run(
                snapshot.publishedAt,
                snapshot.views,
                snapshot.likes,
                snapshot.collections,
                snapshot.comments,
                snapshot.newFollowers,
                this.#timestamp(),
                this.#workspaceId,
                snapshot.packageId,
                snapshot.snapshotWindow,
                snapshot.expectedRevision,
              );
        }
      }
      return this.listMetricSnapshots();
    });
  }

  public decision(id: string, status: 'ACCEPTED' | 'REJECTED', expectedRevision: number): void {
    const row = this.#database
      .prepare(
        `SELECT revision FROM v2_strategy_decisions WHERE workspace_id = ? AND recommendation_id = ?`,
      )
      .get(this.#workspaceId, id) as { readonly revision: number } | undefined;
    if (row === undefined || row.revision !== expectedRevision)
      throw new V2MetricsError('METRICS_CONFLICT', ['expectedRevision']);
    this.#database
      .prepare(
        `UPDATE v2_strategy_decisions SET status = ?, revision = revision + 1, updated_at = ?
       WHERE workspace_id = ? AND recommendation_id = ? AND revision = ?`,
      )
      .run(status, this.#timestamp(), this.#workspaceId, id, expectedRevision);
  }

  public syncStrategyRecommendations(
    items: readonly { readonly fingerprint: string; readonly id: string }[],
  ): ReadonlyMap<
    string,
    { readonly revision: number; readonly status: 'ACCEPTED' | 'PENDING' | 'REJECTED' | 'STALE' }
  > {
    return runInTransaction(this.#database, () => {
      const timestamp = this.#timestamp();
      for (const item of items) {
        const row = this.#database
          .prepare(
            `SELECT fingerprint FROM v2_strategy_decisions WHERE workspace_id = ? AND recommendation_id = ?`,
          )
          .get(this.#workspaceId, item.id) as { readonly fingerprint: string } | undefined;
        if (row === undefined)
          this.#database
            .prepare(
              `INSERT INTO v2_strategy_decisions(workspace_id,recommendation_id,fingerprint,status,revision,created_at,updated_at) VALUES (?,?,?,'PENDING',0,?,?)`,
            )
            .run(this.#workspaceId, item.id, item.fingerprint, timestamp, timestamp);
        else if (row.fingerprint !== item.fingerprint)
          this.#database
            .prepare(
              `UPDATE v2_strategy_decisions SET fingerprint = ?, status = 'STALE', revision = revision + 1, updated_at = ? WHERE workspace_id = ? AND recommendation_id = ?`,
            )
            .run(item.fingerprint, timestamp, this.#workspaceId, item.id);
      }
      const rows = this.#database
        .prepare(
          `SELECT recommendation_id, revision, status FROM v2_strategy_decisions WHERE workspace_id = ?`,
        )
        .all(this.#workspaceId) as unknown as readonly {
        readonly recommendation_id: string;
        readonly revision: number;
        readonly status: 'ACCEPTED' | 'PENDING' | 'REJECTED' | 'STALE';
      }[];
      return new Map(
        rows.map((row) => [row.recommendation_id, { revision: row.revision, status: row.status }]),
      );
    });
  }

  public createInteraction(record: InteractionRecord): InteractionRecord {
    if (record.status !== 'NEW' || record.revision !== 0 || record.currentSuggestion !== null)
      throw new V2InteractionError('INVALID_REQUEST');
    const timestamp = this.#timestamp();
    this.#database
      .prepare(
        `INSERT INTO v2_interaction_items(
           workspace_id, item_id, kind, source, related_content_package_id,
           user_text_path, user_text_sha256, user_text_size_bytes, dedup_key,
           current_suggestion_version, status, revision, deleted_at, created_at, updated_at
         ) VALUES (?, ?, ?, 'USER_PASTE', ?, ?, ?, ?, ?, NULL, 'NEW', 0, NULL, ?, ?)`,
      )
      .run(
        this.#workspaceId,
        record.itemId,
        record.kind,
        record.relatedContentPackageId,
        parseManagedRelativePath(record.userText.managedPath, 'IMPORT'),
        record.userText.sha256,
        record.userText.sizeBytes,
        record.dedupKey,
        timestamp,
        timestamp,
      );
    return this.getInteraction(record.itemId);
  }

  public appendSuggestion(
    expected: InteractionRecord,
    files: InteractionBlobRef,
    provenance = { modelRunId: null, providerKind: 'SCRIPTED' as const },
  ): InteractionRecord {
    return runInTransaction(this.#database, () => {
      const current = this.getInteraction(expected.itemId);
      if (
        current.revision !== expected.revision ||
        current.currentSuggestion?.versionId !== expected.currentSuggestion?.versionId ||
        !['NEW', 'SUGGESTED', 'CONFIRMED'].includes(current.status)
      )
        throw new V2InteractionError('REVISION_CONFLICT', ['interaction']);
      const version = (current.currentSuggestion?.version ?? 0) + 1;
      const versionId = `${current.itemId}-v${version}`;
      const timestamp = this.#timestamp();
      this.#database
        .prepare(
          `INSERT INTO v2_reply_suggestion_versions(
             workspace_id, item_id, version, version_id, provider_kind, model_run_id,
             reply_path, reply_sha256, reply_size_bytes, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          this.#workspaceId,
          current.itemId,
          version,
          versionId,
          provenance.providerKind,
          provenance.modelRunId,
          parseManagedRelativePath(files.managedPath, 'IMPORT'),
          files.sha256,
          files.sizeBytes,
          timestamp,
        );
      const result = this.#database
        .prepare(
          `UPDATE v2_interaction_items
           SET current_suggestion_version = ?, status = 'SUGGESTED',
               revision = revision + 1, updated_at = ?
           WHERE workspace_id = ? AND item_id = ? AND revision = ? AND status <> 'MANUAL_SENT'`,
        )
        .run(version, timestamp, this.#workspaceId, current.itemId, current.revision);
      if (result.changes !== 1) throw new V2InteractionError('REVISION_CONFLICT', ['interaction']);
      return this.getInteraction(current.itemId);
    });
  }

  public batchConfirm(items: readonly InteractionVersionRef[]): readonly InteractionRecord[] {
    return runInTransaction(this.#database, () => {
      const current = items.map((item) => {
        const record = this.getInteraction(item.itemId);
        if (
          record.revision !== item.expectedRevision ||
          record.currentSuggestion?.versionId !== item.expectedVersionId
        )
          throw new V2InteractionError('REVISION_CONFLICT', ['items']);
        if (!['SUGGESTED', 'CONFIRMED'].includes(record.status))
          throw new V2InteractionError('INTERACTION_STATE_INVALID', ['items']);
        return record;
      });
      const timestamp = this.#timestamp();
      for (const record of current) {
        if (record.status === 'CONFIRMED') continue;
        const result = this.#database
          .prepare(
            `UPDATE v2_interaction_items
             SET status = 'CONFIRMED', revision = revision + 1, updated_at = ?
             WHERE workspace_id = ? AND item_id = ? AND revision = ? AND status = 'SUGGESTED'`,
          )
          .run(timestamp, this.#workspaceId, record.itemId, record.revision);
        if (result.changes !== 1) throw new V2InteractionError('REVISION_CONFLICT', ['items']);
      }
      return current.map(({ itemId }) => this.getInteraction(itemId));
    });
  }

  public transitionInteraction(
    itemId: string,
    expectedRevision: number,
    expectedVersionId: string | null,
    allowed: readonly InteractionStatus[],
    next: InteractionStatus,
  ): InteractionRecord {
    return runInTransaction(this.#database, () => {
      const current = this.getInteraction(itemId);
      if (current.revision !== expectedRevision)
        throw new V2InteractionError('REVISION_CONFLICT', ['interaction']);
      if (
        !allowed.includes(current.status) ||
        (expectedVersionId !== null &&
          current.currentSuggestion?.versionId !== expectedVersionId) ||
        next === 'DELETED'
      )
        throw new V2InteractionError('INTERACTION_STATE_INVALID', ['interaction']);
      const result = this.#database
        .prepare(
          `UPDATE v2_interaction_items
           SET status = ?, revision = revision + 1, updated_at = ?
           WHERE workspace_id = ? AND item_id = ? AND revision = ?`,
        )
        .run(next, this.#timestamp(), this.#workspaceId, itemId, expectedRevision);
      if (result.changes !== 1) throw new V2InteractionError('REVISION_CONFLICT', ['interaction']);
      return this.getInteraction(itemId);
    });
  }

  public previewDeleteInteraction(itemId: string): InteractionDeletePreview {
    this.getInteraction(itemId);
    const count = this.#database
      .prepare(
        `SELECT count(*) AS count FROM v2_reply_suggestion_versions
         WHERE workspace_id = ? AND item_id = ?`,
      )
      .get(this.#workspaceId, itemId) as { readonly count: number };
    return {
      itemId,
      physicalDeletion: false,
      retainedManagedReferenceCount: count.count + 1,
      tombstone: true,
    };
  }

  public tombstoneInteraction(itemId: string, expectedRevision: number): void {
    const timestamp = this.#timestamp();
    const result = this.#database
      .prepare(
        `UPDATE v2_interaction_items
         SET status = 'DELETED', deleted_at = ?, revision = revision + 1, updated_at = ?
         WHERE workspace_id = ? AND item_id = ? AND revision = ? AND status <> 'DELETED'`,
      )
      .run(timestamp, timestamp, this.#workspaceId, itemId, expectedRevision);
    if (result.changes !== 1) throw new V2InteractionError('REVISION_CONFLICT', ['interaction']);
  }

  public summary(): {
    readonly personaRevision: number;
    readonly planRevision: number;
    readonly v2TableCount: number;
  } {
    const tableRow = this.#database
      .prepare(
        `SELECT count(*) AS count FROM sqlite_schema
         WHERE type = 'table' AND name LIKE 'v2\\_%' ESCAPE '\\'`,
      )
      .get() as { readonly count: number };
    return {
      personaRevision: this.#requiredPersona().revision,
      planRevision: this.#requiredPlan('2026-W31').revision,
      v2TableCount: tableRow.count,
    };
  }

  #readPersona(): AccountPersona | null {
    const row = this.#database
      .prepare(
        `SELECT persona_name, persona_audience, persona_tone, persona_boundary,
                schema_version, revision
         FROM v2_workspaces WHERE workspace_id = ?`,
      )
      .get(this.#workspaceId) as PersonaRow | undefined;
    return row === undefined ? null : decodePersona(row);
  }

  #requiredPersona(): AccountPersona {
    const persona = this.#readPersona();
    if (persona === null) throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    return persona;
  }

  #readPlan(requestedWeekKey: string): WeeklyPlan | null {
    const row = this.#database
      .prepare(
        `SELECT week_key, plan_status, candidates_json, schema_version, revision
         FROM v2_weekly_plan_snapshots WHERE workspace_id = ? AND week_key = ?`,
      )
      .get(this.#workspaceId, requestedWeekKey) as PlanRow | undefined;
    return row === undefined ? null : decodePlan(row);
  }

  #requiredPlan(requestedWeekKey: string): WeeklyPlan {
    const plan = this.#readPlan(requestedWeekKey);
    if (plan === null) throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    return plan;
  }

  #timestamp(): string {
    const timestamp = this.#now().toISOString();
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(timestamp)) {
      throw new V2ContractError('PERSISTENCE_UNAVAILABLE');
    }
    return timestamp;
  }

  #contentSelect(where: string): string {
    return `SELECT
      package.package_id, package.week_key, package.candidate_id, package.plan_revision,
      package.revision,
      version.version, version.version_id, version.status, version.cover_key,
      version.files_json, version.copy_model_run_id, version.created_at,
      version.generated_cover_path, version.generated_cover_mime,
      version.generated_cover_sha256, version.generated_cover_width,
      version.generated_cover_height, version.cover_model_run_id
      , copy_run.model_id AS copy_model_id, cover_run.model_id AS cover_model_id
      , copy_run.cost_state AS copy_cost_state, cover_run.cost_state AS cover_cost_state
      FROM v2_content_packages AS package
      JOIN v2_content_package_versions AS version
        ON version.workspace_id = package.workspace_id
       AND version.package_id = package.package_id
       AND version.version = package.current_version
      LEFT JOIN model_runs AS copy_run ON copy_run.id = version.copy_model_run_id
      LEFT JOIN model_runs AS cover_run ON cover_run.id = version.cover_model_run_id
      ${where}
      ORDER BY package.package_id`;
  }

  #interactionSelect(where: string): string {
    return `SELECT item.item_id, item.kind, item.source, item.related_content_package_id,
      item.user_text_path, item.user_text_sha256, item.user_text_size_bytes, item.dedup_key,
      item.current_suggestion_version, item.status, item.revision,
      suggestion.version_id, suggestion.reply_path, suggestion.reply_sha256,
      suggestion.reply_size_bytes, suggestion.provider_kind, suggestion.model_run_id
      FROM v2_interaction_items AS item
      LEFT JOIN v2_reply_suggestion_versions AS suggestion
        ON suggestion.workspace_id = item.workspace_id
       AND suggestion.item_id = item.item_id
       AND suggestion.version = item.current_suggestion_version
      ${where}`;
  }

  #insertVersion(record: ContentVersionRecord, createdAt: string): void {
    this.#database
      .prepare(
        `INSERT INTO v2_content_package_versions(
           workspace_id, package_id, version, version_id, status, cover_key,
           files_json, approved_at, created_at, copy_model_run_id,
           generated_cover_path, generated_cover_mime, generated_cover_sha256,
           generated_cover_width, generated_cover_height, cover_model_run_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.#workspaceId,
        record.packageId,
        record.version,
        record.versionId,
        record.status,
        record.coverKey,
        encodeFiles(record.files),
        createdAt,
        record.copyModelRunId ?? null,
        record.generatedCover?.managedPath ?? null,
        record.generatedCover?.mimeType ?? null,
        record.generatedCover?.sha256 ?? null,
        record.generatedCover?.width ?? null,
        record.generatedCover?.height ?? null,
        record.generatedCover?.modelRunId ?? null,
      );
  }
}
