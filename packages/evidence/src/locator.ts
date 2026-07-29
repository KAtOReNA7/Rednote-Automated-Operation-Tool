import {
  EVIDENCE_LIMITS,
  EVIDENCE_LOCATOR_VERSION,
  type SourceAvailabilityState,
} from './constants.js';
import { type EvidenceLocatorV1, validateEvidenceLocatorV1 } from './contracts.js';
import { EvidenceError } from './errors.js';
import { evidenceSemanticHash, textSha256 } from './identity.js';

export interface LocatedExcerptV1 {
  readonly excerpt: string;
  readonly excerptHash: string;
  readonly locator: EvidenceLocatorV1;
  readonly locatorHash: string;
}

export function locateEvidenceExcerpt(
  extractedText: string,
  locatorValue: EvidenceLocatorV1,
  availability: SourceAvailabilityState = 'AVAILABLE',
): LocatedExcerptV1 {
  const locator = validateEvidenceLocatorV1(locatorValue);
  if (
    availability !== 'AVAILABLE' ||
    Buffer.byteLength(extractedText, 'utf8') > 2 * 1024 * 1024 ||
    textSha256(extractedText) !== locator.extractedTextHash
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_LOCATOR');
  }
  const codePoints = Array.from(extractedText);
  if (locator.endCodePoint > codePoints.length) {
    throw new EvidenceError('EVIDENCE_INVALID_LOCATOR');
  }
  const excerpt = codePoints.slice(locator.startCodePoint, locator.endCodePoint).join('');
  if (
    excerpt.trim().length < 1 ||
    excerpt.length > EVIDENCE_LIMITS.excerptCharacters ||
    Buffer.byteLength(excerpt, 'utf8') > EVIDENCE_LIMITS.locatorCharacters * 4
  ) {
    throw new EvidenceError('EVIDENCE_INVALID_LOCATOR');
  }
  return Object.freeze({
    excerpt,
    excerptHash: textSha256(excerpt),
    locator,
    locatorHash: evidenceSemanticHash(locator),
  });
}

export function createEvidenceLocator(
  sourceId: string,
  sourceRevision: number,
  extractedText: string,
  startCodePoint: number,
  endCodePoint: number,
): EvidenceLocatorV1 {
  return validateEvidenceLocatorV1({
    endCodePoint,
    extractedTextHash: textSha256(extractedText),
    kind: 'CHAR_RANGE',
    sourceId,
    sourceRevision,
    startCodePoint,
    version: EVIDENCE_LOCATOR_VERSION,
  });
}
