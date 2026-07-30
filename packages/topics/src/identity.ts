import { createHash } from 'node:crypto';

import {
  TOPIC_FINGERPRINT_POLICY_VERSION,
  type TopicAnalysisMode,
  type TopicComparisonDimension,
  type TopicContentType,
} from './constants.js';
import { TopicError } from './errors.js';

function canonicalize(value: unknown): unknown {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) throw new TopicError('TOPIC_INVALID_CONTRACT');
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }
  throw new TopicError('TOPIC_INVALID_CONTRACT');
}

export function canonicalTopicJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function topicSemanticHash(value: unknown): string {
  return createHash('sha256').update(canonicalTopicJson(value)).digest('hex');
}

export function normalizeTopicAngleIntent(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\p{P}\p{S}\s]+/gu, ' ')
    .trim()
    .replace(/\s+/gu, ' ');
  if (normalized.length === 0) throw new TopicError('TOPIC_INVALID_CONTRACT');
  return normalized;
}

export interface TopicSemanticFingerprintInput {
  readonly analysisMode: TopicAnalysisMode;
  readonly comparisonDimension: TopicComparisonDimension | null;
  readonly contentType: TopicContentType;
  readonly normalizedAngleIntent: string;
  readonly spoilerLevel: 'NO_SPOILER' | 'LIGHT_SPOILER' | 'FULL_TRICK_ANALYSIS';
  readonly subjectIds: readonly string[];
}

export interface TopicSemanticFingerprint {
  readonly canonicalSubjectSet: readonly string[];
  readonly descriptor: Readonly<{
    analysisMode: TopicAnalysisMode;
    comparisonDimension: TopicComparisonDimension | null;
    contentType: TopicContentType;
    normalizedAngleIntent: string;
    policyVersion: typeof TOPIC_FINGERPRINT_POLICY_VERSION;
    spoilerLevel: TopicSemanticFingerprintInput['spoilerLevel'];
    subjects: readonly string[];
  }>;
  readonly fingerprint: string;
}

export function createTopicSemanticFingerprint(
  input: TopicSemanticFingerprintInput,
): TopicSemanticFingerprint {
  const canonicalSubjectSet = Object.freeze([...new Set(input.subjectIds)].sort());
  if (canonicalSubjectSet.length === 0) throw new TopicError('TOPIC_INVALID_CONTRACT');
  const descriptor = Object.freeze({
    analysisMode: input.analysisMode,
    comparisonDimension: input.comparisonDimension,
    contentType: input.contentType,
    normalizedAngleIntent: normalizeTopicAngleIntent(input.normalizedAngleIntent),
    policyVersion: TOPIC_FINGERPRINT_POLICY_VERSION,
    spoilerLevel: input.spoilerLevel,
    subjects: canonicalSubjectSet,
  });
  return Object.freeze({
    canonicalSubjectSet,
    descriptor,
    fingerprint: topicSemanticHash(descriptor),
  });
}
