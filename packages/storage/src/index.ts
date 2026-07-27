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
export { relativePathFromManagedAbsolutePath, resolveManagedPath } from './managed-path.js';
export { StructuredLogSink } from './structured-log.js';

export type { DataRootMarker, ProjectDataRootOptions } from './project-data-root.js';
export type {
  FileDescriptor,
  LocalFileRepositoryOptions,
  ManagedFileStat,
  PutFileOptions,
  VerifyManagedFileOptions,
} from './local-file-repository.js';
export type { LogLevel, StructuredLogEvent, StructuredLogSinkOptions } from './structured-log.js';
