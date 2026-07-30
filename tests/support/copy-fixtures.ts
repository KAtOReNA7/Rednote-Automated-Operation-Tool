import type { DatabaseSync } from 'node:sqlite';

import {
  buildManualCopyScaffold,
  copySemanticHash,
  type ContentDraftPayloadV1,
  type CopyModelCandidateV1,
  type DraftLineageRefV1,
} from '../../packages/copy/src/index.js';
import { SqliteBriefRepository, SqliteCopyRepository } from '../../packages/db/src/index.js';
import type { BriefProfileId } from '../../packages/briefs/src/index.js';

import {
  BRIEF_NOW,
  briefDependencies,
  completeBriefDraft,
  createRepositoryScaffoldFixture,
  readyBriefDraft,
} from './brief-fixtures.js';

export const COPY_NOW = '2026-07-30T14:00:00.000Z';

export function requiredFixtureValue<T>(
  value: T | null | undefined,
  label = 'required fixture value',
): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}`);
  return value;
}

function artifactLineage(
  payload: ContentDraftPayloadV1,
  workId: string | null = null,
): readonly DraftLineageRefV1[] {
  return Object.freeze([
    Object.freeze({
      argumentId: 'support-1',
      briefFieldPath: 'supportingArguments.support-1',
      evidenceRefIds: Object.freeze([]),
      experienceAssertionId: null,
      inputHash: payload.brief.briefInputHash,
      provenance: 'USER_EDITED' as const,
      structureSlotId: null,
      workId,
    }),
  ]);
}

export function completeCopyPayload(profileId: BriefProfileId): ContentDraftPayloadV1 {
  const brief = readyBriefDraft(profileId);
  const briefInputHash = copySemanticHash(brief);
  const scaffold = buildManualCopyScaffold({
    briefId: `brief-${profileId.toLowerCase()}`,
    briefInputHash,
    briefLockHash: copySemanticHash(brief.fieldStates),
    briefVersionId: `brief-version-${profileId.toLowerCase()}`,
    dependencies: briefDependencies(brief.topicVersionId),
    draft: brief,
  });
  const marker = profileId === 'FULL_TRICK_LOGIC_ANALYSIS' ? '【完整剧透】' : '';
  const titleId = 'title-selected';
  const requiredLabel = scaffold.brief.requiredPublicLabels[0] ?? '公开资料整理';
  const blocks = scaffold.blocks.map((block) => ({
    ...block,
    lineage:
      block.kind === 'COMPARISON'
        ? Object.freeze(
            scaffold.brief.workIds.map((workId) =>
              requiredFixtureValue(artifactLineage(scaffold, workId).at(0), 'comparison lineage'),
            ),
          )
        : artifactLineage(scaffold, scaffold.brief.workIds[0] ?? null),
    provenance: 'USER_EDITED' as const,
    text:
      block.kind === 'WARNING'
        ? '以下内容包含完整谜底、诡计与结局分析，请确认后继续。'
        : `${block.kind}：这是合成 fixture 的明确判断、依据与适用条件。`,
  }));
  blocks.push({
    blockId: 'public-label',
    kind: 'PUBLIC_LABEL',
    lineage: artifactLineage(scaffold, scaffold.brief.workIds[0] ?? null),
    order: blocks.length,
    provenance: 'USER_EDITED',
    text: `${requiredLabel}。观点只覆盖当前受控资料。`,
  });
  return {
    ...scaffold,
    blocks,
    pinnedComment: {
      lineage: artifactLineage(scaffold, scaffold.brief.workIds[0] ?? null),
      provenance: 'USER_EDITED',
      text:
        profileId === 'FULL_TRICK_LOGIC_ANALYSIS'
          ? '完整剧透提醒：评论区也会讨论谜底。'
          : `${requiredLabel}：你更看重哪条判断条件？`,
    },
    selectedTitleId: titleId,
    spoilerWarnings:
      profileId === 'FULL_TRICK_LOGIC_ANALYSIS'
        ? {
            bodyOpeningWarningText: '完整剧透：下文将拆解诡计与结局。',
            coverWarningText: '完整剧透分析',
            pinnedCommentWarningText: '完整剧透：评论区包含谜底。',
            provenance: 'USER_EDITED',
            titleWarningMarker: marker,
          }
        : {
            bodyOpeningWarningText: null,
            coverWarningText: null,
            pinnedCommentWarningText: null,
            provenance: 'SYSTEM_DERIVED',
            titleWarningMarker: null,
          },
    tags: [
      {
        lineage: artifactLineage(scaffold, scaffold.brief.workIds[0] ?? null),
        provenance: 'USER_EDITED',
        tagId: 'tag-1',
        text: '推理小说',
      },
      {
        lineage: artifactLineage(scaffold, scaffold.brief.workIds[0] ?? null),
        provenance: 'USER_EDITED',
        tagId: 'tag-2',
        text: '阅读判断',
      },
    ],
    titles: [
      {
        kind: 'SELECTED',
        lineage: artifactLineage(scaffold, scaffold.brief.workIds[0] ?? null),
        provenance: 'USER_EDITED',
        text: `${marker}一条有条件、可解释的推理阅读判断`,
        titleId,
      },
      {
        kind: 'VARIANT',
        lineage: artifactLineage(scaffold, scaffold.brief.workIds[0] ?? null),
        provenance: 'USER_EDITED',
        text: `${marker}它的优点成立，但缺点也很具体`,
        titleId: 'title-variant-1',
      },
    ],
  };
}

export function copyCandidate(payload: ContentDraftPayloadV1): CopyModelCandidateV1 {
  return {
    blocks: payload.blocks,
    pinnedComment: payload.pinnedComment,
    selectedTitleId: requiredFixtureValue(payload.selectedTitleId, 'selected title'),
    spoilerWarnings: payload.spoilerWarnings,
    tags: payload.tags,
    titles: payload.titles,
  };
}

export function createReadyBriefForCopyFixture(
  database: DatabaseSync,
  idPrefix = 'copy-fixture',
): {
  readonly briefId: string;
  readonly idGenerator: () => string;
  readonly payload: ContentDraftPayloadV1;
} {
  let sequence = 0;
  const ids = () => `${idPrefix}-${++sequence}`;
  const briefs = new SqliteBriefRepository(database, ids);
  const fixture = createRepositoryScaffoldFixture(database);
  const createdBrief = briefs.createScaffold(
    fixture.input,
    fixture.context,
    fixture.dependencies,
    BRIEF_NOW,
  );
  const readyBrief = briefs.saveDraft(
    createdBrief.briefId,
    createdBrief.revision,
    completeBriefDraft(createdBrief.draft),
    fixture.context,
    '2026-07-30T13:59:00.000Z',
  );
  const current = requiredFixtureValue(
    readyBrief.versionHistory.items.find(({ isCurrent }) => isCurrent),
    'current Brief version',
  );
  const payload = completeCopyPayload('NON_SPOILER_SINGLE_BOOK_VERDICT');
  const subjectWorkId = requiredFixtureValue(
    readyBrief.draft.subjects.at(0),
    'Brief primary subject',
  ).workId;
  const adapted: ContentDraftPayloadV1 = {
    ...payload,
    brief: {
      ...payload.brief,
      briefId: readyBrief.briefId,
      briefInputHash: copySemanticHash(readyBrief.draft),
      briefLockHash: copySemanticHash(readyBrief.draft.fieldStates),
      briefVersionId: current.versionId,
      dependencies: readyBrief.dependencies,
      profileId: readyBrief.profileId,
      topicId: readyBrief.draft.topicId,
      topicVersionId: readyBrief.draft.topicVersionId,
      workIds: readyBrief.draft.subjects.map(({ workId }) => workId),
    },
    blocks: payload.blocks.map((block) => ({
      ...block,
      lineage: block.lineage.map((ref) => ({
        ...ref,
        inputHash: copySemanticHash(readyBrief.draft),
        workId: subjectWorkId,
      })),
    })),
    pinnedComment:
      payload.pinnedComment === null
        ? null
        : {
            ...payload.pinnedComment,
            lineage: payload.pinnedComment.lineage.map((ref) => ({
              ...ref,
              inputHash: copySemanticHash(readyBrief.draft),
              workId: subjectWorkId,
            })),
          },
    tags: payload.tags.map((tag) => ({
      ...tag,
      lineage: tag.lineage.map((ref) => ({
        ...ref,
        inputHash: copySemanticHash(readyBrief.draft),
        workId: subjectWorkId,
      })),
    })),
    titles: payload.titles.map((title) => ({
      ...title,
      lineage: title.lineage.map((ref) => ({
        ...ref,
        inputHash: copySemanticHash(readyBrief.draft),
        workId: subjectWorkId,
      })),
    })),
  };
  return {
    briefId: readyBrief.briefId,
    idGenerator: ids,
    payload: adapted,
  };
}

export function createReadyCopyRepositoryFixture(
  database: DatabaseSync,
  idPrefix = 'copy-fixture',
): {
  readonly briefId: string;
  readonly copy: SqliteCopyRepository;
  readonly created: ReturnType<SqliteCopyRepository['createManualScaffold']>;
  readonly payload: ContentDraftPayloadV1;
} {
  const ready = createReadyBriefForCopyFixture(database, idPrefix);
  const copy = new SqliteCopyRepository(database, ready.idGenerator);
  const created = copy.createManualScaffold(ready.payload, COPY_NOW);
  return {
    briefId: ready.briefId,
    copy,
    created,
    payload: ready.payload,
  };
}
