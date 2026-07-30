import type { DatabaseSync } from 'node:sqlite';

import {
  CONTENT_BRIEF_GENERATION_CONTRACT_VERSION,
  assertContentBriefDraft,
  briefSemanticHash,
  buildLocalBriefScaffold,
  type BriefDependency,
  type BriefProfileId,
  type BriefReadinessContext,
  type BriefScaffoldInput,
  type ContentBriefDraft,
} from '../../packages/briefs/src/index.js';
import {
  SqliteAuthenticityRepository,
  SqliteTopicRepository,
} from '../../packages/db/src/index.js';
import { insertTopicReadyWork } from './topic-fixtures.js';

export const BRIEF_NOW = '2026-07-30T12:00:00.000Z';

function workSubject(
  suffix: string,
  role: 'PRIMARY' | 'COMPARISON' | 'CONTEXT' = 'PRIMARY',
): BriefScaffoldInput['subjects'][number] {
  return {
    editionId: null,
    expressionForm: null,
    expressionId: null,
    role,
    subjectId: `work-${suffix}`,
    subjectType: 'WORK',
    workId: `work-${suffix}`,
  };
}

export function briefScaffoldInput(profileId: BriefProfileId): BriefScaffoldInput {
  const subjects: BriefScaffoldInput['subjects'] =
    profileId === 'CROSS_WORK_COMPARISON'
      ? [workSubject('a'), workSubject('b')]
      : profileId === 'WEB_VS_PUBLISHED_MYSTERY'
        ? [
            {
              editionId: null,
              expressionForm: 'WEB_SERIALIZED',
              expressionId: 'expression-web',
              role: 'PRIMARY',
              subjectId: 'expression-web',
              subjectType: 'EXPRESSION',
              workId: 'work-web',
            },
            {
              editionId: 'edition-published',
              expressionForm: 'PUBLISHED_EDITION',
              expressionId: 'expression-published',
              role: 'COMPARISON',
              subjectId: 'edition-published',
              subjectType: 'EDITION',
              workId: 'work-published',
            },
          ]
        : profileId === 'MYSTERY_AND_CULTURAL_PHENOMENON'
          ? [workSubject('culture'), workSubject('context', 'CONTEXT')]
          : [workSubject('single')];
  return {
    allowedAssertionIds: [],
    candidateJudgment: '这是一条需要保留限定条件的合成判断',
    comparisonDimension:
      profileId === 'CROSS_WORK_COMPARISON'
        ? 'FAIR_PLAY'
        : profileId === 'WEB_VS_PUBLISHED_MYSTERY'
          ? 'PUBLICATION_FORM'
          : null,
    evidenceRefs: [],
    experimentBinding: null,
    expressionMode: 'PUBLIC_RESEARCH_ANALYSIS',
    permissionCurrent: true,
    permissionRevision: 1,
    permissionSnapshotId: 'permission-fixture',
    profileId,
    r2AssertionIds: [],
    readingState: 'S1',
    requiredPublicLabels: ['公开资料整理'],
    scoreKind: 'NONE',
    scoreValueSourceId: null,
    spoilerLevel: profileId === 'FULL_TRICK_LOGIC_ANALYSIS' ? 'FULL_TRICK_ANALYSIS' : 'NO_SPOILER',
    spoilerUserConfirmed: profileId === 'FULL_TRICK_LOGIC_ANALYSIS',
    subjects,
    topicId: `topic-${profileId.toLowerCase()}`,
    topicVersionId: `topic-version-${profileId.toLowerCase()}`,
  };
}

export function readyBriefDraft(profileId: BriefProfileId): ContentBriefDraft {
  return completeBriefDraft(buildLocalBriefScaffold(briefScaffoldInput(profileId)));
}

export function completeBriefDraft(draft: ContentBriefDraft): ContentBriefDraft {
  const subjectIds = draft.subjects.map((subject) => subject.subjectId);
  return assertContentBriefDraft({
    ...draft,
    contentObjective: {
      readerOutcome: '理解这条判断适用的条件',
      scopeBoundary: '只讨论合成 fixture 中已给出的结构',
    },
    coreJudgment: {
      ...draft.coreJudgment,
      kind: 'OPINION',
      qualification: '结论只覆盖当前受控资料',
      statement: draft.coreJudgment.statement ?? '这是一条需要用户确认的合成判断',
    },
    openQuestionsAndLimitations: ['不补写未知事实'],
    strongestCounterargument: {
      argumentId: 'counter-1',
      evidenceRefIds: [],
      kind: 'OPINION',
      limitation: '反方同样只适用于当前范围',
      responseOrQualification: '保留反方成立的条件',
      statement: '相反视角可能更重视叙事体验',
      subjectIds,
    },
    supportingArguments: [
      {
        argumentId: 'support-1',
        evidenceRefIds: [],
        kind: 'OPINION',
        limitation: '不外推到未核对作品',
        statement: '结构呈现支持这条有限判断',
        subjectIds,
      },
    ],
    targetAudience: {
      knowledgeLevel: 'MIXED',
      readerDescription: '希望先判断内容是否适合自己的推理读者',
      selectionNeed: '需要可解释、不过度承诺的判断',
    },
  });
}

export function readyBriefContext(
  overrides: Partial<BriefReadinessContext> = {},
): BriefReadinessContext {
  return {
    dependenciesCurrent: true,
    dossierCurrentReady: true,
    experimentMatches: true,
    factBlocked: false,
    schemaValid: true,
    topicCurrent: true,
    topicEligibility: 'ELIGIBLE',
    topicState: 'LOCKED',
    ...overrides,
  };
}

export function briefDependencies(topicVersionId: string): readonly BriefDependency[] {
  return [
    {
      dependencyHash: briefSemanticHash({ topicVersionId }),
      dependencyId: topicVersionId,
      dependencyType: 'TOPIC_VERSION',
      observedRevision: '1',
    },
    {
      dependencyHash: briefSemanticHash({ policy: 'brief-profile-registry-v1' }),
      dependencyId: 'brief-profile-registry-v1',
      dependencyType: 'PROFILE_POLICY',
      observedRevision: '1',
    },
  ];
}

export function modelCandidate(draft: ContentBriefDraft): Readonly<Record<string, unknown>> {
  return {
    citedEvidenceRefIds: [],
    contentObjective: draft.contentObjective,
    contractVersion: CONTENT_BRIEF_GENERATION_CONTRACT_VERSION,
    coreJudgment: draft.coreJudgment,
    openQuestionsAndLimitations: draft.openQuestionsAndLimitations,
    strongestCounterargument: draft.strongestCounterargument,
    structurePlan: draft.structurePlan,
    supportingArguments: draft.supportingArguments,
    targetAudience: draft.targetAudience,
  };
}

export function createRepositoryScaffoldFixture(database: DatabaseSync): {
  readonly context: BriefReadinessContext;
  readonly dependencies: readonly BriefDependency[];
  readonly input: BriefScaffoldInput;
} {
  const authenticity = new SqliteAuthenticityRepository(database, () => crypto.randomUUID());
  insertTopicReadyWork(database, authenticity, {
    analysisMode: 'PUBLIC_RESEARCH',
    workId: 'brief-runtime-work',
  });
  const topics = new SqliteTopicRepository(database, () => crypto.randomUUID());
  topics.confirmGeneration(
    topics.previewGeneration('primary', BRIEF_NOW),
    'brief-topic-generation',
    '2026-07-30T12:00:01.000Z',
  );
  const row = database
    .prepare(
      `SELECT
         topic.id AS topic_id, version.id AS version_id,
         member.subject_type, member.subject_id, member.work_id,
         member.expression_id, member.edition_id, member.expression_form,
         reading.revision AS permission_revision,
         reading.current_snapshot_id AS permission_snapshot_id,
         topic.topic_revision
       FROM topics AS topic
       JOIN topic_candidate_versions AS version
         ON version.topic_id = topic.id
        AND version.version_number = topic.current_version_number
       JOIN topic_subject_memberships AS member
         ON member.version_id = version.id AND member.ordinal = 0
       JOIN reading_states AS reading ON reading.book_id = member.work_id
       WHERE version.content_type = 'NON_SPOILER_SINGLE_BOOK_VERDICT'
       ORDER BY topic.id LIMIT 1`,
    )
    .get() as {
    readonly edition_id: string | null;
    readonly expression_form: 'WEB_SERIALIZED' | 'PUBLISHED_EDITION' | 'OTHER_VERIFIED' | null;
    readonly expression_id: string | null;
    readonly permission_revision: number;
    readonly permission_snapshot_id: string;
    readonly subject_id: string;
    readonly subject_type: 'WORK' | 'EXPRESSION' | 'EDITION';
    readonly topic_id: string;
    readonly topic_revision: number;
    readonly version_id: string;
    readonly work_id: string;
  };
  topics.applyStateChange(
    topics.previewStateChange({
      action: 'LOCK',
      expectedRevision: row.topic_revision,
      topicId: row.topic_id,
    }),
    '2026-07-30T12:00:02.000Z',
  );
  const input: BriefScaffoldInput = {
    allowedAssertionIds: [],
    candidateJudgment: '合成候选判断',
    comparisonDimension: null,
    evidenceRefs: [],
    experimentBinding: null,
    expressionMode: 'PUBLIC_RESEARCH_ANALYSIS',
    permissionCurrent: true,
    permissionRevision: row.permission_revision,
    permissionSnapshotId: row.permission_snapshot_id,
    profileId: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
    r2AssertionIds: [],
    readingState: 'S1',
    requiredPublicLabels: ['公开资料整理'],
    scoreKind: 'NONE',
    scoreValueSourceId: null,
    spoilerLevel: 'NO_SPOILER',
    spoilerUserConfirmed: false,
    subjects: [
      {
        editionId: row.edition_id,
        expressionForm: row.expression_form,
        expressionId: row.expression_id,
        role: 'PRIMARY',
        subjectId: row.subject_id,
        subjectType: row.subject_type,
        workId: row.work_id,
      },
    ],
    topicId: row.topic_id,
    topicVersionId: row.version_id,
  };
  return {
    context: readyBriefContext(),
    dependencies: briefDependencies(row.version_id),
    input,
  };
}
