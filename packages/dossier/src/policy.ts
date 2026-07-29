import {
  DOSSIER_COVERAGE_POLICY_VERSION,
  DOSSIER_FACT_STATUSES,
  DOSSIER_LIMITS,
  DOSSIER_SCHEMA_VERSION,
  DOSSIER_SECTIONS,
  type DossierFactStatus,
  type DossierGapReasonCode,
  type DossierSectionKey,
  type DossierSubjectType,
} from './constants.js';
import {
  assertDossierDependency,
  assertDossierProjectionInput,
  type DossierCoverageSnapshot,
  type DossierDependency,
  type DossierEntry,
  type DossierFactInput,
  type DossierGap,
  type DossierProjection,
  type DossierProjectionInput,
  type DossierSection,
  type DossierSectionCoverage,
} from './contracts.js';
import { DossierError } from './errors.js';
import { dossierSemanticHash } from './identity.js';

const ACTIVE_CONFLICT_STATES = new Set(['OPEN', 'FACT_BLOCKED', 'REOPENED']);

interface CoverageKeyRule {
  readonly anyOf: readonly string[];
  readonly required: boolean;
  readonly semanticKey: string;
}

interface SectionRule {
  readonly keys: Readonly<Record<DossierSubjectType, readonly CoverageKeyRule[]>>;
  readonly readinessRequired: boolean;
  readonly section: DossierSectionKey;
  readonly weight: number;
}

const EMPTY_KEYS: Readonly<Record<DossierSubjectType, readonly CoverageKeyRule[]>> = Object.freeze({
  EDITION: Object.freeze([]),
  EXPRESSION: Object.freeze([]),
  WORK: Object.freeze([]),
});

function key(semanticKey: string, anyOf: readonly string[], required: boolean): CoverageKeyRule {
  return Object.freeze({ anyOf: Object.freeze([...anyOf]), required, semanticKey });
}

export const DOSSIER_COVERAGE_POLICY = Object.freeze({
  minimumRequiredBasisPoints: 10_000,
  sections: Object.freeze<readonly SectionRule[]>([
    {
      keys: {
        WORK: [key('identity.title', ['canonical_title', 'official_title'], true)],
        EXPRESSION: [
          key('identity.title', ['canonical_title', 'official_title', 'translated_title'], true),
          key('identity.language', ['language'], true),
        ],
        EDITION: [
          key('identity.title', ['translated_title', 'canonical_title', 'official_title'], true),
        ],
      },
      readinessRequired: true,
      section: 'IDENTITY',
      weight: 2_500,
    },
    {
      keys: {
        WORK: [key('bibliography.page-count', ['page_count'], false)],
        EXPRESSION: [key('bibliography.format', ['format'], false)],
        EDITION: [
          key('bibliography.isbn', ['isbn', 'platform_identifier'], true),
          key('bibliography.format', ['format'], false),
        ],
      },
      readinessRequired: true,
      section: 'BIBLIOGRAPHY',
      weight: 1_500,
    },
    {
      keys: {
        WORK: [key('creators.author', ['author'], true)],
        EXPRESSION: [key('creators.translator', ['translator'], false)],
        EDITION: [key('creators.translator', ['translator'], false)],
      },
      readinessRequired: true,
      section: 'CREATORS',
      weight: 1_500,
    },
    {
      keys: {
        WORK: [key('publication.date', ['publication_date'], true)],
        EXPRESSION: [key('publication.date', ['publication_date'], true)],
        EDITION: [
          key('publication.date', ['publication_date'], true),
          key('publication.publisher', ['publisher', 'imprint'], true),
        ],
      },
      readinessRequired: true,
      section: 'PUBLICATION_HISTORY',
      weight: 2_500,
    },
    {
      keys: {
        WORK: [key('awards.recognition', ['award_win', 'award_nomination'], false)],
        EXPRESSION: [key('awards.recognition', ['award_win', 'award_nomination'], false)],
        EDITION: [key('awards.recognition', ['award_win', 'award_nomination'], false)],
      },
      readinessRequired: false,
      section: 'AWARDS',
      weight: 750,
    },
    {
      keys: {
        WORK: [key('series.membership', ['series_membership', 'series_order'], false)],
        EXPRESSION: [key('series.membership', ['series_membership', 'series_order'], false)],
        EDITION: [key('series.membership', ['series_membership', 'series_order'], false)],
      },
      readinessRequired: false,
      section: 'SERIES_AND_RELATIONSHIPS',
      weight: 750,
    },
    {
      keys: EMPTY_KEYS,
      readinessRequired: false,
      section: 'SYNOPSIS_AND_THEMES',
      weight: 250,
    },
    {
      keys: EMPTY_KEYS,
      readinessRequired: false,
      section: 'RECEPTION_AND_DISCUSSION',
      weight: 250,
    },
    {
      keys: EMPTY_KEYS,
      readinessRequired: true,
      section: 'OPEN_CONFLICTS',
      weight: 0,
    },
    {
      keys: EMPTY_KEYS,
      readinessRequired: true,
      section: 'RESEARCH_GAPS',
      weight: 0,
    },
  ]),
  version: DOSSIER_COVERAGE_POLICY_VERSION,
});

const PREDICATE_SECTIONS: Readonly<Record<string, DossierSectionKey>> = Object.freeze({
  author: 'CREATORS',
  award_nomination: 'AWARDS',
  award_win: 'AWARDS',
  canonical_title: 'IDENTITY',
  format: 'BIBLIOGRAPHY',
  imprint: 'PUBLICATION_HISTORY',
  isbn: 'BIBLIOGRAPHY',
  language: 'IDENTITY',
  official_title: 'IDENTITY',
  original_title: 'IDENTITY',
  page_count: 'BIBLIOGRAPHY',
  platform_identifier: 'BIBLIOGRAPHY',
  publication_date: 'PUBLICATION_HISTORY',
  publication_relationship: 'SERIES_AND_RELATIONSHIPS',
  publisher: 'PUBLICATION_HISTORY',
  series_membership: 'SERIES_AND_RELATIONSHIPS',
  series_order: 'SERIES_AND_RELATIONSHIPS',
  translated_title: 'IDENTITY',
  translator: 'CREATORS',
});

function sectionForPredicate(predicate: string): DossierSectionKey {
  return PREDICATE_SECTIONS[predicate] ?? 'BIBLIOGRAPHY';
}

function stableFactKey(fact: DossierFactInput): string {
  const section = sectionForPredicate(fact.predicate);
  return fact.multipleAllowed
    ? `${section}:${fact.predicate}:${fact.normalizedScopeHash}:${fact.semanticFingerprint}`
    : `${section}:${fact.predicate}:${fact.normalizedScopeHash}`;
}

function dependency(
  type: DossierDependency['dependencyType'],
  id: string,
  revision: string,
  entrySemanticKey: string | null,
): DossierDependency {
  return assertDossierDependency({
    dependencyId: id,
    dependencyKey: dossierSemanticHash({ entrySemanticKey, id, revision, type }),
    dependencyRevision: revision,
    dependencyType: type,
    entrySemanticKey,
    versionId: '',
  });
}

function factGapReason(facts: readonly DossierFactInput[]): DossierGapReasonCode {
  if (
    facts.some((fact) =>
      fact.evidence.some(
        (evidence) =>
          evidence.availability === 'UNAVAILABLE' || evidence.availability === 'RETRACTED',
      ),
    )
  ) {
    return 'SOURCE_UNAVAILABLE';
  }
  if (
    facts.some(
      (fact) =>
        fact.factPolicyVersion !== 'fact-policy-v1' ||
        fact.evaluation?.policyVersion !== 'fact-policy-v1',
    )
  ) {
    return 'POLICY_VERSION_STALE';
  }
  if (
    facts.some(
      (fact) =>
        fact.evaluation?.status === 'STALE_REVIEW_REQUIRED' ||
        fact.evidence.some(
          (evidence) =>
            evidence.sourceRevision !== evidence.sourceCurrentRevision ||
            evidence.verificationStatus === 'STALE',
        ),
    )
  ) {
    return 'EVIDENCE_STALE';
  }
  if (
    facts.some((fact) => fact.evaluation?.reasonCode.toUpperCase().includes('INDEPENDENCE_UNKNOWN'))
  ) {
    return 'SOURCE_INDEPENDENCE_UNKNOWN';
  }
  return facts.length === 0 ? 'NO_CLAIM' : 'INSUFFICIENT_EVIDENCE';
}

function isCurrentVerified(fact: DossierFactInput, factPolicyVersion: string): boolean {
  return (
    fact.status === 'ACTIVE' &&
    fact.factPolicyVersion === factPolicyVersion &&
    fact.evaluation?.status === 'VERIFIED' &&
    fact.evaluation.policyVersion === factPolicyVersion &&
    fact.evidence.length > 0 &&
    fact.evidence.every(
      (evidence) =>
        evidence.sourceRevision === evidence.sourceCurrentRevision &&
        evidence.availability === 'AVAILABLE' &&
        evidence.verificationStatus === 'VALIDATED',
    )
  );
}

function entryFactStatus(facts: readonly DossierFactInput[]): DossierFactStatus {
  const statuses = facts
    .map((fact) => fact.evaluation?.status ?? 'NOT_EVALUATED')
    .filter((status): status is DossierFactStatus => DOSSIER_FACT_STATUSES.includes(status));
  const precedence: readonly DossierFactStatus[] = [
    'FACT_BLOCKED',
    'CONFLICTED',
    'STALE_REVIEW_REQUIRED',
    'INSUFFICIENT',
    'SUPPORTED_NOT_VERIFIED',
    'NOT_EVALUATED',
    'REJECTED',
    'VERIFIED',
  ];
  return precedence.find((status) => statuses.includes(status)) ?? 'NOT_EVALUATED';
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort());
}

function makeGap(
  semanticKey: string,
  section: DossierSectionKey,
  reasonCode: DossierGapReasonCode,
  required: boolean,
  blocking: boolean,
  claimIds: readonly string[],
  auditRef: string | null = null,
): DossierGap {
  return Object.freeze({
    auditRef,
    blocking,
    claimIds: uniqueSorted(claimIds),
    createdAt: '',
    gapId: `gap-${dossierSemanticHash({ reasonCode, section, semanticKey }).slice(0, 40)}`,
    reasonCode,
    required,
    section,
    semanticKey,
    versionId: '',
  });
}

function countsForEntries(entries: readonly DossierEntry[], gaps: readonly DossierGap[]) {
  return {
    blocked: entries.filter((entry) => entry.factStatus === 'FACT_BLOCKED').length,
    gaps: gaps.length,
    insufficient: entries.filter((entry) =>
      ['INSUFFICIENT', 'NOT_EVALUATED', 'SUPPORTED_NOT_VERIFIED'].includes(entry.factStatus),
    ).length,
    stale: entries.filter((entry) => entry.factStatus === 'STALE_REVIEW_REQUIRED').length,
    verified: entries.filter(
      (entry) => entry.entryKind === 'CONSENSUS' && entry.factStatus === 'VERIFIED',
    ).length,
  };
}

function coverageForSection(
  section: DossierSectionKey,
  subjectType: DossierSubjectType,
  consensusPredicates: ReadonlySet<string>,
  gaps: readonly DossierGap[],
  notApplicable: ReadonlySet<string>,
  entries: readonly DossierEntry[],
): DossierSectionCoverage {
  const rule = DOSSIER_COVERAGE_POLICY.sections.find((item) => item.section === section);
  if (rule === undefined) throw new DossierError('DOSSIER_INVALID_CONTRACT');
  const keys = rule.keys[subjectType];
  const applicable = keys.filter((item) => !notApplicable.has(item.semanticKey));
  const verified = applicable.filter((item) =>
    item.anyOf.some((predicate) => consensusPredicates.has(predicate)),
  ).length;
  const basisPoints =
    applicable.length === 0 ? 0 : Math.floor((verified * 10_000) / applicable.length);
  const sectionEntries = entries.filter((entry) => entry.section === section);
  const sectionGaps = gaps.filter((gap) => gap.section === section);
  const counts = countsForEntries(sectionEntries, sectionGaps);
  const reasonCodes = uniqueSorted([
    ...(applicable.length === 0 ? ['SECTION_NOT_RESEARCHED'] : []),
    ...sectionGaps.map((gap) => gap.reasonCode),
    ...(basisPoints === 10_000 ? ['SECTION_COVERED'] : []),
  ]);
  return Object.freeze({
    basisPoints,
    blockedCount: counts.blocked,
    gapCount: counts.gaps,
    insufficientCount: counts.insufficient,
    reasonCodes,
    section,
    staleCount: counts.stale,
    verifiedCount: counts.verified,
  });
}

export function buildDossierProjection(input: DossierProjectionInput): DossierProjection {
  assertDossierProjectionInput(input);
  const activeConflicts = input.conflicts
    .filter((conflict) => ACTIVE_CONFLICT_STATES.has(conflict.state))
    .sort((left, right) => left.conflictId.localeCompare(right.conflictId));
  const conflictedClaimIds = new Set(activeConflicts.flatMap((conflict) => [...conflict.claimIds]));
  const facts = [...input.facts]
    .filter((fact) => fact.status === 'ACTIVE')
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
  const groups = new Map<string, DossierFactInput[]>();
  for (const fact of facts) {
    const semanticKey = stableFactKey(fact);
    const existing = groups.get(semanticKey) ?? [];
    existing.push(fact);
    groups.set(semanticKey, existing);
  }

  const entries: DossierEntry[] = [];
  const gaps: DossierGap[] = [];
  const dependencies: DossierDependency[] = [];
  const entryByClaim = new Map<string, string>();

  for (const [semanticKey, groupedFacts] of [...groups.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const section = sectionForPredicate(groupedFacts[0]?.predicate ?? '');
    const groupConflicted = groupedFacts.some((fact) => conflictedClaimIds.has(fact.claimId));
    const verified = groupedFacts.filter(
      (fact) => !groupConflicted && isCurrentVerified(fact, input.factPolicyVersion),
    );
    const entryKind = verified.length > 0 ? 'CONSENSUS' : 'GAP';
    const selected = verified.length > 0 ? verified : groupedFacts;
    const claimIds = uniqueSorted(selected.map((fact) => fact.claimId));
    const evaluationIds = uniqueSorted(
      selected.flatMap((fact) => (fact.evaluation === null ? [] : [fact.evaluation.evaluationId])),
    );
    const evidenceIds = uniqueSorted(
      selected.flatMap((fact) => fact.evidence.map((evidence) => evidence.evidenceId)),
    );
    const sourceIds = uniqueSorted(
      selected.flatMap((fact) => fact.evidence.map((evidence) => evidence.sourceId)),
    );
    const sourceRevisionIds = uniqueSorted(
      selected.flatMap((fact) =>
        fact.evidence.map((evidence) => `${evidence.sourceId}:${evidence.sourceRevision}`),
      ),
    );
    const primary = selected[0];
    if (primary === undefined) continue;
    const factStatus = entryKind === 'CONSENSUS' ? 'VERIFIED' : entryFactStatus(selected);
    let gapId: string | null = null;
    if (entryKind === 'GAP' && !groupConflicted) {
      const gap = makeGap(
        semanticKey,
        section,
        factGapReason(selected),
        false,
        selected.some((fact) => fact.keyFact),
        claimIds,
      );
      gaps.push(gap);
      gapId = gap.gapId;
    }
    if (!groupConflicted) {
      entries.push(
        Object.freeze({
          claimIds,
          conflictId: null,
          createdAt: '',
          displayValue: primary.normalizedValue,
          entryId: `entry-${dossierSemanticHash({ entryKind, semanticKey }).slice(0, 40)}`,
          entryKind,
          evidenceCount: evidenceIds.length,
          evidenceIds,
          factEvaluationIds: evaluationIds,
          factStatus,
          gapId,
          predicate: primary.predicate,
          provenance: 'LOCAL_DETERMINISTIC',
          revision: 1,
          section,
          semanticKey,
          sourceCount: sourceIds.length,
          sourceRevisionIds,
          structuredValue: primary.structuredValue,
          updatedAt: '',
          versionId: '',
        }),
      );
      for (const claimId of claimIds) entryByClaim.set(claimId, semanticKey);
    }
  }

  for (const conflict of activeConflicts) {
    const conflictFacts = facts.filter((fact) => conflict.claimIds.includes(fact.claimId));
    const semanticKey = `OPEN_CONFLICTS:${conflict.conflictId}`;
    const evidenceIds = uniqueSorted(
      conflictFacts.flatMap((fact) => fact.evidence.map((evidence) => evidence.evidenceId)),
    );
    const sourceIds = uniqueSorted(
      conflictFacts.flatMap((fact) => fact.evidence.map((evidence) => evidence.sourceId)),
    );
    const sourceRevisionIds = uniqueSorted(
      conflictFacts.flatMap((fact) =>
        fact.evidence.map((evidence) => `${evidence.sourceId}:${evidence.sourceRevision}`),
      ),
    );
    const values = uniqueSorted(conflictFacts.map((fact) => fact.normalizedValue));
    const blocked = conflict.state === 'FACT_BLOCKED' || conflictFacts.some((fact) => fact.keyFact);
    const gap = makeGap(
      semanticKey,
      'OPEN_CONFLICTS',
      'FACT_CONFLICTED',
      blocked,
      blocked,
      conflict.claimIds,
    );
    gaps.push(gap);
    entries.push(
      Object.freeze({
        claimIds: uniqueSorted(conflict.claimIds),
        conflictId: conflict.conflictId,
        createdAt: '',
        displayValue: values.join(' ↔ '),
        entryId: `entry-${dossierSemanticHash({ kind: 'DISPUTED', semanticKey }).slice(0, 40)}`,
        entryKind: 'DISPUTED',
        evidenceCount: evidenceIds.length,
        evidenceIds,
        factEvaluationIds: uniqueSorted(
          conflictFacts.flatMap((fact) =>
            fact.evaluation === null ? [] : [fact.evaluation.evaluationId],
          ),
        ),
        factStatus: 'FACT_BLOCKED',
        gapId: gap.gapId,
        predicate: conflictFacts[0]?.predicate ?? 'unknown',
        provenance: 'LOCAL_DETERMINISTIC',
        revision: 1,
        section: 'OPEN_CONFLICTS',
        semanticKey,
        sourceCount: sourceIds.length,
        sourceRevisionIds,
        structuredValue: Object.freeze({ values }),
        updatedAt: '',
        versionId: '',
      }),
    );
    for (const claimId of conflict.claimIds) entryByClaim.set(claimId, semanticKey);
  }

  const notApplicableByKey = new Map(
    input.notApplicable.map((item) => [item.semanticKey, item] as const),
  );
  const consensusPredicates = new Set(
    entries.filter((entry) => entry.entryKind === 'CONSENSUS').map((entry) => entry.predicate),
  );
  for (const rule of DOSSIER_COVERAGE_POLICY.sections) {
    for (const keyRule of rule.keys[input.subject.type]) {
      const applicable = notApplicableByKey.get(keyRule.semanticKey);
      if (applicable !== undefined) continue;
      if (keyRule.anyOf.some((predicate) => consensusPredicates.has(predicate))) continue;
      const related = facts.filter((fact) => keyRule.anyOf.includes(fact.predicate));
      const existingConflict = activeConflicts.some((conflict) =>
        conflict.claimIds.some((claimId) => related.some((fact) => fact.claimId === claimId)),
      );
      const reason = existingConflict ? 'FACT_CONFLICTED' : factGapReason(related);
      const semanticKey = `POLICY:${rule.section}:${keyRule.semanticKey}`;
      if (!gaps.some((gap) => gap.semanticKey === semanticKey)) {
        gaps.push(
          makeGap(
            semanticKey,
            rule.section,
            reason,
            keyRule.required,
            keyRule.required,
            related.map((fact) => fact.claimId),
          ),
        );
      }
    }
  }

  for (const item of input.notApplicable) {
    if (
      item.semanticKey.length === 0 ||
      item.reasonCode.length === 0 ||
      item.auditRef.length === 0
    ) {
      throw new DossierError('DOSSIER_INVALID_CONTRACT');
    }
  }

  for (const fact of facts) {
    const entrySemanticKey = entryByClaim.get(fact.claimId) ?? null;
    dependencies.push(
      dependency('CLAIM', fact.claimId, String(fact.claimRevision), entrySemanticKey),
    );
    if (fact.evaluation !== null) {
      dependencies.push(
        dependency(
          'FACT_EVALUATION',
          fact.evaluation.evaluationId,
          fact.evaluation.inputIdentityHash,
          entrySemanticKey,
        ),
      );
    }
    for (const evidence of fact.evidence) {
      dependencies.push(
        dependency(
          'EVIDENCE',
          evidence.evidenceId,
          String(evidence.evidenceRevision),
          entrySemanticKey,
        ),
        dependency(
          'SOURCE_REVISION',
          evidence.sourceId,
          `${evidence.sourceRevision}.${evidence.classificationRevision}`,
          entrySemanticKey,
        ),
      );
    }
  }
  for (const conflict of input.conflicts) {
    dependencies.push(
      dependency(
        'CONFLICT',
        conflict.conflictId,
        String(conflict.revision),
        `OPEN_CONFLICTS:${conflict.conflictId}`,
      ),
    );
  }
  dependencies.push(
    dependency('FACT_POLICY', input.factPolicyVersion, input.factPolicyVersion, null),
    dependency(
      'COVERAGE_POLICY',
      DOSSIER_COVERAGE_POLICY_VERSION,
      DOSSIER_COVERAGE_POLICY_VERSION,
      null,
    ),
    dependency('SUBJECT', `${input.subject.type}:${input.subject.id}`, input.subjectRevision, null),
  );
  const dedupedDependencies = [
    ...new Map(dependencies.map((item) => [item.dependencyKey, item] as const)).values(),
  ].sort((left, right) => left.dependencyKey.localeCompare(right.dependencyKey));
  if (dedupedDependencies.length > DOSSIER_LIMITS.maxDependenciesPerBuild) {
    throw new DossierError('DOSSIER_CAPACITY_EXCEEDED');
  }

  gaps.sort((left, right) => left.semanticKey.localeCompare(right.semanticKey));
  const notApplicableKeys = new Set(input.notApplicable.map((item) => item.semanticKey));
  const sectionCoverage = DOSSIER_SECTIONS.map((section) =>
    coverageForSection(
      section,
      input.subject.type,
      consensusPredicates,
      gaps,
      notApplicableKeys,
      entries,
    ),
  );
  const weightedRules = DOSSIER_COVERAGE_POLICY.sections.filter((rule) => rule.weight > 0);
  const totalWeight = weightedRules.reduce((sum, rule) => sum + rule.weight, 0);
  const overallBasisPoints = Math.floor(
    weightedRules.reduce((sum, rule) => {
      const coverage = sectionCoverage.find((item) => item.section === rule.section);
      return sum + rule.weight * (coverage?.basisPoints ?? 0);
    }, 0) / totalWeight,
  );
  const requiredRules = DOSSIER_COVERAGE_POLICY.sections.flatMap((rule) =>
    rule.keys[input.subject.type]
      .filter((item) => item.required && !notApplicableKeys.has(item.semanticKey))
      .map((item) => ({ item, rule })),
  );
  const optionalRules = DOSSIER_COVERAGE_POLICY.sections.flatMap((rule) =>
    rule.keys[input.subject.type]
      .filter((item) => !item.required && !notApplicableKeys.has(item.semanticKey))
      .map((item) => ({ item, rule })),
  );
  const fraction = (rules: typeof requiredRules): number => {
    if (rules.length === 0) return 0;
    const denominator = rules.reduce((sum, item) => sum + item.rule.weight, 0);
    const numerator = rules.reduce(
      (sum, { item, rule }) =>
        sum +
        (item.anyOf.some((predicate) => consensusPredicates.has(predicate)) ? rule.weight : 0),
      0,
    );
    return denominator === 0 ? 0 : Math.floor((numerator * 10_000) / denominator);
  };
  const counts = countsForEntries(entries, gaps);
  const inputHash = dossierSemanticHash({
    coveragePolicyVersion: DOSSIER_COVERAGE_POLICY_VERSION,
    dependencies: dedupedDependencies.map(
      ({ dependencyId, dependencyRevision, dependencyType }) => ({
        dependencyId,
        dependencyRevision,
        dependencyType,
      }),
    ),
    factPolicyVersion: input.factPolicyVersion,
    notApplicable: input.notApplicable,
    schemaVersion: DOSSIER_SCHEMA_VERSION,
    subject: input.subject,
    subjectRevision: input.subjectRevision,
  });
  const requiredBasisPoints = fraction(requiredRules);
  const optionalBasisPoints = fraction(optionalRules);
  const reasonCodes = uniqueSorted([
    ...gaps.map((gap) => gap.reasonCode),
    ...(requiredBasisPoints === 10_000 ? ['REQUIRED_COVERAGE_COMPLETE'] : []),
    ...(requiredBasisPoints < 10_000 ? ['REQUIRED_COVERAGE_INCOMPLETE'] : []),
  ]);
  const coverage: DossierCoverageSnapshot = Object.freeze({
    blockedCount: counts.blocked,
    coveragePolicyVersion: DOSSIER_COVERAGE_POLICY_VERSION,
    gapCount: counts.gaps,
    inputHash,
    insufficientCount: counts.insufficient,
    optionalBasisPoints,
    overallBasisPoints,
    reasonCodes,
    requiredBasisPoints,
    sections: Object.freeze(sectionCoverage),
    staleCount: counts.stale,
    verifiedCount: counts.verified,
  });
  const blockingConflict = gaps.some((gap) => gap.blocking && gap.reasonCode === 'FACT_CONFLICTED');
  const stale = gaps.some((gap) =>
    ['EVIDENCE_STALE', 'POLICY_VERSION_STALE', 'SOURCE_UNAVAILABLE'].includes(gap.reasonCode),
  );
  const readiness = blockingConflict
    ? 'FACT_BLOCKED'
    : stale
      ? 'STALE'
      : requiredBasisPoints < DOSSIER_COVERAGE_POLICY.minimumRequiredBasisPoints ||
          gaps.some((gap) => gap.blocking)
        ? 'INSUFFICIENT_COVERAGE'
        : 'READY_FOR_CONTENT_BRIEF';
  const sections: readonly DossierSection[] = Object.freeze(
    DOSSIER_SECTIONS.map((section, position) => {
      const coverageItem = sectionCoverage[position];
      const rule = DOSSIER_COVERAGE_POLICY.sections.find((item) => item.section === section);
      return Object.freeze({
        blockedCount: coverageItem?.blockedCount ?? 0,
        coverageBasisPoints: coverageItem?.basisPoints ?? 0,
        entryCount: entries.filter((entry) => entry.section === section).length,
        gapCount: coverageItem?.gapCount ?? 0,
        insufficientCount: coverageItem?.insufficientCount ?? 0,
        position,
        readinessRequired: rule?.readinessRequired ?? false,
        reasonCodes: coverageItem?.reasonCodes ?? Object.freeze([]),
        section,
        sectionId: `section-${section.toLowerCase()}`,
        staleCount: coverageItem?.staleCount ?? 0,
        verifiedCount: coverageItem?.verifiedCount ?? 0,
        versionId: '',
      });
    }),
  );
  return Object.freeze({
    coverage,
    dependencies: Object.freeze(dedupedDependencies),
    entries: Object.freeze(
      entries.sort((left, right) => left.semanticKey.localeCompare(right.semanticKey)),
    ),
    gaps: Object.freeze(gaps),
    inputHash,
    readiness,
    sections,
  });
}
