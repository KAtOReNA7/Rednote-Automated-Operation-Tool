import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button, Icon, PageHeader, useDialog, useV2Controller } from '../components.js';

type MaintenanceBridge = NonNullable<typeof window.rednoteV2>;
type ReadMaintenance = NonNullable<MaintenanceBridge['readMaintenance']>;
type PreviewMaintenance = NonNullable<MaintenanceBridge['previewControlledBackup']>;
type V2MaintenanceView = Extract<
  Awaited<ReturnType<ReadMaintenance>>,
  { readonly ok: true }
>['value'];
type V2MaintenancePreview = Extract<
  Awaited<ReturnType<PreviewMaintenance>>,
  { readonly ok: true }
>['value'];
type ReadDiagnostics = NonNullable<MaintenanceBridge['readLocalDiagnostics']>;
type V2DiagnosticView = Extract<
  Awaited<ReturnType<ReadDiagnostics>>,
  { readonly ok: true }
>['value'];
type BuildDiagnostics = NonNullable<MaintenanceBridge['buildLocalDiagnosticPreview']>;
type V2DiagnosticPreview = Extract<
  Awaited<ReturnType<BuildDiagnostics>>,
  { readonly ok: true }
>['value'];

const capabilityLabel = {
  STALE: '已过期',
  SUPPORTED: '支持',
  TRANSIENT_FAILURE: '暂不可用',
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
  ['persona', 'v2-persona-settings', '账号与文风'],
  ['provider', 'v2-provider-settings', 'AI 服务'],
  ['capabilities', 'v2-provider-capabilities', '能力与确认'],
  ['budget', 'v2-provider-budget', '费用与预算'],
  ['advanced', 'v2-provider-diagnostics', '高级诊断'],
  ['maintenance', 'v2-maintenance', '本地备份与恢复'],
] as const;

const maintenanceStageLabel = {
  BUILDING_STAGING: '写入受控暂存区',
  CANCELLED: '已在安全检查点取消',
  FAILED: '未能完成本地维护操作',
  IDLE: '等待开始',
  PREFLIGHT: '复核维护前置条件',
  ROLLBACK: '已安全回滚',
  SAFETY_UNPROVEN: '无法证明数据安全',
  SUCCESS: '已完成验证',
  SWITCHING: '原子切换本地数据',
  VERIFYING: '校验 manifest 与结果',
} as const;

const preconditionLabel = {
  FAILED: '未通过',
  NOT_CHECKED: '待检查',
  PASSED: '已通过',
} as const;

const diagnosticCategoryLabel = {
  'generated-images': '已生成图片',
  imports: '导入记录',
  photos: '本地图片',
  'source-snapshots': '资料快照',
  'source-screenshots': '资料截图',
} as const;

function formatDiagnosticBytes(bytes: number): string {
  return `${bytes.toLocaleString('zh-CN')} 字节`;
}

function LocalDiagnosticsSettings(): React.JSX.Element {
  const { notify } = useV2Controller();
  const [view, setView] = useState<V2DiagnosticView | null>(null);
  const [preview, setPreview] = useState<V2DiagnosticPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const dialogRef = useDialog(confirmOpen, () => setConfirmOpen(false), returnFocus);
  const load = useCallback(async (): Promise<void> => {
    const result = await window.rednoteV2?.readLocalDiagnostics?.();
    if (result === undefined) return notify('本地诊断桥接不可用。');
    if (!result.ok) return notify(result.error.message);
    setView(result.value);
  }, [notify]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (view?.outcome === 'FAILED_CLEAN' || view?.outcome === 'CLEANUP_UNPROVEN')
      titleRef.current?.focus({ preventScroll: true });
  }, [view?.outcome]);
  useEffect(() => {
    if (view?.stage === 'PREFLIGHT' || view?.stage === 'WRITING' || view?.stage === 'VERIFYING') {
      const timer = window.setInterval(() => void load(), 600);
      return () => window.clearInterval(timer);
    }
    return undefined;
  }, [load, view?.stage]);
  const build = async (): Promise<void> => {
    setBusy(true);
    try {
      const result = await window.rednoteV2?.buildLocalDiagnosticPreview?.();
      if (result === undefined) return notify('本地诊断预览不可用。');
      if (!result.ok) return notify(result.error.message);
      setPreview(result.value);
      setView((current) =>
        current === null ? current : { ...current, outcome: 'IDLE', result: null, stage: 'IDLE' },
      );
    } finally {
      setBusy(false);
    }
  };
  const choose = async (): Promise<void> => {
    if (preview === null) return;
    setBusy(true);
    try {
      const result = await window.rednoteV2?.selectLocalDiagnosticDirectory?.();
      if (result === undefined) return notify('本地目录选择不可用。');
      if (!result.ok) return notify(result.error.message);
      setView(result.value);
      if (result.value.directory === null) return;
      const next = await window.rednoteV2?.previewLocalDiagnosticExport?.({
        directoryToken: result.value.directory.token,
      });
      if (next === undefined) return notify('导出确认预览不可用。');
      if (!next.ok) return notify(next.error.message);
      setPreview(next.value);
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (): Promise<void> => {
    if (preview?.confirmationToken === null || preview === null) return;
    setBusy(true);
    try {
      const result = await window.rednoteV2?.confirmLocalDiagnosticExport?.({
        confirmation: 'CONFIRM_EXPORT_TO_SELECTED_DIRECTORY',
        confirmationToken: preview.confirmationToken,
      });
      if (result === undefined) return notify('本地诊断确认不可用。');
      if (!result.ok) return notify(result.error.message);
      setView(result.value);
      setConfirmOpen(false);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };
  const openResult = async (): Promise<void> => {
    if (view?.result === null || view === null) return;
    const result = await window.rednoteV2?.openLocalDiagnosticResult?.({
      resultToken: view.result.resultToken,
    });
    if (result === undefined) return notify('资源管理器操作不可用。');
    if (!result.ok) return notify(result.error.message);
  };
  const running =
    view?.stage === 'PREFLIGHT' || view?.stage === 'WRITING' || view?.stage === 'VERIFYING';
  return (
    <section className="v2-diagnostic-export" aria-labelledby="v2-local-diagnostic-title">
      <div className="v2-settings-title">
        <Icon name="file-text" size={22} />
        <div>
          <h3 id="v2-local-diagnostic-title" ref={titleRef} tabIndex={-1}>
            本地诊断导出
          </h3>
          <p>先审阅允许导出的脱敏摘要，再选择本地目录并明确确认；系统不会自动上传。</p>
        </div>
      </div>
      {preview === null ? (
        <div className="v2-diagnostic-home">
          <p>诊断只包含版本、运行健康状态和受控文件类别的数量与大小，不包含业务正文或路径。</p>
          <Button disabled={busy || running} onClick={() => void build()} tone="primary">
            预览诊断内容
          </Button>
        </div>
      ) : (
        <div className="v2-diagnostic-preview" aria-live="polite">
          <div>
            <h4>将包含（允许列表）</h4>
            <ul>
              {preview.categories.map((item) => (
                <li key={item.category}>
                  {diagnosticCategoryLabel[item.category as keyof typeof diagnosticCategoryLabel] ??
                    '受控文件类别'}
                  ：{item.itemCount} 项 · {formatDiagnosticBytes(item.estimatedBytes)}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4>明确排除</h4>
            <ul>
              {preview.excluded.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
          <p>估算大小：{formatDiagnosticBytes(preview.estimatedBytes)}。预览不会创建文件。</p>
          <div className="v2-inline-actions">
            <Button disabled={busy || running} onClick={() => void build()}>
              重新生成预览
            </Button>
            <Button disabled={busy || running} onClick={() => void choose()} tone="primary">
              选择导出目录
            </Button>
          </div>
        </div>
      )}
      {view?.directory === undefined || view.directory === null ? null : (
        <p role="status">{view.directory.displayLabel}</p>
      )}
      {preview?.confirmationToken === null || preview === null ? null : (
        <Button
          disabled={busy || running}
          onClick={(event) => {
            setReturnFocus(event.currentTarget);
            setConfirmOpen(true);
          }}
          tone="primary"
        >
          确认导出到所选目录
        </Button>
      )}
      {running ? (
        <section className="v2-diagnostic-progress" role="status" aria-live="polite">
          <strong>本地诊断导出进行中</strong>
          <p>
            当前阶段：
            {view?.stage === 'WRITING'
              ? '写入受控临时文件'
              : view?.stage === 'VERIFYING'
                ? '重新打开并验证 ZIP'
                : '复核预览与目录'}
          </p>
        </section>
      ) : null}
      {view?.outcome === 'SUCCESS' && view.result !== null ? (
        <section className="v2-maintenance-result v2-maintenance-result--success" role="status">
          <h3>诊断包已导出到所选本地目录</h3>
          <p>
            文件：{view.result.fileName} · 大小：{formatDiagnosticBytes(view.result.sizeBytes)} ·
            校验摘要：
            {view.result.summaryHash}
          </p>
          <div className="v2-inline-actions">
            <Button
              onClick={() => {
                void navigator.clipboard
                  ?.writeText(view.result?.fileName ?? '')
                  .catch(() => notify('无法复制文件名；请手动复制显示的文件名。'));
              }}
            >
              复制文件名
            </Button>
            <Button onClick={() => void openResult()}>在资源管理器中显示</Button>
          </div>
        </section>
      ) : null}
      {view?.outcome === 'FAILED_CLEAN' ? (
        <section className="v2-maintenance-result v2-maintenance-result--danger" role="alert">
          <h3>导出未完成，临时文件已清理</h3>
          <p>系统没有生成部分诊断包。</p>
        </section>
      ) : null}
      {view?.outcome === 'CLEANUP_UNPROVEN' ? (
        <section className="v2-maintenance-result v2-maintenance-result--danger" role="alert">
          <h3>无法证明临时文件已清理</h3>
          <p>请检查所选本地目录；系统没有把该状态写成成功。</p>
        </section>
      ) : null}
      {confirmOpen && preview?.confirmationToken !== null
        ? createPortal(
            <div className="v2-overlay v2-maintenance-overlay" role="presentation">
              <div
                aria-labelledby="v2-diagnostic-confirm-title"
                aria-modal="true"
                className="v2-modal v2-maintenance-confirm-dialog"
                ref={dialogRef}
                role="dialog"
              >
                <div className="v2-overlay-head">
                  <div>
                    <p className="v2-kicker">仅本地导出</p>
                    <h2 id="v2-diagnostic-confirm-title">确认导出到所选目录</h2>
                    <p>确认后才会创建固定两文件的本地 ZIP。不会上传、发送或自动保留。</p>
                  </div>
                </div>
                <div className="v2-provider-preview-actions">
                  <Button onClick={() => setConfirmOpen(false)}>返回预览</Button>
                  <Button disabled={busy} onClick={() => void confirm()} tone="primary">
                    确认导出到所选目录
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

function MaintenanceSettings(): React.JSX.Element {
  const { notify } = useV2Controller();
  const [view, setView] = useState<V2MaintenanceView | null>(null);
  const [backupPreview, setBackupPreview] = useState<V2MaintenancePreview | null>(null);
  const [restorePreview, setRestorePreview] = useState<V2MaintenancePreview | null>(null);
  const [restoreDialogOpen, setRestoreDialogOpen] = useState(false);
  const [restoreChecked, setRestoreChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [returnFocus, setReturnFocus] = useState<HTMLElement | null>(null);
  const backupPreflightRef = useRef<HTMLDivElement>(null);
  const closeRestoreDialog = useCallback((): void => {
    setRestoreChecked(false);
    setRestoreDialogOpen(false);
  }, []);
  const restoreDialogRef = useDialog(restoreDialogOpen, closeRestoreDialog, returnFocus);
  useEffect(() => {
    if (!restoreDialogOpen) return;
    restoreDialogRef.current
      ?.querySelector<HTMLElement>('[data-maintenance-cancel]')
      ?.focus({ preventScroll: true });
  }, [restoreDialogOpen, restoreDialogRef]);
  const load = async (): Promise<void> => {
    const result = await window.rednoteV2?.readMaintenance?.();
    if (result === undefined) return notify('本地维护桥接不可用。');
    if (!result.ok) return notify(result.error.message);
    setView(result.value);
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (backupPreview?.backupPreconditions !== null)
      backupPreflightRef.current?.focus({ preventScroll: true });
  }, [backupPreview]);
  const activeOutcome =
    view?.operation === 'BACKUP' ? view.backupOutcome : (view?.restoreOutcome ?? 'IDLE');
  const activeStage =
    view?.operation === 'BACKUP' ? view.backupStage : (view?.restoreStage ?? 'IDLE');
  const running = view !== null && view.operation !== null && activeOutcome === 'IDLE';
  useEffect(() => {
    if (!running) return undefined;
    let mounted = true;
    const poll = async (): Promise<void> => {
      const result = await window.rednoteV2?.readMaintenance?.();
      if (mounted && result?.ok === true) setView(result.value);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 900);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [running]);
  const select = async (operation: 'BACKUP' | 'RESTORE'): Promise<void> => {
    setBusy(true);
    try {
      const result =
        operation === 'BACKUP'
          ? await window.rednoteV2?.selectBackupDirectory?.()
          : await window.rednoteV2?.selectRestoreDirectory?.();
      if (result === undefined) return notify('本地目录选择不可用。');
      if (!result.ok) return notify(result.error.message);
      setView(result.value);
      const token =
        operation === 'BACKUP'
          ? result.value.backupDirectory?.token
          : result.value.restoreDirectory?.token;
      if (operation === 'BACKUP') setBackupPreview(null);
      else {
        setRestorePreview(null);
        setRestoreChecked(false);
      }
      if (token !== undefined) await preview(operation, token);
    } finally {
      setBusy(false);
    }
  };
  const preview = async (operation: 'BACKUP' | 'RESTORE', token: string): Promise<void> => {
    try {
      const result =
        operation === 'BACKUP'
          ? await window.rednoteV2?.previewControlledBackup?.({ directoryToken: token })
          : await window.rednoteV2?.previewControlledRestore?.({ directoryToken: token });
      if (result === undefined) return notify('本地预检不可用。');
      if (!result.ok) return notify(result.error.message);
      if (operation === 'BACKUP') setBackupPreview(result.value);
      else setRestorePreview(result.value);
    } catch {
      notify('本地预检未能完成，请重新选择目录后再试。');
    }
  };
  const confirm = async (operation: 'BACKUP' | 'RESTORE'): Promise<void> => {
    const previewValue = operation === 'BACKUP' ? backupPreview : restorePreview;
    if (previewValue?.confirmationToken === null || previewValue === null) return;
    setBusy(true);
    try {
      const result =
        operation === 'BACKUP'
          ? await window.rednoteV2?.confirmControlledBackup?.({
              confirmation: 'CREATE_CONTROLLED_BACKUP',
              confirmationToken: previewValue.confirmationToken,
            })
          : await window.rednoteV2?.confirmControlledRestore?.({
              confirmation: 'RESTORE_CONTROLLED_BACKUP',
              confirmationToken: previewValue.confirmationToken,
            });
      if (result === undefined) return notify('本地确认不可用。');
      if (!result.ok) return notify(result.error.message);
      setView(result.value);
      if (operation === 'BACKUP') setBackupPreview(null);
      else {
        setRestorePreview(null);
        closeRestoreDialog();
      }
      notify(
        operation === 'BACKUP'
          ? '受控备份已开始；正在显示真实阶段。'
          : '恢复已开始；本地数据已锁定。',
      );
    } finally {
      setBusy(false);
    }
  };
  const requestCancellation = async (): Promise<void> => {
    const result = await window.rednoteV2?.cancelControlledMaintenance?.();
    if (result === undefined) return notify('本地取消桥接不可用。');
    if (!result.ok) return notify(result.error.message);
    setView(result.value);
    if (!result.value.canCancel && !result.value.cancelRequested)
      notify('当前阶段不可中断；系统会继续保持本地维护锁。');
  };
  const backupReady = backupPreview?.canConfirm === true && !view?.maintenanceLocked;
  const restoreReady = restorePreview?.canConfirm === true && !view?.maintenanceLocked;
  const disabled = busy || running || view?.maintenanceLocked === true;
  const result =
    activeOutcome === 'IDLE'
      ? null
      : view?.operation === 'BACKUP'
        ? activeOutcome === 'SUCCESS'
          ? {
              detail:
                view.backupDurability === 'SYNC_REQUESTS_COMPLETED'
                  ? '备份已发布，文件与目录同步请求已完成。'
                  : view.backupDurability === 'DIRECTORY_SYNC_UNAVAILABLE'
                    ? '备份已发布；目录同步能力不可用，物理断电级持久性未声明。'
                    : '备份已发布；发布后的持久性无法完全证明。',
              title: '备份已创建',
              tone: 'success',
            }
          : activeOutcome === 'CANCELLED'
            ? {
                detail: '取消只在核心安全检查点生效；未发布备份。',
                title: '备份已取消',
                tone: 'warning',
              }
            : {
                detail: '未生成可确认的备份结果；系统没有将失败写成成功。',
                title: '备份未创建',
                tone: 'danger',
              }
        : activeOutcome === 'SUCCESS'
          ? {
              detail: '恢复结果已校验；旧根目录保护副本仍被保留。',
              title: '恢复完成',
              tone: 'success',
            }
          : activeOutcome === 'ROLLBACK'
            ? {
                detail: '恢复未完成，旧数据已安全回滚。',
                title: '恢复失败，已安全回滚',
                tone: 'warning',
              }
            : activeOutcome === 'SAFETY_UNPROVEN'
              ? {
                  detail: '停止使用当前数据；应用保持本地数据动作闭锁。',
                  title: '无法证明数据安全',
                  tone: 'danger',
                }
              : activeOutcome === 'CANCELLED'
                ? {
                    detail: '取消在切换前的安全检查点生效，当前数据未被替换。',
                    title: '恢复已取消',
                    tone: 'warning',
                  }
                : {
                    detail: '恢复没有完成；请重新执行只读预检。',
                    title: '恢复未完成',
                    tone: 'danger',
                  };
  return (
    <section className="v2-card v2-settings v2-maintenance-settings" id="v2-maintenance">
      <div className="v2-settings-title">
        <Icon name="file-text" size={24} />
        <div>
          <h2>
            {running
              ? `正在${view?.operation === 'BACKUP' ? '创建本地备份' : '恢复本地数据'}`
              : '本地备份与恢复'}
          </h2>
          <p>目录授权、文件系统与 SQLite 操作只在本机主进程处理；页面不显示实际路径。</p>
        </div>
      </div>
      {running ? (
        <section
          aria-live="polite"
          aria-label="维护执行状态"
          className="v2-maintenance-running"
          role="status"
        >
          <div>
            <p className="v2-kicker">本地维护执行中</p>
            <h3>正在{view?.operation === 'BACKUP' ? '创建备份' : '验证并恢复'}</h3>
            <p>当前阶段：{maintenanceStageLabel[activeStage]}</p>
            <p className="v2-maintenance-stage-list">
              只显示核心已确认的阶段；不显示百分比、剩余时间或模拟进度。
            </p>
            <Button disabled={!view?.canCancel} onClick={() => void requestCancellation()}>
              {view?.cancelRequested ? '已请求安全取消' : '请求在安全检查点取消'}
            </Button>
            <p className="v2-maintenance-hint">
              {view?.canCancel
                ? '取消仅在安全检查点生效。'
                : '当前处于不可中断阶段；取消不会伪装为已完成。'}
            </p>
          </div>
          <aside aria-label="执行锁定说明">
            <h3>执行期间已锁定</h3>
            <p>维护完成前，普通数据操作保持关闭；关闭应用不会被记作成功。</p>
          </aside>
        </section>
      ) : null}
      <section aria-label="创建备份" className="v2-provider-section">
        <h3>备份范围与位置</h3>
        <p>{view?.backupDirectory?.displayLabel ?? '尚未选择本地目录'}</p>
        <div className="v2-inline-actions">
          <Button disabled={disabled} onClick={() => void select('BACKUP')}>
            选择本地目录
          </Button>
          <Button
            disabled={disabled || !backupReady}
            onClick={() => void confirm('BACKUP')}
            tone="primary"
          >
            开始创建备份
          </Button>
        </div>
        <div
          className="v2-maintenance-preflight"
          data-ready={backupReady}
          ref={backupPreflightRef}
          tabIndex={-1}
        >
          <strong>{backupReady ? '目录与预检已通过' : '等待本地预检'}</strong>
          <p>目录、空间、维护锁和写入能力必须全部通过；凭据不会被复制。</p>
          <ul aria-label="备份执行前检查">
            <li>目录：{preconditionLabel[view?.backupPreconditions.directory ?? 'NOT_CHECKED']}</li>
            <li>磁盘空间：{preconditionLabel[view?.backupPreconditions.space ?? 'NOT_CHECKED']}</li>
            <li>
              维护锁：
              {preconditionLabel[view?.backupPreconditions.maintenanceLock ?? 'NOT_CHECKED']}
            </li>
            <li>写入能力：{preconditionLabel[view?.backupPreconditions.write ?? 'NOT_CHECKED']}</li>
          </ul>
          {backupPreview === null ? null : <p role="status">{backupPreview.summary}</p>}
        </div>
      </section>
      <section aria-label="恢复本地备份" className="v2-provider-section">
        <h3>恢复预检</h3>
        <p>{view?.restoreDirectory?.displayLabel ?? '尚未选择备份文件夹'}</p>
        <div className="v2-inline-actions">
          <Button disabled={disabled} onClick={() => void select('RESTORE')}>
            选择备份文件夹
          </Button>
          <Button
            disabled={disabled || !restoreReady}
            onClick={(event) => {
              setReturnFocus(event.currentTarget);
              setRestoreChecked(false);
              setRestoreDialogOpen(true);
            }}
            tone="primary"
          >
            查看恢复确认
          </Button>
        </div>
        {restorePreview === null ? null : <p role="status">{restorePreview.summary}</p>}
      </section>
      {result === null ? null : (
        <section
          className={`v2-maintenance-result v2-maintenance-result--${result.tone}`}
          role={result.tone === 'danger' ? 'alert' : 'status'}
        >
          <h3>{result.title}</h3>
          <p>{result.detail}</p>
        </section>
      )}
      <LocalDiagnosticsSettings />
      {restoreDialogOpen && restorePreview !== null
        ? createPortal(
            <div
              className="v2-overlay v2-maintenance-overlay"
              onMouseDown={closeRestoreDialog}
              role="presentation"
            >
              <div
                aria-describedby="v2-maintenance-restore-description"
                aria-labelledby="v2-maintenance-restore-title"
                aria-modal="true"
                className="v2-modal v2-maintenance-confirm-dialog"
                onMouseDown={(event) => event.stopPropagation()}
                ref={restoreDialogRef}
                role="dialog"
              >
                <div className="v2-overlay-head">
                  <div>
                    <p className="v2-kicker">破坏性本地操作</p>
                    <h2 id="v2-maintenance-restore-title">恢复将替换当前本地数据</h2>
                    <p id="v2-maintenance-restore-description">
                      预检已核对受控备份；恢复会先保护当前数据，再在本地执行验证与原子切换。
                    </p>
                  </div>
                </div>
                <div className="v2-maintenance-confirm-body">
                  <label className="v2-checkbox-row">
                    <input
                      checked={restoreChecked}
                      onChange={(event) => setRestoreChecked(event.target.checked)}
                      type="checkbox"
                    />
                    我已理解：恢复会替换当前本地数据。
                  </label>
                </div>
                <div className="v2-provider-preview-actions">
                  <Button data-maintenance-cancel onClick={closeRestoreDialog}>
                    取消，返回预检
                  </Button>
                  <Button
                    disabled={busy || !restoreChecked || !restorePreview.canConfirm}
                    onClick={() => void confirm('RESTORE')}
                    tone="primary"
                  >
                    确认恢复本地备份
                  </Button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </section>
  );
}

function ProviderSettings({
  activeSection,
  onViewChange,
}: {
  readonly activeSection: string;
  readonly onViewChange: (view: V2ProviderSettingsViewContract) => void;
}): React.JSX.Element {
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
    onViewChange(next);
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
    <section
      className="v2-card v2-settings v2-provider-settings"
      data-section={activeSection}
      id="v2-provider-settings"
    >
      <div className="v2-settings-title">
        <Icon name="sparkle" size={24} />
        <div>
          <h2>AI 服务</h2>
          <p>连接既有本机 Provider、凭据、能力检查与费用账本。</p>
        </div>
      </div>
      {activeSection === 'advanced' && view !== null ? (
        <section className="v2-settings-advanced" id="v2-provider-diagnostics">
          <p className="v2-kicker">高级诊断</p>
          <h2>查看诊断信息</h2>
          <p>仅在排查连接或能力问题时展开；默认保持折叠。</p>
          <article>
            <small>当前结论</small>
            <strong>{probeSummaryLabel[view.capabilityProbe.summaryState]}</strong>
            <span>
              Provider {view.providerConfigured ? '配置完整' : '待配置'} · 凭据
              {credentialLabel[view.credentialState]}
            </span>
          </article>
          <article>
            <h3>连接诊断</h3>
            <dl>
              <div>
                <dt>Provider 配置</dt>
                <dd>{view.providerConfigured ? '完整' : '待配置'}</dd>
              </div>
              <div>
                <dt>凭据状态</dt>
                <dd>{credentialLabel[view.credentialState]}</dd>
              </div>
              <div>
                <dt>结构化文本</dt>
                <dd>{capabilityLabel[view.writing.state]}</dd>
              </div>
              <div>
                <dt>图片生成</dt>
                <dd>{capabilityLabel[view.image?.state ?? 'UNKNOWN']}</dd>
              </div>
              <div>
                <dt>费用上界</dt>
                <dd>{view.accounting.priceReadyForContent ? '可估算' : '未知'}</dd>
              </div>
            </dl>
            <Button onClick={() => void copyDiagnostic()}>复制脱敏诊断摘要</Button>
          </article>
          <aside>
            <strong>隐私说明</strong>
            <p>诊断不包含凭据、完整请求、完整响应或本机绝对路径。</p>
          </aside>
        </section>
      ) : null}
      {loadError !== null ? (
        <div role="alert">
          <p>{loadError}</p>
          <Button onClick={() => void load()}>重试读取 AI 设置</Button>
        </div>
      ) : view === null ? (
        <p role="status">正在读取本机设置；不可用时不会生成模拟结果。</p>
      ) : activeSection === 'advanced' ? null : (
        <>
          <div className="v2-provider-core">
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
              <input
                onChange={(event) => setWritingModel(event.target.value)}
                value={writingModel}
              />
            </label>
            <label className="v2-field">
              <span>图片模型 ID</span>
              <input
                aria-label="图片模型 ID"
                id="v2-provider-image-model"
                onChange={(event) => setImageModel(event.target.value)}
                value={imageModel}
              />
              <small>必须是中转站明确支持 OpenAI Images Generations 接口的模型 ID。</small>
            </label>
            <Button id="v2-save-provider-settings" onClick={() => void save()} tone="primary">
              保存 AI 服务设置
            </Button>
          </div>
          <hr />
          <details className="v2-provider-credential">
            <summary>凭据管理</summary>
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
          </details>
          <hr />
          <section className="v2-provider-capability-section" id="v2-provider-capabilities">
            <h3>R07 所需能力</h3>
            {view.overallState === 'DEGRADED' ? (
              <div className="v2-provider-blockers" role="status">
                <strong>服务状态：部分可用</strong>
                <p>文字能力：{view.textReady ? '可用' : '不可用'}</p>
                <p>
                  {view.image?.state === 'TRANSIENT_FAILURE'
                    ? '图片服务暂不可用（HTTP 503）'
                    : `图片能力：${view.imageReady ? '可用' : '不可用'}`}
                </p>
                <p>图片失败不会阻止周计划、文案与回复建议；不会自动重试或切换模型。</p>
                <div className="v2-inline-actions">
                  <Button
                    onClick={() => {
                      window.location.hash = '/v2/content';
                    }}
                  >
                    继续使用文字功能
                  </Button>
                  <Button
                    onClick={() => {
                      document.getElementById('v2-provider-image-model')?.focus();
                    }}
                  >
                    修改图片模型或服务
                  </Button>
                </div>
              </div>
            ) : null}
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
            <Button
              disabled={probeProgress?.status === 'RUNNING'}
              onClick={() => void previewProbe()}
            >
              {view.image?.state === 'TRANSIENT_FAILURE' && view.textReady
                ? '重试图片能力'
                : '验证 R07 所需能力'}
            </Button>
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
                      receivedContentType={step.receivedContentType ?? 'MISSING'} ·
                      transportVariant=
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
          </section>
          <hr />
          <section className="v2-provider-budget-section" id="v2-provider-budget">
            <h3>费用与预算</h3>
            <p>
              周计划价格：{view.accounting.priceReadyForWeeklyPlan ? '可估算' : '未配置'} ·
              内容价格：{view.accounting.priceReadyForContent ? '可估算' : '未配置'} · 回复价格：
              {view.accounting.priceReadyForReply ? '可估算' : '未配置'}
            </p>
            <p>
              {view.accounting.hardStop ? '本月预算已阻止调用。' : '预算硬上限尚未触发。'}{' '}
              价格不完整时必须逐次明确授权，未知费用不会记为 0。
            </p>
          </section>
        </>
      )}
    </section>
  );
}

export function SettingsPage(): React.JSX.Element {
  const { notify, session, setSession, setUi, ui } = useV2Controller();
  const [activeSection, setActiveSection] = useState('provider');
  const [providerView, setProviderView] = useState<V2ProviderSettingsViewContract | null>(null);
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
          <Button
            icon="check"
            onClick={() => {
              if (activeSection === 'persona') void save();
              else document.getElementById('v2-save-provider-settings')?.click();
            }}
            tone="primary"
          >
            保存更改
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
          {activeSection === 'persona' || activeSection === 'maintenance' ? null : (
            <ProviderSettings activeSection={activeSection} onViewChange={setProviderView} />
          )}
          {activeSection === 'persona' ? (
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
          ) : null}
          {activeSection === 'maintenance' ? <MaintenanceSettings /> : null}
        </div>
        <aside className="v2-settings-aside v2-settings-rail">
          <section className="v2-card v2-settings-rail-card" aria-label="AI 服务状态">
            <Icon name="check-circle" />
            <div>
              <p className="v2-kicker">服务状态</p>
              <h2>{providerView?.providerConfigured ? '已配置' : '待配置'}</h2>
              <p>
                凭据
                {providerView === null ? '待读取' : credentialLabel[providerView.credentialState]} ·
                文字
                {providerView === null ? '待读取' : capabilityLabel[providerView.writing.state]}
              </p>
            </div>
          </section>
          <section className="v2-card v2-settings-rail-card" aria-label="构建版本">
            <Icon name="check-circle" />
            <div>
              <h2>人工确认优先</h2>
              <p>每次生成、审批和平台操作均需由用户明确确认。</p>
            </div>
          </section>
          <section className="v2-card v2-settings-rail-card">
            <Icon name="file-text" />
            <div>
              <h2>本月预算</h2>
              <p>
                {providerView?.accounting.hardStop
                  ? '预算硬上限已阻止调用'
                  : providerView?.accounting.priceReadyForContent
                    ? '内容费用上界可估算'
                    : '价格与预算尚未完整配置'}
              </p>
              <small>
                commit {buildInfo.commit.slice(0, 8)} · 数据 v{buildInfo.v2DataVersion}
              </small>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
