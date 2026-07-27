export const LOCAL_API_VERSION = '1' as const;
export const LOCAL_API_HOST = '127.0.0.1' as const;
export const LOCAL_API_DEFAULT_PORT = 43_119 as const;
export const LOCAL_API_MIN_PORT = 1_024 as const;
export const LOCAL_API_MAX_PORT = 65_535 as const;
export const LOCAL_API_MAX_JSON_BODY_BYTES = 8 * 1_024;
export const LOCAL_API_MAX_RESPONSE_BYTES = 16 * 1_024;
export const LOCAL_API_MAX_ACTIVE_CLIENTS = 8;

export const LOCAL_API_SERVICE_STATES = Object.freeze([
  'DISABLED',
  'DISABLED_NO_PROJECT',
  'STARTING',
  'RUNNING',
  'STOPPING',
  'PORT_IN_USE',
  'ERROR',
  'ERROR_RESTART_REQUIRED',
] as const);
export type LocalApiServiceState = (typeof LOCAL_API_SERVICE_STATES)[number];

export const LOCAL_API_ERROR_CODES = Object.freeze([
  'LOCAL_API_DISABLED',
  'LOCAL_API_NO_PROJECT',
  'LOCAL_API_PORT_IN_USE',
  'LOCAL_API_BIND_FAILED',
  'LOCAL_API_INVALID_HOST',
  'LOCAL_API_INVALID_ORIGIN',
  'LOCAL_API_CORS_REJECTED',
  'LOCAL_API_AUTH_REQUIRED',
  'LOCAL_API_AUTH_INVALID',
  'LOCAL_API_CLIENT_REVOKED',
  'LOCAL_API_PAIRING_NOT_ACTIVE',
  'LOCAL_API_PAIRING_EXPIRED',
  'LOCAL_API_PAIRING_INVALID',
  'LOCAL_API_PAIRING_ATTEMPTS_EXCEEDED',
  'LOCAL_API_CLIENT_LIMIT_REACHED',
  'LOCAL_API_RATE_LIMITED',
  'LOCAL_API_BODY_TOO_LARGE',
  'LOCAL_API_INVALID_JSON',
  'LOCAL_API_INVALID_REQUEST',
  'LOCAL_API_METHOD_NOT_ALLOWED',
  'LOCAL_API_NOT_FOUND',
  'LOCAL_API_SHUTTING_DOWN',
  'LOCAL_API_INTERNAL_ERROR',
  'LOCAL_API_REVISION_CONFLICT',
] as const);
export type LocalApiErrorCode = (typeof LOCAL_API_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<LocalApiErrorCode, string>> = Object.freeze({
  LOCAL_API_AUTH_INVALID: '本地插件认证失败。',
  LOCAL_API_AUTH_REQUIRED: '需要本地插件认证。',
  LOCAL_API_BIND_FAILED: '本地插件服务无法启动。',
  LOCAL_API_BODY_TOO_LARGE: '请求内容超过限制。',
  LOCAL_API_CLIENT_LIMIT_REACHED: '本地插件客户端数量已达上限。',
  LOCAL_API_CLIENT_REVOKED: '本地插件客户端已撤销。',
  LOCAL_API_CORS_REJECTED: '跨源请求未获授权。',
  LOCAL_API_DISABLED: '本地插件连接尚未启用。',
  LOCAL_API_INTERNAL_ERROR: '本地插件服务暂时不可用。',
  LOCAL_API_INVALID_HOST: '请求主机无效。',
  LOCAL_API_INVALID_JSON: 'JSON 请求内容无效。',
  LOCAL_API_INVALID_ORIGIN: '插件来源无效。',
  LOCAL_API_INVALID_REQUEST: '请求内容无效。',
  LOCAL_API_METHOD_NOT_ALLOWED: '请求方法不受支持。',
  LOCAL_API_NOT_FOUND: '本地 API 路由不存在。',
  LOCAL_API_NO_PROJECT: '尚未建立本地项目。',
  LOCAL_API_PAIRING_ATTEMPTS_EXCEEDED: '配对失败次数已达上限。',
  LOCAL_API_PAIRING_EXPIRED: '配对已过期。',
  LOCAL_API_PAIRING_INVALID: '配对信息无效。',
  LOCAL_API_PAIRING_NOT_ACTIVE: '当前没有可用配对。',
  LOCAL_API_PORT_IN_USE: '本地插件端口已被占用。',
  LOCAL_API_RATE_LIMITED: '请求过于频繁，请稍后重试。',
  LOCAL_API_REVISION_CONFLICT: '本地插件设置已更新，请刷新后重试。',
  LOCAL_API_SHUTTING_DOWN: '本地插件服务正在停止。',
});

export class LocalApiError extends Error {
  public readonly code: LocalApiErrorCode;
  public readonly context?: Readonly<Record<string, boolean | number | string>>;
  public readonly retryable: boolean;

  public constructor(
    code: LocalApiErrorCode,
    options: {
      readonly cause?: unknown;
      readonly context?: Readonly<Record<string, boolean | number | string>>;
      readonly retryable?: boolean;
    } = {},
  ) {
    super(ERROR_MESSAGES[code], { cause: options.cause });
    this.name = 'LocalApiError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.context !== undefined) {
      this.context = options.context;
    }
  }
}

export interface LocalApiSettings {
  readonly enabled: boolean;
  readonly port: number;
  readonly revision: number;
  readonly updatedAt: string;
}

export interface UpdateLocalApiSettingsInput {
  readonly enabled: boolean;
  readonly expectedRevision: number;
  readonly port: number;
  readonly updatedAt: string;
}

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

export interface LocalApiAuthClient {
  readonly extensionOrigin: string;
  readonly id: string;
  readonly lastUsedAt: string | null;
  readonly revision: number;
  readonly tokenDigest: Buffer;
}

export interface PairLocalApiClientInput {
  readonly clientLabel: string | null;
  readonly extensionOrigin: string;
  readonly id: string;
  readonly pairedAt: string;
  readonly tokenDigest: Buffer;
}

export interface LocalApiClientRepository {
  findActiveClientByOrigin(origin: string): LocalApiAuthClient | null;
  getSettings(): LocalApiSettings;
  listClients(): readonly LocalApiClientView[];
  pairClient(input: PairLocalApiClientInput): LocalApiClientView;
  recordLastUsed(clientId: string, usedAt: string, notAfter: string): void;
  revokeClient(clientId: string, expectedRevision: number, revokedAt: string): LocalApiClientView;
  updateSettings(input: UpdateLocalApiSettingsInput): LocalApiSettings;
}

export interface LocalApiClock {
  now(): Date;
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

export interface PairingExchangeInput {
  readonly clientLabel: string | null;
  readonly clientToken: string;
  readonly extensionOrigin: string;
  readonly pairingCode: string;
}

export interface PairingExchangeResponse {
  readonly apiVersion: typeof LOCAL_API_VERSION;
  readonly clientId: string;
  readonly createdAt: string;
  readonly paired: true;
}

export interface AuthenticatedStatusResponse {
  readonly apiVersion: typeof LOCAL_API_VERSION;
  readonly clientId: string;
  readonly clientStatus: 'ACTIVE';
  readonly projectReady: true;
  readonly serverTime: string;
  readonly serviceState: 'RUNNING';
}

export interface CapabilitiesResponse {
  readonly apiVersion: typeof LOCAL_API_VERSION;
  readonly authenticatedStatus: true;
  readonly clipperBusinessRoutes: false;
  readonly clipperIssue: '017';
  readonly maxJsonBodyBytes: typeof LOCAL_API_MAX_JSON_BODY_BYTES;
  readonly pairing: true;
  readonly supportedOriginScheme: 'chrome-extension';
}

export function assertLocalApiPort(port: number): number {
  if (!Number.isSafeInteger(port) || port < LOCAL_API_MIN_PORT || port > LOCAL_API_MAX_PORT) {
    throw new LocalApiError('LOCAL_API_INVALID_REQUEST');
  }
  return port;
}
