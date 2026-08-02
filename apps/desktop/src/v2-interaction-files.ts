import { createHash } from 'node:crypto';

import { parseManagedRelativePath } from '@mystery-operations/shared/storage';
import { LocalFileRepository, type ProjectDataRoot } from '@mystery-operations/storage';
import {
  V2InteractionError,
  V2_INTERACTION_LIMITS,
  normalizeInteractionText,
  type InteractionBlobRef,
  type InteractionKind,
  type V2InteractionFilePort,
} from '@mystery-operations/v2';

export class V2LocalInteractionFiles implements V2InteractionFilePort {
  readonly #files: LocalFileRepository;

  public constructor(root: ProjectDataRoot) {
    this.#files = new LocalFileRepository(root);
  }

  public dedupKey(
    kind: InteractionKind,
    relatedContentPackageId: string | null,
    normalizedText: string,
  ): string {
    return createHash('sha256')
      .update(['v2-r05', kind, relatedContentPackageId ?? '', normalizedText].join('\0'))
      .digest('hex');
  }

  public async writeText(
    text: string,
    purpose: 'REPLY_SUGGESTION' | 'USER_TEXT',
  ): Promise<InteractionBlobRef> {
    const maximum =
      purpose === 'USER_TEXT' ? V2_INTERACTION_LIMITS.textBytes : V2_INTERACTION_LIMITS.replyBytes;
    const normalized = normalizeInteractionText(
      text,
      maximum,
      purpose === 'USER_TEXT' ? 'userText' : 'replyText',
    );
    const descriptor = await this.#files.putBuffer(Buffer.from(normalized, 'utf8'), {
      category: 'IMPORT',
      displayName: purpose === 'USER_TEXT' ? 'interaction-user-text.txt' : 'reply-suggestion.txt',
      maxBytes: maximum,
    });
    return {
      managedPath: descriptor.managedPath,
      sha256: descriptor.sha256,
      sizeBytes: descriptor.sizeBytes,
    };
  }

  public async readText(ref: InteractionBlobRef): Promise<string> {
    const path = parseManagedRelativePath(ref.managedPath, 'IMPORT');
    if (ref.sizeBytes < 1 || ref.sizeBytes > V2_INTERACTION_LIMITS.textBytes)
      throw new V2InteractionError('INTERACTION_CORRUPT');
    await this.#files.verifyManagedFile(path, {
      expectedSha256: ref.sha256,
      expectedSizeBytes: ref.sizeBytes,
    });
    try {
      const chunks = (await this.#files.openReadStream(path).toArray()) as Buffer[];
      return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, ref.sizeBytes));
    } catch {
      throw new V2InteractionError('INTERACTION_CORRUPT');
    }
  }
}
