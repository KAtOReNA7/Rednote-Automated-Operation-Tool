import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.vite', 'web');
const tempRoot = resolve(root, '.rednote-temp');
await mkdir(tempRoot, { recursive: true });
const runRoot = await mkdtemp(join(tempRoot, 'web-e2e-'));
const reportPath = resolve(root, '.rednote-temp', 'web-e2e-report.json');
const mime = {
  '.css': 'text/css',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
    const target = resolve(output, pathname === '/' ? 'web.html' : `.${pathname}`);
    if (target !== output && !target.startsWith(`${output}${sep}`)) throw new Error('TRAVERSAL');
    const body = await readFile(target);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-type': mime[extname(target)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
});
await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
const address = server.address();
if (address === null || typeof address === 'string') throw new Error('WEB_SERVER_START_FAILED');
const url = `http://127.0.0.1:${address.port}/web.html`;
const fsaFixture = String.raw`(() => {
  const files = new Map();
  const directories = new Map();
  const missing = () => new DOMException('not found', 'NotFoundError');
  const directory = (prefix, name) => {
    const value = {
      kind: 'directory',
      name,
      queryPermission: async () => 'granted',
      requestPermission: async () => 'granted',
      getDirectoryHandle: async (child, options = {}) => {
        const path = prefix === '' ? child : prefix + '/' + child;
        if (!directories.has(path)) {
          if (options.create !== true) throw missing();
          directories.set(path, directory(path, child));
        }
        return directories.get(path);
      },
      getFileHandle: async (child, options = {}) => {
        const path = prefix === '' ? child : prefix + '/' + child;
        if (!files.has(path) && options.create !== true) throw missing();
        return {
          kind: 'file',
          name: child,
          getFile: async () => new File([files.get(path) ?? new Uint8Array()], child),
          createWritable: async () => {
            let pending = new Uint8Array();
            return {
              write: async (data) => {
                if (data instanceof ArrayBuffer) pending = new Uint8Array(data.slice(0));
                else if (ArrayBuffer.isView(data)) pending = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
                else pending = new Uint8Array(await new Response(data).arrayBuffer());
              },
              close: async () => { files.set(path, new Uint8Array(pending)); },
              abort: async () => undefined,
            };
          },
        };
      },
    };
    return value;
  };
  const root = directory('', 'W2 synthetic workspace');
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: async () => root });
})();`;

const candidates =
  process.platform === 'win32'
    ? [
        [
          'chrome',
          join(process.env.PROGRAMFILES ?? '', 'Google', 'Chrome', 'Application', 'chrome.exe'),
        ],
        [
          'chrome',
          join(
            process.env['PROGRAMFILES(X86)'] ?? '',
            'Google',
            'Chrome',
            'Application',
            'chrome.exe',
          ),
        ],
        [
          'edge',
          join(
            process.env['PROGRAMFILES(X86)'] ?? '',
            'Microsoft',
            'Edge',
            'Application',
            'msedge.exe',
          ),
        ],
        [
          'edge',
          join(process.env.PROGRAMFILES ?? '', 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ],
      ]
    : [
        ['chrome', '/usr/bin/google-chrome'],
        ['chrome', '/usr/bin/chromium'],
        ['edge', '/usr/bin/microsoft-edge'],
      ];
const requested = new Set(
  (process.argv.find((value) => value.startsWith('--browser='))?.slice(10) ?? 'chrome,edge').split(
    ',',
  ),
);
const selected = [];
for (const [family, path] of candidates) {
  if (!requested.has(family) || selected.some(([existing]) => existing === family)) continue;
  try {
    if ((await stat(path)).isFile()) selected.push([family, path]);
  } catch {
    continue;
  }
}
if ([...requested].some((family) => !selected.some(([existing]) => existing === family)))
  throw new Error(
    `WEB_BROWSER_MISSING:${[...requested].filter((family) => !selected.some(([existing]) => existing === family)).join(',')}`,
  );

async function waitFor(path) {
  for (let attempt = 0; attempt < 150; attempt += 1) {
    try {
      return (await readFile(path, 'utf8')).trim().split(/\r?\n/u);
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error('DEVTOOLS_PORT_TIMEOUT');
}

async function inspect(family, executable) {
  const profile = join(runRoot, family);
  const child = spawn(
    executable,
    [
      '--headless=new',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-component-update',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore', windowsHide: true },
  );
  try {
    const [port] = await waitFor(join(profile, 'DevToolsActivePort'));
    const target = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent('about:blank')}`,
      {
        method: 'PUT',
      },
    ).then((response) => response.json());
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolveOpen, reject) => {
      socket.onopen = resolveOpen;
      socket.onerror = reject;
    });
    let id = 0;
    const externalRequests = [];
    const consoleErrors = [];
    const pending = new Map();
    socket.onmessage = (event) => {
      const value = JSON.parse(String(event.data));
      if (value.method === 'Network.requestWillBeSent') {
        const requestUrl = value.params?.request?.url;
        if (
          typeof requestUrl === 'string' &&
          !requestUrl.startsWith(`http://127.0.0.1:${address.port}/`)
        ) {
          externalRequests.push(new URL(requestUrl).origin);
        }
      }
      if (value.method === 'Runtime.exceptionThrown')
        consoleErrors.push(value.params?.exceptionDetails?.text ?? 'runtime exception');
      if (value.method === 'Log.entryAdded' && value.params?.entry?.level === 'error')
        consoleErrors.push(value.params.entry.text ?? 'console error');
      const promise = pending.get(value.id);
      if (promise) {
        pending.delete(value.id);
        if (value.error) promise.reject(new Error(value.error.message));
        else promise.resolve(value.result);
      }
    };
    const call = (method, params = {}) =>
      new Promise((resolveCall, reject) => {
        const requestId = ++id;
        pending.set(requestId, { reject, resolve: resolveCall });
        socket.send(JSON.stringify({ id: requestId, method, params }));
      });
    await call('Runtime.enable');
    await call('Network.enable');
    await call('Log.enable');
    await call('Page.enable');
    await call('Page.addScriptToEvaluateOnNewDocument', { source: fsaFixture });
    await call('Page.navigate', { url });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluated = await call('Runtime.evaluate', {
        expression:
          'document.readyState === "complete" && document.querySelector("#web-root")?.textContent?.includes("连接你的本地数据目录") === true && document.querySelector("#web-root button:not([disabled])") !== null && !document.querySelector("#web-root")?.textContent?.includes("正在检查")',
        returnByValue: true,
      });
      if (evaluated.result.value === true) {
        ready = true;
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (!ready) throw new Error(`${family.toUpperCase()}_WEB_UI_NOT_READY`);
    await call('Runtime.evaluate', {
      expression: 'document.querySelector("#web-root button:not([disabled])")?.click(); true',
      returnByValue: true,
    });
    let connected = false;
    for (let attempt = 0; attempt < 150; attempt += 1) {
      const evaluated = await call('Runtime.evaluate', {
        expression:
          'document.querySelector("[data-web-workspace]") !== null && document.querySelectorAll("nav a").length === 7',
        returnByValue: true,
      });
      if (evaluated.result.value === true) {
        connected = true;
        break;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
    if (!connected) {
      const diagnostic = await call('Runtime.evaluate', {
        expression:
          '({ rootText: document.querySelector("#web-root")?.textContent?.slice(0, 500), supported: typeof window.showDirectoryPicker === "function" })',
        returnByValue: true,
      });
      throw new Error(
        `${family.toUpperCase()}_WEB_WORKSPACE_NOT_CONNECTED:${JSON.stringify(diagnostic.result.value)}:${consoleErrors.join('|').slice(0, 500)}`,
      );
    }
    const widths = [];
    for (const [width, height] of [
      [1280, 800],
      [1440, 900],
    ]) {
      await call('Emulation.setDeviceMetricsOverride', {
        deviceScaleFactor: 1,
        height,
        mobile: false,
        width,
      });
      const routes = [];
      for (const route of [
        'overview',
        'weekly-plan',
        'content',
        'interaction',
        'library',
        'review',
        'settings',
      ]) {
        await call('Runtime.evaluate', {
          expression: `window.location.hash = ${JSON.stringify(`#/web/${route}`)}; true`,
          returnByValue: true,
        });
        let result;
        for (let attempt = 0; attempt < 50; attempt += 1) {
          const evaluated = await call('Runtime.evaluate', {
            expression: `(() => { const active=document.querySelector('a[href="#/web/${route}"][aria-current="page"]'); const button=document.querySelector('#web-root button:not([disabled])'); button?.focus(); return { active:document.activeElement===button, buttonLabel:button?.textContent?.trim(), clientWidth:document.documentElement.clientWidth, hasHeading:document.querySelector('main h1')!==null, hasLiveRegion:document.querySelector('[aria-live]')!==null, routeActive:active!==null, scrollWidth:document.documentElement.scrollWidth, title:document.title }; })()`,
            returnByValue: true,
          });
          result = evaluated.result.value;
          if (result.routeActive && result.hasHeading) break;
          await new Promise((resolveWait) => setTimeout(resolveWait, 50));
        }
        if (!result?.routeActive || !result.hasHeading)
          throw new Error(`${family.toUpperCase()}_ROUTE_NOT_READY:${route}`);
        if (!result.active)
          throw new Error(`${family.toUpperCase()}_KEYBOARD_FOCUS_FAILED:${route}`);
        if (!result.hasLiveRegion)
          throw new Error(`${family.toUpperCase()}_ARIA_LIVE_MISSING:${route}`);
        if (result.scrollWidth !== result.clientWidth)
          throw new Error(
            `${family.toUpperCase()}_HORIZONTAL_OVERFLOW:${route}:${result.clientWidth}/${result.scrollWidth}/${width}`,
          );
        if (result.title !== 'Rednote Studio · Web 本地工作台')
          throw new Error(`${family.toUpperCase()}_TITLE_MISMATCH`);
        routes.push({ route, ...result });
      }
      widths.push({ height, routes, width });
    }
    if (consoleErrors.length > 0)
      throw new Error(
        `${family.toUpperCase()}_CONSOLE_ERRORS:${consoleErrors.join('|').slice(0, 500)}`,
      );
    socket.close();
    return { consoleErrors, externalRequests: [...new Set(externalRequests)], family, widths };
  } finally {
    child.kill();
    await new Promise((resolveExit) => {
      if (child.exitCode !== null) resolveExit();
      else {
        child.once('exit', resolveExit);
        setTimeout(resolveExit, 2_000);
      }
    });
  }
}

try {
  const browsers = [];
  for (const [family, executable] of selected) browsers.push(await inspect(family, executable));
  const externalConnections = browsers.reduce(
    (count, browser) => count + browser.externalRequests.length,
    0,
  );
  if (externalConnections !== 0) throw new Error('UNEXPECTED_EXTERNAL_CONNECTION');
  const report = {
    browsers,
    externalConnections,
    nativeFsaPickerAutomated: false,
    syntheticFolderInjected: true,
    url: '/web.html',
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  if (runRoot.startsWith(`${tempRoot}${sep}`)) await rm(runRoot, { force: true, recursive: true });
}
