import { describe, expect, it, vi } from 'vitest';

import {
  BrowserChatCompletionsProvider,
  type BrowserTextRequest,
} from '../apps/web-ui/src/v2/web/browser-provider.js';
import { textSha256 } from '../packages/providers/src/codecs/text-sha256.js';
import { PROVIDER_LIMITS } from '../packages/providers/src/response-limits.js';

const REQUEST: BrowserTextRequest = {
  apiKey: 'synthetic-browser-key',
  baseUrl: 'https://provider.invalid/v1',
  modelId: 'synthetic-model',
  purpose: 'REPLY_SUGGESTION',
  system: '只返回文本',
  user: '合成输入',
};

function jsonResponse(
  status = 200,
  body: unknown = {
    choices: [{ finish_reason: 'stop', message: { content: '合成输出' } }],
    id: 'request-safe',
    usage: { completion_tokens: 2, prompt_tokens: 3, total_tokens: 5 },
  },
): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json', 'x-request-id': 'header-safe' },
    status,
  });
}

describe('browser-only Provider transport W2-18..W2-24/W2-30', () => {
  it('uses one HTTPS Chat Completions request with existing codec and no retry', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse());
    const provider = new BrowserChatCompletionsProvider({
      createRequestId: () => 'local-request',
      fetch: fetchMock,
      now: (() => {
        let value = 10;
        return () => value++;
      })(),
    });
    await expect(provider.generate(REQUEST)).resolves.toMatchObject({
      modelId: 'synthetic-model',
      protocolMode: 'CHAT_COMPLETIONS',
      text: '合成输出',
      usage: { inputTokens: 3, outputTokens: 2 },
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('https://provider.invalid/v1/chat/completions');
    expect(init).toMatchObject({
      cache: 'no-store',
      credentials: 'omit',
      method: 'POST',
      redirect: 'error',
      referrerPolicy: 'no-referrer',
    });
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: 'synthetic-model',
      stream: false,
    });
    expect(JSON.stringify(init)).not.toContain('Search');
  });

  it.each([
    [401, 'PROVIDER_UPSTREAM_4XX'],
    [403, 'PROVIDER_UPSTREAM_4XX'],
    [429, 'PROVIDER_RATE_LIMITED'],
    [503, 'PROVIDER_UPSTREAM_5XX'],
  ] as const)('maps HTTP %s to %s without response body egress', async (status, code) => {
    const provider = new BrowserChatCompletionsProvider({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(jsonResponse(status, { secret: 'discarded' })),
    });
    await expect(provider.generate(REQUEST)).rejects.toMatchObject({
      code,
      details: { httpStatus: status },
      retryDisposition: 'DO_NOT_RETRY',
    });
  });

  it('fails closed for offline, non-JSON, invalid JSON and abort without exposing the key', async () => {
    const offline = new BrowserChatCompletionsProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockRejectedValue(new TypeError('offline synthetic-browser-key')),
    });
    const offlineError = await offline.generate(REQUEST).catch((error: unknown) => error);
    expect(offlineError).toMatchObject({ code: 'PROVIDER_NETWORK_UNREACHABLE' });
    expect(JSON.stringify(offlineError)).not.toContain(REQUEST.apiKey);

    const html = new BrowserChatCompletionsProvider({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response('<html>bad</html>', {
          headers: { 'content-type': 'text/html' },
          status: 200,
        }),
      ),
    });
    await expect(html.generate(REQUEST)).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_CONTENT_TYPE',
    });

    const invalid = new BrowserChatCompletionsProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('{bad', { headers: { 'content-type': 'application/json' }, status: 200 }),
        ),
    });
    await expect(invalid.generate(REQUEST)).rejects.toMatchObject({
      code: 'PROVIDER_INVALID_JSON',
      details: { contentHash: textSha256('{bad') },
    });

    const aborted = new AbortController();
    aborted.abort();
    const never = new BrowserChatCompletionsProvider({
      fetch: vi.fn<typeof fetch>().mockImplementation(
        (_url, init) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('abort', 'AbortError')),
            );
          }),
      ),
      timeoutMs: 5,
    });
    await expect(never.generate({ ...REQUEST, signal: aborted.signal })).rejects.toMatchObject({
      code: 'PROVIDER_ABORTED',
    });
  });

  it('refuses non-HTTPS endpoints before fetch', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const provider = new BrowserChatCompletionsProvider({ fetch: fetchMock });
    await expect(
      provider.generate({ ...REQUEST, baseUrl: 'http://provider.invalid/v1' }),
    ).rejects.toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('bounds response headers and body before decoding', async () => {
    const largeHeader = new BrowserChatCompletionsProvider({
      fetch: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          new Response('{}', { headers: { 'x-bounded': 'x'.repeat(40_000) }, status: 200 }),
        ),
    });
    await expect(largeHeader.generate(REQUEST)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_TOO_LARGE',
    });

    const largeBody = new BrowserChatCompletionsProvider({
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response(new Uint8Array(PROVIDER_LIMITS.maxResponseBodyBytes + 1), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      ),
    });
    await expect(largeBody.generate(REQUEST)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_TOO_LARGE',
      outcomeCertainty: 'COMPLETED_INVALID_OUTPUT',
    });
  });
});
