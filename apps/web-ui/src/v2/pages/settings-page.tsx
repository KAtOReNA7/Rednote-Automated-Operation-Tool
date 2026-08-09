import { useEffect, useState } from 'react';

import { Button, Icon, PageHeader, useV2Controller } from '../components.js';

const capabilityLabel = {
  STALE: '已过期',
  SUPPORTED: '支持',
  UNKNOWN: '未知',
  UNSUPPORTED: '不支持',
} as const;
const credentialLabel = {
  CONFIGURED: '已配置',
  NOT_CONFIGURED: '未配置',
  REAUTH_REQUIRED: '需重新认证',
} as const;

function ProviderSettings(): React.JSX.Element {
  const { notify } = useV2Controller();
  const [view, setView] = useState<V2ProviderSettingsViewContract | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [researchModel, setResearchModel] = useState('');
  const [writingModel, setWritingModel] = useState('');
  const [credential, setCredential] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [probe, setProbe] = useState<V2CapabilityProbePreviewContract | null>(null);
  const [confirmProbe, setConfirmProbe] = useState(false);

  const apply = (next: V2ProviderSettingsViewContract): void => {
    setView(next);
    setBaseUrl(next.providerBaseUrl ?? '');
    setResearchModel(next.research.modelId ?? '');
    setWritingModel(next.writing.modelId ?? '');
  };
  const load = async (): Promise<void> => {
    const result = await window.rednoteV2?.readProviderSettings?.();
    if (result === undefined) return notify('本机设置桥接不可用，无法读取 AI 服务设置。');
    if (!result.ok) return notify(result.error.message);
    apply(result.value);
  };
  useEffect(() => {
    void load();
  }, []);

  const save = async (): Promise<void> => {
    if (view === null || window.rednoteV2?.updateProviderSettings === undefined) return;
    const result = await window.rednoteV2.updateProviderSettings({
      expectedRevision: view.revision,
      providerBaseUrl: baseUrl.trim() || null,
      researchModelId: researchModel.trim() || null,
      writingModelId: writingModel.trim() || null,
    });
    if (!result.ok) return notify(result.error.message);
    apply(result.value);
    setProbe(null);
    notify('AI 服务非秘密设置已保存到本机。');
  };
  const saveCredential = async (): Promise<void> => {
    if (window.rednoteV2?.setProviderCredential === undefined || credential === '') return;
    const plaintext = credential;
    setCredential('');
    const result = await window.rednoteV2.setProviderCredential({ plaintext });
    if (!result.ok) return notify(result.error.message);
    apply(result.value);
    notify('凭据已加密保存；输入框已清空，旧值不会回显。');
  };
  const clearCredential = async (): Promise<void> => {
    if (!confirmClear || window.rednoteV2?.clearProviderCredential === undefined) return;
    const result = await window.rednoteV2.clearProviderCredential({
      confirmation: 'DELETE_CONTENT_AI_API_KEY',
    });
    if (!result.ok) return notify(result.error.message);
    apply(result.value);
    setConfirmClear(false);
    notify('凭据已清除。');
  };
  const previewProbe = async (): Promise<void> => {
    const result = await window.rednoteV2?.previewProviderCapabilityProbe?.();
    if (result === undefined) return notify('本机 capability bridge 不可用。');
    if (!result.ok) return notify(result.error.message);
    setProbe(result.value);
    setConfirmProbe(false);
  };
  const startProbe = async (): Promise<void> => {
    if (
      probe === null ||
      !confirmProbe ||
      window.rednoteV2?.startProviderCapabilityProbe === undefined
    )
      return;
    const result = await window.rednoteV2.startProviderCapabilityProbe({
      confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
      credentialBindingVersion: probe.credentialBindingVersion,
      planHash: probe.planHash,
      settingsRevision: probe.settingsRevision,
      startToken: probe.startToken,
    });
    if (!result.ok) return notify(result.error.message);
    setProbe(null);
    notify(
      `能力检查已由用户明确启动：${result.value.sentRequestCount}/${result.value.plannedRequestCount} 请求。`,
    );
    await load();
  };

  return (
    <section className="v2-card v2-settings v2-provider-settings">
      <div className="v2-settings-title">
        <Icon name="sparkle" size={24} />
        <div>
          <h2>AI 服务</h2>
          <p>连接既有本机 Provider、凭据、能力检查与费用账本。</p>
        </div>
      </div>
      {view === null ? (
        <p role="status">正在读取本机设置；不可用时不会生成模拟结果。</p>
      ) : (
        <>
          <p>
            <strong>Provider：</strong>
            {view.providerConfigured ? '配置完整' : '待配置'} · <strong>凭据：</strong>
            {credentialLabel[view.credentialState]}
          </p>
          <label className="v2-field">
            <span>Base URL</span>
            <input
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="例如：Provider 的 HTTPS API 地址"
              value={baseUrl}
            />
          </label>
          <label className="v2-field">
            <span>研究模型 ID</span>
            <input
              onChange={(event) => setResearchModel(event.target.value)}
              value={researchModel}
            />
          </label>
          <label className="v2-field">
            <span>写作模型 ID</span>
            <input onChange={(event) => setWritingModel(event.target.value)} value={writingModel} />
          </label>
          <Button onClick={() => void save()} tone="primary">
            保存 AI 服务设置
          </Button>
          <hr />
          <label className="v2-field" htmlFor="v2-provider-credential">
            <span>设置或替换凭据</span>
            <input
              aria-label="设置或替换凭据"
              autoComplete="new-password"
              id="v2-provider-credential"
              onChange={(event) => setCredential(event.target.value)}
              type="password"
              value={credential}
            />
            <small>保存后立即清空，永不回显旧凭据。</small>
          </label>
          <div className="v2-inline-actions">
            <Button disabled={credential === ''} onClick={() => void saveCredential()}>
              加密保存凭据
            </Button>
            <label>
              <input
                checked={confirmClear}
                onChange={(event) => setConfirmClear(event.target.checked)}
                type="checkbox"
              />
              我确认清除凭据
            </label>
            <Button disabled={!confirmClear} onClick={() => void clearCredential()}>
              清除凭据
            </Button>
          </div>
          <hr />
          <h3>结构化输出能力</h3>
          <p>
            研究槽：{capabilityLabel[view.research.state]} · 写作槽：
            {capabilityLabel[view.writing.state]}
          </p>
          <p>能力检查只会在你预览并明确确认后启动，不会自动探测。</p>
          <Button onClick={() => void previewProbe()}>预览能力检查</Button>
          {probe === null ? null : (
            <div className="v2-provider-blockers">
              <p>
                预计请求 {probe.requestCount} 次 · 费用
                {probe.feeEstimate === 'UNKNOWN' ? '无法估算' : probe.feeEstimate} · 预算
                {probe.budgetReady ? '允许' : '未就绪'}
              </p>
              <label>
                <input
                  checked={confirmProbe}
                  onChange={(event) => setConfirmProbe(event.target.checked)}
                  type="checkbox"
                />
                我确认启动本次能力检查
              </label>
              <Button
                disabled={!confirmProbe || !probe.budgetReady}
                onClick={() => void startProbe()}
                tone="primary"
              >
                确认并启动
              </Button>
            </div>
          )}
          <hr />
          <h3>费用与预算</h3>
          <p>
            周计划价格：{view.accounting.priceReadyForWeeklyPlan ? '可估算' : '未配置'} · 内容价格：
            {view.accounting.priceReadyForContent ? '可估算' : '未配置'} · 回复价格：
            {view.accounting.priceReadyForReply ? '可估算' : '未配置'}
          </p>
          <p>
            {view.accounting.hardStop ? '本月预算已阻止调用。' : '预算硬上限尚未触发。'}{' '}
            价格不完整时，调用确认会保持禁用。
          </p>
        </>
      )}
    </section>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { notify, session, setSession, setUi, ui } = useV2Controller();
  const update = (field: 'audience' | 'boundary' | 'name' | 'tone', value: string): void => {
    setSession((current) => ({ ...current, persona: { ...current.persona, [field]: value } }));
    setUi((current) => ({
      ...current,
      personaErrors: current.personaErrors.filter((item) => item !== field),
    }));
  };
  const save = async (): Promise<void> => {
    const fields = ['name', 'audience', 'tone', 'boundary'] as const;
    const missing = fields.filter((field) => session.persona[field].trim() === '');
    if (missing.length > 0) {
      setUi((current) => ({ ...current, personaErrors: missing }));
      notify('账号人设不完整，请填写标出的字段。');
      return;
    }
    const bridge = window.rednoteV2;
    if (bridge === undefined) return notify('本机设置桥接不可用，未保存任何模拟状态。');
    const result = await bridge.updatePersona({
      expectedRevision: session.persona.revision,
      persona: {
        audience: session.persona.audience,
        boundary: session.persona.boundary,
        name: session.persona.name,
        tone: session.persona.tone,
      },
    });
    if (!result.ok) return notify(result.error.message);
    setSession((current) => ({ ...current, persona: { ...result.value } }));
    setUi((current) => ({ ...current, personaErrors: [] }));
    notify(`账号人设已保存到本机 · revision ${result.value.revision}`);
  };
  return (
    <div className="v2-page">
      <PageHeader
        actions={
          <Button icon="check" onClick={() => void save()} tone="primary">
            保存人设
          </Button>
        }
        description="普通设置表达业务含义；保存后会在重新启动 V2 时恢复。"
        eyebrow="账号人设与本地运行"
        title="设置"
      />
      <div className="v2-settings-grid">
        <div className="v2-stack">
          <section className="v2-card v2-settings">
            <div className="v2-settings-title">
              <Icon name="user-circle" size={24} />
              <div>
                <h2>账号人设</h2>
                <p>决定计划、文案和回复建议如何表达。</p>
              </div>
            </div>
            {(
              [
                ['name', '账号名称'],
                ['audience', '目标受众'],
                ['tone', '表达语气'],
              ] as const
            ).map(([field, label]) => (
              <label className="v2-field" key={field}>
                <span>{label}</span>
                <input
                  aria-invalid={ui.personaErrors.includes(field)}
                  onChange={(event) => update(field, event.target.value)}
                  value={session.persona[field]}
                />
                {ui.personaErrors.includes(field) ? (
                  <small className="v2-form-error">{label}未填写或不符合本地长度限制</small>
                ) : null}
              </label>
            ))}
            <label className="v2-field">
              <span>内容边界</span>
              <textarea
                aria-invalid={ui.personaErrors.includes('boundary')}
                onChange={(event) => update('boundary', event.target.value)}
                rows={4}
                value={session.persona.boundary}
              />
              {ui.personaErrors.includes('boundary') ? (
                <small className="v2-form-error">内容边界未填写或不符合本地长度限制</small>
              ) : null}
            </label>
          </section>
          <ProviderSettings />
        </div>
        <aside className="v2-settings-aside">
          <section className="v2-card">
            <Icon name="paper-plane-tilt" />
            <div>
              <h2>平台操作</h2>
              <p>发布、评论和私信仍由用户在官方端手动完成。</p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
