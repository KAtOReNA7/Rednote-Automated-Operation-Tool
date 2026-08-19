// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { V2App } from '../apps/web-ui/src/v2/app.js';
import type * as V2Components from '../apps/web-ui/src/v2/components.js';
import {
  V2ContractError,
  toV2Exception,
  type V2Bridge,
  type V2Result,
  type WeeklyPlan,
} from '../packages/v2/src/index.js';
import { createMemoryV2Bridge } from './support/v2-test-runtime.js';

vi.mock('../apps/web-ui/src/v2/components.js', async (importOriginal) => {
  const actual = await importOriginal<typeof V2Components>();
  return { ...actual, currentShanghaiWeekIdentity: () => actual.weekIdentity('2026-W31') };
});

function exposeBridge(bridge: V2Bridge): void {
  Object.defineProperty(window, 'rednoteV2', { configurable: true, value: bridge });
}

async function openWeeklyPlan(): Promise<void> {
  const user = userEvent.setup();
  render(<V2App />);
  await user.click(screen.getByRole('link', { name: '本周计划' }));
  await screen.findByRole('heading', { name: '本周计划' });
}

beforeEach(() => {
  window.history.replaceState(null, '', '#/v2/overview');
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteV2');
});

describe('R09 weekly-plan acceptance blockers', () => {
  it('shows concrete target loading, then ready and persistent saved revisions', async () => {
    const base = createMemoryV2Bridge();
    let resolveTarget: ((result: V2Result<WeeklyPlan>) => void) | undefined;
    const pendingTarget = new Promise<V2Result<WeeklyPlan>>((resolve) => {
      resolveTarget = resolve;
    });
    const bridge: V2Bridge = {
      ...base,
      readWeeklyPlan: vi.fn((input) =>
        input.weekKey === '2026-W32' ? pendingTarget : base.readWeeklyPlan(input),
      ),
    };
    exposeBridge(bridge);
    await openWeeklyPlan();

    expect(await screen.findAllByText('正在读取目标周 2026-W32…')).toHaveLength(2);
    expect(screen.getByRole('button', { name: '预览生成下周计划' })).toBeDisabled();
    resolveTarget?.(await base.readWeeklyPlan({ weekKey: '2026-W32' }));
    expect(
      await screen.findByText(/已读取 2026-W32 · 计划 revision 0 · Brief revision 0/u),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: '预览生成下周计划' })).toBeEnabled();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('下周内容重点（可留空）'), '合成的下周重点');
    await user.click(screen.getByRole('button', { name: '保存目标周 Brief' }));
    expect(
      await screen.findByText(/已保存到 2026-W32 · revision 1 · Brief revision 1/u),
    ).toBeVisible();
  });

  it('leaves loading on result error and Promise rejection, and retries the same target week', async () => {
    const base = createMemoryV2Bridge();
    let attempt = 0;
    const readWeeklyPlan = vi.fn((input: { readonly weekKey: string }) => {
      if (input.weekKey !== '2026-W32') return base.readWeeklyPlan(input);
      attempt += 1;
      if (attempt === 1)
        return Promise.resolve({
          error: toV2Exception(new V2ContractError('PERSISTENCE_UNAVAILABLE')),
          ok: false as const,
        });
      if (attempt === 2) return Promise.reject(new Error('synthetic private rejection'));
      if (attempt === 3)
        return base
          .readWeeklyPlan({ weekKey: '2026-W33' })
          .then((result) =>
            result.ok
              ? { ok: true as const, value: result.value }
              : { error: result.error, ok: false as const },
          );
      return base.readWeeklyPlan(input);
    });
    exposeBridge({ ...base, readWeeklyPlan });
    await openWeeklyPlan();

    expect(await screen.findByText('目标周读取失败：本机保存暂时不可用。')).toBeVisible();
    expect(screen.getByText('目标周读取失败，请重试')).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '重试读取' }));
    expect(await screen.findByText('目标周读取失败：目标周读取异常，请重试。')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重试读取' }));
    expect(
      await screen.findByText('目标周读取失败：返回的目标周为 2026-W33，与 2026-W32 不一致。'),
    ).toBeVisible();
    await user.click(screen.getByRole('button', { name: '重试读取' }));
    expect(await screen.findByText(/已读取 2026-W32/u)).toBeVisible();
    expect(readWeeklyPlan).toHaveBeenCalledWith({ weekKey: '2026-W32' });
  });

  it('prioritizes plan mismatch details and opens the existing scheduler for the exact item', async () => {
    const base = createMemoryV2Bridge();
    const current = await base.readWeeklyPlan({ weekKey: '2026-W31' });
    if (!current.ok) throw new Error('Missing synthetic current plan.');
    const [first, second, ...rest] = current.value.candidates;
    if (first === undefined || second === undefined)
      throw new Error('Missing synthetic candidates.');
    const mismatched: WeeklyPlan = {
      ...current.value,
      candidates: [{ ...first, date: '2026-08-10' }, { ...second, date: '2026-08-11' }, ...rest],
    };
    const readWeeklyPlan = vi.fn((input: { readonly weekKey: string }) =>
      input.weekKey === '2026-W31'
        ? Promise.resolve({ ok: true as const, value: mismatched })
        : base.readWeeklyPlan(input),
    );
    exposeBridge({ ...base, readWeeklyPlan });
    await openWeeklyPlan();

    expect(await screen.findByText('2 项待修正；全部完成后才能预览下周计划。')).toBeVisible();
    expect(screen.getByText(/当前 2026-08-10 · 实际 2026-W33/u)).toBeVisible();
    expect(screen.getAllByText(/期望 2026-W31 · 2026-07-27 至 2026-08-02/u)).toHaveLength(2);
    expect(screen.getByText('当前计划日期与周标识不一致，请先修正。')).toBeVisible();
    expect(screen.queryByText(/正在读取目标周.*revision/u)).not.toBeInTheDocument();

    const user = userEvent.setup();
    const firstRepair = screen.getAllByRole('button', { name: '修正此项日期' }).at(0);
    if (firstRepair === undefined) throw new Error('Missing first mismatch repair action.');
    await user.click(firstRepair);
    expect(screen.getByRole('dialog', { name: '调整 1 篇内容的发布时间' })).toBeVisible();
    expect(screen.getByLabelText('日期')).toHaveValue('2026-08-10');
    expect(screen.getByText('已选择 1 篇')).toBeVisible();
  });

  it('persists the feedback two-step state without changing the item or calling Provider', async () => {
    const base = createMemoryV2Bridge();
    const recordPlanItemFeedback = vi.fn(base.recordPlanItemFeedback);
    const previewProviderAction = vi.fn();
    const bridge: V2Bridge = { ...base, previewProviderAction, recordPlanItemFeedback };
    exposeBridge(bridge);
    await openWeeklyPlan();
    const user = userEvent.setup();
    const title = '密室诞生之前';
    await user.click(screen.getByRole('button', { name: `选择 ${title}` }));
    expect(screen.getByRole('button', { name: '保存反馈' })).toBeVisible();
    await user.type(screen.getByLabelText('补充反馈'), '只保存合成反馈，不执行模型');
    await user.click(screen.getByRole('button', { name: '保存反馈' }));

    expect(await screen.findByText('反馈已保存，当前计划未修改')).toBeVisible();
    expect(
      screen.getByText('下一步可以预览重新生成当前项；只有确认执行时才可能调用模型。'),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: '预览重新生成当前项' })).toBeVisible();
    expect(screen.getByRole('button', { name: title })).toBeVisible();
    expect(screen.getByText(/本机 revision 1/u)).toBeVisible();
    expect(recordPlanItemFeedback).toHaveBeenCalledTimes(1);
    expect(previewProviderAction).not.toHaveBeenCalled();

    cleanup();
    window.history.replaceState(null, '', '#/v2/weekly-plan');
    render(<V2App />);
    await waitFor(() => expect(screen.getByText(/本机 revision 1/u)).toBeVisible());
    await user.click(screen.getByRole('button', { name: `选择 ${title}` }));
    expect(await screen.findByText('反馈已保存，当前计划未修改')).toBeVisible();
  });

  it('keeps feedback controls in semantic order while selection clearance is active', async () => {
    exposeBridge(createMemoryV2Bridge());
    await openWeeklyPlan();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '选择 密室诞生之前' }));
    const page = document.querySelector('.v2-weekly-page');
    expect(page).toHaveAttribute('data-selection-active', 'true');
    const feedback = document.querySelector('.v2-item-feedback');
    const controls = [...(feedback?.querySelectorAll('select, textarea, button') ?? [])];
    expect(controls.map((control) => control.textContent?.trim())).toEqual([
      '选题不匹配角度重复不符合本周重点发布时间不合适其他',
      '',
      '保存反馈',
    ]);
    const saveFeedback = screen.getByRole('button', { name: '保存反馈' });
    saveFeedback.focus();
    expect(saveFeedback).toHaveFocus();
  });
});
