import { win32 } from 'node:path';

import { describe, expect, it } from 'vitest';

import { pathFixtureValue } from './fixtures/中文 空格/path-fixture.js';

describe('Windows path compatibility', () => {
  it('loads a TypeScript fixture through a path containing Chinese and a space', () => {
    expect(pathFixtureValue).toBe('中文与空格路径可加载');
  });

  it('preserves Chinese and spaces when composing a Windows path', () => {
    expect(win32.join('C:\\用户', '推理 项目', '资料.json')).toBe('C:\\用户\\推理 项目\\资料.json');
  });
});
