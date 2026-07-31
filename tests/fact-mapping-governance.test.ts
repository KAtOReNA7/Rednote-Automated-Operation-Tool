import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const INSTRUCTION = 'M3-Issue026-factual-claim-mapping-Codex-instruction.txt';

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

describe('M3 Issue 026 architecture, egress and governance', () => {
  it('archives exactly one Issue 026 instruction under docs/instructions/m3', () => {
    expect(existsSync(join(ROOT, 'docs/instructions/m3', INSTRUCTION))).toBe(true);
    expect(existsSync(join(ROOT, INSTRUCTION))).toBe(false);
    expect(
      readdirSync(join(ROOT, 'docs/instructions/m3')).filter((entry) => entry === INSTRUCTION),
    ).toHaveLength(1);
  });

  it('keeps the renderer DTO-only and excludes privileged or sensitive data', () => {
    const renderer = source('apps/web-ui/src/fact-mapping-workbench.tsx');
    const dto = source('packages/shared/src/quality-contracts.ts');
    expect(renderer).not.toContain('dangerouslySetInnerHTML');
    expect(renderer).not.toMatch(
      /from ['"](?:node:|electron|@mystery-operations\/(?:quality|db|copy|briefs|evidence|workflows|storage|providers))|process\.env|sqlite|credential(?:Value|Ref|Token|Secret)|api.?key|rawResponse|absolutePath|managedPath/iu,
    );
    expect(renderer.match(/from ['"]@mystery-operations\/shared['"]/gu)).toHaveLength(1);
    expect(dto).not.toMatch(
      /sourceBody|fullSource|absolutePath|managedPath|credential(?:Value|Ref|Token|Secret)|leaseToken|Authorization|rawRequest|rawResponse|internalPrediction/iu,
    );
  });

  it('keeps optional assistance behind ModelExecutionService with no direct egress', () => {
    const workflow = source('packages/workflows/src/fact-mapping-handler.ts');
    const implementation = [
      treeSource('packages/quality/src'),
      source('packages/db/src/fact-mapping-repository.ts'),
      source('apps/desktop/src/fact-mapping-runtime.ts'),
      workflow,
    ].join('\n');
    expect(workflow).toContain('ModelExecutionService');
    expect(implementation).not.toMatch(
      /from ['"](?:node:)?(?:http|https|net|tls|dns)|\bfetch\s*\(|process\.env|CredentialStore|resolveCredential|api.?key/iu,
    );
    expect(workflow).toContain('webSearchCalls: 0');
    expect(workflow).toContain('toolCalls: 0');
  });

  it('writes only FACT_MAPPING, quality summary and bounded queue/model records', () => {
    const repository = source('packages/db/src/fact-mapping-repository.ts');
    expect(repository).not.toMatch(
      /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:sources|source_revisions|claims|claim_evidence|fact_evaluations|fact_conflicts|resolution_decisions|catalog_|research_dossiers|reading_states|experience_assertions|topics|experiment_|content_brief_|content_draft_versions|content_draft_blocks|content_draft_field_states|assets|approvals|post_packages|publications|metric_snapshots|strategy_decisions)\b/iu,
    );
    expect(repository).toMatch(/INSERT\s+INTO\s+quality_checks/iu);
    expect(repository).toMatch(/INSERT\s+INTO\s+fact_mapping_/iu);
  });

  it('keeps downstream Issues, AI disclosure and copyright outside this check', () => {
    const production = [
      treeSource('packages/quality/src'),
      source('packages/shared/src/quality-contracts.ts'),
      source('packages/db/src/fact-mapping-repository.ts'),
      source('apps/web-ui/src/fact-mapping-workbench.tsx'),
    ].join('\n');
    expect(production).not.toMatch(
      /INTERNAL_PREDICTION|internalPrediction|aiDisclosure|ai_disclosure|copyright|版权/iu,
    );
    expect(source('apps/web-ui/src/fact-mapping-workbench.tsx')).not.toMatch(
      /生成图片|审批队列|导出发布包|自动发布|强制通过/u,
    );
  });

  it('keeps v19 bounded and free of secrets, raw payloads and downstream writes', () => {
    const migrations = source('packages/db/src/migrations.ts');
    const issue026 = migrations.slice(migrations.indexOf('const FACTUAL_CLAIM_MAPPING'));
    expect(issue026).toContain('fact_mapping_check_versions');
    expect(issue026).toContain('fact_mapping_dependencies');
    expect(issue026).not.toMatch(
      /\b(?:api_key|secret|credential_value|authorization_header|raw_request|raw_response|absolute_path|managed_path|source_body|evidence_body|full_text|internal_prediction)\b/iu,
    );
    expect(issue026).not.toMatch(
      /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:assets|approvals|post_packages|publications|metric_snapshots|strategy_decisions)\b/iu,
    );
  });

  it('runs one dedicated suite in full discovery and Windows CI', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const command = packageJson.scripts['test:fact-mapping'] ?? '';
    for (const file of [
      'tests/fact-mapping-contracts.test.ts',
      'tests/fact-mapping-policy.test.ts',
      'tests/fact-mapping-gold.test.ts',
      'tests/fact-mapping-manual.test.ts',
      'tests/fact-mapping-migration.test.ts',
      'tests/fact-mapping-repository.test.ts',
      'tests/fact-mapping-workflow.test.ts',
      'tests/fact-mapping-capacity.test.ts',
      'tests/fact-mapping-runtime-ipc.test.ts',
      'tests/fact-mapping-renderer.test.tsx',
      'tests/fact-mapping-governance.test.ts',
    ]) {
      expect(command).toContain(file);
    }
    expect(packageJson.scripts.test).toBe('node scripts/run-portable-vitest.mjs run');
    const ci = source('.github/workflows/ci.yml');
    expect(ci).not.toContain('npm run test:fact-mapping');
    expect(ci.match(/^\s*run:\s+npm run test\s*$/gmu)).toHaveLength(1);
    expect(source('vite.main.config.ts')).toContain("'@mystery-operations/quality'");
  });

  it('tracks every contract, ADR, plan, acceptance, evidence and egress file', () => {
    for (const path of [
      'docs/contracts/draft-statement-v1.md',
      'docs/contracts/fact-mapping-v1.md',
      'docs/contracts/fact-mapping-quality-check-v1.md',
      'docs/adr/0022-factual-claim-mapping.md',
      'docs/m3-issue026-implementation-plan.md',
      'docs/m3-issue026-acceptance-map.md',
      'docs/evidence/m3-issue026-local-evidence.md',
      'docs/security/m3-issue026-egress-matrix.md',
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
      const progress = source(path);
      expect(progress, path).toMatch(
        /Issue 026.*(?:已完成|完成)|已完成.*Issue 026|Issue 022—026 已完成/isu,
      );
      expect(progress, path).toMatch(/Issue 027/iu);
    }
  });
});
