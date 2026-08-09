import { useEffect, useState } from 'react';

import type { MetricsReview, MetricWindow } from '@mystery-operations/v2';

import { Button, PageHeader, useV2Controller } from '../components.js';

const windows: readonly MetricWindow[] = ['24H', '72H', '7D'];

export function ReviewPage(): React.JSX.Element {
  const { notify } = useV2Controller();
  const [metricWindow, setMetricWindow] = useState<MetricWindow>('7D');
  const [review, setReview] = useState<MetricsReview | null>(null);
  const load = async (): Promise<void> => {
    const result = await window.rednoteV2?.readMetricsReview?.({ snapshotWindow: metricWindow });
    if (result?.ok) setReview(result.value);
    else notify('尚无可用本地指标，请先录入已审批内容的数据。');
  };
  useEffect(() => {
    void load();
  }, [metricWindow]);
  const decide = async (id: string, status: 'ACCEPTED' | 'REJECTED'): Promise<void> => {
    const result = await window.rednoteV2?.decideStrategyRecommendation?.({
      expectedRevision: 0,
      id,
      status,
    });
    if (result?.ok) setReview(result.value);
    else notify('策略决定未保存，请刷新后重试。');
  };
  return (
    <div className="v2-page">
      <PageHeader
        eyebrow="本地录入 · 无真实平台调用"
        title="数据复盘"
        description="按同一观察窗口汇总已审批内容的本地指标；没有可比期间时不会伪造变化。"
        actions={
          <label>
            观察窗口{' '}
            <select
              aria-label="观察窗口"
              value={metricWindow}
              onChange={(event) => setMetricWindow(event.target.value as MetricWindow)}
            >
              {windows.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        }
      />
      <section className="v2-card v2-side-card">
        <h2>本地指标</h2>
        <dl className="v2-facts">
          <div>
            <dt>浏览</dt>
            <dd>{review?.totals.views ?? 0}</dd>
          </div>
          <div>
            <dt>点赞</dt>
            <dd>{review?.totals.likes ?? 0}</dd>
          </div>
          <div>
            <dt>收藏</dt>
            <dd>{review?.totals.collections ?? 0}</dd>
          </div>
        </dl>
        <Button onClick={() => void load()} tone="quiet">
          刷新本地复盘
        </Button>
      </section>
      <section className="v2-card v2-dashboard">
        <p className="v2-kicker">
          {review?.status === 'READY' ? '满足样本门槛' : '样本不足：至少 3 条且每条浏览不少于 100'}
        </p>
        <h2>当前策略建议</h2>
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
          <p>尚无策略建议。录入足够的同窗口指标后会显示确定性建议。</p>
        )}
      </section>
    </div>
  );
}
