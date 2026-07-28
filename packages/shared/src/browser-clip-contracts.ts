export const BROWSER_CLIP_CONTRACT_VERSION = 'browser-clip-v1' as const;
export const BROWSER_CLIP_BUILD_VERSION = '0.1.0' as const;
export const BROWSER_CLIP_MAX_BODY_BYTES = 8_500_000;
export const BROWSER_CLIP_MAX_SCREENSHOT_BYTES = 6 * 1024 * 1024;
export const BROWSER_CLIP_MAX_SCREENSHOT_PIXELS = 20_000_000;
export const BROWSER_CLIP_PLATFORMS = Object.freeze([
  'REDNOTE',
  'WECHAT',
  'WEIBO',
  'DOUYIN',
  'BILIBILI',
  'OTHER',
] as const);
export const BROWSER_CLIP_TAGS = Object.freeze([
  'REVIEW',
  'QUOTE',
  'AUTHOR',
  'PUBLISHING',
  'TREND',
  'DISCUSSION',
  'REFERENCE',
  'OTHER',
] as const);
export const BROWSER_FAMILIES = Object.freeze(['CHROME', 'EDGE', 'CHROMIUM_UNKNOWN'] as const);
export const BROWSER_CLIP_STABLE_ERRORS = Object.freeze([
  'CLIPPER_INVALID_MESSAGE',
  'CLIPPER_UNSUPPORTED_BROWSER',
  'CLIPPER_STORAGE_UNTRUSTED',
  'CLIPPER_ENDPOINT_INVALID',
  'CLIPPER_UNPAIRED',
  'CLIPPER_REAUTH_REQUIRED',
  'CLIPPER_APP_OFFLINE',
  'CLIPPER_PAGE_UNSUPPORTED',
  'CLIPPER_PAGE_NOT_READY',
  'CLIPPER_TAB_CHANGED',
  'CLIPPER_SELECTION_TOO_LARGE',
  'CLIPPER_NOTE_TOO_LARGE',
  'CLIPPER_METRICS_INVALID',
  'CLIPPER_TAGS_INVALID',
  'CLIPPER_SCREENSHOT_UNAVAILABLE',
  'CLIPPER_SCREENSHOT_INVALID',
  'CLIPPER_SCREENSHOT_TOO_LARGE',
  'CLIPPER_PAYLOAD_TOO_LARGE',
  'CLIPPER_RATE_LIMITED',
  'CLIPPER_CAPTURE_CONFLICT',
  'CLIPPER_RECEIPT_UNKNOWN',
  'CLIPPER_SAVE_STATUS_UNKNOWN',
  'CLIPPER_STORAGE_FAILED',
  'CLIPPER_INTERNAL',
] as const);

export type BrowserClipPlatform = (typeof BROWSER_CLIP_PLATFORMS)[number];
export type BrowserClipTag = (typeof BROWSER_CLIP_TAGS)[number];
export type BrowserFamily = (typeof BROWSER_FAMILIES)[number];
export type BrowserClipStableErrorV1 = (typeof BROWSER_CLIP_STABLE_ERRORS)[number];

export interface BrowserClipVisibleMetricsV1 {
  readonly comments: number | null;
  readonly favorites: number | null;
  readonly likes: number | null;
  readonly shares: number | null;
  readonly views: number | null;
}

export interface BrowserClipScreenshotV1 {
  readonly dataUrl: string;
}

export interface BrowserClipCreateV1 {
  readonly accountName: string | null;
  readonly browserFamily: BrowserFamily;
  readonly captureId: string;
  readonly capturedAt: string;
  readonly contentTags: readonly BrowserClipTag[];
  readonly contractVersion: typeof BROWSER_CLIP_CONTRACT_VERSION;
  readonly extensionBuildVersion: string;
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly platform: BrowserClipPlatform;
  readonly publicPageConfirmed: true;
  readonly publishedAt: string | null;
  readonly screenshot: BrowserClipScreenshotV1 | null;
  readonly selectedText: string | null;
  readonly userNote: string | null;
  readonly visibleMetrics: BrowserClipVisibleMetricsV1;
}

export interface BrowserClipReceiptV1 {
  readonly candidateId: string | null;
  readonly captureId: string;
  readonly clipId: string | null;
  readonly createdAt: string;
  readonly status: 'FAILED' | 'IN_PROGRESS' | 'SUCCEEDED' | 'UNKNOWN';
  readonly updatedAt: string;
}

export interface BrowserClipResponseV1 {
  readonly apiVersion: '1';
  readonly receipt: BrowserClipReceiptV1;
}

export interface CapturedPageV1 {
  readonly capturedAt: string;
  readonly documentIdentity: string;
  readonly pageTitle: string;
  readonly pageUrl: string;
  readonly selectedText: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const CREDENTIAL_QUERY_SEGMENTS = new Set([
  'apikey',
  'api_key',
  'auth',
  'authorization',
  'credential',
  'key',
  'password',
  'secret',
  'session',
  'sig',
  'signature',
  'token',
]);
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export class BrowserClipContractError extends Error {
  public readonly code: BrowserClipStableErrorV1;

  public constructor(code: BrowserClipStableErrorV1) {
    super(code);
    this.name = 'BrowserClipContractError';
    this.code = code;
  }
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype &&
    !Object.keys(value).some((key) => FORBIDDEN_KEYS.has(key))
  );
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join('\n') === [...expected].sort().join('\n');
}

function validIso(value: unknown): value is string {
  return typeof value === 'string' && ISO_PATTERN.test(value) && Number.isFinite(Date.parse(value));
}

function hasForbiddenControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return (
      codePoint <= 8 ||
      codePoint === 11 ||
      codePoint === 12 ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127
    );
  });
}

function cleanOptionalText(
  value: unknown,
  maximum: number,
  code: BrowserClipStableErrorV1,
): string | null {
  if (value === null) return null;
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    value !== value.normalize('NFC') ||
    hasForbiddenControlCharacter(value)
  ) {
    throw new BrowserClipContractError(code);
  }
  return value;
}

export function validateClipperEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value.length > 32) {
    throw new BrowserClipContractError('CLIPPER_ENDPOINT_INVALID');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BrowserClipContractError('CLIPPER_ENDPOINT_INVALID');
  }
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    !/^\d{1,5}$/u.test(parsed.port)
  ) {
    throw new BrowserClipContractError('CLIPPER_ENDPOINT_INVALID');
  }
  const port = Number(parsed.port);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65_535) {
    throw new BrowserClipContractError('CLIPPER_ENDPOINT_INVALID');
  }
  return `http://127.0.0.1:${port}`;
}

export function validateClipperPageUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 4096) {
    throw new BrowserClipContractError('CLIPPER_PAGE_UNSUPPORTED');
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new BrowserClipContractError('CLIPPER_PAGE_UNSUPPORTED');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.hash !== ''
  ) {
    throw new BrowserClipContractError('CLIPPER_PAGE_UNSUPPORTED');
  }
  for (const [name] of parsed.searchParams) {
    const normalized = name.normalize('NFKC').toLowerCase();
    const collapsed = normalized.replace(/[^a-z0-9]+/gu, '_');
    if (
      CREDENTIAL_QUERY_SEGMENTS.has(collapsed) ||
      collapsed.split('_').some((part) => CREDENTIAL_QUERY_SEGMENTS.has(part))
    ) {
      throw new BrowserClipContractError('CLIPPER_PAGE_UNSUPPORTED');
    }
  }
  return parsed.href;
}

export function validateBrowserClipCreateV1(value: unknown): BrowserClipCreateV1 {
  if (!plainObject(value)) throw new BrowserClipContractError('CLIPPER_INVALID_MESSAGE');
  const expected = [
    'accountName',
    'browserFamily',
    'captureId',
    'capturedAt',
    'contentTags',
    'contractVersion',
    'extensionBuildVersion',
    'pageTitle',
    'pageUrl',
    'platform',
    'publicPageConfirmed',
    'publishedAt',
    'screenshot',
    'selectedText',
    'userNote',
    'visibleMetrics',
  ];
  if (
    !exactKeys(value, expected) ||
    value.contractVersion !== BROWSER_CLIP_CONTRACT_VERSION ||
    typeof value.captureId !== 'string' ||
    !UUID_PATTERN.test(value.captureId) ||
    !validIso(value.capturedAt) ||
    typeof value.extensionBuildVersion !== 'string' ||
    !/^[0-9A-Za-z][0-9A-Za-z._-]{0,63}$/u.test(value.extensionBuildVersion) ||
    !BROWSER_FAMILIES.includes(value.browserFamily as BrowserFamily) ||
    !BROWSER_CLIP_PLATFORMS.includes(value.platform as BrowserClipPlatform) ||
    value.publicPageConfirmed !== true ||
    (value.publishedAt !== null && !validIso(value.publishedAt))
  ) {
    throw new BrowserClipContractError('CLIPPER_INVALID_MESSAGE');
  }
  const pageTitle = cleanOptionalText(value.pageTitle, 512, 'CLIPPER_INVALID_MESSAGE');
  if (pageTitle === null) throw new BrowserClipContractError('CLIPPER_INVALID_MESSAGE');
  const selectedText = cleanOptionalText(value.selectedText, 12_000, 'CLIPPER_SELECTION_TOO_LARGE');
  const userNote = cleanOptionalText(value.userNote, 2_000, 'CLIPPER_NOTE_TOO_LARGE');
  const accountName = cleanOptionalText(value.accountName, 200, 'CLIPPER_INVALID_MESSAGE');
  if (
    !Array.isArray(value.contentTags) ||
    value.contentTags.length > 10 ||
    new Set(value.contentTags).size !== value.contentTags.length ||
    value.contentTags.some(
      (tag) => typeof tag !== 'string' || !BROWSER_CLIP_TAGS.includes(tag as BrowserClipTag),
    )
  ) {
    throw new BrowserClipContractError('CLIPPER_TAGS_INVALID');
  }
  if (
    !plainObject(value.visibleMetrics) ||
    !exactKeys(value.visibleMetrics, ['comments', 'favorites', 'likes', 'shares', 'views'])
  ) {
    throw new BrowserClipContractError('CLIPPER_METRICS_INVALID');
  }
  const metrics = value.visibleMetrics as unknown as BrowserClipVisibleMetricsV1;
  for (const metric of Object.values(metrics)) {
    if (metric !== null && (!Number.isSafeInteger(metric) || (metric as number) < 0)) {
      throw new BrowserClipContractError('CLIPPER_METRICS_INVALID');
    }
  }
  if (
    value.screenshot !== null &&
    (!plainObject(value.screenshot) ||
      !exactKeys(value.screenshot, ['dataUrl']) ||
      typeof value.screenshot.dataUrl !== 'string' ||
      value.screenshot.dataUrl.length > 8_400_000)
  ) {
    throw new BrowserClipContractError('CLIPPER_SCREENSHOT_INVALID');
  }
  const result: BrowserClipCreateV1 = {
    accountName,
    browserFamily: value.browserFamily as BrowserFamily,
    captureId: value.captureId,
    capturedAt: value.capturedAt,
    contentTags: Object.freeze([...(value.contentTags as BrowserClipTag[])]),
    contractVersion: BROWSER_CLIP_CONTRACT_VERSION,
    extensionBuildVersion: value.extensionBuildVersion,
    pageTitle,
    pageUrl: validateClipperPageUrl(value.pageUrl),
    platform: value.platform as BrowserClipPlatform,
    publicPageConfirmed: true,
    publishedAt: value.publishedAt as string | null,
    screenshot:
      value.screenshot === null
        ? null
        : Object.freeze({ dataUrl: value.screenshot.dataUrl as string }),
    selectedText,
    userNote,
    visibleMetrics: Object.freeze({ ...metrics }),
  };
  return Object.freeze(result);
}
