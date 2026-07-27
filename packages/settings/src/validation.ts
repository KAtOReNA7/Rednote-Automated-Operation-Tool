import {
  type AccountStrategy,
  type AppSettings,
  type ContentScope,
  type NonSecretSettingsDraft,
  type PersistSettingsInput,
  PROVIDER_PROTOCOL,
  SETTINGS_SINGLETON_ID,
  type SetupState,
  SettingsError,
  type ToneConfig,
} from './contracts.js';

export const DEFAULT_TONE_CONFIG: ToneConfig = Object.freeze({
  humor: '少量冷幽默',
  schemaVersion: 1,
  sentenceStyle: '短句直接',
  voice: '观点鲜明',
});

export const DEFAULT_CONTENT_SCOPE: ContentScope = Object.freeze({
  excluded: Object.freeze(['偶像', '音乐', '演唱会', '泛娱乐', '粉圈'] as const),
  focus: '推理小说',
  schemaVersion: 1,
});

export const DEFAULT_ACCOUNT_STRATEGY: AccountStrategy = Object.freeze({
  bio: '',
  contentScope: DEFAULT_CONTENT_SCOPE,
  occupationDisclosure: 'DEFERRED',
  ownership: 'PERSONAL',
  tone: DEFAULT_TONE_CONFIG,
  workingName: '未命名账号',
});

const MAX_PROVIDER_URL_LENGTH = 2_048;
const MAX_MODEL_ID_LENGTH = 200;
const MAX_PROFILE_TEXT_LENGTH = 500;

function invalidObject(value: unknown, keys: readonly string[]): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return true;
  }
  const actual = Object.keys(value).sort();
  return (
    actual.length !== keys.length || actual.some((key, index) => key !== [...keys].sort()[index])
  );
}

export function assertExactObject(
  value: unknown,
  keys: readonly string[],
): asserts value is object {
  if (invalidObject(value, keys)) {
    throw new SettingsError('SETTINGS_INVALID');
  }
}

export function normalizeProviderBaseUrl(value: string | null): string | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const candidate = value.trim();
  if (
    candidate.length > MAX_PROVIDER_URL_LENGTH ||
    hasControlCharacters(candidate) ||
    /\s/u.test(candidate)
  ) {
    throw new SettingsError('PROVIDER_URL_INVALID');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch (error) {
    throw new SettingsError('PROVIDER_URL_INVALID', { cause: error });
  }
  if (
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
  ) {
    throw new SettingsError('PROVIDER_URL_INVALID');
  }
  const hostname = parsed.hostname.toLowerCase();
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  if (parsed.protocol === 'http:' && !loopback) {
    throw new SettingsError('PROVIDER_URL_INVALID');
  }
  parsed.protocol = parsed.protocol.toLowerCase();
  parsed.hostname = hostname;
  const pathname = parsed.pathname.replace(/\/+$/u, '');
  return `${parsed.protocol}//${parsed.host}${pathname === '' ? '' : pathname}`;
}

export function normalizeModelId(value: string | null): string | null {
  if (value === null || value.trim() === '') {
    return null;
  }
  const candidate = value.trim();
  if (candidate.length > MAX_MODEL_ID_LENGTH || hasControlCharacters(candidate)) {
    throw new SettingsError('MODEL_ID_INVALID');
  }
  return candidate;
}

export function parseDollarsToCents(value: string, allowZero: boolean): number {
  if (!/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/u.test(value)) {
    throw new SettingsError('BUDGET_INVALID');
  }
  const [whole = '', fraction = ''] = value.split('.');
  const cents =
    Number.parseInt(whole, 10) * 100 + Number.parseInt(fraction.padEnd(2, '0') || '0', 10);
  if (!Number.isSafeInteger(cents) || (!allowZero && cents <= 0) || cents < 0) {
    throw new SettingsError('BUDGET_INVALID');
  }
  return cents;
}

function normalizeProfileText(value: string, allowEmpty: boolean): string {
  const normalized = value.trim();
  if (
    normalized.length > MAX_PROFILE_TEXT_LENGTH ||
    hasControlCharacters(normalized) ||
    (!allowEmpty && normalized.length === 0)
  ) {
    throw new SettingsError('ACCOUNT_STRATEGY_INVALID');
  }
  return normalized;
}

export function validateAccountStrategy(
  value: Pick<AccountStrategy, 'bio' | 'workingName'>,
): AccountStrategy {
  return {
    bio: normalizeProfileText(value.bio, true),
    contentScope: DEFAULT_CONTENT_SCOPE,
    occupationDisclosure: 'DEFERRED',
    ownership: 'PERSONAL',
    tone: DEFAULT_TONE_CONFIG,
    workingName: normalizeProfileText(value.workingName, false),
  };
}

export function determineSetupState(
  values: {
    readonly credentialReference: string | null;
    readonly providerBaseUrl: string | null;
    readonly researchModelId: string | null;
    readonly reviewModelId: string | null;
    readonly writingModelId: string | null;
  },
  credentialStatus: string,
): SetupState {
  if (credentialStatus === 'REAUTH_REQUIRED' || credentialStatus === 'CORRUPT') {
    return 'CREDENTIAL_REAUTH_REQUIRED';
  }
  const providerComplete =
    values.providerBaseUrl !== null &&
    values.researchModelId !== null &&
    values.reviewModelId !== null &&
    values.writingModelId !== null;
  if (!providerComplete) {
    return 'PROVIDER_CONFIG_INCOMPLETE';
  }
  return values.credentialReference === null
    ? 'PROVIDER_CONFIG_INCOMPLETE'
    : 'PROVIDER_CONFIGURED_UNVERIFIED';
}

export function validateNonSecretDraft(
  input: NonSecretSettingsDraft,
  credentialStatus: string,
  credentialReference: AppSettings['credentialReference'],
  now: string,
): PersistSettingsInput {
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) {
    throw new SettingsError('SETTINGS_INVALID');
  }
  const providerBaseUrl = normalizeProviderBaseUrl(input.providerBaseUrl);
  const researchModelId = normalizeModelId(input.models.research);
  const writingModelId = normalizeModelId(input.models.writing);
  const reviewModelId = normalizeModelId(input.models.review);
  const embeddingModelId = normalizeModelId(input.models.embedding);
  const imageModelId = normalizeModelId(input.models.image);
  const monthlyWarningCents = parseDollarsToCents(input.budget.warningDollars, true);
  const monthlyHardLimitCents = parseDollarsToCents(input.budget.hardLimitDollars, false);
  if (monthlyWarningCents >= monthlyHardLimitCents || monthlyHardLimitCents > 10_000) {
    throw new SettingsError('BUDGET_INVALID');
  }
  const account = validateAccountStrategy(input.account);
  const setupState = determineSetupState(
    {
      credentialReference,
      providerBaseUrl,
      researchModelId,
      reviewModelId,
      writingModelId,
    },
    credentialStatus,
  );
  return {
    account,
    credentialReference,
    embeddingModelId,
    expectedRevision: input.expectedRevision,
    imageModelId,
    monthlyHardLimitCents,
    monthlyWarningCents,
    providerBaseUrl,
    researchModelId,
    reviewModelId,
    setupState,
    updatedAt: now,
    writingModelId,
  };
}

export function createDefaultSettings(now: string): AppSettings {
  return {
    credentialReference: null,
    embeddingModelId: null,
    imageModelId: null,
    monthlyHardLimitCents: 10_000,
    monthlyWarningCents: 8_000,
    providerBaseUrl: null,
    providerProtocol: PROVIDER_PROTOCOL,
    researchModelId: null,
    reviewModelId: null,
    revision: 0,
    setupState: 'LOCAL_PROJECT_READY',
    updatedAt: now,
    writingModelId: null,
  };
}

export function settingsSingletonId(): typeof SETTINGS_SINGLETON_ID {
  return SETTINGS_SINGLETON_ID;
}
function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}
