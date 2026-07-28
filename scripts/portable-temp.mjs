import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, parse, relative, resolve } from 'node:path';

export async function createPortableTemp(projectRoot, label) {
  const resolvedRoot = resolve(projectRoot);
  const projectParent = dirname(resolvedRoot);
  const base = join(projectParent, '.rednote-temp');
  if (parse(base).root !== parse(resolvedRoot).root) {
    throw new Error('Portable temporary directory must remain on the repository volume.');
  }
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(join(base, `${basename(resolvedRoot)}-${label}-`));
  const fromBase = relative(base, root);
  if (fromBase.length === 0 || fromBase.startsWith('..') || isAbsolute(fromBase)) {
    throw new Error('Portable temporary directory escaped its controlled same-volume parent.');
  }
  return {
    env: {
      TEMP: root,
      TMP: root,
      npm_config_cache: join(projectParent, '.rednote-npm-cache', basename(resolvedRoot)),
    },
    root,
    async cleanup() {
      const checked = relative(base, root);
      if (checked.length === 0 || checked.startsWith('..') || isAbsolute(checked)) {
        throw new Error('Refusing to clean an unsafe portable temporary directory.');
      }
      await rm(root, { force: true, maxRetries: 20, recursive: true, retryDelay: 100 });
    },
  };
}
