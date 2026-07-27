import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  LOCAL_API_MAX_ACTIVE_CLIENTS,
  type LocalApiAuthClient,
  type LocalApiClientRepository,
  type LocalApiClientView,
  type LocalApiSettings,
  LocalApiError,
  normalizeExtensionOrigin,
  type PairLocalApiClientInput,
  type UpdateLocalApiSettingsInput,
} from '@mystery-operations/local-api';

import { runInTransaction } from './transaction.js';

interface SettingsRow {
  readonly enabled: number;
  readonly port: number;
  readonly revision: number;
  readonly updated_at: string;
}

interface ClientRow {
  readonly client_label: string | null;
  readonly created_at: string;
  readonly extension_origin: string;
  readonly id: string;
  readonly last_used_at: string | null;
  readonly revision: number;
  readonly revoked_at: string | null;
  readonly token_digest: Uint8Array;
  readonly updated_at: string;
}

function mapSettings(row: SettingsRow | undefined): LocalApiSettings {
  if (row === undefined) {
    throw new LocalApiError('LOCAL_API_INTERNAL_ERROR');
  }
  return {
    enabled: row.enabled === 1,
    port: row.port,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}

function mapClient(row: ClientRow): LocalApiClientView {
  return {
    clientLabel: row.client_label,
    createdAt: row.created_at,
    extensionOrigin: row.extension_origin,
    id: row.id,
    lastUsedAt: row.last_used_at,
    revision: row.revision,
    status: row.revoked_at === null ? 'ACTIVE' : 'REVOKED',
    updatedAt: row.updated_at,
  };
}

function mapAuthClient(row: ClientRow): LocalApiAuthClient {
  return {
    extensionOrigin: row.extension_origin,
    id: row.id,
    lastUsedAt: row.last_used_at,
    revision: row.revision,
    tokenDigest: Buffer.from(row.token_digest),
  };
}

export class SqliteLocalApiRepository implements LocalApiClientRepository {
  readonly #database: DatabaseSync;

  public constructor(database: DatabaseSync) {
    this.#database = database;
  }

  public getSettings(): LocalApiSettings {
    return mapSettings(
      this.#database
        .prepare(
          `SELECT enabled, port, revision, updated_at
           FROM local_api_settings WHERE id = 1`,
        )
        .get() as unknown as SettingsRow | undefined,
    );
  }

  public updateSettings(input: UpdateLocalApiSettingsInput): LocalApiSettings {
    const result = this.#database
      .prepare(
        `UPDATE local_api_settings
         SET enabled = ?, port = ?, revision = revision + 1, updated_at = ?
         WHERE id = 1 AND revision = ?`,
      )
      .run(input.enabled ? 1 : 0, input.port, input.updatedAt, input.expectedRevision);
    if (Number(result.changes) !== 1) {
      throw new LocalApiError('LOCAL_API_REVISION_CONFLICT', { retryable: true });
    }
    return this.getSettings();
  }

  public listClients(): readonly LocalApiClientView[] {
    const rows = this.#database
      .prepare(
        `SELECT id, extension_origin, client_label, token_digest, created_at,
                updated_at, last_used_at, revoked_at, revision
         FROM local_api_clients
         ORDER BY revoked_at IS NULL DESC, created_at DESC, id ASC`,
      )
      .all() as unknown as readonly ClientRow[];
    return rows.map(mapClient);
  }

  public findActiveClientByOrigin(origin: string): LocalApiAuthClient | null {
    const row = this.#database
      .prepare(
        `SELECT id, extension_origin, client_label, token_digest, created_at,
                updated_at, last_used_at, revoked_at, revision
         FROM local_api_clients
         WHERE extension_origin = ? AND revoked_at IS NULL`,
      )
      .get(normalizeExtensionOrigin(origin)) as unknown as ClientRow | undefined;
    return row === undefined ? null : mapAuthClient(row);
  }

  public pairClient(input: PairLocalApiClientInput): LocalApiClientView {
    return runInTransaction(this.#database, () => {
      const origin = normalizeExtensionOrigin(input.extensionOrigin);
      const activeForOrigin = this.#database
        .prepare(
          `SELECT id
           FROM local_api_clients
           WHERE extension_origin = ? AND revoked_at IS NULL`,
        )
        .get(origin) as { readonly id: string } | undefined;
      const activeCount = this.#database
        .prepare(`SELECT count(*) AS count FROM local_api_clients WHERE revoked_at IS NULL`)
        .get() as { readonly count: number };
      if (activeForOrigin === undefined && activeCount.count >= LOCAL_API_MAX_ACTIVE_CLIENTS) {
        throw new LocalApiError('LOCAL_API_CLIENT_LIMIT_REACHED');
      }
      if (activeForOrigin !== undefined) {
        this.#database
          .prepare(
            `UPDATE local_api_clients
             SET revoked_at = ?, updated_at = ?, revision = revision + 1
             WHERE id = ? AND revoked_at IS NULL`,
          )
          .run(input.pairedAt, input.pairedAt, activeForOrigin.id);
      }
      this.#database
        .prepare(
          `INSERT INTO local_api_clients(
             id, extension_origin, client_label, token_digest,
             created_at, updated_at, revision
           ) VALUES (?, ?, ?, ?, ?, ?, 0)`,
        )
        .run(
          input.id,
          origin,
          input.clientLabel,
          input.tokenDigest,
          input.pairedAt,
          input.pairedAt,
        );
      this.#writeAudit('LOCAL_API_CLIENT_PAIRED', input.id, input.pairedAt);
      const row = this.#loadClient(input.id);
      if (row === undefined) {
        throw new LocalApiError('LOCAL_API_INTERNAL_ERROR');
      }
      return mapClient(row);
    });
  }

  public revokeClient(
    clientId: string,
    expectedRevision: number,
    revokedAt: string,
  ): LocalApiClientView {
    return runInTransaction(this.#database, () => {
      const result = this.#database
        .prepare(
          `UPDATE local_api_clients
           SET revoked_at = ?, updated_at = ?, revision = revision + 1
           WHERE id = ? AND revision = ? AND revoked_at IS NULL`,
        )
        .run(revokedAt, revokedAt, clientId, expectedRevision);
      if (Number(result.changes) !== 1) {
        throw new LocalApiError('LOCAL_API_REVISION_CONFLICT', { retryable: true });
      }
      this.#writeAudit('LOCAL_API_CLIENT_REVOKED', clientId, revokedAt);
      const row = this.#loadClient(clientId);
      if (row === undefined) {
        throw new LocalApiError('LOCAL_API_INTERNAL_ERROR');
      }
      return mapClient(row);
    });
  }

  public recordLastUsed(clientId: string, usedAt: string, notAfter: string): void {
    this.#database
      .prepare(
        `UPDATE local_api_clients
         SET last_used_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND revoked_at IS NULL
           AND (last_used_at IS NULL OR last_used_at <= ?)`,
      )
      .run(usedAt, usedAt, clientId, notAfter);
  }

  #loadClient(clientId: string): ClientRow | undefined {
    return this.#database
      .prepare(
        `SELECT id, extension_origin, client_label, token_digest, created_at,
                updated_at, last_used_at, revoked_at, revision
         FROM local_api_clients WHERE id = ?`,
      )
      .get(clientId) as unknown as ClientRow | undefined;
  }

  #writeAudit(eventType: string, clientId: string, createdAt: string): void {
    this.#database
      .prepare(
        `INSERT INTO audit_events(
           id, event_type, entity_type, entity_id, actor, before_json, after_json, created_at
         ) VALUES (?, ?, 'local_api_client', ?, 'USER', NULL, ?, ?)`,
      )
      .run(
        `local-api-audit-${randomUUID()}`,
        eventType,
        clientId,
        JSON.stringify({ status: eventType.endsWith('REVOKED') ? 'REVOKED' : 'ACTIVE' }),
        createdAt,
      );
  }
}
