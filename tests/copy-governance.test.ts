import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const INSTRUCTION = 'M3-Issue025-versioned-copy-generation-Codex-instruction.txt';

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

describe('M3 Issue 025 Copy architecture and governance', () => {
  it('archives exactly one Issue 025 instruction under docs/instructions/m3', () => {
    expect(existsSync(join(ROOT, 'docs/instructions/m3', INSTRUCTION))).toBe(true);
    expect(existsSync(join(ROOT, INSTRUCTION))).toBe(false);
    expect(
      readdirSync(join(ROOT, 'docs/instructions/m3')).filter((entry) => entry === INSTRUCTION),
    ).toHaveLength(1);
  });

  it('keeps the copy renderer DTO-only and excludes privileged or sensitive data', () => {
    const renderer = source('apps/web-ui/src/copy-workbench.tsx');
    const dto = source('packages/shared/src/copy-contracts.ts');
    expect(renderer).not.toContain('dangerouslySetInnerHTML');
    expect(renderer).not.toMatch(
      /from ['"](?:node:|electron|@mystery-operations\/(?:copy|db|briefs|workflows|storage|providers))|process\.env|sqlite|credential|api.?key|rawResponse|absolutePath|managedPath/iu,
    );
    expect(renderer.match(/from ['"]@mystery-operations\/shared['"]/gu)).toHaveLength(1);
    expect(dto).not.toMatch(
      /rawResponse|evidenceBody|dossierBody|sourceBody|absolutePath|managedPath|credential|leaseToken|internalPrediction/iu,
    );
  });

  it('keeps generation behind ModelExecutionService with no direct egress or credential access', () => {
    const workflow = source('packages/workflows/src/copy-generation-handler.ts');
    const implementation = [
      treeSource('packages/copy/src'),
      source('packages/db/src/copy-repository.ts'),
      source('apps/desktop/src/copy-runtime.ts'),
      workflow,
    ].join('\n');
    expect(workflow).toContain('ModelExecutionService');
    expect(implementation).not.toMatch(
      /from ['"](?:node:)?(?:http|https|net|tls|dns)|\bfetch\s*\(|process\.env|CredentialStore|resolveCredential|api.?key/iu,
    );
    expect(source('packages/db/src/copy-repository.ts')).not.toMatch(
      /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:assets|quality_checks|approvals|post_packages|publications)\b/iu,
    );
  });

  it('keeps decision fields and future quality stages outside Copy production contracts', () => {
    const production = [
      treeSource('packages/copy/src'),
      source('packages/shared/src/copy-contracts.ts'),
      source('packages/db/src/copy-repository.ts'),
      source('apps/web-ui/src/copy-workbench.tsx'),
    ].join('\n');
    expect(production).not.toMatch(
      /INTERNAL_PREDICTION|internalPrediction|internal_prediction|aiDisclosure|ai_disclosure|copyright|版权/iu,
    );
    expect(production).not.toMatch(
      /\b(?:QUALITY_PASSED|FACT_CHECKED|AUTHENTICITY_CHECKED|STYLE_CHECKED|APPROVED|PUBLISHABLE)\b/u,
    );
  });

  it('keeps v18 bounded and free of downstream writes, secrets and arbitrary paths', () => {
    const migrations = source('packages/db/src/migrations.ts');
    const issue025 = migrations.slice(
      migrations.indexOf('const VERSIONED_COPY_GENERATION'),
      migrations.indexOf('const FACTUAL_CLAIM_MAPPING'),
    );
    expect(issue025).toContain('content_draft_versions');
    expect(issue025).toContain('content_draft_mutation_runs');
    expect(issue025).not.toMatch(
      /\b(?:api_key|secret|credential|raw_response|request_headers|response_headers|absolute_path|managed_path|dossier_body|source_body|evidence_body|full_text|internal_prediction)\b/iu,
    );
    expect(issue025).not.toMatch(
      /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:assets|quality_checks|approvals|post_packages|publications)\b/iu,
    );
  });

  it('runs one dedicated Copy suite in full discovery and Windows CI', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const command = packageJson.scripts['test:copy'] ?? '';
    for (const file of [
      'tests/copy-contracts.test.ts',
      'tests/copy-migration.test.ts',
      'tests/copy-generation.test.ts',
      'tests/copy-runtime-ipc.test.ts',
      'tests/copy-renderer.test.tsx',
      'tests/copy-governance.test.ts',
    ]) {
      expect(command).toContain(file);
    }
    expect(packageJson.scripts.test).toBe('node scripts/run-portable-vitest.mjs run');
    const ci = source('.github/workflows/ci.yml');
    expect(ci).not.toContain('npm run test:copy');
    expect(ci.match(/^\s*run:\s+npm run test\s*$/gmu)).toHaveLength(1);
    expect(source('vite.main.config.ts')).toContain("'@mystery-operations/copy'");
  });

  it('tracks every required contract, ADR, plan, acceptance and evidence file', () => {
    for (const path of [
      'docs/contracts/copy-generation-v1.md',
      'docs/contracts/copy-rewrite-v1.md',
      'docs/contracts/draft-structure-v1.md',
      'docs/adr/0021-versioned-copy-generation.md',
      'docs/m3-issue025-implementation-plan.md',
      'docs/m3-issue025-acceptance-map.md',
      'docs/evidence/m3-issue025-local-evidence.md',
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
  });
});
