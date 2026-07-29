import { describe, expect, it } from 'vitest';

import {
  BIBLIOGRAPHY_NORMALIZATION_VERSION,
  CatalogConfirmationBroker,
  CatalogError,
  canonicalizeIsbn,
  canonicalizeScopedIdentifier,
  compareBibliographicEntities,
  detectScriptHints,
  normalizeBibliographicText,
  validateBibliographicObservationV1,
} from '../packages/catalog/src/index.js';
import { syntheticObservation } from './support/bibliography-fixtures.js';

describe('Issue 018 bibliography contracts and conservative resolution', () => {
  it('validates exact immutable Observation fields and frozen truth status', () => {
    const observation = syntheticObservation('contract', {
      contributors: ['合成作者'],
      originalTitle: 'Ｓｙｎｔｈｅｔｉｃ　Ｔｉｔｌｅ',
      organizations: ['合成出版社'],
    });
    expect(validateBibliographicObservationV1(observation)).toBe(observation);
    expect(() =>
      validateBibliographicObservationV1({ ...observation, secret: 'must-not-pass' }),
    ).toThrowError(CatalogError);
    expect(() =>
      validateBibliographicObservationV1({ ...observation, truthStatus: 'VERIFIED' }),
    ).toThrowError(CatalogError);
    expect(JSON.stringify(observation)).not.toMatch(
      /api.?key|authorization|absolutePath|queryText|rawResponse/iu,
    );
  });

  it('normalizes Chinese, Japanese, Latin, full-width and combining text deterministically', () => {
    const first = normalizeBibliographicText('  ＴＨＥ—雪国：Mystery  ');
    const second = normalizeBibliographicText('the 雪国 mystery');
    expect(first).toMatchObject({
      normalized: 'the 雪国 mystery',
      raw: '  ＴＨＥ—雪国：Mystery  ',
      version: BIBLIOGRAPHY_NORMALIZATION_VERSION,
    });
    expect(second.normalized).toBe(first.normalized);
    expect(normalizeBibliographicText('Cafe\u0301').normalized).toBe(
      normalizeBibliographicText('Café').normalized,
    );
    expect(detectScriptHints('謎ミステリー Mystery')).toEqual(['HANI', 'KANA', 'LATN']);
    expect(() => normalizeBibliographicText('bad\u0000value')).toThrow();
    expect(normalizeBibliographicText('valid after rejected control').normalized).toBe(
      'valid after rejected control',
    );
  });

  it('canonicalizes valid ISBN-10/13 and preserves invalid hints without canonical identity', () => {
    expect(canonicalizeIsbn('0-306-40615-2')).toMatchObject({
      namespace: 'ISBN_13',
      normalizedValue: '9780306406157',
      valid: true,
    });
    expect(canonicalizeIsbn('978-0-306-40615-7')).toMatchObject({
      normalizedValue: '9780306406157',
      valid: true,
    });
    expect(canonicalizeIsbn('9780306406158')).toMatchObject({
      errorCode: 'INVALID_CHECK_DIGIT',
      normalizedValue: null,
      valid: false,
    });
    expect(canonicalizeIsbn('not-isbn')).toMatchObject({
      errorCode: 'INVALID_FORMAT',
      normalizedValue: null,
      valid: false,
    });
  });

  it('requires a scoped namespace for platform and publisher identifiers', () => {
    expect(canonicalizeScopedIdentifier('PLATFORM', 'synthetic-web', 'work/42')).toEqual({
      errorCode: null,
      namespace: 'PLATFORM:synthetic-web',
      normalizedValue: 'work/42',
      rawValue: 'work/42',
      valid: true,
    });
    expect(canonicalizeScopedIdentifier('PUBLISHER', 'synthetic-catalog', 'A-19')).toMatchObject({
      namespace: 'PUBLISHER:synthetic-catalog',
      normalizedValue: 'A-19',
      valid: true,
    });
    expect(canonicalizeScopedIdentifier('PLATFORM', '', 'global-id').valid).toBe(false);
  });

  it('only exact-links same-type Edition identities with compatible context', () => {
    const edition = {
      contributorAliases: ['作者甲'],
      entityId: 'edition-a',
      entityType: 'EDITION' as const,
      identifiers: [{ namespace: 'ISBN_13', normalizedValue: '9780306406157' }],
      language: 'zh-CN',
      normalizedTitle: '合成谜案',
    };
    expect(
      compareBibliographicEntities(edition, { ...edition, entityId: 'edition-b' }).outcome,
    ).toBe('EXACT_LINK');
    expect(
      compareBibliographicEntities(edition, {
        ...edition,
        entityId: 'edition-c',
        normalizedTitle: '冲突题名',
      }).outcome,
    ).toBe('CONFLICT');
    expect(
      compareBibliographicEntities(
        { ...edition, identifiers: [], entityId: 'edition-d' },
        { ...edition, identifiers: [], entityId: 'edition-e' },
      ).outcome,
    ).toBe('PROBABLE_REVIEW');
    expect(
      compareBibliographicEntities(edition, {
        ...edition,
        entityId: 'work-a',
        entityType: 'WORK',
      }).outcome,
    ).toBe('CONFLICT');
  });

  it('binds confirmation to a window, sender, preview hash, expiry and single use', () => {
    let current = new Date('2026-07-29T00:00:00.000Z');
    const broker = new CatalogConfirmationBroker(() => current, 1_000);
    const issued = broker.issue({ decision: 'merge' }, 12, 34);
    expect(() => broker.consume(issued.token, issued.previewHash, 99, 34)).toThrowError(
      CatalogError,
    );
    const second = broker.issue({ decision: 'split' }, 12, 34);
    expect(broker.consume(second.token, second.previewHash, 12, 34)).toEqual({
      decision: 'split',
    });
    expect(() => broker.consume(second.token, second.previewHash, 12, 34)).toThrowError(
      CatalogError,
    );
    const expired = broker.issue({ decision: 'undo' }, 12, 34);
    current = new Date('2026-07-29T00:00:02.000Z');
    expect(() => broker.consume(expired.token, expired.previewHash, 12, 34)).toThrowError(
      CatalogError,
    );
  });
});
