import { useState } from 'react';

import { Button } from './components.js';

export function ProviderActionControl({
  disabled = false,
  intent,
  label,
  onSuccess,
}: {
  readonly disabled?: boolean;
  readonly intent: V2ProviderActionIntentContract;
  readonly label: string;
  readonly onSuccess: () => Promise<void>;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<V2ProviderActionPreviewContract | null>(null);
  const [status, setStatus] = useState<
    'BLOCKED' | 'CANCELLED' | 'IDLE' | 'PREVIEW' | 'SUCCEEDED' | 'UNCERTAIN'
  >('IDLE');

  const inspect = async (): Promise<void> => {
    const bridge = window.rednoteV2;
    if (bridge?.previewProviderAction === undefined) {
      setMessage('本机受控模型桥接不可用。');
      setStatus('BLOCKED');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await bridge.previewProviderAction(intent);
      if (!result.ok) {
        setMessage(result.error.message);
        setStatus('BLOCKED');
        return;
      }
      setPreview(result.value);
      setStatus('PREVIEW');
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    const bridge = window.rednoteV2;
    if (bridge?.confirmProviderAction === undefined || preview === null) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await bridge.confirmProviderAction({
        confirmation: 'RUN_PROVIDER_ACTION',
        previewToken: preview.previewToken,
      });
      setPreview(null);
      if (!result.ok) {
        setMessage(result.error.message);
        setStatus(result.error.code === 'PROVIDER_ACTION_UNCERTAIN' ? 'UNCERTAIN' : 'BLOCKED');
        return;
      }
      await onSuccess();
      setMessage('受控结果已校验并写入本机；本次最多执行 1 个模型请求。');
      setStatus('SUCCEEDED');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="v2-provider-action" data-status={status}>
      {preview === null ? (
        <Button
          disabled={disabled || busy}
          icon="sparkle"
          onClick={() => void inspect()}
          tone="primary"
        >
          {label}
        </Button>
      ) : (
        <div aria-live="polite" className="v2-card v2-provider-preview">
          <strong>调用前预览</strong>
          <p>{preview.summary}</p>
          <dl>
            <div>
              <dt>模型槽</dt>
              <dd>{preview.modelSlot === 'research' ? '研究' : '写作'}</dd>
            </div>
            <div>
              <dt>外部请求</dt>
              <dd>最多 1 次</dd>
            </div>
            <div>
              <dt>费用估计</dt>
              <dd>未知，将记入本地账本</dd>
            </div>
            <div>
              <dt>搜索 / 抓取</dt>
              <dd>关闭 / 关闭</dd>
            </div>
          </dl>
          <div className="v2-provider-preview-actions">
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setMessage('已取消，未调用模型、未写入结果。');
                setStatus('CANCELLED');
              }}
            >
              取消
            </Button>
            <Button disabled={busy} onClick={() => void confirm()} tone="primary">
              确认并执行一次
            </Button>
          </div>
        </div>
      )}
      {message === '' ? null : (
        <div
          aria-live="polite"
          className="v2-provider-message"
          role={status === 'BLOCKED' || status === 'UNCERTAIN' ? 'alert' : 'status'}
        >
          <span>{message}</span>
          {status === 'BLOCKED' || status === 'UNCERTAIN' ? (
            <button
              onClick={() => {
                window.location.hash = '/v2/settings';
              }}
              type="button"
            >
              前往设置
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}
