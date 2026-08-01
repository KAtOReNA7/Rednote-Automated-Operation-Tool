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

describe('M3 Issue 022 Topic architecture and governance', () => {
  it('archives exactly one Issue 022 instruction under docs/instructions/m3', () => {
    const name = 'M3-Issue022-topic-pool-first-30-quota-Codex-instruction.txt';
    expect(existsSync(join(ROOT, 'docs/instructions/m3', name))).toBe(true);
    expect(existsSync(join(ROOT, name))).toBe(false);
    expect(
      readdirSync(join(ROOT, 'docs/instructions/m3')).filter((entry) => entry === name),
    ).toHaveLength(1);
  });

  it('keeps the renderer DTO-only and excludes Node, SQLite, raw research, paths, credentials, and internal prediction', () => {
    const renderer = source('apps/web-ui/src/topic-pool-page.tsx');
    const dto = source('packages/shared/src/topic-contracts.ts');
    expect(renderer).not.toContain('dangerouslySetInnerHTML');
    expect(renderer).not.toMatch(
      /from ['"](?:node:|electron|@mystery-operations\/(?:topics|db|dossier|evidence|workflows|storage))|process\.env|sqlite|credential|api.?key|rawResponse|absolutePath|managedPath/iu,
    );
    expect(dto).not.toMatch(
      /systemPrediction|rawResponse|evidenceBody|dossierBody|absolutePath|credential|leaseToken/iu,
    );
  });

  it('keeps Topic generation, ranking, quota, persistence, and runtime at zero business egress and zero credential access', () => {
    const implementation = [
      treeSource('packages/topics/src'),
      source('packages/db/src/topic-repository.ts'),
      source('packages/workflows/src/topic-planning-handler.ts'),
      source('apps/desktop/src/topic-runtime.ts'),
    ].join('\n');
    expect(implementation).not.toMatch(
      /from ['"](?:node:)?(?:http|https|net|tls|dns)|\bfetch\s*\(|process\.env|CredentialStore|resolveCredential|ModelExecutionService|api.?key/iu,
    );
    expect(implementation).not.toMatch(
      /INSERT\s+INTO\s+(?:experiments|content_briefs|drafts|quality_checks|approvals|post_packages|publications)\b/iu,
    );
  });

  it('does not couple AI, copyright, publication ownership, or fabricated platform signals to eligibility or ranking', () => {
    const policy = [
      source('packages/topics/src/contracts.ts'),
      source('packages/topics/src/policy.ts'),
      source('packages/topics/src/quota.ts'),
    ].join('\n');
    expect(policy).not.toMatch(
      /aiDisclosure|ai_disclosure|copyright|版权|publicationRelationship|publication_relationship|RIGHTS_PARTY|LICENSOR|LICENSEE|viralScore|trendScore|platformRecommendation/iu,
    );
  });

  it('stores no secret, raw body, arbitrary path, full dossier, or model response in v15 tables', () => {
    const migration = source('packages/db/src/migrations.ts');
    const issue022 = migration.slice(migration.indexOf('const TOPIC_POOL_AND_FIRST_30_QUOTA'));
    expect(issue022).not.toMatch(
      /\b(?:api_key|secret|credential|raw_response|request_headers|response_headers|absolute_path|dossier_body|evidence_body|full_text|draft_body)\b/iu,
    );
    expect(issue022).toContain('topic_candidate_versions');
    expect(issue022).toContain('topic_quota_plan_versions');
    expect(issue022).toContain('topic_generation_runs');
  });

  it('keeps one dedicated Topic suite while Windows CI schedules full discovery once', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    expect(packageJson.scripts['test:topics']).toContain('tests/topics-governance.test.ts');
    expect(packageJson.scripts['test:topics']).toContain('tests/topics-renderer.test.tsx');
    expect(packageJson.scripts.test).toBe('node scripts/run-portable-vitest.mjs run');
    const ci = source('.github/workflows/ci.yml');
    expect(ci).not.toContain('npm run test:topics');
    expect(ci.match(/^\s*run:\s+npm run test\s*$/gmu)).toHaveLength(1);
  });

  it('tracks contracts, ADR, plan and acceptance map', () => {
    for (const path of [
      'docs/contracts/topic-pool-v1.md',
      'docs/contracts/topic-ranking-quota-v1.md',
      'docs/adr/0018-topic-pool-first-30-quota.md',
      'docs/m3-issue022-implementation-plan.md',
      'docs/m3-issue022-acceptance-map.md',
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
  });
});
