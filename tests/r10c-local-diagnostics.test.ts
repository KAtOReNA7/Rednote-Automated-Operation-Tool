import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createLocalDiagnosticPreview,
  initializeProjectDataRoot,
  summarizeLocalDiagnosticCategories,
  validateLocalDiagnosticPayload,
  verifyLocalDiagnosticZip,
  writeLocalDiagnosticPackage,
  type LocalDiagnosticPayload,
} from '../packages/storage/src/index.js';
import {
  cleanTemporaryStorageDirectories,
  createTemporaryStoragePath,
} from './support/storage-test-utils.js';

const payload = (): LocalDiagnosticPayload => ({
  application: { build: 'a'.repeat(40), version: '0.0.0' },
  collectedAt: '2026-08-21T12:00:00.000Z',
  fileCategories: [
    { category: 'imports', itemCount: 2, totalBytes: 12 },
    { category: 'photos', itemCount: 0, totalBytes: 0 },
  ],
  format: 'rednote-local-diagnostics',
  health: { database: 'healthy', storage: 'healthy' },
  runtime: { node: '24.0.0', platform: 'win32' },
  version: 1,
});

afterEach(cleanTemporaryStorageDirectories);

describe('R10C local diagnostic package', () => {
  it('uses a closed, path-free payload and writes exactly one verifiable two-entry ZIP after confirmation', async () => {
    const destination = await createTemporaryStoragePath('r10c-diagnostic-output');
    const input = validateLocalDiagnosticPayload(payload());
    const preview = createLocalDiagnosticPreview(input);
    expect(preview).toMatchObject({ estimatedBytes: expect.any(Number) });
    expect(JSON.stringify(preview)).not.toMatch(/a{40}|win32|credential/iu);

    const result = await writeLocalDiagnosticPackage({
      directory: destination,
      payload: input,
      previewHash: preview.previewHash,
      randomId: () => 'a'.repeat(32),
    });
    expect(result).toMatchObject({
      fileName: /^diagnostics-20260821-120000-a{32}\.zip$/u,
      outcome: 'SUCCESS',
    });
    if (result.outcome !== 'SUCCESS') throw new Error('expected success');
    expect(await readdir(destination)).toEqual([result.fileName]);
    const archive = await readFile(join(destination, result.fileName));
    expect(verifyLocalDiagnosticZip(archive)).toEqual({
      createdAt: input.collectedAt,
      diagnostic: {
        name: 'diagnostic.json',
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        sizeBytes: expect.any(Number),
      },
      format: 'rednote-local-diagnostics',
      version: 1,
    });
  });

  it.each([
    ['unknown key', { ...payload(), unknown: 'canary' }],
    ['credential key', { ...payload(), credential: 'canary' }],
    [
      'absolute Windows path',
      { ...payload(), runtime: { node: '24.0.0', platform: 'C:\\secret' } },
    ],
    ['POSIX path', { ...payload(), application: { build: '/private', version: '0.0.0' } }],
    ['oversized text', { ...payload(), runtime: { node: 'x'.repeat(257), platform: 'win32' } }],
  ])('fails closed for %s', (_name, value) => {
    expect(() => validateLocalDiagnosticPayload(value)).toThrow(
      /INVALID_DIAGNOSTIC|LIMIT_EXCEEDED/u,
    );
  });

  it('does not write anything when the preview has changed', async () => {
    const destination = await createTemporaryStoragePath('r10c-diagnostic-stale');
    const input = validateLocalDiagnosticPayload(payload());
    const result = await writeLocalDiagnosticPackage({
      directory: destination,
      payload: input,
      previewHash: '0'.repeat(64),
    });
    expect(result).toEqual({ outcome: 'FAILED_CLEAN' });
    expect(await readdir(destination)).toEqual([]);
  });

  it('summarizes only controlled categories without exposing names or paths', async () => {
    const parent = await createTemporaryStoragePath('r10c-diagnostic-root');
    const root = await initializeProjectDataRoot(join(parent, 'project'));
    const categories = await summarizeLocalDiagnosticCategories(root);
    expect(categories).toHaveLength(5);
    expect(JSON.stringify(categories)).not.toMatch(/project|[\\/]/u);
    expect(categories.map((category) => category.itemCount)).toEqual([0, 0, 0, 0, 0]);
  });
});
