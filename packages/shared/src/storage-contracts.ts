export const FILE_CATEGORIES = [
  'SOURCE_SNAPSHOT',
  'CLIP_SCREENSHOT',
  'PHOTO_ORIGINAL',
  'PHOTO_PROCESSED',
  'GENERATED_IMAGE',
  'IMPORT',
  'EXPORT',
  'BACKUP',
  'LOG',
  'MODEL_RESULT_CACHE',
] as const;

export type FileCategory = (typeof FILE_CATEGORIES)[number];

export const CATEGORY_DIRECTORY: Readonly<Record<FileCategory, string>> = Object.freeze({
  BACKUP: 'backups',
  CLIP_SCREENSHOT: 'sources/screenshots',
  EXPORT: 'exports',
  GENERATED_IMAGE: 'generated-images',
  IMPORT: 'imports',
  LOG: 'logs',
  MODEL_RESULT_CACHE: 'cache/model-results',
  PHOTO_ORIGINAL: 'photos/originals',
  PHOTO_PROCESSED: 'photos/processed',
  SOURCE_SNAPSHOT: 'sources/snapshots',
});

export const STORAGE_ERROR_CODES = [
  'ROOT_PATH_INVALID',
  'ROOT_IS_FILESYSTEM_ROOT',
  'ROOT_NOT_OWNED',
  'ROOT_FORMAT_UNSUPPORTED',
  'ROOT_LAYOUT_CONFLICT',
  'PATH_INVALID',
  'PATH_OUTSIDE_ROOT',
  'PATH_LINK_NOT_ALLOWED',
  'FILE_NAME_INVALID',
  'FILE_TYPE_NOT_REGULAR',
  'FILE_TOO_LARGE',
  'FILE_CHANGED_DURING_COPY',
  'FILE_ALREADY_EXISTS_CONFLICT',
  'FILE_MISSING',
  'FILE_INTEGRITY_MISMATCH',
  'WRITE_ABORTED',
  'WRITE_FAILED',
  'PATH_CAPABILITY_UNSUPPORTED',
] as const;

export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number];

export interface StorageErrorDto {
  readonly code: StorageErrorCode;
  readonly context?: Readonly<Record<string, boolean | number | string>>;
  readonly message: string;
  readonly retryable: boolean;
}

const ERROR_MESSAGES: Readonly<Record<StorageErrorCode, string>> = Object.freeze({
  FILE_ALREADY_EXISTS_CONFLICT: '目标文件与已有内容冲突。',
  FILE_CHANGED_DURING_COPY: '源文件在复制期间发生变化。',
  FILE_INTEGRITY_MISMATCH: '文件完整性校验失败。',
  FILE_MISSING: '文件不存在。',
  FILE_NAME_INVALID: '文件名无效。',
  FILE_TOO_LARGE: '文件超过允许大小。',
  FILE_TYPE_NOT_REGULAR: '只允许普通文件。',
  PATH_CAPABILITY_UNSUPPORTED: '当前系统不支持所需路径能力。',
  PATH_INVALID: '文件路径无效。',
  PATH_LINK_NOT_ALLOWED: '不允许符号链接或重解析路径。',
  PATH_OUTSIDE_ROOT: '文件路径超出数据根。',
  ROOT_FORMAT_UNSUPPORTED: '数据根格式不受支持。',
  ROOT_IS_FILESYSTEM_ROOT: '不能使用文件系统根目录。',
  ROOT_LAYOUT_CONFLICT: '数据根目录布局发生冲突。',
  ROOT_NOT_OWNED: '目录不是受管理的数据根。',
  ROOT_PATH_INVALID: '数据根路径无效。',
  WRITE_ABORTED: '文件写入已取消。',
  WRITE_FAILED: '文件写入失败。',
});

const RETRYABLE_ERROR_CODES = new Set<StorageErrorCode>(['WRITE_FAILED']);

export class StorageError extends Error {
  public readonly code: StorageErrorCode;
  public readonly context: Readonly<Record<string, boolean | number | string>> | undefined;
  public readonly retryable: boolean;

  public constructor(
    code: StorageErrorCode,
    options: {
      readonly cause?: unknown;
      readonly context?: Readonly<Record<string, boolean | number | string>>;
      readonly retryable?: boolean;
    } = {},
  ) {
    super(ERROR_MESSAGES[code], options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'StorageError';
    this.code = code;
    this.context = options.context;
    this.retryable = options.retryable ?? RETRYABLE_ERROR_CODES.has(code);
  }

  public toDto(): StorageErrorDto {
    return {
      code: this.code,
      ...(this.context === undefined ? {} : { context: this.context }),
      message: ERROR_MESSAGES[this.code],
      retryable: this.retryable,
    };
  }
}

declare const managedRelativePathBrand: unique symbol;

export type ManagedRelativePath = string & {
  readonly [managedRelativePathBrand]: true;
};

export const MAX_MANAGED_RELATIVE_PATH_LENGTH = 1_024;
export const MAX_MANAGED_PATH_SEGMENT_LENGTH = 120;
export const MAX_SANITIZED_FILE_NAME_LENGTH = 120;

const WINDOWS_DRIVE_PREFIX = /^[a-z]:/iu;
const URI_SCHEME = /^[a-z][a-z0-9+.-]*:/iu;
const WINDOWS_RESERVED_BASE = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu;

function hasControlCharacters(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function categoryForPath(value: string): FileCategory | null {
  for (const category of FILE_CATEGORIES) {
    const directory = CATEGORY_DIRECTORY[category];
    if (value.startsWith(`${directory}/`) && value.length > directory.length + 1) {
      return category;
    }
  }
  return null;
}

export function parseManagedRelativePath(
  input: string,
  expectedCategory?: FileCategory,
): ManagedRelativePath {
  if (
    input.length === 0 ||
    input.length > MAX_MANAGED_RELATIVE_PATH_LENGTH ||
    input.startsWith('/') ||
    input.endsWith('/') ||
    input.includes('\\') ||
    input.includes(':') ||
    input.includes('//') ||
    hasControlCharacters(input) ||
    WINDOWS_DRIVE_PREFIX.test(input) ||
    URI_SCHEME.test(input)
  ) {
    throw new StorageError('PATH_INVALID');
  }

  const segments = input.split('/');
  if (
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment.startsWith('.rednote-tmp-') ||
        segment.length > MAX_MANAGED_PATH_SEGMENT_LENGTH,
    )
  ) {
    throw new StorageError('PATH_INVALID');
  }

  const actualCategory = categoryForPath(input);
  if (
    actualCategory === null ||
    (expectedCategory !== undefined && actualCategory !== expectedCategory)
  ) {
    throw new StorageError('PATH_INVALID');
  }

  return input as ManagedRelativePath;
}

export function isManagedRelativePath(
  input: unknown,
  expectedCategory?: FileCategory,
): input is ManagedRelativePath {
  if (typeof input !== 'string') {
    return false;
  }
  try {
    parseManagedRelativePath(input, expectedCategory);
    return true;
  } catch {
    return false;
  }
}

export function formatManagedRelativePath(path: ManagedRelativePath): string {
  return path;
}

function trimWindowsEnding(value: string): string {
  return value.replace(/[ .]+$/u, '');
}

function truncateUtf16(value: string, maximumLength: number): string {
  let length = 0;
  let result = '';
  for (const character of value) {
    if (length + character.length > maximumLength) {
      break;
    }
    result += character;
    length += character.length;
  }
  return result;
}

function sanitizePart(value: string): string {
  return trimWindowsEnding(
    Array.from(value.normalize('NFC'))
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || codePoint === 127 ? '_' : character;
      })
      .join('')
      .replace(/[<>:"|?*]/gu, '_'),
  );
}

export function sanitizeFileName(
  input: string,
  maximumLength = MAX_SANITIZED_FILE_NAME_LENGTH,
): string {
  if (
    maximumLength < 16 ||
    maximumLength > MAX_MANAGED_PATH_SEGMENT_LENGTH ||
    input.includes('/') ||
    input.includes('\\') ||
    input.includes('\u0000') ||
    input === '.' ||
    input === '..'
  ) {
    throw new StorageError('FILE_NAME_INVALID');
  }

  const normalized = input.normalize('NFC');
  const finalDot = normalized.lastIndexOf('.');
  const hasExtension = finalDot > 0 && finalDot < normalized.length - 1;
  let base = sanitizePart(hasExtension ? normalized.slice(0, finalDot) : normalized);
  let extension = sanitizePart(hasExtension ? normalized.slice(finalDot + 1) : '');

  extension = truncateUtf16(extension, Math.min(16, Math.max(0, maximumLength - 2)));
  const extensionBudget = extension.length === 0 ? 0 : extension.length + 1;
  base = truncateUtf16(base, maximumLength - extensionBudget);
  base = trimWindowsEnding(base);

  if (base.length === 0) {
    base = 'file';
  }
  if (WINDOWS_RESERVED_BASE.test(base.normalize('NFKC'))) {
    base = `_${base}`;
  }

  const result = extension.length === 0 ? base : `${base}.${extension}`;
  return trimWindowsEnding(truncateUtf16(result, maximumLength));
}

export function assertSha256(value: string): string {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new StorageError('PATH_INVALID');
  }
  return value;
}

export function managedPathForContent(category: FileCategory, sha256: string): ManagedRelativePath {
  const hash = assertSha256(sha256);
  return parseManagedRelativePath(
    `${CATEGORY_DIRECTORY[category]}/${hash.slice(0, 2)}/${hash}`,
    category,
  );
}
