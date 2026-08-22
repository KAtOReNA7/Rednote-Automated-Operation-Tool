import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const vite = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
const url = 'http://127.0.0.1:4174/fsa-smoke.html';
await stat(vite).catch(() => {
  throw new Error('VITE_NOT_INSTALLED：请先完成仓库依赖安装。');
});
const server = spawn(
  process.execPath,
  [
    vite,
    '--config',
    join(root, 'vite.web.config.ts'),
    '--host',
    '127.0.0.1',
    '--port',
    '4174',
    '--strictPort',
  ],
  { cwd: root, stdio: 'inherit', windowsHide: true },
);
let ready = false;
for (let attempt = 0; attempt < 100; attempt += 1) {
  try {
    if ((await fetch(url)).ok) {
      ready = true;
      break;
    }
  } catch {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
}
if (!ready) {
  server.kill();
  throw new Error('FSA_SMOKE_SERVER_NOT_READY');
}
process.stdout.write(`\n真实 FSA 验收入口：${url}\n关闭此窗口即可停止本地服务。\n\n`);
spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
}).unref();
process.on('SIGINT', () => server.kill());
process.on('SIGTERM', () => server.kill());
const exitCode = await new Promise((resolveExit) => server.once('exit', resolveExit));
process.exitCode = typeof exitCode === 'number' ? exitCode : 0;
