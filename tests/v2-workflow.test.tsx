// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { V2App } from '../apps/web-ui/src/v2/app.js';
import { createMemoryV2Bridge } from './support/v2-test-runtime.js';

beforeEach(() => {
  window.history.replaceState(null, '', '#/v2/overview');
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    get: () => {
      throw new Error('Legacy bridge access is forbidden.');
    },
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteDesktop');
  Reflect.deleteProperty(window, 'rednoteV2');
});

describe('V2 deterministic session workflows', () => {
  it('selects exactly three pending posts, uses arbitrary date/time, reschedules, and confirms', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'rednoteV2', {
      configurable: true,
      value: createMemoryV2Bridge(),
    });
    render(<V2App />);
    await user.click(screen.getByRole('link', { name: '本周计划' }));
    await user.click(screen.getByRole('button', { name: '生成下周计划' }));
    expect(await screen.findByText(/按保存的人设生成 21 篇/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '选择待确认' }));
    expect(document.querySelectorAll('.v2-post[data-selected="true"]')).toHaveLength(3);

    expect(
      document.querySelectorAll('.v2-post[data-danger="true"][data-selected="true"]'),
    ).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: '调整日期' }));
    expect(screen.getByRole('dialog', { name: '调整 3 篇内容的日期和时间' })).toBeVisible();
    expect(screen.getAllByText('Asia/Shanghai (UTC+8)', { exact: false })).toHaveLength(2);
    const date = screen.getByLabelText('日期');
    await user.clear(date);
    await user.type(date, '2027-01-07');
    expect(screen.getByText('2027-W01')).toBeVisible();
    await user.clear(date);
    await user.type(date, '2026-08-06');
    await user.clear(screen.getByLabelText('时间（24 小时制）'));
    await user.type(screen.getByLabelText('时间（24 小时制）'), '18:30');
    await user.click(screen.getByRole('button', { name: '检查冲突并应用' }));
    expect(await screen.findByText('计划已更新')).toBeVisible();
    await user.click(screen.getByRole('link', { name: '总览' }));
    expect(screen.getByText('18 篇 · 0 处冲突 · 5 个空位')).toBeVisible();
    await user.click(screen.getByRole('link', { name: '本周计划' }));
    await user.click(screen.getByRole('button', { name: '确认所选' }));
    await waitFor(() => expect(screen.getAllByText('已确认').length).toBeGreaterThanOrEqual(3));
  });

  it('supports Shift selection and keeps conflict review write-free until explicit apply', async () => {
    const user = userEvent.setup();
    Object.defineProperty(window, 'rednoteV2', {
      configurable: true,
      value: createMemoryV2Bridge(),
    });
    render(<V2App />);
    await user.click(screen.getByRole('link', { name: '本周计划' }));
    const first = screen.getByRole('button', { name: '选择 密室诞生之前' });
    const third = screen.getByRole('button', { name: '选择 猎犬真的存在吗' });
    await user.click(first);
    fireEvent.click(third, { shiftKey: true });
    expect(document.querySelectorAll('.v2-post[data-selected="true"]')).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: '取消选择' }));

    await user.click(screen.getByRole('button', { name: '选择 密室诞生之前' }));
    await user.click(screen.getByRole('button', { name: '调整日期' }));
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-07-27' } });
    fireEvent.change(screen.getByLabelText('时间（24 小时制）'), {
      target: { value: '14:00' },
    });
    await user.click(screen.getByRole('button', { name: '检查冲突并应用' }));
    expect(await screen.findByRole('heading', { name: '发现时间冲突' })).toBeVisible();
    expect(screen.getByText('已有计划')).toBeVisible();
    expect(screen.getByText('本次调整')).toBeVisible();
    await user.click(screen.getByRole('button', { name: '返回修改时间' }));
    expect(screen.getByLabelText('时间（24 小时制）')).toHaveValue('14:00');
    await user.click(screen.getByRole('button', { name: '检查冲突并应用' }));
    await user.click(await screen.findByRole('button', { name: '仍然应用' }));
    expect(await screen.findByText('计划已更新')).toBeVisible();
  });

  it('edits and approves content, then keeps interaction empty until explicit local import', async () => {
    const user = userEvent.setup();
    render(<V2App />);
    await user.click(screen.getByRole('link', { name: '内容' }));
    const title = screen.getByLabelText('标题');
    await user.clear(title);
    await user.type(title, '修改后的模拟标题');
    expect(screen.getByRole('heading', { level: 2, name: '修改后的模拟标题' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '批量通过 (3)' }));
    expect(await screen.findByText(/已通过 3 个模拟内容包/u)).toBeVisible();

    await user.click(screen.getByRole('link', { name: '互动' }));
    expect(screen.getByRole('heading', { name: '尚无本地互动' })).toBeVisible();
    expect(screen.queryByRole('button', { name: /手动发送/u })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '保存本地互动' })).toBeDisabled();
    expect(document.body).toHaveTextContent('系统不会发送消息');
  });

  it('searches books, exposes the local review intake, and saves four persona fields in-session', async () => {
    const user = userEvent.setup();
    render(<V2App />);
    await user.click(screen.getByRole('link', { name: '书库' }));
    await user.type(screen.getByLabelText('搜索作品'), '月亮宝石');
    expect(screen.getByRole('heading', { name: '《月亮宝石》' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '《莫格街凶杀案》' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '数据复盘' }));
    expect(screen.getByRole('heading', { name: '指标录入' })).toBeVisible();
    expect(screen.getByRole('button', { name: '保存本页指标' })).toBeVisible();

    await user.click(screen.getByRole('link', { name: '设置' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    const name = screen.getByDisplayValue('雾灯书页');
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: '保存设置' }));
    expect(screen.getByText(/账号名称未填写/u)).toBeVisible();
    await user.type(name, '雾灯书页·模拟');
    await user.click(screen.getByRole('button', { name: '保存设置' }));
    expect(await screen.findByText(/保存到当前模拟会话/u)).toBeVisible();
  });
});
