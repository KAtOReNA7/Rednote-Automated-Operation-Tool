import { useEffect, useMemo, useState } from 'react';

import type { ModelAccountingView, ModelCacheClearPreview } from '@mystery-operations/shared';
import { SearchRunPanel } from './search-run-panel.js';

function usd(microUsd: string): string {
  const value = BigInt(microUsd);
  const whole = value / 1_000_000n;
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/u, '');
  return `$${whole.toString()}${fraction.length === 0 ? '' : `.${fraction}`}`;
}

function displayCost(value: string | null, state: string): string {
  if (value === null) {
    return state === 'NOT_INCURRED' ? '未产生费用' : '未知（不按 $0 处理）';
  }
  return usd(value);
}

export function ModelAccountingCenter(): React.JSX.Element {
  const [accounting, setAccounting] = useState<ModelAccountingView | null>(null);
  const [settingsRevision, setSettingsRevision] = useState<number | null>(null);
  const [message, setMessage] = useState('正在读取本地执行账本…');
  const [clearPreview, setClearPreview] = useState<ModelCacheClearPreview | null>(null);
  const [priceModel, setPriceModel] = useState('');
  const [priceInput, setPriceInput] = useState('');
  const [priceOutput, setPriceOutput] = useState('');
  const [weeklyCalls, setWeeklyCalls] = useState('100');
  const [monthlyCalls, setMonthlyCalls] = useState('400');

  const refresh = async (): Promise<void> => {
    const bridge = window.rednoteDesktop;
    if (bridge === undefined) {
      setMessage('桌面桥不可用。');
      return;
    }
    const [view, settings] = await Promise.all([bridge.getModelAccounting(), bridge.getSettings()]);
    if (!view.ok || !settings.ok) {
      setMessage(!view.ok ? view.error.message : !settings.ok ? settings.error.message : '');
      return;
    }
    setAccounting(view.value);
    setSettingsRevision(settings.value.settings.revision);
    setMessage('');
  };

  useEffect(() => {
    void refresh();
  }, []);

  const hitRate = useMemo(() => {
    if (accounting === null || accounting.recentRuns.length === 0) return '—';
    return `${((accounting.cacheHitCount / accounting.recentRuns.length) * 100).toFixed(1)}%`;
  }, [accounting]);

  const previewClear = async (): Promise<void> => {
    const result = await window.rednoteDesktop?.previewModelCacheClear();
    if (result === undefined || !result.ok) {
      setMessage(result?.error.message ?? '桌面桥不可用。');
      return;
    }
    setClearPreview(result.value);
    setMessage('请核对条目数和字节数后再次确认。');
  };

  const confirmClear = async (): Promise<void> => {
    if (clearPreview === null) return;
    const result = await window.rednoteDesktop?.confirmModelCacheClear({
      confirmation: 'CLEAR_MODEL_RESULT_CACHE',
      expectedBytes: clearPreview.bytes,
      expectedCount: clearPreview.count,
      previewToken: clearPreview.previewToken,
    });
    setClearPreview(null);
    if (result === undefined || !result.ok) {
      setMessage(result?.error.message ?? '桌面桥不可用。');
      return;
    }
    setMessage(
      `已将 ${result.value.tombstonedEntries} 个条目移出缓存，删除 ${result.value.deletedFiles} 个文件。`,
    );
    await refresh();
  };

  const savePrice = async (): Promise<void> => {
    if (settingsRevision === null) return;
    const result = await window.rednoteDesktop?.createModelPriceSchedule({
      cachedInputPerMillionUsd: null,
      cacheWritePerMillionUsd: null,
      callUsd: null,
      expectedSettingsRevision: settingsRevision,
      imageGenerationCallUsd: null,
      imageUsd: null,
      inputPerMillionUsd: priceInput || null,
      inputTokensIncludeCachedInput: false,
      modelId: priceModel,
      operationKind: 'TEXT_GENERATION',
      outputPerMillionUsd: priceOutput || null,
      protocolMode: null,
      searchCallUsd: null,
      toolUnitUsd: null,
      usageSemanticsVersion: 'usage-v1',
    });
    if (result === undefined || !result.ok) {
      setMessage(result?.error.message ?? '桌面桥不可用。');
      return;
    }
    setMessage(`已创建价格表版本 v${result.value.version}。`);
    await refresh();
  };

  const savePolicy = async (): Promise<void> => {
    if (settingsRevision === null) return;
    const result = await window.rednoteDesktop?.createModelUnitPolicy({
      expectedSettingsRevision: settingsRevision,
      maxExternalCallsMonthly: Number(monthlyCalls),
      maxExternalCallsWeekly: Number(weeklyCalls),
      maxImageGenerationCalls: null,
      maxImages: null,
      maxInputTokens: null,
      maxOutputTokens: null,
      maxToolCalls: null,
      maxWebSearchCalls: null,
      scopeKind: 'GLOBAL',
      scopeValue: null,
    });
    if (result === undefined || !result.ok) {
      setMessage(result?.error.message ?? '桌面桥不可用。');
      return;
    }
    setMessage(`已创建全局单位政策版本 v${result.value.version}。`);
    await refresh();
  };

  if (accounting === null) {
    return <div className="state-card">{message}</div>;
  }

  return (
    <div className="accounting-layout">
      <section className="accounting-intro">
        <div>
          <p className="section-kicker">Model execution · local only</p>
          <h2>成本与模型任务</h2>
          <p>按 UTC 月统计；未知金额保持未知，不会显示为 $0。</p>
        </div>
        <span className={accounting.hardStop ? 'budget-state budget-state--hard' : 'budget-state'}>
          {accounting.hardStop ? '硬停止' : accounting.warning ? '预算预警' : '预算正常'}
        </span>
      </section>

      {message.length > 0 && <p className="settings-message">{message}</p>}

      <SearchRunPanel />

      <section className="accounting-metrics" aria-label="成本摘要">
        <article>
          <span>计费月</span>
          <strong>{accounting.billingMonth} UTC</strong>
        </article>
        <article>
          <span>供应商报告</span>
          <strong>{usd(accounting.providerReportedMicroUsd)}</strong>
        </article>
        <article>
          <span>本地估算</span>
          <strong>{usd(accounting.estimatedKnownMicroUsd)}</strong>
        </article>
        <article>
          <span>未知费用调用</span>
          <strong>{accounting.unknownCostCallCount}</strong>
        </article>
        <article>
          <span>预留 / 不确定预留</span>
          <strong>
            {usd(accounting.outstandingReservationMicroUsd)} /{' '}
            {usd(accounting.uncertainReservationMicroUsd)}
          </strong>
        </article>
        <article>
          <span>预警 / 硬上限</span>
          <strong>
            {usd(accounting.warningLimitMicroUsd)} / {usd(accounting.hardLimitMicroUsd)}
          </strong>
        </article>
        <article>
          <span>本地缓存命中</span>
          <strong>
            {accounting.cacheHitCount} · {hitRate}
          </strong>
          <small>命中时未发起外部请求</small>
        </article>
        <article>
          <span>缓存容量</span>
          <strong>
            {accounting.cacheEntries} · {accounting.cacheBytes} B
          </strong>
          <small>供应商缓存输入不计入本地命中率</small>
        </article>
      </section>

      <section className="accounting-card">
        <div className="accounting-card-heading">
          <div>
            <h3>最近模型运行</h3>
            <p>只显示安全摘要，不包含 prompt、响应、凭据或缓存 payload。</p>
          </div>
        </div>
        <div className="capability-table-wrap">
          <table className="capability-table">
            <thead>
              <tr>
                <th>执行</th>
                <th>任务 / 模型</th>
                <th>状态</th>
                <th>本地缓存</th>
                <th>外部请求</th>
                <th>成本</th>
              </tr>
            </thead>
            <tbody>
              {accounting.recentRuns.map((run) => (
                <tr key={run.executionId}>
                  <td>
                    <code>{run.executionId}</code>
                  </td>
                  <td>
                    {run.taskKind}
                    <br />
                    <small>{run.modelId}</small>
                  </td>
                  <td>{run.status}</td>
                  <td>{run.localCacheHit ? '命中' : '未命中'}</td>
                  <td>{run.externalRequestCount}</td>
                  <td>
                    {displayCost(run.costAmountMicroUsd, run.costState)}
                    <br />
                    <small>{run.costState}</small>
                  </td>
                </tr>
              ))}
              {accounting.recentRuns.length === 0 && (
                <tr>
                  <td colSpan={6}>暂无模型运行。</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="accounting-card">
        <h3>版本化价格表</h3>
        <div className="form-grid">
          <label className="field">
            模型 ID
            <input value={priceModel} onChange={(event) => setPriceModel(event.target.value)} />
          </label>
          <label className="field">
            输入 / 百万 token（USD 十进制字符串）
            <input
              inputMode="decimal"
              value={priceInput}
              onChange={(event) => setPriceInput(event.target.value)}
            />
          </label>
          <label className="field">
            输出 / 百万 token（USD 十进制字符串）
            <input
              inputMode="decimal"
              value={priceOutput}
              onChange={(event) => setPriceOutput(event.target.value)}
            />
          </label>
        </div>
        <div className="button-row">
          <button
            className="button button--primary"
            disabled={!priceModel || (!priceInput && !priceOutput)}
            onClick={() => void savePrice()}
            type="button"
          >
            创建新版本
          </button>
        </div>
        <ul className="accounting-list">
          {accounting.priceSchedules.map((price) => (
            <li key={price.id}>
              {price.modelId} · {price.operationKind} · v{price.version} · {price.status}
            </li>
          ))}
        </ul>
      </section>

      <section className="accounting-card">
        <h3>未定价调用单位政策</h3>
        <div className="form-grid">
          <label className="field">
            每周外部调用上限
            <input
              inputMode="numeric"
              value={weeklyCalls}
              onChange={(event) => setWeeklyCalls(event.target.value)}
            />
          </label>
          <label className="field">
            每月外部调用上限
            <input
              inputMode="numeric"
              value={monthlyCalls}
              onChange={(event) => setMonthlyCalls(event.target.value)}
            />
          </label>
        </div>
        <div className="button-row">
          <button
            className="button button--primary"
            onClick={() => void savePolicy()}
            type="button"
          >
            创建全局政策版本
          </button>
        </div>
        <ul className="accounting-list">
          {accounting.unitPolicies.map((policy) => (
            <li key={policy.id}>
              {policy.scopeKind}
              {policy.scopeValue === null ? '' : ` · ${policy.scopeValue}`} · 周{' '}
              {policy.maxExternalCallsWeekly} / 月 {policy.maxExternalCallsMonthly} · v
              {policy.version}
            </li>
          ))}
        </ul>
      </section>

      <section className="accounting-card danger-zone">
        <div>
          <h3>清理本地结果缓存</h3>
          <p>只清理受控缓存，不改变运行记录、成本账本、价格表或预算政策。</p>
        </div>
        {clearPreview === null ? (
          <button
            className="button button--danger"
            onClick={() => void previewClear()}
            type="button"
          >
            预览清理
          </button>
        ) : (
          <div>
            <p>
              将清理 {clearPreview.count} 个条目、{clearPreview.bytes} 字节；类型：
              {clearPreview.outputTypes.join('、') || '无'}。
            </p>
            <div className="button-row">
              <button
                className="button button--danger"
                onClick={() => void confirmClear()}
                type="button"
              >
                再次确认清理
              </button>
              <button className="button" onClick={() => setClearPreview(null)} type="button">
                取消
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
