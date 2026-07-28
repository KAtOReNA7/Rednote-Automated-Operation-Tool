import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

import {
  SqliteBrowserClipRepository,
  type BrowserClipScreenshotRecordV1,
  type BrowserClipViewV1,
} from '@mystery-operations/db';
import {
  type BrowserClipBusinessServiceV1,
  type LocalApiAuthClient,
  LocalApiError,
} from '@mystery-operations/local-api';
import {
  BROWSER_CLIP_MAX_SCREENSHOT_BYTES,
  BROWSER_CLIP_MAX_SCREENSHOT_PIXELS,
  BrowserClipContractError,
  type BrowserClipCreateV1,
  type BrowserClipReceiptV1,
  type BrowserClipResponseV1,
} from '@mystery-operations/shared';
import { LocalFileRepository, type ProjectDataRoot } from '@mystery-operations/storage';

function pngDimensions(bytes: Buffer): { readonly height: number; readonly width: number } | null {
  if (
    bytes.length < 24 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    bytes.subarray(12, 16).toString('ascii') !== 'IHDR'
  ) {
    return null;
  }
  return { height: bytes.readUInt32BE(20), width: bytes.readUInt32BE(16) };
}

function jpegDimensions(bytes: Buffer): { readonly height: number; readonly width: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1] ?? 0;
    offset += 2;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (
      [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
        marker,
      )
    ) {
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return null;
}

export function decodeBrowserClipScreenshot(dataUrl: string): {
  readonly bytes: Buffer;
  readonly height: number;
  readonly mime: 'image/jpeg' | 'image/png';
  readonly sha256: string;
  readonly width: number;
} {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(dataUrl);
  if (match === null) throw new BrowserClipContractError('CLIPPER_SCREENSHOT_INVALID');
  const bytes = Buffer.from(match[2] ?? '', 'base64');
  if (
    bytes.length < 16 ||
    bytes.length > BROWSER_CLIP_MAX_SCREENSHOT_BYTES ||
    bytes.toString('base64') !== match[2]
  ) {
    throw new BrowserClipContractError('CLIPPER_SCREENSHOT_TOO_LARGE');
  }
  const mime = match[1] as 'image/jpeg' | 'image/png';
  const dimensions = mime === 'image/png' ? pngDimensions(bytes) : jpegDimensions(bytes);
  if (
    dimensions === null ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width * dimensions.height > BROWSER_CLIP_MAX_SCREENSHOT_PIXELS
  ) {
    throw new BrowserClipContractError('CLIPPER_SCREENSHOT_INVALID');
  }
  return {
    bytes,
    height: dimensions.height,
    mime,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    width: dimensions.width,
  };
}

export class DesktopBrowserClipRuntime implements BrowserClipBusinessServiceV1 {
  readonly #activeClients = new Set<string>();
  readonly #files: LocalFileRepository;
  readonly #repository: SqliteBrowserClipRepository;

  public constructor(database: DatabaseSync, root: ProjectDataRoot) {
    this.#files = new LocalFileRepository(root);
    this.#repository = new SqliteBrowserClipRepository(database);
  }

  public async create(
    client: LocalApiAuthClient,
    extensionOrigin: string,
    clip: BrowserClipCreateV1,
  ): Promise<BrowserClipResponseV1> {
    if (this.#activeClients.has(client.id)) throw new LocalApiError('CLIPPER_RATE_LIMITED');
    this.#activeClients.add(client.id);
    try {
      const screenshot = await this.#storeScreenshot(clip);
      const payloadHash = createHash('sha256').update(JSON.stringify(clip), 'utf8').digest('hex');
      const receipt = await this.#repository.ingest({
        clientId: client.id,
        clip,
        extensionOrigin,
        now: new Date().toISOString(),
        payloadHash,
        screenshot,
      });
      return { apiVersion: '1', receipt };
    } catch (error) {
      if (error instanceof BrowserClipContractError) {
        if (
          error.code === 'CLIPPER_CAPTURE_CONFLICT' ||
          error.code === 'CLIPPER_RATE_LIMITED' ||
          error.code === 'CLIPPER_SCREENSHOT_INVALID'
        ) {
          throw new LocalApiError(error.code);
        }
        if (error.code === 'CLIPPER_SCREENSHOT_TOO_LARGE') {
          throw new LocalApiError('CLIPPER_SCREENSHOT_INVALID');
        }
      }
      throw error;
    } finally {
      this.#activeClients.delete(client.id);
    }
  }

  public async getReceipt(
    client: LocalApiAuthClient,
    extensionOrigin: string,
    captureId: string,
  ): Promise<BrowserClipReceiptV1> {
    return this.#repository.getReceipt(client.id, extensionOrigin, captureId);
  }

  public listClips(): readonly BrowserClipViewV1[] {
    return this.#repository.listClips();
  }

  public getClip(clipId: string): BrowserClipViewV1 | null {
    return this.#repository.getClip(clipId);
  }

  public async readScreenshot(
    clipId: string,
  ): Promise<{ readonly bytes: Uint8Array; readonly mime: 'image/jpeg' | 'image/png' } | null> {
    const screenshot = this.#repository.getScreenshot(clipId);
    if (screenshot === null) return null;
    await this.#files.verifyManagedFile(
      screenshot.managedPath as Parameters<LocalFileRepository['verifyManagedFile']>[0],
      {
        expectedSha256: screenshot.sha256,
        expectedSizeBytes: screenshot.bytes,
      },
    );
    const chunks: Buffer[] = [];
    for await (const chunk of this.#files.openReadStream(
      screenshot.managedPath as Parameters<LocalFileRepository['openReadStream']>[0],
    )) {
      chunks.push(Buffer.from(chunk as Uint8Array));
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== screenshot.bytes) throw new LocalApiError('CLIPPER_STORAGE_FAILED');
    return { bytes, mime: screenshot.mime };
  }

  async #storeScreenshot(clip: BrowserClipCreateV1): Promise<BrowserClipScreenshotRecordV1 | null> {
    if (clip.screenshot === null) return null;
    const decoded = decodeBrowserClipScreenshot(clip.screenshot.dataUrl);
    const descriptor = await this.#files.putBuffer(decoded.bytes, {
      category: 'CLIP_SCREENSHOT',
      displayName: decoded.mime === 'image/png' ? 'clip.png' : 'clip.jpg',
      maxBytes: BROWSER_CLIP_MAX_SCREENSHOT_BYTES,
    });
    if (descriptor.sha256 !== decoded.sha256 || descriptor.sizeBytes !== decoded.bytes.length) {
      throw new LocalApiError('CLIPPER_STORAGE_FAILED');
    }
    return {
      bytes: descriptor.sizeBytes,
      height: decoded.height,
      managedPath: descriptor.managedPath,
      mime: decoded.mime,
      sha256: descriptor.sha256,
      width: decoded.width,
    };
  }
}
