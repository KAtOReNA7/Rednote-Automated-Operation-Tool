import type { DatabaseSync } from 'node:sqlite';

import {
  ACCOUNT_PROFILE_ID,
  type AccountStrategy,
  type AppSettings,
  CREDENTIAL_SLOT,
  type CredentialSlot,
  DEFAULT_ACCOUNT_STRATEGY,
  PROVIDER_PROTOCOL,
  type PersistSettingsInput,
  type SettingsRepository,
  SettingsError,
  type SetupState,
} from '@mystery-operations/settings';

import { runInTransaction } from './transaction.js';

interface SettingsRow {
  readonly credential_reference: string | null;
  readonly embedding_model_id: string | null;
  readonly image_model_id: string | null;
  readonly monthly_hard_limit_cents: number;
  readonly monthly_warning_cents: number;
  readonly provider_base_url: string | null;
  readonly provider_protocol: string;
  readonly research_model_id: string | null;
  readonly review_model_id: string | null;
  readonly revision: number;
  readonly setup_state: string;
  readonly updated_at: string;
  readonly writing_model_id: string | null;
}

interface AccountRow {
  readonly bio: string;
  readonly content_scope_json: string;
  readonly occupation_disclosure: string;
  readonly ownership: string;
  readonly tone_config_json: string;
  readonly working_name: string;
}

function parseJson<T>(value: string): T {
  try {
    return JSON.parse(value) as T;
  } catch (error) {
    throw new SettingsError('ACCOUNT_STRATEGY_INVALID', { cause: error });
  }
}

function mapSettings(row: SettingsRow | undefined): AppSettings {
  if (row === undefined) {
    throw new SettingsError('SETTINGS_NOT_FOUND');
  }
  if (
    row.provider_protocol !== PROVIDER_PROTOCOL ||
    (row.credential_reference !== null && row.credential_reference !== CREDENTIAL_SLOT)
  ) {
    throw new SettingsError('SETTINGS_INVALID');
  }
  return {
    credentialReference: row.credential_reference,
    embeddingModelId: row.embedding_model_id,
    imageModelId: row.image_model_id,
    monthlyHardLimitCents: row.monthly_hard_limit_cents,
    monthlyWarningCents: row.monthly_warning_cents,
    providerBaseUrl: row.provider_base_url,
    providerProtocol: PROVIDER_PROTOCOL,
    researchModelId: row.research_model_id,
    reviewModelId: row.review_model_id,
    revision: row.revision,
    setupState: row.setup_state as SetupState,
    updatedAt: row.updated_at,
    writingModelId: row.writing_model_id,
  };
}

function mapAccount(row: AccountRow | undefined): AccountStrategy {
  if (row === undefined) {
    return DEFAULT_ACCOUNT_STRATEGY;
  }
  if (row.ownership !== 'PERSONAL' || row.occupation_disclosure !== 'DEFERRED') {
    throw new SettingsError('ACCOUNT_STRATEGY_INVALID');
  }
  return {
    bio: row.bio,
    contentScope: parseJson(row.content_scope_json),
    occupationDisclosure: 'DEFERRED',
    ownership: 'PERSONAL',
    tone: parseJson(row.tone_config_json),
    workingName: row.working_name,
  };
}

export class SqliteSettingsRepository implements SettingsRepository {
  readonly #database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.#database = database;
  }

  public getBundle(): ReturnType<SettingsRepository['getBundle']> {
    const settings = mapSettings(
      this.#database
        .prepare(
          `SELECT provider_protocol, provider_base_url, credential_reference,
                  research_model_id, writing_model_id, review_model_id,
                  embedding_model_id, image_model_id, monthly_warning_cents,
                  monthly_hard_limit_cents, setup_state, revision, updated_at
           FROM app_settings WHERE id = 'app'`,
        )
        .get() as unknown as SettingsRow | undefined,
    );
    const account = mapAccount(
      this.#database
        .prepare(
          `SELECT working_name, bio, occupation_disclosure, ownership,
                  tone_config_json, content_scope_json
           FROM account_profiles WHERE id = ?`,
        )
        .get(ACCOUNT_PROFILE_ID) as unknown as AccountRow | undefined,
    );
    return { account, settings };
  }

  public update(input: PersistSettingsInput): ReturnType<SettingsRepository['update']> {
    runInTransaction(this.#database, () => {
      const result = this.#database
        .prepare(
          `UPDATE app_settings
           SET provider_base_url = ?, credential_reference = ?,
               research_model_id = ?, writing_model_id = ?, review_model_id = ?,
               embedding_model_id = ?, image_model_id = ?,
               monthly_warning_cents = ?, monthly_hard_limit_cents = ?,
               setup_state = ?, revision = revision + 1, updated_at = ?
           WHERE id = 'app' AND revision = ?`,
        )
        .run(
          input.providerBaseUrl,
          input.credentialReference,
          input.researchModelId,
          input.writingModelId,
          input.reviewModelId,
          input.embeddingModelId,
          input.imageModelId,
          input.monthlyWarningCents,
          input.monthlyHardLimitCents,
          input.setupState,
          input.updatedAt,
          input.expectedRevision,
        );
      if (Number(result.changes) !== 1) {
        throw new SettingsError('SETTINGS_REVISION_CONFLICT', { retryable: true });
      }
      this.#database
        .prepare(
          `INSERT INTO account_profiles(
             id, working_name, bio, occupation_disclosure, ownership,
             tone_config_json, content_scope_json, created_at, updated_at
           ) VALUES (?, ?, ?, 'DEFERRED', 'PERSONAL', ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             working_name = excluded.working_name, bio = excluded.bio,
             occupation_disclosure = 'DEFERRED', ownership = 'PERSONAL',
             tone_config_json = excluded.tone_config_json,
             content_scope_json = excluded.content_scope_json,
             updated_at = excluded.updated_at`,
        )
        .run(
          ACCOUNT_PROFILE_ID,
          input.account.workingName,
          input.account.bio,
          JSON.stringify(input.account.tone),
          JSON.stringify(input.account.contentScope),
          input.updatedAt,
          input.updatedAt,
        );
    });
    return this.getBundle();
  }

  public setCredentialReference(
    reference: CredentialSlot | null,
    expectedRevision: number,
    updatedAt: string,
  ): AppSettings {
    const result = this.#database
      .prepare(
        `UPDATE app_settings
         SET credential_reference = ?,
             credential_binding_version = credential_binding_version + 1,
             setup_state = CASE
               WHEN ? IS NOT NULL AND provider_base_url IS NOT NULL
                AND research_model_id IS NOT NULL AND writing_model_id IS NOT NULL
               THEN 'PROVIDER_CONFIGURED_UNVERIFIED'
               ELSE 'PROVIDER_CONFIG_INCOMPLETE'
             END,
             revision = revision + 1, updated_at = ?
         WHERE id = 'app' AND revision = ?`,
      )
      .run(reference, reference, updatedAt, expectedRevision);
    if (Number(result.changes) !== 1) {
      throw new SettingsError('SETTINGS_REVISION_CONFLICT', { retryable: true });
    }
    return this.getBundle().settings;
  }
}
