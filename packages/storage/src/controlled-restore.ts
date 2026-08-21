import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm, statfs } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import {
  DATA_ROOT_FORMAT,
  DATA_ROOT_FORMAT_VERSION,
  DATA_ROOT_MARKER_FILE,
  openProjectDataRoot,
  REQUIRED_DATA_DIRECTORIES,
  type ProjectDataRoot,
} from './project-data-root.js';
import {
  ControlledBackupError,
  BACKUP_MAX_TOTAL_BYTES,
  type BackupManifestFileV1,
  type BackupManifestV1,
} from './backup-contracts.js';
import {
  verifyControlledBackupSnapshot,
  type ControlledBackupDatabaseVerifier,
} from './backup-snapshot.js';

const COPY_BUFFER_BYTES = 64 * 1024;
const RESTORE_SPACE_MARGIN_BYTES = 1024 * 1024;
const JOURNAL_FORMAT = 'rednote-controlled-restore-journal' as const;
const JOURNAL_VERSION = 1 as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export type ControlledRestoreErrorCode =
  | 'ABORTED'
  | 'COMPATIBILITY_BLOCKED'
  | 'INTEGRITY_FAILED'
  | 'INSUFFICIENT_SPACE'
  | 'INVALID_PATH'
  | 'MAINTENANCE_REQUIRED'
  | 'PREVIEW_INVALID'
  | 'RESTORE_FAILED'
  | 'SAFETY_UNPROVEN'
  | 'STAGING_OWNERSHIP_INVALID';

export class ControlledRestoreError extends Error {
  public constructor(public readonly code: ControlledRestoreErrorCode) {
    super(code);
    this.name = 'ControlledRestoreError';
    delete this.stack;
  }
}

export type ControlledRestoreStage =
  | 'PREFLIGHT'
  | 'BUILDING_STAGING'
  | 'SWITCHING'
  | 'VERIFYING'
  | 'SUCCESS'
  | 'ROLLBACK'
  | 'SAFETY_UNPROVEN';

export interface ControlledRestoreRuntimeIdentity {
  readonly appVersion: string;
  readonly migrationFingerprint: string;
  readonly schemaVersion: number;
  readonly v2DataVersion: number;
}

export interface ControlledRestoreCompatibilityPolicy {
  /** Explicit future compatibility entries only. R10B starts empty and never infers compatibility. */
  readonly allowedSourceAppVersions?: readonly string[];
}

export interface ControlledRestorePreflight {
  readonly backupCreatedAt: string;
  readonly backupFileCount: number;
  readonly backupSizeBytes: number;
  readonly compatibility: 'EXACT' | 'EXPLICIT';
  readonly manifestSha256: string;
  readonly liveRootIdentity: Readonly<{ readonly dev: number; readonly ino: number }>;
  readonly liveRootParentIdentity: Readonly<{ readonly dev: number; readonly ino: number }>;
  readonly operationId: string;
}

export interface PrepareControlledRestoreOptions {
  /** Test seam; production also constrains this value to the observed local filesystem capacity. */
  readonly availableBytes?: () => number;
  readonly backupPath: string;
  readonly database: ControlledBackupDatabaseVerifier;
  readonly policy?: ControlledRestoreCompatibilityPolicy;
  readonly root: ProjectDataRoot;
  readonly runtime: ControlledRestoreRuntimeIdentity;
  readonly signal?: AbortSignal;
  readonly randomId?: () => string;
}

export interface ExecuteControlledRestoreOptions extends PrepareControlledRestoreOptions {
  readonly preflight: ControlledRestorePreflight;
  readonly onStage?: (stage: ControlledRestoreStage) => void;
}

export interface ControlledRestoreResult {
  readonly cleanup: 'PROTECTION_RETAINED';
  readonly outcome: 'ROLLBACK' | 'SAFETY_UNPROVEN' | 'SUCCESS';
  readonly operationId: string;
  readonly stage: ControlledRestoreStage;
}

interface NodeIdentity {
  readonly dev: number;
  readonly ino: number;
}

interface RestoreJournalV1 {
  readonly format: typeof JOURNAL_FORMAT;
  readonly operationId: string;
  readonly manifestSha256: string;
  readonly phase: 'BUILDING_STAGING' | 'PROTECTED' | 'SWITCHED' | 'ROLLED_BACK' | 'SUCCESS';
  readonly protectionName: string;
  readonly rootName: string;
  readonly liveRootIdentity: NodeIdentity;
  readonly liveRootParentIdentity: NodeIdentity;
  readonly stagingName: string;
  readonly version: typeof JOURNAL_VERSION;
}

interface CheckedDirectory {
  readonly identity: NodeIdentity;
  readonly path: string;
}

interface RestoreOperationPaths {
  readonly journalPath: string;
  readonly protectionPath: string;
  readonly stagingPath: string;
}

function fail(code: ControlledRestoreErrorCode): ControlledRestoreError {
  return new ControlledRestoreError(code);
}

function stable(error: unknown, fallback: ControlledRestoreErrorCode): ControlledRestoreError {
  return error instanceof ControlledRestoreError ? error : fail(fallback);
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw fail('ABORTED');
}

function sameNode(left: NodeIdentity, right: NodeIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function nodeIdentity(status: Stats): NodeIdentity {
  return { dev: status.dev, ino: status.ino };
}

function validSiblingName(value: string): boolean {
  return /^\.rednote-restore-(?:staging|protection|journal)-[0-9a-f-]{36}(?:\.json)?$/iu.test(
    value,
  );
}

async function checkedDirectory(path: string): Promise<CheckedDirectory> {
  if (!isAbsolute(path) || path.includes('\0')) throw fail('INVALID_PATH');
  try {
    const status = await lstat(path);
    if (!status.isDirectory() || status.isSymbolicLink()) throw fail('INVALID_PATH');
    return { identity: nodeIdentity(status), path: resolve(path) };
  } catch (error) {
    throw stable(error, 'INVALID_PATH');
  }
}

function operationNames(operationId: string): {
  readonly journalName: string;
  readonly protectionName: string;
  readonly stagingName: string;
} {
  return {
    journalName: `.rednote-restore-journal-${operationId}.json`,
    protectionName: `.rednote-restore-protection-${operationId}`,
    stagingName: `.rednote-restore-staging-${operationId}`,
  };
}

function operationPath(parent: CheckedDirectory, name: string): string {
  if (!validSiblingName(name)) throw fail('INVALID_PATH');
  const path = resolve(parent.path, name);
  if (dirname(path) !== parent.path || basename(path) !== name) throw fail('INVALID_PATH');
  return path;
}

function operationPaths(parent: CheckedDirectory, operationId: string): RestoreOperationPaths {
  const names = operationNames(operationId);
  return {
    journalPath: operationPath(parent, names.journalName),
    protectionPath: operationPath(parent, names.protectionName),
    stagingPath: operationPath(parent, names.stagingName),
  };
}

async function existingOperationDirectory(path: string): Promise<CheckedDirectory | null> {
  try {
    const status = await lstat(path);
    if (!status.isDirectory() || status.isSymbolicLink()) throw fail('STAGING_OWNERSHIP_INVALID');
    return { identity: nodeIdentity(status), path: resolve(path) };
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return null;
    throw stable(error, 'STAGING_OWNERSHIP_INVALID');
  }
}

async function existingOperationJournal(path: string): Promise<Stats | null> {
  try {
    const status = await lstat(path);
    if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1)
      throw fail('STAGING_OWNERSHIP_INVALID');
    return status;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')
      return null;
    throw stable(error, 'STAGING_OWNERSHIP_INVALID');
  }
}

async function assertSameParent(parent: CheckedDirectory): Promise<void> {
  if (!sameNode(parent.identity, (await checkedDirectory(parent.path)).identity))
    throw fail('SAFETY_UNPROVEN');
}

async function removeOwnedOperationDirectory(
  parent: CheckedDirectory,
  path: string,
): Promise<void> {
  await assertSameParent(parent);
  if (await existingOperationDirectory(path)) {
    await assertSameParent(parent);
    await rm(path, { force: true, maxRetries: 3, recursive: true });
    if (await existingOperationDirectory(path)) throw fail('SAFETY_UNPROVEN');
  }
}

async function removeOwnedOperationJournal(parent: CheckedDirectory, path: string): Promise<void> {
  await assertSameParent(parent);
  const journal = await existingOperationJournal(path);
  if (journal !== null) {
    if (journal.size > 1024) throw fail('STAGING_OWNERSHIP_INVALID');
    await assertSameParent(parent);
    await rm(path, { force: true, maxRetries: 3 });
    if (await existingOperationJournal(path)) throw fail('SAFETY_UNPROVEN');
  }
}

function validNodeIdentity(value: unknown): value is NodeIdentity {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).sort().join(',') === 'dev,ino' &&
    Number.isFinite((value as NodeIdentity).dev) &&
    Number.isFinite((value as NodeIdentity).ino) &&
    Number.isInteger((value as NodeIdentity).dev) &&
    Number.isInteger((value as NodeIdentity).ino) &&
    (value as NodeIdentity).dev >= 0 &&
    (value as NodeIdentity).ino >= 0
  );
}

function validRootMarker(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const marker = value as Record<string, unknown>;
  if (
    Object.keys(marker).sort().join(',') !== 'createdAt,format,instanceId,version' ||
    marker.format !== DATA_ROOT_FORMAT ||
    marker.version !== DATA_ROOT_FORMAT_VERSION ||
    typeof marker.instanceId !== 'string' ||
    !UUID.test(marker.instanceId) ||
    typeof marker.createdAt !== 'string'
  )
    return false;
  try {
    return new Date(marker.createdAt).toISOString() === marker.createdAt;
  } catch {
    return false;
  }
}

/** This intentionally validates without creating missing layout entries. */
async function isExistingProjectDataRoot(path: string): Promise<boolean> {
  try {
    await checkedDirectory(path);
    const markerPath = join(path, DATA_ROOT_MARKER_FILE);
    const marker = await checkedRegularFile(markerPath);
    if (marker.size > 1024 || !validRootMarker(JSON.parse(await readFile(markerPath, 'utf8'))))
      return false;
    for (const relativeDirectory of REQUIRED_DATA_DIRECTORIES)
      await checkedDirectory(join(path, ...relativeDirectory.split('/')));
    return true;
  } catch {
    return false;
  }
}

function parseRestoreJournal(value: unknown, rootName: string): RestoreJournalV1 | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const journal = value as Partial<RestoreJournalV1>;
  if (
    Object.keys(journal).sort().join(',') !==
      'format,liveRootIdentity,liveRootParentIdentity,manifestSha256,operationId,phase,protectionName,rootName,stagingName,version' ||
    journal.format !== JOURNAL_FORMAT ||
    journal.version !== JOURNAL_VERSION ||
    journal.rootName !== rootName ||
    typeof journal.operationId !== 'string' ||
    !UUID.test(journal.operationId) ||
    journal.operationId !== journal.operationId.toLowerCase() ||
    typeof journal.manifestSha256 !== 'string' ||
    !/^[0-9a-f]{64}$/u.test(journal.manifestSha256) ||
    !validNodeIdentity(journal.liveRootIdentity) ||
    !validNodeIdentity(journal.liveRootParentIdentity) ||
    !['BUILDING_STAGING', 'PROTECTED', 'SWITCHED', 'ROLLED_BACK', 'SUCCESS'].includes(
      journal.phase ?? '',
    )
  )
    return null;
  const expected = operationNames(journal.operationId);
  if (
    journal.stagingName !== expected.stagingName ||
    journal.protectionName !== expected.protectionName
  )
    return null;
  return journal as RestoreJournalV1;
}

async function checkedRegularFile(path: string): Promise<Stats> {
  try {
    const status = await lstat(path);
    if (!status.isFile() || status.isSymbolicLink() || status.nlink !== 1)
      throw fail('INTEGRITY_FAILED');
    return status;
  } catch (error) {
    throw stable(error, 'INTEGRITY_FAILED');
  }
}

async function hashRegularFile(path: string, expected: BackupManifestFileV1): Promise<void> {
  const before = await checkedRegularFile(path);
  if (before.size !== expected.sizeBytes) throw fail('INTEGRITY_FAILED');
  const handle = await open(path, constants.O_RDONLY);
  const hash = createHash('sha256');
  try {
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (result.bytesRead === 0) break;
      hash.update(buffer.subarray(0, result.bytesRead));
    }
  } catch (error) {
    throw stable(error, 'INTEGRITY_FAILED');
  } finally {
    await handle.close().catch(() => undefined);
  }
  const after = await checkedRegularFile(path);
  if (before.size !== after.size || hash.digest('hex') !== expected.sha256)
    throw fail('INTEGRITY_FAILED');
}

async function copyRegularFile(
  source: string,
  destination: string,
  expected: BackupManifestFileV1,
  signal?: AbortSignal,
): Promise<void> {
  checkAborted(signal);
  const before = await checkedRegularFile(source);
  if (before.size !== expected.sizeBytes) throw fail('INTEGRITY_FAILED');
  const input = await open(source, constants.O_RDONLY);
  let output;
  const hash = createHash('sha256');
  let copied = 0;
  try {
    output = await open(
      destination,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    );
    const buffer = Buffer.allocUnsafe(COPY_BUFFER_BYTES);
    while (true) {
      checkAborted(signal);
      const read = await input.read(buffer, 0, buffer.length, null);
      if (read.bytesRead === 0) break;
      hash.update(buffer.subarray(0, read.bytesRead));
      let offset = 0;
      while (offset < read.bytesRead) {
        const written = await output.write(buffer, offset, read.bytesRead - offset, null);
        if (written.bytesWritten < 1) throw fail('RESTORE_FAILED');
        offset += written.bytesWritten;
      }
      copied += read.bytesRead;
    }
    await output.sync();
  } catch (error) {
    throw stable(error, 'RESTORE_FAILED');
  } finally {
    await output?.close().catch(() => undefined);
    await input.close().catch(() => undefined);
  }
  const after = await checkedRegularFile(source);
  if (
    after.size !== before.size ||
    copied !== expected.sizeBytes ||
    hash.digest('hex') !== expected.sha256
  )
    throw fail('INTEGRITY_FAILED');
}

function candidateRelativePath(file: BackupManifestFileV1): string {
  if (!file.relativePath.startsWith('payload/')) throw fail('INTEGRITY_FAILED');
  return file.relativePath.slice('payload/'.length);
}

function restoreStagingBytes(sizeBytes: number): number {
  const required = sizeBytes + RESTORE_SPACE_MARGIN_BYTES;
  if (
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes < 0 ||
    !Number.isSafeInteger(required) ||
    required > BACKUP_MAX_TOTAL_BYTES
  )
    throw fail('INSUFFICIENT_SPACE');
  return required;
}

async function assertRestoreCapacity(
  parentPath: string,
  required: number,
  availableBytes: (() => number) | undefined,
): Promise<void> {
  try {
    const filesystem = await statfs(parentPath);
    const observed = Number(BigInt(filesystem.bavail) * BigInt(filesystem.bsize));
    const available =
      availableBytes === undefined ? observed : Math.min(observed, availableBytes());
    if (!Number.isSafeInteger(available) || available < required) throw fail('INSUFFICIENT_SPACE');
  } catch (error) {
    throw stable(error, 'INSUFFICIENT_SPACE');
  }
}

function resolveCompatibility(
  manifest: BackupManifestV1,
  root: ProjectDataRoot,
  runtime: ControlledRestoreRuntimeIdentity,
  policy: ControlledRestoreCompatibilityPolicy | undefined,
): 'EXACT' | 'EXPLICIT' {
  const source = manifest.source;
  const explicitlyAllowed =
    runtime.appVersion === '0.1.0-beta.1' &&
    policy?.allowedSourceAppVersions?.includes(source.appVersion) === true;
  if (
    manifest.compatibilityPolicyVersion !== 1 ||
    source.dataRootFormat !== 'rednote-project-data' ||
    source.dataRootVersion !== root.marker.version ||
    source.v2DataVersion !== runtime.v2DataVersion ||
    source.schemaVersion !== runtime.schemaVersion ||
    source.migrationFingerprint !== runtime.migrationFingerprint ||
    (source.appVersion !== runtime.appVersion && !explicitlyAllowed)
  )
    throw fail('COMPATIBILITY_BLOCKED');
  return source.appVersion === runtime.appVersion ? 'EXACT' : 'EXPLICIT';
}

function journalText(value: RestoreJournalV1): string {
  return JSON.stringify(value);
}

async function writeJournal(path: string, value: RestoreJournalV1): Promise<void> {
  const handle = await open(path, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
  try {
    await handle.writeFile(journalText(value), 'utf8');
    await handle.sync();
  } catch (error) {
    throw stable(error, 'RESTORE_FAILED');
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function replaceJournal(path: string, value: RestoreJournalV1): Promise<void> {
  const existing = await checkedRegularFile(path);
  if (existing.size > 1024) throw fail('STAGING_OWNERSHIP_INVALID');
  const temporary = `${path}.next`;
  await writeJournal(temporary, value);
  try {
    await rename(temporary, path);
  } catch (error) {
    throw stable(error, 'RESTORE_FAILED');
  }
}

async function createCandidateRoot(
  stagingPath: string,
  root: ProjectDataRoot,
): Promise<ProjectDataRoot> {
  await mkdir(stagingPath, { mode: 0o700 });
  const markerSource = join(root.rootPath, DATA_ROOT_MARKER_FILE);
  const marker = await readFile(markerSource);
  if (marker.byteLength > 1024) throw fail('INTEGRITY_FAILED');
  const markerHandle = await open(join(stagingPath, DATA_ROOT_MARKER_FILE), 'wx', 0o600);
  try {
    await markerHandle.writeFile(marker);
    await markerHandle.sync();
  } finally {
    await markerHandle.close().catch(() => undefined);
  }
  try {
    return await openProjectDataRoot(stagingPath);
  } catch (error) {
    throw stable(error, 'RESTORE_FAILED');
  }
}

async function copyManifestPayload(
  backupPath: string,
  candidate: ProjectDataRoot,
  manifest: BackupManifestV1,
  signal?: AbortSignal,
): Promise<void> {
  for (const file of manifest.files) {
    checkAborted(signal);
    const relativePath = candidateRelativePath(file);
    const source = join(backupPath, ...file.relativePath.split('/'));
    const target = join(candidate.rootPath, ...relativePath.split('/'));
    if (
      !target.startsWith(`${candidate.rootPath}\\`) &&
      !target.startsWith(`${candidate.rootPath}/`)
    )
      throw fail('INVALID_PATH');
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await copyRegularFile(source, target, file, signal);
  }
}

async function verifyCandidateRoot(
  candidate: ProjectDataRoot,
  manifest: BackupManifestV1,
  database: ControlledBackupDatabaseVerifier,
): Promise<void> {
  const databaseFile = manifest.files.find((file) => file.category === 'DATABASE');
  if (databaseFile === undefined) throw fail('INTEGRITY_FAILED');
  const databasePath = join(candidate.rootPath, ...candidateRelativePath(databaseFile).split('/'));
  let identity;
  try {
    identity = database.inspectSnapshot(databasePath);
  } catch {
    throw fail('INTEGRITY_FAILED');
  }
  if (
    identity.schemaVersion !== manifest.source.schemaVersion ||
    identity.migrationFingerprint !== manifest.source.migrationFingerprint
  )
    throw fail('INTEGRITY_FAILED');
  const inventory = database.enumerateManagedFiles(databasePath);
  const expected = manifest.files
    .filter((file) => file.category !== 'DATABASE')
    .map((file) => ({
      category: file.category,
      path: candidateRelativePath(file),
      sha256: file.sha256,
      size: file.sizeBytes,
    }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
  const actual = inventory
    .map((file) => ({
      category: file.category,
      path: file.managedPath,
      sha256: file.expectedSha256,
      size: file.expectedSizeBytes,
    }))
    .sort((left, right) => left.path.localeCompare(right.path, 'en'));
  if (actual.length !== expected.length) throw fail('INTEGRITY_FAILED');
  for (const [index, item] of expected.entries()) {
    const entry = actual[index];
    if (
      entry === undefined ||
      entry.category !== item.category ||
      entry.path !== item.path ||
      (entry.sha256 !== null && entry.sha256 !== item.sha256) ||
      (entry.size !== null && entry.size !== item.size)
    )
      throw fail('INTEGRITY_FAILED');
  }
  for (const file of manifest.files)
    await hashRegularFile(
      join(candidate.rootPath, ...candidateRelativePath(file).split('/')),
      file,
    );
}

export async function prepareControlledRestore(
  options: PrepareControlledRestoreOptions,
): Promise<ControlledRestorePreflight> {
  checkAborted(options.signal);
  const operationId = (options.randomId ?? randomUUID)().toLowerCase();
  if (!UUID.test(operationId)) throw fail('PREVIEW_INVALID');
  const verified = await verifyControlledBackupSnapshot({
    backupPath: options.backupPath,
    database: options.database,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }).catch((error: unknown) => {
    throw error instanceof ControlledBackupError
      ? fail('INTEGRITY_FAILED')
      : stable(error, 'INTEGRITY_FAILED');
  });
  const compatibility = resolveCompatibility(
    verified.manifest,
    options.root,
    options.runtime,
    options.policy,
  );
  const liveRoot = await checkedDirectory(options.root.rootPath);
  const liveRootParent = await checkedDirectory(dirname(liveRoot.path));
  await assertRestoreCapacity(
    liveRootParent.path,
    restoreStagingBytes(verified.manifest.totals.sizeBytes),
    options.availableBytes,
  );
  return Object.freeze({
    backupCreatedAt: verified.manifest.createdAt,
    backupFileCount: verified.manifest.totals.fileCount,
    backupSizeBytes: verified.manifest.totals.sizeBytes,
    compatibility,
    manifestSha256: verified.manifestSha256,
    liveRootIdentity: liveRoot.identity,
    liveRootParentIdentity: liveRootParent.identity,
    operationId,
  });
}

export async function executeControlledRestore(
  options: ExecuteControlledRestoreOptions,
): Promise<ControlledRestoreResult> {
  const stage = (value: ControlledRestoreStage): void => options.onStage?.(value);
  stage('PREFLIGHT');
  const preflight = await prepareControlledRestore({
    ...options,
    randomId: () => options.preflight.operationId,
  });
  if (
    preflight.operationId !== options.preflight.operationId ||
    preflight.manifestSha256 !== options.preflight.manifestSha256 ||
    !sameNode(preflight.liveRootIdentity, options.preflight.liveRootIdentity) ||
    !sameNode(preflight.liveRootParentIdentity, options.preflight.liveRootParentIdentity)
  )
    throw fail('PREVIEW_INVALID');
  checkAborted(options.signal);
  const root = await checkedDirectory(options.root.rootPath);
  const parent = await checkedDirectory(dirname(root.path));
  if (
    !sameNode(root.identity, options.preflight.liveRootIdentity) ||
    !sameNode(parent.identity, options.preflight.liveRootParentIdentity)
  )
    throw fail('PREVIEW_INVALID');
  const rootName = basename(root.path);
  const id = preflight.operationId;
  const { journalPath, protectionPath, stagingPath } = operationPaths(parent, id);
  const { protectionName, stagingName } = operationNames(id);
  const journalBase: Omit<RestoreJournalV1, 'phase'> = {
    format: JOURNAL_FORMAT,
    manifestSha256: preflight.manifestSha256,
    operationId: id,
    protectionName,
    rootName,
    liveRootIdentity: root.identity,
    liveRootParentIdentity: parent.identity,
    stagingName,
    version: JOURNAL_VERSION,
  };
  let currentStage: ControlledRestoreStage = 'BUILDING_STAGING';
  try {
    stage(currentStage);
    await writeJournal(journalPath, { ...journalBase, phase: 'BUILDING_STAGING' });
    const verified = await verifyControlledBackupSnapshot({
      backupPath: options.backupPath,
      database: options.database,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    if (verified.manifestSha256 !== options.preflight.manifestSha256) throw fail('PREVIEW_INVALID');
    if (
      resolveCompatibility(verified.manifest, options.root, options.runtime, options.policy) !==
      options.preflight.compatibility
    )
      throw fail('PREVIEW_INVALID');
    const candidate = await createCandidateRoot(stagingPath, options.root);
    await copyManifestPayload(options.backupPath, candidate, verified.manifest, options.signal);
    await verifyCandidateRoot(candidate, verified.manifest, options.database);
    checkAborted(options.signal);
    await assertRestoreCapacity(
      parent.path,
      restoreStagingBytes(verified.manifest.totals.sizeBytes),
      options.availableBytes,
    );
    currentStage = 'SWITCHING';
    stage(currentStage);
    const beforeSwitch = await checkedDirectory(root.path);
    if (
      !sameNode(root.identity, beforeSwitch.identity) ||
      !sameNode(parent.identity, (await checkedDirectory(parent.path)).identity)
    )
      throw fail('SAFETY_UNPROVEN');
    await rename(root.path, protectionPath);
    const protectedRoot = await checkedDirectory(protectionPath);
    if (!sameNode(root.identity, protectedRoot.identity)) throw fail('SAFETY_UNPROVEN');
    await replaceJournal(journalPath, { ...journalBase, phase: 'PROTECTED' });
    await rename(stagingPath, root.path);
    await replaceJournal(journalPath, { ...journalBase, phase: 'SWITCHED' });
    currentStage = 'VERIFYING';
    stage(currentStage);
    const switched = await openProjectDataRoot(root.path).catch(() => {
      throw fail('SAFETY_UNPROVEN');
    });
    await verifyCandidateRoot(switched, verified.manifest, options.database);
    await replaceJournal(journalPath, { ...journalBase, phase: 'SUCCESS' });
    stage('SUCCESS');
    return Object.freeze({
      cleanup: 'PROTECTION_RETAINED',
      operationId: id,
      outcome: 'SUCCESS',
      stage: 'SUCCESS',
    });
  } catch (error) {
    // Only attempt rollback after the old root was demonstrably moved into this operation's protection name.
    const protectedRoot = await checkedDirectory(protectionPath).catch(() => null);
    const liveRoot = await checkedDirectory(root.path).catch(() => null);
    if (
      protectedRoot !== null &&
      sameNode(protectedRoot.identity, root.identity) &&
      liveRoot !== null
    ) {
      try {
        await rename(root.path, stagingPath);
        await rename(protectionPath, root.path);
        const restored = await checkedDirectory(root.path);
        if (!sameNode(restored.identity, root.identity)) throw fail('SAFETY_UNPROVEN');
        await replaceJournal(journalPath, { ...journalBase, phase: 'ROLLED_BACK' });
        stage('ROLLBACK');
        return Object.freeze({
          cleanup: 'PROTECTION_RETAINED',
          operationId: id,
          outcome: 'ROLLBACK',
          stage: 'ROLLBACK',
        });
      } catch {
        stage('SAFETY_UNPROVEN');
        return Object.freeze({
          cleanup: 'PROTECTION_RETAINED',
          operationId: id,
          outcome: 'SAFETY_UNPROVEN',
          stage: 'SAFETY_UNPROVEN',
        });
      }
    }
    if (currentStage === 'SWITCHING' || currentStage === 'VERIFYING') {
      stage('SAFETY_UNPROVEN');
      return Object.freeze({
        cleanup: 'PROTECTION_RETAINED',
        operationId: id,
        outcome: 'SAFETY_UNPROVEN',
        stage: 'SAFETY_UNPROVEN',
      });
    }
    // A staging-only failure cannot become a startup lock. Recheck the untouched live root and
    // its parent before deleting only the exact sibling names derived from this operation id.
    try {
      const unchangedRoot = await checkedDirectory(root.path);
      if (!sameNode(unchangedRoot.identity, root.identity)) throw fail('SAFETY_UNPROVEN');
      if (await existingOperationDirectory(protectionPath)) throw fail('SAFETY_UNPROVEN');
      await removeOwnedOperationDirectory(parent, stagingPath);
      await removeOwnedOperationJournal(parent, journalPath);
      if (!sameNode(root.identity, (await checkedDirectory(root.path)).identity))
        throw fail('SAFETY_UNPROVEN');
    } catch {
      throw fail('SAFETY_UNPROVEN');
    }
    throw stable(error, 'RESTORE_FAILED');
  }
}

/**
 * Recovery only changes names derived from the journal operation id after their parent, type and
 * expected old-root identity agree. Physical power-loss durability remains UNKNOWN.
 */
export async function inspectControlledRestoreRecovery(
  rootPath: string,
): Promise<'CLEAR' | 'SAFETY_UNPROVEN'> {
  try {
    const root = resolve(rootPath);
    const parent = await checkedDirectory(dirname(root));
    const rootName = basename(root);
    if (join(parent.path, rootName) !== root) return 'SAFETY_UNPROVEN';
    const entries = await readdir(parent.path, { withFileTypes: true });
    const journals = entries.filter((entry) =>
      /^\.rednote-restore-journal-[0-9a-f-]{36}\.json$/iu.test(entry.name),
    );
    // A single data root can have at most one owned switch in progress. Multiple journals do not
    // establish ordering, even if each individual journal looks well-formed.
    if (journals.length === 0) return 'CLEAR';
    if (journals.length !== 1) return 'SAFETY_UNPROVEN';
    const journalEntry = journals[0];
    if (journalEntry === undefined) return 'SAFETY_UNPROVEN';

    const journalPath = join(parent.path, journalEntry.name);
    const status = await checkedRegularFile(journalPath);
    if (status.size > 1024) return 'SAFETY_UNPROVEN';
    const journal = parseRestoreJournal(JSON.parse(await readFile(journalPath, 'utf8')), rootName);
    if (journal === null || journalEntry.name !== operationNames(journal.operationId).journalName)
      return 'SAFETY_UNPROVEN';
    if (!sameNode(parent.identity, journal.liveRootParentIdentity)) return 'SAFETY_UNPROVEN';

    const paths = operationPaths(parent, journal.operationId);
    if (paths.journalPath !== journalPath) return 'SAFETY_UNPROVEN';
    const live = await existingOperationDirectory(root);
    const protectedRoot = await existingOperationDirectory(paths.protectionPath);
    const staging = await existingOperationDirectory(paths.stagingPath);
    const isOldLive = (candidate: CheckedDirectory | null): candidate is CheckedDirectory =>
      candidate !== null && sameNode(candidate.identity, journal.liveRootIdentity);
    const restoreProtectedRoot = async (): Promise<'CLEAR' | 'SAFETY_UNPROVEN'> => {
      if (
        live === null ||
        protectedRoot === null ||
        !isOldLive(protectedRoot) ||
        !sameNode(parent.identity, (await checkedDirectory(parent.path)).identity)
      )
        return 'SAFETY_UNPROVEN';
      await rename(live.path, paths.stagingPath);
      await rename(paths.protectionPath, root);
      const restored = await checkedDirectory(root);
      if (
        !sameNode(restored.identity, journal.liveRootIdentity) ||
        !(await isExistingProjectDataRoot(root))
      )
        return 'SAFETY_UNPROVEN';
      await removeOwnedOperationDirectory(parent, paths.stagingPath);
      await removeOwnedOperationJournal(parent, paths.journalPath);
      return 'CLEAR';
    };

    if (journal.phase === 'BUILDING_STAGING') {
      if (!isOldLive(live) || protectedRoot !== null || !(await isExistingProjectDataRoot(root)))
        return 'SAFETY_UNPROVEN';
      void staging;
      await removeOwnedOperationDirectory(parent, paths.stagingPath);
      await removeOwnedOperationJournal(parent, paths.journalPath);
      return 'CLEAR';
    }
    if (journal.phase === 'PROTECTED') {
      if (live === null && isOldLive(protectedRoot) && staging !== null) {
        await rename(paths.protectionPath, root);
        const restored = await checkedDirectory(root);
        if (
          !sameNode(restored.identity, journal.liveRootIdentity) ||
          !(await isExistingProjectDataRoot(root))
        )
          return 'SAFETY_UNPROVEN';
        await removeOwnedOperationDirectory(parent, paths.stagingPath);
        await removeOwnedOperationJournal(parent, paths.journalPath);
        return 'CLEAR';
      }
      // A crash after the second rename but before its journal update is rolled back rather than
      // treating an unverified candidate as a completed restore.
      return restoreProtectedRoot();
    }
    if (journal.phase === 'SWITCHED') return restoreProtectedRoot();
    if (journal.phase === 'ROLLED_BACK') {
      if (!isOldLive(live) || protectedRoot !== null || !(await isExistingProjectDataRoot(root)))
        return 'SAFETY_UNPROVEN';
      void staging;
      await removeOwnedOperationDirectory(parent, paths.stagingPath);
      await removeOwnedOperationJournal(parent, paths.journalPath);
      return 'CLEAR';
    }
    // SUCCESS is only written after the candidate has passed the database and manifest verifier.
    if (!(await isExistingProjectDataRoot(root)) || !isOldLive(protectedRoot))
      return 'SAFETY_UNPROVEN';
    if (staging !== null) return 'SAFETY_UNPROVEN';
    await removeOwnedOperationDirectory(parent, paths.protectionPath);
    await removeOwnedOperationJournal(parent, paths.journalPath);
    return 'CLEAR';
  } catch {
    return 'SAFETY_UNPROVEN';
  }
}
