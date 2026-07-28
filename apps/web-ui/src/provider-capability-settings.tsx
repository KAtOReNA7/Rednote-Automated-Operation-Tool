import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';

import type {
  PreviewProviderCapabilityProbeInput,
  ProviderCapabilityProbePreview,
  ProviderCapabilityProbeProgressView,
  ProviderCapabilityStateView,
} from '@mystery-operations/shared';

const CAPABILITIES = [
  'text',
  'structuredJson',
  'toolCalling',
  'webSearch',
  'imageGeneration',
  'vision',
  'usage',
  'batch',
  'streaming',
] as const;

interface ProviderCapabilitySettingsProperties {
  readonly disabled: boolean;
  readonly revision: number;
}

function resultError(
  result: { readonly error: { readonly message: string }; readonly ok: false } | undefined,
): Error {
  return new Error(result?.error.message ?? '桌面能力探测接口不可用。');
}

export function ProviderCapabilitySettings({
  disabled,
  revision,
}: ProviderCapabilitySettingsProperties): ReactElement {
  const [state, setState] = useState<ProviderCapabilityStateView | null>(null);
  const [profile, setProfile] = useState<PreviewProviderCapabilityProbeInput['profile']>('CORE');
  const [selected, setSelected] = useState<readonly (typeof CAPABILITIES)[number][]>(['text']);
  const [includeToolCalling, setIncludeToolCalling] = useState(false);
  const [preview, setPreview] = useState<ProviderCapabilityProbePreview | null>(null);
  const [progress, setProgress] = useState<ProviderCapabilityProbeProgressView | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const result = await window.rednoteDesktop?.getProviderCapabilityState();
    if (result === undefined || !result.ok) {
      throw resultError(result);
    }
    setState(result.value);
    setProgress((current) => result.value.activeRun ?? current);
  }, []);

  useEffect(() => {
    if (disabled) {
      return;
    }
    void refresh().catch((error: unknown) => {
      setMessage(error instanceof Error ? error.message : '能力状态读取失败。');
    });
  }, [disabled, refresh, revision]);

  useEffect(() => {
    if (progress === null || progress.status !== 'RUNNING') {
      return;
    }
    const timer = window.setTimeout(() => {
      void window.rednoteDesktop
        ?.getProviderCapabilityProbeProgress({ runId: progress.runId })
        .then((result) => {
          if (!result.ok) {
            throw result.error;
          }
          setProgress(result.value);
          if (result.value.status !== 'RUNNING') {
            void refresh();
          }
        })
        .catch((error: unknown) => {
          setMessage(error instanceof Error ? error.message : '能力探测进度读取失败。');
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [progress, refresh]);

  const buildPreview = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    setConfirmed(false);
    try {
      const result = await window.rednoteDesktop?.previewProviderCapabilityProbe({
        includeToolCalling,
        profile,
        selectedCapabilities: profile === 'CUSTOM' ? selected : [],
      });
      if (result === undefined || !result.ok) {
        throw resultError(result);
      }
      setPreview(result.value);
      setMessage('探测计划已在主进程中按当前设置生成；尚未发送任何请求。');
    } catch (error) {
      setPreview(null);
      setMessage(error instanceof Error ? error.message : '能力探测预览失败。');
    } finally {
      setBusy(false);
    }
  };

  const start = async (): Promise<void> => {
    if (preview === null || !confirmed) {
      setMessage('请先预览计划并勾选费用风险确认。');
      return;
    }
    setBusy(true);
    try {
      const result = await window.rednoteDesktop?.startProviderCapabilityProbe({
        confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
        credentialBindingVersion: preview.credentialBindingVersion,
        planHash: preview.planHash,
        settingsRevision: preview.settingsRevision,
        startToken: preview.startToken,
      });
      if (result === undefined || !result.ok) {
        throw resultError(result);
      }
      setProgress(result.value);
      setPreview(null);
      setConfirmed(false);
      setMessage('能力探测已开始；请求严格串行且不会自动重试。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '能力探测启动失败。');
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    if (progress === null) {
      return;
    }
    const result = await window.rednoteDesktop?.cancelProviderCapabilityProbe({
      confirmation: 'CANCEL_PROVIDER_CAPABILITY_PROBE',
      runId: progress.runId,
    });
    if (result === undefined || !result.ok) {
      setMessage(resultError(result).message);
      return;
    }
    setProgress(result.value);
    setMessage('取消请求已提交；当前请求终止后不会发送剩余步骤。');
  };

  return (
    <section className="capability-card" aria-labelledby="capability-probe-title">
      <div>
        <p className="section-kicker">供应商能力</p>
        <h3 id="capability-probe-title">显式预览、确认后探测</h3>
        <p>
          当前状态：<strong>{state?.derivedState ?? 'NOT_PROBED'}</strong>。探测可能由第三方计费，
          本应用无法预估金额；最多 32 个请求，不自动重试。
        </p>
      </div>

      <fieldset disabled={disabled || busy || progress?.status === 'RUNNING'}>
        <legend>探测范围</legend>
        <label className="field">
          <span>Profile</span>
          <select
            onChange={(event) => {
              setProfile(
                event.currentTarget.value as PreviewProviderCapabilityProbeInput['profile'],
              );
              setPreview(null);
              setConfirmed(false);
            }}
            value={profile}
          >
            <option value="CORE">CORE</option>
            <option value="FULL">FULL</option>
            <option value="CUSTOM">CUSTOM</option>
          </select>
        </label>
        {profile === 'CORE' ? (
          <label className="check-row">
            <input
              checked={includeToolCalling}
              onChange={(event) => {
                setIncludeToolCalling(event.currentTarget.checked);
                setPreview(null);
              }}
              type="checkbox"
            />
            CORE 额外探测 tool calling
          </label>
        ) : null}
        {profile === 'CUSTOM' ? (
          <div className="capability-options">
            {CAPABILITIES.map((capability) => (
              <label className="check-row" key={capability}>
                <input
                  checked={selected.includes(capability)}
                  onChange={(event) => {
                    setSelected((current) =>
                      event.currentTarget.checked
                        ? [...new Set([...current, capability])]
                        : current.filter((item) => item !== capability),
                    );
                    setPreview(null);
                  }}
                  type="checkbox"
                />
                {capability}
              </label>
            ))}
          </div>
        ) : null}
        <div className="button-row">
          <button
            className="button"
            disabled={profile === 'CUSTOM' && selected.length === 0}
            onClick={() => void buildPreview()}
            type="button"
          >
            预览探测计划
          </button>
        </div>
      </fieldset>

      {preview === null ? null : (
        <div className="probe-preview">
          <p>
            {preview.profile} 将发送 <strong>{preview.requestCount}</strong> 个外部请求；费用估算：
            {preview.feeEstimate}。计划在 {preview.expiresAt} 前有效。
          </p>
          <label className="check-row">
            <input
              checked={confirmed}
              onChange={(event) => setConfirmed(event.currentTarget.checked)}
              type="checkbox"
            />
            我确认主动执行这些请求，并知晓第三方费用金额未知
          </label>
          <button
            className="button button--primary"
            disabled={!confirmed || busy}
            onClick={() => void start()}
            type="button"
          >
            开始能力探测
          </button>
        </div>
      )}

      {progress === null ? null : (
        <div aria-live="polite" className="probe-progress">
          <p>
            {progress.status} · 已发送 {progress.sentRequestCount}/{progress.plannedRequestCount} ·
            已完成 {progress.completedRequestCount}
          </p>
          <progress max={progress.plannedRequestCount} value={progress.completedRequestCount} />
          {progress.status === 'RUNNING' ? (
            <button className="button button--danger" onClick={() => void cancel()} type="button">
              取消探测
            </button>
          ) : null}
        </div>
      )}

      {message === null ? null : (
        <p aria-live="polite" className="capability-message">
          {message}
        </p>
      )}

      {state === null || state.entries.length === 0 ? (
        <p className="capability-note">尚无当前、完整且非 stale 的能力矩阵。</p>
      ) : (
        <div className="capability-table-wrap">
          <table className="capability-table">
            <caption>当前能力矩阵</caption>
            <thead>
              <tr>
                <th scope="col">槽位</th>
                <th scope="col">模型 ID</th>
                <th scope="col">协议</th>
                <th scope="col">能力</th>
                <th scope="col">状态</th>
                <th scope="col">证据</th>
                <th scope="col">观测时间</th>
              </tr>
            </thead>
            <tbody>
              {state.entries.map((entry) => (
                <tr key={`${entry.modelSlot}-${entry.protocolMode}-${entry.capability}`}>
                  <th scope="row">{entry.modelSlot}</th>
                  <td>{entry.modelId ?? '—'}</td>
                  <td>{entry.protocolMode}</td>
                  <td>{entry.capability}</td>
                  <td>{entry.stale ? 'STALE' : entry.state}</td>
                  <td>{entry.reasonCode}</td>
                  <td>{entry.observedAt ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state === null || state.history.length === 0 ? null : (
        <details>
          <summary>探测历史（{state.history.length}）</summary>
          <ul className="probe-history">
            {state.history.map((run) => (
              <li key={run.runId}>
                {run.status} · {run.profile} · {run.sentRequestCount}/{run.plannedRequestCount} ·
                {run.completedAt ?? run.startedAt}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
