import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, '.vite', 'web');
const files = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else files.push(path);
  }
}
await walk(output);
if (!files.some((file) => file.endsWith('web.html'))) throw new Error('WEB_HTML_MISSING');
if (files.some((file) => file.endsWith('.map'))) throw new Error('WEB_SOURCE_MAP_FORBIDDEN');
const textFiles = files.filter((file) => /\.(?:css|html|js|json)$/u.test(file));
const source = (await Promise.all(textFiles.map((file) => readFile(file, 'utf8')))).join('\n');
const forbidden = [
  ['Electron runtime', /\belectron\b|ipcRenderer|contextBridge|rednoteV2/u],
  ['test adapter', /DETERMINISTIC_MOCK|r07-packaged-blackbox|__V2_R01_SMOKE__/u],
  ['absolute Windows path', /[A-Za-z]:\\(?:Users|porject|project)\\/u],
  ['secret material', /gho_[A-Za-z0-9]+|Authorization\s*[:=]|BEGIN PRIVATE KEY/u],
];
for (const [label, pattern] of forbidden)
  if (pattern.test(source)) throw new Error(`WEB_ARTIFACT_FORBIDDEN:${label}`);
const commit = String(process.env.REDNOTE_EXACT_HEAD_SHA ?? '').trim();
if (commit !== '' && !source.includes(commit)) throw new Error('WEB_EXACT_HEAD_MISSING');
const totalBytes = (await Promise.all(files.map(async (file) => (await stat(file)).size))).reduce(
  (sum, size) => sum + size,
  0,
);
process.stdout.write(
  `${JSON.stringify({ files: files.map((file) => relative(output, file).replaceAll('\\', '/')).sort(), totalBytes }, null, 2)}\n`,
);
