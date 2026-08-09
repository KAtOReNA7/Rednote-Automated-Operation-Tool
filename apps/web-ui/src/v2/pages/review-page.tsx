import { useEffect, useState } from 'react';

import { Button, PageHeader, useV2Controller } from '../components.js';

type MetricWindow = '24H' | '72H' | '7D';
type ContentPackage = V2ContentWorkspaceContract['packages'][number];
const WINDOWS: readonly MetricWindow[] = ['24H', '72H', '7D'];
const FIELDS = [
  'publishedAt',
  'views',
  'likes',
  'collections',
  'comments',
  'newFollowers',
] as const;

export function ReviewPage(): React.JSX.Element {
  const { notify } = useV2Controller();
  const [metricWindow, setMetricWindow] = useState<MetricWindow>('7D');
  const [review, setReview] = useState<V2MetricsReviewContract | null>(null);
  const [packages, setPackages] = useState<readonly ContentPackage[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
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
  const save = async (): Promise<void> => {
    const snapshots = packages.map((item) => ({
      packageId: item.id,
      snapshotWindow: metricWindow,
      expectedRevision:
        review?.details.find((detail) => detail.packageId === item.id)?.revision ?? 0,
      publishedAt: values[`${item.id}:publishedAt`] ?? '2026-01-01T00:00:00.000Z',
      views: Number(values[`${item.id}:views`] ?? 0),
      likes: Number(values[`${item.id}:likes`] ?? 0),
      collections: Number(values[`${item.id}:collections`] ?? 0),
      comments: Number(values[`${item.id}:comments`] ?? 0),
      newFollowers: Number(values[`${item.id}:newFollowers`] ?? 0),
    }));
    const result = await window.rednoteV2?.saveMetricSnapshots?.({ snapshots });
    if (result?.ok) setReview(result.value);
    else notify('指标未保存，请检查输入。');
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
    <div className="v2-page">
      <PageHeader
        title="数据复盘"
        eyebrow="本地录入"
        description="只汇总已审批内容的本地指标。"
        actions={
          <select
            aria-label="观察窗口"
            value={metricWindow}
            onChange={(event) => setMetricWindow(event.target.value as MetricWindow)}
          >
            {WINDOWS.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        }
      />
      <section className="v2-card v2-dashboard">
        <h2>录入指标</h2>
        {packages.length === 0 ? (
          <p>暂无已审批内容。</p>
        ) : (
          packages.map((item) => (
            <fieldset key={item.id}>
              <legend>{item.fields.title}</legend>
              {FIELDS.map((field) => (
                <label key={field}>
                  {field}
                  <input
                    aria-label={`${item.fields.title} ${field}`}
                    value={values[`${item.id}:${field}`] ?? ''}
                    onChange={(event) =>
                      setValues((old) => ({ ...old, [`${item.id}:${field}`]: event.target.value }))
                    }
                  />
                </label>
              ))}
            </fieldset>
          ))
        )}
        <Button onClick={() => void save()} tone="primary">
          保存本地指标
        </Button>
      </section>
      <section className="v2-card v2-side-card">
        <h2>真实汇总</h2>
        <p>
          浏览 {review?.totals.views ?? 0} · 点赞 {review?.totals.likes ?? 0} · 收藏{' '}
          {review?.totals.collections ?? 0}
        </p>
        <Button onClick={() => void load()} tone="quiet">
          刷新
        </Button>
      </section>
      <section className="v2-card v2-dashboard">
        <h2>策略建议</h2>
        {review?.recommendations.length ? (
          review.recommendations.map((item) => (
            <article className="v2-recommendation" key={item.id}>
              <div>
                <h3>{item.supportingTitle}</h3>
                <p>{item.text}</p>
                <span>{item.status}</span>
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
