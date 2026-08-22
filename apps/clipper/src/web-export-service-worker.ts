interface CapturedPublicPage {
  readonly capturedAt: string;
  readonly pageTitle: string;
  readonly selectedText: string | null;
  readonly sourceUrl: string;
}

interface ChromeTab {
  readonly id?: number;
  readonly incognito?: boolean;
  readonly url?: string;
  readonly windowId?: number;
}

interface ChromeApi {
  readonly runtime: {
    readonly id: string;
    getURL(path: string): string;
    readonly onMessage: {
      addListener(
        listener: (
          value: unknown,
          sender: { readonly id?: string; readonly url?: string },
          respond: (value: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
  readonly scripting: {
    executeScript(input: {
      readonly func: () => CapturedPublicPage;
      readonly target: { readonly allFrames: false; readonly tabId: number };
      readonly world: 'ISOLATED';
    }): Promise<readonly { readonly frameId: number; readonly result?: CapturedPublicPage }[]>;
  };
  readonly tabs: {
    captureVisibleTab(windowId: number, options: { readonly format: 'png' }): Promise<string>;
    query(query: { readonly active: true; readonly currentWindow: true }): Promise<ChromeTab[]>;
  };
}

declare const chrome: ChromeApi;

function capturePage(): CapturedPublicPage {
  const boundedUtf8 = (value: string, maximumBytes: number): string => {
    if (new TextEncoder().encode(value).byteLength <= maximumBytes) return value;
    let result = '';
    for (const character of value) {
      const next = result + character;
      if (new TextEncoder().encode(next).byteLength > maximumBytes) break;
      result = next;
    }
    return result;
  };
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  const selected = globalThis.getSelection?.()?.toString().normalize('NFC').trim() ?? '';
  return {
    capturedAt: new Date().toISOString(),
    pageTitle: boundedUtf8(document.title.normalize('NFC').trim() || location.hostname, 512),
    selectedText: selected === '' ? null : boundedUtf8(selected, 12_000),
    sourceUrl: url.toString(),
  };
}

async function activeTab(): Promise<Required<Pick<ChromeTab, 'id' | 'windowId'>> & ChromeTab> {
  const tab = (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  if (
    tab?.id === undefined ||
    tab.windowId === undefined ||
    tab.incognito === true ||
    typeof tab.url !== 'string' ||
    new URL(tab.url).protocol !== 'https:'
  )
    throw new Error('CLIPPER_PAGE_UNSUPPORTED');
  return tab as Required<Pick<ChromeTab, 'id' | 'windowId'>> & ChromeTab;
}

async function readPage(): Promise<CapturedPublicPage> {
  const tab = await activeTab();
  const frames = await chrome.scripting.executeScript({
    func: capturePage,
    target: { allFrames: false, tabId: tab.id },
    world: 'ISOLATED',
  });
  const result = frames.find((frame) => frame.frameId === 0)?.result;
  if (result === undefined || new URL(result.sourceUrl).protocol !== 'https:')
    throw new Error('CLIPPER_PAGE_UNSUPPORTED');
  return result;
}

chrome.runtime.onMessage.addListener((value, sender, respond) => {
  if (
    sender.id !== chrome.runtime.id ||
    typeof sender.url !== 'string' ||
    !sender.url.startsWith(chrome.runtime.getURL('')) ||
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.keys(value).sort().join() !== 'kind'
  ) {
    respond({ error: 'CLIPPER_INVALID_MESSAGE' });
    return false;
  }
  const kind = (value as { kind?: unknown }).kind;
  void (async () => {
    if (kind === 'READ_PAGE') return readPage();
    if (kind === 'CAPTURE_VISIBLE') {
      const tab = await activeTab();
      const page = await readPage();
      const screenshotDataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, {
        format: 'png',
      });
      if (
        screenshotDataUrl.length > 512 * 1024 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(screenshotDataUrl)
      )
        throw new Error('CLIPPER_SCREENSHOT_TOO_LARGE');
      return { page, screenshotDataUrl };
    }
    throw new Error('CLIPPER_INVALID_MESSAGE');
  })().then(
    (result) => respond({ ok: result }),
    (error: unknown) =>
      respond({ error: error instanceof Error ? error.message.slice(0, 80) : 'CLIPPER_FAILED' }),
  );
  return true;
});
