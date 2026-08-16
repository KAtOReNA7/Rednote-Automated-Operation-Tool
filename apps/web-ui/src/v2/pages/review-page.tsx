import { useEffect, useState } from 'react';

import { Button, PageHeader, useV2Controller } from '../components.js';

type MetricWindow = '24H' | '72H' | '7D';
type ContentPackage = V2ContentWorkspaceContract['packages'][number];
type MetricField = 'views' | 'likes' | 'collections' | 'comments' | 'newFollowers';

const WINDOWS: Readonly<Record<MetricWindow, string>> = {
  '24H': '发布后 24 小时',
  '72H': '发布后 72 小时',
  '7D': '发布后 7 天',
};
const FIELDS: readonly { readonly key: MetricField; readonly label: string }[] = [
  { key: 'views', label: '浏览量' },
  { key: 'likes', label: '点赞数' },
  { key: 'collections', label: '收藏数' },
  { key: 'comments', label: '评论数' },
  { key: 'newFollowers', label: '新增关注' },
];
const STATUS: Readonly<Record<'ACCEPTED' | 'PENDING' | 'REJECTED', string>> = {
  ACCEPTED: '已采纳',
  PENDING: '待处理',
  REJECTED: '已拒绝',
};
const localDateTime = (value: string | undefined): string =>
  value?.replace('.000Z', '').slice(0, 16) ?? '';

export function ReviewPage(): React.JSX.Element {
  const { notify } = useV2Controller();
  const [metricWindow, setMetricWindow] = useState<MetricWindow>('7D');
  const [review, setReview] = useState<V2MetricsReviewContract | null>(null);
  const [packages, setPackages] = useState<readonly ContentPackage[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const load = async (): Promise<void> => {
    const [metrics, content] = await Promise.all([
      window.rednoteV2?.readMetricsReview?.({ snapshotWindow: metricWindow }),
      window.rednoteV2?.readContentPackages?.({ weekKey: '2026-W31' }),
    ]);
    if (metrics?.ok) setReview(metrics.value);
    if (content?.ok)
      setPackages(content.value.packages.filter((item) => item.status === 'APPROVED'));
  };
  useEffect(() => {
    void load();
  }, [metricWindow]);
  const fieldValue = (id: string, field: string): string =>
    values[`${id}:${field}`] ??
    (
      review?.details.find((item) => item.packageId === id)?.[
        field as keyof V2MetricsReviewContract['details'][number]
      ] as string | number | undefined
    )?.toString() ??
    '';
  const change = (id: string, field: string, value: string): void =>
    setValues((old) => ({ ...old, [`${id}:${field}`]: value }));
  const save = async (): Promise<void> => {
    if (packages.length === 0) return;
    const snapshots = packages.map((item) => {
      const publishedAt = fieldValue(item.id, 'publishedAt');
      return {
        packageId: item.id,
        snapshotWindow: metricWindow,
        expectedRevision:
          review?.details.find((detail) => detail.packageId === item.id)?.revision ?? 0,
        publishedAt: publishedAt ? `${publishedAt}:00.000Z` : '',
        views: Number(fieldValue(item.id, 'views')),
        likes: Number(fieldValue(item.id, 'likes')),
        collections: Number(fieldValue(item.id, 'collections')),
        comments: Number(fieldValue(item.id, 'comments')),
        newFollowers: Number(fieldValue(item.id, 'newFollowers')),
      };
    });
    if (
      snapshots.some(
        (item) =>
          item.publishedAt === '' ||
          Object.values(item).some(
            (value) => typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0),
          ),
      )
    ) {
      setError('请填写发布时间，并使用不小于 0 的整数。');
      return;
    }
    const result = await window.rednoteV2?.saveMetricSnapshots?.({ snapshots });
    if (result?.ok) {
      setReview(result.value);
      setError('');
      notify(`已保存 ${snapshots.length} 条“${WINDOWS[metricWindow]}”数据。`);
    } else setError('保存失败，请检查输入后重试。');
  };
  const decide = async (id: string, status: 'ACCEPTED' | 'REJECTED'): Promise<void> => {
    const result = await window.rednoteV2?.decideStrategyRecommendation?.({
      expectedRevision: 0,
      id,
      status,
    });
    if (result?.ok) setReview(result.value);
  };
  return (
    <div className="v2-page v2-review-page">
      <PageHeader
        title="数据复盘"
        eyebrow="本地数据"
        description="录入已审批内容的发布数据，形成真实汇总和下周策略建议。"
        actions={
          <label className="v2-field">
            <span>观察窗口</span>
            <select
              aria-label="观察窗口"
              value={metricWindow}
              onChange={(event) => setMetricWindow(event.target.value as MetricWindow)}
            >
              {(Object.keys(WINDOWS) as MetricWindow[]).map((key) => (
                <option key={key} value={key}>
                  {WINDOWS[key]}
                </option>
              ))}
            </select>
          </label>
        }
      />
      <section className="v2-metric-intake">
        <h2>指标录入</h2>
        {packages.length === 0 ? (
          <p>暂无已审批内容。</p>
        ) : (
          packages.map((item) => (
            <article className="v2-card v2-metric-package" key={item.id}>
              <header>
                <h3>{item.fields.title}</h3>
                <small>{item.fields.suggestedTime}</small>
              </header>
              <div className="v2-metric-fields">
                <label className="v2-field">
                  <span>发布时间</span>
                  <input
                    aria-label={`${item.fields.title} 发布时间`}
                    type="datetime-local"
                    value={localDateTime(fieldValue(item.id, 'publishedAt'))}
                    onChange={(event) => change(item.id, 'publishedAt', event.target.value)}
                  />
                  <small>请选择实际发布时间</small>
                </label>
                {FIELDS.map(({ key, label }) => (
                  <label className="v2-field" key={key}>
                    <span>{label}</span>
                    <input
                      aria-label={`${item.fields.title} ${label}`}
                      type="number"
                      min="0"
                      step="1"
                      placeholder="0"
                      value={fieldValue(item.id, key)}
                      onChange={(event) => change(item.id, key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </article>
          ))
        )}
      </section>
      <section className="v2-metric-save">
        <p role="alert">{error}</p>
        <Button onClick={() => void save()} tone="primary">
          保存本页指标
        </Button>
      </section>
      <section className="v2-card v2-side-card">
        <h2>真实汇总</h2>
        {review === null || review.details.length === 0 ? (
          <p>尚未录入当前观察窗口的数据。</p>
        ) : (
          <div className="v2-metrics">
            {[
              { label: '浏览量', value: review.totals.views },
              { label: '点赞数', value: review.totals.likes },
              { label: '收藏数', value: review.totals.collections },
              { label: '评论数', value: review.totals.comments },
              { label: '新增关注', value: review.totals.newFollowers },
            ].map((item) => (
              <div key={item.label}>
                <span>{item.label}</span>
                <strong>{item.value}</strong>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="v2-card v2-dashboard">
        <h2>策略建议</h2>
        {review?.recommendations.length ? (
          review.recommendations.map((item) => (
            <article className="v2-recommendation" key={item.id}>
              <div>
                <h3>{item.supportingTitle}</h3>
                <p>{item.text}</p>
                <span>{STATUS[item.status as keyof typeof STATUS] ?? '已失效'}</span>
              </div>
              {item.status === 'PENDING' ? (
                <div>
                  <Button onClick={() => void decide(item.id, 'ACCEPTED')} tone="quiet">
                    采纳
                  </Button>
                  <Button onClick={() => void decide(item.id, 'REJECTED')} tone="quiet">
                    拒绝
                  </Button>
                </div>
              ) : null}
            </article>
          ))
        ) : (
          <p>
            {review?.status === 'INSUFFICIENT_DATA'
              ? '样本不足，暂不生成建议。'
              : '数据积累后再形成建议。'}
          </p>
        )}
      </section>
    </div>
  );
}
