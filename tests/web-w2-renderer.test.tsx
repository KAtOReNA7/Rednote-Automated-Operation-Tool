// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { WebWorkspaceShell } from '../apps/web-ui/src/v2/web/web-app.js';
import { BrowserWorkspaceRepository } from '../apps/web-ui/src/v2/web/repository.js';
import { WebWorkspaceRuntime } from '../apps/web-ui/src/v2/web/runtime.js';
import { textSha256 } from '../packages/providers/src/codecs/text-sha256.js';
import { MemoryFolder, MemoryLock } from './support/web-folder-fixture.js';

const runtimes: WebWorkspaceRuntime[] = [];

async function preparedRuntime(): Promise<{ folder: MemoryFolder; runtime: WebWorkspaceRuntime }> {
  const folder = new MemoryFolder();
  let token = 0;
  const runtime = await WebWorkspaceRuntime.connectPort(
    new BrowserWorkspaceRepository(folder, {
      createId: () => 'ws_w2rendererworkspace000001',
      lock: new MemoryLock(),
      now: () => new Date('2026-08-23T08:00:00.000Z'),
    }),
    {
      channelFactory: () => null,
      createToken: () => `renderer-token-${String(++token)}`,
      nowMs: () => Date.parse('2026-08-23T08:00:00.000Z'),
    },
  );
  runtimes.push(runtime);
  await runtime.ensurePlan();
  await runtime.saveBrief('合成 W2 renderer Brief');
  await runtime.confirmAllCandidates();
  await runtime.lockPlan();
  const candidateId = runtime.queue()[0]?.candidate.id;
  if (candidateId === undefined) throw new Error('missing candidate');
  await runtime.executeGeneration((await runtime.previewGeneration([candidateId])).token);
  const content = runtime.queue()[0]?.package;
  if (content === null || content === undefined) throw new Error('missing content');
  await runtime.approveContent(content.id, content.revision);
  await runtime.createInteraction({
    kind: 'COMMENT',
    relatedContentPackageId: content.id,
    userText: '合成公开评论',
  });
  const catalog = await runtime.previewLibraryImport(
    JSON.stringify({
      format: 'rednote-web-catalog',
      items: [
        {
          author: '合成作者',
          id: 'catalog-renderer-1',
          sourcePath: null,
          summary: '合成摘要',
          title: '合成作品',
        },
      ],
      version: 1,
    }),
    'CATALOG',
  );
  await runtime.confirmLibraryImport(catalog.token);
  await runtime.saveMetric({
    collections: 1,
    comments: 1,
    likes: 2,
    newFollowers: 1,
    packageId: content.id,
    publishedAt: '2026-08-23T08:00:00.000Z',
    snapshotWindow: '7D',
    views: 120,
  });
  return { folder, runtime };
}

afterEach(() => {
  cleanup();
  for (const runtime of runtimes.splice(0)) runtime.close();
});

describe('Web W2 seven-page renderer W2-03/W2-06/W2-26/W2-27', () => {
  it('renders all seven routes from one authoritative runtime with visible headings and live status', async () => {
    const { runtime } = await preparedRuntime();
    const setRoute = vi.fn();
    const routes = [
      ['overview', '总览'],
      ['weekly-plan', runtime.activeWeekHeading()],
      ['content', '内容'],
      ['interaction', '互动'],
      ['library', '书库'],
      ['review', '数据复盘'],
      ['settings', '设置'],
    ] as const;
    const rendered = render(
      <WebWorkspaceShell route="overview" runtime={runtime} setRoute={setRoute} />,
    );
    for (const [route, heading] of routes) {
      rendered.rerender(<WebWorkspaceShell route={route} runtime={runtime} setRoute={setRoute} />);
      expect(screen.getByRole('heading', { level: 1, name: heading })).toBeVisible();
      expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
      expect(
        screen.getByRole('link', { name: route === 'weekly-plan' ? '本周计划' : heading }),
      ).toHaveAttribute('aria-current', 'page');
    }
    expect(screen.getByText('未配置', { selector: 'dd' })).toBeInTheDocument();
  });

  it('keeps the session key out of DOM attributes, persisted snapshots, and diagnostics', async () => {
    const user = userEvent.setup();
    const { folder, runtime } = await preparedRuntime();
    const rendered = render(
      <WebWorkspaceShell route="settings" runtime={runtime} setRoute={vi.fn()} />,
    );
    const secret = `synthetic-${textSha256('renderer-secret').slice(0, 24)}`;
    await user.type(screen.getByLabelText('本次会话 API key（永不回显）'), secret);
    await user.click(screen.getByRole('button', { name: '仅存入页面内存' }));
    expect(screen.getByLabelText('本次会话 API key（永不回显）')).toHaveValue('');
    expect(rendered.container.innerHTML).not.toContain(secret);
    expect(JSON.stringify(runtime.diagnostics())).not.toContain(secret);
    expect(
      [...folder.files.values()].map((value) => new TextDecoder().decode(value)).join('\n'),
    ).not.toContain(secret);
  });

  it('keeps interaction actions local and exposes an actionable AI blocker preview', async () => {
    const user = userEvent.setup();
    const { runtime } = await preparedRuntime();
    render(<WebWorkspaceShell route="interaction" runtime={runtime} setRoute={vi.fn()} />);
    expect(screen.getByText(/产品不存在平台写入路径/u)).toBeVisible();
    expect(screen.queryByRole('button', { name: /发送到|自动发送|登录平台/u })).toBeNull();
    await user.click(screen.getByRole('button', { name: '预览 AI 回复' }));
    const preview = await screen.findByRole('region', { name: 'AI 调用预览' });
    expect(within(preview).getByText('调用被本地条件阻止')).toBeVisible();
    expect(within(preview).getByRole('button', { name: '确认并执行一次' })).toBeDisabled();
    expect(within(preview).getByText('尚未配置 HTTPS Base URL。')).toBeVisible();
  });
});
