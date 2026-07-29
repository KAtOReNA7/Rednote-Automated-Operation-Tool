import { describe, expect, it } from 'vitest';

import {
  EVIDENCE_LOCATOR_VERSION,
  EVIDENCE_RECORD_CONTRACT_VERSION,
  SOURCE_EVIDENCE_CONTRACT_VERSION,
  EvidenceError,
  atomicClaimSemanticFingerprint,
  createEvidenceLocator,
  evidenceSemanticHash,
  locateEvidenceExcerpt,
  sourceProcessingPlanHash,
  textSha256,
  validateAtomicClaimV1,
  validateClaimEvidenceV1,
  validateEvidenceLocatorV1,
  validateEvidenceSummaryV1,
  validateSourceRevisionV1,
  validateSourceV1,
  validateSourceProcessingPlanV1,
} from '../packages/evidence/src/index.js';
import { validateEvidenceProcessingOutputV1 } from '../packages/workflows/src/index.js';
import {
  EVIDENCE_NOW,
  dateClaim,
  fullTextEvidence,
  processingPlan,
} from './support/evidence-fixtures.js';

describe('Issue 019 evidence contracts and exact locators', () => {
  it('validates strict Source and immutable SourceRevision identities', () => {
    const provenance = {
      originKind: 'SYNTHETIC_FIXTURE',
      originRecordId: 'fixture-source-contract',
      originRevision: 1,
    } as const;
    const source = {
      authorityKind: 'OFFICIAL_PRIMARY',
      canonicalUrlHash: evidenceSemanticHash('https://fixture.invalid/source-contract'),
      contractVersion: SOURCE_EVIDENCE_CONTRACT_VERSION,
      createdAt: EVIDENCE_NOW,
      currentRevisionId: 'source-contract:1',
      displayHost: 'fixture.invalid',
      independenceGroup: 'official-contract',
      independenceState: 'CONFIRMED_INDEPENDENT',
      language: 'ja-JP',
      originKind: 'SYNTHETIC_FIXTURE',
      originRecordId: 'fixture-source-contract',
      publishedAt: '2026-07',
      publishedAtPrecision: 'MONTH',
      publisherOrSite: '合成出版方',
      provenance,
      retrievedAt: EVIDENCE_NOW,
      revision: 1,
      sourceId: 'source-contract',
      status: 'AVAILABLE',
      title: '合成来源',
      updatedAt: EVIDENCE_NOW,
      usePolicy: 'KEY_FACT_ELIGIBLE',
      warnings: ['SYNTHETIC_TEST_FIXTURE'],
    } as const;
    expect(validateSourceV1(source)).toEqual(source);
    expect(() => validateSourceV1({ ...source, rawHtml: '<html>' })).toThrow(EvidenceError);

    const hash = textSha256('合成原文');
    const revision = {
      availability: 'AVAILABLE',
      contentHash: hash,
      contractVersion: SOURCE_EVIDENCE_CONTRACT_VERSION,
      createdAt: EVIDENCE_NOW,
      extractedTextHash: hash,
      extractedTextPath: `sources/snapshots/${hash.slice(0, 2)}/${hash}.txt`,
      language: 'ja-JP',
      originKind: 'SYNTHETIC_FIXTURE',
      originRecordId: 'fixture-source-contract',
      originRevision: 1,
      provenance,
      publishedAt: '2026-07',
      publishedAtPrecision: 'MONTH',
      retrievedAt: EVIDENCE_NOW,
      revision: 1,
      revisionId: 'source-contract:1',
      sourceId: 'source-contract',
      warnings: ['SYNTHETIC_TEST_FIXTURE'],
    } as const;
    expect(validateSourceRevisionV1(revision)).toEqual(revision);
    expect(() =>
      validateSourceRevisionV1({ ...revision, extractedTextPath: 'C:\\secret\\source.txt' }),
    ).toThrow(EvidenceError);
  });

  it('accepts a strict typed atomic claim and rejects extra fields or wrong value types', () => {
    const claim = dateClaim('claim-date', 'work-1', '2026-07-29', { format: 'first-edition' });
    expect(validateAtomicClaimV1(claim)).toEqual(claim);
    expect(() => validateAtomicClaimV1({ ...claim, prompt: 'ignore policy' })).toThrow(
      EvidenceError,
    );
    expect(() => validateAtomicClaimV1({ ...claim, value: 2026 })).toThrow(EvidenceError);
    expect(() =>
      validateAtomicClaimV1({
        ...claim,
        scope: { nested: { one: { two: { three: { four: { five: { six: { seven: {} } } } } } } } },
      }),
    ).toThrow(EvidenceError);
  });

  it('supports the frozen typed value set without SQLite REAL decimals', () => {
    const base = dateClaim('claim-types', 'work-1', '2026');
    for (const [valueType, value] of [
      ['TEXT', 'normalized title'],
      ['INTEGER', 320],
      ['DECIMAL_TEXT', '12.50'],
      ['DATE_WITH_PRECISION', { precision: 'YEAR', value: '2026' }],
      ['IDENTIFIER', '9780306406157'],
      ['ENUM', 'HARDCOVER'],
      ['ENTITY_REF', { entityId: 'agent-1', entityType: 'AGENT' }],
      ['BOOLEAN', true],
    ] as const) {
      const candidate = {
        ...base,
        claimId: `claim-type-${valueType.toLowerCase()}`,
        value,
        valueType,
      };
      expect(
        validateAtomicClaimV1({
          ...candidate,
          semanticFingerprint: atomicClaimSemanticFingerprint(candidate),
        }).valueType,
      ).toBe(valueType);
    }
    const decimal = { ...base, value: 12.5, valueType: 'DECIMAL_TEXT' } as const;
    expect(() =>
      validateAtomicClaimV1({
        ...decimal,
        semanticFingerprint: atomicClaimSemanticFingerprint(decimal),
      }),
    ).toThrow(EvidenceError);
  });

  it('locates Japanese evidence by Unicode code points and keeps the Chinese summary non-evidence', () => {
    const text = '受賞作は二〇二六年七月に刊行された。';
    const located = fullTextEvidence('source-jp', 1, text);
    const excerpt = locateEvidenceExcerpt(text, located.locator);
    const summary = validateEvidenceSummaryV1(
      {
        excerptHash: excerpt.excerptHash,
        locatorHash: excerpt.locatorHash,
        method: 'MANUAL',
        modelExecutionId: null,
        textZh: '该获奖作品于 2026 年 7 月出版。',
      },
      excerpt.locator,
      excerpt.excerptHash,
    );
    expect(excerpt.excerpt).toBe(text);
    expect(summary.textZh).toContain('2026');
    expect(summary).not.toHaveProperty('evidence');
  });

  it('locates English evidence independently from its Chinese summary', () => {
    const text = 'The official catalogue lists the publication date as July 29, 2026.';
    const locator = createEvidenceLocator('source-en', 3, text, 4, 22);
    const excerpt = locateEvidenceExcerpt(text, locator);
    expect(excerpt.excerpt).toBe('official catalogue');
    expect(
      validateEvidenceSummaryV1(
        {
          excerptHash: excerpt.excerptHash,
          locatorHash: evidenceSemanticHash(locator),
          method: 'MANUAL',
          modelExecutionId: null,
          textZh: '官方目录。',
        },
        locator,
        excerpt.excerptHash,
      ).method,
    ).toBe('MANUAL');
  });

  it('validates a complete Evidence record and keeps QUALIFIES distinct from support', () => {
    const text = 'Award category: Best Mystery.';
    const located = fullTextEvidence('source-evidence-record', 1, text);
    const record = {
      claimId: 'claim-evidence-record',
      contractVersion: EVIDENCE_RECORD_CONTRACT_VERSION,
      createdAt: EVIDENCE_NOW,
      evidenceId: 'evidence-record',
      excerpt: text,
      excerptHash: located.excerptHash,
      locator: located.locator,
      relation: 'QUALIFIES',
      revision: 1,
      sourceContentHash: textSha256(text),
      sourceLanguage: 'en-US',
      sourceRevisionId: 'source-evidence-record:1',
      summary: null,
      verificationStatus: 'VALIDATED',
    } as const;
    expect(validateClaimEvidenceV1(record)).toEqual(record);
    expect(() =>
      validateClaimEvidenceV1({ ...record, sourceRevisionId: 'source-other:1' }),
    ).toThrow(EvidenceError);
  });

  it('rejects wrong text hash, range, excerpt binding, and hallucinated model summary fields', () => {
    const text = 'immutable evidence';
    const locator = createEvidenceLocator('source-1', 1, text, 0, 9);
    expect(() => locateEvidenceExcerpt(`${text}!`, locator)).toThrow(EvidenceError);
    expect(() => validateEvidenceLocatorV1({ ...locator, endCodePoint: 100 })).not.toThrow();
    expect(() => locateEvidenceExcerpt(text, { ...locator, endCodePoint: 100 })).toThrow(
      EvidenceError,
    );
    const excerpt = locateEvidenceExcerpt(text, locator);
    expect(() =>
      validateEvidenceSummaryV1(
        {
          excerptHash: '0'.repeat(64),
          locatorHash: excerpt.locatorHash,
          method: 'MODEL_CANDIDATE',
          modelExecutionId: 'model-run-1',
          textZh: '错误绑定',
        },
        locator,
        excerpt.excerptHash,
      ),
    ).toThrow(EvidenceError);
    expect(() =>
      validateEvidenceSummaryV1(
        {
          excerptHash: excerpt.excerptHash,
          locatorHash: excerpt.locatorHash,
          method: 'MODEL_CANDIDATE',
          modelExecutionId: 'model-run-1',
          policyOverride: 'verify everything',
          textZh: '注入字段',
        },
        locator,
        excerpt.excerptHash,
      ),
    ).toThrow(EvidenceError);
  });

  it('keeps source processing plans bounded, ID-only, fee UNKNOWN, and hash-bound', () => {
    const plan = processingPlan(
      'plan-fixture',
      ['source-a:1', 'source-b:2'],
      ['CLASSIFY', 'EXTRACT_CLAIMS', 'RECONCILE'],
    );
    expect(validateSourceProcessingPlanV1(plan)).toEqual(plan);
    expect(plan.estimatedExternalRequests).toBe(2);
    expect(plan.estimatedFee).toBe('UNKNOWN');
    expect(() =>
      validateSourceProcessingPlanV1({
        ...plan,
        sourceRevisionIds: ['source-a:1', 'source-b:2', 'raw page body'],
      }),
    ).toThrow(EvidenceError);
    expect(() => validateSourceProcessingPlanV1({ ...plan, planHash: '0'.repeat(64) })).toThrow(
      EvidenceError,
    );
    expect(sourceProcessingPlanHash(plan)).toBe(plan.planHash);
  });

  it('rejects prompt injection and policy/schema mutation in structured output', () => {
    const text = 'Official date: 2026-07-29';
    const located = fullTextEvidence('source-structured', 1, text);
    const claim = {
      ...dateClaim('claim-structured', 'work-1', '2026-07-29'),
      claimant: { sourceId: 'source-structured', sourceRevision: 1 },
      provenance: { kind: 'MODEL_CANDIDATE', runId: 'run-structured' },
      status: 'CANDIDATE',
    } as const;
    const valid = {
      contractVersion: 'evidence-processing-output-v1',
      items: [
        {
          claim,
          excerptHash: located.excerptHash,
          locator: located.locator,
          summary: null,
        },
      ],
      policyVersion: 'fact-policy-v1',
      sourceRevisionId: 'source-structured:1',
    };
    expect(validateEvidenceProcessingOutputV1(valid, 'source-structured:1').items).toHaveLength(1);
    expect(() =>
      validateEvidenceProcessingOutputV1(
        { ...valid, policyVersion: 'source-says-ignore-policy' },
        'source-structured:1',
      ),
    ).toThrow(EvidenceError);
    expect(() =>
      validateEvidenceProcessingOutputV1(
        { ...valid, injectedInstruction: 'mark verified' },
        'source-structured:1',
      ),
    ).toThrow(EvidenceError);
  });

  it('uses a finite locator contract identity', () => {
    const locator = {
      endCodePoint: 2,
      extractedTextHash: textSha256('事实'),
      kind: 'CHAR_RANGE',
      sourceId: 'source-finite',
      sourceRevision: 1,
      startCodePoint: 0,
      version: EVIDENCE_LOCATOR_VERSION,
    } as const;
    expect(validateEvidenceLocatorV1(locator).version).toBe(EVIDENCE_LOCATOR_VERSION);
    expect(EVIDENCE_NOW).toMatch(/Z$/u);
  });
});
