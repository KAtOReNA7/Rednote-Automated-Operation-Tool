import type { DatabaseSync } from 'node:sqlite';

import {
  parseAccountPersona,
  parseWeeklyPlan,
  V2ContractError,
  V2_SCHEMA_VERSION,
  type AccountPersona,
  type AccountPersonaFields,
  type V2RepositoryPort,
  type WeeklyPlan,
} from '@mystery-operations/v2';

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

export class SqliteV2Repository implements V2RepositoryPort {
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
}
