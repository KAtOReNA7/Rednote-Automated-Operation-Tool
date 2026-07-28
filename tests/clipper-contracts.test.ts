import { describe, expect, it } from 'vitest';

import {
  BROWSER_CLIP_STABLE_ERRORS,
  BrowserClipContractError,
  validateBrowserClipCreateV1,
  validateClipperEndpoint,
  validateClipperPageUrl,
} from '../packages/shared/src/index.js';
import { browserClipFixture } from './clipper-fixtures.js';

describe('Issue 017 browser clip contracts', () => {
  it('accepts one exact versioned user-confirmed payload and freezes copied values', () => {
    const input = browserClipFixture();
    const result = validateBrowserClipCreateV1(input);
    expect(result).toEqual(input);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.contentTags)).toBe(true);
    expect(Object.isFrozen(result.visibleMetrics)).toBe(true);
    expect(result.publicPageConfirmed).toBe(true);
  });

  it('rejects extra keys, missing confirmation, unsafe URLs, and credential-like queries', () => {
    expect(() =>
      validateBrowserClipCreateV1({ ...browserClipFixture(), unexpected: true }),
    ).toThrowError(BrowserClipContractError);
    expect(() =>
      validateBrowserClipCreateV1({
        ...browserClipFixture(),
        publicPageConfirmed: false,
      }),
    ).toThrowError('CLIPPER_INVALID_MESSAGE');
    for (const url of [
      'file:///C:/private.txt',
      'chrome://extensions',
      'https://user:password@example.com/',
      'https://example.com/#private',
      'https://example.com/?access_token=secret',
    ]) {
      expect(() => validateClipperPageUrl(url), url).toThrowError('CLIPPER_PAGE_UNSUPPORTED');
    }
  });

  it('accepts only an explicit IPv4 loopback endpoint with a non-system port', () => {
    expect(validateClipperEndpoint('http://127.0.0.1:43119')).toBe('http://127.0.0.1:43119');
    for (const endpoint of [
      'http://localhost:43119',
      'http://0.0.0.0:43119',
      'http://[::1]:43119',
      'https://127.0.0.1:43119',
      'http://127.0.0.1:43119/path',
      'http://127.0.0.1:80',
    ]) {
      expect(() => validateClipperEndpoint(endpoint), endpoint).toThrowError(
        'CLIPPER_ENDPOINT_INVALID',
      );
    }
  });

  it('keeps stable errors explicit and unique', () => {
    expect(BROWSER_CLIP_STABLE_ERRORS).toHaveLength(24);
    expect(new Set(BROWSER_CLIP_STABLE_ERRORS).size).toBe(BROWSER_CLIP_STABLE_ERRORS.length);
    expect(BROWSER_CLIP_STABLE_ERRORS).toContain('CLIPPER_TAB_CHANGED');
    expect(BROWSER_CLIP_STABLE_ERRORS).toContain('CLIPPER_CAPTURE_CONFLICT');
  });
});
