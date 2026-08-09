export const METRIC_WINDOWS = ['24H', '72H', '7D'] as const;
export type MetricWindow = (typeof METRIC_WINDOWS)[number];
export type StrategyDecisionStatus = 'ACCEPTED' | 'PENDING' | 'REJECTED' | 'STALE';

export interface MetricSnapshot {
  readonly collections: number;
  readonly comments: number;
  readonly expectedRevision: number;
  readonly likes: number;
  readonly newFollowers: number;
  readonly packageId: string;
  readonly publishedAt: string;
  readonly revision: number;
  readonly snapshotWindow: MetricWindow;
  readonly views: number;
}

export interface MetricDetail extends MetricSnapshot {
  readonly collectionRateBasisPoints: number | null;
  readonly engagementRateBasisPoints: number | null;
  readonly followerConversionBasisPoints: number | null;
  readonly title: string;
}

export interface StrategyRecommendation {
  readonly fingerprint: string;
  readonly id: string;
  readonly kind: 'COLLECTION_RATE' | 'FOLLOWER_CONVERSION';
  readonly packageId: string;
  readonly status: StrategyDecisionStatus;
  readonly supportingTitle: string;
  readonly text: string;
}

export interface MetricsReview {
  readonly details: readonly MetricDetail[];
  readonly recommendations: readonly StrategyRecommendation[];
  readonly snapshotWindow: MetricWindow;
  readonly status: 'INSUFFICIENT_DATA' | 'READY';
  readonly totals: Readonly<
    Record<'collections' | 'comments' | 'likes' | 'newFollowers' | 'views', number>
  >;
}

export class V2MetricsError extends Error {
  public constructor(
    public readonly code: 'INVALID_REQUEST' | 'METRICS_CONFLICT' | 'PACKAGE_NOT_APPROVED',
    public readonly affectedFields: readonly string[] = [],
  ) {
    super(code);
    this.name = 'V2MetricsError';
  }
}

function safeCount(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new V2MetricsError('INVALID_REQUEST', [field]);
  return value;
}

function packageId(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,95}$/iu.test(value))
    throw new V2MetricsError('INVALID_REQUEST', ['packageId']);
  return value;
}

export function parseMetricSnapshot(value: unknown): MetricSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new V2MetricsError('INVALID_REQUEST');
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (
    keys !==
    'collections,comments,expectedRevision,likes,newFollowers,packageId,publishedAt,snapshotWindow,views'
  )
    throw new V2MetricsError('INVALID_REQUEST');
  if (
    typeof record.publishedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/u.test(record.publishedAt)
  )
    throw new V2MetricsError('INVALID_REQUEST', ['publishedAt']);
  if (!METRIC_WINDOWS.includes(record.snapshotWindow as MetricWindow))
    throw new V2MetricsError('INVALID_REQUEST', ['snapshotWindow']);
  return {
    collections: safeCount(record.collections, 'collections'),
    comments: safeCount(record.comments, 'comments'),
    expectedRevision: safeCount(record.expectedRevision, 'expectedRevision'),
    likes: safeCount(record.likes, 'likes'),
    newFollowers: safeCount(record.newFollowers, 'newFollowers'),
    packageId: packageId(record.packageId),
    publishedAt: record.publishedAt,
    revision: 0,
    snapshotWindow: record.snapshotWindow as MetricWindow,
    views: safeCount(record.views, 'views'),
  };
}

function rate(numerator: number, views: number): number | null {
  return views === 0 ? null : Math.floor((numerator * 10_000) / views);
}

export function deterministicReview(
  snapshots: readonly MetricSnapshot[],
  titles: ReadonlyMap<string, string>,
  window: MetricWindow,
): MetricsReview {
  const matching = snapshots.filter((snapshot) => snapshot.snapshotWindow === window);
  const details = matching
    .map((snapshot) => ({
      ...snapshot,
      title: titles.get(snapshot.packageId) ?? snapshot.packageId,
      collectionRateBasisPoints: rate(snapshot.collections, snapshot.views),
      engagementRateBasisPoints: rate(
        snapshot.likes + snapshot.collections + snapshot.comments,
        snapshot.views,
      ),
      followerConversionBasisPoints: rate(snapshot.newFollowers, snapshot.views),
    }))
    .sort(
      (left, right) =>
        left.title.localeCompare(right.title) || left.packageId.localeCompare(right.packageId),
    );
  const totals = details.reduce(
    (result, item) => ({
      views: result.views + item.views,
      likes: result.likes + item.likes,
      collections: result.collections + item.collections,
      comments: result.comments + item.comments,
      newFollowers: result.newFollowers + item.newFollowers,
    }),
    { views: 0, likes: 0, collections: 0, comments: 0, newFollowers: 0 },
  );
  if (details.length < 3 || details.some((item) => item.views < 100))
    return {
      details,
      recommendations: [],
      snapshotWindow: window,
      status: 'INSUFFICIENT_DATA',
      totals,
    };
  const best = (key: 'collectionRateBasisPoints' | 'followerConversionBasisPoints') =>
    [...details].sort(
      (a, b) =>
        (b[key] ?? -1) - (a[key] ?? -1) ||
        a.title.localeCompare(b.title) ||
        a.packageId.localeCompare(b.packageId),
    )[0];
  const collection = best('collectionRateBasisPoints');
  const follower = best('followerConversionBasisPoints');
  const candidates = [collection, follower]
    .filter((item): item is MetricDetail => item !== undefined)
    .filter(
      (item, index, all) => all.findIndex((other) => other.packageId === item.packageId) === index,
    );
  const recommendations = candidates.map((item) => ({
    id: `${window}-${item.packageId}`,
    packageId: item.packageId,
    kind: item === collection ? ('COLLECTION_RATE' as const) : ('FOLLOWER_CONVERSION' as const),
    status: 'PENDING' as const,
    supportingTitle: item.title,
    fingerprint: `${window}:${item.packageId}:${item.revision}:${item.views}`,
    text: `在当前样本中，《${item.title}》于 ${window} 窗口获得 ${item.views} 浏览；相关比率为 ${((item === collection ? item.collectionRateBasisPoints : item.followerConversionBasisPoints) ?? 0) / 100}%。`,
  }));
  return { details, recommendations, snapshotWindow: window, status: 'READY', totals };
}
