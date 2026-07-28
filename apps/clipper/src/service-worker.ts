import {
  BROWSER_CLIP_BUILD_VERSION,
  BROWSER_CLIP_CONTRACT_VERSION,
  BrowserClipContractError,
  type BrowserClipCreateV1,
  type BrowserClipResponseV1,
  type CapturedPageV1,
  validateBrowserClipCreateV1,
  validateClipperEndpoint,
} from '@mystery-operations/shared';

export const BROWSER_CLIPPER_STATES = Object.freeze([
  'UNPAIRED',
  'PAIRING',
  'PAIRED',
  'REAUTH_REQUIRED',
  'APP_DISABLED',
  'APP_OFFLINE',
  'APP_PORT_MISMATCH',
  'PAGE_UNSUPPORTED',
  'PAGE_READY',
  'CAPTURING',
  'READY_TO_SAVE',
  'SAVING',
  'SAVE_SUCCEEDED',
  'SAVE_FAILED',
  'SAVE_STATUS_UNKNOWN',
] as const);
export type BrowserClipperState = (typeof BROWSER_CLIPPER_STATES)[number];

interface ChromeTabV1 {
  readonly active?: boolean;
  readonly discarded?: boolean;
  readonly id?: number;
  readonly incognito?: boolean;
  readonly status?: string;
  readonly url?: string;
  readonly windowId?: number;
}

interface StoredCredentialV1 {
  readonly attemptId: string;
  readonly clientLabel: string;
  readonly endpoint: string;
  readonly token: string;
}

interface ClipperStorageV1 {
  readonly active?: StoredCredentialV1;
  readonly pending?: StoredCredentialV1;
}

interface ScriptResultV1 {
  readonly documentId?: string;
  readonly frameId: number;
  readonly result?: CapturedPageV1;
}

export interface ChromeApiV1 {
  readonly runtime: {
    readonly id: string;
    getURL(path: string): string;
    readonly onMessage: {
      addListener(
        listener: (
          message: unknown,
          sender: { readonly id?: string; readonly url?: string },
          respond: (response: unknown) => void,
        ) => boolean | undefined,
      ): void;
    };
  };
  readonly scripting: {
    executeScript(input: {
      readonly func: () => CapturedPageV1;
      readonly target: { readonly allFrames: false; readonly tabId: number };
      readonly world: 'ISOLATED';
    }): Promise<readonly ScriptResultV1[]>;
  };
  readonly storage: {
    readonly local: {
      get(keys: readonly string[]): Promise<ClipperStorageV1>;
      remove(keys: readonly string[]): Promise<void>;
      set(value: ClipperStorageV1): Promise<void>;
      setAccessLevel(options: { readonly accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
    };
  };
  readonly tabs: {
    captureVisibleTab(windowId: number, options: { readonly format: 'png' }): Promise<string>;
    query(query: { readonly active: true; readonly currentWindow: true }): Promise<ChromeTabV1[]>;
  };
}

export type ClipperInternalMessageV1 =
  | { readonly kind: 'CAPTURE_VISIBLE' }
  | { readonly kind: 'GET_STATE' }
  | {
      readonly kind: 'PAIR';
      readonly clientLabel: string;
      readonly endpoint: string;
      readonly pairingCode: string;
    }
  | { readonly kind: 'READ_PAGE' }
  | { readonly kind: 'SAVE_CLIP'; readonly clip: BrowserClipCreateV1 };

export interface ClipperPublicStateV1 {
  readonly clientLabel: string | null;
  readonly endpoint: string | null;
  readonly paired: boolean;
  readonly reauthRequired: boolean;
  readonly state: BrowserClipperState;
}

interface PageBindingV1 {
  readonly documentIdentity: string;
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly tabId: number;
  readonly windowId: number;
}

type AuthenticatedStatusV1 = 'OFFLINE' | 'OK' | 'UNAUTHORIZED';

const INTERNAL_KINDS = new Set(['CAPTURE_VISIBLE', 'GET_STATE', 'PAIR', 'READ_PAGE', 'SAVE_CLIP']);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/u;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\n') === [...expected].sort().join('\n');
}

export function validateInternalClipperMessage(value: unknown): ClipperInternalMessageV1 {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new BrowserClipContractError('CLIPPER_INVALID_MESSAGE');
  }
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== 'string' || !INTERNAL_KINDS.has(record.kind)) {
    throw new BrowserClipContractError('CLIPPER_INVALID_MESSAGE');
  }
  if (
    record.kind === 'GET_STATE' ||
    record.kind === 'READ_PAGE' ||
    record.kind === 'CAPTURE_VISIBLE'
  ) {
    if (!exactKeys(record, ['kind'])) {
      throw new BrowserClipContractError('CLIPPER_INVALID_MESSAGE');
    }
    return record as ClipperInternalMessageV1;
  }
  if (record.kind === 'PAIR') {
    if (
      !exactKeys(record, ['clientLabel', 'endpoint', 'kind', 'pairingCode']) ||
      typeof record.clientLabel !== 'string' ||
      record.clientLabel.length < 1 ||
      record.clientLabel.length > 120 ||
      typeof record.pairingCode !== 'string' ||
      !TOKEN_PATTERN.test(record.pairingCode)
    ) {
      throw new BrowserClipContractError('CLIPPER_INVALID_MESSAGE');
    }
    return {
      clientLabel: record.clientLabel,
      endpoint: validateClipperEndpoint(record.endpoint),
      kind: 'PAIR',
      pairingCode: record.pairingCode,
    };
  }
  if (!exactKeys(record, ['clip', 'kind'])) {
    throw new BrowserClipContractError('CLIPPER_INVALID_MESSAGE');
  }
  return { clip: validateBrowserClipCreateV1(record.clip), kind: 'SAVE_CLIP' };
}

function capturePage(): CapturedPageV1 {
  const selection = globalThis.getSelection?.()?.toString() ?? '';
  return {
    capturedAt: new Date().toISOString(),
    documentIdentity: `${performance.timeOrigin}:${location.href}`,
    pageTitle: document.title.normalize('NFC').slice(0, 512) || location.hostname,
    pageUrl: location.href,
    selectedText: selection.length === 0 ? null : selection.normalize('NFC').slice(0, 12_000),
  };
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function browserFamily(): BrowserClipCreateV1['browserFamily'] {
  if (navigator.userAgent.includes('Edg/')) return 'EDGE';
  if (navigator.userAgent.includes('Chrome/')) return 'CHROME';
  return 'CHROMIUM_UNKNOWN';
}

export class ClipperController {
  readonly #api: ChromeApiV1;

  public constructor(api: ChromeApiV1) {
    this.#api = api;
  }

  public install(): void {
    this.#api.runtime.onMessage.addListener((raw, sender, respond) => {
      const origin = this.#api.runtime.getURL('');
      if (
        sender.id !== this.#api.runtime.id ||
        typeof sender.url !== 'string' ||
        !sender.url.startsWith(origin)
      ) {
        respond({ error: 'CLIPPER_INVALID_MESSAGE' });
        return false;
      }
      let message: ClipperInternalMessageV1;
      try {
        message = validateInternalClipperMessage(raw);
      } catch (error) {
        respond({ error: this.#stableError(error) });
        return false;
      }
      void this.#handle(message).then(
        (value) => respond({ ok: value }),
        (error) => respond({ error: this.#stableError(error) }),
      );
      return true;
    });
  }

  async #handle(message: ClipperInternalMessageV1): Promise<unknown> {
    if (message.kind === 'GET_STATE') return this.#state();
    if (message.kind === 'PAIR') return this.#pair(message);
    if (message.kind === 'READ_PAGE') return this.#readPage();
    if (message.kind === 'CAPTURE_VISIBLE') return this.#captureVisible();
    return this.#save(message.clip);
  }

  async #setTrustedStorage(): Promise<void> {
    if (typeof this.#api.storage.local.setAccessLevel !== 'function') {
      throw new BrowserClipContractError('CLIPPER_STORAGE_UNTRUSTED');
    }
    await this.#api.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  }

  async #state(): Promise<ClipperPublicStateV1> {
    await this.#setTrustedStorage();
    const stored = await this.#api.storage.local.get(['active', 'pending']);
    if (stored.active !== undefined) {
      const status = await this.#authenticatedStatus(stored.active);
      if (status === 'UNAUTHORIZED') {
        await this.#api.storage.local.remove(['active']);
        return {
          clientLabel: stored.active.clientLabel,
          endpoint: stored.active.endpoint,
          paired: false,
          reauthRequired: true,
          state: 'REAUTH_REQUIRED',
        };
      }
      return {
        clientLabel: stored.active.clientLabel,
        endpoint: stored.active.endpoint,
        paired: true,
        reauthRequired: false,
        state: status === 'OK' ? 'PAIRED' : 'APP_OFFLINE',
      };
    }
    if (stored.pending !== undefined) {
      const status = await this.#authenticatedStatus(stored.pending);
      if (status === 'OK') {
        await this.#api.storage.local.set({ active: stored.pending });
        await this.#api.storage.local.remove(['pending']);
        return {
          clientLabel: stored.pending.clientLabel,
          endpoint: stored.pending.endpoint,
          paired: true,
          reauthRequired: false,
          state: 'PAIRED',
        };
      }
      if (status === 'OFFLINE') {
        return {
          clientLabel: stored.pending.clientLabel,
          endpoint: stored.pending.endpoint,
          paired: false,
          reauthRequired: false,
          state: 'APP_OFFLINE',
        };
      }
      await this.#api.storage.local.remove(['pending']);
      return {
        clientLabel: stored.pending.clientLabel,
        endpoint: stored.pending.endpoint,
        paired: false,
        reauthRequired: true,
        state: 'REAUTH_REQUIRED',
      };
    }
    return {
      clientLabel: null,
      endpoint: null,
      paired: false,
      reauthRequired: false,
      state: 'UNPAIRED',
    };
  }

  async #pair(
    message: Extract<ClipperInternalMessageV1, { kind: 'PAIR' }>,
  ): Promise<ClipperPublicStateV1> {
    await this.#setTrustedStorage();
    const pending: StoredCredentialV1 = {
      attemptId: crypto.randomUUID(),
      clientLabel: message.clientLabel,
      endpoint: message.endpoint,
      token: randomToken(),
    };
    await this.#api.storage.local.set({ pending });
    const extensionOrigin = this.#api.runtime.getURL('').replace(/\/$/u, '');
    let response: Response;
    try {
      response = await fetch(`${pending.endpoint}/v1/pairings/exchange`, {
        body: JSON.stringify({
          clientLabel: pending.clientLabel,
          clientToken: pending.token,
          extensionOrigin,
          pairingCode: message.pairingCode,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
    } catch {
      throw new BrowserClipContractError('CLIPPER_APP_OFFLINE');
    }
    if (!response.ok) {
      await this.#api.storage.local.remove(['pending']);
      throw new BrowserClipContractError(
        response.status === 401 ? 'CLIPPER_REAUTH_REQUIRED' : 'CLIPPER_APP_OFFLINE',
      );
    }
    await this.#api.storage.local.set({ active: pending });
    await this.#api.storage.local.remove(['pending']);
    return {
      clientLabel: pending.clientLabel,
      endpoint: pending.endpoint,
      paired: true,
      reauthRequired: false,
      state: 'PAIRED',
    };
  }

  async #activeTab(): Promise<ChromeTabV1 & { id: number; windowId: number }> {
    const [tab] = await this.#api.tabs.query({ active: true, currentWindow: true });
    if (
      tab === undefined ||
      tab.id === undefined ||
      tab.windowId === undefined ||
      tab.incognito === true ||
      tab.discarded === true ||
      tab.status !== 'complete'
    ) {
      throw new BrowserClipContractError('CLIPPER_PAGE_NOT_READY');
    }
    return { ...tab, id: tab.id, windowId: tab.windowId };
  }

  async #readBinding(): Promise<PageBindingV1 & { readonly selectedText: string | null }> {
    const tab = await this.#activeTab();
    const [result] = await this.#api.scripting.executeScript({
      func: capturePage,
      target: { allFrames: false, tabId: tab.id },
      world: 'ISOLATED',
    });
    if (result?.frameId !== 0 || result.result === undefined) {
      throw new BrowserClipContractError('CLIPPER_PAGE_UNSUPPORTED');
    }
    const page = result.result;
    return {
      documentIdentity: result.documentId ?? page.documentIdentity,
      pageTitle: page.pageTitle,
      pageUrl: page.pageUrl,
      selectedText: page.selectedText,
      tabId: tab.id,
      windowId: tab.windowId,
    };
  }

  async #readPage(): Promise<CapturedPageV1> {
    const binding = await this.#readBinding();
    return {
      capturedAt: new Date().toISOString(),
      documentIdentity: binding.documentIdentity,
      pageTitle: binding.pageTitle,
      pageUrl: binding.pageUrl,
      selectedText: binding.selectedText,
    };
  }

  async #captureVisible(): Promise<{ readonly dataUrl: string; readonly binding: CapturedPageV1 }> {
    const before = await this.#readBinding();
    const dataUrl = await this.#api.tabs.captureVisibleTab(before.windowId, { format: 'png' });
    const after = await this.#readBinding();
    if (
      before.tabId !== after.tabId ||
      before.documentIdentity !== after.documentIdentity ||
      before.pageUrl !== after.pageUrl
    ) {
      throw new BrowserClipContractError('CLIPPER_TAB_CHANGED');
    }
    return {
      binding: {
        capturedAt: new Date().toISOString(),
        documentIdentity: after.documentIdentity,
        pageTitle: after.pageTitle,
        pageUrl: after.pageUrl,
        selectedText: after.selectedText,
      },
      dataUrl,
    };
  }

  async #save(value: BrowserClipCreateV1): Promise<BrowserClipResponseV1> {
    const clip = validateBrowserClipCreateV1({
      ...value,
      browserFamily: browserFamily(),
      contractVersion: BROWSER_CLIP_CONTRACT_VERSION,
      extensionBuildVersion: BROWSER_CLIP_BUILD_VERSION,
    });
    const binding = await this.#readBinding();
    if (binding.pageUrl !== clip.pageUrl || binding.pageTitle !== clip.pageTitle) {
      throw new BrowserClipContractError('CLIPPER_TAB_CHANGED');
    }
    const stored = await this.#api.storage.local.get(['active']);
    if (stored.active === undefined) throw new BrowserClipContractError('CLIPPER_UNPAIRED');
    let response: Response;
    try {
      response = await fetch(`${stored.active.endpoint}/v1/browser-clips`, {
        body: JSON.stringify(clip),
        headers: {
          authorization: `Bearer ${stored.active.token}`,
          'content-type': 'application/json; charset=utf-8',
          'x-rednote-extension-origin': this.#api.runtime.getURL('').replace(/\/$/u, ''),
        },
        method: 'POST',
      });
    } catch {
      throw new BrowserClipContractError('CLIPPER_SAVE_STATUS_UNKNOWN');
    }
    if (response.status === 401) {
      await this.#api.storage.local.remove(['active']);
      throw new BrowserClipContractError('CLIPPER_REAUTH_REQUIRED');
    }
    if (!response.ok) {
      if (response.status === 409) {
        throw new BrowserClipContractError('CLIPPER_CAPTURE_CONFLICT');
      }
      if (response.status === 429) {
        throw new BrowserClipContractError('CLIPPER_RATE_LIMITED');
      }
      throw new BrowserClipContractError('CLIPPER_SAVE_STATUS_UNKNOWN');
    }
    return (await response.json()) as BrowserClipResponseV1;
  }

  async #authenticatedStatus(credential: StoredCredentialV1): Promise<AuthenticatedStatusV1> {
    try {
      const response = await fetch(`${credential.endpoint}/v1/status`, {
        headers: {
          authorization: `Bearer ${credential.token}`,
          'x-rednote-extension-origin': this.#api.runtime.getURL('').replace(/\/$/u, ''),
        },
      });
      if (response.ok) return 'OK';
      return response.status === 401 ? 'UNAUTHORIZED' : 'OFFLINE';
    } catch {
      return 'OFFLINE';
    }
  }

  #stableError(error: unknown): string {
    return error instanceof BrowserClipContractError ? error.code : 'CLIPPER_INTERNAL';
  }
}

declare const chrome: ChromeApiV1 | undefined;
if (typeof chrome !== 'undefined') new ClipperController(chrome).install();
