import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function walkFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = resolve(directory, entry.name);
    return entry.isDirectory() ? walkFiles(entryPath) : [entryPath];
  });
}

function repositoryPath(absolutePath: string): string {
  return relative(repositoryRoot, absolutePath).replaceAll('\\', '/');
}

const productionRoots = [resolve(repositoryRoot, 'apps'), resolve(repositoryRoot, 'packages')];
const productionFiles = productionRoots.flatMap(walkFiles);
const productionSourceFiles = productionFiles.filter((file) => file.endsWith('.ts'));
const packageManifestFiles = [
  resolve(repositoryRoot, 'package.json'),
  ...productionFiles.filter((file) => file.endsWith('package.json')),
];

describe('M0 architecture boundaries', () => {
  it('contains every required monorepo boundary', () => {
    const requiredDirectories = [
      'apps/desktop',
      'apps/web-ui',
      'apps/clipper',
      'packages/core',
      'packages/db',
      'packages/providers',
      'packages/workflows',
      'packages/shared',
    ];

    for (const directory of requiredDirectories) {
      expect(existsSync(resolve(repositoryRoot, directory)), `${directory} must exist`).toBe(true);
    }
  });

  it('rejects platform automation, access-control bypass, and prohibited data modules by path', () => {
    const prohibitedPathPatterns = [
      /(?:xiaohongshu|rednote)[-_.]?(?:auto[-_.]?)?(?:login|publish|comment|direct[-_.]?message)/iu,
      /(?:captcha|risk[-_.]?control)[-_.]?(?:handler|bypass|solver)/iu,
      /(?:kai[-_.]?juan|kaijuan|openbook)[-_.]?(?:data|import|adapter)/iu,
      /(?:pirated[-_.]?)?ebook[-_.]?(?:upload|parser|fulltext|indexer)/iu,
    ];
    const violations = productionFiles
      .map(repositoryPath)
      .filter((path) => prohibitedPathPatterns.some((pattern) => pattern.test(path)));

    expect(violations).toEqual([]);
  });

  it('rejects prohibited platform and data interfaces in production source', () => {
    const prohibitedSourcePatterns = [
      /(?:class|interface|function|const)\s+\w*(?:Xiaohongshu|Rednote)\w*(?:Login|Publish|Comment|DirectMessage|Captcha|RiskControl)\w*/u,
      /(?:xiaohongshu\.com|xiaohongshu)[/'"`]\s*(?:api|graphql)/iu,
      /(?:class|interface|function|const)\s+\w*(?:KaiJuan|Kaijuan|OpenBookData)\w*/u,
      /(?:class|interface|function|const)\s+\w*(?:PiratedEbook|EbookUpload|EbookParser|EbookFulltext)\w*/u,
    ];
    const violations = productionSourceFiles.flatMap((file) => {
      const source = readFileSync(file, 'utf8');
      return prohibitedSourcePatterns
        .filter((pattern) => pattern.test(source))
        .map((pattern) => `${repositoryPath(file)} matched ${pattern.source}`);
    });

    expect(violations).toEqual([]);
  });

  it('rejects cloud storage, cloud database, and remote queue dependencies', () => {
    const prohibitedDependencyPatterns = [
      /^@aws-sdk\//u,
      /^@azure\/(?:cosmos|storage-)/u,
      /^@google-cloud\//u,
      /^@supabase\//u,
      /^@upstash\//u,
      /^(?:amqplib|bull|bullmq|firebase|firebase-admin|ioredis|redis)$/u,
    ];
    const violations: string[] = [];

    for (const manifestFile of packageManifestFiles) {
      const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as {
        dependencies?: Record<string, string>;
        optionalDependencies?: Record<string, string>;
      };
      const dependencies = {
        ...manifest.dependencies,
        ...manifest.optionalDependencies,
      };

      for (const dependency of Object.keys(dependencies)) {
        if (prohibitedDependencyPatterns.some((pattern) => pattern.test(dependency))) {
          violations.push(`${repositoryPath(manifestFile)}: ${dependency}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
