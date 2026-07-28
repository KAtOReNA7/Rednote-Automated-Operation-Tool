import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  DataRootSelection,
  DiagnosticPreview,
  NonSecretSettingsDraft,
  SettingsBundle,
} from '@mystery-operations/shared';

import { LocalApiSettings } from './local-api-settings.js';
import { ProviderCapabilitySettings } from './provider-capability-settings.js';
import { SearchProviderSettings } from './search-provider-settings.js';
import { FetchPolicySettings } from './fetch-policy-settings.js';
import { useSettings } from './use-settings.js';

interface DraftFields {
  readonly bio: string;
  readonly embeddingModel: string;
  readonly hardLimit: string;
  readonly imageModel: string;
  readonly providerBaseUrl: string;
  readonly researchModel: string;
  readonly reviewModel: string;
  readonly warning: string;
  readonly workingName: string;
  readonly writingModel: string;
}

const EMPTY_FIELDS: DraftFields = {
  bio: '',
  embeddingModel: '',
  hardLimit: '100.00',
  imageModel: '',
  providerBaseUrl: '',
  researchModel: '',
  reviewModel: '',
  warning: '80.00',
  workingName: '未命名账号',
  writingModel: '',
};

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function fieldsFromBundle(bundle: SettingsBundle): DraftFields {
  return {
    bio: bundle.account.bio,
    embeddingModel: bundle.settings.embeddingModelId ?? '',
    hardLimit: dollars(bundle.settings.monthlyHardLimitCents),
    imageModel: bundle.settings.imageModelId ?? '',
    providerBaseUrl: bundle.settings.providerBaseUrl ?? '',
    researchModel: bundle.settings.researchModelId ?? '',
    reviewModel: bundle.settings.reviewModelId ?? '',
    warning: dollars(bundle.settings.monthlyWarningCents),
    workingName: bundle.account.workingName,
    writingModel: bundle.settings.writingModelId ?? '',
  };
}

function optional(value: string): string | null {
  return value.trim() === '' ? null : value;
}

function asErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return String(error.message);
  }
  return '设置操作失败，请刷新后重试。';
}

export function SettingsPage(): React.JSX.Element {
  const controller = useSettings();
  const [fields, setFields] = useState<DraftFields>(EMPTY_FIELDS);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [selection, setSelection] = useState<DataRootSelection | null>(null);
  const [confirmRoot, setConfirmRoot] = useState(false);
  const [credentialInput, setCredentialInput] = useState('');
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [preview, setPreview] = useState<DiagnosticPreview | null>(null);
  const credentialRef = useRef<HTMLInputElement>(null);
  const loadedRevision = useRef<number | null>(null);
  const attachCredentialInput = useCallback((element: HTMLInputElement | null): void => {
    if (element === null && credentialRef.current !== null) {
      credentialRef.current.value = '';
    }
    credentialRef.current = element;
  }, []);

  useEffect(() => {
    if (
      controller.state.phase === 'ready' &&
      loadedRevision.current !== controller.state.bundle.settings.revision
    ) {
      setFields(fieldsFromBundle(controller.state.bundle));
      loadedRevision.current = controller.state.bundle.settings.revision;
      setDirty(false);
    }
  }, [controller.state]);

  useEffect(() => {
    const protectUnsaved = (event: BeforeUnloadEvent): void => {
      if (dirty || credentialInput !== '') {
        event.preventDefault();
      }
    };
    window.addEventListener('beforeunload', protectUnsaved);
    return () => {
      window.removeEventListener('beforeunload', protectUnsaved);
    };
  }, [credentialInput, dirty]);

  const updateField = (key: keyof DraftFields, value: string): void => {
    setFields((current) => ({ ...current, [key]: value }));
    setDirty(true);
    setMessage(null);
    setPreview(null);
  };

  const chooseRoot = async (): Promise<void> => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await window.rednoteDesktop?.selectDataRoot();
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      setSelection(result.value);
      setConfirmRoot(false);
    } catch (error) {
      setMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const activateRoot = async (): Promise<void> => {
    if (selection === null || !confirmRoot) {
      setMessage('请先选择目录并确认切换。');
      return;
    }
    setBusy(true);
    try {
      const currentRevision =
        controller.state.phase === 'ready' && controller.state.setup.project.status === 'READY'
          ? controller.state.setup.project.revision
          : null;
      const result = await window.rednoteDesktop?.confirmDataRootSelection({
        confirmation: 'ACTIVATE_DATA_ROOT',
        expectedRevision: currentRevision,
        mode: 'CREATE_OR_OPEN',
        token: selection.token,
      });
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      setSelection(null);
      setConfirmRoot(false);
      setMessage('本地数据目录已启用。');
      await controller.refresh();
    } catch (error) {
      setMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async (): Promise<void> => {
    if (controller.state.phase !== 'ready') {
      return;
    }
    setBusy(true);
    setMessage(null);
    const draft: NonSecretSettingsDraft = {
      account: { bio: fields.bio, workingName: fields.workingName },
      budget: {
        hardLimitDollars: fields.hardLimit,
        warningDollars: fields.warning,
      },
      expectedRevision: controller.state.bundle.settings.revision,
      models: {
        embedding: optional(fields.embeddingModel),
        image: optional(fields.imageModel),
        research: optional(fields.researchModel),
        review: optional(fields.reviewModel),
        writing: optional(fields.writingModel),
      },
      providerBaseUrl: optional(fields.providerBaseUrl),
    };
    try {
      await controller.update(draft);
      setDirty(false);
      setPreview(null);
      setMessage('非秘密设置已保存，并已从本地数据库重新读取。');
    } catch (error) {
      setMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const saveCredential = async (): Promise<void> => {
    if (
      credentialInput === '' ||
      (controller.state.phase === 'ready' &&
        controller.state.bundle.credential.status === 'CONFIGURED' &&
        !confirmReplace)
    ) {
      setMessage('请输入新密钥；替换已有密钥时还需明确确认。');
      return;
    }
    setBusy(true);
    try {
      const result = await window.rednoteDesktop?.setCredential({
        plaintext: credentialInput,
        slot: 'CONTENT_AI_API_KEY',
      });
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      setCredentialInput('');
      if (credentialRef.current !== null) {
        credentialRef.current.value = '';
      }
      setConfirmReplace(false);
      setPreview(null);
      setMessage('密钥已使用 Windows 本机保护保存。');
      await controller.refresh();
    } catch (error) {
      setMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const clearCredential = async (): Promise<void> => {
    if (!confirmClear) {
      setMessage('删除前请确认，之后需要重新输入密钥。');
      return;
    }
    setBusy(true);
    try {
      const result = await window.rednoteDesktop?.clearCredential({
        confirmation: 'DELETE_CONTENT_AI_API_KEY',
        slot: 'CONTENT_AI_API_KEY',
      });
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      setCredentialInput('');
      setConfirmClear(false);
      setPreview(null);
      setMessage('本地密钥已删除；如需模型能力，请重新输入。');
      await controller.refresh();
    } catch (error) {
      setMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const buildPreview = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.rednoteDesktop?.buildDiagnosticPreview();
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      setPreview(result.value);
      setMessage('基础诊断预览已生成，内容不含密钥和绝对路径。');
    } catch (error) {
      setMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const exportPreview = async (): Promise<void> => {
    if (preview === null) {
      return;
    }
    setBusy(true);
    try {
      const result = await window.rednoteDesktop?.exportDiagnosticReport({
        expectedPreviewHash: preview.hash,
      });
      if (result === undefined || !result.ok) {
        throw result === undefined ? new Error('桌面接口不可用。') : result.error;
      }
      setMessage(`基础诊断报告已导出：${result.value.managedPath}`);
    } catch (error) {
      setMessage(asErrorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  if (controller.state.phase === 'loading') {
    return (
      <div aria-live="polite" className="state-card">
        <span aria-hidden="true" className="loading-mark" />
        <h2>正在读取本地设置</h2>
        <p>不会发送网络请求，也不会验证密钥。</p>
      </div>
    );
  }
  if (controller.state.phase === 'error') {
    return (
      <div className="state-card" role="alert">
        <p className="section-kicker">设置读取失败</p>
        <h2>{controller.state.error.message}</h2>
        <button className="button" onClick={() => void controller.refresh()} type="button">
          重新读取
        </button>
      </div>
    );
  }
  if (controller.state.phase === 'recovery') {
    return (
      <div className="state-card" role="alert">
        <p className="section-kicker">需要恢复</p>
        <h2>本地项目定位记录不可用</h2>
        <p>应用不会覆盖定位记录，也不会自动重建缺失目录。</p>
        <code>
          {controller.state.setup.project.status === 'RECOVERY_REQUIRED'
            ? controller.state.setup.project.errorCode
            : ''}
        </code>
      </div>
    );
  }

  const bundle = controller.state.phase === 'ready' ? controller.state.bundle : null;
  const project =
    controller.state.setup.project.status === 'READY' ? controller.state.setup.project : null;
  const credentialStatus = bundle?.credential.status ?? 'NOT_CONFIGURED';
  const unavailable = bundle?.credential.status === 'UNAVAILABLE';

  return (
    <div className="settings-layout">
      <header className="settings-intro">
        <p className="section-kicker">本地基础 · 设置与凭据</p>
        <h2>{project === null ? '先建立本地项目' : '设置向导与本地凭据引用'}</h2>
        <p>可以先只完成数据目录；中转站、模型和密钥以后再填。尚未进行能力探测。</p>
      </header>

      {message === null ? null : (
        <p aria-live="polite" className="settings-message">
          {message}
        </p>
      )}

      <section className="wizard-step" aria-labelledby="step-data-root">
        <div className="step-number">01</div>
        <div>
          <h3 id="step-data-root">数据目录</h3>
          <p>{project === null ? '尚未配置本地项目。' : `当前目录：${project.displayPath}`}</p>
          {selection === null ? null : (
            <div className="selection-preview">
              <strong>待启用目录</strong>
              <span>{selection.displayPath}</span>
              <label>
                <input
                  checked={confirmRoot}
                  onChange={(event) => setConfirmRoot(event.currentTarget.checked)}
                  type="checkbox"
                />
                我确认启用此目录；旧目录不会被复制、移动或删除
              </label>
            </div>
          )}
          <div className="button-row">
            <button
              className="button"
              disabled={busy}
              onClick={() => void chooseRoot()}
              type="button"
            >
              选择数据目录
            </button>
            {selection === null ? null : (
              <button
                className="button button--primary"
                disabled={busy || !confirmRoot}
                onClick={() => void activateRoot()}
                type="button"
              >
                确认启用
              </button>
            )}
          </div>
        </div>
      </section>

      <fieldset className="wizard-step" disabled={bundle === null || busy}>
        <legend className="sr-only">中转站与模型</legend>
        <div className="step-number">02</div>
        <div className="form-grid">
          <div className="step-heading">
            <h3>中转站与模型</h3>
            <p>协议固定为 OPENAI_COMPATIBLE；只保存配置，不进行 DNS、HTTP 或模型探测。</p>
          </div>
          <label className="field field--wide">
            <span>Base URL（可稍后填写）</span>
            <input
              onChange={(event) => updateField('providerBaseUrl', event.currentTarget.value)}
              placeholder="https://gateway.example/v1"
              value={fields.providerBaseUrl}
            />
          </label>
          {(
            [
              ['researchModel', '研究模型'],
              ['writingModel', '写作模型'],
              ['reviewModel', '审校模型'],
              ['embeddingModel', 'Embedding（可选）'],
              ['imageModel', '图片模型（可选）'],
            ] as const
          ).map(([key, label]) => (
            <label className="field" key={key}>
              <span>{label}</span>
              <input
                onChange={(event) => updateField(key, event.currentTarget.value)}
                value={fields[key]}
              />
            </label>
          ))}
          <p className="capability-note">能力状态：尚未进行能力探测。</p>
        </div>
      </fieldset>

      <fieldset className="wizard-step" disabled={bundle === null || busy || unavailable}>
        <legend className="sr-only">密钥状态</legend>
        <div className="step-number">03</div>
        <div className="form-grid">
          <div className="step-heading">
            <h3>密钥状态</h3>
            <p>
              当前：
              {credentialStatus === 'CONFIGURED'
                ? '已配置'
                : credentialStatus === 'REAUTH_REQUIRED' || credentialStatus === 'CORRUPT'
                  ? '需要重新输入'
                  : unavailable
                    ? '系统保护不可用'
                    : '未配置'}
            </p>
          </div>
          <label className="field field--wide">
            <span>内容 AI API 密钥</span>
            <input
              autoComplete="new-password"
              onChange={(event) => setCredentialInput(event.currentTarget.value)}
              ref={attachCredentialInput}
              type="password"
              value={credentialInput}
            />
          </label>
          {credentialStatus === 'CONFIGURED' ? (
            <label className="check-row">
              <input
                checked={confirmReplace}
                onChange={(event) => setConfirmReplace(event.currentTarget.checked)}
                type="checkbox"
              />
              我明确要替换已保存的密钥
            </label>
          ) : null}
          <div className="button-row">
            <button
              className="button button--primary"
              onClick={() => void saveCredential()}
              type="button"
            >
              {credentialStatus === 'CONFIGURED' ? '替换密钥' : '安全保存密钥'}
            </button>
            <button
              className="button"
              onClick={() => {
                setCredentialInput('');
                if (credentialRef.current !== null) {
                  credentialRef.current.value = '';
                }
              }}
              type="button"
            >
              取消输入
            </button>
          </div>
          {credentialStatus === 'CONFIGURED' ? (
            <div className="danger-zone">
              <label className="check-row">
                <input
                  checked={confirmClear}
                  onChange={(event) => setConfirmClear(event.currentTarget.checked)}
                  type="checkbox"
                />
                我知道删除后需要重新输入密钥
              </label>
              <button
                className="button button--danger"
                onClick={() => void clearCredential()}
                type="button"
              >
                删除本地密钥
              </button>
            </div>
          ) : null}
        </div>
      </fieldset>

      <fieldset className="wizard-step" disabled={bundle === null || busy}>
        <legend className="sr-only">预算</legend>
        <div className="step-number">04</div>
        <div className="form-grid">
          <div className="step-heading">
            <h3>预算</h3>
            <p>美元显示、整数美分保存。本轮不扣费、不触发预算门禁；尚无调用记录。</p>
          </div>
          <label className="field">
            <span>月度预警（美元）</span>
            <input
              inputMode="decimal"
              onChange={(event) => updateField('warning', event.currentTarget.value)}
              value={fields.warning}
            />
          </label>
          <label className="field">
            <span>月度硬上限（美元，最高 100）</span>
            <input
              inputMode="decimal"
              onChange={(event) => updateField('hardLimit', event.currentTarget.value)}
              value={fields.hardLimit}
            />
          </label>
        </div>
      </fieldset>

      <fieldset className="wizard-step" disabled={bundle === null || busy}>
        <legend className="sr-only">账号策略</legend>
        <div className="step-number">05</div>
        <div className="form-grid">
          <div className="step-heading">
            <h3>账号策略</h3>
            <p>账号归属固定 PERSONAL；职业披露默认 DEFERRED。</p>
          </div>
          <label className="field">
            <span>工作名称</span>
            <input
              onChange={(event) => updateField('workingName', event.currentTarget.value)}
              value={fields.workingName}
            />
          </label>
          <label className="field field--wide">
            <span>简介</span>
            <textarea
              onChange={(event) => updateField('bio', event.currentTarget.value)}
              value={fields.bio}
            />
          </label>
          <div className="strategy-summary">
            <strong>默认口吻</strong>
            <span>观点鲜明、短句直接、少量冷幽默</span>
            <strong>内容范围</strong>
            <span>聚焦推理小说；不含偶像、音乐、演唱会、泛娱乐或粉圈</span>
          </div>
        </div>
      </fieldset>

      <section className="wizard-step" aria-labelledby="step-confirm">
        <div className="step-number">06</div>
        <div>
          <h3 id="step-confirm">确认</h3>
          <p>保存只写本地非秘密配置，不会发送测试请求，也不会产生费用。</p>
          <div className="button-row">
            <button
              className="button button--primary"
              disabled={bundle === null || busy || !dirty}
              onClick={() => void saveSettings()}
              type="button"
            >
              保存非秘密设置
            </button>
            <button
              className="button"
              disabled={bundle === null || busy}
              onClick={() => {
                if (bundle !== null) {
                  setFields(fieldsFromBundle(bundle));
                }
                setDirty(false);
                setCredentialInput('');
                setPreview(null);
              }}
              type="button"
            >
              放弃未保存修改
            </button>
          </div>
        </div>
      </section>

      <section className="diagnostic-card" aria-labelledby="diagnostic-title">
        <div>
          <p className="section-kicker">基础诊断报告</p>
          <h3 id="diagnostic-title">显式预览后导出</h3>
          <p>这是单个脱敏 JSON 文件，不是完整备份或 ZIP。</p>
        </div>
        <div className="button-row">
          <button
            className="button"
            disabled={bundle === null || busy}
            onClick={() => void buildPreview()}
            type="button"
          >
            生成预览
          </button>
          <button
            className="button button--primary"
            disabled={preview === null || busy}
            onClick={() => void exportPreview()}
            type="button"
          >
            导出当前预览
          </button>
        </div>
        {preview === null ? null : <pre className="diagnostic-preview">{preview.content}</pre>}
      </section>

      <ProviderCapabilitySettings
        disabled={bundle === null || busy}
        revision={bundle?.settings.revision ?? -1}
      />

      <SearchProviderSettings />

      <FetchPolicySettings />

      <LocalApiSettings />
    </div>
  );
}
