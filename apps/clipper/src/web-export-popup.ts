interface CapturedPublicPage {
  readonly capturedAt: string;
  readonly pageTitle: string;
  readonly selectedText: string | null;
  readonly sourceUrl: string;
}

declare const chrome: {
  readonly runtime: {
    sendMessage(value: unknown): Promise<{ readonly error?: string; readonly ok?: unknown }>;
  };
};

const byId = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (value === null) throw new Error(`CLIPPER_UI_MISSING:${id}`);
  return value as T;
};

const status = byId<HTMLElement>('status');
const form = byId<HTMLFormElement>('clip-form');
const preview = byId<HTMLImageElement>('screenshot-preview');
let page: CapturedPublicPage | null = null;
let screenshotDataUrl: string | null = null;

function show(value: string, error = false): void {
  status.textContent = value;
  status.dataset.kind = error ? 'error' : 'info';
}

async function message<T>(value: unknown): Promise<T> {
  const response = await chrome.runtime.sendMessage(value);
  if (response.error !== undefined) throw new Error(response.error);
  return response.ok as T;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function checkedText(value: string, maximumBytes: number, label: string): string | null {
  const normalized = value.normalize('NFC').trim();
  if (normalized === '') return null;
  if (new TextEncoder().encode(normalized).byteLength > maximumBytes)
    throw new Error(`${label}超过本地导入上限，请缩短后再下载。`);
  return normalized;
}

async function initialize(): Promise<void> {
  show('正在读取当前公开页面…');
  page = await message<CapturedPublicPage>({ kind: 'READ_PAGE' });
  byId<HTMLInputElement>('page-url').value = page.sourceUrl;
  byId<HTMLInputElement>('page-title').value = page.pageTitle;
  byId<HTMLTextAreaElement>('selected-text').value = page.selectedText ?? '';
  form.hidden = false;
  show('页面已就绪。导出前请确认字段；扩展不会连接本地服务或云端。');
}

byId<HTMLButtonElement>('capture').addEventListener('click', () => {
  void (async () => {
    const result = await message<{
      readonly page: CapturedPublicPage;
      readonly screenshotDataUrl: string;
    }>({ kind: 'CAPTURE_VISIBLE' });
    page = result.page;
    screenshotDataUrl = result.screenshotDataUrl;
    preview.src = screenshotDataUrl;
    preview.hidden = false;
    byId<HTMLButtonElement>('remove-screenshot').hidden = false;
    show('当前可见区域截图已加入；关闭弹窗会丢弃未下载数据。');
  })().catch((error: unknown) => show((error as Error).message, true));
});

byId<HTMLButtonElement>('remove-screenshot').addEventListener('click', () => {
  screenshotDataUrl = null;
  preview.hidden = true;
  preview.removeAttribute('src');
  byId<HTMLButtonElement>('remove-screenshot').hidden = true;
  show('截图已移除。');
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  void (async () => {
    if (page === null || !byId<HTMLInputElement>('public-confirmed').checked)
      throw new Error('请确认这是你主动选择保存的公开页面。');
    const sourceUrl = page.sourceUrl;
    const pageTitle = checkedText(byId<HTMLInputElement>('page-title').value, 512, '页面标题');
    if (pageTitle === null) throw new Error('页面标题不能为空。');
    const clip = {
      capturedAt: page.capturedAt,
      clipIdentity: await sha256(sourceUrl),
      format: 'rednote-web-clip',
      pageTitle,
      screenshotDataUrl,
      selectedText: checkedText(
        byId<HTMLTextAreaElement>('selected-text').value,
        12_000,
        '选中文本',
      ),
      sourceUrl,
      userNote: checkedText(byId<HTMLTextAreaElement>('user-note').value, 4_000, '备注'),
      version: 1,
    } as const;
    const serialized = `${JSON.stringify(clip, null, 2)}\n`;
    if (new TextEncoder().encode(serialized).byteLength > 768 * 1024)
      throw new Error('导出文件超过本地导入上限，请移除截图或缩短文本。');
    const blob = new Blob([serialized], {
      type: 'application/json',
    });
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = `${new URL(sourceUrl).hostname}-${clip.clipIdentity.slice(0, 12)}.rednote-clip.json`;
    link.href = href;
    link.click();
    URL.revokeObjectURL(href);
    show('文件已下载。请在 Rednote Web 的书库页明确预览并确认导入。');
  })().catch((error: unknown) => show((error as Error).message, true));
});

void initialize().catch((error: unknown) => show((error as Error).message, true));
