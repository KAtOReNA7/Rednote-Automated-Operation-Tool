import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const sevenZipMagic = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]);

function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

function peOverlayStart(bytes) {
  const pe = bytes.readUInt32LE(0x3c);
  const coff = pe + 4;
  const optional = coff + 20;
  const sectionStart = optional + bytes.readUInt16LE(coff + 16);
  const sectionCount = bytes.readUInt16LE(coff + 2);
  let end = 0;
  for (let index = 0; index < sectionCount; index += 1) {
    const section = sectionStart + index * 40;
    end = Math.max(end, bytes.readUInt32LE(section + 16) + bytes.readUInt32LE(section + 20));
  }
  return end;
}

function normalizeBuilderScript(value) {
  return value.replace(/!include "[^"]+\\0-messages\.nsh"/gu, '!include "<TEMP_MESSAGES>"');
}

async function sample(directory) {
  const root = resolve(directory);
  const installerNames = ['RednoteStudio-0.1.0-beta.1-win-x64-setup.exe'];
  const installer = join(root, installerNames[0]);
  const [bytes, script] = await Promise.all([
    readFile(installer),
    readFile(join(root, 'builder-debug.yml'), 'utf8'),
  ]);
  const overlay = peOverlayStart(bytes);
  const archive = bytes.indexOf(sevenZipMagic, overlay);
  if (archive < overlay) throw new Error('R10D installer has no embedded 7z payload.');
  const nextHeaderOffset = Number(bytes.readBigUInt64LE(archive + 12));
  const nextHeaderSize = Number(bytes.readBigUInt64LE(archive + 20));
  const archiveEnd = archive + 32 + nextHeaderOffset + nextHeaderSize;
  if (!Number.isSafeInteger(archiveEnd) || archiveEnd >= bytes.length)
    throw new Error('R10D installer has an invalid embedded 7z payload boundary.');
  if (/electron-updater|autoUpdater|publish provider/iu.test(script))
    throw new Error('R10D installer script exposes updater configuration.');
  return {
    archiveSha256: hash(bytes.subarray(archive, archiveEnd)),
    installer: basename(installer),
    installerSha256: hash(bytes),
    installerSize: bytes.length,
    normalizedScriptSha256: hash(normalizeBuilderScript(script)),
    overlayStart: overlay,
    payloadOffset: archive,
    script: normalizeBuilderScript(script),
  };
}

const [leftDirectory, rightDirectory] = process.argv.slice(2);
if (leftDirectory === undefined || rightDirectory === undefined || process.argv.length !== 4)
  throw new Error('Usage: node scripts/compare-r10d-installer-samples.mjs <sample-a> <sample-b>');
const [left, right] = await Promise.all([sample(leftDirectory), sample(rightDirectory)]);
if (
  left.archiveSha256 !== right.archiveSha256 ||
  left.normalizedScriptSha256 !== right.normalizedScriptSha256 ||
  left.script !== right.script
)
  throw new Error('R10D installer payload or NSIS installation semantics differ.');
process.stdout.write(
  `${JSON.stringify({
    decision:
      left.installerSha256 === right.installerSha256
        ? 'BYTE_LEVEL'
        : 'OUTER_CONTAINER_METADATA_ONLY',
    samples: [
      { installer: left.installer, size: left.installerSize, sha256: left.installerSha256 },
      { installer: right.installer, size: right.installerSize, sha256: right.installerSha256 },
    ],
    payloadArchiveSha256: left.archiveSha256,
    normalizedNsisScriptSha256: left.normalizedScriptSha256,
  })}\n`,
);
