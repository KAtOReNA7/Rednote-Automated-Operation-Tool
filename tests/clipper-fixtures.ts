import {
  BROWSER_CLIP_CONTRACT_VERSION,
  type BrowserClipCreateV1,
} from '../packages/shared/src/index.js';

export const ONE_PIXEL_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

export function browserClipFixture(
  overrides: Partial<BrowserClipCreateV1> = {},
): BrowserClipCreateV1 {
  return {
    accountName: '推理观察员',
    browserFamily: 'CHROME',
    captureId: '11111111-1111-4111-8111-111111111111',
    capturedAt: '2026-07-28T08:00:00.000Z',
    contentTags: ['REVIEW', 'REFERENCE'],
    contractVersion: BROWSER_CLIP_CONTRACT_VERSION,
    extensionBuildVersion: '0.1.0',
    pageTitle: '公开页面样本',
    pageUrl: 'https://example.com/notes/1?source=public',
    platform: 'OTHER',
    publicPageConfirmed: true,
    publishedAt: '2026-07-27T08:00:00.000Z',
    screenshot: null,
    selectedText: '用户主动选择的公开文字',
    userNote: '仅保存为本地研究线索。',
    visibleMetrics: {
      comments: 3,
      favorites: 5,
      likes: 8,
      shares: null,
      views: 100,
    },
    ...overrides,
  };
}
