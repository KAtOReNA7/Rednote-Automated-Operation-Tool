import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { validateDesktopIpcRequest } from '../apps/desktop/src/ipc-policy.js';
import { MIGRATIONS } from '../packages/db/src/index.js';

function source(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('Issue 015 architecture boundaries', () => {
  it('keeps migration v8 unchanged when later migrations are appended', () => {
    expect(MIGRATIONS.map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19,
    ]);
    expect(MIGRATIONS[7]?.name).toBe('search_provider_runs_and_rate_limits');
  });

  it('keeps the renderer free of Node, Electron, SQLite, network and credential imports', () => {
    const renderer = [
      source('apps/web-ui/src/search-provider-settings.tsx'),
      source('apps/web-ui/src/search-run-panel.tsx'),
    ].join('\n');
    expect(renderer).not.toMatch(
      /from\s+['"](?:node:|electron|@mystery-operations\/(?:db|settings|search))/u,
    );
    expect(renderer).not.toMatch(/\b(?:fetch|XMLHttpRequest|WebSocket)\s*\(/u);
  });

  it('exposes only status and finite configuration IPC, never search execution', () => {
    const shared = source('packages/shared/src/desktop-api.ts');
    expect(shared).toContain("getSearchState: 'search:get-state'");
    expect(shared).toContain("updateSearchProviderConfig: 'search:update-provider-config'");
    expect(shared).not.toMatch(/search:(?:execute|fetch|crawl|plugin)/u);
  });

  it('bundles Electron main from current search sources without requiring stale dist output', () => {
    const viteMain = source('vite.main.config.ts');
    expect(viteMain).toContain("'@mystery-operations/search'");
    expect(viteMain).toContain("new URL('./packages/search/src/index.ts', import.meta.url)");
  });

  it('validates search configuration IPC by exact provider-specific fields', () => {
    const renderer = 'rednote://app/index.html';
    const input = {
      curatedEntries: [],
      enabled: true,
      expectedRevision: 1,
      maxResults: 1,
      providerInstanceId: 'manual-url-v1',
      ratePolicy: null,
      timeoutMs: 5_000,
    };
    expect(
      validateDesktopIpcRequest(renderer, [input], renderer, 'updateSearchProviderConfig'),
    ).toBeNull();
    expect(
      validateDesktopIpcRequest(
        renderer,
        [
          {
            ...input,
            curatedEntries: [
              {
                entryId: 'must-not-be-accepted',
                intent: 'BOOK_DISCOVERY',
                languageHint: null,
                title: 'Wrong provider',
                urlTemplate: 'https://example.com/search?q={query}',
              },
            ],
          },
        ],
        renderer,
        'updateSearchProviderConfig',
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateDesktopIpcRequest(
        renderer,
        [{ ...input, arbitraryEndpoint: 'https://example.com' }],
        renderer,
        'updateSearchProviderConfig',
      ),
    ).toMatchObject({ ok: false });
  });

  it('has no production Search API codec, dynamic scripts, arbitrary HTTP or fallback', () => {
    const api = source('packages/search/src/search-api.ts');
    const plan = source('packages/search/src/registry.ts');
    expect(api).toContain('ScriptedSearchApiCodec');
    expect(api).toContain('LoopbackSearchApiCodec');
    expect(api).not.toMatch(/class\s+(?:Google|Bing|Brave|SerpApi|Tavily)/u);
    expect(api).not.toMatch(
      /userMethod|userHeaders|jsonPath|scriptTemplate|eval\s*\(|new Function/u,
    );
    expect(plan).toContain("fallback: 'NONE'");
  });

  it('does not add Local API routes or Issue 016+ content entities', () => {
    const localApi = source('packages/local-api/src/router.ts');
    expect(localApi).not.toMatch(/\/v1\/(?:search|clips|fetch)\b/iu);
    const migration = MIGRATIONS.at(-1)?.sql ?? '';
    expect(migration).not.toMatch(/CREATE TABLE (?:books|sources|claims|clips)\b/iu);
    const execution = [
      source('packages/search/src/execution-service.ts'),
      source('packages/workflows/src/search-execution-handler.ts'),
      source('apps/desktop/src/search-runtime.ts'),
    ].join('\n');
    expect(execution).not.toMatch(/\.enqueue(?:Job)?\s*\(/u);
  });

  it('runs test:search in package scripts and Windows CI', () => {
    const packageJson = JSON.parse(source('package.json')) as { scripts: Record<string, string> };
    expect(packageJson.scripts['test:search']).toContain('search-contracts.test.ts');
    expect(source('.github/workflows/ci.yml')).toContain('npm run test:search');
  });
});
