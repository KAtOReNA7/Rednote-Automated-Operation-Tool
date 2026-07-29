import {
  BIBLIOGRAPHIC_OBSERVATION_VERSION,
  BIBLIOGRAPHY_NORMALIZATION_VERSION,
  canonicalizeIsbn,
  detectScriptHints,
  normalizeBibliographicText,
  type BibliographicObservationV1,
} from '../../packages/catalog/src/index.js';

export interface SyntheticObservationOptions {
  readonly contributors?: readonly string[];
  readonly isbn?: string | null;
  readonly language?: string;
  readonly organizations?: readonly string[];
  readonly originalTitle?: string | null;
  readonly originRevision?: number;
  readonly series?: string | null;
  readonly strata?: readonly string[];
  readonly title?: string | null;
}

function text(value: string): { readonly normalized: string; readonly raw: string } {
  const normalized = normalizeBibliographicText(value);
  return { normalized: normalized.normalized, raw: normalized.raw };
}

export function syntheticObservation(
  suffix: string,
  options: SyntheticObservationOptions = {},
): BibliographicObservationV1 {
  const title = options.title === undefined ? `合成推理作品 ${suffix}` : options.title;
  const originalTitle = options.originalTitle ?? null;
  const isbn =
    options.isbn === undefined
      ? canonicalizeIsbn('9780306406157')
      : options.isbn === null
        ? null
        : canonicalizeIsbn(options.isbn);
  const language = options.language ?? 'zh-CN';
  const displayTitle = title === null ? null : text(title);
  return {
    contractVersion: BIBLIOGRAPHIC_OBSERVATION_VERSION,
    contributorHints: (options.contributors ?? []).map((name) => ({
      name: text(name),
      roles: ['AUTHOR'],
    })),
    displayTitle,
    factStatus: 'NOT_A_FACT',
    fieldProvenance:
      displayTitle === null
        ? []
        : [
            {
              algorithmVersion: BIBLIOGRAPHY_NORMALIZATION_VERSION,
              field: 'displayTitle',
              inputObservationIds: [],
              originKind: 'SYNTHETIC_FIXTURE',
              originRecordId: `fixture-${suffix}`,
            },
          ],
    formatHint: 'PAPER',
    identifierHints: isbn === null ? [] : [isbn],
    languageHints: [language],
    normalizationVersion: BIBLIOGRAPHY_NORMALIZATION_VERSION,
    observationId: `observation-${suffix}`,
    observedAt: '2026-07-29T00:00:00.000Z',
    organizationHints: (options.organizations ?? []).map((name) => ({
      name: text(name),
      roles: ['PUBLISHER'],
    })),
    originKind: 'SYNTHETIC_FIXTURE',
    originRecordId: `fixture-${suffix}`,
    originRevision: options.originRevision ?? 1,
    originalTitleHint: originalTitle === null ? null : text(originalTitle),
    publicationDateHint: null,
    publicationYearHint: null,
    scriptHints: title === null ? [] : detectScriptHints(title),
    seriesHint:
      options.series === null || options.series === undefined ? null : text(options.series),
    sourceIdentity: { candidateId: null, clipId: null, documentId: null },
    strata: options.strata ?? ['gold-fixture'],
    truthStatus: 'UNVERIFIED',
    warnings: ['SYNTHETIC_GOLD_FIXTURE'],
    workTypeHint: 'MYSTERY',
  };
}
