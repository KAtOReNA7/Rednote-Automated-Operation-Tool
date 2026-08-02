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
  type NewContentVersionRecord,
  type V2ContentRepositoryPort,
  type V2RepositoryPort,
  type WeeklyPlan,
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
  return {
    candidateId: row.candidate_id,
    coverKey: row.cover_key as ContentCoverKey,
    files: decodeFiles(row.files_json),
    packageId: row.package_id,
    planRevision: row.plan_revision,
    revision: row.revision,
    status: row.status as ContentPackageStatus,
    version: row.version,
    versionId: row.version_id,
    weekKey: row.week_key,
  };
}

export class SqliteV2Repository implements V2ContentRepositoryPort, V2RepositoryPort {
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
    if (records.length !== 3 || new Set(records.map(({ packageId }) => packageId)).size !== 3) {
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
          files,
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
      version.files_json
      FROM v2_content_packages AS package
      JOIN v2_content_package_versions AS version
        ON version.workspace_id = package.workspace_id
       AND version.package_id = package.package_id
       AND version.version = package.current_version
      ${where}
      ORDER BY package.package_id`;
  }

  #insertVersion(record: ContentVersionRecord, createdAt: string): void {
    this.#database
      .prepare(
        `INSERT INTO v2_content_package_versions(
           workspace_id, package_id, version, version_id, status, cover_key,
           files_json, approved_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
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
      );
  }
}
