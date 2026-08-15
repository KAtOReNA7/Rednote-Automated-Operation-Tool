export const V2_INTERACTION_KINDS = ['COMMENT', 'DIRECT_MESSAGE'] as const;
// prettier-ignore
export const V2_INTERACTION_LIMITS = Object.freeze({ batchCount: 40, replyBytes: 4_000, textBytes: 8_000 });

export type InteractionKind = (typeof V2_INTERACTION_KINDS)[number];
export type InteractionStatus =
  'CONFIRMED' | 'DELETED' | 'MANUAL_SENT' | 'NEW' | 'SKIPPED' | 'SUGGESTED';
export type V2InteractionErrorCode =
  'INTERACTION_CORRUPT' | 'INTERACTION_STATE_INVALID' | 'INVALID_REQUEST' | 'REVISION_CONFLICT';

export interface InteractionBlobRef {
  readonly managedPath: string;
  readonly sha256: string;
  readonly sizeBytes: number;
}

export interface ReplySuggestionRecord {
  readonly files: InteractionBlobRef;
  readonly version: number;
  readonly versionId: string;
  readonly modelRunId: string | null;
  readonly providerKind: 'MODEL' | 'SCRIPTED';
}

export interface InteractionRecord {
  readonly currentSuggestion: ReplySuggestionRecord | null;
  readonly dedupKey: string;
  readonly itemId: string;
  readonly kind: InteractionKind;
  readonly relatedContentPackageId: string | null;
  readonly revision: number;
  readonly status: InteractionStatus;
  readonly userText: InteractionBlobRef;
}

export interface InteractionItem {
  readonly currentSuggestion: string | null;
  readonly currentSuggestionVersion: number | null;
  readonly currentSuggestionVersionId: string | null;
  readonly itemId: string;
  readonly kind: InteractionKind;
  readonly relatedContentPackageId: string | null;
  readonly revision: number;
  readonly status: Exclude<InteractionStatus, 'DELETED'>;
  readonly userText: string;
}

// prettier-ignore
export type InteractionWorkspace = Readonly<{ items: readonly InteractionItem[]; schemaVersion: 1 }>;

export interface InteractionDeletePreview {
  readonly itemId: string;
  readonly physicalDeletion: false;
  readonly retainedManagedReferenceCount: number;
  readonly tombstone: true;
}
export type InteractionCreateResult = Readonly<{
  duplicate: boolean;
  item: InteractionItem;
  persisted: true;
}>;

export interface InteractionVersionRef {
  readonly expectedRevision: number;
  readonly expectedVersionId: string;
  readonly itemId: string;
}
type InteractionItemRef = Omit<InteractionVersionRef, 'expectedVersionId'>;

export type InteractionReadRequest =
  | { readonly view: 'INTERACTIONS' }
  | { readonly itemId: string; readonly view: 'INTERACTION_DELETE_PREVIEW' };

export type InteractionMutationRequest =
  | {
      readonly action: 'CREATE_INTERACTION';
      readonly expectedRevision: 0;
      readonly kind: InteractionKind;
      readonly relatedContentPackageId: string | null;
      readonly userText: string;
    }
  | ({
      readonly action: 'GENERATE_REPLY_SUGGESTION';
      readonly idempotencyKey: string;
    } & InteractionItemRef)
  | ({
      readonly action: 'SAVE_REPLY_SUGGESTION';
      readonly replyText: string;
    } & InteractionVersionRef)
  | {
      readonly action: 'CONFIRM_REPLY_SUGGESTIONS';
      readonly items: readonly InteractionVersionRef[];
    }
  | ({ readonly action: 'SKIP_INTERACTION' } & InteractionItemRef)
  | ({ readonly action: 'REOPEN_INTERACTION' } & InteractionItemRef)
  | ({ readonly action: 'UNDO_INTERACTION_MANUAL_SENT' } & InteractionItemRef)
  | ({
      readonly action: 'MARK_INTERACTION_MANUAL_SENT';
      readonly confirmed: true;
    } & InteractionVersionRef)
  | ({ readonly action: 'DELETE_INTERACTION'; readonly confirmed: true } & InteractionItemRef);

// prettier-ignore
const interactionActionPattern = /^(?:CREATE_INTERACTION|GENERATE_REPLY_SUGGESTION|SAVE_REPLY_SUGGESTION|CONFIRM_REPLY_SUGGESTIONS|SKIP_INTERACTION|REOPEN_INTERACTION|MARK_INTERACTION_MANUAL_SENT|UNDO_INTERACTION_MANUAL_SENT|DELETE_INTERACTION)$/u;
// prettier-ignore
export function isInteractionMutationRequest(value: Record<'action', string>): value is InteractionMutationRequest { return interactionActionPattern.test(value.action); }

export interface V2InteractionFilePort {
  dedupKey(
    kind: InteractionKind,
    relatedContentPackageId: string | null,
    normalizedText: string,
  ): string;
  readText(ref: InteractionBlobRef): Promise<string>;
  writeText(text: string, purpose: 'REPLY_SUGGESTION' | 'USER_TEXT'): Promise<InteractionBlobRef>;
}

export interface V2InteractionRepositoryPort {
  appendSuggestion(
    current: InteractionRecord,
    files: InteractionBlobRef,
    provenance?: {
      readonly modelRunId: string | null;
      readonly providerKind: 'MODEL' | 'SCRIPTED';
    },
  ): InteractionRecord;
  batchConfirm(items: readonly InteractionVersionRef[]): readonly InteractionRecord[];
  contentPackageExists(packageId: string): boolean;
  createInteraction(record: InteractionRecord): InteractionRecord;
  findInteractionByDedup(dedupKey: string): InteractionRecord | null;
  getInteraction(itemId: string): InteractionRecord;
  listInteractions(): readonly InteractionRecord[];
  previewDeleteInteraction(itemId: string): InteractionDeletePreview;
  tombstoneInteraction(itemId: string, expectedRevision: number): void;
  transitionInteraction(
    itemId: string,
    expectedRevision: number,
    expectedVersionId: string | null,
    allowed: readonly InteractionStatus[],
    next: InteractionStatus,
  ): InteractionRecord;
}

export class ScriptedReplyProvider {
  public generate(input: {
    readonly kind: InteractionKind;
    readonly personaName: string;
    readonly relatedContentPackageId: string | null;
    readonly tone: string;
    readonly userText: string;
  }): string {
    const subject = input.userText.length > 80 ? `${input.userText.slice(0, 80)}…` : input.userText;
    const channel = input.kind === 'COMMENT' ? '评论' : '私信';
    const related = input.relatedContentPackageId === null ? '' : '关于你提到的这条内容，';
    return `${input.personaName}收到这条${channel}了。${related}你问到“${subject}”。这是本地整理的回复建议，请在发送前按实际情况确认。`;
  }
}

export class V2InteractionError extends Error {
  public constructor(
    public readonly code: V2InteractionErrorCode,
    public readonly affectedFields: readonly string[] = [],
  ) {
    super(code);
    this.name = 'V2InteractionError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join('\0') === keys.slice().sort().join('\0');
}

export function utf8Bytes(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
  }
  return bytes;
}
function revision(value: unknown, field = 'expectedRevision'): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new V2InteractionError('INVALID_REQUEST', [field]);
  return value as number;
}

function token(value: unknown, field: string, maximum = 112): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > maximum ||
    !/^[a-z0-9_-]+$/iu.test(value)
  )
    throw new V2InteractionError('INVALID_REQUEST', [field]);
  return value;
}

export function normalizeInteractionText(
  value: unknown,
  maximumBytes: number,
  field: string,
): string {
  if (typeof value !== 'string') throw new V2InteractionError('INVALID_REQUEST', [field]);
  const normalized = value.normalize('NFC').replace(/\r\n?/gu, '\n').trim();
  const size = utf8Bytes(normalized);
  if (size < 1 || size > maximumBytes || normalized.includes('\u0000'))
    throw new V2InteractionError('INVALID_REQUEST', [field]);
  return normalized;
}

function versionRef(value: unknown): InteractionVersionRef {
  if (!isRecord(value)) throw new V2InteractionError('INVALID_REQUEST', ['items']);
  return {
    expectedRevision: revision(value.expectedRevision),
    expectedVersionId: token(value.expectedVersionId, 'expectedVersionId'),
    itemId: token(value.itemId, 'itemId'),
  };
}

export function parseInteractionReadRequest(value: unknown): InteractionReadRequest {
  if (!isRecord(value)) throw new V2InteractionError('INVALID_REQUEST');
  if (value.view === 'INTERACTIONS' && exactKeys(value, ['view'])) return { view: value.view };
  if (value.view === 'INTERACTION_DELETE_PREVIEW' && exactKeys(value, ['itemId', 'view']))
    return { itemId: token(value.itemId, 'itemId'), view: value.view };
  throw new V2InteractionError('INVALID_REQUEST');
}

export function parseInteractionMutationRequest(value: unknown): InteractionMutationRequest {
  if (!isRecord(value)) throw new V2InteractionError('INVALID_REQUEST');
  if (
    value.action === 'CREATE_INTERACTION' &&
    exactKeys(value, [
      'action',
      'expectedRevision',
      'kind',
      'relatedContentPackageId',
      'userText',
    ]) &&
    V2_INTERACTION_KINDS.includes(value.kind as InteractionKind) &&
    value.expectedRevision === 0
  ) {
    return {
      action: value.action,
      expectedRevision: 0,
      kind: value.kind as InteractionKind,
      relatedContentPackageId:
        value.relatedContentPackageId === null
          ? null
          : token(value.relatedContentPackageId, 'relatedContentPackageId', 96),
      userText: normalizeInteractionText(
        value.userText,
        V2_INTERACTION_LIMITS.textBytes,
        'userText',
      ),
    };
  }
  if (
    value.action === 'GENERATE_REPLY_SUGGESTION' &&
    exactKeys(value, ['action', 'expectedRevision', 'idempotencyKey', 'itemId'])
  )
    return {
      action: value.action,
      expectedRevision: revision(value.expectedRevision),
      idempotencyKey: token(value.idempotencyKey, 'idempotencyKey'),
      itemId: token(value.itemId, 'itemId'),
    };
  if (
    value.action === 'SAVE_REPLY_SUGGESTION' &&
    exactKeys(value, ['action', 'expectedRevision', 'expectedVersionId', 'itemId', 'replyText'])
  )
    return {
      action: value.action,
      ...versionRef(value),
      replyText: normalizeInteractionText(
        value.replyText,
        V2_INTERACTION_LIMITS.replyBytes,
        'replyText',
      ),
    };
  if (value.action === 'CONFIRM_REPLY_SUGGESTIONS' && exactKeys(value, ['action', 'items'])) {
    if (
      !Array.isArray(value.items) ||
      value.items.length < 1 ||
      value.items.length > V2_INTERACTION_LIMITS.batchCount
    )
      throw new V2InteractionError('INVALID_REQUEST', ['items']);
    const items = value.items.map(versionRef);
    if (new Set(items.map(({ itemId }) => itemId)).size !== items.length)
      throw new V2InteractionError('INVALID_REQUEST', ['items']);
    return { action: value.action, items };
  }
  if (
    ['SKIP_INTERACTION', 'REOPEN_INTERACTION', 'UNDO_INTERACTION_MANUAL_SENT'].includes(
      String(value.action),
    ) &&
    exactKeys(value, ['action', 'expectedRevision', 'itemId'])
  )
    return {
      action: value.action as
        'REOPEN_INTERACTION' | 'SKIP_INTERACTION' | 'UNDO_INTERACTION_MANUAL_SENT',
      expectedRevision: revision(value.expectedRevision),
      itemId: token(value.itemId, 'itemId'),
    };
  if (
    value.action === 'MARK_INTERACTION_MANUAL_SENT' &&
    value.confirmed === true &&
    exactKeys(value, ['action', 'confirmed', 'expectedRevision', 'expectedVersionId', 'itemId'])
  )
    return { action: value.action, confirmed: true, ...versionRef(value) };
  if (
    value.action === 'DELETE_INTERACTION' &&
    value.confirmed === true &&
    exactKeys(value, ['action', 'confirmed', 'expectedRevision', 'itemId'])
  )
    return {
      action: value.action,
      confirmed: true,
      expectedRevision: revision(value.expectedRevision),
      itemId: token(value.itemId, 'itemId'),
    };
  throw new V2InteractionError('INVALID_REQUEST');
}

export class V2InteractionApplication {
  public constructor(
    private readonly repository: V2InteractionRepositoryPort,
    private readonly files: V2InteractionFilePort,
    private readonly provider = new ScriptedReplyProvider(),
  ) {}

  public async read(): Promise<InteractionWorkspace> {
    return {
      items: await Promise.all(
        this.repository.listInteractions().map((item) => this.#hydrate(item)),
      ),
      schemaVersion: 1,
    };
  }

  public async previewDelete(itemId: string): Promise<InteractionDeletePreview> {
    return this.repository.previewDeleteInteraction(itemId);
  }

  public async generateFromReply(
    request: Extract<InteractionMutationRequest, { action: 'GENERATE_REPLY_SUGGESTION' }>,
    replyValue: unknown,
    modelRunId: string | null = null,
  ): Promise<InteractionItem> {
    const current = this.repository.getInteraction(request.itemId);
    if (current.status === 'SUGGESTED' && current.currentSuggestion !== null)
      return this.#hydrate(current);
    if (current.revision !== request.expectedRevision)
      throw new V2InteractionError('REVISION_CONFLICT', ['interaction']);
    if (current.status !== 'NEW')
      throw new V2InteractionError('INTERACTION_STATE_INVALID', ['status']);
    const reply = normalizeInteractionText(
      replyValue,
      V2_INTERACTION_LIMITS.replyBytes,
      'replyText',
    );
    return this.#hydrate(
      this.repository.appendSuggestion(
        current,
        await this.files.writeText(reply, 'REPLY_SUGGESTION'),
        { modelRunId, providerKind: modelRunId === null ? 'SCRIPTED' : 'MODEL' },
      ),
    );
  }

  public async mutate(
    request: InteractionMutationRequest,
    persona: { readonly name: string; readonly tone: string },
  ): Promise<InteractionCreateResult | InteractionItem | InteractionWorkspace> {
    if (request.action === 'CREATE_INTERACTION') return this.#create(request);
    if (request.action === 'GENERATE_REPLY_SUGGESTION') return this.#generate(request, persona);
    if (request.action === 'SAVE_REPLY_SUGGESTION') return this.#save(request);
    if (request.action === 'CONFIRM_REPLY_SUGGESTIONS') {
      this.repository.batchConfirm(request.items);
      return this.read();
    }
    if (request.action === 'DELETE_INTERACTION') {
      this.repository.tombstoneInteraction(request.itemId, request.expectedRevision);
      return this.read();
    }
    const current = this.repository.getInteraction(request.itemId);
    const transition =
      request.action === 'SKIP_INTERACTION'
        ? { allowed: ['NEW', 'SUGGESTED'] as const, next: 'SKIPPED' as const }
        : request.action === 'REOPEN_INTERACTION'
          ? {
              allowed: ['SKIPPED'] as const,
              next: current.currentSuggestion === null ? ('NEW' as const) : ('SUGGESTED' as const),
            }
          : request.action === 'UNDO_INTERACTION_MANUAL_SENT'
            ? { allowed: ['MANUAL_SENT'] as const, next: 'CONFIRMED' as const }
            : null;
    if (transition !== null)
      return this.#hydrate(
        this.repository.transitionInteraction(
          current.itemId,
          request.expectedRevision,
          null,
          transition.allowed,
          transition.next,
        ),
      );
    return this.#hydrate(
      this.repository.transitionInteraction(
        current.itemId,
        request.expectedRevision,
        request.action === 'MARK_INTERACTION_MANUAL_SENT' ? request.expectedVersionId : null,
        ['CONFIRMED'],
        'MANUAL_SENT',
      ),
    );
  }

  async #create(
    request: Extract<InteractionMutationRequest, { action: 'CREATE_INTERACTION' }>,
  ): Promise<InteractionCreateResult> {
    const userText = normalizeInteractionText(
      request.userText,
      V2_INTERACTION_LIMITS.textBytes,
      'userText',
    );
    if (
      request.relatedContentPackageId !== null &&
      !this.repository.contentPackageExists(request.relatedContentPackageId)
    )
      throw new V2InteractionError('INVALID_REQUEST', ['relatedContentPackageId']);
    const dedupKey = this.files.dedupKey(request.kind, request.relatedContentPackageId, userText);
    const existing = this.repository.findInteractionByDedup(dedupKey);
    if (existing !== null) {
      if (existing.status === 'DELETED')
        throw new V2InteractionError('INTERACTION_STATE_INVALID', ['itemId']);
      return { duplicate: true, item: await this.#hydrate(existing), persisted: true };
    }
    const userTextFile = await this.files.writeText(userText, 'USER_TEXT');
    const item = this.repository.createInteraction({
      currentSuggestion: null,
      dedupKey,
      itemId: `interaction-${dedupKey.slice(0, 32)}`,
      kind: request.kind,
      relatedContentPackageId: request.relatedContentPackageId,
      revision: 0,
      status: 'NEW',
      userText: userTextFile,
    });
    const persisted = this.repository.getInteraction(item.itemId);
    return { duplicate: false, item: await this.#hydrate(persisted), persisted: true };
  }

  async #generate(
    request: Extract<InteractionMutationRequest, { action: 'GENERATE_REPLY_SUGGESTION' }>,
    persona: { readonly name: string; readonly tone: string },
  ): Promise<InteractionItem> {
    const current = this.repository.getInteraction(request.itemId);
    if (current.status === 'SUGGESTED' && current.currentSuggestion !== null)
      return this.#hydrate(current);
    if (current.revision !== request.expectedRevision)
      throw new V2InteractionError('REVISION_CONFLICT', ['interaction']);
    if (current.status !== 'NEW')
      throw new V2InteractionError('INTERACTION_STATE_INVALID', ['status']);
    const userText = await this.files.readText(current.userText);
    const reply = this.provider.generate({
      kind: current.kind,
      personaName: persona.name,
      relatedContentPackageId: current.relatedContentPackageId,
      tone: persona.tone,
      userText,
    });
    return this.generateFromReply(request, reply);
  }

  async #save(
    request: Extract<InteractionMutationRequest, { action: 'SAVE_REPLY_SUGGESTION' }>,
  ): Promise<InteractionItem> {
    const current = this.repository.getInteraction(request.itemId);
    if (
      current.revision !== request.expectedRevision ||
      current.currentSuggestion?.versionId !== request.expectedVersionId
    )
      throw new V2InteractionError('REVISION_CONFLICT', ['interaction']);
    if (!['SUGGESTED', 'CONFIRMED'].includes(current.status) || current.currentSuggestion === null)
      throw new V2InteractionError('INTERACTION_STATE_INVALID', ['status']);
    if ((await this.files.readText(current.currentSuggestion.files)) === request.replyText)
      return this.#hydrate(current);
    return this.#hydrate(
      this.repository.appendSuggestion(
        current,
        await this.files.writeText(request.replyText, 'REPLY_SUGGESTION'),
      ),
    );
  }

  async #hydrate(record: InteractionRecord): Promise<InteractionItem> {
    if (record.status === 'DELETED')
      throw new V2InteractionError('INTERACTION_STATE_INVALID', ['itemId']);
    return {
      currentSuggestion:
        record.currentSuggestion === null
          ? null
          : await this.files.readText(record.currentSuggestion.files),
      currentSuggestionVersion: record.currentSuggestion?.version ?? null,
      currentSuggestionVersionId: record.currentSuggestion?.versionId ?? null,
      itemId: record.itemId,
      kind: record.kind,
      relatedContentPackageId: record.relatedContentPackageId,
      revision: record.revision,
      status: record.status,
      userText: await this.files.readText(record.userText),
    };
  }
}
