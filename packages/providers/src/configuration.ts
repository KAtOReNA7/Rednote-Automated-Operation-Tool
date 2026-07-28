import { ProviderError } from './errors.js';

export const CONTENT_AI_CREDENTIAL_REFERENCE = 'CONTENT_AI_API_KEY' as const;
export const OPENAI_COMPATIBLE_PROTOCOL = 'OPENAI_COMPATIBLE' as const;

export interface ProviderSettingsSnapshot {
  readonly credentialReference: typeof CONTENT_AI_CREDENTIAL_REFERENCE | null;
  readonly embeddingModelId: string | null;
  readonly imageModelId: string | null;
  readonly providerBaseUrl: string | null;
  readonly providerProtocol: typeof OPENAI_COMPATIBLE_PROTOCOL;
  readonly researchModelId: string | null;
  readonly reviewModelId: string | null;
  readonly revision: number;
  readonly setupState: string;
  readonly writingModelId: string | null;
}

export interface ProviderSettingsReader {
  readProviderSettings(): ProviderSettingsSnapshot;
}

export interface ProviderModelRoles {
  readonly embedding: string | null;
  readonly image: string | null;
  readonly research: string | null;
  readonly review: string | null;
  readonly writing: string | null;
}

export interface ProviderRuntimeConfig {
  readonly baseUrl: string;
  readonly credentialReference: typeof CONTENT_AI_CREDENTIAL_REFERENCE;
  readonly modelIds: ProviderModelRoles;
  readonly providerId: string;
  readonly protocol: typeof OPENAI_COMPATIBLE_PROTOCOL;
  readonly revision: number;
  readonly verificationState: 'CONFIGURED_UNVERIFIED';
}

export interface CredentialResolver {
  resolve(reference: typeof CONTENT_AI_CREDENTIAL_REFERENCE): Promise<string>;
}

function invalidIdentifier(value: string): boolean {
  return (
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 200 ||
    Array.from(value).some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  );
}

function validateProviderId(providerId: string): void {
  if (providerId.trim() !== providerId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(providerId)) {
    throw new ProviderError('PROVIDER_INVALID_REQUEST', {
      causeCategory: 'VALIDATION',
      operation: 'CONFIGURATION',
      outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
      providerId: 'unavailable',
      requestId: 'configuration',
      retryDisposition: 'DO_NOT_RETRY',
    });
  }
}

function validateBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError('PROVIDER_NOT_CONFIGURED', {
      causeCategory: 'CONFIGURATION',
      operation: 'CONFIGURATION',
      outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
      providerId: 'unavailable',
      requestId: 'configuration',
      retryDisposition: 'DO_NOT_RETRY',
    });
  }
  const loopback =
    url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]';
  if (
    url.username !== '' ||
    url.password !== '' ||
    url.search !== '' ||
    url.hash !== '' ||
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback))
  ) {
    throw new ProviderError('PROVIDER_NOT_CONFIGURED', {
      causeCategory: 'CONFIGURATION',
      operation: 'CONFIGURATION',
      outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
      providerId: 'unavailable',
      requestId: 'configuration',
      retryDisposition: 'DO_NOT_RETRY',
    });
  }
  const path = url.pathname.replace(/\/+$/u, '');
  return `${url.protocol}//${url.host}${path}`;
}

function freezeConfig(config: ProviderRuntimeConfig): ProviderRuntimeConfig {
  Object.freeze(config.modelIds);
  return Object.freeze(config);
}

export class ProviderConfigLoader {
  readonly #reader: ProviderSettingsReader;

  public constructor(reader: ProviderSettingsReader) {
    this.#reader = reader;
  }

  public load(providerId: string): ProviderRuntimeConfig {
    validateProviderId(providerId);
    const settings = this.#reader.readProviderSettings();
    if (
      settings.providerProtocol !== OPENAI_COMPATIBLE_PROTOCOL ||
      settings.providerBaseUrl === null ||
      settings.credentialReference !== CONTENT_AI_CREDENTIAL_REFERENCE ||
      settings.setupState !== 'PROVIDER_CONFIGURED_UNVERIFIED' ||
      !Number.isSafeInteger(settings.revision) ||
      settings.revision < 0
    ) {
      throw new ProviderError('PROVIDER_NOT_CONFIGURED', {
        causeCategory: 'CONFIGURATION',
        operation: 'CONFIGURATION',
        outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
        providerId,
        requestId: 'configuration',
        retryDisposition: 'DO_NOT_RETRY',
      });
    }

    const models = [
      settings.researchModelId,
      settings.writingModelId,
      settings.reviewModelId,
      settings.embeddingModelId,
      settings.imageModelId,
    ];
    if (models.some((model) => model !== null && invalidIdentifier(model))) {
      throw new ProviderError('PROVIDER_MODEL_NOT_CONFIGURED', {
        causeCategory: 'CONFIGURATION',
        operation: 'CONFIGURATION',
        outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
        providerId,
        requestId: 'configuration',
        retryDisposition: 'DO_NOT_RETRY',
      });
    }

    return freezeConfig({
      baseUrl: validateBaseUrl(settings.providerBaseUrl),
      credentialReference: CONTENT_AI_CREDENTIAL_REFERENCE,
      modelIds: {
        embedding: settings.embeddingModelId,
        image: settings.imageModelId,
        research: settings.researchModelId,
        review: settings.reviewModelId,
        writing: settings.writingModelId,
      },
      providerId,
      protocol: OPENAI_COMPATIBLE_PROTOCOL,
      revision: settings.revision,
      verificationState: 'CONFIGURED_UNVERIFIED',
    });
  }
}

export function assertCurrentConfigRevision(
  config: ProviderRuntimeConfig,
  revision: number,
  identity: {
    readonly modelId: string;
    readonly operation: string;
    readonly requestId: string;
  },
): void {
  if (config.revision !== revision) {
    throw new ProviderError('PROVIDER_STALE_CONFIGURATION', {
      causeCategory: 'CONFIGURATION',
      details: { currentRevision: config.revision, requestedRevision: revision },
      modelId: identity.modelId,
      operation: identity.operation,
      outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
      providerId: config.providerId,
      requestId: identity.requestId,
      retryDisposition: 'DO_NOT_RETRY',
    });
  }
}

export function assertConfiguredModel(
  config: ProviderRuntimeConfig,
  modelId: string,
  identity: { readonly operation: string; readonly requestId: string },
): void {
  const configured = Object.values(config.modelIds).filter(
    (value): value is string => value !== null,
  );
  if (invalidIdentifier(modelId) || !configured.includes(modelId)) {
    throw new ProviderError('PROVIDER_MODEL_NOT_CONFIGURED', {
      causeCategory: 'CONFIGURATION',
      modelId: modelId === '' ? null : modelId,
      operation: identity.operation,
      outcomeCertainty: 'REJECTED_BEFORE_EXECUTION',
      providerId: config.providerId,
      requestId: identity.requestId,
      retryDisposition: 'DO_NOT_RETRY',
    });
  }
}
