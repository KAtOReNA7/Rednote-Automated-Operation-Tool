import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function treeSource(path: string): string {
  const root = join(ROOT, path);
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const child = join(root, entry.name);
      if (entry.isDirectory()) return treeSource(join(path, entry.name));
      if (!entry.isFile() || !/\.[cm]?[jt]sx?$/u.test(entry.name) || !statSync(child).isFile()) {
        return [];
      }
      return [readFileSync(child, 'utf8')];
    })
    .join('\n');
}

describe('Issue 019 evidence architecture and governance', () => {
  it('archives exactly one Issue 019 instruction under docs/instructions/m2', () => {
    const name = 'M2-Issue019-source-atomic-facts-conflict-handling-Codex-instruction.txt';
    expect(existsSync(join(ROOT, 'docs/instructions/m2', name))).toBe(true);
    expect(existsSync(join(ROOT, name))).toBe(false);
    expect(existsSync(join(ROOT, 'Issue019-Codex-instruction.txt'))).toBe(false);
  });

  it('keeps the renderer outside Node, Electron, SQLite, paths, raw HTML, and credentials', () => {
    const renderer = source('apps/web-ui/src/research-page.tsx');
    expect(renderer).not.toContain('dangerouslySetInnerHTML');
    expect(renderer).not.toMatch(
      /from ['"](?:node:|electron|@mystery-operations\/(?:db|evidence|workflows|storage))|process\.env|sqlite|credential|api.?key|rawResponse|snapshotPath/iu,
    );
  });

  it('keeps evidence domain and repository free of direct egress and credential resolution', () => {
    const implementation = [
      treeSource('packages/evidence/src'),
      source('packages/db/src/evidence-repository.ts'),
      source('apps/desktop/src/evidence-runtime.ts'),
    ].join('\n');
    expect(implementation).not.toMatch(
      /from ['"](?:node:)?(?:http|https|net|tls|dns)|\bfetch\s*\(|process\.env|CredentialStore|resolveCredential|api.?key/iu,
    );
  });

  it('keeps Search, Fetch, and Catalog inputs explicitly unverified and outside Evidence', () => {
    const search = treeSource('packages/search/src');
    const fetch = treeSource('packages/fetch/src');
    const catalog = treeSource('packages/catalog/src');
    expect(search).toContain('LEAD_ONLY');
    expect(search).toContain('NOT_A_FACT');
    expect(fetch).toContain('FETCHED_NOT_EVIDENCE');
    expect(fetch).toContain('NOT_A_FACT');
    expect(catalog).toContain('UNVERIFIED');
    expect(`${search}\n${fetch}\n${catalog}`).not.toMatch(
      /FACT_BLOCKED|KEY_FACT_ELIGIBLE|fact-policy-v1/iu,
    );
  });

  it('does not introduce dossier, topic, draft, approval, post-package, AI, or copyright policy logic', () => {
    const policy = [
      source('packages/evidence/src/policy.ts'),
      source('packages/evidence/src/conflicts.ts'),
      source('packages/db/src/evidence-repository.ts'),
    ].join('\n');
    expect(policy).not.toMatch(
      /research_dossiers|\btopics\b|\bdrafts\b|\bapprovals\b|post_packages|aiDisclosure|ai_disclosure|copyright|版权|RIGHTS_PARTY|LICENSOR|LICENSEE/iu,
    );
  });
});
