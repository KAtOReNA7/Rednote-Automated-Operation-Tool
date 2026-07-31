export { connectDatabase, resolveDatabasePath } from './connection.js';
export { SqliteAuthenticityRepository } from './authenticity-repository.js';
export { SqliteBriefRepository } from './brief-repository.js';
export { SqliteCopyRepository } from './copy-repository.js';
export { SqliteCatalogRepository } from './catalog-repository.js';
export { SqliteFetchRepository } from './fetch-repository.js';
export { SqliteFactMappingRepository } from './fact-mapping-repository.js';
export { SqliteEvidenceRepository } from './evidence-repository.js';
export { SqliteExperimentRepository } from './experiment-repository.js';
export { SqliteDossierRepository } from './dossier-repository.js';
export { SqliteBrowserClipRepository } from './browser-clip-repository.js';
export type {
  BriefDetailView,
  BriefGenerationExecution,
  BriefListItem,
  BriefListView,
  BriefVersionDiff,
} from './brief-repository.js';
export { COPY_PROTECTED_TABLES, COPY_REPOSITORY_INVARIANTS } from './copy-repository.js';
export type {
  CopyDetailView,
  CopyListItem,
  CopyListView,
  CopyMutationExecution,
  CopyVersionDiff,
} from './copy-repository.js';
export type {
  BrowserClipScreenshotRecordV1,
  BrowserClipViewV1,
} from './browser-clip-repository.js';
export { JobQueueRepository, JobQueueRepositoryError } from './job-queue-repository.js';
export { SqliteLocalApiRepository } from './local-api-repository.js';
export { MigrationError, initializeDatabase, migrationChecksum } from './migration-runner.js';
export { MIGRATIONS } from './migrations.js';
export { SqliteModelAccountingRepository } from './model-accounting-repository.js';
export { assertSqliteRuntimeCapabilities } from './runtime-capabilities.js';
export { SqliteSettingsRepository } from './settings-repository.js';
export { SqliteProviderCapabilityRepository } from './provider-capability-repository.js';
export { SqliteSearchRepository } from './search-repository.js';
export { SqliteTopicRepository } from './topic-repository.js';
export { runInTransaction } from './transaction.js';

export type { InitializeDatabaseOptions, MigrationResult } from './migration-runner.js';
export type {
  AssertionActionPreview,
  AssertionRevokeActionPreview,
  AuthenticityActionPreviewPayload,
  AuthenticityLibraryItem,
  AuthenticityLibraryView,
  AuthenticityPermissionView,
  AuthenticityWorkDetail,
  BatchActionPreview,
  BatchApplyResult,
  ExperienceAssertionView,
  PublicScoreView,
  ReadingStateActionPreview,
  ReadingStateRevisionView,
  ReadingUndoActionPreview,
  ScoreActionPreview,
  SpoilerActionPreview,
  SpoilerPreferenceView,
} from './authenticity-repository.js';
export type {
  CatalogCoverageViewV1,
  CatalogResolutionCaseViewV1,
  CatalogRunViewV1,
  CatalogSummaryViewV1,
  CatalogWorkDetailV1,
  CatalogWorkListItemV1,
  UndoDecisionPreviewV1,
  WorkMergePreviewV1,
  WorkSplitPreviewV1,
} from './catalog-repository.js';
export type { FetchRunSummaryRecordV1 } from './fetch-repository.js';
export type {
  AddClaimEvidenceInputV1,
  AddSourceRevisionInputV1,
  EvidenceClaimViewV1,
  EvidenceEvaluationViewV1,
  EvidenceSourceViewV1,
  EvidenceSummaryViewV1,
  FactConflictPreviewV1,
  FactConflictViewV1,
  RegisterSourceInputV1,
  SourceClassificationInputV1,
} from './evidence-repository.js';
export type {
  FactMappingClaimChainView,
  FactMappingDetailView,
  FactMappingDisplayStatus,
  FactMappingListItem,
  FactMappingListView,
  FactMappingPreviewView,
  FactMappingPreparedExecution,
  FactMappingStartExecution,
  FactMappingStatementView,
  FactMappingWorkflowExecution,
} from './fact-mapping-repository.js';
export type {
  ExperimentActionPreview,
  ExperimentAssignmentPreview,
  ExperimentDetailView,
  ExperimentListItem,
  ExperimentListView,
} from './experiment-repository.js';
export type {
  ConfirmDossierBuildResult,
  DossierBuildExecutionResult,
  DossierDetailView,
  DossierInvalidationInput,
  DossierListItem,
  DossierListView,
  DossierVersionDiff,
} from './dossier-repository.js';
export type {
  ClaimStoredJobInput,
  EnqueueStoredJobInput,
  JobRepositoryErrorCode,
  LeaseOperationInput,
  ListStoredJobsInput,
  QueueStats,
  StoredJob,
} from './job-queue-repository.js';
export type { Migration } from './migrations.js';
export type {
  ModelBudgetSummary,
  ModelCacheEntryRecord,
  ModelCostState,
  ModelPriceScheduleRecord,
  ModelRunIdentityInput,
  ModelRunRecord,
  ModelRunStatus,
  ModelUnitPolicyRecord,
  UsageColumnsInput,
} from './model-accounting-repository.js';
export type { SqliteRuntimeCapabilities } from './runtime-capabilities.js';
export type {
  ProviderCapabilityEntryRecord,
  ProviderCapabilityRunHistoryRecord,
  ProviderCapabilityStateRecord,
} from './provider-capability-repository.js';
export type {
  SearchProviderConfigRecordV1,
  SearchRunSummaryV1,
  StoredSearchProviderConfigV1,
} from './search-repository.js';
export type {
  TopicBatchApplyResult,
  TopicBatchStatePreview,
  TopicDetailView,
  TopicGenerationExecutionResult,
  TopicGenerationCancelPreview,
  TopicGenerationRepositoryPreview,
  TopicGenerationRunView,
  TopicPoolItem,
  TopicPoolView,
  TopicQuotaPlanView,
  TopicQuotaRepositoryPreview,
  TopicRankingComponentView,
  TopicStateActionPreview,
  TopicStateUndoPreview,
} from './topic-repository.js';
