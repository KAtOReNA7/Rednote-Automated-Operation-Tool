export {
  DATA_ROOT_FORMAT,
  DATA_ROOT_FORMAT_VERSION,
  DATA_ROOT_MARKER_FILE,
  initializeProjectDataRoot,
  openProjectDataRoot,
  ProjectDataRoot,
  REQUIRED_DATA_DIRECTORIES,
} from './project-data-root.js';
export { LocalFileRepository } from './local-file-repository.js';
export {
  LocalProjectLocator,
  PROJECT_LOCATOR_FILE,
  PROJECT_LOCATOR_FORMAT,
  PROJECT_LOCATOR_SUBDIRECTORY,
  PROJECT_LOCATOR_VERSION,
  projectLocatorPathForTesting,
} from './project-locator.js';
export { LocalDiagnosticReportStore } from './diagnostic-report-store.js';
export { relativePathFromManagedAbsolutePath, resolveManagedPath } from './managed-path.js';
export { StructuredLogSink } from './structured-log.js';

export type { DataRootMarker, ProjectDataRootOptions } from './project-data-root.js';
export type { LocalProjectLocatorOptions } from './project-locator.js';
export type { LocalDiagnosticReportStoreOptions } from './diagnostic-report-store.js';
export type {
  FileDescriptor,
  LocalFileRepositoryOptions,
  ManagedFileStat,
  PutFileOptions,
  VerifyManagedFileOptions,
} from './local-file-repository.js';
export type { LogLevel, StructuredLogEvent, StructuredLogSinkOptions } from './structured-log.js';
