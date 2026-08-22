import {
  deterministicReview,
  parseMetricSnapshot,
  type MetricWindow,
  type MetricsReview,
} from '@mystery-operations/v2';

export const WEB_INTERACTION_STATUSES = [
  'NEW',
  'SUGGESTED',
  'CONFIRMED',
  'SKIPPED',
  'MANUAL_SENT',
  'DELETED',
] as const;
export type WebInteractionStatus = (typeof WEB_INTERACTION_STATUSES)[number];
export type WebInteractionKind = 'COMMENT' | 'DIRECT_MESSAGE';

export interface WebReplyVersion {
  readonly createdAt: string;
  readonly modelId: string | null;
  readonly source: 'MANUAL' | 'MODEL';
  readonly text: string;
  readonly version: number;
  readonly versionId: string;
}

export interface WebInteractionItem {
  readonly createdAt: string;
  readonly currentSuggestionVersionId: string | null;
  readonly dedupKey: string;
  readonly itemId: string;
  readonly kind: WebInteractionKind;
  readonly manualSentAt: string | null;
  readonly relatedContentPackageId: string | null;
  readonly replies: readonly WebReplyVersion[];
  readonly revision: number;
  readonly status: WebInteractionStatus;
  readonly userText: string;
}

export interface WebLibraryItem {
  readonly author: string | null;
  readonly clipIdentity: string | null;
  readonly createdAt: string;
  readonly id: string;
  readonly revision: number;
  readonly screenshotDataUrl: string | null;
  readonly sourceKind: 'CATALOG' | 'CLIPPER';
  readonly sourceOrigin: string | null;
  readonly sourcePath: string | null;
  readonly summary: string;
  readonly title: string;
}

export interface WebClipReceipt {
  readonly clipIdentity: string;
  readonly contentHash: string;
  readonly importedAt: string;
  readonly itemId: string;
}

export interface WebMetricVersion {
  readonly collections: number;
  readonly comments: number;
  readonly likes: number;
  readonly newFollowers: number;
  readonly packageId: string;
  readonly publishedAt: string;
  readonly revision: number;
  readonly snapshotWindow: MetricWindow;
  readonly views: number;
}

export interface WebStrategyDecision {
  readonly decidedAt: string;
  readonly fingerprint: string;
  readonly id: string;
  readonly revision: number;
  readonly status: 'ACCEPTED' | 'REJECTED';
}

export interface WebProviderSettings {
  readonly baseUrl: string | null;
  readonly budgetPerCallMicrounits: number | null;
  readonly capabilityCheckedAt: string | null;
  readonly estimatedCostPerCallMicrounits: number | null;
  readonly revision: number;
  readonly structuredJson: 'STALE' | 'SUPPORTED' | 'UNKNOWN' | 'UNSUPPORTED';
  readonly writingModelId: string | null;
}

export interface WebW2Slices {
  readonly clipReceipts: readonly WebClipReceipt[];
  readonly interactions: readonly WebInteractionItem[];
  readonly library: readonly WebLibraryItem[];
  readonly metricSnapshots: readonly WebMetricVersion[];
  readonly provider: WebProviderSettings;
  readonly strategyDecisions: readonly WebStrategyDecision[];
}

export interface WebCatalogImportItem {
  readonly author: string | null;
  readonly id: string;
  readonly sourcePath: string | null;
  readonly summary: string;
  readonly title: string;
}

export interface WebCatalogImport {
  readonly format: 'rednote-web-catalog';
  readonly items: readonly WebCatalogImportItem[];
  readonly version: 1;
}

export interface WebClipImport {
  readonly capturedAt: string;
  readonly clipIdentity: string;
  readonly format: 'rednote-web-clip';
  readonly pageTitle: string;
  readonly screenshotDataUrl: string | null;
  readonly selectedText: string | null;
  readonly sourceUrl: string;
  readonly userNote: string | null;
  readonly version: 1;
}

export const WEB_W2_LIMITS = Object.freeze({
  catalogBytes: 512 * 1024,
  catalogItems: 200,
  clipBytes: 768 * 1024,
  interactionBytes: 8_000,
  libraryItems: 1_000,
  replyBytes: 4_000,
  screenshotDataUrlCharacters: 512 * 1024,
});

function fail(field: string): never {
  throw new TypeError(`W2_STATE_INVALID:${field}`);
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) fail('keys');
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function text(value: unknown, field: string, maximum: number, nullable = false): string | null {
  if (nullable && value === null) return null;
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    utf8Bytes(value) > maximum ||
    value.includes('\u0000')
  )
    fail(field);
  return value;
}

function id(value: unknown, field: string): string {
  const parsed = text(value, field, 128);
  if (parsed === null || !/^[a-z0-9][a-z0-9_-]{0,127}$/iu.test(parsed)) fail(field);
  return parsed;
}

function integer(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!Number.isSafeInteger(value) || (value as number) < 0) fail(field);
  return value as number;
}

function iso(value: unknown, field: string, nullable = false): string | null {
  const parsed = text(value, field, 64, nullable);
  if (parsed === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(parsed)) fail(field);
  return parsed;
}

function sha(value: unknown, field: string): string {
  const parsed = text(value, field, 64);
  if (parsed === null || !/^[a-f0-9]{64}$/u.test(parsed)) fail(field);
  return parsed;
}

function httpsUrl(value: unknown, field: string): string {
  const parsed = text(value, field, 2_048);
  if (parsed === null) fail(field);
  let url: URL;
  try {
    url = new URL(parsed);
  } catch {
    fail(field);
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '')
    fail(field);
  return url.toString();
}

function providerBaseUrl(value: unknown): string | null {
  if (value === null) return null;
  const parsed = httpsUrl(value, 'provider.baseUrl');
  const url = new URL(parsed);
  if (url.search !== '') fail('provider.baseUrl');
  return parsed.replace(/\/$/u, '');
}

function parseReply(value: unknown): WebReplyVersion {
  if (!record(value)) fail('reply');
  exact(value, ['createdAt', 'modelId', 'source', 'text', 'version', 'versionId']);
  if (value.source !== 'MANUAL' && value.source !== 'MODEL') fail('reply.source');
  return Object.freeze({
    createdAt: iso(value.createdAt, 'reply.createdAt') as string,
    modelId: text(value.modelId, 'reply.modelId', 200, true),
    source: value.source,
    text: text(value.text, 'reply.text', WEB_W2_LIMITS.replyBytes) as string,
    version: integer(value.version, 'reply.version') as number,
    versionId: id(value.versionId, 'reply.versionId'),
  });
}

function parseInteraction(value: unknown, packageIds: ReadonlySet<string>): WebInteractionItem {
  if (!record(value)) fail('interaction');
  exact(value, [
    'createdAt',
    'currentSuggestionVersionId',
    'dedupKey',
    'itemId',
    'kind',
    'manualSentAt',
    'relatedContentPackageId',
    'replies',
    'revision',
    'status',
    'userText',
  ]);
  if (value.kind !== 'COMMENT' && value.kind !== 'DIRECT_MESSAGE') fail('interaction.kind');
  if (!WEB_INTERACTION_STATUSES.includes(value.status as WebInteractionStatus))
    fail('interaction.status');
  if (!Array.isArray(value.replies) || value.replies.length > 100) fail('interaction.replies');
  const replies = value.replies.map(parseReply);
  if (replies.some((reply, index) => reply.version !== index + 1)) fail('interaction.replies');
  const related =
    value.relatedContentPackageId === null
      ? null
      : id(value.relatedContentPackageId, 'interaction.relatedContentPackageId');
  if (related !== null && !packageIds.has(related)) fail('interaction.relatedContentPackageId');
  const current =
    value.currentSuggestionVersionId === null
      ? null
      : id(value.currentSuggestionVersionId, 'interaction.currentSuggestionVersionId');
  if (
    (current === null) !== (replies.length === 0) ||
    (current !== null && replies.at(-1)?.versionId !== current)
  )
    fail('interaction.currentSuggestionVersionId');
  if (value.status === 'MANUAL_SENT' && value.manualSentAt === null)
    fail('interaction.manualSentAt');
  return Object.freeze({
    createdAt: iso(value.createdAt, 'interaction.createdAt') as string,
    currentSuggestionVersionId: current,
    dedupKey: sha(value.dedupKey, 'interaction.dedupKey'),
    itemId: id(value.itemId, 'interaction.itemId'),
    kind: value.kind,
    manualSentAt: iso(value.manualSentAt, 'interaction.manualSentAt', true),
    relatedContentPackageId: related,
    replies: Object.freeze(replies),
    revision: integer(value.revision, 'interaction.revision') as number,
    status: value.status as WebInteractionStatus,
    userText: text(
      value.userText,
      'interaction.userText',
      WEB_W2_LIMITS.interactionBytes,
    ) as string,
  });
}

function parseLibraryItem(value: unknown): WebLibraryItem {
  if (!record(value)) fail('library');
  exact(value, [
    'author',
    'clipIdentity',
    'createdAt',
    'id',
    'revision',
    'screenshotDataUrl',
    'sourceKind',
    'sourceOrigin',
    'sourcePath',
    'summary',
    'title',
  ]);
  if (value.sourceKind !== 'CATALOG' && value.sourceKind !== 'CLIPPER') fail('library.sourceKind');
  const screenshot = text(
    value.screenshotDataUrl,
    'library.screenshotDataUrl',
    WEB_W2_LIMITS.screenshotDataUrlCharacters,
    true,
  );
  if (
    screenshot !== null &&
    !/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/u.test(screenshot)
  )
    fail('library.screenshotDataUrl');
  const origin =
    value.sourceOrigin === null
      ? null
      : new URL(httpsUrl(value.sourceOrigin, 'library.sourceOrigin')).origin;
  return Object.freeze({
    author: text(value.author, 'library.author', 300, true),
    clipIdentity:
      value.clipIdentity === null ? null : sha(value.clipIdentity, 'library.clipIdentity'),
    createdAt: iso(value.createdAt, 'library.createdAt') as string,
    id: id(value.id, 'library.id'),
    revision: integer(value.revision, 'library.revision') as number,
    screenshotDataUrl: screenshot,
    sourceKind: value.sourceKind,
    sourceOrigin: origin,
    sourcePath: text(value.sourcePath, 'library.sourcePath', 512, true),
    summary: text(value.summary, 'library.summary', 8_000) as string,
    title: text(value.title, 'library.title', 512) as string,
  });
}

function parseReceipt(value: unknown): WebClipReceipt {
  if (!record(value)) fail('clipReceipt');
  exact(value, ['clipIdentity', 'contentHash', 'importedAt', 'itemId']);
  return Object.freeze({
    clipIdentity: sha(value.clipIdentity, 'clipReceipt.clipIdentity'),
    contentHash: sha(value.contentHash, 'clipReceipt.contentHash'),
    importedAt: iso(value.importedAt, 'clipReceipt.importedAt') as string,
    itemId: id(value.itemId, 'clipReceipt.itemId'),
  });
}

function parseMetric(value: unknown, approvedPackageIds: ReadonlySet<string>): WebMetricVersion {
  if (!record(value)) fail('metric');
  exact(value, [
    'collections',
    'comments',
    'likes',
    'newFollowers',
    'packageId',
    'publishedAt',
    'revision',
    'snapshotWindow',
    'views',
  ]);
  const parsed = parseMetricSnapshot({
    collections: value.collections,
    comments: value.comments,
    expectedRevision: value.revision,
    likes: value.likes,
    newFollowers: value.newFollowers,
    packageId: value.packageId,
    publishedAt: value.publishedAt,
    snapshotWindow: value.snapshotWindow,
    views: value.views,
  });
  if (!approvedPackageIds.has(parsed.packageId)) fail('metric.packageId');
  return Object.freeze({
    collections: parsed.collections,
    comments: parsed.comments,
    likes: parsed.likes,
    newFollowers: parsed.newFollowers,
    packageId: parsed.packageId,
    publishedAt: parsed.publishedAt,
    revision: integer(value.revision, 'metric.revision') as number,
    snapshotWindow: parsed.snapshotWindow,
    views: parsed.views,
  });
}

function parseDecision(value: unknown): WebStrategyDecision {
  if (!record(value)) fail('strategyDecision');
  exact(value, ['decidedAt', 'fingerprint', 'id', 'revision', 'status']);
  if (value.status !== 'ACCEPTED' && value.status !== 'REJECTED') fail('strategyDecision.status');
  return Object.freeze({
    decidedAt: iso(value.decidedAt, 'strategyDecision.decidedAt') as string,
    fingerprint: text(value.fingerprint, 'strategyDecision.fingerprint', 512) as string,
    id: id(value.id, 'strategyDecision.id'),
    revision: integer(value.revision, 'strategyDecision.revision') as number,
    status: value.status,
  });
}

function parseProvider(value: unknown): WebProviderSettings {
  if (!record(value)) fail('provider');
  exact(value, [
    'baseUrl',
    'budgetPerCallMicrounits',
    'capabilityCheckedAt',
    'estimatedCostPerCallMicrounits',
    'revision',
    'structuredJson',
    'writingModelId',
  ]);
  if (!['STALE', 'SUPPORTED', 'UNKNOWN', 'UNSUPPORTED'].includes(String(value.structuredJson)))
    fail('provider.structuredJson');
  return Object.freeze({
    baseUrl: providerBaseUrl(value.baseUrl),
    budgetPerCallMicrounits: integer(value.budgetPerCallMicrounits, 'provider.budget', true),
    capabilityCheckedAt: iso(value.capabilityCheckedAt, 'provider.capabilityCheckedAt', true),
    estimatedCostPerCallMicrounits: integer(
      value.estimatedCostPerCallMicrounits,
      'provider.estimatedCost',
      true,
    ),
    revision: integer(value.revision, 'provider.revision') as number,
    structuredJson: value.structuredJson as WebProviderSettings['structuredJson'],
    writingModelId: text(value.writingModelId, 'provider.writingModelId', 200, true),
  });
}

export function emptyW2Slices(): WebW2Slices {
  return Object.freeze({
    clipReceipts: Object.freeze([]),
    interactions: Object.freeze([]),
    library: Object.freeze([]),
    metricSnapshots: Object.freeze([]),
    provider: Object.freeze({
      baseUrl: null,
      budgetPerCallMicrounits: null,
      capabilityCheckedAt: null,
      estimatedCostPerCallMicrounits: null,
      revision: 0,
      structuredJson: 'UNKNOWN',
      writingModelId: null,
    }),
    strategyDecisions: Object.freeze([]),
  });
}

export function parseW2Slices(
  value: Pick<
    Record<string, unknown>,
    | 'clipReceipts'
    | 'interactions'
    | 'library'
    | 'metricSnapshots'
    | 'provider'
    | 'strategyDecisions'
  >,
  packageStatuses: ReadonlyMap<string, string>,
): WebW2Slices {
  if (
    !Array.isArray(value.interactions) ||
    !Array.isArray(value.library) ||
    !Array.isArray(value.clipReceipts) ||
    !Array.isArray(value.metricSnapshots) ||
    !Array.isArray(value.strategyDecisions) ||
    value.interactions.length > 2_000 ||
    value.library.length > WEB_W2_LIMITS.libraryItems ||
    value.clipReceipts.length > 2_000 ||
    value.metricSnapshots.length > 10_000 ||
    value.strategyDecisions.length > 2_000
  )
    fail('collections');
  const packageIds = new Set(packageStatuses.keys());
  const approved = new Set(
    [...packageStatuses]
      .filter(([, status]) => status === 'APPROVED')
      .map(([packageId]) => packageId),
  );
  const interactions = value.interactions.map((item) => parseInteraction(item, packageIds));
  const library = value.library.map(parseLibraryItem);
  const receipts = value.clipReceipts.map(parseReceipt);
  const metrics = value.metricSnapshots.map((item) => parseMetric(item, approved));
  const decisions = value.strategyDecisions.map(parseDecision);
  for (const [items, field] of [
    [interactions.map((item) => item.itemId), 'interactions'],
    [library.map((item) => item.id), 'library'],
    [receipts.map((item) => item.clipIdentity), 'clipReceipts'],
    [decisions.map((item) => item.id), 'strategyDecisions'],
  ] as const) {
    if (new Set(items).size !== items.length) fail(field);
  }
  if (receipts.some((receipt) => !library.some((item) => item.id === receipt.itemId)))
    fail('clipReceipts.itemId');
  const metricKeys = metrics.map(
    (item) => `${item.packageId}:${item.snapshotWindow}:${item.revision}`,
  );
  if (new Set(metricKeys).size !== metricKeys.length) fail('metricSnapshots');
  return Object.freeze({
    clipReceipts: Object.freeze(receipts),
    interactions: Object.freeze(interactions),
    library: Object.freeze(library),
    metricSnapshots: Object.freeze(metrics),
    provider: parseProvider(value.provider),
    strategyDecisions: Object.freeze(decisions),
  });
}

export function parseCatalogImport(value: unknown): WebCatalogImport {
  if (!record(value)) fail('catalog');
  exact(value, ['format', 'items', 'version']);
  if (value.format !== 'rednote-web-catalog' || value.version !== 1 || !Array.isArray(value.items))
    fail('catalog');
  if (value.items.length < 1 || value.items.length > WEB_W2_LIMITS.catalogItems)
    fail('catalog.items');
  const items = value.items.map((item) => {
    if (!record(item)) fail('catalog.item');
    exact(item, ['author', 'id', 'sourcePath', 'summary', 'title']);
    const sourcePath = text(item.sourcePath, 'catalog.sourcePath', 512, true);
    if (
      sourcePath !== null &&
      (!/^materials\/[A-Za-z0-9._/-]{1,480}$/u.test(sourcePath) || sourcePath.includes('..'))
    )
      fail('catalog.sourcePath');
    return Object.freeze({
      author: text(item.author, 'catalog.author', 300, true),
      id: id(item.id, 'catalog.id'),
      sourcePath,
      summary: text(item.summary, 'catalog.summary', 8_000) as string,
      title: text(item.title, 'catalog.title', 512) as string,
    });
  });
  if (new Set(items.map((item) => item.id)).size !== items.length) fail('catalog.items');
  return Object.freeze({
    format: value.format,
    items: Object.freeze(items),
    version: value.version,
  });
}

export function parseClipImport(value: unknown): WebClipImport {
  if (!record(value)) fail('clip');
  exact(value, [
    'capturedAt',
    'clipIdentity',
    'format',
    'pageTitle',
    'screenshotDataUrl',
    'selectedText',
    'sourceUrl',
    'userNote',
    'version',
  ]);
  if (value.format !== 'rednote-web-clip' || value.version !== 1) fail('clip');
  const sourceUrl = httpsUrl(value.sourceUrl, 'clip.sourceUrl');
  const parsedUrl = new URL(sourceUrl);
  if (parsedUrl.search !== '' || parsedUrl.hash !== '') fail('clip.sourceUrl');
  const screenshot = text(
    value.screenshotDataUrl,
    'clip.screenshotDataUrl',
    WEB_W2_LIMITS.screenshotDataUrlCharacters,
    true,
  );
  if (screenshot !== null && !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/u.test(screenshot))
    fail('clip.screenshotDataUrl');
  return Object.freeze({
    capturedAt: iso(value.capturedAt, 'clip.capturedAt') as string,
    clipIdentity: sha(value.clipIdentity, 'clip.clipIdentity'),
    format: value.format,
    pageTitle: text(value.pageTitle, 'clip.pageTitle', 512) as string,
    screenshotDataUrl: screenshot,
    selectedText: text(value.selectedText, 'clip.selectedText', 12_000, true),
    sourceUrl: parsedUrl.toString(),
    userNote: text(value.userNote, 'clip.userNote', 4_000, true),
    version: value.version,
  });
}

export function metricsReview(
  snapshots: readonly WebMetricVersion[],
  titles: ReadonlyMap<string, string>,
  window: MetricWindow,
): MetricsReview {
  const latest = new Map<string, WebMetricVersion>();
  for (const snapshot of snapshots.filter((item) => item.snapshotWindow === window)) {
    const current = latest.get(snapshot.packageId);
    if (current === undefined || current.revision < snapshot.revision)
      latest.set(snapshot.packageId, snapshot);
  }
  return deterministicReview(
    [...latest.values()].map((item) => ({ ...item, expectedRevision: item.revision })),
    titles,
    window,
  );
}
