import { describe, expect, it } from 'vitest';

import {
  FETCH_LIMITS,
  decodeFetchBody,
  processFetchedContent,
  validateExtractedText,
  validateSanitizedHtml,
} from '../packages/fetch/src/index.js';

const limits = {
  domDepth: FETCH_LIMITS.domDepth,
  domNodes: FETCH_LIMITS.domNodes,
  sanitizedBytes: FETCH_LIMITS.sanitizedBytes,
  textBytes: FETCH_LIMITS.textBytes,
};

describe('deterministic HTML sanitization and extraction', () => {
  it('removes active content, resource attributes and non-body regions', () => {
    const html = `<!doctype html><html><body>
      <nav>导航与跟踪链接</nav>
      <main id="story" class="content" onclick="steal()">
        <h1>密室推理研究资料</h1>
        <p style="background:url(https://tracker.invalid/pixel)">
          这是一段只用于测试的公开页面正文，包含足够多的确定性文字，以验证正文抽取不会退回完整 DOM。
          联系邮箱 editor@example.test，联系电话：+86 138 0013 8000。
        </p>
        <script>fetch('https://evil.invalid')</script>
        <iframe src="https://evil.invalid/frame"></iframe>
        <a href="javascript:alert(1)">保留文字但删除导航能力</a>
      </main>
      <aside class="comments">用户评论：不应保存</aside>
    </body></html>`;
    const first = processFetchedContent({
      body: Buffer.from(html, 'utf8'),
      declaredCharset: 'utf-8',
      limits,
      mimeType: 'text/html',
    });
    const second = processFetchedContent({
      body: Buffer.from(html, 'utf8'),
      declaredCharset: 'utf-8',
      limits,
      mimeType: 'text/html',
    });
    expect(first).toEqual(second);
    expect(first.sanitizedHtml).toContain('<main>');
    expect(first.sanitizedHtml).not.toMatch(/script|iframe|onclick|style=|href=|https?:\/\//u);
    expect(first.extractedText).not.toContain('用户评论');
    expect(first.extractedText).toContain('[已移除邮箱]');
    expect(first.extractedText).toContain('[已移除电话]');
    expect(first.redactionCounts).toEqual({ addresses: 0, emails: 1, phones: 1 });
    expect(first.rawBodyHash).not.toBe(first.sanitizedHtmlHash);
  });

  it('decodes UTF-8, GB18030 Chinese and Shift_JIS Japanese deterministically', () => {
    expect(
      decodeFetchBody({
        body: Buffer.from('中文与日本語', 'utf8'),
        declaredCharset: 'utf-8',
        mimeType: 'text/plain',
      }).text,
    ).toBe('中文与日本語');
    expect(
      decodeFetchBody({
        body: Uint8Array.from([0xd6, 0xd0, 0xce, 0xc4]),
        declaredCharset: 'gb18030',
        mimeType: 'text/plain',
      }).text,
    ).toBe('中文');
    expect(
      decodeFetchBody({
        body: Uint8Array.from([0x93, 0xfa, 0x96, 0x7b]),
        declaredCharset: 'shift_jis',
        mimeType: 'text/plain',
      }).text,
    ).toBe('日本');
  });

  it('fails on charset conflict, active output, weak extraction and privacy ambiguity', () => {
    const conflict = Buffer.from(
      '<meta charset="gb18030"><main><p>long enough content</p></main>',
      'utf8',
    );
    expect(() =>
      decodeFetchBody({
        body: conflict,
        declaredCharset: 'utf-8',
        mimeType: 'text/html',
      }),
    ).toThrow('FETCH_DECODE_FAILED');
    expect(() => validateSanitizedHtml('<p><img src="https://x.invalid/a"></p>', 1_000)).toThrow(
      'FETCH_SANITIZE_FAILED',
    );
    expect(() => validateExtractedText('too short', 1_000)).toThrow('FETCH_EXTRACTION_EMPTY');
    expect(() =>
      processFetchedContent({
        body: Buffer.from(
          '<html><body><section class="comments">用户评论与留言板内容很多，但没有明确正文边界。</section></body></html>',
          'utf8',
        ),
        declaredCharset: 'utf-8',
        limits,
        mimeType: 'text/html',
      }),
    ).toThrow('FETCH_PRIVACY_REVIEW_REQUIRED');
    expect(() =>
      processFetchedContent({
        body: Buffer.from(
          '<main><h1>Verify you are human</h1><p>Captcha challenge blocks this synthetic page from being treated as content.</p></main>',
          'utf8',
        ),
        declaredCharset: 'utf-8',
        limits,
        mimeType: 'text/html',
      }),
    ).toThrow('FETCH_CHALLENGE_DETECTED');
  });

  it('rejects binary MIME mismatch and DOM limits without preserving raw input', () => {
    expect(() =>
      processFetchedContent({
        body: Buffer.from('%PDF-1.7 payload', 'latin1'),
        declaredCharset: 'utf-8',
        limits,
        mimeType: 'text/html',
      }),
    ).toThrow('FETCH_MIME_MISMATCH');
    expect(() =>
      processFetchedContent({
        body: Buffer.from(`<main>${'<div>'.repeat(10)}正文${'</div>'.repeat(10)}</main>`, 'utf8'),
        declaredCharset: 'utf-8',
        limits: { ...limits, domDepth: 4 },
        mimeType: 'text/html',
      }),
    ).toThrow('FETCH_HTML_LIMIT');
  });
});
