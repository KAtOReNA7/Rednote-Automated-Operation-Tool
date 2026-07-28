// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BrowserClipLibrary } from '../apps/web-ui/src/browser-clip-library.js';
import type { BrowserClipView, DesktopBridge } from '../packages/shared/src/index.js';

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'rednoteDesktop');
});

const clip: BrowserClipView = {
  accountName: '公开账号',
  candidateId: 'candidate-browser-1',
  capturedAt: '2026-07-28T08:00:00.000Z',
  clientLabel: 'Chrome 侧载',
  clipId: 'clip-renderer-1',
  displayHost: 'example.com',
  hasScreenshot: true,
  pageTitle: '<img src=x onerror=alert(1)>',
  pageUrl: 'https://example.com/public',
  platform: 'OTHER',
  publishedAt: null,
  selectedText: '<script>window.pwned=true</script>',
  tags: ['REFERENCE'],
  userNote: '<b>must remain text</b>',
  visibleMetrics: { likes: 8 },
};

describe('Issue 017 read-only desktop clip library', () => {
  it('renders untrusted clip fields as text and uses only the opaque screenshot protocol URL', async () => {
    const bridge = {
      listBrowserClips: vi.fn().mockResolvedValue({ ok: true, value: [clip] }),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    const { container } = render(<BrowserClipLibrary />);

    expect(await screen.findAllByText(clip.pageTitle)).toHaveLength(2);
    expect(screen.getByText('<script>window.pwned=true</script>')).toBeInTheDocument();
    expect(screen.getByText('<b>must remain text</b>')).toBeInTheDocument();
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('img[onerror]')).toBeNull();
    expect(screen.getByRole('img')).toHaveAttribute(
      'src',
      'rednote://app/clip-screenshot/clip-renderer-1',
    );
    expect(document.body.textContent).not.toMatch(/sources\/screenshots|[A-Z]:\\/u);
  });

  it('shows bounded loading, error, and empty states without write controls', async () => {
    const bridge = {
      listBrowserClips: vi.fn().mockResolvedValue({ ok: true, value: [] }),
    } as unknown as DesktopBridge;
    Object.defineProperty(window, 'rednoteDesktop', { configurable: true, value: bridge });
    render(<BrowserClipLibrary />);
    await screen.findByText(/尚无|鏆傛棤|灏氭棤/u);
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
