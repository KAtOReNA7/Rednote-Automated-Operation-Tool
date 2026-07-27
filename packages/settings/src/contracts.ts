export const CREDENTIAL_SLOT = 'CONTENT_AI_API_KEY' as const;
export type CredentialSlot = typeof CREDENTIAL_SLOT;

export const CREDENTIAL_STATUSES = Object.freeze([
  'NOT_CONFIGURED',
  'CONFIGURED',
  'UNAVAILABLE',
  'CORRUPT',
  'REAUTH_REQUIRED',
] as const);
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

export interface CredentialStatusView {
  readonly available: boolean;
  readonly requiresReauth: boolean;
  readonly status: CredentialStatus;
  readonly updatedAt?: string;
}

export const SETUP_STATES = Object.freeze([
  'NO_PROJECT',
  'LOCAL_PROJECT_READY',
  'PROVIDER_CONFIG_INCOMPLETE',
  'PROVIDER_CONFIGURED_UNVERIFIED',
  'CREDENTIAL_REAUTH_REQUIRED',
] as const);
export type SetupState = (typeof SETUP_STATES)[number];

export const SETTINGS_ERROR_CODES = Object.freeze([
  'SETUP_NOT_INITIALIZED',
  'SETTINGS_NOT_FOUND',
  'SETTINGS_INVALID',
  'SETTINGS_REVISION_CONFLICT',
  'PROVIDER_URL_INVALID',
  'MODEL_ID_INVALID',
  'BUDGET_INVALID',
  'ACCOUNT_STRATEGY_INVALID',
  'DATA_ROOT_SELECTION_EXPIRED',
  'DATA_ROOT_SELECTION_INVALID',
  'DATA_ROOT_SWITCH_CONFLICT',
  'PROJECT_LOCATOR_INVALID',
  'PROJECT_ROOT_MISSING',
  'PROJECT_INSTANCE_MISMATCH',
  'CREDENTIAL_NOT_CONFIGURED',
  'CREDENTIAL_STORE_UNAVAILABLE',
  'CREDENTIAL_ENCRYPT_FAILED',
  'CREDENTIAL_DECRYPT_FAILED',
  'CREDENTIAL_CORRUPT',
  'CREDENTIAL_REAUTH_REQUIRED',
  'DIAGNOSTIC_STALE',
  'DIAGNOSTIC_EXPORT_FAILED',
] as const);
export type SettingsErrorCode = (typeof SETTINGS_ERROR_CODES)[number];

const ERROR_MESSAGES: Readonly<Record<SettingsErrorCode, string>> = Object.freeze({
  ACCOUNT_STRATEGY_INVALID: '账号策略设置无效。',
  BUDGET_INVALID: '预算设置无效。',
  CREDENTIAL_CORRUPT: '本地凭据记录已损坏。',
  CREDENTIAL_DECRYPT_FAILED: '本地凭据无法解密。',
  CREDENTIAL_ENCRYPT_FAILED: '本地凭据无法安全保存。',
  CREDENTIAL_NOT_CONFIGURED: '本地凭据尚未配置。',
  CREDENTIAL_REAUTH_REQUIRED: '本地凭据需要重新输入。',
  CREDENTIAL_STORE_UNAVAILABLE: '系统凭据保护当前不可用。',
  DATA_ROOT_SELECTION_EXPIRED: '数据目录选择已过期，请重新选择。',
  DATA_ROOT_SELECTION_INVALID: '数据目录选择无效。',
  DATA_ROOT_SWITCH_CONFLICT: '数据目录已被其他操作更新。',
  DIAGNOSTIC_EXPORT_FAILED: '基础诊断报告导出失败。',
  DIAGNOSTIC_STALE: '诊断预览已过期，请重新生成。',
  MODEL_ID_INVALID: '模型 ID 设置无效。',
  PROJECT_INSTANCE_MISMATCH: '数据目录标记与本地记录不匹配。',
  PROJECT_LOCATOR_INVALID: '本地项目定位记录无效。',
  PROJECT_ROOT_MISSING: '已配置的数据目录不存在。',
  PROVIDER_URL_INVALID: '中转站 Base URL 无效。',
  SETTINGS_INVALID: '设置内容无效。',
  SETTINGS_NOT_FOUND: '本地设置尚未建立。',
  SETTINGS_REVISION_CONFLICT: '设置已在其他位置更新，请刷新后重试。',
  SETUP_NOT_INITIALIZED: '尚未选择本地数据目录。',
});

export class SettingsError extends Error {
  public readonly code: SettingsErrorCode;
  public readonly context?: Readonly<Record<string, boolean | number | string>>;
  public readonly retryable: boolean;

  public constructor(
    code: SettingsErrorCode,
    options: {
      readonly cause?: unknown;
      readonly context?: Readonly<Record<string, boolean | number | string>>;
      readonly retryable?: boolean;
    } = {},
  ) {
    super(ERROR_MESSAGES[code], { cause: options.cause });
    this.name = 'SettingsError';
    this.code = code;
    this.retryable = options.retryable ?? false;
    if (options.context !== undefined) {
      this.context = options.context;
    }
  }
}

export const PROVIDER_PROTOCOL = 'OPENAI_COMPATIBLE' as const;
export const PROVIDER_CAPABILITY = 'UNPROBED' as const;
export const SETTINGS_SINGLETON_ID = 'app' as const;
export const ACCOUNT_PROFILE_ID = 'primary' as const;

export interface AppSettings {
  readonly credentialReference: CredentialSlot | null;
  readonly embeddingModelId: string | null;
  readonly imageModelId: string | null;
  readonly monthlyHardLimitCents: number;
  readonly monthlyWarningCents: number;
  readonly providerBaseUrl: string | null;
  readonly providerProtocol: typeof PROVIDER_PROTOCOL;
  readonly researchModelId: string | null;
  readonly reviewModelId: string | null;
  readonly revision: number;
  readonly setupState: SetupState;
  readonly updatedAt: string;
  readonly writingModelId: string | null;
}

export interface ToneConfig {
  readonly humor: '少量冷幽默';
  readonly schemaVersion: 1;
  readonly sentenceStyle: '短句直接';
  readonly voice: '观点鲜明';
}

export interface ContentScope {
  readonly excluded: readonly ['偶像', '音乐', '演唱会', '泛娱乐', '粉圈'];
  readonly focus: '推理小说';
  readonly schemaVersion: 1;
}

export interface AccountStrategy {
  readonly bio: string;
  readonly contentScope: ContentScope;
  readonly occupationDisclosure: 'DEFERRED';
  readonly ownership: 'PERSONAL';
  readonly tone: ToneConfig;
  readonly workingName: string;
}

export interface SettingsBundle {
  readonly account: AccountStrategy;
  readonly credential: CredentialStatusView;
  readonly providerCapability: typeof PROVIDER_CAPABILITY;
  readonly settings: AppSettings;
}

export interface NonSecretSettingsDraft {
  readonly account: {
    readonly bio: string;
    readonly workingName: string;
  };
  readonly budget: {
    readonly hardLimitDollars: string;
    readonly warningDollars: string;
  };
  readonly expectedRevision: number;
  readonly models: {
    readonly embedding: string | null;
    readonly image: string | null;
    readonly research: string | null;
    readonly review: string | null;
    readonly writing: string | null;
  };
  readonly providerBaseUrl: string | null;
}

export interface PersistSettingsInput {
  readonly account: AccountStrategy;
  readonly credentialReference: CredentialSlot | null;
  readonly embeddingModelId: string | null;
  readonly expectedRevision: number;
  readonly imageModelId: string | null;
  readonly monthlyHardLimitCents: number;
  readonly monthlyWarningCents: number;
  readonly providerBaseUrl: string | null;
  readonly researchModelId: string | null;
  readonly reviewModelId: string | null;
  readonly setupState: SetupState;
  readonly updatedAt: string;
  readonly writingModelId: string | null;
}

export interface SettingsRepository {
  getBundle(): Omit<SettingsBundle, 'credential' | 'providerCapability'>;
  setCredentialReference(
    reference: CredentialSlot | null,
    expectedRevision: number,
    updatedAt: string,
  ): AppSettings;
  update(input: PersistSettingsInput): Omit<SettingsBundle, 'credential' | 'providerCapability'>;
}

export interface CredentialStore {
  clear(slot: CredentialSlot): Promise<CredentialStatusView>;
  getStatus(slot: CredentialSlot): Promise<CredentialStatusView>;
  resolveForProvider(slot: CredentialSlot): Promise<string>;
  set(slot: CredentialSlot, plaintext: string): Promise<CredentialStatusView>;
}

export interface SettingsClock {
  now(): Date;
}

export interface DiagnosticRuntime {
  readonly appVersion: string;
  readonly chromiumVersion: string;
  readonly dataRootFormatVersion: number;
  readonly databaseHealthy: boolean;
  readonly electronVersion: string;
  readonly localApiActiveClientCount: number;
  readonly localApiEnabled: boolean;
  readonly localApiPort: number;
  readonly localApiState: string;
  readonly localApiVersion: '1';
  readonly nodeVersion: string;
  readonly platformVersion: string;
  readonly queueHealthy: boolean;
  readonly safeStorageAvailable: boolean;
  readonly schemaVersion: number;
  readonly storageHealthy: boolean;
}

export interface DiagnosticPreview {
  readonly content: string;
  readonly hash: string;
}

export interface DiagnosticExport {
  readonly managedPath: string;
  readonly previewHash: string;
}

export interface DiagnosticReportStore {
  write(content: string, hash: string, createdAt: string): Promise<string>;
}

export interface ProjectLocatorRecord {
  readonly activeDataRoot: string;
  readonly format: 'rednote-project-locator';
  readonly projectInstanceId: string;
  readonly revision: number;
  readonly updatedAt: string;
  readonly version: 1;
}

export type ProjectLocatorState =
  | { readonly status: 'NOT_CONFIGURED' }
  | { readonly code: SettingsErrorCode; readonly status: 'RECOVERY_REQUIRED' }
  | {
      readonly displayPath: string;
      readonly record: ProjectLocatorRecord;
      readonly status: 'READY';
    };

export interface PreparedProjectRoot {
  readonly databasePath: string;
  readonly displayPath: string;
  readonly instanceId: string;
  readonly rootPath: string;
}

export interface ProjectLocatorStore {
  activate(
    root: PreparedProjectRoot,
    expectedRevision: number | null,
    updatedAt: string,
  ): Promise<ProjectLocatorRecord>;
  read(): Promise<ProjectLocatorState>;
}

export interface ProjectDataRootService {
  prepare(path: string, mode: 'CREATE_OR_OPEN' | 'OPEN_EXISTING'): Promise<PreparedProjectRoot>;
}
