import type { DesktopResult } from '@mystery-operations/shared';

import { isTrustedRendererUrl } from './security-policy.js';

export function validateDesktopIpcRequest(
  senderUrl: string,
  args: readonly unknown[],
  expectedRendererUrl: string,
): DesktopResult<never> | null {
  if (args.length !== 0) {
    return {
      error: {
        code: 'INVALID_REQUEST',
        message: '该只读接口不接受参数。',
      },
      ok: false,
    };
  }
  if (!isTrustedRendererUrl(senderUrl, expectedRendererUrl)) {
    return {
      error: {
        code: 'INVALID_REQUEST',
        message: '请求来源未获授权。',
      },
      ok: false,
    };
  }
  return null;
}
