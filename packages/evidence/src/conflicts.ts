import type { ClaimValueType, FACT_POLICY_VERSION } from './constants.js';
import type { AtomicClaimValueV1, DateWithPrecisionValueV1 } from './contracts.js';
import { normalizedClaimValue } from './contracts.js';

export interface ConflictComparableClaimV1 {
  readonly claimId: string;
  readonly multipleAllowed: boolean;
  readonly normalizedScopeHash: string;
  readonly policyVersion: typeof FACT_POLICY_VERSION;
  readonly predicate: string;
  readonly subjectId: string;
  readonly subjectType: string;
  readonly value: AtomicClaimValueV1;
  readonly valueType: ClaimValueType;
}

export interface MaterialConflictResultV1 {
  readonly conflict: boolean;
  readonly key: string;
  readonly reason:
    | 'COMPATIBLE_DATE_PRECISION'
    | 'DIFFERENT_SCOPE'
    | 'IDENTICAL_VALUE'
    | 'MATERIAL_VALUE_DIFFERENCE'
    | 'MULTIVALUE_ALLOWED'
    | 'NOT_COMPARABLE';
}

interface DateInterval {
  readonly end: number;
  readonly start: number;
}

function dateInterval(value: string | DateWithPrecisionValueV1): DateInterval {
  if (typeof value !== 'string') return dateInterval(value.value);
  const parts = value.split('-').map(Number);
  const year = parts[0];
  if (year === undefined) throw new TypeError('Invalid date claim.');
  if (parts.length === 1) {
    return {
      end: Date.UTC(year, 11, 31, 23, 59, 59, 999),
      start: Date.UTC(year, 0, 1),
    };
  }
  const month = parts[1];
  if (month === undefined) throw new TypeError('Invalid date claim.');
  if (parts.length === 2) {
    return {
      end: Date.UTC(year, month, 0, 23, 59, 59, 999),
      start: Date.UTC(year, month - 1, 1),
    };
  }
  const day = parts[2];
  if (day === undefined) throw new TypeError('Invalid date claim.');
  const instant = Date.UTC(year, month - 1, day);
  return { end: instant + 86_400_000 - 1, start: instant };
}

function conflictKey(claim: ConflictComparableClaimV1): string {
  return [
    claim.subjectType,
    claim.subjectId,
    claim.predicate,
    claim.normalizedScopeHash,
    claim.policyVersion,
  ].join(':');
}

export function detectMaterialConflict(
  left: ConflictComparableClaimV1,
  right: ConflictComparableClaimV1,
): MaterialConflictResultV1 {
  const key = conflictKey(left);
  if (
    left.subjectType !== right.subjectType ||
    left.subjectId !== right.subjectId ||
    left.predicate !== right.predicate ||
    left.policyVersion !== right.policyVersion ||
    left.valueType !== right.valueType
  ) {
    return Object.freeze({ conflict: false, key, reason: 'NOT_COMPARABLE' });
  }
  if (left.normalizedScopeHash !== right.normalizedScopeHash) {
    return Object.freeze({ conflict: false, key, reason: 'DIFFERENT_SCOPE' });
  }
  const leftValue = normalizedClaimValue(left.value, left.valueType);
  const rightValue = normalizedClaimValue(right.value, right.valueType);
  if (leftValue === rightValue) {
    return Object.freeze({ conflict: false, key, reason: 'IDENTICAL_VALUE' });
  }
  if (left.multipleAllowed || right.multipleAllowed) {
    return Object.freeze({ conflict: false, key, reason: 'MULTIVALUE_ALLOWED' });
  }
  if (left.valueType === 'DATE' || left.valueType === 'DATE_WITH_PRECISION') {
    const leftInterval = dateInterval(left.value as string | DateWithPrecisionValueV1);
    const rightInterval = dateInterval(right.value as string | DateWithPrecisionValueV1);
    if (leftInterval.start <= rightInterval.end && rightInterval.start <= leftInterval.end) {
      return Object.freeze({
        conflict: false,
        key,
        reason: 'COMPATIBLE_DATE_PRECISION',
      });
    }
  }
  return Object.freeze({ conflict: true, key, reason: 'MATERIAL_VALUE_DIFFERENCE' });
}
