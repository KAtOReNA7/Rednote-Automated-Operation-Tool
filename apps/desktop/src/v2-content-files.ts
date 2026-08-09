import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { parseManagedRelativePath } from '@mystery-operations/shared/storage';
import { LocalFileRepository, type ProjectDataRoot } from '@mystery-operations/storage';
import {
  V2ContentError,
  V2_CONTENT_FIELD_KEYS,
  parseContentPackageFields,
  type ContentBlobRef,
  type ContentBlobSet,
  type ContentCoverKey,
  type ContentExportResult,
  type ContentFieldKey,
  type ContentPackageFields,
  type ContentVersionRecord,
  type GeneratedCoverRef,
  type V2ContentFilePort,
} from '@mystery-operations/v2';

const MAX_COVER_BYTES = 10 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_IEND = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
const COVER_PREFIXES: Readonly<Record<ContentCoverKey, string>> = Object.freeze({
  moonstone: 'moonstone-cover',
  morgue: 'morgue-cover',
  'yellow-room': 'yellow-room-cover',
});
const fileNames: Readonly<Record<ContentFieldKey, string>> = Object.freeze({
  body: 'body.txt',
  cover: 'cover.png',
  materialNotes: 'material-notes.txt',
  suggestedTime: 'suggested-time.txt',
  tags: 'tags.txt',
  title: 'title.txt',
});

interface V2LocalContentFilesOptions {
  readonly now?: () => Date;
  readonly openDirectory?: (path: string) => Promise<string>;
  readonly randomId?: () => string;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function safeChild(root: string, ...segments: readonly string[]): string {
  const resolvedRoot = resolve(root);
  const candidate = resolve(resolvedRoot, ...segments);
  const fromRoot = relative(resolvedRoot, candidate);
  if (
    fromRoot.length === 0 ||
    fromRoot === '..' ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new V2ContentError('EXPORT_FAILED');
  }
  return candidate;
}

async function regularFile(path: string): Promise<void> {
  const status = await lstat(path);
  if (status.isSymbolicLink() || !status.isFile()) throw new V2ContentError('CONTENT_CORRUPT');
}

export async function discoverApprovedV2Covers(
  assetsDirectory: string,
): Promise<Readonly<Record<ContentCoverKey, string>>> {
  const entries = await readdir(assetsDirectory, { withFileTypes: true });
  const result = {} as Record<ContentCoverKey, string>;
  for (const [key, prefix] of Object.entries(COVER_PREFIXES) as Array<[ContentCoverKey, string]>) {
    const matches = entries.filter(
      (entry) =>
        entry.isFile() &&
        (entry.name === `${prefix}.png` ||
          new RegExp(`^${prefix}-[A-Za-z0-9_-]+\\.png$`, 'u').test(entry.name)),
    );
    if (matches.length !== 1) throw new V2ContentError('CONTENT_CORRUPT', ['cover']);
    const path = join(assetsDirectory, matches[0]?.name ?? '');
    await regularFile(path);
    result[key] = path;
  }
  return Object.freeze(result);
}

async function writeExact(path: string, bytes: Uint8Array): Promise<void> {
  const handle = await open(path, 'wx', 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export class V2LocalContentFiles implements V2ContentFilePort {
  readonly #coverPaths: Readonly<Record<ContentCoverKey, string>>;
  readonly #files: LocalFileRepository;
  readonly #generatedExports = new Set<string>();
  readonly #openDirectory: (path: string) => Promise<string>;
  readonly #randomId: () => string;
  readonly #root: ProjectDataRoot;

  public constructor(
    root: ProjectDataRoot,
    coverPaths: Readonly<Record<ContentCoverKey, string>>,
    options: V2LocalContentFilesOptions = {},
  ) {
    this.#root = root;
    this.#coverPaths = coverPaths;
    this.#files = new LocalFileRepository(root, options);
    this.#openDirectory = options.openDirectory ?? (async () => 'OPEN_UNAVAILABLE');
    this.#randomId = options.randomId ?? randomUUID;
  }

  public async writeFields(fieldsValue: ContentPackageFields): Promise<ContentBlobSet> {
    const fields = parseContentPackageFields(fieldsValue);
    const cover = await readFile(this.#coverPaths[fields.coverKey]);
    if (
      cover.byteLength < 8 ||
      cover.byteLength > MAX_COVER_BYTES ||
      !cover.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    ) {
      throw new V2ContentError('CONTENT_CORRUPT', ['cover']);
    }
    const values: Readonly<Record<ContentFieldKey, Uint8Array>> = Object.freeze({
      body: Buffer.from(fields.body, 'utf8'),
      cover,
      materialNotes: Buffer.from(fields.materialNotes, 'utf8'),
      suggestedTime: Buffer.from(fields.suggestedTime, 'utf8'),
      tags: Buffer.from(fields.tags.join('\n'), 'utf8'),
      title: Buffer.from(fields.title, 'utf8'),
    });
    const refs = {} as Record<ContentFieldKey, ContentBlobRef>;
    for (const key of V2_CONTENT_FIELD_KEYS) {
      const value = values[key];
      const descriptor = await this.#files.putBuffer(value, {
        category: 'EXPORT',
        displayName: fileNames[key],
        maxBytes: key === 'cover' ? MAX_COVER_BYTES : 32_768,
      });
      refs[key] = {
        managedPath: descriptor.managedPath,
        sha256: descriptor.sha256,
        sizeBytes: descriptor.sizeBytes,
      };
    }
    return Object.freeze(refs);
  }

  public async writeGeneratedCover(
    bytesValue: Uint8Array,
    modelRunId: string,
  ): Promise<GeneratedCoverRef> {
    const bytes = Buffer.from(bytesValue);
    if (
      bytes.byteLength < 45 ||
      bytes.byteLength > MAX_COVER_BYTES ||
      !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.subarray(12, 16).toString('ascii') !== 'IHDR' ||
      !bytes.subarray(-12).equals(PNG_IEND)
    )
      throw new V2ContentError('CONTENT_CORRUPT', ['cover']);
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width < 1 || width > 8192 || height < 1 || height > 8192)
      throw new V2ContentError('CONTENT_CORRUPT', ['cover']);
    const descriptor = await this.#files.putBuffer(bytes, {
      category: 'GENERATED_IMAGE',
      displayName: 'generated-cover.png',
      maxBytes: MAX_COVER_BYTES,
    });
    return Object.freeze({
      height,
      managedPath: descriptor.managedPath,
      mimeType: 'image/png' as const,
      modelRunId,
      sha256: descriptor.sha256,
      width,
    });
  }

  public async readFields(record: ContentVersionRecord): Promise<ContentPackageFields> {
    const values = {} as Record<ContentFieldKey, Buffer>;
    for (const key of V2_CONTENT_FIELD_KEYS) {
      values[key] = await this.#readBlob(
        record.files[key],
        key === 'cover' ? MAX_COVER_BYTES : 32_768,
      );
    }
    return parseContentPackageFields({
      body: values.body.toString('utf8'),
      coverKey: record.coverKey,
      materialNotes: values.materialNotes.toString('utf8'),
      suggestedTime: values.suggestedTime.toString('utf8'),
      tags: values.tags.toString('utf8').split('\n'),
      title: values.title.toString('utf8'),
    });
  }

  public async exportPackages(
    records: readonly ContentVersionRecord[],
    idempotencyKey: string,
  ): Promise<ContentExportResult> {
    if (
      records.length === 0 ||
      records.length > 40 ||
      records.some(({ status }) => status !== 'APPROVED')
    ) {
      throw new V2ContentError('CONTENT_NOT_APPROVED', ['packages']);
    }
    const sortedRecords = records
      .slice()
      .sort((left, right) => left.packageId.localeCompare(right.packageId, 'en'));
    const exportId = `r04-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`;
    const exportRoot = safeChild(this.#root.rootPath, 'exports', 'v2');
    await mkdir(exportRoot, { recursive: true });
    const rootStatus = await lstat(exportRoot);
    if (rootStatus.isSymbolicLink() || !rootStatus.isDirectory())
      throw new V2ContentError('EXPORT_FAILED');
    const finalDirectory = safeChild(exportRoot, exportId);
    const stagedDirectory = safeChild(exportRoot, `.rednote-tmp-${this.#randomId()}.partial`);
    const manifestPackages = await Promise.all(
      sortedRecords.map(async (record, index) => {
        const directory = `${String(index + 1).padStart(2, '0')}-${record.packageId}`;
        return {
          contentPackageId: record.packageId,
          files: Object.fromEntries(
            V2_CONTENT_FIELD_KEYS.map((key) => [
              key,
              {
                path: `${directory}/${fileNames[key]}`,
                sha256:
                  key === 'cover' && record.generatedCover != null
                    ? record.generatedCover.sha256
                    : record.files[key].sha256,
              },
            ]),
          ),
          suggestedTime: (await this.#readBlob(record.files.suggestedTime, 64)).toString('utf8'),
          versionId: record.versionId,
        };
      }),
    );
    const manifest = {
      aiDisclosure: false,
      exportId,
      packages: manifestPackages,
      schemaVersion: 1,
    };
    const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const startBytes = Buffer.from(
      `这是本地发布包，最终需由用户在小红书官方端手动发布；系统未登录或操作平台。\n\n共 ${records.length} 个已批准内容包；每包包含六个用户文件，不包含置顶评论。\n`,
      'utf8',
    );
    try {
      await lstat(finalDirectory);
      await this.#verifyExistingExport(finalDirectory, manifestBytes, startBytes, sortedRecords);
      this.#generatedExports.add(exportId);
      return { exportId, packageCount: records.length };
    } catch (error) {
      if (!isErrno(error, 'ENOENT')) {
        if (error instanceof V2ContentError) throw error;
        throw new V2ContentError('EXPORT_FAILED');
      }
    }
    await mkdir(stagedDirectory, { recursive: false });
    try {
      for (const [index, record] of sortedRecords.entries()) {
        const directory = safeChild(
          stagedDirectory,
          `${String(index + 1).padStart(2, '0')}-${record.packageId}`,
        );
        await mkdir(directory, { recursive: false });
        for (const key of V2_CONTENT_FIELD_KEYS) {
          await writeExact(
            safeChild(directory, fileNames[key]),
            key === 'cover' && record.generatedCover != null
              ? await this.readGeneratedCover(record.generatedCover)
              : await this.#readBlob(record.files[key], key === 'cover' ? MAX_COVER_BYTES : 32_768),
          );
        }
      }
      await writeExact(safeChild(stagedDirectory, 'manifest.json'), manifestBytes);
      await writeExact(safeChild(stagedDirectory, 'START-HERE.txt'), startBytes);
      try {
        await rename(stagedDirectory, finalDirectory);
      } catch (error) {
        if (!isErrno(error, 'EEXIST') && !isErrno(error, 'ENOTEMPTY')) throw error;
        await this.#verifyExistingExport(finalDirectory, manifestBytes, startBytes, sortedRecords);
        await rm(stagedDirectory, { force: true, recursive: true });
      }
      await this.#verifyExistingExport(finalDirectory, manifestBytes, startBytes, sortedRecords);
      this.#generatedExports.add(exportId);
      return { exportId, packageCount: records.length };
    } catch (error) {
      await rm(stagedDirectory, { force: true, recursive: true }).catch(() => undefined);
      if (error instanceof V2ContentError) throw error;
      throw new V2ContentError('EXPORT_FAILED');
    }
  }

  public async openExport(exportId: string): Promise<void> {
    if (!/^r04-[a-f0-9]{24}$/u.test(exportId) || !this.#generatedExports.has(exportId))
      throw new V2ContentError('INVALID_REQUEST', ['exportId']);
    const directory = safeChild(this.#root.rootPath, 'exports', 'v2', exportId);
    const status = await lstat(directory).catch(() => null);
    if (status === null || status.isSymbolicLink() || !status.isDirectory())
      throw new V2ContentError('EXPORT_FAILED');
    await regularFile(safeChild(directory, 'manifest.json'));
    const error = await this.#openDirectory(directory);
    if (error !== '') throw new V2ContentError('EXPORT_FAILED');
  }

  async #readBlob(ref: ContentBlobRef, maximum: number): Promise<Buffer> {
    const managedPath = parseManagedRelativePath(ref.managedPath, 'EXPORT');
    await this.#files.verifyManagedFile(managedPath, {
      expectedSha256: ref.sha256,
      expectedSizeBytes: ref.sizeBytes,
    });
    if (ref.sizeBytes > maximum) throw new V2ContentError('CONTENT_CORRUPT', ['files']);
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of this.#files.openReadStream(managedPath)) {
      const bytes = Buffer.from(chunk as Uint8Array);
      size += bytes.byteLength;
      if (size > maximum) throw new V2ContentError('CONTENT_CORRUPT', ['files']);
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, size);
  }

  async #verifyExistingExport(
    directory: string,
    manifestBytes: Buffer,
    startBytes: Buffer,
    records: readonly ContentVersionRecord[],
  ): Promise<void> {
    const status = await lstat(directory);
    if (status.isSymbolicLink() || !status.isDirectory()) throw new V2ContentError('EXPORT_FAILED');
    if (!(await readFile(safeChild(directory, 'manifest.json'))).equals(manifestBytes))
      throw new V2ContentError('EXPORT_FAILED');
    if (!(await readFile(safeChild(directory, 'START-HERE.txt'))).equals(startBytes))
      throw new V2ContentError('EXPORT_FAILED');
    for (const [index, record] of records.entries()) {
      const child = safeChild(
        directory,
        `${String(index + 1).padStart(2, '0')}-${record.packageId}`,
      );
      const childStatus = await lstat(child);
      if (childStatus.isSymbolicLink() || !childStatus.isDirectory())
        throw new V2ContentError('EXPORT_FAILED');
      for (const key of V2_CONTENT_FIELD_KEYS) {
        const path = safeChild(child, fileNames[key]);
        await regularFile(path);
        if (
          createHash('sha256')
            .update(await readFile(path))
            .digest('hex') !==
          (key === 'cover' && record.generatedCover != null
            ? record.generatedCover.sha256
            : record.files[key].sha256)
        )
          throw new V2ContentError('EXPORT_FAILED');
      }
    }
  }

  public async readGeneratedCover(ref: GeneratedCoverRef): Promise<Buffer> {
    const managedPath = parseManagedRelativePath(ref.managedPath, 'GENERATED_IMAGE');
    const stat = await this.#files.statManagedFile(managedPath);
    await this.#files.verifyManagedFile(managedPath, {
      expectedSha256: ref.sha256,
      expectedSizeBytes: stat.sizeBytes,
    });
    if (stat.sizeBytes > MAX_COVER_BYTES) throw new V2ContentError('CONTENT_CORRUPT', ['cover']);
    const chunks: Buffer[] = [];
    for await (const chunk of this.#files.openReadStream(managedPath))
      chunks.push(Buffer.from(chunk as Uint8Array));
    const bytes = Buffer.concat(chunks);
    if (
      bytes.byteLength < 45 ||
      !bytes.subarray(0, 8).equals(PNG_SIGNATURE) ||
      bytes.readUInt32BE(8) !== 13 ||
      !bytes.subarray(-12).equals(PNG_IEND)
    )
      throw new V2ContentError('CONTENT_CORRUPT', ['cover']);
    return bytes;
  }
}
