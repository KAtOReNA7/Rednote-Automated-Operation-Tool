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
const workflowSource = readFileSync(workflowPath, 'utf8');
const workflow = parse(workflowSource) as Workflow;
const windowsJob = workflow.jobs['windows-required'];

describe('Windows CI configuration', () => {
  it('defines a non-optional Windows required job', () => {
    expect(windowsJob).toBeDefined();
    expect(windowsJob?.['runs-on']).toBe('windows-latest');
    expect(windowsJob?.['continue-on-error']).not.toBe(true);
  });

  it('runs install, all gates, database suites, constraint suites, and dependency audit', () => {
    const commands = windowsJob?.steps
      .map((step) => step.run)
      .filter((command): command is string => command !== undefined)
      .join('\n');

    for (const command of [
      'npm ci',
      'npm run format-check',
      'npm run lint',
      'npm run typecheck',
      'npm run test:constraints',
      'npm run test:db',
      'npm run test:queue',
      'npm run test:storage',
      'npm run test:desktop',
      'npm run test:settings',
      'npm run test:local-api',
      'npm run test:portability',
      'npm run test:providers',
      'npm run test:capabilities',
      'npm run test:electron-smoke',
      'npm run test',
      'npm run build',
      'npm run package:desktop',
      'npm run test:packaged-smoke',
      'npm run audit:dependencies',
    ]) {
      expect(commands).toContain(command);
    }
  });

  it('uses least-privilege permissions and does not expose workflow environment values', () => {
    expect(workflow.permissions).toEqual({ contents: 'read' });
    expect(workflow.env).toBeUndefined();
    expect(windowsJob?.env).toBeUndefined();
    expect(workflowSource).not.toMatch(/secrets\.|\$env:/iu);
  });
});
