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

describe('Issue 018 repository and egress governance', () => {
  it('archives the only Issue 018 instruction under the governed instruction directory', () => {
    const finalPath = join(
      ROOT,
      'docs/instructions/m2/M2-Issue018-bibliographic-discovery-entity-resolution-Codex-instruction.txt',
    );
    expect(existsSync(finalPath)).toBe(true);
    expect(
      existsSync(
        join(
          ROOT,
          'M2-Issue018-bibliographic-discovery-entity-resolution-repository-governance-v2-Codex-instruction.txt',
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(ROOT, 'M2-Issue018-bibliographic-discovery-entity-resolution-Codex-instruction.txt'),
      ),
    ).toBe(false);
  });

  it('keeps fixed 50-book wording only in explicit non-normative revision notices', () => {
    for (const path of [
      'docs/product/xiaohongshu-mystery-account-prd-v1.md',
      'docs/product/xiaohongshu-development-roadmap-v1.md',
    ]) {
      const matching = source(path)
        .split(/\r?\n/u)
        .filter((line) => /50\s*(?:本|条)/u.test(line));
      expect(matching.length, path).toBeGreaterThan(0);
      expect(
        matching.every((line) => line.startsWith('>') && /不再/u.test(line)),
        `${path}: ${matching.join('\n')}`,
      ).toBe(true);
    }
  });

  it('keeps catalog execution local-only and outside credential/model/network packages', () => {
    const catalogSources = [
      'packages/catalog/src/index.ts',
      'packages/catalog/src/contracts.ts',
      'packages/catalog/src/discovery.ts',
      'packages/catalog/src/resolution.ts',
      'packages/db/src/catalog-repository.ts',
      'packages/workflows/src/bibliography-discovery-handler.ts',
      'apps/desktop/src/catalog-runtime.ts',
    ]
      .map(source)
      .join('\n');
    expect(catalogSources).not.toMatch(
      /from ['"](?:node:)?(?:http|https|net|tls|dns)|\bfetch\s*\(|process\.env|CredentialStore|api.?key/iu,
    );
    expect(source('apps/web-ui/src/library-page.tsx')).not.toContain('dangerouslySetInnerHTML');
    expect(source('apps/web-ui/src/library-page.tsx')).not.toMatch(
      /@mystery-operations\/(?:db|workflows|catalog)|node:|electron/iu,
    );
  });

  it('does not couple publication relationships, AI disclosure or copyright to gates', () => {
    const gateSources = `${treeSource('packages/core/src')}\n${treeSource('packages/workflows/src')}`;
    expect(gateSources).not.toMatch(
      /publication_relationships|RIGHTS_PARTY|LICENSOR|LICENSEE|EVIDENCE_PENDING/iu,
    );
    const catalog = source('packages/db/src/catalog-repository.ts');
    expect(catalog).not.toMatch(/aiDisclosure|ai_disclosure|copyright|版权/iu);
    expect(catalog.match(/publication_relationships/gu)).toHaveLength(1);
    const migration = source('packages/db/src/migrations.ts');
    const relationshipContract =
      migration.match(/CREATE TABLE publication_relationships \([\s\S]*?\) STRICT;/u)?.[0] ?? '';
    expect(relationshipContract).toContain('OBSERVED_UNVERIFIED');
    expect(relationshipContract).toContain('USER_CONFIRMED');
    expect(relationshipContract).toContain('EVIDENCE_PENDING');
    expect(relationshipContract).not.toContain('EVIDENCE_CONFIRMED');
  });
});
