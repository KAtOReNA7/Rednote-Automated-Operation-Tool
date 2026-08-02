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

    expect(screen.getByText('模拟数据 · 未连接真实服务')).toBeVisible();
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
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(route.label);
    }
  });

  it('controls unknown routes and supports switch, drawer, Escape, and focus return', async () => {
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

    const review = screen.getByRole('button', { name: /《莫格街凶杀案》.*查看/u });
    await user.click(review);
    expect(screen.getByRole('dialog', { name: '《莫格街凶杀案》' })).toBeVisible();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(review).toHaveFocus();
  });

  it('shows six content fields, approved covers, and no pinned-comment surface', async () => {
    const user = userEvent.setup();
    render(<V2App />);
    await user.click(screen.getByRole('link', { name: '内容' }));
    expect(screen.getByRole('heading', { level: 1, name: '内容' })).toBeVisible();
    expect(screen.getByRole('img', { name: /封面建议/u })).toHaveAttribute(
      'src',
      expect.stringContaining('morgue-cover.png'),
    );
    expect(screen.getByLabelText('标题')).toBeVisible();
    expect(screen.getByLabelText('正文')).toBeVisible();
    for (const label of ['建议发布时间', '标签', '素材说明']) {
      expect(screen.getByText(label)).toBeVisible();
    }
    expect(document.body).not.toHaveTextContent('置顶评论');
  });
});
