import { useEffect, useState } from 'react';

import type { FetchStateView } from '@mystery-operations/shared';

export function FetchPolicySettings(): React.JSX.Element {
  const [state, setState] = useState<FetchStateView | null>(null);
  const [message, setMessage] = useState('');
  const bridge = window.rednoteDesktop;

  useEffect(() => {
    let active = true;
    void bridge?.getFetchState?.().then((result) => {
      if (!active) return;
      if (result.ok) setState(result.value);
      else setMessage(result.error.message);
    });
    return () => {
      active = false;
    };
  }, [bridge]);

  const updateEnabled = async (enabled: boolean): Promise<void> => {
    if (state === null || bridge?.updateFetchPolicy === undefined) return;
    const result = await bridge.updateFetchPolicy({
      enabled,
      expectedRevision: state.profile.revision,
      globalMaxConcurrent: state.profile.globalMaxConcurrent,
      maxRequestsPerWindow: state.profile.maxRequestsPerWindow,
      minIntervalMs: state.profile.minIntervalMs,
      windowMs: state.profile.windowMs,
    });
    if (result.ok) {
      setState(result.value);
      setMessage('抓取策略已保存。执行仍只能由受信任的研究流程提交候选任务。');
    } else {
      setMessage(result.error.message);
    }
  };

  return (
    <section aria-labelledby="fetch-policy-title" className="diagnostic-card">
      <div>
        <p className="section-kicker">受控公开页面抓取</p>
        <h3 id="fetch-policy-title">Fetch V1 策略</h3>
        <p>
          {state === null
            ? '正在读取本地策略。'
            : state.ready
              ? '策略已启用，存储就绪；页面仍须来自已持久化的单个候选。'
              : '默认关闭。这里不提供任意网址输入、自动遍历或立即抓取按钮。'}
        </p>
      </div>
      {state === null ? null : (
        <>
          <dl className="settings-summary">
            <div>
              <dt>Profile / revision</dt>
              <dd>
                {state.profile.id} / {state.profile.revision}
              </dd>
            </div>
            <div>
              <dt>Robots / MIME</dt>
              <dd>
                {state.policy.robots} / {state.policy.mime}
              </dd>
            </div>
            <div>
              <dt>Redirect / body</dt>
              <dd>
                {state.policy.maxRedirects} 跳 / {state.policy.maxRawBytes} bytes raw
              </dd>
            </div>
            <div>
              <dt>限速</dt>
              <dd>
                全局 {state.profile.globalMaxConcurrent}；每 origin 1；最短间隔{' '}
                {state.profile.minIntervalMs}ms
              </dd>
            </div>
            <div>
              <dt>存储</dt>
              <dd>{state.storageReady ? 'ProjectDataRoot 已就绪' : '未就绪'}</dd>
            </div>
          </dl>
          <label className="check-row">
            <input
              checked={state.profile.enabled}
              onChange={(event) => void updateEnabled(event.currentTarget.checked)}
              type="checkbox"
            />
            启用严格 Fetch V1 策略
          </label>
        </>
      )}
      {message === '' ? null : <p aria-live="polite">{message}</p>}
    </section>
  );
}
