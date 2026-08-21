import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

import {
  DATA_ROOT_MARKER_FILE,
  openProjectDataRoot,
  type ProjectDataRoot,
} from './project-data-root.js';
import {
  ControlledBackupError,
  type BackupManifestFileV1,
  type BackupManifestV1,
} from './backup-contracts.js';
import {
  verifyControlledBackupSnapshot,
  type ControlledBackupDatabaseVerifier,
} from './backup-snapshot.js';

const COPY_BUFFER_BYTES = 64 * 1024;
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
  readonly compatibility: 'EXACT';
  readonly manifestSha256: string;
  readonly operationId: string;
}

export interface PrepareControlledRestoreOptions {
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
  readonly phase: 'BUILDING_STAGING' | 'PROTECTED' | 'SWITCHED' | 'ROLLED_BACK' | 'SUCCESS';
  readonly protectionName: string;
  readonly rootName: string;
  readonly stagingName: string;
  readonly version: typeof JOURNAL_VERSION;
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

async function checkedDirectory(
  path: string,
): Promise<{ readonly identity: NodeIdentity; readonly path: string }> {
  if (!isAbsolute(path) || path.includes('\0')) throw fail('INVALID_PATH');
  try {
    const status = await lstat(path);
    if (!status.isDirectory() || status.isSymbolicLink()) throw fail('INVALID_PATH');
    return { identity: nodeIdentity(status), path: resolve(path) };
  } catch (error) {
    throw stable(error, 'INVALID_PATH');
  }
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

function assertExactCompatibility(
  manifest: BackupManifestV1,
  root: ProjectDataRoot,
  runtime: ControlledRestoreRuntimeIdentity,
  policy: ControlledRestoreCompatibilityPolicy | undefined,
): void {
  const source = manifest.source;
  const explicitlyAllowed = policy?.allowedSourceAppVersions?.includes(source.appVersion) === true;
  if (
    manifest.compatibilityPolicyVersion !== 1 ||
    source.workspaceId !== root.marker.instanceId ||
    source.dataRootFormat !== 'rednote-project-data' ||
    source.dataRootVersion !== root.marker.version ||
    source.v2DataVersion !== runtime.v2DataVersion ||
    source.schemaVersion !== runtime.schemaVersion ||
    source.migrationFingerprint !== runtime.migrationFingerprint ||
    (source.appVersion !== runtime.appVersion && !explicitlyAllowed)
  )
    throw fail('COMPATIBILITY_BLOCKED');
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
  assertExactCompatibility(verified.manifest, options.root, options.runtime, options.policy);
  await checkedDirectory(options.root.rootPath);
  return Object.freeze({
    backupCreatedAt: verified.manifest.createdAt,
    backupFileCount: verified.manifest.totals.fileCount,
    backupSizeBytes: verified.manifest.totals.sizeBytes,
    compatibility: 'EXACT',
    manifestSha256: verified.manifestSha256,
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
    preflight.manifestSha256 !== options.preflight.manifestSha256
  )
    throw fail('PREVIEW_INVALID');
  checkAborted(options.signal);
  const root = await checkedDirectory(options.root.rootPath);
  const parent = await checkedDirectory(dirname(root.path));
  const rootName = basename(root.path);
  const id = preflight.operationId;
  const stagingName = `.rednote-restore-staging-${id}`;
  const protectionName = `.rednote-restore-protection-${id}`;
  const journalName = `.rednote-restore-journal-${id}.json`;
  if (![stagingName, protectionName, journalName].every(validSiblingName))
    throw fail('INVALID_PATH');
  const stagingPath = join(parent.path, stagingName);
  const protectionPath = join(parent.path, protectionName);
  const journalPath = join(parent.path, journalName);
  const journalBase: Omit<RestoreJournalV1, 'phase'> = {
    format: JOURNAL_FORMAT,
    operationId: id,
    protectionName,
    rootName,
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
    assertExactCompatibility(verified.manifest, options.root, options.runtime, options.policy);
    const candidate = await createCandidateRoot(stagingPath, options.root);
    await copyManifestPayload(options.backupPath, candidate, verified.manifest, options.signal);
    await verifyCandidateRoot(candidate, verified.manifest, options.database);
    checkAborted(options.signal);
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
    // A staging-only failure cannot be allowed to become a startup lock. Both names are generated
    // for this operation and remain strict siblings of the live root until the destructive rename.
    await rm(stagingPath, { force: true, maxRetries: 3, recursive: true }).catch(() => {
      throw fail('SAFETY_UNPROVEN');
    });
    await rm(journalPath, { force: true, maxRetries: 3 }).catch(() => {
      throw fail('SAFETY_UNPROVEN');
    });
    throw stable(error, 'RESTORE_FAILED');
  }
}

/**
 * Startup recovery is intentionally conservative. A journal is an incomplete-operation signal;
 * only a fully intact current root is accepted. All ambiguous switch states keep data closed.
 */
export async function inspectControlledRestoreRecovery(
  rootPath: string,
): Promise<'CLEAR' | 'SAFETY_UNPROVEN'> {
  const root = resolve(rootPath);
  const parent = await checkedDirectory(dirname(root));
  const rootName = basename(root);
  const entries = await readdir(parent.path, { withFileTypes: true }).catch(() => {
    throw fail('SAFETY_UNPROVEN');
  });
  const journals = entries.filter((entry) =>
    /^\.rednote-restore-journal-[0-9a-f-]{36}\.json$/iu.test(entry.name),
  );
  if (journals.length === 0) return 'CLEAR';
  for (const journal of journals) {
    const path = join(parent.path, journal.name);
    const status = await checkedRegularFile(path).catch(() => {
      throw fail('SAFETY_UNPROVEN');
    });
    if (status.size > 1024) return 'SAFETY_UNPROVEN';
    let value: unknown;
    try {
      value = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return 'SAFETY_UNPROVEN';
    }
    if (
      typeof value !== 'object' ||
      value === null ||
      Array.isArray(value) ||
      (value as Partial<RestoreJournalV1>).format !== JOURNAL_FORMAT ||
      (value as Partial<RestoreJournalV1>).version !== JOURNAL_VERSION ||
      (value as Partial<RestoreJournalV1>).rootName !== rootName ||
      typeof (value as Partial<RestoreJournalV1>).operationId !== 'string' ||
      !UUID.test((value as Partial<RestoreJournalV1>).operationId ?? '')
    )
      return 'SAFETY_UNPROVEN';
    if (
      (value as Partial<RestoreJournalV1>).phase !== 'SUCCESS' &&
      (value as Partial<RestoreJournalV1>).phase !== 'ROLLED_BACK'
    )
      return 'SAFETY_UNPROVEN';
  }
  return 'CLEAR';
}
