import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';

const repoRoot = resolve(
  dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/u, '$1')),
  '..',
);
const buildRoot = join(repoRoot, '.vite', 'clipper');
const staticRoot = join(repoRoot, 'apps', 'clipper', 'static');
const outputRoot = join(repoRoot, 'out', 'clipper');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

async function filesUnder(root) {
  const result = [];
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      const absolute = join(directory, name);
      const details = await stat(absolute);
      if (details.isDirectory()) await visit(absolute);
      else if (details.isFile()) result.push(absolute);
      else throw new Error('Clipper package contains a non-regular entry.');
    }
  }
  await visit(root);
  return result;
}

async function deterministicZip(sourceRoot, target) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const absolute of await filesUnder(sourceRoot)) {
    const name = relative(sourceRoot, absolute).split(sep).join('/');
    const nameBytes = Buffer.from(name, 'utf8');
    const data = await readFile(absolute);
    const crc = crc32(data);
    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
    ]);
    local.push(localHeader, data);
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0x0800),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(data.length),
        u32(data.length),
        u16(nameBytes.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        nameBytes,
      ]),
    );
    offset += localHeader.length + data.length;
  }
  const centralBytes = Buffer.concat(central);
  const entries = central.length;
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries),
    u16(entries),
    u32(centralBytes.length),
    u32(offset),
    u16(0),
  ]);
  await writeFile(target, Buffer.concat([...local, centralBytes, end]));
}

await rm(outputRoot, { force: true, recursive: true });
await mkdir(outputRoot, { recursive: true });

for (const family of ['chrome', 'edge']) {
  const target = join(outputRoot, `${family}-unpacked`);
  await mkdir(target, { recursive: true });
  await cp(buildRoot, target, { recursive: true });
  await cp(staticRoot, target, { recursive: true });
  const manifestPath = join(target, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (family === 'edge') manifest.name = '推理小说公开页面样本收藏（Edge）';
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await deterministicZip(target, join(outputRoot, `${family}-unpacked.zip`));
}

const hashes = {};
for (const name of ['chrome-unpacked.zip', 'edge-unpacked.zip']) {
  hashes[name] = createHash('sha256')
    .update(await readFile(join(outputRoot, name)))
    .digest('hex');
}
await writeFile(
  join(outputRoot, 'SHA256SUMS.json'),
  `${JSON.stringify(hashes, null, 2)}\n`,
  'utf8',
);
console.log(JSON.stringify({ output: 'out/clipper', packages: hashes }));
