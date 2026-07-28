import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FetchExecutionService } from '../packages/fetch/src/index.js';
import { JobHandlerRegistry, registerFetchExecutionJob } from '../packages/workflows/src/index.js';

const projectRoot = process.cwd();

async function source(path: string): Promise<string> {
  return readFile(join(projectRoot, path), 'utf8');
}

describe('Issue 016 architecture boundaries', () => {
  it('keeps fetch Electron-free and out of renderer/network browser stacks', async () => {
    const packageJson = JSON.parse(await source('packages/fetch/package.json')) as {
      readonly dependencies: Readonly<Record<string, string>>;
    };
    expect(packageJson.dependencies).toEqual({
      '@mystery-operations/search': '0.0.0',
      '@mystery-operations/shared': '0.0.0',
      parse5: '8.0.1',
    });
    const files = [
      'packages/fetch/src/contracts.ts',
      'packages/fetch/src/execution-service.ts',
      'packages/fetch/src/html.ts',
      'packages/fetch/src/network-policy.ts',
      'packages/fetch/src/robots.ts',
      'packages/fetch/src/transport.ts',
    ];
    const combined = (await Promise.all(files.map(source))).join('\n');
    expect(combined).not.toMatch(
      /from ['"](?:electron|playwright|puppeteer|jsdom)|BrowserWindow|webview/iu,
    );
    expect(combined).not.toMatch(/@mystery-operations\/(?:db|storage|workflows)/u);
  });

  it('installs a strict product composition without test loopback relaxation', async () => {
    const runtime = await source('apps/desktop/src/fetch-runtime.ts');
    expect(runtime).toContain('new SystemDnsResolver()');
    expect(runtime).toContain('new NodeControlledFetchTransport()');
    expect(runtime).not.toContain('allowNonPublicForTests');
    expect(runtime).not.toMatch(/proxy|rejectUnauthorized\s*:\s*false/iu);
  });

  it('bundles Electron main from current fetch sources without requiring stale dist output', async () => {
    const viteMain = await source('vite.main.config.ts');
    expect(viteMain).toContain("'@mystery-operations/fetch'");
    expect(viteMain).toContain("new URL('./packages/fetch/src/index.ts', import.meta.url)");
  });

  it('has no renderer execution method, raw URL field or automatic enqueue source', async () => {
    const bridge = await source('packages/shared/src/desktop-api.ts');
    const preload = await source('apps/desktop/src/preload.ts');
    const ui = [
      await source('apps/web-ui/src/fetch-policy-settings.tsx'),
      await source('apps/web-ui/src/fetch-run-panel.tsx'),
    ].join('\n');
    expect(bridge).not.toMatch(/executeFetch|startFetch|enqueueFetch/iu);
    expect(preload).not.toMatch(/executeFetch|startFetch|enqueueFetch/iu);
    expect(ui).not.toMatch(/name=["']url|placeholder=["'][^"']*https?:|自动抓取|遍历按钮/iu);
  });

  it('registers exactly the explicit Fetch job type without starting a producer', () => {
    const registry = new JobHandlerRegistry();
    registerFetchExecutionJob(registry, {} as FetchExecutionService, { getPlan: async () => null });
    expect(registry.has('FETCH_PUBLIC_PAGE_V1')).toBe(true);
    expect(registry.has('FETCH_PUBLIC_PAGE_V2')).toBe(false);
  });

  it('does not add Issue 017-019 entities or write search candidate fetch state', async () => {
    const migration = await source('packages/db/src/migrations.ts');
    const repository = await source('packages/db/src/fetch-repository.ts');
    for (const table of [
      'fetch_profiles',
      'fetch_origin_rate_states',
      'fetch_robots_cache',
      'fetched_documents',
      'fetch_runs',
      'fetch_redirect_hops',
    ]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
    }
    expect(repository).not.toMatch(
      /(?:INSERT|UPDATE|DELETE)\s+(?:INTO\s+|FROM\s+)?(?:sources|claims|claim_evidence|books|clips|research_dossiers)\b/iu,
    );
    expect(repository).not.toMatch(/UPDATE\s+search_result_candidates/iu);
  });
});
