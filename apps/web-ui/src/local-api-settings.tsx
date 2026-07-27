import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  LocalApiClientView,
  LocalApiStatusView,
  PairingView,
} from '@mystery-operations/shared';

type LoadState =
  | { readonly phase: 'loading' }
  | { readonly message: string; readonly phase: 'error' }
  | {
      readonly clients: readonly LocalApiClientView[];
      readonly phase: 'ready';
      readonly status: LocalApiStatusView;
    };

function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return '本地插件连接操作失败，请刷新后重试。';
}

function parsePort(value: string): number | null {
  if (!/^[0-9]{4,5}$/u.test(value)) {
    return null;
  }
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1_024 && port <= 65_535 ? port : null;
}

function stateLabel(status: LocalApiStatusView): string {
  const labels: Readonly<Record<LocalApiStatusView['state'], string>> = {
    DISABLED: '已停用',
    DISABLED_NO_PROJECT: '尚无本地项目',
    ERROR: '启动错误',
    ERROR_RESTART_REQUIRED: '需要重启应用',
    PORT_IN_USE: '端口已被占用',
    RUNNING: '正在运行',
    STARTING: '正在启动',
    STOPPING: '正在停止',
  };
  return labels[status.state];
}

export function LocalApiSettings(): React.JSX.Element {
  const [loadState, setLoadState] = useState<LoadState>({ phase: 'loading' });
  const [portInput, setPortInput] = useState('43119');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pairing, setPairing] = useState<PairingView | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [confirmedClientId, setConfirmedClientId] = useState<string | null>(null);
  const pairingRef = useRef<PairingView | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    const bridge = window.rednoteDesktop;
    if (bridge === undefined) {
      throw new Error('桌面接口不可用。');
    }
    const [statusResult, clientsResult] = await Promise.all([
      bridge.getLocalApiStatus(),
      bridge.listLocalApiClients(),
    ]);
    if (!statusResult.ok) {
      throw statusResult.error;
    }
    if (!clientsResult.ok) {
      throw clientsResult.error;
    }
    setPortInput(String(statusResult.value.port));
    setLoadState({
      clients: clientsResult.value,
      phase: 'ready',
      status: statusResult.value,
    });
  }, []);

  useEffect(() => {
    let active = true;
    void refresh().catch((error: unknown) => {
      if (active) {
        setLoadState({ message: errorMessage(error), phase: 'error' });
      }
    });
    return () => {
      active = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (pairing === null) {
      return;
    }
    const timer = window.setInterval(() => {
      const current = pairingRef.current;
      const currentTime = Date.now();
      setNow(currentTime);
      if (current !== null && Date.parse(current.expiresAt) <= currentTime) {
        pairingRef.current = null;
        setPairing(null);
        setNotice('配对码已过期，请重新开始配对。');
        void window.rednoteDesktop?.cancelLocalApiPairing({
          pairingSessionId: current.pairingSessionId,
        });
      }
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [pairing]);

  useEffect(
    () => () => {
      const current = pairingRef.current;
      pairingRef.current = null;
      if (current !== null) {
        void window.rednoteDesktop?.cancelLocalApiPairing({
          pairingSessionId: current.pairingSessionId,
        });
      }
    },
    [],
  );

  const updateService = async (enabled: boolean): Promise<void> => {
    if (loadState.phase !== 'ready') {
      return;
    }
    const port = parsePort(portInput);
    if (port === null) {
      setNotice('端口必须是 1024—65535 之间的整数。');
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const result = await window.rednoteDesktop?.updateLocalApiSettings({
        enabled,
        expectedRevision: loadState.status.revision,
        port,
      });
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      if (!enabled) {
        pairingRef.current = null;
        setPairing(null);
      }
      setLoadState((current) =>
        current.phase === 'ready' ? { ...current, status: result.value } : current,
      );
      setPortInput(String(result.value.port));
      setNotice(
        enabled
          ? '本地插件连接已在 IPv4 loopback 上启用。'
          : '本地插件连接已停用，监听端口已经释放。',
      );
    } catch (error) {
      setNotice(errorMessage(error));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const startPairing = async (): Promise<void> => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await window.rednoteDesktop?.startLocalApiPairing();
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      pairingRef.current = result.value;
      setPairing(result.value);
      setNow(Date.now());
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const cancelPairing = async (): Promise<void> => {
    const current = pairingRef.current;
    if (current === null) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.rednoteDesktop?.cancelLocalApiPairing({
        pairingSessionId: current.pairingSessionId,
      });
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      pairingRef.current = null;
      setPairing(null);
      setNotice('本次配对已取消，配对码立即失效。');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const revokeClient = async (client: LocalApiClientView): Promise<void> => {
    if (confirmedClientId !== client.id) {
      setNotice('撤销前请先勾选该客户端的确认框。');
      return;
    }
    setBusy(true);
    try {
      const result = await window.rednoteDesktop?.revokeLocalApiClient({
        clientId: client.id,
        confirmation: 'REVOKE_LOCAL_API_CLIENT',
        expectedRevision: client.revision,
      });
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      setConfirmedClientId(null);
      setNotice('客户端已撤销；其原认证令牌立即失效。');
      await refresh();
    } catch (error) {
      setNotice(errorMessage(error));
      await refresh().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  const copyText = async (value: string, label: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label}已复制。`);
    } catch {
      setNotice(`${label}复制失败，请手动选择复制。`);
    }
  };

  if (loadState.phase === 'loading') {
    return (
      <section className="local-api-card" aria-busy="true">
        <p className="section-kicker">本地插件连接</p>
        <h3>正在读取真实监听状态</h3>
      </section>
    );
  }

  if (loadState.phase === 'error') {
    return (
      <section className="local-api-card" role="alert">
        <p className="section-kicker">本地插件连接</p>
        <h3>状态读取失败</h3>
        <p>{loadState.message}</p>
        <button
          className="button"
          onClick={() => {
            setLoadState({ phase: 'loading' });
            void refresh().catch((error: unknown) => {
              setLoadState({ message: errorMessage(error), phase: 'error' });
            });
          }}
          type="button"
        >
          重新读取
        </button>
      </section>
    );
  }

  const { clients, status } = loadState;
  const remainingSeconds =
    pairing === null ? 0 : Math.max(0, Math.ceil((Date.parse(pairing.expiresAt) - now) / 1_000));

  return (
    <section className="local-api-card" aria-labelledby="local-api-title">
      <div className="local-api-heading">
        <div>
          <p className="section-kicker">Issue 011 · 默认关闭</p>
          <h3 id="local-api-title">本地插件连接</h3>
          <p>仅监听 127.0.0.1。Chrome/Edge 收藏插件将在 Issue 017 实现，本阶段没有样本保存功能。</p>
        </div>
        <span className={`local-api-state local-api-state--${status.state.toLowerCase()}`}>
          {status.state} · {stateLabel(status)}
        </span>
      </div>

      {notice === null ? null : (
        <p aria-live="polite" className="settings-message">
          {notice}
        </p>
      )}

      <div className="local-api-controls">
        <label className="field">
          <span>监听端口</span>
          <input
            disabled={busy}
            inputMode="numeric"
            onChange={(event) => setPortInput(event.currentTarget.value)}
            value={portInput}
          />
        </label>
        <div className="local-api-endpoint">
          <span>Loopback endpoint</span>
          <code>{status.endpoint ?? '未监听'}</code>
        </div>
        <div className="button-row">
          <button
            className={status.enabled ? 'button button--danger' : 'button button--primary'}
            disabled={busy || status.state === 'STARTING' || status.state === 'STOPPING'}
            onClick={() => void updateService(!status.enabled)}
            type="button"
          >
            {status.enabled ? '明确停用' : '明确启用'}
          </button>
          <button
            className="button"
            disabled={
              busy ||
              !status.enabled ||
              parsePort(portInput) === status.port ||
              status.state !== 'RUNNING'
            }
            onClick={() => void updateService(true)}
            type="button"
          >
            保存端口并重启
          </button>
          <button
            className="button"
            disabled={status.endpoint === null}
            onClick={() => {
              if (status.endpoint !== null) {
                void copyText(status.endpoint, 'Endpoint');
              }
            }}
            type="button"
          >
            复制 endpoint
          </button>
        </div>
        <p className="capability-note">
          修改已启用服务的端口会安全重启本地监听；端口冲突不会自动扫描或改用其他端口。
        </p>
      </div>

      <div className="pairing-panel">
        <div>
          <h4>短期配对</h4>
          <p>配对码只保存在内存中，120 秒后失效；应用不会生成或显示长期令牌。</p>
        </div>
        {pairing === null ? (
          <button
            className="button button--primary"
            disabled={busy || status.state !== 'RUNNING'}
            onClick={() => void startPairing()}
            type="button"
          >
            开始配对
          </button>
        ) : (
          <div className="pairing-code-panel">
            <span>剩余 {remainingSeconds} 秒</span>
            <code>{pairing.pairingCode}</code>
            <small>{pairing.endpoint}</small>
            <div className="button-row">
              <button
                className="button"
                onClick={() => void copyText(pairing.pairingCode, '配对码')}
                type="button"
              >
                复制配对码
              </button>
              <button
                className="button"
                onClick={() => void copyText(pairing.endpoint, 'Endpoint')}
                type="button"
              >
                复制 endpoint
              </button>
              <button
                className="button button--danger"
                disabled={busy}
                onClick={() => void cancelPairing()}
                type="button"
              >
                取消配对
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="client-panel">
        <div className="client-panel-heading">
          <div>
            <h4>已配对客户端</h4>
            <p>活动客户端 {status.activeClientCount}/8；列表不包含令牌或摘要。</p>
          </div>
          <button className="button" disabled={busy} onClick={() => void refresh()} type="button">
            刷新
          </button>
        </div>
        {clients.length === 0 ? (
          <p className="empty-note">尚无已配对客户端。</p>
        ) : (
          <ul className="client-list">
            {clients.map((client) => (
              <li key={client.id}>
                <div>
                  <strong>{client.clientLabel ?? '未命名客户端'}</strong>
                  <code>{client.extensionOrigin}</code>
                  <span>
                    创建：{client.createdAt} · 最近使用：{client.lastUsedAt ?? '从未'}
                  </span>
                </div>
                <div className="client-actions">
                  <span>{client.status}</span>
                  {client.status === 'ACTIVE' ? (
                    <>
                      <label className="check-row">
                        <input
                          checked={confirmedClientId === client.id}
                          onChange={(event) =>
                            setConfirmedClientId(event.currentTarget.checked ? client.id : null)
                          }
                          type="checkbox"
                        />
                        确认撤销
                      </label>
                      <button
                        className="button button--danger"
                        disabled={busy || confirmedClientId !== client.id}
                        onClick={() => void revokeClient(client)}
                        type="button"
                      >
                        撤销
                      </button>
                    </>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
