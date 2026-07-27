import type { Session, WebContents } from 'electron';

export interface SessionSecurityAudit {
  readonly externalRequestAttempts: number;
}

function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function sameEndpoint(candidate: URL, expected: URL): boolean {
  return (
    candidate.protocol === expected.protocol &&
    candidate.hostname === expected.hostname &&
    candidate.port === expected.port &&
    candidate.username === '' &&
    candidate.password === ''
  );
}

export function isTrustedRendererUrl(candidateUrl: string, expectedRendererUrl: string): boolean {
  const candidate = parseUrl(candidateUrl);
  const expected = parseUrl(expectedRendererUrl);

  if (candidate === null || expected === null || !sameEndpoint(candidate, expected)) {
    return false;
  }

  if (expected.protocol === 'rednote:') {
    return candidate.hostname === 'app';
  }

  return (
    expected.protocol === 'http:' &&
    expected.hostname === '127.0.0.1' &&
    candidate.protocol === 'http:'
  );
}

export function isAllowedResourceUrl(candidateUrl: string, expectedRendererUrl: string): boolean {
  const candidate = parseUrl(candidateUrl);
  const expected = parseUrl(expectedRendererUrl);

  if (candidate === null || expected === null) {
    return false;
  }

  if (sameEndpoint(candidate, expected)) {
    return true;
  }

  return (
    expected.protocol === 'http:' &&
    expected.hostname === '127.0.0.1' &&
    candidate.protocol === 'ws:' &&
    candidate.hostname === expected.hostname &&
    candidate.port === expected.port
  );
}

export function installSessionSecurity(
  electronSession: Session,
  expectedRendererUrl: string,
): SessionSecurityAudit {
  let externalRequestAttempts = 0;
  electronSession.setPermissionCheckHandler(() => false);
  electronSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  electronSession.setDevicePermissionHandler(() => false);
  electronSession.setSpellCheckerLanguages([]);
  electronSession.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedResourceUrl(details.url, expectedRendererUrl);
    if (!allowed) {
      externalRequestAttempts += 1;
    }
    callback({
      cancel: !allowed,
    });
  });
  return {
    get externalRequestAttempts() {
      return externalRequestAttempts;
    },
  };
}

export function attachWebContentsSecurity(
  webContents: WebContents,
  expectedRendererUrl: string,
): void {
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, expectedRendererUrl)) {
      event.preventDefault();
    }
  });
  webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, expectedRendererUrl)) {
      event.preventDefault();
    }
  });
}
