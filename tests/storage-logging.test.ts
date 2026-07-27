import { readFile } from 'node:fs/promises';

import { afterEach, describe, expect, it } from 'vitest';

import { parseManagedRelativePath } from '../packages/shared/src/storage-contracts.js';
import { StructuredLogSink } from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';

afterEach(cleanTemporaryStorageDirectories);

describe('local structured log sink', () => {
  it('writes parseable bounded JSON Lines with UTC metadata', async () => {
    const { root } = await createStorageTestContext();
    const sink = new StructuredLogSink(root, {
      now: () => new Date('2026-07-27T12:34:56.000Z'),
    });

    await sink.append({
      code: 'STORAGE.READY',
      context: { count: 1, managedPath: 'imports/aa/file' },
      level: 'INFO',
      message: 'storage ready',
    });

    const content = await readFile(
      root.resolve(parseManagedRelativePath('logs/events.jsonl', 'LOG')),
      'utf8',
    );
    const lines = content.trimEnd().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toEqual({
      code: 'STORAGE.READY',
      context: { count: 1, managedPath: 'imports/aa/file' },
      level: 'INFO',
      message: 'storage ready',
      timestamp: '2026-07-27T12:34:56.000Z',
    });
    expect(Buffer.byteLength(lines[0] ?? '', 'utf8')).toBeLessThan(16 * 1024);
  });

  it('recursively redacts credential keys, credential values, payloads and absolute paths', async () => {
    const { root, rootPath } = await createStorageTestContext();
    const sink = new StructuredLogSink(root);
    await sink.append({
      code: 'STORAGE.REDACTION',
      context: {
        Authorization: 'Bearer top-secret-token',
        nested: {
          api_key: 'sk-1234567890abcdef',
          note: `failed at ${rootPath}\\private.txt`,
          password: 'plain-password',
          payload: { full: 'never write this body' },
          safePath: 'imports/aa/file',
          secret: 'plain-secret',
          token: 'plain-token',
        },
      },
      level: 'WARN',
      message: `Bearer message-secret failed at ${rootPath}\\private.txt`,
    });
    const content = await readFile(
      root.resolve(parseManagedRelativePath('logs/events.jsonl', 'LOG')),
      'utf8',
    );

    expect(content).not.toContain('top-secret-token');
    expect(content).not.toContain('sk-1234567890abcdef');
    expect(content).not.toContain('plain-password');
    expect(content).not.toContain('never write this body');
    expect(content).not.toContain('plain-secret');
    expect(content).not.toContain('plain-token');
    expect(content).not.toContain(rootPath);
    expect(content).toContain('[REDACTED]');
    expect(content).toContain('imports/aa/file');
  });

  it('enforces depth, array, field, string and final-line limits', async () => {
    const { root } = await createStorageTestContext();
    const sink = new StructuredLogSink(root);
    const manyFields = Object.fromEntries(
      Array.from({ length: 100 }, (_, index) => [`field${index}`, 'x'.repeat(1_000)]),
    );
    await sink.append({
      code: 'STORAGE.LIMITS',
      context: {
        array: Array.from({ length: 100 }, (_, index) => index),
        deep: { one: { two: { three: { four: { five: { six: 'hidden' } } } } } },
        manyFields,
      },
      level: 'ERROR',
      message: 'm'.repeat(10_000),
    });
    const content = await readFile(
      root.resolve(parseManagedRelativePath('logs/events.jsonl', 'LOG')),
      'utf8',
    );
    const line = content.trimEnd();

    expect(Buffer.byteLength(line, 'utf8')).toBeLessThan(16 * 1024);
    expect(JSON.parse(line)).toBeDefined();
    expect(line).not.toContain('hidden');
    expect(line).toContain('"truncated":true');
  });

  it('serializes concurrent appends without broken or interleaved JSON', async () => {
    const { root } = await createStorageTestContext();
    let millisecond = 0;
    const sink = new StructuredLogSink(root, {
      now: () => new Date(1_753_616_096_000 + millisecond++),
    });
    await Promise.all(
      Array.from({ length: 100 }, (_, index) =>
        sink.append({
          code: 'STORAGE.CONCURRENT',
          context: { index },
          level: 'INFO',
          message: `event ${index}`,
        }),
      ),
    );
    const content = await readFile(
      root.resolve(parseManagedRelativePath('logs/events.jsonl', 'LOG')),
      'utf8',
    );
    const lines = content.trimEnd().split('\n');
    const records = lines.map(
      (line) => JSON.parse(line) as { readonly context: { index: number } },
    );

    expect(lines).toHaveLength(100);
    expect(new Set(records.map((record) => record.context.index)).size).toBe(100);
  });
});
