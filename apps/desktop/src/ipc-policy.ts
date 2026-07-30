import type { DesktopResult } from '@mystery-operations/shared';
import {
  assertBatchReadingStateDraft,
  assertExperienceAssertionDraft,
  assertReadingStateChangeDraft,
  assertScoreRecordDraft,
  assertSpoilerPreferenceDraft,
} from '@mystery-operations/authenticity';
import {
  assertTopicBatchStateChangeDraft,
  assertTopicStateChangeDraft,
  TOPIC_CANDIDATE_STATES,
  TOPIC_CONTENT_TYPES,
  TOPIC_ELIGIBILITY_STATES,
  TOPIC_LIMITS,
} from '@mystery-operations/topics';
import {
  EXPERIMENT_ACTIONS,
  EXPERIMENT_DESIGN_STATES,
  EXPERIMENT_LIMITS,
  validateExperimentDesign,
} from '@mystery-operations/experiments';
import {
  BRIEF_PROFILE_IDS,
  BRIEF_READINESS_STATUSES,
  BRIEF_LIMITS,
  assertContentBriefDraft,
} from '@mystery-operations/briefs';

import { isTrustedRendererUrl } from './security-policy.js';

export type DesktopIpcOperation =
  | 'buildDiagnosticPreview'
  | 'cancelCatalogDiscovery'
  | 'cancelDossierBuild'
  | 'cancelSourceProcessing'
  | 'cancelProviderCapabilityProbe'
  | 'clearCredential'
  | 'confirmModelCacheClear'
  | 'confirmCatalogDiscovery'
  | 'confirmAuthenticityAction'
  | 'confirmCatalogUndo'
  | 'confirmCatalogWorkMerge'
  | 'confirmCatalogWorkSplit'
  | 'confirmEvidenceConflict'
  | 'confirmDossierBuild'
  | 'confirmSourceProcessing'
  | 'confirmDataRootSelection'
  | 'confirmTopicAction'
  | 'confirmExperimentAction'
  | 'confirmBriefAction'
  | 'createModelPriceSchedule'
  | 'createModelUnitPolicy'
  | 'exportDiagnosticReport'
  | 'getAppInfo'
  | 'getCredentialStatus'
  | 'getFoundationHealth'
  | 'getFetchState'
  | 'getBrowserClip'
  | 'getCatalogState'
  | 'getCatalogWork'
  | 'getAuthenticityLibrary'
  | 'getAuthenticityWork'
  | 'getEvidenceState'
  | 'getDossier'
  | 'getModelAccounting'
  | 'getProviderCapabilityProbeProgress'
  | 'getProviderCapabilityState'
  | 'getLocalApiStatus'
  | 'getRuntimeCapabilities'
  | 'getSearchState'
  | 'getSettings'
  | 'getSetupState'
  | 'getTopic'
  | 'getTopicPool'
  | 'getExperiment'
  | 'getExperiments'
  | 'getBrief'
  | 'getBriefs'
  | 'getWindowState'
  | 'listLocalApiClients'
  | 'listBrowserClips'
  | 'listDossiers'
  | 'cancelLocalApiPairing'
  | 'revokeLocalApiClient'
  | 'selectDataRoot'
  | 'setCredential'
  | 'previewProviderCapabilityProbe'
  | 'previewCatalogDiscovery'
  | 'previewAuthenticityAction'
  | 'previewCatalogUndo'
  | 'previewCatalogWorkMerge'
  | 'previewCatalogWorkSplit'
  | 'previewEvidenceConflict'
  | 'previewDossierBuild'
  | 'previewSourceProcessing'
  | 'previewTopicAction'
  | 'previewExperimentAction'
  | 'previewBriefAction'
  | 'diffDossierVersions'
  | 'previewModelCacheClear'
  | 'startProviderCapabilityProbe'
  | 'startLocalApiPairing'
  | 'updateLocalApiSettings'
  | 'updateNonSecretSettings'
  | 'updateFetchPolicy'
  | 'updateSearchProviderConfig';

const MAX_IPC_BYTES = 32 * 1024;
const MAX_BRIEF_IPC_BYTES = 2 * 1024 * 1024;
const MAX_IPC_DEPTH = 8;
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

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
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

function catalogId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function catalogRevision(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function dossierIdentifier(value: unknown, maximum = 768): value is string {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length >= 1 &&
    Buffer.byteLength(value, 'utf8') <= maximum &&
    !containsControlCharacter(value)
  );
}

function catalogConfirmation(value: Readonly<Record<string, unknown>> | null): boolean {
  return (
    value?.confirmation === 'APPLY_CATALOG_DECISION' &&
    typeof value.previewHash === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.previewHash) &&
    typeof value.token === 'string' &&
    /^[A-Za-z0-9_-]{43}$/u.test(value.token)
  );
}

const AUTHENTICITY_ACTION_KINDS = new Set([
  'ASSERTION_CONFIRM',
  'ASSERTION_REVOKE',
  'BATCH_STATE_CHANGE',
  'SCORE_CHANGE',
  'SPOILER_CHANGE',
  'STATE_CHANGE',
  'STATE_UNDO',
]);

const TOPIC_ACTION_KINDS = new Set([
  'BATCH_STATE_CHANGE',
  'CANCEL_GENERATION',
  'GENERATE',
  'QUOTA_PLAN',
  'STATE_CHANGE',
  'STATE_UNDO',
]);
const TOPIC_CONTENT_TYPE_VALUES = new Set<unknown>(TOPIC_CONTENT_TYPES);
const TOPIC_ELIGIBILITY_VALUES = new Set<unknown>(TOPIC_ELIGIBILITY_STATES);
const TOPIC_STATE_VALUES = new Set<unknown>(TOPIC_CANDIDATE_STATES);
const EXPERIMENT_STATE_VALUES = new Set<unknown>(EXPERIMENT_DESIGN_STATES);
const EXPERIMENT_ACTION_VALUES = new Set<unknown>(
  EXPERIMENT_ACTIONS.filter((action) => action !== 'CLONE_VERSION'),
);
const BRIEF_PROFILE_VALUES = new Set<unknown>(BRIEF_PROFILE_IDS);
const BRIEF_READINESS_VALUES = new Set<unknown>(BRIEF_READINESS_STATUSES);

function validBriefPreview(value: Readonly<Record<string, unknown>>): boolean {
  try {
    switch (value.kind) {
      case 'CREATE_SCAFFOLD': {
        return (
          exactKeys(value, ['assignmentPlanId', 'kind', 'topicId']) &&
          dossierIdentifier(value.topicId, BRIEF_LIMITS.identifierBytes) &&
          (value.assignmentPlanId === null ||
            dossierIdentifier(value.assignmentPlanId, BRIEF_LIMITS.identifierBytes))
        );
      }
      case 'SAVE_EDIT':
        return (
          exactKeys(value, ['briefId', 'draft', 'expectedRevision', 'kind']) &&
          dossierIdentifier(value.briefId, BRIEF_LIMITS.identifierBytes) &&
          catalogRevision(value.expectedRevision) &&
          Boolean(assertContentBriefDraft(value.draft))
        );
      case 'LOCK_FIELD':
      case 'UNLOCK_FIELD':
        return (
          exactKeys(value, ['briefId', 'expectedRevision', 'fieldPath', 'kind']) &&
          dossierIdentifier(value.briefId, BRIEF_LIMITS.identifierBytes) &&
          catalogRevision(value.expectedRevision) &&
          dossierIdentifier(value.fieldPath, BRIEF_LIMITS.identifierBytes)
        );
      case 'CLONE':
      case 'UNDO':
        return (
          exactKeys(value, ['briefId', 'expectedRevision', 'kind', 'targetVersionId']) &&
          dossierIdentifier(value.briefId, BRIEF_LIMITS.identifierBytes) &&
          dossierIdentifier(value.targetVersionId, BRIEF_LIMITS.identifierBytes) &&
          catalogRevision(value.expectedRevision)
        );
      case 'ARCHIVE':
      case 'RESTORE':
      case 'PREVIEW_GENERATION':
        return (
          exactKeys(value, ['briefId', 'expectedRevision', 'kind']) &&
          dossierIdentifier(value.briefId, BRIEF_LIMITS.identifierBytes) &&
          catalogRevision(value.expectedRevision)
        );
      case 'CANCEL_GENERATION':
        return (
          exactKeys(value, ['expectedRevision', 'kind', 'runId']) &&
          dossierIdentifier(value.runId, BRIEF_LIMITS.identifierBytes) &&
          catalogRevision(value.expectedRevision)
        );
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function validAuthenticityDraft(value: Readonly<Record<string, unknown>>): boolean {
  try {
    switch (value.kind) {
      case 'STATE_CHANGE': {
        if (!exactKeys(value, ['draft', 'kind'])) return false;
        const draft = assertReadingStateChangeDraft(value.draft);
        return (
          catalogId(draft.profileId) &&
          catalogId(draft.subject.workId) &&
          (draft.subject.expressionId === null || catalogId(draft.subject.expressionId)) &&
          (draft.subject.editionId === null || catalogId(draft.subject.editionId))
        );
      }
      case 'STATE_UNDO':
        return (
          exactKeys(value, ['expectedRevision', 'kind', 'profileId', 'workId']) &&
          catalogId(value.profileId) &&
          catalogId(value.workId) &&
          catalogRevision(value.expectedRevision)
        );
      case 'ASSERTION_CONFIRM': {
        if (!exactKeys(value, ['draft', 'kind'])) return false;
        const draft = assertExperienceAssertionDraft(value.draft);
        return (
          catalogId(draft.profileId) &&
          catalogId(draft.workId) &&
          (draft.assertionId === null || catalogId(draft.assertionId))
        );
      }
      case 'ASSERTION_REVOKE':
        return (
          exactKeys(value, [
            'assertionId',
            'expectedAssertionRevision',
            'expectedReadingRevision',
            'kind',
            'profileId',
            'workId',
          ]) &&
          catalogId(value.assertionId) &&
          catalogId(value.profileId) &&
          catalogId(value.workId) &&
          catalogRevision(value.expectedAssertionRevision) &&
          catalogRevision(value.expectedReadingRevision)
        );
      case 'SCORE_CHANGE': {
        if (!exactKeys(value, ['draft', 'kind'])) return false;
        const draft = assertScoreRecordDraft(value.draft);
        return catalogId(draft.profileId) && catalogId(draft.workId);
      }
      case 'SPOILER_CHANGE': {
        if (!exactKeys(value, ['draft', 'kind'])) return false;
        const draft = assertSpoilerPreferenceDraft(value.draft);
        return catalogId(draft.profileId) && catalogId(draft.workId);
      }
      case 'BATCH_STATE_CHANGE': {
        if (!exactKeys(value, ['draft', 'kind'])) return false;
        const draft = assertBatchReadingStateDraft(value.draft);
        return catalogId(draft.profileId) && draft.items.every((item) => catalogId(item.workId));
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function validTopicPreview(value: Readonly<Record<string, unknown>>): boolean {
  try {
    switch (value.kind) {
      case 'GENERATE':
        return exactKeys(value, ['kind', 'profileId']) && catalogId(value.profileId);
      case 'STATE_CHANGE': {
        if (!exactKeys(value, ['draft', 'kind'])) return false;
        const draft = assertTopicStateChangeDraft(value.draft);
        return draft.action !== 'UNDO' && catalogId(draft.topicId);
      }
      case 'STATE_UNDO':
        return (
          exactKeys(value, ['expectedRevision', 'kind', 'topicId']) &&
          catalogId(value.topicId) &&
          catalogRevision(value.expectedRevision)
        );
      case 'BATCH_STATE_CHANGE': {
        if (!exactKeys(value, ['draft', 'kind'])) return false;
        const draft = assertTopicBatchStateChangeDraft(value.draft);
        return draft.items.every((item) => catalogId(item.topicId));
      }
      case 'QUOTA_PLAN':
        return (
          exactKeys(value, ['kind', 'maxWorkExposure', 'profileId']) &&
          catalogId(value.profileId) &&
          Number.isSafeInteger(value.maxWorkExposure) &&
          Number(value.maxWorkExposure) >= 1 &&
          Number(value.maxWorkExposure) <= TOPIC_LIMITS.maxWorkExposure
        );
      case 'CANCEL_GENERATION':
        return (
          exactKeys(value, ['expectedRevision', 'kind', 'runId']) &&
          catalogId(value.runId) &&
          catalogRevision(value.expectedRevision)
        );
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function validExperimentPreview(value: Readonly<Record<string, unknown>>): boolean {
  try {
    switch (value.kind) {
      case 'CREATE_DRAFT':
        return (
          exactKeys(value, ['design', 'kind', 'profileId']) &&
          catalogId(value.profileId) &&
          validateExperimentDesign(value.design).valid
        );
      case 'SAVE_ASSIGNMENT':
        return exactKeys(value, ['experimentId', 'kind']) && catalogId(value.experimentId);
      case 'STATE_ACTION':
        return (
          exactKeys(value, ['action', 'expectedRevision', 'experimentId', 'kind']) &&
          EXPERIMENT_ACTION_VALUES.has(value.action) &&
          catalogRevision(value.expectedRevision) &&
          catalogId(value.experimentId)
        );
      case 'CLONE_VERSION':
        return (
          exactKeys(value, ['design', 'expectedRevision', 'experimentId', 'kind']) &&
          catalogRevision(value.expectedRevision) &&
          catalogId(value.experimentId) &&
          validateExperimentDesign(value.design).valid
        );
      default:
        return false;
    }
  } catch {
    return false;
  }
}

function nullableDecimal(value: unknown): boolean {
  return (
    value === null ||
    (typeof value === 'string' &&
      value.length <= 48 &&
      /^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,12})?$/u.test(value))
  );
}

function boundedUnit(value: unknown, nullable = true): boolean {
  return (
    (nullable && value === null) ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= 1_000_000_000)
  );
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
    case 'getSearchState':
    case 'getFetchState':
    case 'listBrowserClips':
    case 'getProviderCapabilityState':
    case 'getModelAccounting':
    case 'getSetupState':
    case 'getWindowState':
    case 'getLocalApiStatus':
    case 'listLocalApiClients':
    case 'selectDataRoot':
    case 'startLocalApiPairing':
    case 'buildDiagnosticPreview':
    case 'previewModelCacheClear':
      return args.length === 0;
    case 'getCatalogState': {
      const value = validateOneObject(args, ['limit', 'offset', 'query']);
      return (
        value !== null &&
        Number.isSafeInteger(value.limit) &&
        Number(value.limit) >= 1 &&
        Number(value.limit) <= 100 &&
        Number.isSafeInteger(value.offset) &&
        Number(value.offset) >= 0 &&
        Number(value.offset) <= 1_000_000 &&
        typeof value.query === 'string' &&
        value.query.length <= 512 &&
        !containsControlCharacter(value.query)
      );
    }
    case 'getAuthenticityLibrary': {
      const value = validateOneObject(args, ['limit', 'offset', 'profileId', 'query']);
      return (
        value !== null &&
        catalogId(value.profileId) &&
        Number.isSafeInteger(value.limit) &&
        Number(value.limit) >= 1 &&
        Number(value.limit) <= 100 &&
        Number.isSafeInteger(value.offset) &&
        Number(value.offset) >= 0 &&
        Number(value.offset) <= 1_000_000 &&
        typeof value.query === 'string' &&
        Buffer.byteLength(value.query, 'utf8') <= 200 &&
        !containsControlCharacter(value.query)
      );
    }
    case 'getAuthenticityWork': {
      const value = validateOneObject(args, [
        'historyLimit',
        'historyOffset',
        'profileId',
        'workId',
      ]);
      return (
        value !== null &&
        catalogId(value.profileId) &&
        catalogId(value.workId) &&
        Number.isSafeInteger(value.historyLimit) &&
        Number(value.historyLimit) >= 1 &&
        Number(value.historyLimit) <= 100 &&
        Number.isSafeInteger(value.historyOffset) &&
        Number(value.historyOffset) >= 0 &&
        Number(value.historyOffset) <= 1_000_000
      );
    }
    case 'previewAuthenticityAction': {
      const value =
        args.length === 1 && isRecord(args[0])
          ? (args[0] as Readonly<Record<string, unknown>>)
          : null;
      return value !== null && validAuthenticityDraft(value);
    }
    case 'confirmAuthenticityAction': {
      const value = validateOneObject(args, ['confirmation', 'kind', 'previewHash', 'token']);
      return (
        value?.confirmation === 'APPLY_AUTHENTICITY_ACTION' &&
        AUTHENTICITY_ACTION_KINDS.has(String(value.kind)) &&
        typeof value.previewHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.previewHash) &&
        typeof value.token === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(value.token)
      );
    }
    case 'getTopicPool': {
      const value = validateOneObject(args, [
        'contentType',
        'eligibility',
        'limit',
        'offset',
        'profileId',
        'query',
        'state',
      ]);
      return (
        value !== null &&
        (value.contentType === null || TOPIC_CONTENT_TYPE_VALUES.has(value.contentType)) &&
        (value.eligibility === null || TOPIC_ELIGIBILITY_VALUES.has(value.eligibility)) &&
        Number.isSafeInteger(value.limit) &&
        Number(value.limit) >= 1 &&
        Number(value.limit) <= TOPIC_LIMITS.maxPageSize &&
        Number.isSafeInteger(value.offset) &&
        Number(value.offset) >= 0 &&
        Number(value.offset) <= TOPIC_LIMITS.maxPageOffset &&
        catalogId(value.profileId) &&
        typeof value.query === 'string' &&
        Buffer.byteLength(value.query, 'utf8') <= 200 &&
        !containsControlCharacter(value.query) &&
        (value.state === null || TOPIC_STATE_VALUES.has(value.state))
      );
    }
    case 'getTopic': {
      const value = validateOneObject(args, ['historyLimit', 'topicId']);
      return (
        value !== null &&
        catalogId(value.topicId) &&
        Number.isSafeInteger(value.historyLimit) &&
        Number(value.historyLimit) >= 1 &&
        Number(value.historyLimit) <= TOPIC_LIMITS.maxHistoryPageSize
      );
    }
    case 'getExperiments': {
      const value = validateOneObject(args, ['limit', 'offset', 'profileId', 'query', 'state']);
      return (
        value !== null &&
        catalogId(value.profileId) &&
        Number.isSafeInteger(value.limit) &&
        Number(value.limit) >= 1 &&
        Number(value.limit) <= EXPERIMENT_LIMITS.maxPageSize &&
        Number.isSafeInteger(value.offset) &&
        Number(value.offset) >= 0 &&
        Number(value.offset) <= EXPERIMENT_LIMITS.maxPageOffset &&
        typeof value.query === 'string' &&
        Buffer.byteLength(value.query, 'utf8') <= 512 &&
        !containsControlCharacter(value.query) &&
        (value.state === null || EXPERIMENT_STATE_VALUES.has(value.state))
      );
    }
    case 'getBriefs': {
      const value = validateOneObject(args, [
        'limit',
        'offset',
        'profileId',
        'query',
        'readiness',
        'state',
      ]);
      return (
        value !== null &&
        Number.isSafeInteger(value.limit) &&
        Number(value.limit) >= 1 &&
        Number(value.limit) <= BRIEF_LIMITS.maxPageSize &&
        Number.isSafeInteger(value.offset) &&
        Number(value.offset) >= 0 &&
        Number(value.offset) <= BRIEF_LIMITS.maxPageOffset &&
        (value.profileId === null || BRIEF_PROFILE_VALUES.has(value.profileId)) &&
        typeof value.query === 'string' &&
        Buffer.byteLength(value.query, 'utf8') <= 512 &&
        !containsControlCharacter(value.query) &&
        (value.readiness === null || BRIEF_READINESS_VALUES.has(value.readiness)) &&
        (value.state === null || value.state === 'ACTIVE' || value.state === 'ARCHIVED')
      );
    }
    case 'getBrief': {
      const value = validateOneObject(args, [
        'briefId',
        'evidenceLimit',
        'evidenceOffset',
        'generationLimit',
        'generationOffset',
        'historyLimit',
        'historyOffset',
        'versionLimit',
        'versionOffset',
      ]);
      return (
        value !== null &&
        dossierIdentifier(value.briefId, BRIEF_LIMITS.identifierBytes) &&
        Number.isSafeInteger(value.evidenceLimit) &&
        Number(value.evidenceLimit) >= 1 &&
        Number(value.evidenceLimit) <= 100 &&
        Number.isSafeInteger(value.evidenceOffset) &&
        Number(value.evidenceOffset) >= 0 &&
        Number(value.evidenceOffset) <= BRIEF_LIMITS.maxPageOffset &&
        Number.isSafeInteger(value.generationLimit) &&
        Number(value.generationLimit) >= 1 &&
        Number(value.generationLimit) <= 100 &&
        Number.isSafeInteger(value.generationOffset) &&
        Number(value.generationOffset) >= 0 &&
        Number(value.generationOffset) <= BRIEF_LIMITS.maxPageOffset &&
        Number.isSafeInteger(value.historyLimit) &&
        Number(value.historyLimit) >= 1 &&
        Number(value.historyLimit) <= 100 &&
        Number.isSafeInteger(value.historyOffset) &&
        Number(value.historyOffset) >= 0 &&
        Number(value.historyOffset) <= BRIEF_LIMITS.maxPageOffset &&
        Number.isSafeInteger(value.versionLimit) &&
        Number(value.versionLimit) >= 1 &&
        Number(value.versionLimit) <= 100 &&
        Number.isSafeInteger(value.versionOffset) &&
        Number(value.versionOffset) >= 0 &&
        Number(value.versionOffset) <= BRIEF_LIMITS.maxPageOffset
      );
    }
    case 'previewBriefAction': {
      const value =
        args.length === 1 && isRecord(args[0])
          ? (args[0] as Readonly<Record<string, unknown>>)
          : null;
      return value !== null && validBriefPreview(value);
    }
    case 'confirmBriefAction': {
      const value = validateOneObject(args, [
        'confirmation',
        'executionId',
        'kind',
        'previewHash',
        'token',
      ]);
      const generation = value?.kind === 'PREVIEW_GENERATION';
      return (
        value?.confirmation === 'APPLY_CONTENT_BRIEF_ACTION' &&
        [
          'CREATE_SCAFFOLD',
          'SAVE_EDIT',
          'LOCK_FIELD',
          'UNLOCK_FIELD',
          'CLONE',
          'UNDO',
          'ARCHIVE',
          'RESTORE',
          'PREVIEW_GENERATION',
          'CANCEL_GENERATION',
        ].includes(String(value.kind)) &&
        (generation
          ? dossierIdentifier(value.executionId, BRIEF_LIMITS.identifierBytes)
          : value.executionId === null) &&
        typeof value.previewHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.previewHash) &&
        typeof value.token === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(value.token)
      );
    }
    case 'getExperiment': {
      const value = validateOneObject(args, [
        'experimentId',
        'historyLimit',
        'historyOffset',
        'versionLimit',
        'versionOffset',
      ]);
      return (
        value !== null &&
        catalogId(value.experimentId) &&
        Number.isSafeInteger(value.historyLimit) &&
        Number(value.historyLimit) >= 1 &&
        Number(value.historyLimit) <= EXPERIMENT_LIMITS.maxHistoryPageSize &&
        Number.isSafeInteger(value.historyOffset) &&
        Number(value.historyOffset) >= 0 &&
        Number(value.historyOffset) <= EXPERIMENT_LIMITS.maxPageOffset &&
        Number.isSafeInteger(value.versionLimit) &&
        Number(value.versionLimit) >= 1 &&
        Number(value.versionLimit) <= EXPERIMENT_LIMITS.maxHistoryPageSize &&
        Number.isSafeInteger(value.versionOffset) &&
        Number(value.versionOffset) >= 0 &&
        Number(value.versionOffset) <= EXPERIMENT_LIMITS.maxPageOffset
      );
    }
    case 'previewExperimentAction': {
      const value =
        args.length === 1 && isRecord(args[0])
          ? (args[0] as Readonly<Record<string, unknown>>)
          : null;
      return value !== null && validExperimentPreview(value);
    }
    case 'confirmExperimentAction': {
      const value = validateOneObject(args, ['confirmation', 'kind', 'previewHash', 'token']);
      return (
        value?.confirmation === 'APPLY_EXPERIMENT_ACTION' &&
        ['CREATE_DRAFT', 'SAVE_ASSIGNMENT', 'STATE_ACTION', 'CLONE_VERSION'].includes(
          String(value.kind),
        ) &&
        typeof value.previewHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.previewHash) &&
        typeof value.token === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(value.token)
      );
    }
    case 'previewTopicAction': {
      const value =
        args.length === 1 && isRecord(args[0])
          ? (args[0] as Readonly<Record<string, unknown>>)
          : null;
      return value !== null && validTopicPreview(value);
    }
    case 'confirmTopicAction': {
      const value = validateOneObject(args, [
        'confirmation',
        'executionId',
        'kind',
        'previewHash',
        'token',
      ]);
      const kind = value?.kind;
      return (
        value?.confirmation === 'APPLY_TOPIC_ACTION' &&
        TOPIC_ACTION_KINDS.has(String(kind)) &&
        (kind === 'GENERATE' || kind === 'QUOTA_PLAN'
          ? catalogId(value.executionId)
          : value.executionId === null) &&
        typeof value.previewHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.previewHash) &&
        typeof value.token === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(value.token)
      );
    }
    case 'getEvidenceState': {
      const value = validateOneObject(args, ['limit', 'offset']);
      return (
        value !== null &&
        Number.isSafeInteger(value.limit) &&
        Number(value.limit) >= 1 &&
        Number(value.limit) <= 100 &&
        Number.isSafeInteger(value.offset) &&
        Number(value.offset) >= 0 &&
        Number(value.offset) <= 1_000_000
      );
    }
    case 'listDossiers': {
      const value = validateOneObject(args, ['limit', 'offset']);
      return (
        value !== null &&
        Number.isSafeInteger(value.limit) &&
        Number(value.limit) >= 1 &&
        Number(value.limit) <= 100 &&
        Number.isSafeInteger(value.offset) &&
        Number(value.offset) >= 0 &&
        Number(value.offset) <= 1_000_000
      );
    }
    case 'getDossier': {
      const value = validateOneObject(args, ['dossierId', 'entryLimit', 'entryOffset']);
      return (
        value !== null &&
        dossierIdentifier(value.dossierId) &&
        Number.isSafeInteger(value.entryLimit) &&
        Number(value.entryLimit) >= 1 &&
        Number(value.entryLimit) <= 100 &&
        Number.isSafeInteger(value.entryOffset) &&
        Number(value.entryOffset) >= 0 &&
        Number(value.entryOffset) <= 1_000_000
      );
    }
    case 'previewDossierBuild': {
      const value = validateOneObject(args, ['subjectId', 'subjectType']);
      return (
        value !== null &&
        dossierIdentifier(value.subjectId, 128) &&
        ['WORK', 'EXPRESSION', 'EDITION'].includes(String(value.subjectType))
      );
    }
    case 'confirmDossierBuild': {
      const value = validateOneObject(args, ['confirmation', 'planHash', 'previewHash', 'token']);
      return (
        value?.confirmation === 'START_DOSSIER_BUILD' &&
        typeof value.planHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.planHash) &&
        typeof value.previewHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.previewHash) &&
        typeof value.token === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(value.token)
      );
    }
    case 'cancelDossierBuild': {
      const value = validateOneObject(args, ['confirmation', 'expectedRevision', 'runId']);
      return (
        value?.confirmation === 'CANCEL_DOSSIER_BUILD' &&
        catalogRevision(value.expectedRevision) &&
        dossierIdentifier(value.runId)
      );
    }
    case 'diffDossierVersions': {
      const value = validateOneObject(args, ['dossierId', 'fromVersionId', 'toVersionId']);
      return (
        value !== null &&
        dossierIdentifier(value.dossierId) &&
        (value.fromVersionId === null || dossierIdentifier(value.fromVersionId)) &&
        dossierIdentifier(value.toVersionId)
      );
    }
    case 'previewEvidenceConflict': {
      const value = validateOneObject(args, ['acceptedClaimId', 'action', 'conflictId']);
      const actions = [
        'ACCEPT_CLAIM',
        'ACCEPT_MULTIVALUE',
        'SPLIT_SCOPE',
        'DISMISS_DEPENDENT_SOURCE',
        'UNDO',
        'REOPEN',
      ];
      return (
        value !== null &&
        catalogId(value.conflictId) &&
        actions.includes(String(value.action)) &&
        (value.acceptedClaimId === null || catalogId(value.acceptedClaimId)) &&
        ((value.action === 'ACCEPT_CLAIM' && value.acceptedClaimId !== null) ||
          (value.action !== 'ACCEPT_CLAIM' && value.acceptedClaimId === null))
      );
    }
    case 'confirmEvidenceConflict': {
      const value = validateOneObject(args, ['confirmation', 'previewHash', 'reason', 'token']);
      return (
        value?.confirmation === 'APPLY_FACT_CONFLICT_DECISION' &&
        typeof value.previewHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.previewHash) &&
        typeof value.token === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(value.token) &&
        typeof value.reason === 'string' &&
        value.reason.trim().length >= 1 &&
        value.reason.length <= 2_000 &&
        !containsControlCharacter(value.reason)
      );
    }
    case 'previewSourceProcessing': {
      const value = validateOneObject(args, ['includeModelSteps', 'sourceRevisionIds']);
      return (
        value !== null &&
        typeof value.includeModelSteps === 'boolean' &&
        Array.isArray(value.sourceRevisionIds) &&
        value.sourceRevisionIds.length >= 1 &&
        value.sourceRevisionIds.length <= 64 &&
        value.sourceRevisionIds.every(catalogId) &&
        new Set(value.sourceRevisionIds).size === value.sourceRevisionIds.length
      );
    }
    case 'confirmSourceProcessing': {
      const value = validateOneObject(args, ['confirmation', 'planHash', 'previewHash', 'token']);
      return (
        value?.confirmation === 'START_SOURCE_PROCESSING' &&
        typeof value.planHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.planHash) &&
        typeof value.previewHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.previewHash) &&
        typeof value.token === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(value.token)
      );
    }
    case 'cancelSourceProcessing': {
      const value = validateOneObject(args, ['confirmation', 'expectedRevision', 'runId']);
      return (
        value?.confirmation === 'CANCEL_SOURCE_PROCESSING' &&
        catalogRevision(value.expectedRevision) &&
        catalogId(value.runId)
      );
    }
    case 'getCatalogWork': {
      const value = validateOneObject(args, ['workId']);
      return catalogId(value?.workId);
    }
    case 'previewCatalogDiscovery': {
      const value = validateOneObject(args, [
        'batchSize',
        'maxObservations',
        'maxRuntimeMs',
        'originKinds',
        'purpose',
      ]);
      const origins = ['BROWSER_CLIP_CANDIDATE', 'FETCH_DOCUMENT', 'SEARCH_CANDIDATE'];
      return (
        value !== null &&
        Array.isArray(value.originKinds) &&
        value.originKinds.length >= 1 &&
        value.originKinds.length <= origins.length &&
        value.originKinds.every((kind) => origins.includes(String(kind))) &&
        new Set(value.originKinds).size === value.originKinds.length &&
        ['CUSTOM', 'MARKET_MAP', 'PILOT_CONTENT'].includes(String(value.purpose)) &&
        Number.isSafeInteger(value.maxObservations) &&
        Number(value.maxObservations) >= 1 &&
        Number(value.maxObservations) <= 1_000_000 &&
        Number.isSafeInteger(value.batchSize) &&
        Number(value.batchSize) >= 1 &&
        Number(value.batchSize) <= 1_000 &&
        Number(value.batchSize) <= Number(value.maxObservations) &&
        Number.isSafeInteger(value.maxRuntimeMs) &&
        Number(value.maxRuntimeMs) >= 100 &&
        Number(value.maxRuntimeMs) <= 86_400_000
      );
    }
    case 'confirmCatalogDiscovery': {
      const value = validateOneObject(args, [
        'confirmation',
        'expectedRevision',
        'previewHash',
        'token',
      ]);
      return (
        value?.confirmation === 'START_BIBLIOGRAPHY_DISCOVERY' &&
        catalogRevision(value.expectedRevision) &&
        typeof value.previewHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(value.previewHash) &&
        typeof value.token === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(value.token)
      );
    }
    case 'cancelCatalogDiscovery': {
      const value = validateOneObject(args, ['confirmation', 'expectedRevision', 'runId']);
      return (
        value?.confirmation === 'CANCEL_BIBLIOGRAPHY_DISCOVERY' &&
        catalogRevision(value.expectedRevision) &&
        catalogId(value.runId)
      );
    }
    case 'previewCatalogWorkMerge': {
      const value = validateOneObject(args, [
        'duplicateRevision',
        'duplicateWorkId',
        'survivorRevision',
        'survivorWorkId',
      ]);
      return (
        value !== null &&
        catalogId(value.duplicateWorkId) &&
        catalogId(value.survivorWorkId) &&
        value.duplicateWorkId !== value.survivorWorkId &&
        catalogRevision(value.duplicateRevision) &&
        catalogRevision(value.survivorRevision)
      );
    }
    case 'previewCatalogWorkSplit': {
      const value = validateOneObject(args, [
        'expressionIds',
        'newCanonicalTitle',
        'sourceRevision',
        'sourceWorkId',
      ]);
      return (
        value !== null &&
        catalogId(value.sourceWorkId) &&
        catalogRevision(value.sourceRevision) &&
        Array.isArray(value.expressionIds) &&
        value.expressionIds.length >= 1 &&
        value.expressionIds.length <= 64 &&
        value.expressionIds.every(catalogId) &&
        new Set(value.expressionIds).size === value.expressionIds.length &&
        typeof value.newCanonicalTitle === 'string' &&
        value.newCanonicalTitle.trim().length >= 1 &&
        value.newCanonicalTitle.length <= 512 &&
        !containsControlCharacter(value.newCanonicalTitle)
      );
    }
    case 'previewCatalogUndo': {
      const value = validateOneObject(args, ['decisionId']);
      return catalogId(value?.decisionId);
    }
    case 'confirmCatalogUndo':
    case 'confirmCatalogWorkMerge':
    case 'confirmCatalogWorkSplit':
      return catalogConfirmation(validateOneObject(args, ['confirmation', 'previewHash', 'token']));
    case 'getBrowserClip': {
      const value = validateOneObject(args, ['clipId']);
      return (
        value !== null &&
        typeof value.clipId === 'string' &&
        /^clip-[0-9a-f-]{36}$/u.test(value.clipId)
      );
    }
    case 'updateFetchPolicy': {
      const value = validateOneObject(args, [
        'enabled',
        'expectedRevision',
        'globalMaxConcurrent',
        'maxRequestsPerWindow',
        'minIntervalMs',
        'windowMs',
      ]);
      return (
        value !== null &&
        typeof value.enabled === 'boolean' &&
        Number.isSafeInteger(value.expectedRevision) &&
        Number(value.expectedRevision) >= 1 &&
        Number.isSafeInteger(value.globalMaxConcurrent) &&
        Number(value.globalMaxConcurrent) >= 1 &&
        Number(value.globalMaxConcurrent) <= 8 &&
        Number.isSafeInteger(value.maxRequestsPerWindow) &&
        Number(value.maxRequestsPerWindow) >= 1 &&
        Number(value.maxRequestsPerWindow) <= 10_000 &&
        Number.isSafeInteger(value.minIntervalMs) &&
        Number(value.minIntervalMs) >= 0 &&
        Number(value.minIntervalMs) <= 86_400_000 &&
        Number.isSafeInteger(value.windowMs) &&
        Number(value.windowMs) >= 1_000 &&
        Number(value.windowMs) <= 86_400_000
      );
    }
    case 'confirmModelCacheClear': {
      const value = validateOneObject(args, [
        'confirmation',
        'expectedBytes',
        'expectedCount',
        'previewToken',
      ]);
      return (
        value?.confirmation === 'CLEAR_MODEL_RESULT_CACHE' &&
        typeof value.previewToken === 'string' &&
        /^[A-Za-z0-9_-]{43}$/u.test(value.previewToken) &&
        boundedUnit(value.expectedBytes, false) &&
        boundedUnit(value.expectedCount, false)
      );
    }
    case 'createModelPriceSchedule': {
      const value = validateOneObject(args, [
        'cachedInputPerMillionUsd',
        'cacheWritePerMillionUsd',
        'callUsd',
        'expectedSettingsRevision',
        'imageGenerationCallUsd',
        'imageUsd',
        'inputPerMillionUsd',
        'inputTokensIncludeCachedInput',
        'modelId',
        'operationKind',
        'outputPerMillionUsd',
        'protocolMode',
        'searchCallUsd',
        'toolUnitUsd',
        'usageSemanticsVersion',
      ]);
      return (
        value !== null &&
        [
          value.cachedInputPerMillionUsd,
          value.cacheWritePerMillionUsd,
          value.callUsd,
          value.imageGenerationCallUsd,
          value.imageUsd,
          value.inputPerMillionUsd,
          value.outputPerMillionUsd,
          value.searchCallUsd,
          value.toolUnitUsd,
        ].every(nullableDecimal) &&
        typeof value.expectedSettingsRevision === 'number' &&
        Number.isSafeInteger(value.expectedSettingsRevision) &&
        value.expectedSettingsRevision >= 0 &&
        typeof value.inputTokensIncludeCachedInput === 'boolean' &&
        typeof value.modelId === 'string' &&
        /^[A-Za-z0-9._:/-]{1,256}$/u.test(value.modelId) &&
        typeof value.operationKind === 'string' &&
        /^[A-Z][A-Z0-9_]{0,63}$/u.test(value.operationKind) &&
        (value.protocolMode === null ||
          ['CHAT_COMPLETIONS', 'IMAGES_GENERATIONS', 'MOCK', 'RESPONSES'].includes(
            String(value.protocolMode),
          )) &&
        typeof value.usageSemanticsVersion === 'string' &&
        /^[A-Za-z0-9._-]{1,64}$/u.test(value.usageSemanticsVersion)
      );
    }
    case 'createModelUnitPolicy': {
      const value = validateOneObject(args, [
        'expectedSettingsRevision',
        'maxExternalCallsMonthly',
        'maxExternalCallsWeekly',
        'maxImageGenerationCalls',
        'maxImages',
        'maxInputTokens',
        'maxOutputTokens',
        'maxToolCalls',
        'maxWebSearchCalls',
        'scopeKind',
        'scopeValue',
      ]);
      return (
        value !== null &&
        typeof value.expectedSettingsRevision === 'number' &&
        Number.isSafeInteger(value.expectedSettingsRevision) &&
        value.expectedSettingsRevision >= 0 &&
        boundedUnit(value.maxExternalCallsMonthly, false) &&
        boundedUnit(value.maxExternalCallsWeekly, false) &&
        (value.maxExternalCallsMonthly as number) > 0 &&
        (value.maxExternalCallsWeekly as number) > 0 &&
        [
          value.maxImageGenerationCalls,
          value.maxImages,
          value.maxInputTokens,
          value.maxOutputTokens,
          value.maxToolCalls,
          value.maxWebSearchCalls,
        ].every((entry) => boundedUnit(entry)) &&
        ['GLOBAL', 'MODEL_ROLE', 'TASK_KIND'].includes(String(value.scopeKind)) &&
        ((value.scopeKind === 'GLOBAL' && value.scopeValue === null) ||
          (value.scopeKind !== 'GLOBAL' &&
            typeof value.scopeValue === 'string' &&
            /^[A-Za-z0-9._:-]{1,128}$/u.test(value.scopeValue)))
      );
    }
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
    case 'updateSearchProviderConfig': {
      const value = validateOneObject(args, [
        'curatedEntries',
        'enabled',
        'expectedRevision',
        'maxResults',
        'providerInstanceId',
        'ratePolicy',
        'timeoutMs',
      ]);
      if (
        value === null ||
        ![
          'browser-clip-v1',
          'curated-source-v1',
          'manual-url-v1',
          'model-web-search-v1',
          'search-api-v1',
        ].includes(String(value.providerInstanceId)) ||
        typeof value.enabled !== 'boolean' ||
        typeof value.expectedRevision !== 'number' ||
        !Number.isSafeInteger(value.expectedRevision) ||
        value.expectedRevision < 1 ||
        typeof value.maxResults !== 'number' ||
        !Number.isSafeInteger(value.maxResults) ||
        value.maxResults < 1 ||
        value.maxResults > 20 ||
        typeof value.timeoutMs !== 'number' ||
        !Number.isSafeInteger(value.timeoutMs) ||
        value.timeoutMs < 100 ||
        value.timeoutMs > 600_000 ||
        !Array.isArray(value.curatedEntries) ||
        value.curatedEntries.length > 100
      ) {
        return false;
      }
      const entriesValid = value.curatedEntries.every(
        (entry) =>
          isRecord(entry) &&
          exactKeys(entry, ['entryId', 'intent', 'languageHint', 'title', 'urlTemplate']) &&
          typeof entry.entryId === 'string' &&
          /^[A-Za-z0-9._:-]{1,128}$/u.test(entry.entryId) &&
          [
            'AUTHOR_RESEARCH',
            'AWARD_RESEARCH',
            'BIBLIOGRAPHIC_LOOKUP',
            'BOOK_DISCOVERY',
            'CULTURAL_CONTEXT',
            'PUBLISHING_NEWS',
            'REVIEW_LANDSCAPE',
          ].includes(String(entry.intent)) &&
          (entry.languageHint === null ||
            (typeof entry.languageHint === 'string' && entry.languageHint.length <= 32)) &&
          typeof entry.title === 'string' &&
          entry.title.length >= 1 &&
          entry.title.length <= 512 &&
          typeof entry.urlTemplate === 'string' &&
          entry.urlTemplate.length >= 1 &&
          entry.urlTemplate.length <= 4_096,
      );
      if (!entriesValid) return false;
      if (value.providerInstanceId !== 'curated-source-v1' && value.curatedEntries.length !== 0) {
        return false;
      }
      if (value.ratePolicy === null) return true;
      if (
        !isRecord(value.ratePolicy) ||
        !exactKeys(value.ratePolicy, [
          'contractVersion',
          'maxConcurrent',
          'maxRequestsPerWindow',
          'maxResponseBytes',
          'maxResults',
          'minIntervalMs',
          'revision',
          'timeoutMs',
          'windowMs',
        ])
      ) {
        return false;
      }
      const policy = value.ratePolicy;
      return (
        policy.contractVersion === 'search-rate-policy-v1' &&
        [
          policy.maxConcurrent,
          policy.maxRequestsPerWindow,
          policy.maxResponseBytes,
          policy.maxResults,
          policy.minIntervalMs,
          policy.revision,
          policy.timeoutMs,
          policy.windowMs,
        ].every((item) => typeof item === 'number' && Number.isSafeInteger(item) && item >= 0)
      );
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
    const maximumBytes = operation === 'previewBriefAction' ? MAX_BRIEF_IPC_BYTES : MAX_IPC_BYTES;
    if (
      Buffer.byteLength(JSON.stringify(args), 'utf8') > maximumBytes ||
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
