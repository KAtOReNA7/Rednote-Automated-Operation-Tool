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
const clipperActionSource = readFileSync(
  resolve(repositoryRoot, 'scripts/trigger-clipper-action.ps1'),
  'utf8',
);
const workflow = parse(workflowSource) as Workflow;
const packageJson = JSON.parse(readFileSync(packagePath, 'utf8')) as {
  readonly scripts: Readonly<Record<string, string>>;
};
const v2Package = JSON.parse(
  readFileSync(resolve(repositoryRoot, 'packages/v2/package.json'), 'utf8'),
) as {
  readonly exports: {
    readonly '.': {
      readonly default: string;
      readonly 'rednote-runtime': string;
      readonly types: string;
    };
  };
  readonly main: string;
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
      'npm run test:clipper-real',
      'npm run test:packaged-smoke',
      'npm run audit:dependencies',
      'npm run package:release-candidate',
      'npm run test:installer-lifecycle',
    ]) {
      expect(runCommands).toContain(command);
    }
    expect(packageJson.scripts['test:clipper-real']).toContain(
      'node --conditions=rednote-runtime scripts/run-clipper-real-smoke.mjs',
    );
    expect(v2Package.main).toBe('./src/index.ts');
    expect(v2Package.exports['.']['rednote-runtime']).toBe('./dist/index.js');
    expect(v2Package.exports['.'].default).toBe('./src/index.ts');
    expect(v2Package.exports['.'].types).toBe('./dist/index.d.ts');
  });

  it('binds real Clipper actions to the exact browser UI Automation root', () => {
    expect(clipperActionSource).toContain('[void]$shell.AppActivate($BrowserProcessId)');
    expect(clipperActionSource).not.toContain(
      "throw 'Unable to activate the isolated browser window.'",
    );
    expect(clipperActionSource.indexOf('[void]$shell.AppActivate')).toBeLessThan(
      clipperActionSource.indexOf('[void][Issue017KeyboardInput]::AttachThreadInput'),
    );
    expect(clipperActionSource).not.toContain(
      "throw 'The isolated browser window did not become the exact foreground target.'",
    );
    expect(clipperActionSource).toContain('SendForegroundUnlock()');
    expect(clipperActionSource).toContain('$attempt -lt 5');
    expect(clipperActionSource).toMatch(
      /AutomationElement\]::FromHandle\(\r?\n\s+\$browser\.MainWindowHandle/u,
    );
    expect(clipperActionSource).toContain('browserRootDeadline');
    expect(clipperActionSource).toContain('ElementNotAvailableException');
    expect(clipperActionSource).toContain('Find-VisibleNameContaining');
    expect(clipperActionSource).toContain('[System.StringComparison]::OrdinalIgnoreCase');
    expect(clipperActionSource).toContain('$element.Current.AutomationId');
    expect(clipperActionSource).toContain('$diagnostics.Count -ge 24');
    const uiAutomationStart = clipperActionSource.indexOf(
      'Add-Type -AssemblyName UIAutomationClient',
    );
    expect(uiAutomationStart).toBeGreaterThan(-1);
    expect(clipperActionSource.slice(0, uiAutomationStart)).not.toContain(
      "if ($BrowserFamily -eq 'edge')",
    );
  });

  it('builds exact-head R10D and closed R10E candidate artifacts only after required inputs', () => {
    expect(workflowSource).toContain('npm run package:installer');
    expect(workflowSource).toContain('rednote-r10d-windows-installer-$shortSha');
    expect(workflowSource).toContain('out/installer-bundle/');
    expect(workflowSource).toContain('rednote-r10e-release-candidate-$shortSha');
    expect(workflowSource).toContain('out/r10e-release-assets/');
    expect(workflowSource).toContain('retention-days: 14');
    expect(workflowSource).toContain("REDNOTE_R10D_CI_FIXTURE: '1'");
    expect(workflowSource).toContain("REDNOTE_R10D_LIFECYCLE_FIXTURE: '1'");
    expect(workflowSource).toContain('R10D_CANONICAL_FIXTURE_MUTATED');
    expect(workflowSource).toContain('R10D_BETA0_INSTALLER_VERSION_OR_LAYOUT_INVALID');
    expect(workflowSource).toContain("TrimStart('\\', '/')");
    expect(workflowSource).not.toContain('r10d-beta0-staging');
    expect(workflowSource).not.toContain('Move-Item');
    expect(workflowSource).toContain('--cleanup-ci-temp');

    const fixture = workflowSource.indexOf('Build isolated R10D beta.0 lifecycle fixture');
    const candidate = workflowSource.indexOf('Package exact-head R10E release candidate');
    const lifecycle = workflowSource.indexOf('Run isolated R10D installer lifecycle');
    const candidateUpload = workflowSource.indexOf(
      'Upload exact-head R10E release candidate assets',
    );
    expect(fixture).toBeGreaterThan(0);
    expect(candidate).toBeGreaterThan(fixture);
    expect(lifecycle).toBeGreaterThan(candidate);
    expect(candidateUpload).toBeGreaterThan(lifecycle);
  });

  it('fails closed between each native R10D installer build phase', () => {
    const semanticBuild = runCommands.find((command) =>
      command.includes('scripts/compare-r10d-installer-samples.mjs'),
    );
    expect(semanticBuild).toContain("$ErrorActionPreference = 'Stop'");
    expect(semanticBuild).toContain('R10D_FIRST_INSTALLER_BUILD_FAILED:$LASTEXITCODE');
    expect(semanticBuild).toContain('R10D_SECOND_INSTALLER_BUILD_FAILED:$LASTEXITCODE');
    expect(semanticBuild).toContain('R10D_SEMANTIC_INSTALLER_COMPARE_FAILED:$LASTEXITCODE');
  });

  it('cleans only the verified CI temporary directory with bounded convergence', () => {
    const lifecycle = readFileSync(
      resolve(repositoryRoot, 'scripts', 'run-installer-lifecycle-smoke.mjs'),
      'utf8',
    );
    expect(lifecycle).toContain(
      "join(dirname(resolve(workspace)), '.rednote-temp', `ci-${runId}-${attempt}`)",
    );
    expect(lifecycle).toContain("await removeOwned(temporaryDirectory, 'ci-temp-cleanup')");
    expect(lifecycle).toContain('CLEANUP_TIMEOUT_MILLISECONDS');
    expect(lifecycle).toContain("'tasklist.exe'");
    expect(lifecycle).toContain('IMAGENAME eq ${WINDOWS_APPLICATION_EXECUTABLE}');
    expect(lifecycle).not.toContain('Get-Process -Name "RednoteMysteryOperations"');
    expect(lifecycle).toContain('WINDOWS_INSTALLER_GUID');
    expect(lifecycle).toContain('retryProbe(`${stage}-registry`, registryProbe)');
    expect(lifecycle).not.toContain('CurrentVersion\\Uninstall\\*');
    expect(lifecycle).not.toContain('Get-CimInstance');
    expect(lifecycle).toContain('L04-running-upgrade-app-ready');
    expect(lifecycle).toContain('L04-running-uninstall-app-ready');
    expect(lifecycle).not.toContain("'ci-temp-helper-release'");
  });

  it('runs one required workflow per PR head and one for merged main', () => {
    expect(workflowSource).toMatch(/push:\s+branches:\s+- main\s+pull_request:/u);
    expect(workflowSource).toContain('Run isolated R10D installer lifecycle');
    expect(workflowSource).toContain('Run real Chrome and Edge Clipper smoke');
    const lifecycle = readFileSync(
      resolve(repositoryRoot, 'scripts', 'run-installer-lifecycle-smoke.mjs'),
      'utf8',
    );
    expect(lifecycle).toContain('::error title=R10D lifecycle');
    expect(lifecycle).toContain('GITHUB_STEP_SUMMARY');
    const clipperReal = readFileSync(
      resolve(repositoryRoot, 'scripts', 'run-clipper-real-smoke.mjs'),
      'utf8',
    );
    expect(clipperReal).toContain("'--force-renderer-accessibility'");
    expect(clipperReal).toContain('}, 30_000);');
    expect(clipperReal).toContain('diagnostic.trim()');
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
    expect(workflowSource).not.toMatch(/secrets\./iu);
    expect(workflowSource).not.toMatch(/gh release|git tag|create-release/iu);
    expect([...workflowSource.matchAll(/\$env:([A-Z0-9_]+)/gu)]).toHaveLength(0);
  });
});
