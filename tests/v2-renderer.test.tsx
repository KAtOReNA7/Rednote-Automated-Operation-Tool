// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { V2App } from '../apps/web-ui/src/v2/app.js';
import { V2_ROUTES } from '../apps/web-ui/src/v2/routes.js';

beforeEach(() => {
  window.history.replaceState(null, '', '#/v2/overview');
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(window, 'rednoteDesktop', {
    configurable: true,
    get: () => {
      throw new Error('V2 renderer attempted to access the legacy bridge.');
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteDesktop');
});

describe('V2 renderer shell', () => {
  it('renders the fixed seven-page navigation and routes every page with one h1', async () => {
    const user = userEvent.setup();
    render(<V2App />);

    expect(screen.getByText('本地工作区未连接 · AI 服务不可用')).toBeVisible();
    expect(document.body).not.toHaveTextContent('其他页面模拟');
    expect(document.body).not.toHaveTextContent('模拟体验');
    const navigation = screen.getByRole('navigation');
    expect(
      within(navigation)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(V2_ROUTES.map(({ label }) => label));

    for (const route of V2_ROUTES) {
      await user.click(within(navigation).getByRole('link', { name: route.label }));
      await waitFor(() => expect(window.location.hash).toBe(`#/v2/${route.id}`));
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        route.id === 'overview' ? '今天值得关注什么' : route.label,
      );
    }
  });

  it('controls unknown routes and supports the editorial exception switch', async () => {
    window.history.replaceState(null, '', '#/v2/unknown');
    const user = userEvent.setup();
    render(<V2App />);
    await waitFor(() => expect(window.location.hash).toBe('#/v2/overview'));

    const toggle = screen.getByRole('switch', { name: '只看异常' });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    expect(screen.getByRole('heading', { level: 2, name: '今天需要你决定' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 2, name: '本周精选内容' })).toBeVisible();
  });

  it('shows six editable content fields, keyboard batch actions, and no pinned-comment surface', async () => {
    const user = userEvent.setup();
    render(<V2App />);
    await user.click(screen.getByRole('link', { name: '内容' }));
    expect(screen.getByRole('heading', { level: 1, name: '内容' })).toBeVisible();
    expect(screen.getByText(/内容包仅在受控预览确认后生成/u)).toBeVisible();
    expect(screen.getByRole('img', { name: /封面建议/u })).toHaveAttribute(
      'src',
      expect.stringContaining('morgue-cover.png'),
    );
    for (const label of ['标题', '正文', '建议日期时间', '标签（逗号分隔）', '素材说明'])
      expect(screen.getByLabelText(label)).toBeVisible();
    expect(screen.getByRole('button', { name: /批量通过/u })).toBeEnabled();
    expect(screen.getByRole('button', { name: /导出所选/u })).toBeEnabled();
    const selection = screen.getByRole('button', { name: /取消选择.*莫格街凶杀案/u });
    selection.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: /选择.*莫格街凶杀案/u })).toHaveFocus();
    expect(document.body).not.toHaveTextContent('置顶评论');
  });
});
