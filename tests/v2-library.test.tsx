// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { V2App } from '../apps/web-ui/src/v2/app.js';
import { catalogDisplayLabel } from '../apps/web-ui/src/v2/pages/library-page.js';
import { connectDatabase, SqliteCatalogRepository } from '../packages/db/src/index.js';
import {
  V2ContractError,
  V2_LIMITS,
  parseV2ReadRequest,
  toV2Exception,
  type V2Bridge,
  type V2CatalogWorkDetail,
  type V2CatalogWorkListView,
  type V2CatalogWorkSummary,
} from '../packages/v2/src/index.js';
import { syntheticObservation } from './support/bibliography-fixtures.js';
import { createMemoryV2Bridge } from './support/v2-test-runtime.js';

vi.mock('electron', () => ({
  app: { getAppPath: () => resolve('.') },
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  shell: { openPath: async () => '' },
}));

const NOW = '2026-08-19T00:00:00.000Z';
const temporaryRoots: string[] = [];

const work = {
  canonicalTitle: '合成谜案甲',
  editionCount: 1,
  expressionCount: 1,
  revision: 1,
  state: 'ACTIVE',
  workId: 'work-fixture-a',
} as const satisfies V2CatalogWorkSummary;

const detail = {
  ...work,
  aliases: [{ kind: 'CANONICAL', normalized: '合成谜案甲', raw: '合成谜案甲' }],
  expressions: [
    {
      editions: [
        {
          editionId: 'edition-fixture-a',
          identifiers: [{ namespace: 'ISBN_13', value: '9780306406157' }],
          label: '合成测试版',
          publisher: null,
          state: 'ACTIVE',
        },
      ],
      expressionId: 'expression-fixture-a',
      kind: 'ORIGINAL',
      language: 'zh-CN',
      state: 'ACTIVE',
      title: '合成谜案甲',
    },
  ],
  observations: [
    {
      factStatus: 'NOT_A_FACT',
      fieldProvenanceCount: 1,
      observationId: 'observation-fixture-a',
      originKind: 'SYNTHETIC_FIXTURE',
      truthStatus: 'UNVERIFIED',
    },
  ],
  publicationRelationships: [
    {
      language: null,
      objectAgentName: null,
      role: 'AGENCY',
      scopeId: 'work-fixture-a',
      scopeType: 'WORK',
      subjectAgentName: '合成机构',
      territory: null,
      verificationState: 'OBSERVED_UNVERIFIED',
    },
  ],
  relations: [
    {
      agentName: '合成作者',
      role: 'AUTHOR',
      scopeId: 'work-fixture-a',
      scopeType: 'WORK',
      verificationState: 'OBSERVED_UNVERIFIED',
    },
  ],
  sourceBoundary: 'UNVERIFIED_OBSERVATIONS',
} as const satisfies V2CatalogWorkDetail;

function listView(works: V2CatalogWorkListView['works']): V2CatalogWorkListView {
  return { hasMore: false, limit: 8, offset: 0, query: '', totalWorks: works.length, works };
}

function exposeCatalogBridge(overrides: Partial<V2Bridge> = {}): void {
  Object.defineProperty(window, 'rednoteV2', {
    configurable: true,
    value: {
      ...createMemoryV2Bridge(),
      readCatalogWork: async () => ({ ok: true, value: detail }),
      readCatalogWorks: async () => ({ ok: true, value: listView([work]) }),
      ...overrides,
    } satisfies V2Bridge,
  });
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteV2');
  window.history.replaceState(null, '', '/');
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true });
});

describe('R09 V2 Catalog contract and runtime', () => {
  it('accepts only bounded exact read requests and keeps mutation outside the V2 contract', () => {
    expect(
      parseV2ReadRequest({ limit: 8, offset: 0, query: ' 谜案 ', view: 'CATALOG_WORKS' }),
    ).toEqual({ limit: 8, offset: 0, query: '谜案', view: 'CATALOG_WORKS' });
    expect(parseV2ReadRequest({ view: 'CATALOG_WORK', workId: 'work-fixture-a' })).toEqual({
      view: 'CATALOG_WORK',
      workId: 'work-fixture-a',
    });
    for (const invalid of [
      { limit: 0, offset: 0, query: '', view: 'CATALOG_WORKS' },
      { limit: V2_LIMITS.catalogLimit + 1, offset: 0, query: '', view: 'CATALOG_WORKS' },
      { limit: 8, offset: V2_LIMITS.catalogOffset + 1, query: '', view: 'CATALOG_WORKS' },
      { limit: 8, offset: 0, query: 'x'.repeat(V2_LIMITS.catalogQuery + 1), view: 'CATALOG_WORKS' },
      { extra: true, view: 'CATALOG_WORK', workId: 'work-fixture-a' },
      { view: 'CATALOG_WORK', workId: '../database' },
      { action: 'MERGE_CATALOG_WORK', workId: 'work-fixture-a' },
    ]) {
      expect(() => parseV2ReadRequest(invalid)).toThrow(V2ContractError);
    }
  });

  it('projects existing repository facts through read-only V2 views without provider calls', async () => {
    const userDataRoot = mkdtempSync(join(tmpdir(), 'rednote-r09-runtime-'));
    temporaryRoots.push(userDataRoot);
    const { V2DesktopRuntime } = await import('../apps/desktop/src/v2-runtime.js');
    const providerExecution = {
      execute: vi.fn(async () => {
        throw new Error('R09 read-only Catalog must not execute a provider request.');
      }),
      inspect: vi.fn(async () => {
        throw new Error('R09 read-only Catalog must not inspect provider readiness.');
      }),
    };
    const runtime = await V2DesktopRuntime.open(userDataRoot, {
      assetsDirectory: resolve('apps/web-ui/src/v2/assets/content'),
      providerExecution,
    });
    try {
      const databasePath = join(userDataRoot, 'v2-project-data', 'database', 'rednote.sqlite');
      const database = connectDatabase(databasePath);
      try {
        const repository = new SqliteCatalogRepository(database);
        repository.insertSyntheticObservation(
          syntheticObservation('r09-runtime', {
            contributors: ['合成作者'],
            isbn: '9780306406157',
            title: '合成谜案甲',
          }),
          null,
          NOW,
        );
      } finally {
        database.close();
      }

      const list = (await runtime.read({
        limit: 8,
        offset: 0,
        query: '合成谜案',
        view: 'CATALOG_WORKS',
      })) as V2CatalogWorkListView;
      expect(list.works).toHaveLength(1);
      expect(list).toMatchObject({ hasMore: false, query: '合成谜案', totalWorks: 1 });
      const projected = (await runtime.read({
        view: 'CATALOG_WORK',
        workId: list.works[0]?.workId,
      })) as V2CatalogWorkDetail;
      expect(projected).toMatchObject({
        canonicalTitle: '合成谜案甲',
        editionCount: 1,
        expressionCount: 1,
        sourceBoundary: 'UNVERIFIED_OBSERVATIONS',
      });
      expect(projected.expressions[0]?.editions[0]?.identifiers).toEqual([
        { namespace: 'ISBN_13', value: '9780306406157' },
      ]);
      expect(projected.observations).toEqual([
        expect.objectContaining({ factStatus: 'NOT_A_FACT', truthStatus: 'UNVERIFIED' }),
      ]);
      expect(projected.relations).toEqual([
        expect.objectContaining({ role: 'AUTHOR', verificationState: 'OBSERVED_UNVERIFIED' }),
      ]);
      await expect(
        runtime.read({ view: 'CATALOG_WORK', workId: 'work-does-not-exist' }),
      ).resolves.toBeNull();
      expect(providerExecution.execute).not.toHaveBeenCalled();
      expect(providerExecution.inspect).not.toHaveBeenCalled();
    } finally {
      runtime.close();
    }
  });

  it('keeps the production V2 library independent from session.books', () => {
    const source = readFileSync(resolve('apps/web-ui/src/v2/pages/library-page.tsx'), 'utf8');
    expect(source).not.toMatch(/session\.books|bookRows|posts|saves/u);
    expect(source).not.toMatch(/readCatalog.*(?:merge|split|undo|create|import)/iu);
  });
});

describe('R09 V2 library renderer', () => {
  it('maps Catalog entity and evidence codes to Chinese without mutating DTO values', () => {
    expect(
      [
        'WORK',
        'EXPRESSION',
        'EDITION',
        'LEGACY_UNSPECIFIED',
        'UNVERIFIED',
        'NOT_A_FACT',
        'SYNTHETIC_FIXTURE',
        'OBSERVED_UNVERIFIED',
      ].map(catalogDisplayLabel),
    ).toEqual([
      '作品',
      '表达形态',
      '具体版本',
      '旧数据未标注类型',
      '未验证',
      '非事实陈述',
      '合成测试数据',
      '观察记录未验证',
    ]);
    expect(detail.observations[0]).toMatchObject({
      factStatus: 'NOT_A_FACT',
      originKind: 'SYNTHETIC_FIXTURE',
      truthStatus: 'UNVERIFIED',
    });
  });

  it('renders an honest empty Catalog without falling back to fixed works', async () => {
    exposeCatalogBridge({
      readCatalogWork: async () => ({ ok: true, value: null }),
      readCatalogWorks: async () => ({ ok: true, value: listView([]) }),
    });
    window.history.replaceState(null, '', '#/v2/library');
    render(<V2App />);
    expect(await screen.findByRole('heading', { name: '本机 Catalog 尚无作品' })).toBeVisible();
    expect(
      screen.getByText('请通过旧版回退入口维护本地书库；当前页面只读，不会自动导入或写入示例。'),
    ).toBeVisible();
    expect(screen.queryByText('莫格街凶杀案')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /导入/u })).not.toBeInTheDocument();
  });

  it('renders honest labels for legacy expression and unlabeled edition data', async () => {
    const baseExpression = detail.expressions[0];
    const baseEdition = baseExpression?.editions[0];
    if (baseExpression === undefined || baseEdition === undefined)
      throw new Error('Invalid fixture.');
    exposeCatalogBridge({
      readCatalogWork: async () => ({
        ok: true,
        value: {
          ...detail,
          expressions: [
            {
              ...baseExpression,
              editions: [{ ...baseEdition, label: null }],
              kind: 'LEGACY_UNSPECIFIED',
            },
          ],
        },
      }),
    });
    window.history.replaceState(null, '', '#/v2/library');
    render(<V2App />);

    await userEvent.setup().click(await screen.findByText('表达与版本'));
    expect(screen.getByText('旧数据未标注类型')).toBeVisible();
    expect(screen.getByText('版本信息未标注')).toBeVisible();
    expect(screen.queryByText('LEGACY_UNSPECIFIED')).not.toBeInTheDocument();
  });

  it('shows Work hierarchy, source boundaries, selection, search no-result and keyboard focus', async () => {
    const user = userEvent.setup();
    const second = { ...work, canonicalTitle: '合成谜案乙', workId: 'work-fixture-b' };
    const readCatalogWorks = vi.fn(async ({ query }: { readonly query: string }) => ({
      ok: true as const,
      value: query === '不存在' ? { ...listView([]), query } : listView([work, second]),
    }));
    exposeCatalogBridge({
      readCatalogWork: async ({ workId }) => ({
        ok: true,
        value:
          workId === second.workId
            ? { ...detail, canonicalTitle: second.canonicalTitle, workId: second.workId }
            : detail,
      }),
      readCatalogWorks,
    });
    window.history.replaceState(null, '', '#/v2/library');
    render(<V2App />);

    expect(await screen.findByRole('heading', { name: '合成谜案甲', level: 2 })).toBeVisible();
    expect(
      within(screen.getByRole('region', { name: '本机作品列表' })).getAllByText(
        '1 个表达形态 · 1 个具体版本',
      ),
    ).toHaveLength(2);
    const searchForm = screen.getByRole('search');
    expect(within(searchForm).getByRole('button', { name: '搜索' })).toHaveTextContent(/^搜索$/u);
    await user.click(await screen.findByText('表达与版本'));
    expect(screen.getByText('合成测试版')).toBeVisible();
    expect(screen.getByText('原始语言版本')).toBeVisible();
    await user.click(screen.getByText('别名与来源'));
    expect(screen.getByText('未验证 · 非事实陈述')).toBeVisible();
    expect(screen.getByText(/合成测试数据 · 1 个字段来源/u)).toBeVisible();
    await user.click(screen.getByText('人物与出版关系'));
    expect(screen.getByText(/作者 · 作品 · 观察记录未验证/u)).toBeVisible();
    expect(screen.getByText(/代理机构 · 作品 · 观察记录未验证/u)).toBeVisible();
    expect(screen.queryByText('UNVERIFIED · NOT_A_FACT')).not.toBeInTheDocument();
    expect(screen.queryByText(/AUTHOR · WORK · OBSERVED_UNVERIFIED/u)).not.toBeInTheDocument();

    const secondButton = screen.getByRole('button', { name: /查看只读详情/u });
    secondButton.focus();
    await user.keyboard('{Enter}');
    expect(secondButton).toHaveFocus();
    expect(await screen.findAllByRole('heading', { name: '合成谜案乙', level: 2 })).toHaveLength(2);

    await user.type(screen.getByRole('textbox', { name: '搜索本机作品' }), '不存在');
    await user.click(screen.getByRole('button', { name: '搜索' }));
    expect(await screen.findByRole('heading', { name: '没有匹配的作品' })).toBeVisible();
    expect(readCatalogWorks).toHaveBeenLastCalledWith({ limit: 8, offset: 0, query: '不存在' });
  });

  it('renders stable non-sensitive read failures and keeps retry actionable', async () => {
    const readCatalogWorks = vi.fn(async () => ({
      error: toV2Exception(new Error('private database path must not escape')),
      ok: false as const,
    }));
    exposeCatalogBridge({
      readCatalogWorks,
    });
    window.history.replaceState(null, '', '#/v2/library');
    render(<V2App />);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('本地操作未完成，请重新载入后再试。');
    expect(alert).not.toHaveTextContent('private database path');
    await userEvent.setup().click(screen.getByRole('button', { name: '重新读取' }));
    expect(readCatalogWorks).toHaveBeenCalledTimes(2);
  });
});
