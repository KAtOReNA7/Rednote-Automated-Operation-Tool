import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { V2LocalContentFiles } from '../apps/desktop/src/v2-content-files.js';
import { SqliteV2Repository } from '../packages/db/src/index.js';
import {
  V2ApplicationFacade,
  V2ContentApplication,
  V2ContentError,
  V2_DEFAULT_WEEK_KEY,
  V2_CONTENT_FIELD_KEYS,
  parseContentMutationRequest,
  type AccountPersona,
  type ContentBlobSet,
  type ContentExportResult,
  type ContentPackageFields,
  type ContentVersionRecord,
  type V2ContentFilePort,
  type WeeklyPlan,
} from '../packages/v2/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  cleanTemporaryStorageDirectories,
  createStorageTestContext,
} from './support/storage-test-utils.js';

const databases: DatabaseSync[] = [];
const candidateIds = ['mon-1', 'tue-2', 'sun-2'] as const;

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Missing ${label}.`);
  return value;
}

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  cleanTemporaryDatabases();
  await cleanTemporaryStorageDirectories();
});

class MemoryContentFiles implements V2ContentFilePort {
  readonly #fields = new Map<string, ContentPackageFields>();
  public writes = 0;

  public async writeFields(fields: ContentPackageFields): Promise<ContentBlobSet> {
    this.writes += 1;
    const encoded = JSON.stringify(fields);
    const refs = Object.fromEntries(
      V2_CONTENT_FIELD_KEYS.map((key) => {
        const sha256 = createHash('sha256').update(`${key}\0${encoded}`).digest('hex');
        const managedPath = `exports/v2-content/${sha256}`;
        this.#fields.set(managedPath, fields);
        return [key, { managedPath, sha256, sizeBytes: Buffer.byteLength(encoded) }];
      }),
    ) as ContentBlobSet;
    return refs;
  }

  public async readFields(record: ContentVersionRecord): Promise<ContentPackageFields> {
    const fields = this.#fields.get(record.files.title.managedPath);
    if (fields === undefined) throw new V2ContentError('CONTENT_CORRUPT');
    return fields;
  }

  public async exportPackages(
    records: readonly ContentVersionRecord[],
    idempotencyKey: string,
  ): Promise<ContentExportResult> {
    return {
      exportId: `r04-${createHash('sha256').update(idempotencyKey).digest('hex').slice(0, 24)}`,
      packageCount: records.length,
    };
  }

  public async openExport(): Promise<void> {}

  public corrupt(record: ContentVersionRecord): void {
    this.#fields.delete(record.files.title.managedPath);
  }
}

async function harness() {
  const { database } = await createInitializedDatabase('v2 r04 数据库');
  databases.push(database);
  const repository = new SqliteV2Repository(database, {
    now: () => new Date('2026-08-02T08:00:00.000Z'),
  });
  const facade = new V2ApplicationFacade(repository);
  const persona = facade.read({ view: 'ACCOUNT_PERSONA' }) as AccountPersona;
  const draftPlan = facade.read({
    view: 'WEEKLY_PLAN',
    weekKey: V2_DEFAULT_WEEK_KEY,
  }) as WeeklyPlan;
  const files = new MemoryContentFiles();
  return {
    app: new V2ContentApplication(repository, files),
    database,
    draftPlan,
    facade,
    files,
    persona,
    repository,
  };
}

function generation(plan: WeeklyPlan) {
  return {
    action: 'GENERATE_CONTENT_PACKAGES' as const,
    candidateIds,
    expectedPlanRevision: plan.revision,
    idempotencyKey: 'content-r04-fixture',
    weekKey: plan.weekKey,
  };
}

function approval(packages: readonly { id: string; revision: number; versionId: string }[]) {
  return packages.map((item) => ({
    expectedRevision: item.revision,
    expectedVersionId: item.versionId,
    packageId: item.id,
  }));
}

describe('V2-R04 content contracts and persistence', () => {
  it('gates generation on a locked plan and replays one deterministic three-package command', async () => {
    const { app, draftPlan, facade, files, persona } = await harness();
    await expect(app.generate(generation(draftPlan), persona, draftPlan)).rejects.toMatchObject({
      code: 'CONTENT_NOT_READY',
    });
    const plan = facade.mutate({
      action: 'LOCK_WEEKLY_PLAN',
      expectedRevision: draftPlan.revision,
      weekKey: draftPlan.weekKey,
    }) as WeeklyPlan;
    const first = await app.generate(generation(plan), persona, plan);
    const replay = await app.generate(generation(plan), persona, plan);

    expect(first.packages).toHaveLength(3);
    expect(replay).toEqual(first);
    expect(files.writes).toBe(3);
    expect(new Set(first.packages.map(({ candidateId }) => candidateId))).toEqual(
      new Set(candidateIds),
    );
    expect(
      Object.fromEntries(
        first.packages.map(({ candidateId, fields }) => [candidateId, fields.suggestedTime]),
      ),
    ).toEqual({
      'mon-1': '2026-07-27T10:00',
      'sun-2': '2026-08-02T14:00',
      'tue-2': '2026-07-28T14:00',
    });
    expect(JSON.stringify(first)).not.toMatch(/置顶评论|pinnedComment/u);
  });

  it('creates versions only for material edits and binds atomic approval to exact current versions', async () => {
    const { app, draftPlan, facade, persona, repository } = await harness();
    const plan = facade.mutate({
      action: 'LOCK_WEEKLY_PLAN',
      expectedRevision: 0,
      weekKey: draftPlan.weekKey,
    }) as WeeklyPlan;
    const created = await app.generate(generation(plan), persona, plan);
    const first = required(created.packages[0], 'first content package');
    const noOp = await app.save({
      action: 'SAVE_CONTENT_PACKAGE',
      expectedRevision: first.revision,
      expectedVersionId: first.versionId,
      fields: first.fields,
      packageId: first.id,
    });
    const edited = await app.save({
      action: 'SAVE_CONTENT_PACKAGE',
      expectedRevision: noOp.revision,
      expectedVersionId: noOp.versionId,
      fields: { ...noOp.fields, body: `${noOp.fields.body}\n用户补充一行。` },
      packageId: noOp.id,
    });
    expect([noOp.version, edited.version, edited.status]).toEqual([1, 2, 'DRAFT']);

    const current = (await app.read(plan.weekKey)).packages;
    const staleBatch = approval(current);
    staleBatch[1] = { ...required(staleBatch[1], 'second approval'), expectedRevision: 99 };
    await expect(app.approve(staleBatch)).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
    expect(repository.list(plan.weekKey).every(({ status }) => status === 'DRAFT')).toBe(true);

    const approved = await app.approve(approval(current));
    expect(approved.packages.every(({ status }) => status === 'APPROVED')).toBe(true);
    const approvedFirst = required(
      approved.packages.find(({ id }) => id === first.id),
      'approved first package',
    );
    const invalidated = await app.save({
      action: 'SAVE_CONTENT_PACKAGE',
      expectedRevision: approvedFirst.revision,
      expectedVersionId: approvedFirst.versionId,
      fields: { ...approvedFirst.fields, title: `${approvedFirst.fields.title}（修订）` },
      packageId: approvedFirst.id,
    });
    expect(invalidated).toMatchObject({ status: 'REVIEW_REQUIRED', version: 3 });
    await expect(app.export(approval([invalidated]), 'export-r04-blocked')).rejects.toMatchObject({
      code: 'CONTENT_NOT_APPROVED',
    });
    await expect(
      app.save({
        action: 'SAVE_CONTENT_PACKAGE',
        expectedRevision: approvedFirst.revision,
        expectedVersionId: approvedFirst.versionId,
        fields: approvedFirst.fields,
        packageId: approvedFirst.id,
      }),
    ).rejects.toMatchObject({ code: 'REVISION_CONFLICT' });
  });

  it('restores metadata and content through a new application instance and fails closed on corruption', async () => {
    const { app, database, draftPlan, facade, files, persona } = await harness();
    const plan = facade.mutate({
      action: 'LOCK_WEEKLY_PLAN',
      expectedRevision: 0,
      weekKey: draftPlan.weekKey,
    }) as WeeklyPlan;
    const created = await app.generate(generation(plan), persona, plan);
    const restored = new V2ContentApplication(new SqliteV2Repository(database), files);
    await expect(restored.read(plan.weekKey)).resolves.toEqual(created);

    const rows = database
      .prepare(`SELECT files_json FROM v2_content_package_versions ORDER BY package_id`)
      .all() as Array<{ readonly files_json: string }>;
    expect(rows).toHaveLength(3);
    const first = required(created.packages[0], 'restored first package');
    expect(JSON.stringify(rows)).not.toContain(first.fields.body);
    expect(
      database
        .prepare(
          `SELECT count(*) AS count FROM sqlite_schema WHERE type = 'trigger' AND name LIKE 'v2_%'`,
        )
        .get(),
    ).toEqual({ count: 0 });

    const firstMetadata = required(rows[0], 'first metadata row');
    const tampered = JSON.parse(firstMetadata.files_json) as Array<Record<string, unknown>>;
    required(tampered[0], 'first file reference').secret = 'must-fail-closed';
    database
      .prepare(`UPDATE v2_content_package_versions SET files_json = ? WHERE package_id = ?`)
      .run(JSON.stringify(tampered), first.id);
    await expect(restored.read(plan.weekKey)).rejects.toMatchObject({ code: 'CONTENT_CORRUPT' });
    database
      .prepare(`UPDATE v2_content_package_versions SET files_json = ? WHERE package_id = ?`)
      .run(firstMetadata.files_json, first.id);
    files.corrupt(new SqliteV2Repository(database).get(first.id));
    await expect(restored.read(plan.weekKey)).rejects.toMatchObject({ code: 'CONTENT_CORRUPT' });
  });

  it('rejects extra fields, unsafe identifiers, malformed time, and forbidden legacy surfaces', () => {
    const base = {
      action: 'SAVE_CONTENT_PACKAGE',
      expectedRevision: 0,
      expectedVersionId: 'pkg-1-v1',
      fields: {
        body: '正文',
        coverKey: 'morgue',
        materialNotes: '素材说明',
        suggestedTime: '2026-08-02T20:00',
        tags: ['推理小说'],
        title: '标题',
      },
      packageId: 'pkg-1',
    };
    expect(parseContentMutationRequest(base)).toMatchObject({ action: 'SAVE_CONTENT_PACKAGE' });
    for (const invalid of [
      { ...base, pinnedComment: '禁止' },
      { ...base, packageId: '../escape' },
      { ...base, fields: { ...base.fields, suggestedTime: '周六 20:00' } },
      { ...base, fields: { ...base.fields, copyrightRisk: 'HIGH' } },
    ]) {
      expect(() => parseContentMutationRequest(invalid)).toThrow();
    }
  });
});

describe('V2-R04 controlled local export', () => {
  it('accepts only bounded inline PNG bytes and stores them under GENERATED_IMAGE', async () => {
    const { root } = await createStorageTestContext();
    const assetRoot = resolve(import.meta.dirname, '../apps/web-ui/src/v2/assets/content');
    const files = new V2LocalContentFiles(root, {
      moonstone: join(assetRoot, 'moonstone-cover.png'),
      morgue: join(assetRoot, 'morgue-cover.png'),
      'yellow-room': join(assetRoot, 'yellow-room-cover.png'),
    });
    const png = Buffer.from(
      [
        '89504e470d0a1a0a',
        '0000000d49484452',
        '0000000100000001',
        '08060000001f15c489',
        '0000000d49444154',
        '08d763f8cfc0f01f00050001ff89993d1d',
        '0000000049454e44ae426082',
      ].join(''),
      'hex',
    );
    const stored = await files.writeGeneratedCover(png, 'run-fixture');
    expect(stored).toMatchObject({ mimeType: 'image/png' });
    expect(stored.height).toBe(1);
    expect(stored.width).toBe(1);
    expect(stored.managedPath).toMatch(/^generated-images\/[a-f0-9]{2}\/[a-f0-9]{64}$/u);
    await expect(files.readGeneratedCover(stored)).resolves.toEqual(png);
    await expect(
      files.writeGeneratedCover(Buffer.from('https://example.invalid/cover'), 'run-fixture'),
    ).rejects.toMatchObject({ code: 'CONTENT_CORRUPT' });
  });

  it('writes one atomic, idempotent multi-package directory and opens only its opaque ID', async () => {
    const { root, rootPath } = await createStorageTestContext();
    const assetRoot = resolve(import.meta.dirname, '../apps/web-ui/src/v2/assets/content');
    let opened = '';
    const files = new V2LocalContentFiles(
      root,
      {
        moonstone: join(assetRoot, 'moonstone-cover.png'),
        morgue: join(assetRoot, 'morgue-cover.png'),
        'yellow-room': join(assetRoot, 'yellow-room-cover.png'),
      },
      { openDirectory: async (path) => ((opened = path), '') },
    );
    const fields: ContentPackageFields[] = [
      {
        body: '第一包正文。',
        coverKey: 'morgue',
        materialNotes: '只使用已批准演示封面。',
        suggestedTime: '2026-08-03T10:00',
        tags: ['推理小说', '公版经典'],
        title: '第一包标题',
      },
      {
        body: '第二包正文。',
        coverKey: 'moonstone',
        materialNotes: '完全本地。',
        suggestedTime: '2026-08-04T14:00',
        tags: ['月亮宝石'],
        title: '第二包标题',
      },
    ];
    const records: ContentVersionRecord[] = [];
    for (const [index, item] of fields.entries()) {
      records.push({
        candidateId: `candidate-${index + 1}`,
        coverKey: item.coverKey,
        files: await files.writeFields(item),
        packageId: `pkg-${index + 1}`,
        planRevision: 3,
        revision: 1,
        status: 'APPROVED',
        version: 1,
        versionId: `pkg-${index + 1}-v1`,
        weekKey: V2_DEFAULT_WEEK_KEY,
      });
    }

    const first = await files.exportPackages(records, 'export-r04-local');
    await expect(files.exportPackages(records, 'export-r04-local')).resolves.toEqual(first);
    const exportRoot = join(rootPath, 'exports', 'v2');
    expect(await readdir(exportRoot)).toEqual([first.exportId]);
    const directory = join(exportRoot, first.exportId);
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8')) as {
      aiDisclosure: boolean;
      packages: Array<{ files: Record<string, { path: string }>; suggestedTime: string }>;
      schemaVersion: number;
    };
    expect(manifest).toMatchObject({ aiDisclosure: false, schemaVersion: 1 });
    expect(manifest.packages.map(({ suggestedTime }) => suggestedTime)).toEqual(
      fields.map(({ suggestedTime }) => suggestedTime),
    );
    expect(JSON.stringify(manifest)).not.toMatch(/置顶评论|pinnedComment|secret/u);
    expect(JSON.stringify(manifest)).not.toContain(rootPath);
    for (const item of manifest.packages) {
      expect(Object.keys(item.files).sort()).toEqual([...V2_CONTENT_FIELD_KEYS].sort());
      for (const { path } of Object.values(item.files))
        await expect(readFile(join(directory, path))).resolves.toBeTruthy();
    }
    await expect(readFile(join(directory, 'START-HERE.txt'), 'utf8')).resolves.toContain(
      '这是本地发布包，最终需由用户在小红书官方端手动发布；系统未登录或操作平台。',
    );
    await files.openExport(first.exportId);
    expect(opened).toBe(directory);

    const firstRecord = required(records[0], 'first export record');
    const secondRecord = required(records[1], 'second export record');
    const broken = {
      ...secondRecord,
      files: {
        ...secondRecord.files,
        body: { ...secondRecord.files.body, sha256: '0'.repeat(64) },
      },
    };
    await expect(
      files.exportPackages([firstRecord, broken], 'export-r04-failure'),
    ).rejects.toMatchObject({ code: 'EXPORT_FAILED' });
    expect((await readdir(exportRoot)).every((name) => !name.startsWith('.rednote-tmp-'))).toBe(
      true,
    );
    await expect(files.openExport('r04-000000000000000000000000')).rejects.toMatchObject({
      code: 'INVALID_REQUEST',
    });
  });
});
