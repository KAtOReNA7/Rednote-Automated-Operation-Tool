import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import type {
  CapabilityProbeObservation,
  CapabilityProbePlan,
  ProbeCapability,
  ProbeConfidence,
  ProbeModelSlot,
  ProbeProtocolMode,
  ProbeReasonCode,
  ProbeRunStatus,
  ProbeSource,
  ProbeState,
} from '@mystery-operations/providers';

import { runInTransaction } from './transaction.js';

export interface ProviderCapabilityEntryRecord {
  readonly capability: ProbeCapability;
  readonly confidence: ProbeConfidence;
  readonly maxContextTokens: number | null;
  readonly modelId: string | null;
  readonly modelSlot: ProbeModelSlot;
  readonly observedAt: string | null;
  readonly protocolMode: ProbeProtocolMode;
  readonly rateLimitRequests: number | null;
  readonly rateLimitTokens: number | null;
  readonly reasonCode: ProbeReasonCode;
  readonly safeDetails: Readonly<Record<string, number>>;
  readonly source: ProbeSource;
  readonly stale: boolean;
  readonly state: ProbeState;
}

export interface ProviderCapabilityRunHistoryRecord {
  readonly completedAt: string | null;
  readonly plannedRequestCount: number;
  readonly profile: CapabilityProbePlan['profile'];
  readonly reasonCode: ProbeReasonCode | null;
  readonly runId: string;
  readonly sentRequestCount: number;
  readonly startedAt: string;
  readonly status: ProbeRunStatus;
}

export interface ProviderCapabilityStateRecord {
  readonly derivedState:
    'CANCELLED' | 'FAILED' | 'INTERRUPTED' | 'NOT_PROBED' | 'PARTIAL' | 'PROBE_COMPLETE' | 'STALE';
  readonly entries: readonly ProviderCapabilityEntryRecord[];
  readonly history: readonly ProviderCapabilityRunHistoryRecord[];
  readonly runId: string | null;
}

interface EntryRow {
  readonly capability: ProbeCapability;
  readonly confidence: ProbeConfidence;
  readonly max_context_tokens: number | null;
  readonly model_id: string | null;
  readonly model_slot: ProbeModelSlot;
  readonly observed_at: string | null;
  readonly protocol_mode: ProbeProtocolMode;
  readonly rate_limit_requests: number | null;
  readonly rate_limit_tokens: number | null;
  readonly reason_code: ProbeReasonCode;
  readonly safe_details_json: string;
  readonly source: ProbeSource;
  readonly stale: number;
  readonly state: ProbeState;
}

interface RunRow {
  readonly completed_at: string | null;
  readonly planned_request_count: number;
  readonly profile: CapabilityProbePlan['profile'];
  readonly reason_code: ProbeReasonCode | null;
  readonly run_id: string;
  readonly sent_request_count: number;
  readonly started_at: string;
  readonly status: ProbeRunStatus;
}

function entryId(
  runId: string,
  slot: ProbeModelSlot,
  mode: ProbeProtocolMode,
  capability: ProbeCapability,
): string {
  return `cap-${createHash('sha256')
    .update(`${runId}\n${slot}\n${mode}\n${capability}`, 'utf8')
    .digest('hex')}`;
}

function safeDetails(value: string): Readonly<Record<string, number>> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return Object.freeze(
      Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, number] =>
            typeof entry[1] === 'number' && Number.isSafeInteger(entry[1]) && entry[1] >= 0,
        ),
      ),
    );
  } catch {
    return {};
  }
}

export class SqliteProviderCapabilityRepository {
  readonly #database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.#database = database;
  }

  public getCredentialBindingVersion(): number {
    const row = this.#database
      .prepare(
        `SELECT credential_binding_version AS version
         FROM app_settings
         WHERE id = 'app'`,
      )
      .get() as { readonly version: number } | undefined;
    if (row === undefined || !Number.isSafeInteger(row.version) || row.version < 0) {
      throw new Error('Credential binding version is unavailable.');
    }
    return row.version;
  }

  public recoverInterrupted(completedAt: string): number {
    const result = this.#database
      .prepare(
        `UPDATE provider_capability_probe_runs
         SET status = 'INTERRUPTED', reason_code = 'INTERNAL_ERROR',
             completed_at = ?, revision = revision + 1
         WHERE status = 'RUNNING'`,
      )
      .run(completedAt);
    return Number(result.changes);
  }

  public createRun(runId: string, plan: CapabilityProbePlan, startedAt: string): void {
    this.#database
      .prepare(
        `INSERT INTO provider_capability_probe_runs(
           id, config_fingerprint, settings_revision, credential_binding_version,
           contract_version, profile, plan_hash, planned_request_count,
           sent_request_count, status, reason_code, started_at, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'RUNNING', NULL, ?, NULL)`,
      )
      .run(
        runId,
        plan.configFingerprint,
        plan.settingsRevision,
        plan.credentialBindingVersion,
        plan.contractVersion,
        plan.profile,
        plan.hash,
        plan.requestCount,
        startedAt,
      );
  }

  public recordObservation(
    runId: string,
    plan: CapabilityProbePlan,
    observation: CapabilityProbeObservation,
    createdAt: string,
  ): void {
    const insert = this.#database.prepare(
      `INSERT INTO provider_capability_entries(
         id, run_id, config_fingerprint, settings_revision,
         credential_binding_version, contract_version, model_slot, model_id,
         protocol_mode, capability, state, reason_code, source, confidence,
         stale, safe_details_json, max_context_tokens, rate_limit_requests,
         rate_limit_tokens, observed_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(run_id, model_slot, protocol_mode, capability) DO UPDATE SET
         state = CASE
           WHEN provider_capability_entries.state = 'SUPPORTED' THEN 'SUPPORTED'
           WHEN excluded.state = 'SUPPORTED' THEN 'SUPPORTED'
           WHEN provider_capability_entries.state = 'UNSUPPORTED' THEN 'UNSUPPORTED'
           ELSE excluded.state
         END,
         reason_code = CASE
           WHEN provider_capability_entries.state IN ('SUPPORTED', 'UNSUPPORTED')
             THEN provider_capability_entries.reason_code
           ELSE excluded.reason_code
         END,
         source = CASE
           WHEN provider_capability_entries.state IN ('SUPPORTED', 'UNSUPPORTED')
             THEN provider_capability_entries.source
           ELSE excluded.source
         END,
         confidence = CASE
           WHEN provider_capability_entries.state IN ('SUPPORTED', 'UNSUPPORTED')
             THEN provider_capability_entries.confidence
           ELSE excluded.confidence
         END,
         safe_details_json = CASE
           WHEN provider_capability_entries.state IN ('SUPPORTED', 'UNSUPPORTED')
             THEN provider_capability_entries.safe_details_json
           ELSE excluded.safe_details_json
         END,
         max_context_tokens = COALESCE(
           provider_capability_entries.max_context_tokens,
           excluded.max_context_tokens
         ),
         rate_limit_requests = COALESCE(
           provider_capability_entries.rate_limit_requests,
           excluded.rate_limit_requests
         ),
         rate_limit_tokens = COALESCE(
           provider_capability_entries.rate_limit_tokens,
           excluded.rate_limit_tokens
         ),
         observed_at = COALESCE(provider_capability_entries.observed_at, excluded.observed_at)`,
    );
    runInTransaction(this.#database, () => {
      for (const slot of observation.modelSlots) {
        insert.run(
          entryId(runId, slot, observation.protocolMode, observation.capability),
          runId,
          plan.configFingerprint,
          plan.settingsRevision,
          plan.credentialBindingVersion,
          plan.contractVersion,
          slot,
          observation.modelId,
          observation.protocolMode,
          observation.capability,
          observation.state,
          observation.reasonCode,
          observation.source,
          observation.confidence,
          JSON.stringify(observation.safeDetails),
          observation.maxContextTokens,
          observation.rateLimitRequests,
          observation.rateLimitTokens,
          observation.observedAt,
          createdAt,
        );
      }
    });
  }

  public finishRun(
    runId: string,
    input: {
      readonly completedAt: string;
      readonly reasonCode: ProbeReasonCode | null;
      readonly sentRequestCount: number;
      readonly status: Exclude<ProbeRunStatus, 'RUNNING'>;
    },
  ): void {
    const result = this.#database
      .prepare(
        `UPDATE provider_capability_probe_runs
         SET sent_request_count = ?, status = ?, reason_code = ?,
             completed_at = ?, revision = revision + 1
         WHERE id = ? AND status = 'RUNNING'`,
      )
      .run(input.sentRequestCount, input.status, input.reasonCode, input.completedAt, runId);
    if (Number(result.changes) !== 1) {
      throw new Error('Capability probe run cannot be finalized from its current state.');
    }
  }

  public getState(
    configFingerprint: string,
    credentialBindingVersion: number,
  ): ProviderCapabilityStateRecord {
    this.#database
      .prepare(
        `UPDATE provider_capability_entries
         SET stale = CASE
           WHEN config_fingerprint = ? AND credential_binding_version = ? THEN 0
           ELSE 1
         END
         WHERE stale <> CASE
           WHEN config_fingerprint = ? AND credential_binding_version = ? THEN 0
           ELSE 1
         END`,
      )
      .run(
        configFingerprint,
        credentialBindingVersion,
        configFingerprint,
        credentialBindingVersion,
      );
    const latestTerminal = this.#database
      .prepare(
        `SELECT id AS run_id, config_fingerprint, credential_binding_version, status
         FROM provider_capability_probe_runs
         WHERE status <> 'RUNNING'
         ORDER BY started_at DESC, id DESC
         LIMIT 1`,
      )
      .get() as
      | {
          readonly config_fingerprint: string;
          readonly credential_binding_version: number;
          readonly run_id: string;
          readonly status: ProbeRunStatus;
        }
      | undefined;
    const entries =
      latestTerminal === undefined
        ? []
        : (this.#database
            .prepare(
              `SELECT model_slot, model_id, protocol_mode, capability, state, reason_code,
                      source, confidence, stale, safe_details_json,
                      max_context_tokens, rate_limit_requests, rate_limit_tokens,
                      observed_at
               FROM provider_capability_entries
               WHERE run_id = ?
               ORDER BY model_slot, protocol_mode, capability`,
            )
            .all(latestTerminal.run_id) as unknown as readonly EntryRow[]);
    const history = this.#database
      .prepare(
        `SELECT id AS run_id, profile, planned_request_count, sent_request_count,
                status, reason_code, started_at, completed_at
         FROM provider_capability_probe_runs
         ORDER BY started_at DESC, id DESC
         LIMIT 10`,
      )
      .all() as unknown as readonly RunRow[];

    const terminalIsCurrent =
      latestTerminal !== undefined &&
      latestTerminal.config_fingerprint === configFingerprint &&
      latestTerminal.credential_binding_version === credentialBindingVersion;
    const derivedState: ProviderCapabilityStateRecord['derivedState'] =
      latestTerminal === undefined
        ? 'NOT_PROBED'
        : !terminalIsCurrent
          ? 'STALE'
          : latestTerminal.status === 'SUCCEEDED'
            ? 'PROBE_COMPLETE'
            : latestTerminal.status === 'PARTIAL'
              ? 'PARTIAL'
              : latestTerminal.status === 'FAILED'
                ? 'FAILED'
                : latestTerminal.status === 'CANCELLED'
                  ? 'CANCELLED'
                  : latestTerminal.status === 'INTERRUPTED'
                    ? 'INTERRUPTED'
                    : 'NOT_PROBED';
    return {
      derivedState,
      entries: entries.map((row) => ({
        capability: row.capability,
        confidence: row.confidence,
        maxContextTokens: row.max_context_tokens,
        modelId: row.model_id,
        modelSlot: row.model_slot,
        observedAt: row.observed_at,
        protocolMode: row.protocol_mode,
        rateLimitRequests: row.rate_limit_requests,
        rateLimitTokens: row.rate_limit_tokens,
        reasonCode: row.reason_code,
        safeDetails: safeDetails(row.safe_details_json),
        source: row.source,
        stale: row.stale === 1,
        state: row.state,
      })),
      history: history.map((row) => ({
        completedAt: row.completed_at,
        plannedRequestCount: row.planned_request_count,
        profile: row.profile,
        reasonCode: row.reason_code,
        runId: row.run_id,
        sentRequestCount: row.sent_request_count,
        startedAt: row.started_at,
        status: row.status,
      })),
      runId: latestTerminal?.run_id ?? null,
    };
  }
}
