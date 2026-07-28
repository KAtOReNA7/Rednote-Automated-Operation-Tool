import { createHash } from 'node:crypto';

import { parse, type DefaultTreeAdapterTypes } from 'parse5';

import {
  FETCH_CHARSETS,
  FETCH_EXTRACTOR_VERSION,
  FETCH_PRIVACY_POLICY_VERSION,
  FETCH_SANITIZER_VERSION,
  type FetchCharset,
  type FetchMimeType,
} from './constants.js';
import type { FetchRedactionCountsV1 } from './contracts.js';
import { FetchError } from './errors.js';

type ParseNode = DefaultTreeAdapterTypes.Node;
type ElementNode = DefaultTreeAdapterTypes.Element;

interface SafeElement {
  readonly children: readonly SafeNode[];
  readonly tag: string;
}

type SafeNode = SafeElement | string;

export interface ProcessedFetchContentV1 {
  readonly charset: FetchCharset;
  readonly extractedText: string;
  readonly extractedTextBytes: number;
  readonly extractedTextHash: string;
  readonly extractorVersion: typeof FETCH_EXTRACTOR_VERSION;
  readonly languageHint: string | null;
  readonly normalizedDocumentContentHash: string;
  readonly privacyPolicyVersion: typeof FETCH_PRIVACY_POLICY_VERSION;
  readonly rawBodyHash: string;
  readonly redactionCounts: FetchRedactionCountsV1;
  readonly sanitizedHtml: string;
  readonly sanitizedHtmlBytes: number;
  readonly sanitizedHtmlHash: string;
  readonly sanitizerVersion: typeof FETCH_SANITIZER_VERSION;
}

const ALLOWED_TAGS = new Set([
  'article',
  'b',
  'blockquote',
  'br',
  'code',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'i',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'strong',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'ul',
]);

const DROP_SUBTREE_TAGS = new Set([
  'audio',
  'base',
  'button',
  'canvas',
  'embed',
  'footer',
  'form',
  'header',
  'iframe',
  'input',
  'math',
  'meta',
  'nav',
  'noscript',
  'object',
  'option',
  'picture',
  'script',
  'select',
  'source',
  'style',
  'svg',
  'template',
  'textarea',
  'video',
]);

const EXCLUDED_HINT =
  /\b(?:ad|ads|advert|banner|breadcrumb|comment|cookie|footer|header|login|nav|promo|recommend|related|share|sidebar|social|user-list)\b/iu;
const UGC_HINT =
  /\b(?:comments?|discussion|forum|guestbook|replies|user-generated|用户评论|评论区|留言板)\b/iu;
const CHALLENGE_HINT =
  /\b(?:access denied|captcha|cloudflare challenge|login required|paywall|sign in to continue|subscribe to continue|verify you are human|验证码|登录后查看|付费后阅读|人机验证)\b/iu;

function isElement(node: ParseNode): node is ElementNode {
  return 'tagName' in node;
}

function isText(node: ParseNode): node is DefaultTreeAdapterTypes.TextNode {
  return node.nodeName === '#text';
}

function childrenOf(node: ParseNode): readonly ParseNode[] {
  return 'childNodes' in node ? node.childNodes : [];
}

function attribute(node: ElementNode, name: string): string {
  return node.attrs.find((item) => item.name.toLowerCase() === name)?.value ?? '';
}

function elementHints(node: ElementNode): string {
  return `${attribute(node, 'class')} ${attribute(node, 'id')} ${attribute(node, 'role')}`;
}

function findElement(root: ParseNode, names: ReadonlySet<string>): ElementNode | null {
  if (
    isElement(root) &&
    names.has(root.tagName.toLowerCase()) &&
    !EXCLUDED_HINT.test(elementHints(root))
  ) {
    return root;
  }
  for (const child of childrenOf(root)) {
    const found = findElement(child, names);
    if (found !== null) return found;
  }
  return null;
}

function inspectTree(
  root: ParseNode,
  limits: { readonly domDepth: number; readonly domNodes: number },
): void {
  let nodes = 0;
  const visit = (node: ParseNode, depth: number): void => {
    nodes += 1;
    if (nodes > limits.domNodes || depth > limits.domDepth) {
      throw new FetchError('FETCH_HTML_LIMIT', { sendState: 'PAGE_SENT' });
    }
    for (const child of childrenOf(node)) visit(child, depth + 1);
  };
  visit(root, 0);
}

const CHARSET_ALIASES: Readonly<Record<string, FetchCharset>> = Object.freeze({
  big5: 'big5',
  'cn-big5': 'big5',
  'euc-jp': 'euc-jp',
  gb18030: 'gb18030',
  gb2312: 'gb18030',
  gbk: 'gb18030',
  'iso-2022-jp': 'iso-2022-jp',
  'shift-jis': 'shift_jis',
  shift_jis: 'shift_jis',
  sjis: 'shift_jis',
  'utf-8': 'utf-8',
  utf8: 'utf-8',
});

function normalizeCharset(value: string): FetchCharset {
  const normalized = CHARSET_ALIASES[value.trim().toLowerCase()];
  if (normalized === undefined || !FETCH_CHARSETS.includes(normalized)) {
    throw new FetchError('FETCH_CHARSET_UNSUPPORTED', { sendState: 'PAGE_SENT' });
  }
  return normalized;
}

function bomCharset(bytes: Uint8Array): FetchCharset | null {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return 'utf-8';
  }
  return null;
}

function metaCharset(bytes: Uint8Array): FetchCharset | null {
  const prefix = Buffer.from(bytes.subarray(0, Math.min(bytes.length, 2_048))).toString('latin1');
  const direct = /<meta\b[^>]*\bcharset\s*=\s*["']?\s*([A-Za-z0-9._-]+)/iu.exec(prefix)?.[1];
  const content = /<meta\b[^>]*\bcontent\s*=\s*["'][^"']*charset\s*=\s*([A-Za-z0-9._-]+)/iu.exec(
    prefix,
  )?.[1];
  const value = direct ?? content;
  return value === undefined ? null : normalizeCharset(value);
}

export function decodeFetchBody(input: {
  readonly body: Uint8Array;
  readonly declaredCharset: string | null;
  readonly mimeType: FetchMimeType;
}): { readonly charset: FetchCharset; readonly text: string } {
  const bom = bomCharset(input.body);
  const declared = input.declaredCharset === null ? null : normalizeCharset(input.declaredCharset);
  const meta =
    input.mimeType === 'text/html' || input.mimeType === 'application/xhtml+xml'
      ? metaCharset(input.body)
      : null;
  const declaredValues = [bom, declared, meta].filter(
    (value): value is FetchCharset => value !== null,
  );
  if (new Set(declaredValues).size > 1) {
    throw new FetchError('FETCH_DECODE_FAILED', { sendState: 'PAGE_SENT' });
  }
  const charset = declaredValues[0] ?? 'utf-8';
  try {
    return Object.freeze({
      charset,
      text: new TextDecoder(charset, { fatal: true }).decode(input.body).normalize('NFC'),
    });
  } catch (cause) {
    throw new FetchError('FETCH_DECODE_FAILED', { cause, sendState: 'PAGE_SENT' });
  }
}

export function assertMimeMatchesBody(mimeType: FetchMimeType, body: Uint8Array): void {
  const prefix = Buffer.from(body.subarray(0, Math.min(body.length, 64)));
  const ascii = prefix.toString('latin1').trimStart().toLowerCase();
  const binary =
    prefix.subarray(0, 5).toString('latin1') === '%PDF-' ||
    prefix.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])) ||
    prefix.subarray(0, 2).toString('latin1') === 'PK' ||
    prefix.subarray(0, 2).toString('latin1') === 'MZ' ||
    prefix.includes(0);
  const structuredNonHtml =
    (ascii.startsWith('{') || ascii.startsWith('[')) && mimeType !== 'text/plain';
  if (binary || structuredNonHtml) {
    throw new FetchError('FETCH_MIME_MISMATCH', { sendState: 'PAGE_SENT' });
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;');
}

function createRedactor(counts: { addresses: number; emails: number; phones: number }) {
  return (input: string): string => {
    let value = input;
    value = value.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/giu, () => {
      counts.emails += 1;
      return '[已移除邮箱]';
    });
    value = value.replace(
      /(?:电话|手机|联系电话|tel(?:ephone)?|phone)\s*[:：]?\s*(?:\+?\d[\d ()-]{5,}\d)/giu,
      () => {
        counts.phones += 1;
        return '[已移除电话]';
      },
    );
    value = value.replace(/(?:地址|联系地址|邮寄地址|address)\s*[:：]\s*[^\n]{6,160}/giu, () => {
      counts.addresses += 1;
      return '[已移除地址]';
    });
    return value;
  };
}

function sanitizeNode(node: ParseNode, redact: (input: string) => string): readonly SafeNode[] {
  if (isText(node)) {
    const redacted = redact(node.value);
    return redacted.length === 0 ? [] : [redacted];
  }
  if (!isElement(node)) return [];
  const tag = node.tagName.toLowerCase();
  if (DROP_SUBTREE_TAGS.has(tag) || EXCLUDED_HINT.test(elementHints(node))) return [];
  const children = node.childNodes.flatMap((child) => sanitizeNode(child, redact));
  if (!ALLOWED_TAGS.has(tag)) return children;
  return [Object.freeze({ children: Object.freeze(children), tag })];
}

function serializeSafeNode(node: SafeNode): string {
  if (typeof node === 'string') return escapeHtml(node);
  if (node.tag === 'br') return '<br>';
  return `<${node.tag}>${node.children.map(serializeSafeNode).join('')}</${node.tag}>`;
}

function renderText(node: SafeNode): string {
  if (typeof node === 'string') return node;
  const content = node.children.map(renderText).join('');
  if (/^h[1-6]$/u.test(node.tag)) return `\n\n${content}\n\n`;
  if (node.tag === 'p' || node.tag === 'blockquote' || node.tag === 'pre') {
    return `\n\n${content}\n\n`;
  }
  if (node.tag === 'li') return `\n• ${content}`;
  if (node.tag === 'tr') return `\n${content}`;
  if (node.tag === 'td' || node.tag === 'th') return `${content}\t`;
  if (node.tag === 'br') return '\n';
  return content;
}

function normalizeExtractedText(value: string): string {
  return value
    .replace(/\u00a0/gu, ' ')
    .replace(/[ \t]+\n/gu, '\n')
    .replace(/\n[ \t]+/gu, '\n')
    .replace(/[ \t]{2,}/gu, ' ')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function validateSanitizedHtml(value: string, maximumBytes: number): void {
  if (
    typeof value !== 'string' ||
    value.includes('\u0000') ||
    Buffer.byteLength(value, 'utf8') > maximumBytes ||
    /(?:<\s*(?:script|style|iframe|object|embed|form|svg|math|audio|video|source|picture)\b|javascript:|data:|blob:|https?:\/\/|on[a-z]+\s*=|(?:src|href|action|style|class|id)\s*=)/iu.test(
      value,
    )
  ) {
    throw new FetchError('FETCH_SANITIZE_FAILED', { sendState: 'PAGE_SENT' });
  }
  const reparsed = parse(value);
  const walk = (node: ParseNode): void => {
    if (
      isElement(node) &&
      (!ALLOWED_TAGS.has(node.tagName.toLowerCase()) || node.attrs.length > 0)
    ) {
      throw new FetchError('FETCH_SANITIZE_FAILED', { sendState: 'PAGE_SENT' });
    }
    for (const child of childrenOf(node)) walk(child);
  };
  for (const child of reparsed.childNodes) {
    if (isElement(child) && !['html', 'head', 'body'].includes(child.tagName.toLowerCase())) {
      walk(child);
    } else {
      for (const nested of childrenOf(child)) {
        if (isElement(nested) && !['head', 'body'].includes(nested.tagName.toLowerCase()))
          walk(nested);
        if (isElement(nested) && nested.tagName.toLowerCase() === 'body') {
          for (const bodyChild of nested.childNodes) walk(bodyChild);
        }
      }
    }
  }
}

export function validateExtractedText(value: string, maximumBytes: number): void {
  if (
    typeof value !== 'string' ||
    value.length < 80 ||
    value.includes('\u0000') ||
    Buffer.byteLength(value, 'utf8') > maximumBytes ||
    CHALLENGE_HINT.test(value)
  ) {
    throw new FetchError('FETCH_EXTRACTION_EMPTY', { sendState: 'PAGE_SENT' });
  }
}

function safeTreeFromPlainText(
  text: string,
  redact: (input: string) => string,
): readonly SafeNode[] {
  return text
    .replace(/\r\n?/gu, '\n')
    .split(/\n{2,}/u)
    .map((paragraph) => normalizeExtractedText(redact(paragraph)))
    .filter(Boolean)
    .map((paragraph) => Object.freeze({ children: Object.freeze([paragraph]), tag: 'p' }));
}

export function processFetchedContent(input: {
  readonly body: Uint8Array;
  readonly declaredCharset: string | null;
  readonly limits: {
    readonly domDepth: number;
    readonly domNodes: number;
    readonly sanitizedBytes: number;
    readonly textBytes: number;
  };
  readonly mimeType: FetchMimeType;
}): ProcessedFetchContentV1 {
  assertMimeMatchesBody(input.mimeType, input.body);
  const decoded = decodeFetchBody(input);
  if (CHALLENGE_HINT.test(decoded.text)) {
    throw new FetchError('FETCH_CHALLENGE_DETECTED', { sendState: 'PAGE_SENT' });
  }
  const mutableCounts = { addresses: 0, emails: 0, phones: 0 };
  const redact = createRedactor(mutableCounts);
  let safeNodes: readonly SafeNode[];
  if (input.mimeType === 'text/plain') {
    if (UGC_HINT.test(decoded.text)) {
      throw new FetchError('FETCH_PRIVACY_REVIEW_REQUIRED', { sendState: 'PAGE_SENT' });
    }
    safeNodes = safeTreeFromPlainText(decoded.text, redact);
  } else {
    const document = parse(decoded.text);
    inspectTree(document, input.limits);
    const root = findElement(document, new Set(['main', 'article']));
    if (root === null) {
      if (UGC_HINT.test(decoded.text)) {
        throw new FetchError('FETCH_PRIVACY_REVIEW_REQUIRED', { sendState: 'PAGE_SENT' });
      }
      throw new FetchError('FETCH_EXTRACTION_EMPTY', { sendState: 'PAGE_SENT' });
    }
    if (UGC_HINT.test(elementHints(root))) {
      throw new FetchError('FETCH_PRIVACY_REVIEW_REQUIRED', { sendState: 'PAGE_SENT' });
    }
    safeNodes = sanitizeNode(root, redact);
  }
  if (safeNodes.length === 0) {
    throw new FetchError('FETCH_EXTRACTION_EMPTY', { sendState: 'PAGE_SENT' });
  }
  const sanitizedHtml = safeNodes.map(serializeSafeNode).join('');
  const extractedText = normalizeExtractedText(safeNodes.map(renderText).join(''));
  validateSanitizedHtml(sanitizedHtml, input.limits.sanitizedBytes);
  validateExtractedText(extractedText, input.limits.textBytes);
  const sanitizedHtmlBytes = Buffer.byteLength(sanitizedHtml, 'utf8');
  const extractedTextBytes = Buffer.byteLength(extractedText, 'utf8');
  const sanitizedHtmlHash = createHash('sha256').update(sanitizedHtml, 'utf8').digest('hex');
  const extractedTextHash = createHash('sha256').update(extractedText, 'utf8').digest('hex');
  const normalizedDocumentContentHash = createHash('sha256')
    .update(
      JSON.stringify({
        extractedTextHash,
        extractorVersion: FETCH_EXTRACTOR_VERSION,
        privacyPolicyVersion: FETCH_PRIVACY_POLICY_VERSION,
        sanitizedHtmlHash,
        sanitizerVersion: FETCH_SANITIZER_VERSION,
      }),
      'utf8',
    )
    .digest('hex');
  return Object.freeze({
    charset: decoded.charset,
    extractedText,
    extractedTextBytes,
    extractedTextHash,
    extractorVersion: FETCH_EXTRACTOR_VERSION,
    languageHint: null,
    normalizedDocumentContentHash,
    privacyPolicyVersion: FETCH_PRIVACY_POLICY_VERSION,
    rawBodyHash: createHash('sha256').update(input.body).digest('hex'),
    redactionCounts: Object.freeze({ ...mutableCounts }),
    sanitizedHtml,
    sanitizedHtmlBytes,
    sanitizedHtmlHash,
    sanitizerVersion: FETCH_SANITIZER_VERSION,
  });
}
