import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const INSTRUCTION = 'M3-Issue023-versioned-experiment-management-Codex-instruction.txt';

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

describe('M3 Issue 023 experiment architecture and governance', () => {
  it('archives exactly one Issue 023 instruction under docs/instructions/m3', () => {
    expect(existsSync(join(ROOT, 'docs/instructions/m3', INSTRUCTION))).toBe(true);
    expect(existsSync(join(ROOT, INSTRUCTION))).toBe(false);
    expect(
      readdirSync(join(ROOT, 'docs/instructions/m3')).filter((entry) => entry === INSTRUCTION),
    ).toHaveLength(1);
  });

  it('keeps the experiment renderer DTO-only and excludes privileged or sensitive data', () => {
    const renderer = source('apps/web-ui/src/experiment-management-page.tsx');
    const dto = source('packages/shared/src/experiment-contracts.ts');
    expect(renderer).not.toContain('dangerouslySetInnerHTML');
    expect(renderer).not.toMatch(
      /from ['"](?:node:|electron|@mystery-operations\/(?:experiments|db|dossier|evidence|workflows|storage))|process\.env|sqlite|credential|api.?key|rawResponse|absolutePath|managedPath/iu,
    );
    expect(renderer.match(/from ['"]@mystery-operations\/shared['"]/gu)).toHaveLength(1);
    expect(dto).not.toMatch(
      /rawResponse|evidenceBody|dossierBody|absolutePath|credential|leaseToken|numeratorValue|denominatorValue|baselineValue|effectSize|pValue/iu,
    );
  });

  it('keeps validation, assignment, persistence, and runtime at zero business egress and credential access', () => {
    const implementation = [
      treeSource('packages/experiments/src'),
      source('packages/db/src/experiment-repository.ts'),
      source('apps/desktop/src/experiment-runtime.ts'),
    ].join('\n');
    expect(implementation).not.toMatch(
      /from ['"](?:node:)?(?:http|https|net|tls|dns)|\bfetch\s*\(|process\.env|CredentialStore|resolveCredential|ModelExecutionService|api.?key/iu,
    );
    expect(source('packages/db/src/experiment-repository.ts')).not.toMatch(
      /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+(?:content_briefs|drafts|assets|quality_checks|approvals|post_packages|publications)\b/iu,
    );
  });

  it('does not couple AI disclosure, copyright, ownership, or internal prediction to experiment policy', () => {
    const policy = [
      treeSource('packages/experiments/src'),
      source('packages/shared/src/experiment-contracts.ts'),
      source('packages/db/src/experiment-repository.ts'),
    ].join('\n');
    expect(policy).not.toMatch(
      /aiDisclosure|ai_disclosure|copyright|版权|publicationRelationship|publication_relationship|RIGHTS_PARTY|LICENSOR|LICENSEE|systemPrediction|internalPrediction/iu,
    );
  });

  it('stores definitions and future availability, never real outcomes or statistical conclusions', () => {
    const migration = source('packages/db/src/migrations.ts');
    const issue023 = migration.slice(migration.indexOf('const VERSIONED_EXPERIMENT_MANAGEMENT'));
    expect(issue023).toContain('experiment_design_versions');
    expect(issue023).toContain('experiment_assignment_plans');
    expect(issue023).not.toMatch(
      /\b(?:numerator_value|denominator_value|baseline_value|effect_size|p_value|confidence_interval|statistical_power|uplift_value|winner_arm_id)\b/iu,
    );
    expect(issue023).not.toMatch(/'RUNNING'|'COMPLETED'|'WINNER'/u);
  });

  it('runs one dedicated experiment suite in full discovery and Windows CI', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const command = packageJson.scripts['test:experiments'] ?? '';
    for (const file of [
      'tests/experiments-gold.test.ts',
      'tests/experiments-capacity.test.ts',
      'tests/experiments-invalidation.test.ts',
      'tests/experiments-renderer.test.tsx',
      'tests/experiments-governance.test.ts',
    ]) {
      expect(command).toContain(file);
    }
    expect(packageJson.scripts.test).toBe('node scripts/run-portable-vitest.mjs run');
    expect(source('.github/workflows/ci.yml').match(/npm run test:experiments/gu)).toHaveLength(1);
  });

  it('tracks all contracts, ADR, plan, acceptance, evidence, and factual progress', () => {
    for (const path of [
      'docs/contracts/experiment-design-v1.md',
      'docs/contracts/experiment-assignment-v1.md',
      'docs/contracts/experiment-metrics-v1.md',
      'docs/adr/0019-versioned-single-variable-experiments.md',
      'docs/m3-issue023-implementation-plan.md',
      'docs/m3-issue023-acceptance-map.md',
      'docs/evidence/m3-issue023-local-evidence.md',
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
      expect(source(path), path).toMatch(/Issue 023.*(?:已完成|完成)|已完成.*Issue 023/isu);
      expect(source(path), path).toMatch(/Issue 024/iu);
    }
  });
});
