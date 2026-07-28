import { describe, expect, it, vi } from 'vitest';

import {
  ClipperController,
  type ChromeApiV1,
  validateInternalClipperMessage,
} from '../apps/clipper/src/service-worker.js';

describe('Issue 017 service-worker action boundary', () => {
  it('rejects non-extension senders and injects only into the active top frame in ISOLATED world', async () => {
    let listener:
      | ((
          message: unknown,
          sender: { readonly id?: string; readonly url?: string },
          respond: (response: unknown) => void,
        ) => boolean | undefined)
      | undefined;
    const executeScript = vi.fn().mockResolvedValue([
      {
        documentId: 'doc-1',
        frameId: 0,
        result: {
          capturedAt: '2026-07-28T08:00:00.000Z',
          documentIdentity: 'doc-1',
          pageTitle: 'Public sample',
          pageUrl: 'https://example.com/',
          selectedText: 'selected',
        },
      },
    ]);
    const api = {
      runtime: {
        getURL: () => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        onMessage: {
          addListener: (value: typeof listener) => {
            listener = value;
          },
        },
      },
      scripting: { executeScript },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          remove: vi.fn().mockResolvedValue(undefined),
          set: vi.fn().mockResolvedValue(undefined),
          setAccessLevel: vi.fn().mockResolvedValue(undefined),
        },
      },
      tabs: {
        captureVisibleTab: vi.fn(),
        query: vi
          .fn()
          .mockResolvedValue([
            { id: 7, windowId: 2, status: 'complete', url: 'https://example.com/' },
          ]),
      },
    } as unknown as ChromeApiV1;
    new ClipperController(api).install();

    const rejected = vi.fn();
    expect(
      listener?.({ kind: 'READ_PAGE' }, { id: 'foreign', url: 'https://evil.example/' }, rejected),
    ).toBe(false);
    expect(rejected).toHaveBeenCalledWith({ error: 'CLIPPER_INVALID_MESSAGE' });

    const accepted = vi.fn();
    expect(
      listener?.(
        { kind: 'READ_PAGE' },
        {
          id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html',
        },
        accepted,
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(accepted).toHaveBeenCalledOnce());
    expect(executeScript).toHaveBeenCalledWith({
      func: expect.any(Function),
      target: { allFrames: false, tabId: 7 },
      world: 'ISOLATED',
    });
  });

  it('uses an exact internal message schema', () => {
    expect(validateInternalClipperMessage({ kind: 'GET_STATE' })).toEqual({
      kind: 'GET_STATE',
    });
    expect(() => validateInternalClipperMessage({ kind: 'GET_STATE', extra: true })).toThrowError(
      'CLIPPER_INVALID_MESSAGE',
    );
    expect(() => validateInternalClipperMessage({ kind: 'READ_HTML' })).toThrowError(
      'CLIPPER_INVALID_MESSAGE',
    );
  });

  it('keeps an active credential in trusted storage while reporting an offline desktop app', async () => {
    let listener:
      | ((
          message: unknown,
          sender: { readonly id?: string; readonly url?: string },
          respond: (response: unknown) => void,
        ) => boolean | undefined)
      | undefined;
    const remove = vi.fn().mockResolvedValue(undefined);
    const api = {
      runtime: {
        getURL: () => 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/',
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        onMessage: {
          addListener: (value: typeof listener) => {
            listener = value;
          },
        },
      },
      scripting: { executeScript: vi.fn() },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            active: {
              attemptId: 'attempt',
              clientLabel: 'Chrome isolated smoke',
              endpoint: 'http://127.0.0.1:51731',
              token: 'a'.repeat(43),
            },
          }),
          remove,
          set: vi.fn().mockResolvedValue(undefined),
          setAccessLevel: vi.fn().mockResolvedValue(undefined),
        },
      },
      tabs: {
        captureVisibleTab: vi.fn(),
        query: vi.fn(),
      },
    } as unknown as ChromeApiV1;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
    new ClipperController(api).install();

    const respond = vi.fn();
    listener?.(
      { kind: 'GET_STATE' },
      {
        id: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        url: 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/popup.html',
      },
      respond,
    );
    await vi.waitFor(() =>
      expect(respond).toHaveBeenCalledWith({
        ok: {
          clientLabel: 'Chrome isolated smoke',
          endpoint: 'http://127.0.0.1:51731',
          paired: true,
          reauthRequired: false,
          state: 'APP_OFFLINE',
        },
      }),
    );
    expect(remove).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:51731/v1/status', {
      headers: {
        authorization: `Bearer ${'a'.repeat(43)}`,
        'x-rednote-extension-origin': 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    });
    fetchMock.mockRestore();
  });
});
