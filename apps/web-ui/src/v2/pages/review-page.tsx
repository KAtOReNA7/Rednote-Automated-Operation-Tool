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
  const metricLabel = FIELDS.find(({ key }) => key === 'views')?.label ?? '浏览量';
  const chartRows = review?.details ?? [];
  const trendValues = chartRows.map((item) => item.views);
  const maxValue = Math.max(1, ...trendValues);
  return (
    <div className="v2-page v2-review-page">
      <PageHeader
        title="数据复盘"
        eyebrow="真实表现"
        description="先看结果，再决定下周策略。所有数字都来自你录入的真实发布数据。"
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
      <section className="v2-workspace-intro v2-review-intro" aria-label="数据复盘说明">
        <div>
          <p className="v2-kicker">观察窗口 · 真实本地数据</p>
          <h2>先看结果，再决定下周策略</h2>
        </div>
        <p>未知数据保持为空，不会以 0 替代。录入已审批内容的表现后，才会形成可追溯的汇总与建议。</p>
      </section>
      <section aria-label="本地指标图表" className="v2-review-analytics v2-review-dashboard">
        <article className="v2-card v2-review-kpis">
          <div>
            <p className="v2-kicker">
              {WINDOWS[metricWindow]} · 有效样本 {chartRows.length}
            </p>
            <h2>真实 KPI 摘要</h2>
          </div>
          {review === null || chartRows.length === 0 ? (
            <p>尚未录入当前观察窗口的数据。</p>
          ) : (
            <div className="v2-metrics">
              {[
                ['浏览量', review.totals.views],
                ['点赞数', review.totals.likes],
                ['收藏数', review.totals.collections],
                ['评论数', review.totals.comments],
                ['新增关注', review.totals.newFollowers],
              ].map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          )}
        </article>
        <article className="v2-card v2-chart-card">
          <header>
            <div>
              <p className="v2-kicker">观察窗口：{WINDOWS[metricWindow]}</p>
              <h2>表现趋势</h2>
            </div>
            <span className="v2-status v2-status--neutral">{metricLabel}</span>
          </header>
          {chartRows.length === 0 ? (
            <div className="v2-chart-empty">
              <svg aria-label="暂无浏览量趋势数据" role="img" viewBox="0 0 520 150">
                <title>暂无浏览量趋势数据</title>
                <path
                  d="M32 124H504M32 22V124"
                  fill="none"
                  stroke="currentColor"
                  strokeOpacity=".18"
                />
                <path
                  d="M70 102L170 82L270 96L370 62L470 80"
                  fill="none"
                  stroke="currentColor"
                  strokeDasharray="5 8"
                  strokeOpacity=".22"
                  strokeWidth="3"
                />
              </svg>
              <p>尚无可绘制的数据；图表不会以 0 代替未知。</p>
            </div>
          ) : (
            <svg
              aria-label="浏览量趋势图"
              className="v2-trend-chart"
              role="img"
              viewBox="0 0 520 150"
            >
              <title>浏览量趋势（按已保存内容）</title>
              <path
                d="M32 124H504M32 22V124"
                fill="none"
                stroke="currentColor"
                strokeOpacity=".18"
              />
              {trendValues.map((value, index) => {
                const x = 70 + index * (380 / Math.max(1, trendValues.length - 1));
                const y = 112 - (value / maxValue) * 72;
                return (
                  <g key={chartRows[index]?.packageId}>
                    <circle cx={x} cy={y} fill="currentColor" r="5" />
                    <text x={x} y="142" textAnchor="middle">
                      {index + 1}
                    </text>
                  </g>
                );
              })}
              {trendValues.length > 1 ? (
                <polyline
                  fill="none"
                  points={trendValues
                    .map(
                      (value, index) =>
                        `${70 + index * (380 / (trendValues.length - 1))},${112 - (value / maxValue) * 72}`,
                    )
                    .join(' ')}
                  stroke="currentColor"
                  strokeWidth="3"
                />
              ) : null}
            </svg>
          )}
          <p className="v2-chart-legend">
            指标：浏览量；横轴为本窗口内已保存内容，数值可在下方录入区核对。
          </p>
        </article>
        <article className="v2-card v2-chart-card">
          <header>
            <div>
              <p className="v2-kicker">当前观察窗口</p>
              <h2>内容表现对比</h2>
            </div>
            <span className="v2-status v2-status--neutral">浏览量</span>
          </header>
          {chartRows.length === 0 ? (
            <div className="v2-chart-empty">
              <div className="v2-empty-bars" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <p>暂无已保存内容指标。</p>
            </div>
          ) : (
            <div className="v2-bar-chart">
              {chartRows.map((item) => (
                <div key={item.packageId}>
                  <span>{item.title}</span>
                  <i
                    aria-label={`${item.title} 浏览量 ${item.views}`}
                    style={{ width: `${Math.max(4, (item.views / maxValue) * 100)}%` }}
                  />
                  <b>{item.views}</b>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
      <section className="v2-metric-intake v2-review-intake">
        <header>
          <div>
            <p className="v2-kicker">本地录入</p>
            <h2>指标录入</h2>
          </div>
          <p>每条数据均保存到当前观察窗口，并可在重启后恢复。</p>
        </header>
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
      <section className="v2-card v2-side-card v2-review-summary">
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
      <section className="v2-card v2-dashboard v2-review-strategy">
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
