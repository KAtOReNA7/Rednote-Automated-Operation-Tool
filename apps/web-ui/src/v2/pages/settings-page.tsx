import { useEffect, useRef, useState } from 'react';

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
const probeStatusLabel = {
  CANCELLED: '已取消',
  FAILED: '失败',
  INTERRUPTED: '已中断',
  PARTIAL: '部分完成',
  RUNNING: '检查中',
  SUCCEEDED: '已完成',
} as const;
const probeSummaryLabel = {
  CANCELLED: '已取消',
  COMPLETE: '已完成：必需能力均有明确结论',
  FAILED: '失败：探测计划未能完整执行',
  NONE_CONFIRMED: '未确认任何能力',
  NOT_RUN: '尚未运行',
  PARTIAL: '部分完成：仍有能力保持未知',
  RUNNING: '运行中',
  STALE: '结果已过期',
} as const;
const settingsSections = [
  ['provider', 'v2-provider-settings', 'AI 服务'],
  ['persona', 'v2-persona-settings', '账号与文风'],
  ['capabilities', 'v2-provider-capabilities', '能力与确认'],
  ['budget', 'v2-provider-budget', '费用与预算'],
] as const;

function ProviderSettings(): React.JSX.Element {
  const { notify } = useV2Controller();
  const [view, setView] = useState<V2ProviderSettingsViewContract | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [researchModel, setResearchModel] = useState('');
  const [writingModel, setWritingModel] = useState('');
  const [imageModel, setImageModel] = useState('');
  const [credential, setCredential] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);
  const [probe, setProbe] = useState<V2CapabilityProbePreviewContract | null>(null);
  const [probeProgress, setProbeProgress] = useState<V2CapabilityProbeProgressContract | null>(
    null,
  );
  const [confirmProbe, setConfirmProbe] = useState(false);
  const diagnosticRef = useRef<HTMLTextAreaElement>(null);

  const apply = (next: V2ProviderSettingsViewContract): void => {
    setView(next);
    setBaseUrl(next.providerBaseUrl ?? '');
    setResearchModel(next.research.modelId ?? '');
    setWritingModel(next.writing.modelId ?? '');
    setImageModel(next.image?.modelId ?? '');
  };
  const load = async (): Promise<void> => {
    setLoadError(null);
    try {
      const result = await window.rednoteV2?.readProviderSettings?.();
      if (result === undefined) {
        const message = '本机设置桥接不可用，无法读取 AI 服务设置。';
        setLoadError(message);
        return notify(message);
      }
      if (!result.ok) {
        setLoadError(result.error.message);
        return notify(result.error.message);
      }
      apply(result.value);
    } catch {
      const message = '本机设置读取失败，请重试或重新启动应用。';
      setLoadError(message);
      notify(message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (probeProgress?.status !== 'RUNNING') return;
    const bridge = window.rednoteV2?.readProviderCapabilityProbeProgress;
    if (bridge === undefined) return;
    let cancelled = false;
    let timer = 0;
    const poll = async (): Promise<void> => {
      const result = await bridge({ runId: probeProgress.runId });
      if (cancelled) return;
      if (!result.ok) {
        notify(result.error.message);
        return;
      }
      setProbeProgress(result.value);
      if (result.value.status === 'RUNNING') {
        timer = window.setTimeout(() => void poll(), 300);
      } else {
        await load();
      }
    };
    timer = window.setTimeout(
      () =>
        void poll().catch((error: unknown) => {
          if (!cancelled) notify(error instanceof Error ? error.message : '能力检查进度读取失败。');
        }),
      300,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [probeProgress?.runId, probeProgress?.status]);

  const save = async (): Promise<void> => {
    if (view === null || window.rednoteV2?.updateProviderSettings === undefined) return;
    const result = await window.rednoteV2.updateProviderSettings({
      expectedRevision: view.revision,
      providerBaseUrl: baseUrl.trim() || null,
      researchModelId: researchModel.trim() || null,
      writingModelId: writingModel.trim() || null,
      imageModelId: imageModel.trim() || null,
    });
    if (!result.ok) return notify(result.error.message);
    apply(result.value);
    setProbe(null);
    setProbeProgress(null);
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
    if (view === null) return;
    if (!view.providerConfigured) {
      return notify('请先保存有效的 Base URL，以及研究、写作和图片模型 ID。');
    }
    const result = await window.rednoteV2?.previewProviderCapabilityProbe?.();
    if (result === undefined) return notify('本机 capability bridge 不可用。');
    if (!result.ok) return notify(result.error.message);
    setProbe(result.value);
    setProbeProgress(null);
    setConfirmProbe(false);
  };
  const startProbe = async (): Promise<void> => {
    if (
      probe === null ||
      !confirmProbe ||
      window.rednoteV2?.startProviderCapabilityProbe === undefined
    )
      return;
    if (probe.requestCount === 0) {
      notify('当前必需能力已有有效证据，无需重复验证。');
      setProbe(null);
      return;
    }
    const result = await window.rednoteV2.startProviderCapabilityProbe({
      confirmation: 'START_PROVIDER_CAPABILITY_PROBE',
      credentialBindingVersion: probe.credentialBindingVersion,
      planHash: probe.planHash,
      settingsRevision: probe.settingsRevision,
      startToken: probe.startToken,
      userApprovedUnknownCost: probe.feeEstimate === 'UNKNOWN' && confirmProbe,
    });
    if (!result.ok) return notify(result.error.message);
    setProbe(null);
    setProbeProgress(result.value);
    notify(
      `能力检查已由用户明确启动：${result.value.sentRequestCount}/${result.value.plannedRequestCount} 请求。`,
    );
    await load();
  };
  const copyDiagnostic = async (): Promise<void> => {
    const text = view?.capabilityProbe.diagnosticText ?? '';
    if (text === '') return;
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(text);
      notify('脱敏诊断已复制；不包含凭据、原始请求或响应。');
    } catch {
      diagnosticRef.current?.focus();
      diagnosticRef.current?.select();
      notify('系统剪贴板不可用，已选中只读脱敏诊断，请按 Ctrl+C 复制。');
    }
  };

  return (
    <section className="v2-card v2-settings v2-provider-settings" id="v2-provider-settings">
      <div className="v2-settings-title">
        <Icon name="sparkle" size={24} />
        <div>
          <h2>AI 服务</h2>
          <p>连接既有本机 Provider、凭据、能力检查与费用账本。</p>
        </div>
      </div>
      {loadError !== null ? (
        <div role="alert">
          <p>{loadError}</p>
          <Button onClick={() => void load()}>重试读取 AI 设置</Button>
        </div>
      ) : view === null ? (
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
          <label className="v2-field">
            <span>图片模型 ID</span>
            <input
              aria-label="图片模型 ID"
              onChange={(event) => setImageModel(event.target.value)}
              value={imageModel}
            />
            <small>必须是中转站明确支持 OpenAI Images Generations 接口的模型 ID。</small>
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
          <h3 id="v2-provider-capabilities">R07 所需能力</h3>
          <p>
            研究槽：{capabilityLabel[view.research.state]}
            {view.research.protocolMode === null ? '' : ` · ${view.research.protocolMode}`} ·
            写作槽：
            {capabilityLabel[view.writing.state]}
            {view.writing.protocolMode === null ? '' : ` · ${view.writing.protocolMode}`} · 图片槽
            imageGeneration：{capabilityLabel[view.image?.state ?? 'UNKNOWN']}
          </p>
          <p>
            能力检查只会在你预览并明确确认后启动。文本单次最长90秒、图片单次最长120秒、不会自动重试。
          </p>
          <Button onClick={() => void previewProbe()}>验证 R07 所需能力</Button>
          {probeProgress === null ? null : (
            <p role="status">
              能力检查：{probeStatusLabel[probeProgress.status]} · 已发送{' '}
              {probeProgress.sentRequestCount}/{probeProgress.plannedRequestCount} 个请求 · 已完成{' '}
              {probeProgress.completedRequestCount}/{probeProgress.plannedRequestCount}
            </p>
          )}
          {probe === null ? null : (
            <div className="v2-provider-blockers">
              <p>
                预计请求 {probe.requestCount} 次 · 费用
                {probe.feeEstimate === 'UNKNOWN' ? '无法估算' : probe.feeEstimate} · 预算
                {probe.budgetReady ? '允许' : '已达到硬上限'}
              </p>
              <p>
                模型：{probe.modelIds?.join('、') ?? '未配置'} · Search：
                {probe.searchEnabled ? '开启' : '关闭'} · Fetch：
                {probe.fetchEnabled ? '开启' : '关闭'}
              </p>
              <p>文本单次最长90秒、图片单次最长120秒、不会自动重试。</p>
              {view.credentialState === 'CONFIGURED' ? null : (
                <p className="v2-form-error">凭据未配置或需重新认证，请先在上方保存凭据。</p>
              )}
              {probe.requestCount === 0 ? (
                <p role="status">当前必需能力已有有效证据，无需重复验证。</p>
              ) : (
                <>
                  <label>
                    <input
                      checked={confirmProbe}
                      onChange={(event) => setConfirmProbe(event.target.checked)}
                      type="checkbox"
                    />
                    {probe.feeEstimate === 'UNKNOWN'
                      ? `我了解费用未知，仍授权本次最多 ${probe.requestCount} 个能力检查请求`
                      : '我确认启动本次能力检查'}
                  </label>
                  <Button
                    disabled={
                      !confirmProbe ||
                      !probe.budgetReady ||
                      view.credentialState !== 'CONFIGURED' ||
                      !view.providerConfigured
                    }
                    onClick={() => void startProbe()}
                    tone="primary"
                  >
                    确认并启动
                  </Button>
                </>
              )}
            </div>
          )}
          {view.capabilityProbe.latestRun === null ? null : (
            <details className="v2-provider-blockers" data-testid="v2-probe-diagnostics">
              <summary>最近一次能力检查与脱敏诊断</summary>
              <p>
                <strong>{probeSummaryLabel[view.capabilityProbe.summaryState]}</strong> · 已计划{' '}
                {view.capabilityProbe.latestRun.plannedRequestCount} · 已发送{' '}
                {view.capabilityProbe.latestRun.sentRequestCount} · 已完成{' '}
                {view.capabilityProbe.latestRun.completedRequestCount}
              </p>
              <p>
                Search：关闭 · Fetch：关闭 · 费用：
                {view.capabilityProbe.latestRun.costState === 'UNKNOWN' ? '未知' : '已知'}
              </p>
              <ul className="v2-probe-step-list">
                {view.capabilityProbe.steps.map((step) => (
                  <li key={`${step.modelId}:${step.protocolMode}:${step.capability}`}>
                    <strong>{step.mappedSlots.join(' + ')}</strong> · {step.modelId} ·{' '}
                    {step.capability} · {step.protocolMode}
                    <br />
                    结论：{capabilityLabel[step.state]} · {step.sent ? '已发送' : '未发送'} ·{' '}
                    {step.stale ? '已过期' : '当前'} · 错误码：{step.diagnosticCode}
                    <br />
                    {step.reason}
                    {step.httpStatus === null ? '' : ` HTTP ${step.httpStatus}`}
                    {step.errorCode == null ? '' : ` · code=${step.errorCode}`}
                    {step.errorType == null ? '' : ` · type=${step.errorType}`}
                    {step.errorParam == null ? '' : ` · param=${step.errorParam}`}
                    {step.requestId == null ? '' : ` · requestId=${step.requestId}`}
                    <br />
                    receivedContentType={step.receivedContentType ?? 'MISSING'} · transportVariant=
                    {step.transportVariant ?? 'REJECTED'} · responseStatus=
                    {step.httpStatus ?? '未知'}
                    {step.deduplicated
                      ? `；同一请求已去重并映射到 ${step.mappedSlots.join('、')}`
                      : ''}
                    <br />
                    观测时间：{step.observedAt ?? '无'}
                  </li>
                ))}
              </ul>
              <Button onClick={() => void copyDiagnostic()}>复制脱敏诊断</Button>
              <label className="v2-field">
                <span>脱敏诊断（只读，可手动选择）</span>
                <textarea
                  aria-label="脱敏诊断（只读）"
                  readOnly
                  ref={diagnosticRef}
                  rows={Math.min(10, 4 + view.capabilityProbe.steps.length)}
                  value={view.capabilityProbe.diagnosticText}
                />
              </label>
            </details>
          )}
          <hr />
          <h3 id="v2-provider-budget">费用与预算</h3>
          <p>
            周计划价格：{view.accounting.priceReadyForWeeklyPlan ? '可估算' : '未配置'} · 内容价格：
            {view.accounting.priceReadyForContent ? '可估算' : '未配置'} · 回复价格：
            {view.accounting.priceReadyForReply ? '可估算' : '未配置'}
          </p>
          <p>
            {view.accounting.hardStop ? '本月预算已阻止调用。' : '预算硬上限尚未触发。'}{' '}
            价格不完整时必须逐次明确授权，未知费用不会记为 0。
          </p>
        </>
      )}
    </section>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { notify, session, setSession, setUi, ui } = useV2Controller();
  const [activeSection, setActiveSection] = useState('provider');
  const selectSection = (section: string, targetId: string): void => {
    setActiveSection(section);
    document.getElementById(targetId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
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
  const buildInfo =
    typeof __REDNOTE_BUILD_INFO__ === 'undefined'
      ? { builtAt: '开发测试环境', commit: 'development', v2DataVersion: 1 }
      : __REDNOTE_BUILD_INFO__;
  return (
    <div className="v2-page v2-settings-page">
      <PageHeader
        actions={
          <Button icon="check" onClick={() => void save()} tone="primary">
            保存人设
          </Button>
        }
        description="把账号表达、AI 服务、能力验证和费用边界分开管理。"
        eyebrow="工作区配置"
        title="设置"
      />
      <section className="v2-workspace-intro v2-settings-intro" aria-label="设置说明">
        <div>
          <p className="v2-kicker">本地工作区设置</p>
          <h2>把账号表达与 AI 服务分开管理</h2>
        </div>
        <p>凭据始终留在本机安全存储；费用、能力与平台边界均显示真实状态，不会模拟已连接的服务。</p>
      </section>
      <div className="v2-settings-grid v2-settings-board">
        <nav aria-label="设置分类" className="v2-card v2-settings-section-nav">
          <p className="v2-kicker">设置分类</p>
          {settingsSections.map(([section, targetId, label]) => (
            <button
              aria-pressed={activeSection === section}
              data-active={activeSection === section}
              key={section}
              onClick={() => selectSection(section, targetId)}
              type="button"
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="v2-stack v2-settings-main">
          <ProviderSettings />
          <section className="v2-card v2-settings v2-persona-settings" id="v2-persona-settings">
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
        </div>
        <aside className="v2-settings-aside v2-settings-rail">
          <section className="v2-card v2-settings-rail-card" aria-label="本地边界">
            <Icon name="check-circle" />
            <div>
              <p className="v2-kicker">本地边界</p>
              <h2>人工确认优先</h2>
              <p>每次生成、审批和平台操作均需由用户明确确认。</p>
            </div>
          </section>
          <section className="v2-card v2-settings-rail-card" aria-label="构建版本">
            <Icon name="file-text" />
            <div>
              <h2>构建版本</h2>
              <p>
                commit <code>{buildInfo.commit.slice(0, 8)}</code>
              </p>
              <p>构建时间：{buildInfo.builtAt}</p>
              <p>V2 数据版本：v{buildInfo.v2DataVersion}</p>
            </div>
          </section>
          <section className="v2-card v2-settings-rail-card">
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
