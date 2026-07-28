import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, parse, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

function insideRoot(path: string): boolean {
  const fromRoot = relative(root, resolve(path));
  return fromRoot.length > 0 && !fromRoot.startsWith('..') && !isAbsolute(fromRoot);
}

describe('Issue 013 repository-volume portability', () => {
  it('runs Vitest in a controlled sibling directory on the repository volume', () => {
    expect(parse(tmpdir()).root).toBe(parse(root).root);
    expect(insideRoot(tmpdir())).toBe(false);
    expect(relative(dirname(root), tmpdir()).replaceAll('\\', '/')).toMatch(
      /^\.rednote-temp\/rednote-vitest-/u,
    );
  });

  it('routes every test script through the portable Vitest launcher', () => {
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      readonly scripts: Readonly<Record<string, string>>;
    };
    for (const [name, command] of Object.entries(manifest.scripts)) {
      if (name === 'test' || name.startsWith('test:')) {
        expect(command, name).toMatch(
          /run-portable-vitest\.mjs|run-electron-smoke\.mjs|run-packaged-smoke\.mjs/iu,
        );
      }
    }
  });

  it('derives package and smoke scratch paths from the repository without fixed drives', () => {
    for (const file of [
      'scripts/package-desktop.mjs',
      'scripts/portable-temp.mjs',
      'scripts/run-electron-smoke.mjs',
      'scripts/run-packaged-smoke.mjs',
      'scripts/run-portable-vitest.mjs',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source, file).not.toMatch(/['"`][A-Za-z]:[\\/]/u);
      expect(source, file).not.toMatch(/rm\s+-rf|Remove-Item\s+.*(?:\$HOME|~)/iu);
    }
  });

  it('does not leave the portable launcher run directory after the process exits', () => {
    expect(existsSync(tmpdir())).toBe(true);
    expect(insideRoot(tmpdir())).toBe(false);
  });
});
