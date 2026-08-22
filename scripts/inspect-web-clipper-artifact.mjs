import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'out', 'clipper');
const expectedPermissions = ['activeTab', 'scripting'];

async function filesUnder(directory) {
  const files = [];
  async function visit(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files.push(path);
      else throw new Error('WEB_CLIPPER_NON_REGULAR_ENTRY');
    }
  }
  await visit(directory);
  return files;
}

const hashes = JSON.parse(await readFile(join(output, 'SHA256SUMS.json'), 'utf8'));
for (const family of ['chrome', 'edge']) {
  const unpacked = join(output, `${family}-unpacked`);
  const manifest = JSON.parse(await readFile(join(unpacked, 'manifest.json'), 'utf8'));
  if (
    manifest.manifest_version !== 3 ||
    JSON.stringify(manifest.permissions) !== JSON.stringify(expectedPermissions) ||
    'host_permissions' in manifest ||
    'content_scripts' in manifest
  )
    throw new Error(`WEB_CLIPPER_MANIFEST_BOUNDARY:${family}`);
  const files = await filesUnder(unpacked);
  if (files.some((file) => file.endsWith('.map')))
    throw new Error('WEB_CLIPPER_SOURCE_MAP_FORBIDDEN');
  const source = (
    await Promise.all(
      files
        .filter((file) => /\.(?:html|js|json)$/u.test(file))
        .map((file) => readFile(file, 'utf8')),
    )
  ).join('\n');
  if (
    /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|127\.0\.0\.1|localhost|\/v1\/pairings|\/v1\/browser-clips|authorization|cookie/iu.test(
      source,
    )
  )
    throw new Error(`WEB_CLIPPER_EGRESS_FORBIDDEN:${family}`);
  for (const required of ['manifest.json', 'popup.html', 'popup.js', 'service-worker.js'])
    if (!files.some((file) => relative(unpacked, file).replaceAll('\\', '/') === required))
      throw new Error(`WEB_CLIPPER_FILE_MISSING:${family}:${required}`);
  const zipName = `${family}-unpacked.zip`;
  const zip = await readFile(join(output, zipName));
  if (createHash('sha256').update(zip).digest('hex') !== hashes[zipName])
    throw new Error(`WEB_CLIPPER_HASH_MISMATCH:${family}`);
}

const totalBytes = (
  await Promise.all((await filesUnder(output)).map(async (file) => (await stat(file)).size))
).reduce((sum, size) => sum + size, 0);
process.stdout.write(`${JSON.stringify({ artifact: 'W2_WEB_EXPORT', totalBytes }, null, 2)}\n`);
