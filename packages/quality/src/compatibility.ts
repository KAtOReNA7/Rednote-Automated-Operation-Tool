import type {
  AtomicClaimScopeV1,
  AtomicClaimV1,
  DateWithPrecisionValueV1,
} from '@mystery-operations/evidence';

import { TYPED_FACT_COMPATIBILITY_VERSION, type MappingRelation } from './constants.js';
import type { TypedFactCompatibilityResultV1 } from './contracts.js';
import { normalizeDraftText } from './identity.js';

interface Input {
  readonly claim: AtomicClaimV1;
  readonly expectedCurrency?: 'CNY' | 'EUR' | 'GBP' | 'JPY' | 'USD';
  readonly expectedPredicate?: string;
  readonly expectedSubjectId?: string;
  readonly expectedUnit?: string;
  readonly relation: MappingRelation;
  readonly statementScope?: Partial<AtomicClaimScopeV1>;
  readonly statementText: string;
}

const ARABIC_NUMBER =
  /(?<![A-Za-z0-9])[-+]?\d+(?:\.\d+)?(?![A-Za-z0-9])(?:\s*(?:%|％|万|亿|本|部|册|页|次|名|位|份|年|元|万元|亿元|美元|日元|人民币))?/gu;
const DATE = /(\d{4})(?:[-/.年]\s*(\d{1,2}))?(?:[-/.月]\s*(\d{1,2}))?/u;
const SCIENTIFIC_OR_NONFINITE = /(?:\b(?:NaN|Infinity)\b|\d(?:\.\d+)?[eE][+-]?\d+)/u;
const RANGE_OR_COMPARISON =
  /(?:约|大约|近|超过|高于|多于|不足|低于|少于|至少|至多|以上|以下|[-–—~～]\s*\d)/u;
const CURRENCY = /(?:人民币|CNY|RMB|￥|¥|美元|USD|\$|日元|JPY|円|欧元|EUR|€|英镑|GBP|£)/iu;
const UNIT_SUFFIX = /(?:%|％|万元|亿元|美元|日元|人民币|万|亿|本|部|册|页|次|名|位|份|年|元)\s*$/u;

function result(
  compatible: boolean,
  reasonCode: TypedFactCompatibilityResultV1['reasonCode'],
  relation: MappingRelation,
  statementValueCount: number,
  consumedValueCount: number,
): TypedFactCompatibilityResultV1 {
  return Object.freeze({
    compatible,
    consumedValueCount,
    reasonCode,
    relation,
    statementValueCount,
    version: TYPED_FACT_COMPATIBILITY_VERSION,
  });
}

function decimal(value: string): string | null {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value)) return null;
  const [integer, fraction] = value.split('.');
  if (fraction === undefined) return integer ?? null;
  const normalizedFraction = fraction.replace(/0+$/u, '');
  return normalizedFraction.length === 0 ? (integer ?? null) : `${integer}.${normalizedFraction}`;
}

interface VisibleNumber {
  readonly normalized: string;
  readonly token: string;
  readonly unit: string | null;
}

function visibleNumbers(text: string): readonly VisibleNumber[] {
  return Object.freeze(
    [...text.matchAll(ARABIC_NUMBER)]
      .map((match) => {
        const token = match[0].trim();
        const number = /^[-+]?\d+(?:\.\d+)?/u.exec(token)?.[0] ?? '';
        const normalized = decimal(number.replace(/^[+]/u, ''));
        if (normalized === null) return null;
        return Object.freeze({
          normalized,
          token,
          unit: UNIT_SUFFIX.exec(token)?.[0]?.trim() ?? null,
        });
      })
      .filter((value): value is VisibleNumber => value !== null),
  );
}

function normalizedCurrency(text: string): Input['expectedCurrency'] | null {
  const token = CURRENCY.exec(text)?.[0]?.toUpperCase();
  if (token === undefined) return null;
  if (['人民币', 'CNY', 'RMB', '￥', '¥'].includes(token)) return 'CNY';
  if (['美元', 'USD', '$'].includes(token)) return 'USD';
  if (['日元', 'JPY', '円'].includes(token)) return 'JPY';
  if (['欧元', 'EUR', '€'].includes(token)) return 'EUR';
  return 'GBP';
}

function predicateUnit(predicate: string): {
  readonly currency: Input['expectedCurrency'] | null;
  readonly unit: string | null;
} {
  const normalized = predicate.toLowerCase();
  if (/(?:percentage|percent|rate|share)/u.test(normalized)) {
    return { currency: null, unit: '%' };
  }
  const currency = /(?:_cny|rmb|yuan)/u.test(normalized)
    ? 'CNY'
    : /(?:_usd|dollar)/u.test(normalized)
      ? 'USD'
      : /(?:_jpy|yen)/u.test(normalized)
        ? 'JPY'
        : /(?:_eur|euro)/u.test(normalized)
          ? 'EUR'
          : /(?:_gbp|pound)/u.test(normalized)
            ? 'GBP'
            : null;
  return { currency, unit: null };
}

function scopeCompatible(
  statementScope: Partial<AtomicClaimScopeV1> | undefined,
  claimScope: AtomicClaimScopeV1,
): boolean {
  if (statementScope === undefined) return true;
  return (['format', 'language', 'territory'] as const).every((key) => {
    const expected = statementScope[key];
    return expected === undefined || expected === null || expected === claimScope[key];
  });
}

function dateCompatibility(
  text: string,
  value: DateWithPrecisionValueV1,
): TypedFactCompatibilityResultV1 {
  const match = DATE.exec(text);
  if (match === null) return result(false, 'CLAIM_VALUE_NOT_VISIBLE', 'VALUE_CONFLICT', 0, 0);
  const statementPrecision =
    match[3] === undefined ? (match[2] === undefined ? 'YEAR' : 'MONTH') : 'DAY';
  const statementValue =
    statementPrecision === 'YEAR'
      ? match[1]
      : statementPrecision === 'MONTH'
        ? `${match[1]}-${String(match[2]).padStart(2, '0')}`
        : `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
  const precisionRank = { DAY: 3, MONTH: 2, YEAR: 1 } as const;
  if (
    precisionRank[statementPrecision] > precisionRank[value.precision] ||
    !value.value.startsWith(statementValue ?? '')
  ) {
    return result(false, 'DATE_PRECISION_MISMATCH', 'VALUE_CONFLICT', 1, 0);
  }
  return result(true, 'COMPATIBLE', 'EXACT', 1, 1);
}

function awardPredicate(text: string): 'award_nomination' | 'award_win' | 'ranking' | null {
  if (/(?:入围|提名|候选|shortlist|nominee|候補)/iu.test(text)) return 'award_nomination';
  if (/(?:榜首|排名|TOP\s*\d+|冠军)/iu.test(text)) return 'ranking';
  if (/(?:获奖|获得[^。！？\n]{0,40}(?:奖|大奖)|大奖|winner|受賞)/iu.test(text)) {
    return 'award_win';
  }
  return null;
}

export function checkTypedFactCompatibility(input: Input): TypedFactCompatibilityResultV1 {
  const text = normalizeDraftText(input.statementText);
  if (input.expectedSubjectId !== undefined && input.claim.subject.id !== input.expectedSubjectId) {
    return result(false, 'SUBJECT_MISMATCH', 'SUBJECT_MISMATCH', 0, 0);
  }
  if (input.expectedPredicate !== undefined && input.claim.predicate !== input.expectedPredicate) {
    return result(false, 'PREDICATE_MISMATCH', 'PREDICATE_MISMATCH', 0, 0);
  }
  if (!scopeCompatible(input.statementScope, input.claim.scope)) {
    return result(false, 'SCOPE_MISMATCH', 'SCOPE_MISMATCH', 0, 0);
  }
  const award = awardPredicate(text);
  if (
    award !== null &&
    ((award === 'award_win' && input.claim.predicate !== 'award_win') ||
      (award === 'award_nomination' && input.claim.predicate !== 'award_nomination') ||
      (award === 'ranking' && !/(?:rank|ranking|list|sales)/iu.test(input.claim.predicate)))
  ) {
    return result(false, 'AWARD_PREDICATE_MISMATCH', 'PREDICATE_MISMATCH', 1, 0);
  }
  if (input.claim.valueType === 'DATE_WITH_PRECISION' || input.claim.valueType === 'DATE') {
    if (
      typeof input.claim.value !== 'object' ||
      input.claim.value === null ||
      !('precision' in input.claim.value)
    ) {
      return result(false, 'INVALID_TYPED_VALUE', 'VALUE_CONFLICT', 0, 0);
    }
    return dateCompatibility(text, input.claim.value as DateWithPrecisionValueV1);
  }
  if (input.claim.valueType === 'INTEGER' || input.claim.valueType === 'DECIMAL_TEXT') {
    if (SCIENTIFIC_OR_NONFINITE.test(text)) {
      return result(false, 'INVALID_TYPED_VALUE', 'VALUE_CONFLICT', 0, 0);
    }
    const values = visibleNumbers(text);
    const expected = decimal(String(input.claim.value));
    if (expected === null)
      return result(false, 'INVALID_TYPED_VALUE', 'VALUE_CONFLICT', values.length, 0);
    const matching = values.filter(({ normalized }) => normalized === expected);
    const consumed = matching.length;
    if (consumed === 0)
      return result(false, 'NUMERIC_VALUE_MISMATCH', 'VALUE_CONFLICT', values.length, 0);
    if (values.some(({ normalized }) => normalized !== expected))
      return result(false, 'STATEMENT_ADDS_VALUE', 'BROADER_THAN_CLAIM', values.length, consumed);
    const inferred = predicateUnit(input.claim.predicate);
    const expectedUnit = input.expectedUnit ?? inferred.unit;
    if (
      expectedUnit !== null &&
      !matching.every(({ unit }) =>
        expectedUnit === '%' ? unit === '%' || unit === '％' : unit === expectedUnit,
      )
    ) {
      return result(
        false,
        expectedUnit === '%' ? 'PERCENT_MISMATCH' : 'UNIT_MISMATCH',
        'VALUE_CONFLICT',
        values.length,
        consumed,
      );
    }
    const expectedCurrency = input.expectedCurrency ?? inferred.currency;
    if (expectedCurrency !== null && normalizedCurrency(text) !== expectedCurrency) {
      return result(false, 'CURRENCY_MISMATCH', 'VALUE_CONFLICT', values.length, consumed);
    }
    if (
      RANGE_OR_COMPARISON.test(text) &&
      !/(?:range|min|max|approx|before|after)/iu.test(input.claim.predicate)
    ) {
      return result(false, 'COMPARISON_MISMATCH', 'BROADER_THAN_CLAIM', values.length, consumed);
    }
    return result(true, 'COMPATIBLE', input.relation, values.length, consumed);
  }
  if (input.claim.valueType === 'IDENTIFIER') {
    const normalizedClaim = String(input.claim.value).replace(/[-\s]/gu, '').toUpperCase();
    const normalizedText = text.replace(/[-\s]/gu, '').toUpperCase();
    return normalizedText.includes(normalizedClaim)
      ? result(true, 'COMPATIBLE', input.relation, 1, 1)
      : result(false, 'IDENTIFIER_MISMATCH', 'VALUE_CONFLICT', 1, 0);
  }
  if (input.claim.valueType === 'BOOLEAN') {
    return typeof input.claim.value === 'boolean'
      ? result(true, 'COMPATIBLE', input.relation, 1, 1)
      : result(false, 'INVALID_TYPED_VALUE', 'VALUE_CONFLICT', 0, 0);
  }
  if (input.claim.valueType === 'ENTITY_REF') {
    return typeof input.claim.value === 'object' && input.claim.value !== null
      ? result(true, 'COMPATIBLE', input.relation, 1, 1)
      : result(false, 'INVALID_TYPED_VALUE', 'VALUE_CONFLICT', 0, 0);
  }
  const expectedText = String(input.claim.value).normalize('NFC').trim();
  if (expectedText.length === 0)
    return result(false, 'INVALID_TYPED_VALUE', 'VALUE_CONFLICT', 0, 0);
  return text.includes(expectedText)
    ? result(true, 'COMPATIBLE', input.relation, 1, 1)
    : input.relation === 'SUPPORTED_PARAPHRASE' || input.relation === 'NARROWER_THAN_CLAIM'
      ? result(true, 'COMPATIBLE', input.relation, 1, 1)
      : result(false, 'CLAIM_VALUE_NOT_VISIBLE', 'VALUE_CONFLICT', 1, 0);
}
