import { useState } from 'react';

import { Button } from './components.js';

const capabilityLabels = {
  STALE: '已过期',
  SUPPORTED: '支持',
  UNKNOWN: '未知',
  UNSUPPORTED: '不支持',
} as const;

const credentialLabels = {
  CONFIGURED: '已配置',
  NOT_CONFIGURED: '未配置',
  REAUTH_REQUIRED: '需重新认证',
} as const;

type ProviderActionIntentWithoutCost = V2ProviderActionIntentContract extends infer Action
  ? Action extends { readonly userApprovedUnknownCost?: boolean }
    ? Omit<Action, 'userApprovedUnknownCost'>
    : never
  : never;

function costLabel(value: string | null): string {
  if (value === null) return '无法估算';
  return `不超过 $${(Number(value) / 1_000_000).toFixed(6)}`;
}

export function ProviderActionControl({
  disabled = false,
  disabledReason,
  intent,
  label,
  onSuccess,
}: {
  readonly disabled?: boolean;
  readonly disabledReason?: string | undefined;
  readonly intent: ProviderActionIntentWithoutCost;
  readonly label: string;
  readonly onSuccess: () => Promise<void>;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<V2ProviderActionPreviewContract | null>(null);
  const [unknownCostApproved, setUnknownCostApproved] = useState(false);
  const [status, setStatus] = useState<
    'BLOCKED' | 'CANCELLED' | 'IDLE' | 'PREVIEW' | 'SUCCEEDED' | 'UNCERTAIN'
  >('IDLE');

  const inspect = async (approveUnknownCost = unknownCostApproved): Promise<void> => {
    const bridge = window.rednoteV2;
    if (bridge?.previewProviderAction === undefined) {
      setMessage('本机受控模型桥接不可用，未生成任何模拟结果。');
      setStatus('BLOCKED');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const result = await bridge.previewProviderAction({
        ...intent,
        userApprovedUnknownCost: approveUnknownCost,
      } as V2ProviderActionIntentContract);
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
    const currentPreview = preview;
    if (
      bridge?.confirmProviderAction === undefined ||
      currentPreview === null ||
      currentPreview.previewToken === null ||
      !currentPreview.canConfirm
    )
      return;
    setBusy(true);
    setMessage('');
    try {
      const result = await bridge.confirmProviderAction({
        confirmation: 'RUN_PROVIDER_ACTION',
        previewToken: currentPreview.previewToken,
      });
      setPreview(null);
      if (!result.ok) {
        setMessage(result.error.message);
        setStatus(
          result.error.code === 'PROVIDER_ACTION_UNCERTAIN' ||
            result.error.code === 'PROVIDER_ACTION_IMAGE_SERVICE_UNAVAILABLE'
            ? 'UNCERTAIN'
            : 'BLOCKED',
        );
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
        <>
          <Button
            disabled={disabled || busy}
            icon="sparkle"
            onClick={() => void inspect()}
            tone="primary"
          >
            {label}
          </Button>
          {disabled && disabledReason !== undefined ? <small>{disabledReason}</small> : null}
        </>
      ) : (
        <div aria-live="polite" className="v2-card v2-provider-preview">
          <strong>调用前预览</strong>
          <p>{preview.summary}</p>
          <dl>
            {preview.targetWeekKey === undefined ? null : (
              <div>
                <dt>目标周</dt>
                <dd>
                  {preview.targetWeekKey} · {preview.targetStartDate} 至 {preview.targetEndDate}
                </dd>
              </div>
            )}
            <div>
              <dt>Provider</dt>
              <dd>{preview.providerConfigured ? '已配置' : '未配置'}</dd>
            </div>
            <div>
              <dt>模型槽</dt>
              <dd>{preview.modelSlot === 'research' ? '研究' : '写作'}</dd>
            </div>
            <div>
              <dt>模型 ID</dt>
              <dd>{preview.modelId ?? '未配置'}</dd>
            </div>
            <div>
              <dt>凭据</dt>
              <dd>{credentialLabels[preview.credentialState]}</dd>
            </div>
            <div>
              <dt>结构化输出</dt>
              <dd>{capabilityLabels[preview.capabilityState]}</dd>
            </div>
            <div>
              <dt>执行协议</dt>
              <dd>{preview.protocolMode ?? '未选择'}</dd>
            </div>
            <div>
              <dt>外部请求</dt>
              <dd>最多 1 次</dd>
            </div>
            <div>
              <dt>费用上界</dt>
              <dd>{costLabel(preview.feeEstimateMicroUsd)}</dd>
            </div>
            <div>
              <dt>预算</dt>
              <dd>
                {preview.budgetState === 'ALLOWED'
                  ? '允许'
                  : preview.budgetState === 'BLOCKED'
                    ? '已阻止'
                    : '未知'}
              </dd>
            </div>
            <div>
              <dt>搜索 / 抓取</dt>
              <dd>关闭 / 关闭</dd>
            </div>
          </dl>
          {preview.blockReasons.length === 0 ? null : (
            <div className="v2-provider-blockers" role="alert">
              <strong>暂时不能执行</strong>
              <p>{preview.reasonMessage}</p>
              <ul>
                {preview.blockReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <button
                onClick={() => {
                  window.location.hash = '/v2/settings';
                }}
                type="button"
              >
                前往设置
              </button>
            </div>
          )}
          {preview.feeEstimateMicroUsd === null ? (
            <label className="v2-provider-unknown-cost">
              <input
                checked={unknownCostApproved}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setUnknownCostApproved(checked);
                  void inspect(checked);
                }}
                type="checkbox"
              />
              <span>我了解费用未知，仍授权本次最多 1 个请求</span>
            </label>
          ) : null}
          <div className="v2-provider-preview-actions">
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setUnknownCostApproved(false);
                setMessage('已取消，未调用模型、未写入结果。');
                setStatus('CANCELLED');
              }}
            >
              取消
            </Button>
            <Button
              disabled={busy || !preview.canConfirm || preview.previewToken === null}
              onClick={() => void confirm()}
              tone="primary"
            >
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
