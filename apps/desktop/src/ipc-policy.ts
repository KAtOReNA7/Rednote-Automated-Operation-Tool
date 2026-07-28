import type { DesktopResult } from '@mystery-operations/shared';

import { isTrustedRendererUrl } from './security-policy.js';

export type DesktopIpcOperation =
  | 'buildDiagnosticPreview'
  | 'cancelProviderCapabilityProbe'
  | 'clearCredential'
  | 'confirmDataRootSelection'
  | 'exportDiagnosticReport'
  | 'getAppInfo'
  | 'getCredentialStatus'
  | 'getFoundationHealth'
  | 'getProviderCapabilityProbeProgress'
  | 'getProviderCapabilityState'
  | 'getLocalApiStatus'
  | 'getRuntimeCapabilities'
  | 'getSettings'
  | 'getSetupState'
  | 'getWindowState'
  | 'listLocalApiClients'
  | 'cancelLocalApiPairing'
  | 'revokeLocalApiClient'
  | 'selectDataRoot'
  | 'setCredential'
  | 'previewProviderCapabilityProbe'
  | 'startProviderCapabilityProbe'
  | 'startLocalApiPairing'
  | 'updateLocalApiSettings'
  | 'updateNonSecretSettings';

const MAX_IPC_BYTES = 32 * 1024;
const MAX_IPC_DEPTH = 6;
const SECRET_LIKE_KEY = /api.?key|authorization|ciphertext|credential|password|secret|token/iu;
const CAPABILITIES = new Set([
  'batch',
  'imageGeneration',
  'streaming',
  'structuredJson',
  'text',
  'toolCalling',
  'usage',
  'vision',
  'webSearch',
]);

function invalid(message = '请求内容无效。'): DesktopResult<never> {
  return {
    error: {
      code: 'INVALID_REQUEST',
      message,
      retryable: false,
    },
    ok: false,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\n') === [...keys].sort().join('\n');
}

function withinDepth(value: unknown, depth = 0): boolean {
  if (depth > MAX_IPC_DEPTH) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.every((entry) => withinDepth(entry, depth + 1));
  }
  if (isRecord(value)) {
    return Object.values(value).every((entry) => withinDepth(entry, depth + 1));
  }
  return true;
}

function noSecretLikeKeys(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.every(noSecretLikeKeys);
  }
  if (!isRecord(value)) {
    return true;
  }
  return Object.entries(value).every(
    ([key, child]) => !SECRET_LIKE_KEY.test(key) && noSecretLikeKeys(child),
  );
}

function optionalString(value: unknown): boolean {
  return value === null || (typeof value === 'string' && value.length <= 2_048);
}

function validateOneObject(
  args: readonly unknown[],
  keys: readonly string[],
): Readonly<Record<string, unknown>> | null {
  if (args.length !== 1 || !isRecord(args[0]) || !exactKeys(args[0], keys)) {
    return null;
  }
  return args[0];
}

function validArguments(operation: DesktopIpcOperation, args: readonly unknown[]): boolean {
  switch (operation) {
    case 'getAppInfo':
    case 'getFoundationHealth':
    case 'getRuntimeCapabilities':
    case 'getSettings':
    case 'getProviderCapabilityState':
    case 'getSetupState':
    case 'getWindowState':
    case 'getLocalApiStatus':
    case 'listLocalApiClients':
    case 'selectDataRoot':
    case 'startLocalApiPairing':
    case 'buildDiagnosticPreview':
      return args.length === 0;
    case 'previewProviderCapabilityProbe': {
      const value = validateOneObject(args, [
        'includeToolCalling',
        'profile',
        'selectedCapabilities',
      ]);
      if (
        value === null ||
        typeof value.includeToolCalling !== 'boolean' ||
        !['CORE', 'FULL', 'CUSTOM'].includes(String(value.profile)) ||
        !Array.isArray(value.selectedCapabilities) ||
        value.selectedCapabilities.length > CAPABILITIES.size ||
        !value.selectedCapabilities.every(
          (capability) => typeof capability === 'string' && CAPABILITIES.has(capability),
        ) ||
        new Set(value.selectedCapabilities).size !== value.selectedCapabilities.length
      ) {
        return false;
      }
      return value.profile !== 'CUSTOM' || value.selectedCapabilities.length > 0;
    }
    case 'startProviderCapabilityProbe': {
      const value = validateOneObject(args, [
        'confirmation',
        'credentialBindingVersion',
        'planHash',
        'settingsRevision',
        'startToken',
      ]);
      return (
        value?.confirmation === 'START_PROVIDER_CAPABILITY_PROBE' &&
        typeof value.startToken === 'string' &&
        /^[A-Za-z0-9_-]{32,128}$/u.test(value.startToken) &&
        typeof value.planHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.planHash) &&
        typeof value.settingsRevision === 'number' &&
        Number.isSafeInteger(value.settingsRevision) &&
        value.settingsRevision >= 0 &&
        typeof value.credentialBindingVersion === 'number' &&
        Number.isSafeInteger(value.credentialBindingVersion) &&
        value.credentialBindingVersion >= 0
      );
    }
    case 'getProviderCapabilityProbeProgress': {
      const value = validateOneObject(args, ['runId']);
      return typeof value?.runId === 'string' && /^probe-[A-Za-z0-9-]{8,128}$/u.test(value.runId);
    }
    case 'cancelProviderCapabilityProbe': {
      const value = validateOneObject(args, ['confirmation', 'runId']);
      return (
        value?.confirmation === 'CANCEL_PROVIDER_CAPABILITY_PROBE' &&
        typeof value.runId === 'string' &&
        /^probe-[A-Za-z0-9-]{8,128}$/u.test(value.runId)
      );
    }
    case 'cancelLocalApiPairing': {
      const value = validateOneObject(args, ['pairingSessionId']);
      return (
        typeof value?.pairingSessionId === 'string' &&
        /^[a-zA-Z0-9-]{8,128}$/u.test(value.pairingSessionId)
      );
    }
    case 'revokeLocalApiClient': {
      const value = validateOneObject(args, ['clientId', 'confirmation', 'expectedRevision']);
      return (
        typeof value?.clientId === 'string' &&
        /^[a-zA-Z0-9-]{8,128}$/u.test(value.clientId) &&
        value.confirmation === 'REVOKE_LOCAL_API_CLIENT' &&
        typeof value.expectedRevision === 'number' &&
        Number.isSafeInteger(value.expectedRevision) &&
        value.expectedRevision >= 0
      );
    }
    case 'updateLocalApiSettings': {
      const value = validateOneObject(args, ['enabled', 'expectedRevision', 'port']);
      return (
        typeof value?.enabled === 'boolean' &&
        typeof value.expectedRevision === 'number' &&
        Number.isSafeInteger(value.expectedRevision) &&
        value.expectedRevision >= 0 &&
        typeof value.port === 'number' &&
        Number.isSafeInteger(value.port) &&
        value.port >= 1_024 &&
        value.port <= 65_535
      );
    }
    case 'getCredentialStatus': {
      const value = validateOneObject(args, ['slot']);
      return value?.slot === 'CONTENT_AI_API_KEY';
    }
    case 'setCredential': {
      const value = validateOneObject(args, ['plaintext', 'slot']);
      return (
        value?.slot === 'CONTENT_AI_API_KEY' &&
        typeof value.plaintext === 'string' &&
        value.plaintext.length > 0 &&
        Buffer.byteLength(value.plaintext, 'utf8') <= 16 * 1024 &&
        !value.plaintext.includes('\u0000') &&
        !value.plaintext.includes('\r') &&
        !value.plaintext.includes('\n')
      );
    }
    case 'clearCredential': {
      const value = validateOneObject(args, ['confirmation', 'slot']);
      return (
        value?.slot === 'CONTENT_AI_API_KEY' && value.confirmation === 'DELETE_CONTENT_AI_API_KEY'
      );
    }
    case 'confirmDataRootSelection': {
      const value = validateOneObject(args, ['confirmation', 'expectedRevision', 'mode', 'token']);
      return (
        value?.confirmation === 'ACTIVATE_DATA_ROOT' &&
        (value.mode === 'CREATE_OR_OPEN' || value.mode === 'OPEN_EXISTING') &&
        typeof value.token === 'string' &&
        /^[a-zA-Z0-9-]{8,128}$/u.test(value.token) &&
        (value.expectedRevision === null ||
          (typeof value.expectedRevision === 'number' &&
            Number.isSafeInteger(value.expectedRevision) &&
            value.expectedRevision >= 0))
      );
    }
    case 'exportDiagnosticReport': {
      const value = validateOneObject(args, ['expectedPreviewHash']);
      return (
        typeof value?.expectedPreviewHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.expectedPreviewHash)
      );
    }
    case 'updateNonSecretSettings': {
      const value = validateOneObject(args, [
        'account',
        'budget',
        'expectedRevision',
        'models',
        'providerBaseUrl',
      ]);
      if (
        value === null ||
        !noSecretLikeKeys(value) ||
        !isRecord(value.account) ||
        !exactKeys(value.account, ['bio', 'workingName']) ||
        typeof value.account.bio !== 'string' ||
        typeof value.account.workingName !== 'string' ||
        !isRecord(value.budget) ||
        !exactKeys(value.budget, ['hardLimitDollars', 'warningDollars']) ||
        typeof value.budget.hardLimitDollars !== 'string' ||
        typeof value.budget.warningDollars !== 'string' ||
        !isRecord(value.models) ||
        !exactKeys(value.models, ['embedding', 'image', 'research', 'review', 'writing']) ||
        !optionalString(value.models.embedding) ||
        !optionalString(value.models.image) ||
        !optionalString(value.models.research) ||
        !optionalString(value.models.review) ||
        !optionalString(value.models.writing) ||
        !optionalString(value.providerBaseUrl) ||
        typeof value.expectedRevision !== 'number' ||
        !Number.isSafeInteger(value.expectedRevision) ||
        value.expectedRevision < 0
      ) {
        return false;
      }
      return true;
    }
  }
}

export function validateDesktopIpcRequest(
  senderUrl: string,
  args: readonly unknown[],
  expectedRendererUrl: string,
  operation: DesktopIpcOperation = 'getAppInfo',
): DesktopResult<never> | null {
  if (!isTrustedRendererUrl(senderUrl, expectedRendererUrl)) {
    return invalid('请求来源未获授权。');
  }
  try {
    if (
      Buffer.byteLength(JSON.stringify(args), 'utf8') > MAX_IPC_BYTES ||
      !withinDepth(args) ||
      !validArguments(operation, args)
    ) {
      return invalid();
    }
  } catch {
    return invalid();
  }
  return null;
}
