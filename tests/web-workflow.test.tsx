// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebV2App, WebWorkspaceShell } from '../apps/web-ui/src/v2/web/web-app.js';
import * as handleStore from '../apps/web-ui/src/v2/web/handle-store.js';
import { BrowserWorkspaceRepository } from '../apps/web-ui/src/v2/web/repository.js';
import { WebWorkspaceRuntime, weekInvariantFacts } from '../apps/web-ui/src/v2/web/runtime.js';
import type { WebWorkspaceState } from '../apps/web-ui/src/v2/web/contracts.js';
import { MemoryFolder, MemoryLock } from './support/web-folder-fixture.js';

type HandleStoreModule = typeof handleStore;

vi.mock('../apps/web-ui/src/v2/web/handle-store.js', async (importOriginal) => {
  const actual = await importOriginal<HandleStoreModule>();
  return {
    ...actual,
    loadWorkspaceHandle: vi.fn(),
    saveWorkspaceHandle: vi.fn(),
  };
});

const runtimes: WebWorkspaceRuntime[] = [];

async function runtime(folder = new MemoryFolder()): Promise<WebWorkspaceRuntime> {
  const value = await WebWorkspaceRuntime.connectPort(
    new BrowserWorkspaceRepository(folder, {
      createId: () => 'ws_syntheticworkflow00000001',
      lock: new MemoryLock(),
      now: () => new Date('2026-08-20T08:00:00.000Z'),
    }),
    { channelFactory: () => null, createToken: () => `token-${String(runtimes.length + 1)}` },
  );
  runtimes.push(value);
  return value;
}

async function lockActivePlan(value: WebWorkspaceRuntime): Promise<void> {
  await value.ensurePlan();
  await value.saveBrief('合成 Brief：21 项本地计划。');
  await value.confirmAllCandidates();
  await value.lockPlan();
}

beforeEach(() => {
  vi.mocked(handleStore.loadWorkspaceHandle).mockResolvedValue(null);
  vi.mocked(handleStore.saveWorkspaceHandle).mockResolvedValue(undefined);
});

afterEach(() => {
  for (const value of runtimes.splice(0)) value.close();
  vi.restoreAllMocks();
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
  document.body.innerHTML = '';
  window.location.hash = '';
});

describe('Web active-week and content vertical slice W09-W22', () => {
  it('W09-W12 isolates old-week content and preserves 21 items across week switches', async () => {
    const value = await runtime();
    const w34 = value.view.state.activeWeekKey;
    await lockActivePlan(value);
    const oldCandidate = value.queue()[0]?.candidate.id;
    if (oldCandidate === undefined) throw new Error('missing W34 candidate');
    await value.executeGeneration((await value.previewGeneration([oldCandidate])).token);
    expect(value.queue()).toHaveLength(21);
    expect(value.queue().filter((item) => item.state === 'HAS_VERSION')).toHaveLength(1);

    const w35 = value.suggestedNextWeek();
    await value.switchWeek(w35);
    await lockActivePlan(value);
    expect(value.view.state.activeWeekKey).toBe(w35);
    expect(value.queue()).toHaveLength(21);
    expect(value.queue().every((item) => item.state === 'MISSING')).toBe(true);
    expect(value.queue().some((item) => item.candidate.id === oldCandidate)).toBe(false);
    await value.switchWeek(w34);
    expect(value.queue().filter((item) => item.state === 'HAS_VERSION')).toHaveLength(1);
    await value.switchWeek(w35);
    expect(value.view.state.plans[w35]?.brief.text).toContain('合成 Brief');
  });

  it('W10/W15/W16/W18 supports separate 1-3 generation batches and append-only versions', async () => {
    const folder = new MemoryFolder();
    const value = await runtime(folder);
    await lockActivePlan(value);
    for (const count of [1, 2, 3]) {
      const candidateIds = value
        .queue()
        .filter((item) => item.state === 'MISSING')
        .slice(0, count)
        .map((item) => item.candidate.id);
      const preview = await value.previewGeneration(candidateIds);
      expect(preview).toMatchObject({
        candidateIds,
        maxRequests: 0,
        weekKey: value.view.state.activeWeekKey,
      });
      await value.executeGeneration(preview.token);
      expect(value.queue()).toHaveLength(21);
    }
    expect(value.queue().filter((item) => item.state === 'HAS_VERSION')).toHaveLength(6);
    const first = value.queue().find((item) => item.package !== null)?.package;
    const fields = first?.versions.at(-1)?.fields;
    if (first == null || fields === undefined) throw new Error('missing generated package');
    await value.saveContentVersion(first.id, { ...fields, title: '本地修订标题' }, first.revision);
    const reopened = await runtime(folder);
    expect(reopened.queue()).toHaveLength(21);
    expect(reopened.queue().find((item) => item.package?.id === first.id)?.package).toMatchObject({
      revision: 1,
      versions: [{ version: 1 }, { fields: { title: '本地修订标题' }, version: 2 }],
    });
  });

  it('W17 rejects duplicates, existing packages, cross-week items and one-time token replay', async () => {
    const value = await runtime();
    await lockActivePlan(value);
    await expect(value.saveBrief('不得修改已锁定 Brief')).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    const first = value.queue()[0]?.candidate.id;
    if (first === undefined) throw new Error('missing candidate');
    await expect(value.previewGeneration([first, first])).rejects.toMatchObject({
      code: 'SCHEMA_INVALID',
    });
    const preview = await value.previewGeneration([first]);
    await value.executeGeneration(preview.token);
    await expect(value.executeGeneration(preview.token)).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    await expect(value.previewGeneration([first])).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
    const oldWeekCandidate = first;
    await value.switchWeek(value.suggestedNextWeek());
    await lockActivePlan(value);
    await expect(value.previewGeneration([oldWeekCandidate])).rejects.toMatchObject({
      code: 'REVISION_CONFLICT',
    });
  });

  it('W21/W22 exports only allowlisted diagnostic facts without content or paths', async () => {
    const value = await runtime();
    await lockActivePlan(value);
    const candidate = value.queue()[0]?.candidate.id;
    if (candidate === undefined) throw new Error('missing candidate');
    await value.executeGeneration((await value.previewGeneration([candidate])).token);
    const diagnostics = JSON.stringify(value.diagnostics());
    expect(diagnostics).toContain('"invariant":"PASS"');
    expect(diagnostics).toContain(value.view.state.activeWeekKey);
    expect(diagnostics).not.toContain('密室诞生之前');
    expect(diagnostics).not.toMatch(/[A-Za-z]:\\|Authorization|credential|body|title/u);

    const activeWeekKey = value.view.state.activeWeekKey;
    const content = value.view.state.contentByWeek[activeWeekKey];
    if (content === undefined) throw new Error('missing synthetic content workspace');
    const inconsistent = {
      ...value.view.state,
      contentByWeek: {
        ...value.view.state.contentByWeek,
        [activeWeekKey]: { ...content, weekKey: value.suggestedNextWeek() },
      },
    } as unknown as WebWorkspaceState;
    expect(weekInvariantFacts(inconsistent)).toEqual({
      activeWeekKey,
      contentWeekKey: value.suggestedNextWeek(),
      layer: 'invariant',
      planWeekKey: activeWeekKey,
      status: 'WEEK_IDENTITY_MISMATCH',
    });
  });

  it('W13 derives ISO weeks at Shanghai Sunday/Monday and year boundaries', () => {
    expect(
      BrowserWorkspaceRepository.currentShanghaiWeekKey(new Date('2026-08-23T15:59:59Z')),
    ).toBe('2026-W34');
    expect(
      BrowserWorkspaceRepository.currentShanghaiWeekKey(new Date('2026-08-23T16:00:00Z')),
    ).toBe('2026-W35');
    expect(
      BrowserWorkspaceRepository.currentShanghaiWeekKey(new Date('2024-12-29T15:59:59Z')),
    ).toBe('2024-W52');
    expect(
      BrowserWorkspaceRepository.currentShanghaiWeekKey(new Date('2024-12-29T16:00:00Z')),
    ).toBe('2025-W01');
  });

  it('W14 ignores an older async refresh after the active week changes', async () => {
    let release: (() => void) | undefined;
    let started: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const refreshStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    class DelayedRepository extends BrowserWorkspaceRepository {
      public delayNextLoad = false;

      public override async load(workspaceId: string) {
        const loaded = await super.load(workspaceId);
        if (this.delayNextLoad) {
          this.delayNextLoad = false;
          started?.();
          await gate;
        }
        return loaded;
      }
    }
    const folder = new MemoryFolder();
    const repository = new DelayedRepository(folder, {
      createId: () => 'ws_syntheticstale000000001',
      lock: new MemoryLock(),
      now: () => new Date('2026-08-20T08:00:00.000Z'),
    });
    const value = await WebWorkspaceRuntime.connectPort(repository, { channelFactory: () => null });
    runtimes.push(value);
    repository.delayNextLoad = true;
    const staleRefresh = value.refresh();
    await refreshStarted;
    const nextWeek = value.suggestedNextWeek();
    await value.switchWeek(nextWeek);
    release?.();
    await staleRefresh;
    expect(value.view.state.activeWeekKey).toBe(nextWeek);
  });

  it('W19/W20 blocks unsupported browsers without a volatile mock fallback', async () => {
    Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: undefined });
    render(<WebV2App />);
    expect((await screen.findByRole('alert')).textContent).toContain('最新版 Chrome 或 Edge');
    expect(screen.queryByText(/模拟|mock/iu)).toBeNull();
  });

  it('W19 reports a denied folder picker and remains recoverable', async () => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        throw new DOMException('user denied', 'NotAllowedError');
      },
    });
    const user = userEvent.setup();
    render(<WebV2App />);
    const button = await screen.findByRole('button', { name: '选择本地数据目录' });
    await user.click(button);
    expect((await screen.findByRole('status')).textContent).toContain('目录权限被拒绝');
    expect(
      (screen.getByRole('button', { name: '选择本地数据目录' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(screen.queryByText(/模拟|mock/iu)).toBeNull();
  });

  it('C01-C05/C07 completes three visible batches while package editing stays independent', async () => {
    const folder = new MemoryFolder();
    const value = await runtime(folder);
    await lockActivePlan(value);
    const user = userEvent.setup();
    render(<WebWorkspaceShell route="content" runtime={value} setRoute={() => undefined} />);
    expect(screen.getByRole('heading', { name: '内容' })).not.toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(21);

    await user.click(screen.getAllByRole('checkbox')[0] as HTMLElement);
    expect(
      (screen.getByRole('button', { name: '预览本地生成（1/3）' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    await user.click(screen.getByRole('button', { name: '预览本地生成（1/3）' }));
    await user.click(await screen.findByRole('button', { name: '确认并生成一次' }));
    await waitFor(() =>
      expect(value.queue().filter((item) => item.state === 'HAS_VERSION')).toHaveLength(1),
    );
    expect(screen.getAllByRole('checkbox')).toHaveLength(21);
    expect(screen.getByRole('button', { name: '预览本地生成（0/3）' })).not.toBeNull();

    await user.click(screen.getAllByRole('button', { name: '编辑' })[0] as HTMLElement);
    const availableAfterFirst = screen
      .getAllByRole('checkbox')
      .filter((item) => !(item as HTMLInputElement).disabled);
    await user.click(availableAfterFirst[0] as HTMLElement);
    await user.click(screen.getByRole('button', { name: '预览本地生成（1/3）' }));
    expect(await screen.findByRole('button', { name: '确认并生成一次' })).not.toBeNull();
    await user.click(availableAfterFirst[1] as HTMLElement);
    expect(screen.queryByRole('button', { name: '确认并生成一次' })).toBeNull();
    expect(screen.getByText(/候选选择已变化，旧预览已失效/u)).not.toBeNull();
    expect(screen.getByLabelText('标题')).not.toBeNull();
    expect(screen.getByText('首次生成选择').parentElement?.textContent).toContain('2 项');
    expect(screen.getByText('已有包选择').parentElement?.textContent).toContain('1 项');
    await user.click(screen.getByRole('button', { name: '预览本地生成（2/3）' }));
    await user.click(await screen.findByRole('button', { name: '确认并生成一次' }));
    await waitFor(() =>
      expect(value.queue().filter((item) => item.state === 'HAS_VERSION')).toHaveLength(3),
    );

    const first = value.queue().find((item) => item.package !== null)?.package;
    if (first == null) throw new Error('missing first visible package');
    const title = screen.getByLabelText('标题');
    await user.clear(title);
    await user.type(title, '本地可见修订标题');
    await user.click(screen.getByRole('button', { name: '保存内容新版本' }));
    await waitFor(() =>
      expect(value.queue().find((item) => item.package?.id === first.id)?.package?.revision).toBe(
        1,
      ),
    );
    expect(screen.getByRole('button', { name: '预览本地生成（0/3）' })).not.toBeNull();

    const availableAfterSave = screen
      .getAllByRole('checkbox')
      .filter((item) => !(item as HTMLInputElement).disabled)
      .slice(0, 3);
    for (const checkbox of availableAfterSave) await user.click(checkbox);
    await user.click(screen.getByRole('button', { name: '预览本地生成（3/3）' }));
    await user.click(await screen.findByRole('button', { name: '确认并生成一次' }));
    await waitFor(() =>
      expect(value.queue().filter((item) => item.state === 'HAS_VERSION')).toHaveLength(6),
    );
    expect(value.queue().filter((item) => item.state === 'MISSING')).toHaveLength(15);

    const reopened = await runtime(folder);
    expect(reopened.queue()).toHaveLength(21);
    expect(reopened.queue().filter((item) => item.state === 'HAS_VERSION')).toHaveLength(6);
    expect(reopened.queue().find((item) => item.package?.id === first.id)?.package).toMatchObject({
      revision: 1,
      versions: [{ version: 1 }, { fields: { title: '本地可见修订标题' }, version: 2 }],
    });
  });

  it('C06 clears stale preview and week-local UI state after generation and week changes', async () => {
    const value = await runtime();
    await lockActivePlan(value);
    const firstCandidate = value.queue()[0]?.candidate.id;
    if (firstCandidate === undefined) throw new Error('missing first synthetic candidate');
    await value.executeGeneration((await value.previewGeneration([firstCandidate])).token);
    const firstPackage = value.queue()[0]?.package;
    const firstFields = firstPackage?.versions.at(-1)?.fields;
    if (firstPackage === null || firstPackage === undefined || firstFields === undefined)
      throw new Error('missing first synthetic package');

    const user = userEvent.setup();
    render(<WebWorkspaceShell route="content" runtime={value} setRoute={() => undefined} />);
    await user.click(screen.getAllByRole('button', { name: '编辑' })[0] as HTMLElement);
    const missing = screen
      .getAllByRole('checkbox')
      .find((item) => !(item as HTMLInputElement).disabled);
    if (missing === undefined) throw new Error('missing visible candidate checkbox');
    await user.click(missing);
    await user.click(screen.getByRole('button', { name: '预览本地生成（1/3）' }));
    expect(await screen.findByRole('button', { name: '确认并生成一次' })).not.toBeNull();

    await value.saveContentVersion(
      firstPackage.id,
      { ...firstFields, title: '外部 generation 修订' },
      firstPackage.revision,
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: '确认并生成一次' })).toBeNull(),
    );
    expect(screen.getByText(/工作区状态已变化，旧预览已失效/u)).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '预览本地生成（1/3）' }));
    const nextWeek = value.suggestedNextWeek();
    await value.switchWeek(nextWeek);
    await lockActivePlan(value);
    await waitFor(() => expect(screen.getAllByRole('checkbox')).toHaveLength(21));
    expect(screen.queryByRole('button', { name: '确认并生成一次' })).toBeNull();
    expect(screen.queryByLabelText('标题')).toBeNull();
    expect(screen.getByText('首次生成选择').parentElement?.textContent).toContain('0 项');
    expect(screen.getByText('已有包选择').parentElement?.textContent).toContain('0 项');
  });

  it('C08 keeps a connected FSA runtime when disposable handle caching fails', async () => {
    const value = await runtime();
    vi.spyOn(WebWorkspaceRuntime, 'connect').mockResolvedValue(value);
    vi.mocked(handleStore.saveWorkspaceHandle).mockRejectedValueOnce(
      new Error('HANDLE_STORE_UNAVAILABLE'),
    );
    const handle = {
      name: '合成测试目录',
      queryPermission: async () => 'granted' as PermissionState,
    } as unknown as FileSystemDirectoryHandle;
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => handle,
    });
    const user = userEvent.setup();
    render(<WebV2App />);
    await user.click(await screen.findByRole('button', { name: '选择本地数据目录' }));
    expect(await screen.findByRole('heading', { name: '总览' })).not.toBeNull();
    expect(screen.getByRole('status').textContent).toContain('本次未记住目录');
    expect(value.view.state.workspaceId).toBe('ws_syntheticworkflow00000001');
  });

  it.each([
    ['AbortError', '已取消选择目录'],
    ['NotAllowedError', '目录权限被拒绝'],
  ] as const)('C09 maps picker %s to a recoverable message', async (name, expected) => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => {
        throw new DOMException('synthetic picker result', name);
      },
    });
    const user = userEvent.setup();
    render(<WebV2App />);
    await user.click(await screen.findByRole('button', { name: '选择本地数据目录' }));
    expect((await screen.findByRole('status')).textContent).toContain(expected);
    expect(
      (screen.getByRole('button', { name: '选择本地数据目录' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('C09 maps a denied permission result without opening the runtime', async () => {
    const connect = vi.spyOn(WebWorkspaceRuntime, 'connect');
    const requestPermission = vi.fn(async () => 'denied' as PermissionState);
    const handle = {
      name: '拒绝权限目录',
      queryPermission: async () => 'denied' as PermissionState,
      requestPermission,
    } as unknown as FileSystemDirectoryHandle;
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: async () => handle,
    });
    const user = userEvent.setup();
    render(<WebV2App />);
    await user.click(await screen.findByRole('button', { name: '选择本地数据目录' }));
    expect((await screen.findByRole('status')).textContent).toContain('目录权限被拒绝');
    expect(connect).not.toHaveBeenCalled();
    expect(requestPermission).toHaveBeenCalledOnce();
  });
});
