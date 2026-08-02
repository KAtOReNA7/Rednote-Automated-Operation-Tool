// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { V2App } from '../apps/web-ui/src/v2/app.js';

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
});

describe('V2 deterministic session workflows', () => {
  it('selects exactly three pending posts, excludes conflict, reschedules, and confirms', async () => {
    const user = userEvent.setup();
    render(<V2App />);
    await user.click(screen.getByRole('link', { name: '本周计划' }));
    await user.click(screen.getByRole('button', { name: '选择待确认' }));
    expect(screen.getAllByRole('button', { name: '已选择' })).toHaveLength(3);

    const conflict = screen.getByText('红发会的幕后主谋').closest('article');
    expect(conflict).not.toHaveAttribute('data-selected', 'true');
    await user.click(screen.getByRole('button', { name: '调整日期' }));
    expect(screen.getByRole('dialog', { name: '调整 3 篇内容日期' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认调整' }));
    expect(await screen.findByText(/调整到周日 14:00/u)).toBeVisible();
    await user.click(screen.getByRole('button', { name: '确认所选 (3)' }));
    await waitFor(() => expect(screen.getAllByText('已确认').length).toBeGreaterThanOrEqual(3));
  });

  it('edits and approves content, then confirms before recording a manual reply', async () => {
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
    const manual = screen.getByRole('button', { name: '标记已在官方端手动发送' });
    expect(manual).toBeDisabled();
    const suggestion = screen.getByLabelText('回复建议');
    await user.type(suggestion, ' 已编辑');
    await user.click(screen.getByRole('button', { name: '确认建议' }));
    expect(manual).toBeEnabled();
    await user.click(manual);
    expect(await screen.findByText(/应用没有发送能力/u)).toBeVisible();
    expect(document.body).toHaveTextContent('未连接平台，不会自动发送评论或私信');
  });

  it('searches books, decides recommendations, and saves four persona fields in-session', async () => {
    const user = userEvent.setup();
    render(<V2App />);
    await user.click(screen.getByRole('link', { name: '书库' }));
    await user.type(screen.getByLabelText('搜索作品'), '月亮宝石');
    expect(screen.getByRole('heading', { name: '《月亮宝石》' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: '《莫格街凶杀案》' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('link', { name: '数据复盘' }));
    await user.click(screen.getAllByRole('button', { name: '采纳' })[0] as HTMLElement);
    expect(screen.getByText('已采纳')).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: '拒绝' })[0] as HTMLElement);
    expect(screen.getByText('已拒绝')).toBeVisible();

    await user.click(screen.getByRole('link', { name: '设置' }));
    expect(screen.getAllByRole('textbox')).toHaveLength(4);
    const name = screen.getByDisplayValue('雾灯书页');
    await user.clear(name);
    await user.type(name, '雾灯书页·模拟');
    await user.click(screen.getByRole('button', { name: '保存设置' }));
    expect(await screen.findByText(/保存到当前模拟会话/u)).toBeVisible();
  });
});
