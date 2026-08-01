import { mkdirSync, mkdtempSync, realpathSync, rmSync, rmdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DesktopAuthenticityRuntime } from '../apps/desktop/src/authenticity-runtime.js';
import { DesktopBriefRuntime } from '../apps/desktop/src/brief-runtime.js';
import { DesktopCopyRuntime } from '../apps/desktop/src/copy-runtime.js';
import { DesktopEvidenceRuntime } from '../apps/desktop/src/evidence-runtime.js';
import {
  type ContentDraftPayloadV1,
  type DraftLineageRefV1,
  validateDraftStructure,
} from '../packages/copy/src/index.js';
import type { RealResearchIntakeDraft } from '../packages/shared/src/index.js';
import {
  SqliteBriefRepository,
  SqliteCopyRepository,
  SqliteDossierRepository,
  SqliteFactMappingRepository,
  SqliteTopicRepository,
  connectDatabase,
  initializeDatabase,
} from '../packages/db/src/index.js';
import { factMappingHash } from '../packages/quality/src/index.js';
import { parseManagedRelativePath } from '../packages/shared/src/storage-contracts.js';
import {
  LocalFileRepository,
  initializeProjectDataRoot,
  type ProjectDataRoot,
} from '../packages/storage/src/index.js';
import { completeBriefDraft } from './support/brief-fixtures.js';

const REPOSITORY_ROOT = realpathSync(process.cwd());
const CONTROLLED_TEMP_ROOT = resolve(REPOSITORY_ROOT, '.rednote-temp');
const temporaryCases = new Set<string>();

function createControlledCaseDirectory(): string {
  const relativeRoot = relative(REPOSITORY_ROOT, CONTROLLED_TEMP_ROOT);
  if (
    relativeRoot !== '.rednote-temp' ||
    relativeRoot.startsWith('..') ||
    isAbsolute(relativeRoot)
  ) {
    throw new Error('Refusing an uncontrolled vertical-slice test directory.');
  }
  mkdirSync(CONTROLLED_TEMP_ROOT, { recursive: true });
  const directory = mkdtempSync(join(CONTROLLED_TEMP_ROOT, 'vertical-slice-'));
  temporaryCases.add(directory);
  return directory;
}

function cleanControlledCases(): void {
  for (const directory of temporaryCases) {
    const resolved = resolve(directory);
    const fromControlledRoot = relative(CONTROLLED_TEMP_ROOT, resolved);
    if (
      fromControlledRoot.length === 0 ||
      fromControlledRoot.startsWith('..') ||
      isAbsolute(fromControlledRoot)
    ) {
      throw new Error('Refusing to remove an uncontrolled vertical-slice test directory.');
    }
    rmSync(resolved, { force: true, recursive: true });
  }
  temporaryCases.clear();
  try {
    rmdirSync(CONTROLLED_TEMP_ROOT);
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      !['ENOENT', 'ENOTEMPTY'].includes(String(error.code))
    ) {
      throw error;
    }
  }
}

function requiredValue<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`Missing ${label}.`);
  return value;
}

function schemaObjects(database: DatabaseSync): readonly string[] {
  return (
    database
      .prepare(
        `SELECT type || ':' || name AS identity
         FROM sqlite_master
         WHERE type IN ('table', 'trigger') AND name NOT LIKE 'sqlite_%'
         ORDER BY type, name`,
      )
      .all() as unknown as readonly { readonly identity: string }[]
  ).map(({ identity }) => identity);
}

function rowCount(database: DatabaseSync, table: string): number {
  return (
    database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
      readonly count: number;
    }
  ).count;
}

function userLineage(payload: ContentDraftPayloadV1, workId: string): readonly DraftLineageRefV1[] {
  return Object.freeze([
    Object.freeze({
      argumentId: null,
      briefFieldPath: 'coreJudgment.statement',
      evidenceRefIds: Object.freeze([]),
      experienceAssertionId: null,
      inputHash: payload.brief.briefInputHash,
      provenance: 'USER_EDITED' as const,
      structureSlotId: null,
      workId,
    }),
  ]);
}

function completeManualCopy(
  scaffold: ContentDraftPayloadV1,
  input: {
    readonly publicationDate: string;
    readonly workId: string;
    readonly workTitle: string;
  },
): ContentDraftPayloadV1 {
  const lineage = userLineage(scaffold, input.workId);
  const publicLabels = [...scaffold.brief.requiredPublicLabels];
  if (scaffold.brief.scorePlan.kind === 'RESEARCH_ANALYSIS_SCORE') {
    publicLabels.push('资料分析评分');
  }
  const blockTexts = [
    `该合成作品于${input.publicationDate}出版。`,
    '结构呈现支持这条有限判断。',
    '相反视角可能更重视叙事体验。',
    '结论只覆盖当前完全合成的受控材料。',
  ];
  return {
    ...scaffold,
    blocks: scaffold.blocks.map((block, index) => ({
      ...block,
      lineage,
      provenance: 'USER_EDITED',
      text: blockTexts[index] ?? '这是一条由用户手工填写的有限判断。',
    })),
    pinnedComment: {
      lineage,
      provenance: 'USER_EDITED',
      text: `${publicLabels.join('；')}：本内容仅用于完全合成的本地闭环验证。`,
    },
    selectedTitleId: 'manual-title',
    tags: [
      {
        lineage,
        provenance: 'USER_EDITED',
        tagId: 'manual-tag',
        text: '合成推理样本',
      },
    ],
    titles: [
      {
        kind: 'SELECTED',
        lineage,
        provenance: 'USER_EDITED',
        text: `${input.workTitle}：一条克制的本地判断`,
        titleId: 'manual-title',
      },
    ],
  };
}

function realIntakeDraft(
  suffix: string,
  readingState: RealResearchIntakeDraft['readingState'],
): RealResearchIntakeDraft {
  const workTitle = `真实作品${suffix}`;
  const authorName = `真实作者${suffix}`;
  return {
    authorName,
    authorizationConfirmed: true,
    editionNote: '用户确认的本地版本说明',
    publicationDate: '1841',
    readingState,
    sourceLocator: '用户本地研究笔记第 1 节',
    sourceTitle: `获准本地资料${suffix}`,
    sourceType: 'USER_LOCAL_NOTE',
    spoilerConfirmed: readingState === 'S1_RESEARCH_ONLY',
    spoilerLevel: readingState === 'S1_RESEARCH_ONLY' ? 'FULL_TRICK_ANALYSIS' : 'NO_SPOILER',
    statements: [
      {
        claimTarget: 'WORK_TITLE',
        confirmed: true,
        evidenceExcerpt: `本地资料将《${workTitle}》列为作品标题。`,
        evidenceLocator: '第 1 节标题栏',
        statement: `《${workTitle}》是本次录入的作品标题。`,
      },
      {
        claimTarget: 'NONE',
        confirmed: true,
        evidenceExcerpt: '',
        evidenceLocator: '',
        statement: '叙事结构可理解为本次资料分析的对象。',
      },
      {
        claimTarget: 'AUTHORSHIP',
        confirmed: true,
        evidenceExcerpt: '',
        evidenceLocator: '',
        statement: `作者是${authorName}。`,
      },
    ],
    workTitle,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  cleanControlledCases();
});

describe('M3 minimal local vertical slice', () => {
  it('persists a synthetic input through local review and reopens the complete fact chain', async () => {
    const networkGuard = vi.fn(() => {
      throw new Error('Unexpected external request in the local vertical slice.');
    });
    vi.stubGlobal('fetch', networkGuard);

    const caseDirectory = createControlledCaseDirectory();
    const root: ProjectDataRoot = await initializeProjectDataRoot(
      join(caseDirectory, 'project-data 中文 空格'),
    );
    const databasePath = join(root.databaseDirectory, 'rednote.sqlite');
    await initializeDatabase({ databasePath });
    let database: DatabaseSync | null = connectDatabase(databasePath);
    let briefRuntime: DesktopBriefRuntime | null = null;
    let copyRuntime: DesktopCopyRuntime | null = null;

    const syntheticDraft = {
      authorName: '虚构作者甲',
      publicationDate: '2099-04-17',
      sourceText:
        '完全合成本地资料卡。\n作品名：雾港七号钟楼（合成作品）\n作者：虚构作者甲\n出版日期：2099-04-17',
      sourceTitle: '本地合成作品资料卡',
      workTitle: '雾港七号钟楼（合成作品）',
    } as const;

    try {
      const schemaBefore = schemaObjects(database);
      const evidenceRuntime = new DesktopEvidenceRuntime(
        database,
        root,
        () => new Date('2026-07-31T04:00:00.000Z'),
      );

      expect(() =>
        evidenceRuntime.previewSyntheticIntake(
          {
            draft: {
              ...syntheticDraft,
              sourceText: '这里故意缺少日期定位。',
            },
          },
          11,
          22,
        ),
      ).toThrow(/EVIDENCE_INVALID_LOCATOR/u);
      expect(rowCount(database, 'sources')).toBe(0);
      expect(rowCount(database, 'claims')).toBe(0);

      const wrongSenderPreview = evidenceRuntime.previewSyntheticIntake(
        { draft: syntheticDraft },
        11,
        22,
      );
      await expect(
        evidenceRuntime.confirmSyntheticIntake(
          {
            confirmation: 'CREATE_SYNTHETIC_LOCAL_RESEARCH',
            inputHash: wrongSenderPreview.inputHash,
            previewHash: wrongSenderPreview.previewHash,
            token: wrongSenderPreview.token,
          },
          12,
          22,
        ),
      ).rejects.toThrow(/EVIDENCE_CONFIRMATION_INVALID/u);

      const intakePreview = evidenceRuntime.previewSyntheticIntake(
        { draft: syntheticDraft },
        11,
        22,
      );
      expect(intakePreview).toMatchObject({
        estimatedExternalRequests: 0,
        estimatedModelRequests: 0,
        feeState: 'NOT_INCURRED',
        labels: ['MANUAL_INPUT', 'SYNTHETIC_ONLY', 'LOCAL_PERSISTED', 'MODEL_UNUSED'],
      });
      expect(intakePreview.claimLocators).toHaveLength(3);
      expect(intakePreview.claimLocators.map(({ excerpt }) => excerpt)).toEqual([
        syntheticDraft.workTitle,
        syntheticDraft.authorName,
        syntheticDraft.publicationDate,
      ]);

      const intake = await evidenceRuntime.confirmSyntheticIntake(
        {
          confirmation: 'CREATE_SYNTHETIC_LOCAL_RESEARCH',
          inputHash: intakePreview.inputHash,
          previewHash: intakePreview.previewHash,
          token: intakePreview.token,
        },
        11,
        22,
      );
      expect(intake).toMatchObject({
        externalRequestCount: 0,
        feeState: 'NOT_INCURRED',
        modelRequestCount: 0,
      });
      expect(intake.claims).toHaveLength(3);
      expect(intake.claims.every(({ status }) => status === 'VERIFIED')).toBe(true);
      expect(rowCount(database, 'sources')).toBe(1);
      expect(rowCount(database, 'claims')).toBe(3);
      expect(rowCount(database, 'claim_evidence')).toBe(3);
      expect(rowCount(database, 'fact_evaluations')).toBe(3);

      const dossiers = new SqliteDossierRepository(database);
      const dossierPlan = dossiers.previewBuild(
        { id: intake.workId, type: 'WORK' },
        '2026-07-31T04:01:00.000Z',
      );
      expect(dossierPlan).toMatchObject({
        estimatedModelRequests: 0,
        readinessAfter: 'READY_FOR_CONTENT_BRIEF',
      });
      const dossierConfirmation = dossiers.confirmBuild(
        dossierPlan.planId,
        dossierPlan.planHash,
        'vertical-slice-dossier',
        '2026-07-31T04:01:01.000Z',
      );
      dossiers.executeBuild(
        requiredValue(dossierConfirmation.payload, 'Dossier build payload'),
        '2026-07-31T04:01:02.000Z',
      );
      const dossierDetail = dossiers.getDossierDetail(dossierPlan.dossierId);
      expect(dossierDetail.dossier.readiness).toBe('READY_FOR_CONTENT_BRIEF');
      expect(dossierDetail.entries).toHaveLength(3);
      expect(
        dossierDetail.entries.every(
          ({ claimIds, factEvaluationIds, evidenceIds, sourceRevisionIds }) =>
            claimIds.length === 1 &&
            factEvaluationIds.length === 1 &&
            evidenceIds.length === 1 &&
            sourceRevisionIds.length === 1,
        ),
      ).toBe(true);

      const topics = new SqliteTopicRepository(database);
      const blockedTopics = topics.previewGeneration('primary', '2026-07-31T04:02:00.000Z');
      expect(Object.values(blockedTopics.counts).every((count) => count === 0)).toBe(true);

      const authenticity = new DesktopAuthenticityRuntime(database);
      const authenticityPreview = authenticity.preview(
        {
          draft: {
            confirmationKind: 'USER_EXPLICIT',
            expectedRevision: 0,
            finishedAt: null,
            finishedAtPrecision: 'UNKNOWN',
            lastReadAt: null,
            lastReadAtPrecision: 'UNKNOWN',
            memoryConfidence: 'NOT_APPLICABLE',
            nextState: 'S1_RESEARCH_ONLY',
            profileId: 'primary',
            provenance: 'USER_UI',
            subject: { editionId: null, expressionId: null, workId: intake.workId },
            userNote: '完全合成作品，仅采用公开资料研究表达。',
          },
          kind: 'STATE_CHANGE',
        },
        11,
        22,
      );
      const authenticityResult = authenticity.confirm(
        {
          confirmation: 'APPLY_AUTHENTICITY_ACTION',
          kind: authenticityPreview.kind,
          previewHash: authenticityPreview.previewHash,
          token: authenticityPreview.token,
        },
        11,
        22,
      );
      expect(authenticityResult).toMatchObject({
        detail: {
          permission: {
            firstPersonPermission: 'BLOCKED',
            publicResearchAnalysisPermission: 'RESEARCH_ONLY',
          },
          readingState: 'S1_RESEARCH_ONLY',
        },
      });

      const topicPreview = topics.previewGeneration('primary', '2026-07-31T04:03:00.000Z');
      const topicExecution = topics.confirmGeneration(
        topicPreview,
        'vertical-slice-topic',
        '2026-07-31T04:03:01.000Z',
      );
      expect(topicExecution).toMatchObject({
        externalRequestCount: 0,
        status: 'SUCCEEDED',
      });
      const topicPool = topics.listPool('primary', {
        contentType: 'NON_SPOILER_SINGLE_BOOK_VERDICT',
        eligibility: 'ELIGIBLE',
        limit: 25,
        offset: 0,
        query: '',
        state: null,
      });
      const topic = requiredValue(
        topicPool.items.find((item) =>
          topics.getTopic(item.topicId).subjects.some(({ workId }) => workId === intake.workId),
        ),
        'eligible Topic for the synthetic Work',
      );
      const lockedTopic = topics.applyStateChange(
        topics.previewStateChange({
          action: 'LOCK',
          expectedRevision: topic.revision,
          topicId: topic.topicId,
        }),
        '2026-07-31T04:03:02.000Z',
      );
      expect(lockedTopic.candidateState).toBe('LOCKED');

      briefRuntime = new DesktopBriefRuntime(database, {
        clock: () => new Date('2026-07-31T04:04:00.000Z'),
      });
      const briefPreview = briefRuntime.preview(
        {
          assignmentPlanId: null,
          kind: 'CREATE_SCAFFOLD',
          topicId: topic.topicId,
        },
        11,
        22,
      );
      const briefCreated = briefRuntime.confirm(
        {
          confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
          executionId: null,
          kind: briefPreview.kind,
          previewHash: briefPreview.previewHash,
          token: briefPreview.token,
        },
        11,
        22,
      );
      if (!('detail' in briefCreated)) throw new Error('Expected a local Brief scaffold.');
      const briefSavePreview = briefRuntime.preview(
        {
          briefId: briefCreated.detail.briefId,
          draft: completeBriefDraft(briefCreated.detail.draft),
          expectedRevision: briefCreated.detail.revision,
          kind: 'SAVE_EDIT',
        },
        11,
        22,
      );
      const briefSaved = briefRuntime.confirm(
        {
          confirmation: 'APPLY_CONTENT_BRIEF_ACTION',
          executionId: null,
          kind: briefSavePreview.kind,
          previewHash: briefSavePreview.previewHash,
          token: briefSavePreview.token,
        },
        11,
        22,
      );
      if (!('detail' in briefSaved)) throw new Error('Expected a saved local Brief.');
      expect(briefSaved.detail).toMatchObject({
        readiness: 'READY_FOR_DRAFT_GENERATION',
        readinessReasonCodes: [],
      });

      copyRuntime = new DesktopCopyRuntime(database, {
        clock: () => new Date('2026-07-31T04:05:00.000Z'),
      });
      const copyPreview = copyRuntime.preview(
        { briefId: briefSaved.detail.briefId, kind: 'CREATE_MANUAL_SCAFFOLD' },
        11,
        22,
      );
      const copyCreated = copyRuntime.confirm(
        {
          confirmation: 'APPLY_COPY_ACTION',
          executionId: null,
          kind: copyPreview.kind,
          previewHash: copyPreview.previewHash,
          token: copyPreview.token,
        },
        11,
        22,
      );
      if (!('detail' in copyCreated)) throw new Error('Expected a manual Copy scaffold.');
      const manualPayload = completeManualCopy(copyCreated.detail.payload, {
        publicationDate: syntheticDraft.publicationDate,
        workId: intake.workId,
        workTitle: syntheticDraft.workTitle,
      });
      expect(validateDraftStructure(manualPayload).reasonCodes).toEqual([]);
      const copySavePreview = copyRuntime.preview(
        {
          draftId: copyCreated.detail.draftId,
          expectedRevision: copyCreated.detail.revision,
          kind: 'SAVE_VERSION',
          payload: manualPayload,
        },
        11,
        22,
      );
      const copySaved = copyRuntime.confirm(
        {
          confirmation: 'APPLY_COPY_ACTION',
          executionId: null,
          kind: copySavePreview.kind,
          previewHash: copySavePreview.previewHash,
          token: copySavePreview.token,
        },
        11,
        22,
      );
      if (!('detail' in copySaved)) throw new Error('Expected a saved manual Copy version.');
      expect(copySaved.detail.status).toBe('READY_FOR_QUALITY_PIPELINE');

      const factMapping = new SqliteFactMappingRepository(database);
      const factPreview = factMapping.previewStart({
        draftId: copySaved.detail.draftId,
        mode: 'LOCAL_MANUAL',
        now: '2026-07-31T04:06:00.000Z',
      });
      expect(factPreview.plan).toMatchObject({
        maximumModelRequests: 0,
        mode: 'LOCAL_MANUAL',
      });
      const factExecution = factMapping.confirmLocalStart({
        executionId: 'vertical-slice-fact-mapping',
        now: '2026-07-31T04:06:01.000Z',
        planId: factPreview.plan.planId,
        previewHash: factPreview.plan.previewHash,
      });
      expect(['AWAITING_REVIEW', 'FACT_BLOCKED', 'PASS']).toContain(
        factExecution.checkVersion.rollup.status,
      );
      const factDetail = factMapping.get(copySaved.detail.draftId);
      const dateStatement = requiredValue(
        factDetail.statements.find(({ fragment }) =>
          fragment.includes(syntheticDraft.publicationDate),
        ),
        'Draft publication-date Statement',
      );
      const dateClaim = requiredValue(
        intake.claims.find(({ predicate }) => predicate === 'publication_date'),
        'publication-date Claim',
      );
      expect(factDetail.candidates.some(({ claimId }) => claimId === dateClaim.claimId)).toBe(true);
      const decision = {
        claimId: dateClaim.claimId,
        draftId: copySaved.detail.draftId,
        expectedRevision: factDetail.checkVersion?.decisionRevision ?? -1,
        kind: 'MAP_CLAIM' as const,
        reason: '已核对完全合成的本地证据链。',
        relation: 'EXACT' as const,
        statementId: dateStatement.statementId,
      };
      const decisionPreview = factMapping.previewDecision(decision, '2026-07-31T04:06:02.000Z');
      const decisionApplied = factMapping.applyDecision({
        decision,
        executionId: 'vertical-slice-fact-decision',
        now: '2026-07-31T04:06:03.000Z',
        previewHash: factMappingHash({ decision, preview: decisionPreview }),
      });
      const mappedDateStatement = requiredValue(
        decisionApplied.detail.statements.find(
          ({ claimId, fragment }) =>
            claimId === dateClaim.claimId && fragment.includes(syntheticDraft.publicationDate),
        ),
        'versioned mapped publication-date Statement',
      );
      expect(mappedDateStatement).toMatchObject({
        claimId: dateClaim.claimId,
        factPolicyReasonCode: 'OFFICIAL_PRIMARY_VERIFIED',
      });
      expect(mappedDateStatement.statementId).not.toBe(dateStatement.statementId);
      const chain = factMapping.getClaimChain(mappedDateStatement.statementId);
      expect(chain).toMatchObject({
        claim: {
          claimId: dateClaim.claimId,
          current: true,
          predicate: 'publication_date',
          subjectId: intake.workId,
        },
        evaluation: {
          evaluationId: dateClaim.evaluationId,
          reasonCode: 'OFFICIAL_PRIMARY',
          status: 'VERIFIED',
        },
      });
      expect(chain.evidence).toHaveLength(1);
      expect(chain.evidence[0]?.source.revisionId).toBe(intake.sourceRevisionId);
      expect(JSON.stringify(chain)).not.toMatch(/https?:\/\/|sources\/snapshots|[A-Z]:\\/iu);

      expect(schemaObjects(database)).toEqual(schemaBefore);
      expect(rowCount(database, 'model_runs')).toBe(0);
      expect(rowCount(database, 'cost_ledger')).toBe(0);
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(networkGuard).not.toHaveBeenCalled();

      await briefRuntime.close();
      briefRuntime = null;
      await copyRuntime.close();
      copyRuntime = null;
      database.close();
      database = null;

      const reopened = connectDatabase(databasePath);
      try {
        const reopenedChain = new SqliteFactMappingRepository(reopened).getClaimChain(
          mappedDateStatement.statementId,
        );
        expect(reopenedChain).toEqual(chain);
        expect(
          new SqliteDossierRepository(reopened).getDossierDetail(dossierPlan.dossierId).dossier,
        ).toMatchObject({
          readiness: 'READY_FOR_CONTENT_BRIEF',
          subject: { id: intake.workId, type: 'WORK' },
        });
        expect(new SqliteTopicRepository(reopened).getTopic(topic.topicId)).toMatchObject({
          candidateState: 'LOCKED',
          eligibility: 'ELIGIBLE',
        });
        expect(new SqliteBriefRepository(reopened).get(briefSaved.detail.briefId)).toMatchObject({
          readiness: 'READY_FOR_DRAFT_GENERATION',
        });
        expect(new SqliteCopyRepository(reopened).get(copySaved.detail.draftId)).toMatchObject({
          status: 'READY_FOR_QUALITY_PIPELINE',
        });
        const separator = intake.sourceRevisionId.lastIndexOf(':');
        const sourceId = intake.sourceRevisionId.slice(0, separator);
        const sourceRevision = Number(intake.sourceRevisionId.slice(separator + 1));
        const sourceRow = reopened
          .prepare(
            `SELECT extracted_text_path
             FROM source_revisions
             WHERE source_id = ? AND revision = ?`,
          )
          .get(sourceId, sourceRevision) as { readonly extracted_text_path: string };
        expect(sourceRow.extracted_text_path).not.toMatch(/^[A-Za-z]:|^[/\\]/u);
        const managedPath = parseManagedRelativePath(
          sourceRow.extracted_text_path,
          'SOURCE_SNAPSHOT',
        );
        await expect(
          new LocalFileRepository(root).statManagedFile(managedPath),
        ).resolves.toMatchObject({ managedPath, sizeBytes: expect.any(Number) });
        expect(reopened.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      } finally {
        reopened.close();
      }
    } finally {
      if (briefRuntime !== null) await briefRuntime.close();
      if (copyRuntime !== null) await copyRuntime.close();
      if (database !== null) database.close();
    }
  });

  it('keeps authorized real intake distinct, idempotent, ambiguity-safe, and transactional', async () => {
    const networkGuard = vi.fn(() => {
      throw new Error('Unexpected external request in authorized real intake.');
    });
    vi.stubGlobal('fetch', networkGuard);
    const caseDirectory = createControlledCaseDirectory();
    const root = await initializeProjectDataRoot(join(caseDirectory, 'real-intake-data'));
    const databasePath = join(root.databaseDirectory, 'rednote.sqlite');
    await initializeDatabase({ databasePath });
    const database = connectDatabase(databasePath);
    let clock = new Date('2026-08-01T05:00:00.000Z');
    try {
      const runtime = new DesktopEvidenceRuntime(database, root, () => clock);
      const invalid = realIntakeDraft('缺授权', 'S1_RESEARCH_ONLY');
      expect(() =>
        runtime.previewRealIntake(
          { draft: { ...invalid, authorizationConfirmed: false } },
          101,
          201,
        ),
      ).toThrow(/EVIDENCE_INVALID_REQUEST/u);
      expect(rowCount(database, 'books')).toBe(0);

      const wrongWindow = runtime.previewRealIntake(
        { draft: realIntakeDraft('错误窗口', 'R1_READ_CLEAR') },
        101,
        201,
      );
      await expect(
        runtime.confirmRealIntake(
          {
            confirmation: 'CREATE_AUTHORIZED_REAL_RESEARCH',
            inputHash: wrongWindow.inputHash,
            previewHash: wrongWindow.previewHash,
            token: wrongWindow.token,
          },
          101,
          202,
        ),
      ).rejects.toThrow(/EVIDENCE_CONFIRMATION_INVALID/u);

      const expired = runtime.previewRealIntake(
        { draft: realIntakeDraft('过期确认', 'R2_READ_FUZZY') },
        101,
        201,
      );
      clock = new Date('2026-08-01T05:06:00.000Z');
      await expect(
        runtime.confirmRealIntake(
          {
            confirmation: 'CREATE_AUTHORIZED_REAL_RESEARCH',
            inputHash: expired.inputHash,
            previewHash: expired.previewHash,
            token: expired.token,
          },
          101,
          201,
        ),
      ).rejects.toThrow(/EVIDENCE_CONFIRMATION_EXPIRED/u);

      const states = ['S1_RESEARCH_ONLY', 'R1_READ_CLEAR', 'R2_READ_FUZZY'] as const;
      for (const [index, readingState] of states.entries()) {
        clock = new Date(`2026-08-01T05:${String(10 + index).padStart(2, '0')}:00.000Z`);
        const draft = realIntakeDraft(String(index + 1), readingState);
        const preview = runtime.previewRealIntake({ draft }, 101, 201);
        expect(preview).toMatchObject({
          canConfirm: true,
          entityResolution: { candidates: [], outcome: 'CREATE_NEW' },
          estimatedExternalRequests: 0,
          estimatedModelRequests: 0,
          feeState: 'NOT_INCURRED',
          readingState,
          source: { originKind: 'USER_LOCAL_INPUT', sourceType: 'USER_LOCAL_NOTE' },
        });
        expect(
          preview.statements.map(({ classification, disposition }) => [
            classification,
            disposition,
          ]),
        ).toEqual([
          ['FACT', 'CLAIM_WITH_EVIDENCE'],
          ['MIXED', 'SOURCE_ONLY_NON_FACT'],
          ['FACT', 'CLAIM_WITHOUT_EVIDENCE'],
        ]);
        const confirmation = {
          confirmation: 'CREATE_AUTHORIZED_REAL_RESEARCH' as const,
          inputHash: preview.inputHash,
          previewHash: preview.previewHash,
          token: preview.token,
        };
        const saved = await runtime.confirmRealIntake(confirmation, 101, 201);
        const replay = await runtime.confirmRealIntake(confirmation, 101, 201);
        expect(replay).toEqual(saved);
        expect(saved).toMatchObject({
          externalRequestCount: 0,
          feeState: 'NOT_INCURRED',
          modelRequestCount: 0,
          readingState,
          scoreRecordsCreated: 0,
          sourceOriginKind: 'USER_LOCAL_INPUT',
        });
        expect(saved.statements).toMatchObject([
          { classification: 'FACT', status: 'SUPPORTED_NOT_VERIFIED' },
          { claimId: null, classification: 'MIXED', status: 'SOURCE_ONLY_NON_FACT' },
          { classification: 'FACT', evidenceId: null, status: 'NOT_EVALUATED' },
        ]);
        const detail = database
          .prepare(
            `SELECT state.state, spoiler.spoiler_level
             FROM reading_states AS root
             JOIN reading_state_revisions AS state ON state.id = root.current_revision_id
             JOIN reading_spoiler_preferences AS preference ON preference.reading_state_id = root.id
             JOIN reading_spoiler_preference_revisions AS spoiler
               ON spoiler.id = preference.current_revision_id
             WHERE root.book_id = ?`,
          )
          .get(saved.workId);
        expect(detail).toMatchObject({
          spoiler_level: readingState === 'S1_RESEARCH_ONLY' ? 'FULL_TRICK_ANALYSIS' : 'NO_SPOILER',
          state: readingState,
        });
        const duplicate = runtime.previewRealIntake({ draft }, 101, 201);
        expect(duplicate).toMatchObject({
          canConfirm: false,
          entityResolution: { outcome: 'AMBIGUOUS_REVIEW_REQUIRED' },
        });
      }
      expect(rowCount(database, 'books')).toBe(3);
      expect(rowCount(database, 'sources')).toBe(3);
      expect(rowCount(database, 'claims')).toBe(6);
      expect(rowCount(database, 'claim_evidence')).toBe(3);
      expect(rowCount(database, 'personal_score_records')).toBe(0);
      expect(rowCount(database, 'research_analysis_score_records')).toBe(0);
      expect(rowCount(database, 'experience_assertions')).toBe(0);
      expect(
        database
          .prepare(
            `SELECT count(*) AS count FROM source_revisions
             WHERE origin_kind = 'USER_LOCAL_INPUT'`,
          )
          .get(),
      ).toEqual({ count: 3 });
      expect(database.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      expect(networkGuard).not.toHaveBeenCalled();
    } finally {
      database.close();
    }

    const rollbackRoot = await initializeProjectDataRoot(join(caseDirectory, 'rollback-data'));
    const rollbackPath = join(rollbackRoot.databaseDirectory, 'rednote.sqlite');
    await initializeDatabase({ databasePath: rollbackPath });
    const rollbackDatabase = connectDatabase(rollbackPath);
    try {
      const runtime = new DesktopEvidenceRuntime(rollbackDatabase, rollbackRoot);
      const preview = runtime.previewRealIntake(
        { draft: realIntakeDraft('事务回滚', 'S1_RESEARCH_ONLY') },
        301,
        401,
      );
      rollbackDatabase.prepare("DELETE FROM account_profiles WHERE id = 'primary'").run();
      await expect(
        runtime.confirmRealIntake(
          {
            confirmation: 'CREATE_AUTHORIZED_REAL_RESEARCH',
            inputHash: preview.inputHash,
            previewHash: preview.previewHash,
            token: preview.token,
          },
          301,
          401,
        ),
      ).rejects.toThrow(/EVIDENCE_INVALID_REQUEST/u);
      for (const table of ['books', 'sources', 'claims', 'claim_evidence', 'reading_states']) {
        expect(rowCount(rollbackDatabase, table)).toBe(0);
      }
      expect(rollbackDatabase.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    } finally {
      rollbackDatabase.close();
    }
  });
});
