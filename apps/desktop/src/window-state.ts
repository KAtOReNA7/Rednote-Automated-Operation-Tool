import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MINIMUM_WIDTH = 960;
const MINIMUM_HEIGHT = 640;
const MINIMUM_VISIBLE_EDGE = 96;

export interface WindowBounds {
  readonly height: number;
  readonly width: number;
  readonly x: number;
  readonly y: number;
}

export type WorkArea = WindowBounds;

interface PersistedWindowState {
  readonly bounds: WindowBounds;
  readonly isMaximized: boolean;
}

export interface WindowStateStore {
  load(workAreas: readonly WorkArea[]): PersistedWindowState;
  save(state: PersistedWindowState): void;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    isFiniteInteger(record.x) &&
    isFiniteInteger(record.y) &&
    isFiniteInteger(record.width) &&
    isFiniteInteger(record.height) &&
    record.width >= MINIMUM_WIDTH &&
    record.height >= MINIMUM_HEIGHT
  );
}

export function parsePersistedWindowState(value: unknown): PersistedWindowState | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (!isWindowBounds(record.bounds) || typeof record.isMaximized !== 'boolean') {
    return null;
  }
  return {
    bounds: record.bounds,
    isMaximized: record.isMaximized,
  };
}

function visibleOnDisplay(bounds: WindowBounds, area: WorkArea): boolean {
  const horizontal =
    Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x);
  const vertical =
    Math.min(bounds.y + bounds.height, area.y + area.height) - Math.max(bounds.y, area.y);
  return horizontal >= MINIMUM_VISIBLE_EDGE && vertical >= MINIMUM_VISIBLE_EDGE;
}

function centeredBounds(area: WorkArea): WindowBounds {
  const width = Math.min(DEFAULT_WIDTH, area.width);
  const height = Math.min(DEFAULT_HEIGHT, area.height);
  return {
    height,
    width,
    x: area.x + Math.max(0, Math.floor((area.width - width) / 2)),
    y: area.y + Math.max(0, Math.floor((area.height - height) / 2)),
  };
}

export function normalizeWindowBounds(
  savedBounds: WindowBounds | null,
  workAreas: readonly WorkArea[],
): WindowBounds {
  const primary = workAreas[0] ?? {
    height: DEFAULT_HEIGHT,
    width: DEFAULT_WIDTH,
    x: 0,
    y: 0,
  };

  if (savedBounds === null || !workAreas.some((area) => visibleOnDisplay(savedBounds, area))) {
    return centeredBounds(primary);
  }

  const display = workAreas.find((area) => visibleOnDisplay(savedBounds, area)) ?? primary;
  return {
    height: Math.min(Math.max(savedBounds.height, MINIMUM_HEIGHT), display.height),
    width: Math.min(Math.max(savedBounds.width, MINIMUM_WIDTH), display.width),
    x: savedBounds.x,
    y: savedBounds.y,
  };
}

export function createWindowStateStore(filePath: string): WindowStateStore {
  return {
    load(workAreas) {
      let parsed: PersistedWindowState | null;
      try {
        parsed = parsePersistedWindowState(JSON.parse(readFileSync(filePath, 'utf8')));
      } catch {
        parsed = null;
      }

      return {
        bounds: normalizeWindowBounds(parsed?.bounds ?? null, workAreas),
        isMaximized: parsed?.isMaximized ?? false,
      };
    },
    save(state) {
      mkdirSync(dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${process.pid}.tmp`;
      writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, {
        encoding: 'utf8',
        flag: 'w',
        mode: 0o600,
      });
      renameSync(temporaryPath, filePath);
    },
  };
}
