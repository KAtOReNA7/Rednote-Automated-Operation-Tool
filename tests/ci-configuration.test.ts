import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface WorkflowStep {
  readonly run?: string;
  readonly uses?: string;
}

interface WorkflowJob {
  readonly 'continue-on-error'?: boolean;
  readonly 'runs-on': string;
  readonly env?: Record<string, string>;
  readonly steps: readonly WorkflowStep[];
}

interface Workflow {
  readonly env?: Record<string, string>;
  readonly jobs: Record<string, WorkflowJob>;
  readonly permissions?: Record<string, string>;
}

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const workflowPath = resolve(repositoryRoot, '.github/workflows/ci.yml');
const packagePath = resolve(repositoryRoot, 'package.json');
const workflowSource = readFileSync(workflowPath, 'utf8');
const workflow = parse(workflowSource) as Workflow;
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const windowsJob = workflow.jobs['windows-required'];
const runCommands =
  windowsJob?.steps
    .map((step) => step.run?.trim())
    .filter((command): command is string => command !== undefined) ?? [];

describe('Windows CI configuration', () => {
  it('defines a non-optional Windows required job', () => {
    expect(windowsJob).toBeDefined();
    expect(windowsJob?.['runs-on']).toBe('windows-latest');
    expect(windowsJob?.['continue-on-error']).not.toBe(true);
  });

  it('runs the release environment gates around one complete Vitest suite', () => {
    for (const command of [
      'npm ci',
      'npm run format-check',
      'npm run lint',
      'npm run typecheck',
      'npm run test',
      'npm run test:electron-smoke',
      'npm run build',
      'npm run package:desktop',
      'npm run package:clipper',
      'npm run test:packaged-smoke',
      'npm run audit:dependencies',
      'npm run test:installer-lifecycle',
    ]) {
      expect(runCommands).toContain(command);
    }
  });

  it('builds and uploads only an exact-head R10D installer artifact', () => {
    expect(workflowSource).toContain('npm run package:installer');
    expect(workflowSource).toContain('rednote-r10d-windows-installer-$shortSha');
    expect(workflowSource).toContain('out/installer-bundle/');
    expect(workflowSource).toContain('retention-days: 14');
  });

  it('does not schedule overlapping specialized Vitest selectors before the full suite', () => {
    const vitestScripts = new Set(
      Object.entries(packageJson.scripts)
        .filter(([, command]) => command.includes('run-portable-vitest.mjs'))
        .map(([name]) => name),
    );
    const scheduledNpmScripts = runCommands.flatMap((command) => {
      const match = /^npm run ([\w:-]+)$/u.exec(command);
      return match?.[1] === undefined ? [] : [match[1]];
    });

    expect(scheduledNpmScripts.filter((name) => vitestScripts.has(name))).toEqual(['test']);
    expect(runCommands.filter((command) => command === 'npm run test')).toHaveLength(1);
    expect(packageJson.scripts['test:constraints']).toContain('tests/agents-governance.test.ts');
    expect(packageJson.scripts['test:fact-mapping']).toContain(
      'tests/fact-mapping-governance.test.ts',
    );
  });

  it('uses least-privilege permissions and does not expose workflow environment values', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.env).toBeUndefined();
    expect(windowsJob?.env).toBeUndefined();
    expect(workflowSource).not.toMatch(/secrets\.|\$env:/iu);
  });
});
