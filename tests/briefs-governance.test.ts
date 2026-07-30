import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const INSTRUCTION = 'M3-Issue024-structured-content-brief-generator-Codex-instruction.txt';

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

describe('M3 Issue 024 Content Brief architecture and governance', () => {
  it('archives exactly one Issue 024 instruction under docs/instructions/m3', () => {
    expect(existsSync(join(ROOT, 'docs/instructions/m3', INSTRUCTION))).toBe(true);
    expect(existsSync(join(ROOT, INSTRUCTION))).toBe(false);
    expect(
      readdirSync(join(ROOT, 'docs/instructions/m3')).filter((entry) => entry === INSTRUCTION),
    ).toHaveLength(1);
  });

  it('keeps the production renderer DTO-only and excludes privileged or sensitive data', () => {
    const renderer = source('apps/web-ui/src/content-production-page.tsx');
    const dto = source('packages/shared/src/brief-contracts.ts');
    expect(renderer).not.toContain('dangerouslySetInnerHTML');
    expect(renderer).not.toMatch(
      /from ['"](?:node:|electron|@mystery-operations\/(?:briefs|db|dossier|evidence|workflows|storage|providers))|process\.env|sqlite|credential|api.?key|rawResponse|absolutePath|managedPath/iu,
    );
    expect(renderer.match(/from ['"]@mystery-operations\/shared['"]/gu)).toHaveLength(1);
    expect(dto).not.toMatch(
      /rawResponse|evidenceBody|dossierBody|sourceBody|absolutePath|managedPath|credential|leaseToken|internalPrediction/iu,
    );
  });

  it('keeps structured generation behind ModelExecutionService with zero direct egress or credential access', () => {
    const workflow = source('packages/workflows/src/content-brief-generation-handler.ts');
    const implementation = [
      treeSource('packages/briefs/src'),
      source('packages/db/src/brief-repository.ts'),
      source('apps/desktop/src/brief-runtime.ts'),
      workflow,
    ].join('\n');
    expect(workflow).toContain('ModelExecutionService');
    expect(implementation).not.toMatch(
      /from ['"](?:node:)?(?:http|https|net|tls|dns)|\bfetch\s*\(|process\.env|CredentialStore|resolveCredential|api.?key/iu,
    );
    expect(source('packages/db/src/brief-repository.ts')).not.toMatch(
      /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:drafts|assets|quality_checks|approvals|post_packages|publications)\b/iu,
    );
  });

  it('excludes internal prediction, AI disclosure, copyright and publication ownership from Brief policy', () => {
    const policy = [
      treeSource('packages/briefs/src'),
      source('packages/shared/src/brief-contracts.ts'),
      source('packages/db/src/brief-repository.ts'),
      source('apps/web-ui/src/content-production-page.tsx'),
    ].join('\n');
    expect(policy).not.toMatch(
      /INTERNAL_PREDICTION|internalPrediction|internal_prediction|aiDisclosure|ai_disclosure|copyright|版权|publicationRelationship|publication_relationship|RIGHTS_PARTY|LICENSOR|LICENSEE/iu,
    );
  });

  it('keeps v17 storage bounded and free of full research bodies, secrets and arbitrary paths', () => {
    const migrations = source('packages/db/src/migrations.ts');
    const issue024 = migrations.slice(
      migrations.indexOf('const STRUCTURED_CONTENT_BRIEF_GENERATOR'),
    );
    expect(issue024).toContain('content_brief_versions');
    expect(issue024).toContain('content_brief_generation_runs');
    expect(issue024).not.toMatch(
      /\b(?:api_key|secret|credential|raw_response|request_headers|response_headers|absolute_path|managed_path|dossier_body|source_body|evidence_body|full_text|draft_body|internal_prediction)\b/iu,
    );
    expect(issue024).not.toMatch(
      /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:drafts|assets|quality_checks|approvals|post_packages|publications)\b/iu,
    );
  });

  it('runs one dedicated Brief suite in full discovery and Windows CI', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const command = packageJson.scripts['test:briefs'] ?? '';
    for (const file of [
      'tests/briefs-authenticity-gold.test.ts',
      'tests/briefs-migration.test.ts',
      'tests/briefs-generation.test.ts',
      'tests/briefs-runtime-ipc.test.ts',
      'tests/briefs-renderer.test.tsx',
      'tests/briefs-governance.test.ts',
    ]) {
      expect(command).toContain(file);
    }
    expect(packageJson.scripts.test).toBe('node scripts/run-portable-vitest.mjs run');
    expect(source('.github/workflows/ci.yml').match(/npm run test:briefs/gu)).toHaveLength(1);
    expect(source('vite.main.config.ts')).toContain("'@mystery-operations/briefs'");
  });

  it('tracks all contracts, ADR, plan, acceptance, evidence and factual progress', () => {
    for (const path of [
      'docs/contracts/content-brief-v1.md',
      'docs/contracts/content-brief-generation-v1.md',
      'docs/contracts/content-brief-readiness-v1.md',
      'docs/adr/0020-structured-content-brief-generator.md',
      'docs/m3-issue024-implementation-plan.md',
      'docs/m3-issue024-acceptance-map.md',
      'docs/evidence/m3-issue024-local-evidence.md',
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
    for (const path of [
      'README.md',
      'AGENTS.md',
      'docs/README.md',
      'docs/product/xiaohongshu-development-roadmap-v1.md',
      'docs/instructions/README.md',
    ]) {
      expect(source(path), path).toMatch(/Issue 024.*(?:已完成|完成)|已完成.*Issue 024/isu);
      expect(source(path), path).toMatch(/Issue 025/iu);
    }
  });
});
