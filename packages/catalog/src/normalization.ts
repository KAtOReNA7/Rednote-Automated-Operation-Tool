import { BIBLIOGRAPHY_NORMALIZATION_VERSION } from './constants.js';

export interface NormalizedTextV1 {
  readonly normalized: string;
  readonly raw: string;
  readonly version: typeof BIBLIOGRAPHY_NORMALIZATION_VERSION;
}

export interface CanonicalIdentifierV1 {
  readonly errorCode: 'INVALID_CHECK_DIGIT' | 'INVALID_FORMAT' | null;
  readonly namespace: string;
  readonly normalizedValue: string | null;
  readonly rawValue: string;
  readonly valid: boolean;
}

const PUNCTUATION =
  /[\p{Dash_Punctuation}\p{Connector_Punctuation}\p{Open_Punctuation}\p{Close_Punctuation}\p{Initial_Punctuation}\p{Final_Punctuation}\p{Other_Punctuation}\p{Symbol}]+/gu;
const SPACE = /\s+/gu;
const SAFE_SCOPE = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const SAFE_SCOPED_VALUE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

export function normalizeBibliographicText(raw: string): NormalizedTextV1 {
  if (
    typeof raw !== 'string' ||
    raw.length === 0 ||
    raw.length > 2_000 ||
    containsControlCharacter(raw)
  ) {
    throw new TypeError('bibliographic text is invalid');
  }
  const normalized = raw
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(PUNCTUATION, ' ')
    .replace(SPACE, ' ')
    .trim();
  if (normalized.length === 0) {
    throw new TypeError('bibliographic text normalizes to empty');
  }
  return Object.freeze({
    normalized,
    raw,
    version: BIBLIOGRAPHY_NORMALIZATION_VERSION,
  });
}

export function detectScriptHints(value: string): readonly string[] {
  const scripts = new Set<string>();
  if (/\p{Script=Han}/u.test(value)) scripts.add('HANI');
  if (/\p{Script=Hiragana}/u.test(value)) scripts.add('HIRA');
  if (/\p{Script=Katakana}/u.test(value)) scripts.add('KANA');
  if (/\p{Script=Latin}/u.test(value)) scripts.add('LATN');
  return Object.freeze([...scripts]);
}

function validIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/u.test(value)) return false;
  const total = [...value].reduce(
    (sum, character, index) => sum + (character === 'X' ? 10 : Number(character)) * (10 - index),
    0,
  );
  return total % 11 === 0;
}

function validIsbn13(value: string): boolean {
  if (!/^\d{13}$/u.test(value)) return false;
  const total = [...value.slice(0, 12)].reduce(
    (sum, character, index) => sum + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  const check = (10 - (total % 10)) % 10;
  return check === Number(value[12]);
}

function isbn10To13(value: string): string {
  const base = `978${value.slice(0, 9)}`;
  const total = [...base].reduce(
    (sum, character, index) => sum + Number(character) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return `${base}${(10 - (total % 10)) % 10}`;
}

export function canonicalizeIsbn(rawValue: string): CanonicalIdentifierV1 {
  const compact = rawValue.normalize('NFKC').replace(/[\s-]/gu, '').toUpperCase();
  if (/^\d{9}[\dX]$/u.test(compact)) {
    return validIsbn10(compact)
      ? Object.freeze({
          errorCode: null,
          namespace: 'ISBN_13',
          normalizedValue: isbn10To13(compact),
          rawValue,
          valid: true,
        })
      : Object.freeze({
          errorCode: 'INVALID_CHECK_DIGIT',
          namespace: 'ISBN_13',
          normalizedValue: null,
          rawValue,
          valid: false,
        });
  }
  if (/^\d{13}$/u.test(compact)) {
    return validIsbn13(compact)
      ? Object.freeze({
          errorCode: null,
          namespace: 'ISBN_13',
          normalizedValue: compact,
          rawValue,
          valid: true,
        })
      : Object.freeze({
          errorCode: 'INVALID_CHECK_DIGIT',
          namespace: 'ISBN_13',
          normalizedValue: null,
          rawValue,
          valid: false,
        });
  }
  return Object.freeze({
    errorCode: 'INVALID_FORMAT',
    namespace: 'ISBN_13',
    normalizedValue: null,
    rawValue,
    valid: false,
  });
}

export function canonicalizeScopedIdentifier(
  kind: 'PLATFORM' | 'PUBLISHER',
  scope: string,
  rawValue: string,
): CanonicalIdentifierV1 {
  const normalizedScope = scope.normalize('NFKC').toLocaleLowerCase('und').trim();
  const normalizedValue = rawValue.normalize('NFKC').trim();
  if (!SAFE_SCOPE.test(normalizedScope) || !SAFE_SCOPED_VALUE.test(normalizedValue)) {
    return Object.freeze({
      errorCode: 'INVALID_FORMAT',
      namespace: `${kind}:${normalizedScope || 'invalid'}`,
      normalizedValue: null,
      rawValue,
      valid: false,
    });
  }
  return Object.freeze({
    errorCode: null,
    namespace: `${kind}:${normalizedScope}`,
    normalizedValue,
    rawValue,
    valid: true,
  });
}
