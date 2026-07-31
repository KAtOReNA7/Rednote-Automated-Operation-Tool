import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import { CAPACITY_TEST_FILES, NORMAL_TEST_EXCLUDES } from '../vitest.config.js';

const projectRoot = resolve(import.meta.dirname, '..');

async function discoverTests(directory = 'tests'): Promise<readonly string[]> {
  const entries = await readdir(join(projectRoot, directory), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const child = `${directory}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await discoverTests(child)));
    else if (/\.test\.tsx?$/u.test(entry.name)) files.push(child);
  }
  return files.sort();
}

describe('validation reliability governance', () => {
  it('keeps normal and capacity files complete, explicit and disjoint', async () => {
    const allTests = await discoverTests();
    const capacity = new Set<string>(CAPACITY_TEST_FILES);
    const normalExcludes = new Set<string>(NORMAL_TEST_EXCLUDES);
    const normal = allTests.filter((file) => !normalExcludes.has(file));

    expect(capacity.size).toBe(CAPACITY_TEST_FILES.length);
    expect(normalExcludes).toEqual(capacity);
    expect(CAPACITY_TEST_FILES).toContain('tests/fact-mapping-capacity.test.ts');
    expect(CAPACITY_TEST_FILES).toContain('tests/queue-worker.test.ts');
    expect(
      allTests.filter((file) => /(?:capacity|performance).*\.test\.tsx?$/u.test(file)),
    ).toEqual(
      expect.arrayContaining([...capacity].filter((file) => /capacity|performance/u.test(file))),
    );
    for (const file of CAPACITY_TEST_FILES) expect(allTests).toContain(file);
    expect(normal.filter((file) => capacity.has(file))).toEqual([]);
    expect(normal).toHaveLength(allTests.length - capacity.size);
  });

  it('uses observable named package entries without changing timeouts', async () => {
    const manifest = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    const runner = await readFile(join(projectRoot, 'scripts/run-portable-vitest.mjs'), 'utf8');
    const config = await readFile(join(projectRoot, 'vitest.config.ts'), 'utf8');

    expect(manifest.scripts.test).toBe('node scripts/run-portable-vitest.mjs run');
    expect(manifest.scripts['test:capacity']).toContain('--observable --suite=capacity run');
    expect(manifest.scripts.check).toContain('npm run test && npm run test:capacity');
    for (const evidence of [
      'stdout.log',
      'stderr.log',
      'results.json',
      'startedAt',
      'endedAt',
      'exitCode',
    ]) {
      expect(runner).toContain(evidence);
    }
    expect(config).toContain("fileParallelism: selectedSuite !== 'capacity'");
    expect(config).not.toContain('testTimeout');
  });

  it('schedules exactly one normal and one capacity signal in Windows CI', async () => {
    const workflow = parse(
      await readFile(join(projectRoot, '.github/workflows/ci.yml'), 'utf8'),
    ) as {
      readonly jobs: Readonly<
        Record<string, { readonly steps: readonly { readonly run?: string }[] }>
      >;
    };
    const runs = workflow.jobs['windows-required']?.steps
      .map(({ run }) => run)
      .filter((run): run is string => typeof run === 'string');

    expect(runs?.filter((run) => run === 'npm run test')).toHaveLength(1);
    expect(
      runs?.filter(
        (run) => run === 'node scripts/run-portable-vitest.mjs --observable --suite=capacity run',
      ),
    ).toHaveLength(1);
    expect(
      runs?.some((run) =>
        /npm run test:(?:bibliography|dossier|evidence|experiments|fact-mapping|queue|search|storage|topics)$/u.test(
          run,
        ),
      ),
    ).toBe(false);
  });

  it('keeps one authoritative failure taxonomy and a reference-only template', async () => {
    const agents = await readFile(join(projectRoot, 'AGENTS.md'), 'utf8');
    const template = await readFile(
      join(projectRoot, 'docs/governance/future-issue-instruction-template.md'),
      'utf8',
    );
    for (const classification of [
      'PRODUCT_OR_TEST_FAILURE',
      'INFRASTRUCTURE_FAILURE',
      'OBSERVABILITY_FAILURE',
    ]) {
      expect(agents.match(new RegExp('`' + classification + '`', 'gu'))).toHaveLength(1);
      expect(template).not.toContain(classification);
    }
    expect(agents).toContain('每次失败后必须产生新定位或对应修改');
    expect(agents).toContain('真实 exit code 与起止时间');
    expect(template).toContain('只引用 `AGENTS.md` 第 9 节唯一权威定义');
  });
});
