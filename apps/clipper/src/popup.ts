import {
  BROWSER_CLIP_BUILD_VERSION,
  BROWSER_CLIP_CONTRACT_VERSION,
  type BrowserClipCreateV1,
  type BrowserClipVisibleMetricsV1,
  type CapturedPageV1,
} from '@mystery-operations/shared';

interface RuntimeApi {
  sendMessage(message: unknown): Promise<{ readonly error?: string; readonly ok?: unknown }>;
}
declare const chrome: { readonly runtime: RuntimeApi };

const byId = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`Missing popup element ${id}`);
  return value as T;
};

const status = byId<HTMLElement>('status');
const pairing = byId<HTMLElement>('pairing');
const form = byId<HTMLFormElement>('clip-form');
const screenshotPreview = byId<HTMLImageElement>('screenshot-preview');
let page: CapturedPageV1 | null = null;
let screenshotDataUrl: string | null = null;

async function message<T>(value: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(value);
  if (response.error !== undefined) throw new Error(response.error);
  return response.ok as T;
}

function show(text: string, error = false): void {
  status.textContent = text;
  status.dataset.kind = error ? 'error' : 'info';
}

function optional(id: string): string | null {
  const value = byId<HTMLInputElement>(id).value.normalize('NFC').trim();
  return value === '' ? null : value;
}

function metrics(): BrowserClipVisibleMetricsV1 {
  const read = (id: string): number | null => {
    const value = byId<HTMLInputElement>(id).value;
    return value === '' ? null : Number(value);
  };
  return {
    comments: read('comments'),
    favorites: read('favorites'),
    likes: read('likes'),
    shares: read('shares'),
    views: read('views'),
  };
}

async function initialize(): Promise<void> {
  show('正在检查本地应用连接…');
  const state = await message<{
    readonly paired: boolean;
    readonly reauthRequired: boolean;
    readonly state: string;
  }>({ kind: 'GET_STATE' });
  if (state.state === 'APP_OFFLINE') {
    pairing.hidden = true;
    form.hidden = true;
    show('桌面应用当前离线。请启动桌面应用并启用本地 API，然后重新打开此弹窗。', true);
    return;
  }
  pairing.hidden = state.paired;
  form.hidden = !state.paired;
  if (!state.paired) {
    show(
      state.reauthRequired
        ? '配对已失效。请在桌面应用重新生成配对信息。'
        : '尚未配对。请在桌面应用启用本地 API 并输入配对信息。',
    );
    return;
  }
  page = await message<CapturedPageV1>({ kind: 'READ_PAGE' });
  byId<HTMLInputElement>('page-url').value = page.pageUrl;
  byId<HTMLInputElement>('page-title').value = page.pageTitle;
  byId<HTMLTextAreaElement>('selected-text').value = page.selectedText ?? '';
  show('页面已就绪。确认字段后可保存公开页面样本。');
}

byId<HTMLFormElement>('pair-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    show('正在配对…');
    await message({
      clientLabel: byId<HTMLInputElement>('client-label').value,
      endpoint: byId<HTMLInputElement>('endpoint').value,
      kind: 'PAIR',
      pairingCode: byId<HTMLInputElement>('pairing-code').value,
    });
    byId<HTMLInputElement>('pairing-code').value = '';
    await initialize();
  })().catch((error: unknown) => show(`配对失败：${String((error as Error).message)}`, true));
});

byId<HTMLButtonElement>('capture').addEventListener('click', () => {
  void (async () => {
    show('正在截取当前可见区域…');
    const result = await message<{ readonly dataUrl: string; readonly binding: CapturedPageV1 }>({
      kind: 'CAPTURE_VISIBLE',
    });
    page = result.binding;
    screenshotDataUrl = result.dataUrl;
    screenshotPreview.src = result.dataUrl;
    screenshotPreview.hidden = false;
    byId<HTMLButtonElement>('remove-screenshot').hidden = false;
    show('截图已加入本次保存；关闭弹窗会自动丢弃。');
  })().catch((error: unknown) => show(`截图失败：${String((error as Error).message)}`, true));
});

byId<HTMLButtonElement>('remove-screenshot').addEventListener('click', () => {
  screenshotDataUrl = null;
  screenshotPreview.removeAttribute('src');
  screenshotPreview.hidden = true;
  byId<HTMLButtonElement>('remove-screenshot').hidden = true;
  show('截图已移除。');
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    if (page === null || !byId<HTMLInputElement>('public-confirmed').checked) {
      throw new Error('请先确认这是主动选择保存的公开页面样本。');
    }
    const tags = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name=tag]:checked'),
    ).map((input) => input.value) as BrowserClipCreateV1['contentTags'];
    const clip: BrowserClipCreateV1 = {
      accountName: optional('account-name'),
      browserFamily: 'CHROMIUM_UNKNOWN',
      captureId: crypto.randomUUID(),
      capturedAt: new Date().toISOString(),
      contentTags: tags,
      contractVersion: BROWSER_CLIP_CONTRACT_VERSION,
      extensionBuildVersion: BROWSER_CLIP_BUILD_VERSION,
      pageTitle: byId<HTMLInputElement>('page-title').value.normalize('NFC'),
      pageUrl: page.pageUrl,
      platform: byId<HTMLSelectElement>('platform').value as BrowserClipCreateV1['platform'],
      publicPageConfirmed: true,
      publishedAt: optional('published-at'),
      screenshot: screenshotDataUrl === null ? null : { dataUrl: screenshotDataUrl },
      selectedText: optional('selected-text'),
      userNote: optional('user-note'),
      visibleMetrics: metrics(),
    };
    show('正在保存…');
    const result = await message<{ readonly receipt: { readonly clipId: string } }>({
      clip,
      kind: 'SAVE_CLIP',
    });
    screenshotDataUrl = null;
    form.reset();
    show(`保存成功：${result.receipt.clipId}`);
  })().catch((error: unknown) => show(`保存失败：${String((error as Error).message)}`, true));
});

void initialize().catch((error: unknown) =>
  show(`无法读取当前页面：${String((error as Error).message)}`, true),
);
