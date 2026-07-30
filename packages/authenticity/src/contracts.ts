import {
  AUTHENTICITY_LIMITS,
  DOSSIER_READINESS_INPUTS,
  EXPERIENCE_ASSERTION_KINDS,
  EXPERIENCE_CONFIRMATION_SCOPES,
  MEMORY_CONFIDENCES,
  PUBLIC_SCORE_ORIGINS,
  READING_DATE_PRECISIONS,
  READING_STATES,
  SPOILER_LEVELS,
  type AuthenticitySpoilerLevel,
  type DossierReadinessInput,
  type ExperienceAssertionKind,
  type ExperienceConfirmationScope,
  type MemoryConfidence,
  type PublicScoreOrigin,
  type ReadingDatePrecision,
  type ReadingStateCode,
} from './constants.js';
import { AuthenticityError } from './errors.js';

export interface ReadingSubjectContext {
  readonly editionId: string | null;
  readonly expressionId: string | null;
  readonly workId: string;
}

export interface ReadingStateChangeDraft {
  readonly confirmationKind: 'USER_EXPLICIT' | 'USER_BATCH_EXPLICIT';
  readonly expectedRevision: number;
  readonly finishedAt: string | null;
  readonly finishedAtPrecision: ReadingDatePrecision;
  readonly lastReadAt: string | null;
  readonly lastReadAtPrecision: ReadingDatePrecision;
  readonly memoryConfidence: MemoryConfidence;
  readonly nextState: ReadingStateCode;
  readonly profileId: string;
  readonly provenance: 'USER_UI';
  readonly subject: ReadingSubjectContext;
  readonly userNote: string | null;
}

export interface BatchReadingStateItem {
  readonly expectedRevision: number;
  readonly workId: string;
}

export interface BatchReadingStateDraft {
  readonly confirmationKind: 'USER_BATCH_EXPLICIT';
  readonly items: readonly BatchReadingStateItem[];
  readonly memoryConfidence: MemoryConfidence;
  readonly nextState: ReadingStateCode;
  readonly profileId: string;
  readonly provenance: 'USER_UI';
}

export interface ExperienceAssertionDraft {
  readonly assertionId: string | null;
  readonly assertionKind: ExperienceAssertionKind;
  readonly confirmationScope: ExperienceConfirmationScope;
  readonly expectedAssertionRevision: number;
  readonly expectedReadingRevision: number;
  readonly profileId: string;
  readonly statement: string;
  readonly workId: string;
}

export interface ScoreRecordDraft {
  readonly expectedRevision: number;
  readonly expectedReadingRevision: number;
  readonly origin: PublicScoreOrigin;
  readonly profileId: string;
  readonly scoreBasisPoints: number | null;
  readonly workId: string;
}

export interface SpoilerPreferenceDraft {
  readonly expectedRevision: number;
  readonly level: AuthenticitySpoilerLevel;
  readonly profileId: string;
  readonly userConfirmed: boolean;
  readonly warningIncluded: boolean;
  readonly workId: string;
}

export interface CurrentAssertionInput {
  readonly assertionId: string;
  readonly assertionKind: ExperienceAssertionKind;
  readonly assertionRevision: number;
  readonly readingStateRevisionId: string;
  readonly status: 'CONFIRMED' | 'REVOKED';
}

export interface DossierPermissionInput {
  readonly coveragePolicyVersion: string;
  readonly dossierId: string;
  readonly readiness: DossierReadinessInput;
  readonly stale: boolean;
  readonly versionId: string;
}

export interface SpoilerSelectionInput {
  readonly level: AuthenticitySpoilerLevel;
  readonly userConfirmed: boolean;
  readonly warningIncluded: boolean;
}

export interface ExpressionPermissionInput {
  readonly assertions: readonly CurrentAssertionInput[];
  readonly dossier: DossierPermissionInput | null;
  readonly memoryConfidence: MemoryConfidence;
  readonly profileId: string;
  readonly readingState: ReadingStateCode;
  readonly readingStateRevisionId: string;
  readonly spoilerSelection: SpoilerSelectionInput;
  readonly workId: string;
}

function invalid(): never {
  throw new AuthenticityError('AUTHENTICITY_INVALID_CONTRACT');
}

function assertExactObject(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid();
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    invalid();
  }
}

function assertIdentifier(
  value: unknown,
  maxBytes: number = AUTHENTICITY_LIMITS.identifierBytes,
): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    Buffer.byteLength(value, 'utf8') > maxBytes
  ) {
    invalid();
  }
  return value;
}

function assertNullableIdentifier(value: unknown): string | null {
  return value === null
    ? null
    : assertIdentifier(value, AUTHENTICITY_LIMITS.contextIdentifierBytes);
}

function assertInteger(value: unknown, minimum: number, maximum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalid();
  }
  return value;
}

function assertNullableDate(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') invalid();
  const match = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/u.exec(value);
  if (match === null) invalid();
  const year = Number(match[1]);
  const month = match[2] === undefined ? null : Number(match[2]);
  const day = match[3] === undefined ? null : Number(match[3]);
  if (year < 1 || (month !== null && (month < 1 || month > 12))) {
    invalid();
  }
  if (day !== null && month !== null) {
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
    if (daysInMonth === undefined || day < 1 || day > daysInMonth) invalid();
  }
  return value;
}

function assertEnum<T extends string>(value: unknown, values: readonly T[]): T {
  if (typeof value !== 'string' || !values.includes(value as T)) invalid();
  return value as T;
}

function assertBoolean(value: unknown): boolean {
  if (typeof value !== 'boolean') invalid();
  return value;
}

function assertNullableNote(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, 'utf8') > AUTHENTICITY_LIMITS.noteBytes
  ) {
    invalid();
  }
  return value;
}

export function assertStateConfidenceCombination(
  state: ReadingStateCode,
  confidence: MemoryConfidence,
): void {
  const valid =
    (state === 'R1_READ_CLEAR' && confidence === 'CLEAR') ||
    (state === 'R2_READ_FUZZY' && (confidence === 'PARTIAL' || confidence === 'FADED')) ||
    (state === 'R3_READ_UNCONFIRMED_DETAILS' &&
      (confidence === 'FADED' || confidence === 'UNKNOWN')) ||
    ((state === 'S1_RESEARCH_ONLY' || state === 'S2_RESEARCH_INSUFFICIENT') &&
      confidence === 'NOT_APPLICABLE') ||
    (state === 'UNCLASSIFIED' && confidence === 'UNKNOWN');
  if (!valid) invalid();
}

function assertDatePrecisionPair(date: string | null, precision: ReadingDatePrecision): void {
  if ((date === null && precision !== 'UNKNOWN') || (date !== null && precision === 'UNKNOWN')) {
    invalid();
  }
  if (date !== null) {
    if (precision === 'DAY' && date.length !== 10) invalid();
    if (precision === 'MONTH' && date.length !== 7) invalid();
    if (precision === 'YEAR' && date.length !== 4) invalid();
  }
}

export function assertReadingStateChangeDraft(value: unknown): ReadingStateChangeDraft {
  assertExactObject(value, [
    'confirmationKind',
    'expectedRevision',
    'finishedAt',
    'finishedAtPrecision',
    'lastReadAt',
    'lastReadAtPrecision',
    'memoryConfidence',
    'nextState',
    'profileId',
    'provenance',
    'subject',
    'userNote',
  ]);
  assertExactObject(value.subject, ['editionId', 'expressionId', 'workId']);
  const nextState = assertEnum(value.nextState, READING_STATES);
  const memoryConfidence = assertEnum(value.memoryConfidence, MEMORY_CONFIDENCES);
  assertStateConfidenceCombination(nextState, memoryConfidence);
  const finishedAt = assertNullableDate(value.finishedAt);
  const finishedAtPrecision = assertEnum(value.finishedAtPrecision, READING_DATE_PRECISIONS);
  const lastReadAt = assertNullableDate(value.lastReadAt);
  const lastReadAtPrecision = assertEnum(value.lastReadAtPrecision, READING_DATE_PRECISIONS);
  assertDatePrecisionPair(finishedAt, finishedAtPrecision);
  assertDatePrecisionPair(lastReadAt, lastReadAtPrecision);
  if (
    value.confirmationKind !== 'USER_EXPLICIT' &&
    value.confirmationKind !== 'USER_BATCH_EXPLICIT'
  ) {
    invalid();
  }
  if (value.provenance !== 'USER_UI') invalid();
  return Object.freeze({
    confirmationKind: value.confirmationKind,
    expectedRevision: assertInteger(value.expectedRevision, 0, 2_147_483_647),
    finishedAt,
    finishedAtPrecision,
    lastReadAt,
    lastReadAtPrecision,
    memoryConfidence,
    nextState,
    profileId: assertIdentifier(value.profileId),
    provenance: 'USER_UI',
    subject: Object.freeze({
      editionId: assertNullableIdentifier(value.subject.editionId),
      expressionId: assertNullableIdentifier(value.subject.expressionId),
      workId: assertIdentifier(value.subject.workId),
    }),
    userNote: assertNullableNote(value.userNote),
  });
}

export function assertBatchReadingStateDraft(value: unknown): BatchReadingStateDraft {
  assertExactObject(value, [
    'confirmationKind',
    'items',
    'memoryConfidence',
    'nextState',
    'profileId',
    'provenance',
  ]);
  if (
    value.confirmationKind !== 'USER_BATCH_EXPLICIT' ||
    value.provenance !== 'USER_UI' ||
    !Array.isArray(value.items) ||
    value.items.length < 1 ||
    value.items.length > AUTHENTICITY_LIMITS.batchSize
  ) {
    invalid();
  }
  const nextState = assertEnum(value.nextState, READING_STATES);
  const memoryConfidence = assertEnum(value.memoryConfidence, MEMORY_CONFIDENCES);
  assertStateConfidenceCombination(nextState, memoryConfidence);
  const items = value.items.map((item) => {
    assertExactObject(item, ['expectedRevision', 'workId']);
    return Object.freeze({
      expectedRevision: assertInteger(item.expectedRevision, 0, 2_147_483_647),
      workId: assertIdentifier(item.workId),
    });
  });
  if (new Set(items.map((item) => item.workId)).size !== items.length) invalid();
  return Object.freeze({
    confirmationKind: 'USER_BATCH_EXPLICIT',
    items: Object.freeze(items),
    memoryConfidence,
    nextState,
    profileId: assertIdentifier(value.profileId),
    provenance: 'USER_UI',
  });
}

export function assertExperienceAssertionDraft(value: unknown): ExperienceAssertionDraft {
  assertExactObject(value, [
    'assertionId',
    'assertionKind',
    'confirmationScope',
    'expectedAssertionRevision',
    'expectedReadingRevision',
    'profileId',
    'statement',
    'workId',
  ]);
  if (
    typeof value.statement !== 'string' ||
    value.statement.trim().length === 0 ||
    Buffer.byteLength(value.statement, 'utf8') > AUTHENTICITY_LIMITS.assertionBytes
  ) {
    invalid();
  }
  return Object.freeze({
    assertionId: value.assertionId === null ? null : assertIdentifier(value.assertionId),
    assertionKind: assertEnum(value.assertionKind, EXPERIENCE_ASSERTION_KINDS),
    confirmationScope: assertEnum(value.confirmationScope, EXPERIENCE_CONFIRMATION_SCOPES),
    expectedAssertionRevision: assertInteger(value.expectedAssertionRevision, 0, 2_147_483_647),
    expectedReadingRevision: assertInteger(value.expectedReadingRevision, 1, 2_147_483_647),
    profileId: assertIdentifier(value.profileId),
    statement: value.statement,
    workId: assertIdentifier(value.workId),
  });
}

export function assertScoreRecordDraft(value: unknown): ScoreRecordDraft {
  assertExactObject(value, [
    'expectedReadingRevision',
    'expectedRevision',
    'origin',
    'profileId',
    'scoreBasisPoints',
    'workId',
  ]);
  return Object.freeze({
    expectedReadingRevision: assertInteger(value.expectedReadingRevision, 1, 2_147_483_647),
    expectedRevision: assertInteger(value.expectedRevision, 0, 2_147_483_647),
    origin: assertEnum(value.origin, PUBLIC_SCORE_ORIGINS),
    profileId: assertIdentifier(value.profileId),
    scoreBasisPoints:
      value.scoreBasisPoints === null
        ? null
        : assertInteger(value.scoreBasisPoints, 0, AUTHENTICITY_LIMITS.scoreBasisPoints),
    workId: assertIdentifier(value.workId),
  });
}

export function assertSpoilerPreferenceDraft(value: unknown): SpoilerPreferenceDraft {
  assertExactObject(value, [
    'expectedRevision',
    'level',
    'profileId',
    'userConfirmed',
    'warningIncluded',
    'workId',
  ]);
  return Object.freeze({
    expectedRevision: assertInteger(value.expectedRevision, 0, 2_147_483_647),
    level: assertEnum(value.level, SPOILER_LEVELS),
    profileId: assertIdentifier(value.profileId),
    userConfirmed: assertBoolean(value.userConfirmed),
    warningIncluded: assertBoolean(value.warningIncluded),
    workId: assertIdentifier(value.workId),
  });
}

export function assertExpressionPermissionInput(value: unknown): ExpressionPermissionInput {
  assertExactObject(value, [
    'assertions',
    'dossier',
    'memoryConfidence',
    'profileId',
    'readingState',
    'readingStateRevisionId',
    'spoilerSelection',
    'workId',
  ]);
  const readingState = assertEnum(value.readingState, READING_STATES);
  const memoryConfidence = assertEnum(value.memoryConfidence, MEMORY_CONFIDENCES);
  assertStateConfidenceCombination(readingState, memoryConfidence);
  if (
    !Array.isArray(value.assertions) ||
    value.assertions.length > AUTHENTICITY_LIMITS.maxAssertionsPerWork
  ) {
    invalid();
  }
  const assertions = value.assertions.map((assertion) => {
    assertExactObject(assertion, [
      'assertionId',
      'assertionKind',
      'assertionRevision',
      'readingStateRevisionId',
      'status',
    ]);
    if (assertion.status !== 'CONFIRMED' && assertion.status !== 'REVOKED') invalid();
    return Object.freeze({
      assertionId: assertIdentifier(assertion.assertionId),
      assertionKind: assertEnum(assertion.assertionKind, EXPERIENCE_ASSERTION_KINDS),
      assertionRevision: assertInteger(assertion.assertionRevision, 1, 2_147_483_647),
      readingStateRevisionId: assertIdentifier(assertion.readingStateRevisionId),
      status: assertion.status,
    });
  });
  if (new Set(assertions.map((item) => item.assertionId)).size !== assertions.length) invalid();
  let dossier: DossierPermissionInput | null = null;
  if (value.dossier !== null) {
    assertExactObject(value.dossier, [
      'coveragePolicyVersion',
      'dossierId',
      'readiness',
      'stale',
      'versionId',
    ]);
    dossier = Object.freeze({
      coveragePolicyVersion: assertIdentifier(value.dossier.coveragePolicyVersion),
      dossierId: assertIdentifier(value.dossier.dossierId),
      readiness: assertEnum(value.dossier.readiness, DOSSIER_READINESS_INPUTS),
      stale: assertBoolean(value.dossier.stale),
      versionId: assertIdentifier(value.dossier.versionId),
    });
  }
  assertExactObject(value.spoilerSelection, ['level', 'userConfirmed', 'warningIncluded']);
  return Object.freeze({
    assertions: Object.freeze(assertions),
    dossier,
    memoryConfidence,
    profileId: assertIdentifier(value.profileId),
    readingState,
    readingStateRevisionId: assertIdentifier(value.readingStateRevisionId),
    spoilerSelection: Object.freeze({
      level: assertEnum(value.spoilerSelection.level, SPOILER_LEVELS),
      userConfirmed: assertBoolean(value.spoilerSelection.userConfirmed),
      warningIncluded: assertBoolean(value.spoilerSelection.warningIncluded),
    }),
    workId: assertIdentifier(value.workId),
  });
}
