import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

import { parseManagedRelativePath, StorageError } from '@mystery-operations/shared/storage';

import { assertManagedAncestorsWithoutLinks, type ProjectDataRoot } from './project-data-root.js';

const LOG_PATH = parseManagedRelativePath('logs/events.jsonl', 'LOG');
const MAX_CONTEXT_DEPTH = 5;
const MAX_CONTEXT_FIELDS = 64;
const MAX_ARRAY_ITEMS = 20;
const MAX_STRING_LENGTH = 512;
const MAX_LINE_BYTES = 16 * 1024;
const REDACTED = '[REDACTED]';
const SENSITIVE_KEY =
  /(?:authorization|cookie|api[_-]?key|pass(?:word)?|secret|token|request[_-]?headers?|payload|body|content)/iu;
const CREDENTIAL_VALUE =
  /(?:\bBearer\s+\S+|\bsk-[a-z0-9_-]{8,}|(?:api[_-]?key|password|secret|token)\s*[:=]\s*\S+)/giu;
const ABSOLUTE_PATH_VALUE =
  /(?:[a-z]:[\\/]|\\\\[?.\\]?[^\\]|(?:^|\s)\/(?:users|home|var|tmp)\/)\S*/giu;

export type LogLevel = 'ERROR' | 'INFO' | 'WARN';

export interface StructuredLogEvent {
  readonly code: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly level: LogLevel;
  readonly message: string;
}

export interface StructuredLogSinkOptions {
  readonly now?: () => Date;
}

interface SanitizationState {
  fields: number;
}

function sanitizeString(value: string): string {
  return value
    .slice(0, MAX_STRING_LENGTH)
    .replace(CREDENTIAL_VALUE, REDACTED)
    .replace(ABSOLUTE_PATH_VALUE, REDACTED);
}

function sanitizeValue(
  value: unknown,
  depth: number,
  state: SanitizationState,
): boolean | number | string | null | readonly unknown[] | Readonly<Record<string, unknown>> {
  if (depth > MAX_CONTEXT_DEPTH) {
    return '[TRUNCATED]';
  }
  if (value === null || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : '[INVALID_NUMBER]';
  }
  if (typeof value === 'string') {
    return sanitizeString(value);
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((entry) => sanitizeValue(entry, depth + 1, state));
  }
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (state.fields >= MAX_CONTEXT_FIELDS) {
        result.truncated = true;
        break;
      }
      state.fields += 1;
      result[key.slice(0, 64)] = SENSITIVE_KEY.test(key)
        ? REDACTED
        : sanitizeValue(entry, depth + 1, state);
    }
    return result;
  }
  return `[${typeof value}]`;
}

export class StructuredLogSink {
  readonly #now: () => Date;
  readonly #root: ProjectDataRoot;
  #tail: Promise<void> = Promise.resolve();

  public constructor(root: ProjectDataRoot, options: StructuredLogSinkOptions = {}) {
    this.#root = root;
    this.#now = options.now ?? (() => new Date());
  }

  public append(event: StructuredLogEvent): Promise<void> {
    const operation = this.#tail.then(async () => {
      if (!/^[A-Z][A-Z0-9_.-]{0,63}$/u.test(event.code)) {
        throw new StorageError('WRITE_FAILED');
      }
      const baseRecord = {
        code: event.code,
        context:
          event.context === undefined ? undefined : sanitizeValue(event.context, 0, { fields: 0 }),
        level: event.level,
        message: sanitizeString(event.message),
        timestamp: this.#now().toISOString(),
      };
      let line = `${JSON.stringify(baseRecord)}\n`;
      if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
        line = `${JSON.stringify({
          code: event.code,
          context: { truncated: true },
          level: event.level,
          message: sanitizeString(event.message).slice(0, 128),
          timestamp: baseRecord.timestamp,
        })}\n`;
      }

      assertManagedAncestorsWithoutLinks(this.#root, LOG_PATH, { allowMissingLeaf: true });
      const logPath = this.#root.resolve(LOG_PATH);
      let handle;
      try {
        handle = await open(
          logPath,
          constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY,
          0o600,
        );
        const status = await handle.stat();
        if (!status.isFile()) {
          throw new StorageError('FILE_TYPE_NOT_REGULAR');
        }
        await handle.writeFile(line, 'utf8');
        await handle.sync();
      } catch (error) {
        if (error instanceof StorageError) {
          throw error;
        }
        throw new StorageError('WRITE_FAILED', { cause: error });
      } finally {
        await handle?.close().catch(() => undefined);
      }
    });
    this.#tail = operation.catch(() => undefined);
    return operation;
  }
}
