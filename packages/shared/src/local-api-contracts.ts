export type LocalApiErrorCode =
  | 'LOCAL_API_DISABLED'
  | 'LOCAL_API_NO_PROJECT'
  | 'LOCAL_API_PORT_IN_USE'
  | 'LOCAL_API_BIND_FAILED'
  | 'LOCAL_API_INVALID_HOST'
  | 'LOCAL_API_INVALID_ORIGIN'
  | 'LOCAL_API_CORS_REJECTED'
  | 'LOCAL_API_AUTH_REQUIRED'
  | 'LOCAL_API_AUTH_INVALID'
  | 'LOCAL_API_CLIENT_REVOKED'
  | 'LOCAL_API_PAIRING_NOT_ACTIVE'
  | 'LOCAL_API_PAIRING_EXPIRED'
  | 'LOCAL_API_PAIRING_INVALID'
  | 'LOCAL_API_PAIRING_ATTEMPTS_EXCEEDED'
  | 'LOCAL_API_CLIENT_LIMIT_REACHED'
  | 'LOCAL_API_RATE_LIMITED'
  | 'LOCAL_API_BODY_TOO_LARGE'
  | 'LOCAL_API_INVALID_JSON'
  | 'LOCAL_API_INVALID_REQUEST'
  | 'LOCAL_API_METHOD_NOT_ALLOWED'
  | 'LOCAL_API_NOT_FOUND'
  | 'LOCAL_API_SHUTTING_DOWN'
  | 'LOCAL_API_INTERNAL_ERROR'
  | 'LOCAL_API_REVISION_CONFLICT';

export type LocalApiServiceState =
  | 'DISABLED'
  | 'DISABLED_NO_PROJECT'
  | 'STARTING'
  | 'RUNNING'
  | 'STOPPING'
  | 'PORT_IN_USE'
  | 'ERROR'
  | 'ERROR_RESTART_REQUIRED';

export interface LocalApiClientView {
  readonly clientLabel: string | null;
  readonly createdAt: string;
  readonly extensionOrigin: string;
  readonly id: string;
  readonly lastUsedAt: string | null;
  readonly revision: number;
  readonly status: 'ACTIVE' | 'REVOKED';
  readonly updatedAt: string;
}

export interface PairingView {
  readonly endpoint: string;
  readonly expiresAt: string;
  readonly pairingCode: string;
  readonly pairingSessionId: string;
}

export interface LocalApiStatusView {
  readonly activeClientCount: number;
  readonly enabled: boolean;
  readonly endpoint: string | null;
  readonly errorCode?: LocalApiErrorCode;
  readonly port: number;
  readonly projectReady: boolean;
  readonly revision: number;
  readonly state: LocalApiServiceState;
}

export interface UpdateLocalApiSettingsRequest {
  readonly enabled: boolean;
  readonly expectedRevision: number;
  readonly port: number;
}

export interface CancelLocalApiPairingRequest {
  readonly pairingSessionId: string;
}

export interface RevokeLocalApiClientRequest {
  readonly clientId: string;
  readonly confirmation: 'REVOKE_LOCAL_API_CLIENT';
  readonly expectedRevision: number;
}
