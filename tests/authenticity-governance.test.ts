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

describe('Issue 021 authenticity architecture and governance', () => {
  it('archives exactly one Issue 021 instruction under docs/instructions/m2', () => {
    const name = 'M2-Issue021-reading-authenticity-policy-Codex-instruction.txt';
    expect(existsSync(join(ROOT, 'docs/instructions/m2', name))).toBe(true);
    expect(existsSync(join(ROOT, name))).toBe(false);
    expect(
      readdirSync(join(ROOT, 'docs/instructions/m2')).filter((entry) => entry === name),
    ).toHaveLength(1);
  });

  it('keeps renderer DTO-only and excludes internal prediction, Node, SQLite and raw research', () => {
    const renderer = source('apps/web-ui/src/authenticity-library.tsx');
    const dto = source('packages/shared/src/authenticity-contracts.ts');
    expect(renderer).not.toContain('dangerouslySetInnerHTML');
    expect(renderer).not.toMatch(
      /from ['"](?:node:|electron|@mystery-operations\/(?:authenticity|db|dossier|evidence|workflows|storage))|process\.env|sqlite|credential|api.?key|rawResponse|snapshotPath|managedPath/iu,
    );
    expect(dto).not.toMatch(
      /systemPrediction|SYSTEM_PREDICTION_INTERNAL|rawResponse|evidenceBody|absolutePath|credential/iu,
    );
  });

  it('keeps authenticity evaluation and persistence at zero egress and zero model/secret access', () => {
    const implementation = [
      treeSource('packages/authenticity/src'),
      source('packages/db/src/authenticity-repository.ts'),
      source('apps/desktop/src/authenticity-runtime.ts'),
    ].join('\n');
    expect(implementation).not.toMatch(
      /from ['"](?:node:)?(?:http|https|net|tls|dns)|\bfetch\s*\(|process\.env|CredentialStore|resolveCredential|ModelExecutionService|api.?key/iu,
    );
    expect(implementation).not.toMatch(
      /kindle|epub|mobi|电子书正文|浏览器历史|购买记录|持有记录/iu,
    );
  });

  it('does not couple AI, copyright or publication relationships to authenticity policy', () => {
    const policy = `${source('packages/authenticity/src/contracts.ts')}\n${source(
      'packages/authenticity/src/policy.ts',
    )}`;
    expect(policy).not.toMatch(
      /aiDisclosure|ai_disclosure|copyright|版权|publicationRelationship|publication_relationship|RIGHTS_PARTY|LICENSOR|LICENSEE/iu,
    );
  });

  it('stores no secret, raw body, arbitrary path or ebook payload in Issue 021 tables', () => {
    const migration = source('packages/db/src/migrations.ts');
    const issue021 = migration.slice(migration.indexOf('const READING_AUTHENTICITY_POLICY'));
    expect(issue021).not.toMatch(
      /\b(?:api_key|secret|credential|raw_response|request_headers|response_headers|absolute_path|ebook_body|full_text|reading_note_body)\b/iu,
    );
    expect(issue021).toContain('system_prediction_scores');
    expect(issue021).toContain("purpose TEXT NOT NULL CHECK (purpose = 'INTERNAL_ORDERING_ONLY')");
  });

  it('keeps a dedicated suite while Windows CI schedules full discovery once', () => {
    const packageJson = JSON.parse(source('package.json')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    expect(packageJson.scripts['test:authenticity']).toContain(
      'tests/authenticity-governance.test.ts',
    );
    const ci = source('.github/workflows/ci.yml');
    expect(ci).not.toContain('npm run test:authenticity');
    expect(ci.match(/^\s*run:\s+npm run test\s*$/gmu)).toHaveLength(1);
    expect(packageJson.scripts.test).toBe('node scripts/run-portable-vitest.mjs run');
  });

  it('tracks contracts, ADR, plan, acceptance map and M2 closeout', () => {
    for (const path of [
      'docs/contracts/reading-authenticity-policy-v1.md',
      'docs/contracts/expression-permission-v1.md',
      'docs/contracts/spoiler-policy-v1.md',
      'docs/adr/0017-reading-authenticity-and-expression-permissions.md',
      'docs/m2-issue021-implementation-plan.md',
      'docs/m2-issue021-acceptance-map.md',
      'docs/m2-closeout.md',
    ]) {
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
  });
});
