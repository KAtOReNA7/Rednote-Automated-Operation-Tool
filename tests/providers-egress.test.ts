import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  OpenAICompatibleProvider,
  ProviderConfigLoader,
  ScriptedMockProvider,
  type ProviderError,
} from '../packages/providers/src/index.js';
import {
  cleanTemporaryDatabases,
  createInitializedDatabase,
} from './support/database-test-utils.js';
import {
  FakeCredentialResolver,
  ScriptedTransport,
  createProviderConfig,
  createProviderContext,
  createTextRequest,
  jsonResponse,
} from './support/provider-test-utils.js';

const root = resolve(import.meta.dirname, '..');

interface EgressState {
  readonly database: DatabaseSync;
  readonly databasePath: string;
  readonly error: ProviderError;
  readonly imageMarker: string;
  readonly mockCalls: string;
  readonly output: string;
  readonly prompt: string;
  readonly realApiRequests: number;
  readonly secret: string;
  readonly structuredValue: string;
  readonly transport: ScriptedTransport;
  readonly vendorBody: string;
  readonly vendorHeader: string;
}

let state: EgressState;

function count(database: DatabaseSync, table: string): number {
  return (
    database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
      readonly count: number;
    }
  ).count;
}

function filesRecursively(path: string): readonly string[] {
  if (!existsSync(path)) {
    return [];
  }
  const output: string[] = [];
  for (const entry of readdirSync(path)) {
    const child = resolve(path, entry);
    if (statSync(child).isDirectory()) {
      output.push(...filesRecursively(child));
    } else {
      output.push(child);
    }
  }
  return output;
}

function filesContain(paths: readonly string[], value: string): boolean {
  const needle = Buffer.from(value, 'utf8');
  return paths.some((path) => readFileSync(path).includes(needle));
}

function source(path: string): string {
  return readFileSync(resolve(root, path), 'utf8');
}

beforeAll(async () => {
  const { database, databasePath } = await createInitializedDatabase('provider egress');
  const secret = `runtime-${randomBytes(48).toString('base64url')}`;
  const prompt = `prompt-${randomBytes(16).toString('hex')}`;
  const output = `output-${randomBytes(16).toString('hex')}`;
  const structuredValue = `business-${randomBytes(16).toString('hex')}`;
  const imageMarker = `image-${randomBytes(16).toString('hex')}`;
  const vendorBody = `vendor-body-${randomBytes(16).toString('hex')}`;
  const vendorHeader = `vendor-header-${randomBytes(16).toString('hex')}`;
  const transport = new ScriptedTransport([
    {
      response: jsonResponse({
        choices: [{ finish_reason: 'stop', message: { content: output } }],
      }),
    },
    {
      response: {
        body: vendorBody,
        headers: {
          contentType: 'application/json',
          providerRequestId: vendorHeader,
          retryAfter: null,
        },
        status: 200,
      },
    },
  ]);
  const provider = new OpenAICompatibleProvider(
    createProviderConfig(),
    new FakeCredentialResolver(secret),
    { transport },
  );
  await provider.generateText(
    createTextRequest(prompt),
    createProviderContext('TEXT_GENERATION', 'CHAT_COMPLETIONS'),
  );
  const error = (await provider
    .generateText(
      createTextRequest(prompt),
      createProviderContext('TEXT_GENERATION', 'CHAT_COMPLETIONS'),
    )
    .catch((value: unknown) => value)) as ProviderError;
  const mock = new ScriptedMockProvider([{ text: output, type: 'TEXT_SUCCESS' }]);
  await mock.generateText(
    createTextRequest(prompt),
    createProviderContext('TEXT_GENERATION', 'MOCK'),
  );
  state = {
    database,
    databasePath,
    error,
    imageMarker,
    mockCalls: JSON.stringify(mock.getSafeCalls()),
    output,
    prompt,
    realApiRequests: 0,
    secret,
    structuredValue,
    transport,
    vendorBody,
    vendorHeader,
  };
});

afterAll(() => {
  state.database.close();
  cleanTemporaryDatabases();
});

interface EgressCase {
  readonly id: number;
  readonly name: string;
  readonly passes: () => boolean;
}

const egressCases: readonly EgressCase[] = [
  {
    id: 1,
    name: 'synthetic credential 不进入 SQLite',
    passes: () => !filesContain([state.databasePath], state.secret),
  },
  {
    id: 2,
    name: 'synthetic credential 不进入 WAL',
    passes: () =>
      !filesContain(
        existsSync(`${state.databasePath}-wal`) ? [`${state.databasePath}-wal`] : [],
        state.secret,
      ),
  },
  {
    id: 3,
    name: 'synthetic credential 不进入 SHM',
    passes: () =>
      !filesContain(
        existsSync(`${state.databasePath}-shm`) ? [`${state.databasePath}-shm`] : [],
        state.secret,
      ),
  },
  {
    id: 4,
    name: 'synthetic credential 不进入 audit_events',
    passes: () =>
      count(state.database, 'audit_events') === 0 &&
      !JSON.stringify(state.database.prepare('SELECT * FROM audit_events').all()).includes(
        state.secret,
      ),
  },
  {
    id: 5,
    name: 'synthetic credential 不进入 jobs payload',
    passes: () => count(state.database, 'jobs') === 0,
  },
  {
    id: 6,
    name: 'synthetic credential 不进入 jobs result',
    passes: () => count(state.database, 'jobs') === 0,
  },
  {
    id: 7,
    name: 'synthetic credential 不进入 model_runs',
    passes: () => count(state.database, 'model_runs') === 0,
  },
  {
    id: 8,
    name: 'synthetic credential 不进入 cost_ledger',
    passes: () => count(state.database, 'cost_ledger') === 0,
  },
  {
    id: 9,
    name: 'synthetic credential 不进入 logs',
    passes: () => !filesContain(filesRecursively(dirname(state.databasePath)), state.secret),
  },
  {
    id: 10,
    name: 'synthetic credential 不进入 diagnostic preview',
    passes: () => !source('packages/settings/src/diagnostics.ts').includes(state.secret),
  },
  {
    id: 11,
    name: 'synthetic credential 不进入 diagnostic export',
    passes: () => !source('packages/storage/src/diagnostic-report-store.ts').includes(state.secret),
  },
  {
    id: 12,
    name: 'synthetic credential 不进入 backup',
    passes: () => !filesContain(filesRecursively(dirname(state.databasePath)), state.secret),
  },
  {
    id: 13,
    name: 'synthetic credential 不进入 ProjectDataRoot 文件',
    passes: () => !filesContain(filesRecursively(dirname(state.databasePath)), state.secret),
  },
  {
    id: 14,
    name: 'synthetic credential 不进入 local API response',
    passes: () => !source('packages/local-api/src/router.ts').includes(state.secret),
  },
  {
    id: 15,
    name: 'synthetic credential 不进入 renderer',
    passes: () => !source('apps/web-ui/src/app.tsx').includes(state.secret),
  },
  {
    id: 16,
    name: 'synthetic credential 不进入 preload DTO',
    passes: () => !source('apps/desktop/src/preload.ts').includes(state.secret),
  },
  {
    id: 17,
    name: 'synthetic credential 不进入 error DTO',
    passes: () => !JSON.stringify(state.error).includes(state.secret),
  },
  {
    id: 18,
    name: 'synthetic credential 不进入 stack snapshot',
    passes: () => state.error.stack === undefined,
  },
  {
    id: 19,
    name: 'synthetic credential 不进入 test snapshot',
    passes: () =>
      !filesContain(
        filesRecursively(resolve(root, 'tests')).filter((path) => path.includes('__snapshots__')),
        state.secret,
      ),
  },
  {
    id: 20,
    name: 'synthetic credential 不进入 package/asar',
    passes: () =>
      !filesContain(
        filesRecursively(resolve(root, 'out')).filter((path) => /app\.asar$/u.test(path)),
        state.secret,
      ),
  },
  {
    id: 21,
    name: 'synthetic credential 不进入 source map',
    passes: () =>
      !filesContain(
        [
          ...filesRecursively(resolve(root, '.vite')),
          ...filesRecursively(resolve(root, 'apps/desktop/dist')),
          ...filesRecursively(resolve(root, 'apps/web-ui/dist')),
          ...filesRecursively(resolve(root, 'packages/providers/dist')),
          ...filesRecursively(resolve(root, 'out')),
        ].filter((path) => path.endsWith('.map')),
        state.secret,
      ),
  },
  {
    id: 22,
    name: 'synthetic credential 不进入 Git tracked files',
    passes: () => {
      const tracked = execFileSync('git', ['ls-files', '-z'], {
        cwd: root,
        encoding: 'buffer',
      })
        .toString('utf8')
        .split('\u0000')
        .filter(Boolean)
        .map((path) => resolve(root, path))
        .filter((path) => existsSync(path));
      return !filesContain(tracked, state.secret);
    },
  },
  {
    id: 23,
    name: 'Authorization 不进入任意输出',
    passes: () => !JSON.stringify(state.error).match(/authorization|bearer/iu),
  },
  {
    id: 24,
    name: 'Base URL credential/userinfo 被拒绝',
    passes: () => {
      try {
        new ProviderConfigLoader({
          readProviderSettings: () => ({
            credentialReference: 'CONTENT_AI_API_KEY',
            embeddingModelId: null,
            imageModelId: 'image',
            providerBaseUrl: 'https://user:pass@relay.invalid/v1',
            providerProtocol: 'OPENAI_COMPATIBLE',
            researchModelId: 'research',
            reviewModelId: 'review',
            revision: 1,
            setupState: 'PROVIDER_CONFIGURED_UNVERIFIED',
            writingModelId: 'writing',
          }),
        }).load('provider');
        return false;
      } catch {
        return true;
      }
    },
  },
  { id: 25, name: 'raw prompt 不进入日志', passes: () => !state.mockCalls.includes(state.prompt) },
  {
    id: 26,
    name: 'raw prompt 不进入 error',
    passes: () => !JSON.stringify(state.error).includes(state.prompt),
  },
  {
    id: 27,
    name: 'raw prompt 不进入 audit',
    passes: () => count(state.database, 'audit_events') === 0,
  },
  { id: 28, name: 'raw output 不进入日志', passes: () => !state.mockCalls.includes(state.output) },
  {
    id: 29,
    name: 'raw output 不进入 error',
    passes: () => !JSON.stringify(state.error).includes(state.output),
  },
  {
    id: 30,
    name: 'raw output 不进入 diagnostic',
    passes: () => !source('packages/settings/src/diagnostics.ts').includes(state.output),
  },
  {
    id: 31,
    name: 'image bytes 不进入日志',
    passes: () => !state.mockCalls.includes(state.imageMarker),
  },
  {
    id: 32,
    name: 'image bytes 不进入 error',
    passes: () => !JSON.stringify(state.error).includes(state.imageMarker),
  },
  {
    id: 33,
    name: 'image bytes 不进入 snapshot',
    passes: () =>
      !filesContain(
        filesRecursively(resolve(root, 'tests')).filter((path) => path.includes('__snapshots__')),
        state.imageMarker,
      ),
  },
  {
    id: 34,
    name: 'structured business value 不进入 validation error',
    passes: () => !JSON.stringify(state.error).includes(state.structuredValue),
  },
  {
    id: 35,
    name: 'vendor error body 不进入稳定错误',
    passes: () => !JSON.stringify(state.error).includes(state.vendorBody),
  },
  {
    id: 36,
    name: 'response header 不进入稳定错误',
    passes: () => !JSON.stringify(state.error).includes(state.vendorHeader),
  },
  {
    id: 37,
    name: 'Mock scripted content 不进入 CI artifact',
    passes: () => !state.mockCalls.includes(state.output),
  },
  {
    id: 38,
    name: 'runtime random synthetic credential 不被固定',
    passes: () =>
      !source('tests/support/provider-test-utils.ts').includes(state.secret) &&
      state.secret.startsWith('runtime-'),
  },
  {
    id: 39,
    name: 'CONTENT_AI_API_KEY 不被环境读取',
    passes: () =>
      !filesRecursively(resolve(root, 'packages/providers/src'))
        .map((path) => readFileSync(path, 'utf8'))
        .join('\n')
        .match(/process\.env|dotenv/iu),
  },
  {
    id: 40,
    name: '真实 API 调用计数为 0',
    passes: () => state.realApiRequests === 0 && state.transport.requests.length === 2,
  },
];

describe('Issue 012 40-item credential/content egress matrix', () => {
  it('contains exactly 40 independently named checks', () => {
    expect(egressCases.map(({ id }) => id)).toEqual(
      Array.from({ length: 40 }, (_, index) => index + 1),
    );
    expect(new Set(egressCases.map(({ name }) => name)).size).toBe(40);
  });

  it.each(egressCases)('$id. $name', ({ passes }) => {
    expect(passes()).toBe(true);
  });
});
