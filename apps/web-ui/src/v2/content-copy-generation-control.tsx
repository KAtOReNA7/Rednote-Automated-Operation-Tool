import { useState } from 'react';

import { Button } from './components.js';

function costLabel(value: string | null): string {
  return value === null ? '无法估算' : `不超过 $${(Number(value) / 1_000_000).toFixed(6)}`;
}

export function ContentCopyGenerationControl({
  onComplete,
  selectedPlanItemIds,
  weekKey,
}: {
  readonly onComplete: (result: V2ContentCopyGenerationResultContract) => Promise<void>;
  readonly selectedPlanItemIds: readonly string[];
  readonly weekKey: string;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [preview, setPreview] = useState<V2ContentCopyGenerationPreviewContract | null>(null);
  const [result, setResult] = useState<V2ContentCopyGenerationResultContract | null>(null);
  const [unknownCostApproved, setUnknownCostApproved] = useState(false);

  const inspect = async (approved = unknownCostApproved): Promise<void> => {
    const bridge = window.rednoteV2?.previewContentCopyGeneration;
    if (bridge === undefined) {
      setMessage('本机内容文案桥接不可用，未生成任何模拟结果。');
      return;
    }
    setBusy(true);
    setMessage('');
    setResult(null);
    try {
      const response = await bridge({
        selectedPlanItemIds,
        userApprovedUnknownCost: approved,
        weekKey,
      });
      if (!response.ok) {
        setMessage(response.error.message);
        return;
      }
      setPreview(response.value);
    } finally {
      setBusy(false);
    }
  };

  const execute = async (): Promise<void> => {
    const bridge = window.rednoteV2?.executeContentCopyGeneration;
    if (bridge === undefined || preview?.previewToken == null || !preview.canConfirm) return;
    setBusy(true);
    setMessage('');
    try {
      const response = await bridge({ previewToken: preview.previewToken });
      setPreview(null);
      setUnknownCostApproved(false);
      if (!response.ok) {
        setMessage(response.error.message);
        return;
      }
      setResult(response.value);
      await onComplete(response.value);
    } finally {
      setBusy(false);
    }
  };

  const count = selectedPlanItemIds.length;
  return (
    <section className="v2-provider-action" data-content-copy-generation>
      {preview === null ? (
        <Button
          disabled={busy || count < 1 || count > 3}
          icon="sparkle"
          onClick={() => void inspect()}
          tone="primary"
        >
          预览生成 {count} 份文案
        </Button>
      ) : (
        <div aria-live="polite" className="v2-card v2-provider-preview">
          <strong>文案生成预览</strong>
          <p>只生成所选计划项的文案版本；封面保持独立，不会在本次调用中生成。</p>
          <dl>
            <div>
              <dt>写作模型</dt>
              <dd>{preview.modelId ?? '未配置'}</dd>
            </div>
            <div>
              <dt>执行协议</dt>
              <dd>{preview.protocolMode ?? '缺少支持证据'}</dd>
            </div>
            <div>
              <dt>文本请求</dt>
              <dd>最多 {preview.requestCount} 次</dd>
            </div>
            <div>
              <dt>图片请求</dt>
              <dd>0 次</dd>
            </div>
            <div>
              <dt>搜索 / 抓取</dt>
              <dd>关闭 / 关闭</dd>
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
          </dl>
          {preview.blockReasons.length === 0 ? null : (
            <div className="v2-provider-blockers" role="alert">
              <strong>请先处理以下具体问题</strong>
              <ul>
                {preview.blockReasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <button onClick={() => (window.location.hash = '/v2/settings')} type="button">
                前往设置
              </button>
            </div>
          )}
          {preview.feeEstimateMicroUsd === null ? (
            <label className="v2-provider-unknown-cost">
              <input
                checked={unknownCostApproved}
                onChange={(event) => {
                  setUnknownCostApproved(event.target.checked);
                  void inspect(event.target.checked);
                }}
                type="checkbox"
              />
              <span>我了解费用未知，仍授权本次最多 {preview.requestCount} 次文本请求</span>
            </label>
          ) : null}
          <div className="v2-provider-preview-actions">
            <Button
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setUnknownCostApproved(false);
              }}
            >
              取消
            </Button>
            <Button
              disabled={busy || !preview.canConfirm || preview.previewToken === null}
              onClick={() => void execute()}
              tone="primary"
            >
              确认并生成 {preview.requestCount} 份文案
            </Button>
          </div>
        </div>
      )}
      {result === null ? null : (
        <div aria-live="polite" className="v2-provider-message" role="status">
          <ul>
            {result.items.map((item) => (
              <li key={item.planItemId}>
                {item.status === 'SUCCEEDED' ? '成功' : '失败'}：{item.message}
                {item.technicalCode === null && item.providerRequestId === null ? null : (
                  <details>
                    <summary>技术信息</summary>
                    <div>技术码：{item.technicalCode ?? '无'}</div>
                    <div>Provider request ID：{item.providerRequestId ?? '未提供'}</div>
                    {item.safeDiagnostic == null ? null : (
                      <>
                        <div>
                          失败字段：
                          {item.safeDiagnostic.issuePath.length === 0
                            ? '根对象'
                            : item.safeDiagnostic.issuePath.join('.')}
                        </div>
                        <div>期望类型：{item.safeDiagnostic.expectedType ?? '未知'}</div>
                        <div>实际根类型：{item.safeDiagnostic.actualRootType ?? '未知'}</div>
                        <div>
                          实际根键名：
                          {item.safeDiagnostic.rootKeys.length === 0
                            ? '无'
                            : item.safeDiagnostic.rootKeys.join('、')}
                        </div>
                      </>
                    )}
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {message === '' ? null : (
        <div className="v2-provider-message" role="alert">
          {message}
        </div>
      )}
    </section>
  );
}
