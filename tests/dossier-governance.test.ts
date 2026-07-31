import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8');
}

function coversIssue(content: string, issueNumber: number): boolean {
  const ranges = content.matchAll(/\bIssues?\s+0*(\d{1,4})\s*[—–-]\s*0*(\d{1,4})\b/giu);
  for (const match of ranges) {
    const startText = match[1];
    const endText = match[2];
    if (startText === undefined || endText === undefined) continue;
    const start = Number.parseInt(startText, 10);
    const end = Number.parseInt(endText, 10);
    if (start <= issueNumber && issueNumber <= end) return true;
  }

  const explicitIssues = content.matchAll(/\bIssues?\s+0*(\d{1,4})\b/giu);
  for (const match of explicitIssues) {
    const value = match[1];
    if (value !== undefined && Number.parseInt(value, 10) === issueNumber) return true;
  }
  return false;
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

describe('Issue 020 dossier architecture and governance', () => {
  it('archives exactly one Issue 020 instruction under docs/instructions/m2', () => {
    const name = 'M2-Issue020-versioned-research-dossier-Codex-instruction.txt';
    expect(existsSync(join(ROOT, 'docs/instructions/m2', name))).toBe(true);
    expect(existsSync(join(ROOT, name))).toBe(false);
  });

  it('keeps renderer DTO-only and outside Node, Electron, SQLite, paths, HTML and credentials', () => {
    const renderer = [
      source('apps/web-ui/src/research-page.tsx'),
      source('apps/web-ui/src/dossier-workspace.tsx'),
    ].join('\n');
    expect(renderer).not.toContain('dangerouslySetInnerHTML');
    expect(renderer).not.toMatch(
      /from ['"](?:node:|electron|@mystery-operations\/(?:db|dossier|evidence|workflows|storage))|process\.env|sqlite|credential|api.?key|rawResponse|snapshotPath|managedPath/iu,
    );
  });

  it('keeps deterministic dossier construction free of egress, credentials and model execution', () => {
    const implementation = [
      treeSource('packages/dossier/src'),
      source('packages/db/src/dossier-repository.ts'),
      source('packages/workflows/src/dossier-build-handler.ts'),
      source('apps/desktop/src/dossier-runtime.ts'),
    ].join('\n');
    expect(implementation).not.toMatch(
      /from ['"](?:node:)?(?:http|https|net|tls|dns)|\bfetch\s*\(|process\.env|CredentialStore|resolveCredential|ModelExecutionService|api.?key/iu,
    );
  });

  it('does not couple AI, copyright or content-production tables to coverage/readiness', () => {
    const policy = source('packages/dossier/src/policy.ts');
    expect(policy).not.toMatch(
      /aiDisclosure|ai_disclosure|copyright|版权|\btopics\b|\bcontent_briefs\b|\bdrafts\b|\bapprovals\b|\bpost_packages\b|\bpublications\b/iu,
    );
    expect(policy).toContain("publication_relationship: 'SERIES_AND_RELATIONSHIPS'");
    expect(policy).not.toMatch(
      /key\([^)]*publication[_-]relationship|minimumRequired[^;]*publication[_-]relationship/iu,
    );
  });

  it('tracks required contracts, ADR, plan, acceptance map and current issue indexes', () => {
    for (const path of [
      'docs/contracts/research-dossier-v1.md',
      'docs/contracts/dossier-coverage-readiness-v1.md',
      'docs/adr/0016-versioned-research-dossiers.md',
      'docs/m2-issue020-implementation-plan.md',
      'docs/m2-issue020-acceptance-map.md',
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
    for (const path of [
      'README.md',
      'AGENTS.md',
      'docs/product/xiaohongshu-development-roadmap-v1.md',
      'docs/instructions/README.md',
    ]) {
      const progress = source(path);
      expect(coversIssue(progress, 22), path).toBe(true);
      expect(coversIssue(progress, 23), path).toBe(true);
    }
  });

  it('recognizes explicit and compact Issue ranges without accepting unrelated numbers', () => {
    expect(coversIssue('Issue 023 已完成', 23)).toBe(true);
    expect(coversIssue('Issue 022—026 已完成', 23)).toBe(true);
    expect(coversIssue('Issues 022–028 completed', 23)).toBe(true);
    expect(coversIssue('Issue 022-028 completed', 23)).toBe(true);
    expect(coversIssue('Issue 024 已完成', 23)).toBe(false);
    expect(coversIssue('完成范围 022—026', 23)).toBe(false);
    expect(coversIssue('Issue 024—028 已完成', 23)).toBe(false);
  });
});
