import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createWindowStateStore,
  normalizeWindowBounds,
  parsePersistedWindowState,
} from '../apps/desktop/src/window-state.js';

const temporaryDirectories: string[] = [];
const primary = { height: 1080, width: 1920, x: 0, y: 0 };

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('desktop window state', () => {
  it('centres safe default bounds when no state exists', () => {
    expect(normalizeWindowBounds(null, [primary])).toEqual({
      height: 800,
      width: 1280,
      x: 320,
      y: 140,
    });
  });

  it('preserves visible bounds', () => {
    const bounds = { height: 700, width: 1100, x: 120, y: 80 };
    expect(normalizeWindowBounds(bounds, [primary])).toEqual(bounds);
  });

  it('recovers an off-screen window onto the primary display', () => {
    expect(
      normalizeWindowBounds({ height: 700, width: 1100, x: 50_000, y: 50_000 }, [primary]),
    ).toEqual({
      height: 800,
      width: 1280,
      x: 320,
      y: 140,
    });
  });

  it('clamps oversized visible bounds to the selected work area', () => {
    expect(normalizeWindowBounds({ height: 2000, width: 3000, x: 0, y: 0 }, [primary])).toEqual({
      height: 1080,
      width: 1920,
      x: 0,
      y: 0,
    });
  });

  it.each([
    [null],
    [{}],
    [{ bounds: {}, isMaximized: false }],
    [{ bounds: { height: 10, width: 10, x: 0, y: 0 }, isMaximized: false }],
    [{ bounds: { height: 700, width: 1000, x: 0, y: 0 }, isMaximized: 'yes' }],
  ])('rejects malformed persisted state %#', (value) => {
    expect(parsePersistedWindowState(value)).toBeNull();
  });

  it('round-trips state atomically through a Chinese path containing spaces', () => {
    const directory = mkdtempSync(join(tmpdir(), '红笺 窗口-'));
    temporaryDirectories.push(directory);
    const filePath = join(directory, '窗口 状态.json');
    const store = createWindowStateStore(filePath);
    const state = {
      bounds: { height: 720, width: 1100, x: 80, y: 60 },
      isMaximized: true,
    };

    store.save(state);

    expect(store.load([primary])).toEqual(state);
    expect(JSON.parse(readFileSync(filePath, 'utf8'))).toEqual(state);
    expect(readdirSync(directory)).toEqual(['窗口 状态.json']);
    expect(readFileSync(filePath, 'utf8')).not.toMatch(/password|secret|token|payload|result/iu);
  });

  it('falls back safely when persisted JSON is corrupt', () => {
    const directory = mkdtempSync(join(tmpdir(), '红笺 窗口-'));
    temporaryDirectories.push(directory);
    const filePath = join(directory, '窗口 状态.json');
    writeFileSync(filePath, '{bad json', 'utf8');

    expect(createWindowStateStore(filePath).load([primary]).bounds).toEqual({
      height: 800,
      width: 1280,
      x: 320,
      y: 140,
    });
  });
});
