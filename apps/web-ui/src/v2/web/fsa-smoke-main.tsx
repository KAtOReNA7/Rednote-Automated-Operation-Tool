import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { ErrorBoundary } from '../../error-boundary.js';
import { WebRepositoryError } from './contracts.js';
import { BrowserLocalFolderPort, queryReadWritePermission } from './folder-port.js';
import {
  loadWorkspaceHandle,
  saveWorkspaceHandle,
  type StoredWorkspaceHandle,
} from './handle-store.js';
import { BrowserWorkspaceRepository, NavigatorWorkspaceLock } from './repository.js';
import { WebButton as Button, WebStatusPill as StatusPill } from './ui.js';

interface SmokeFact {
  readonly detail: string;
  readonly label: string;
}

type SmokeState =
  | { readonly kind: 'idle'; readonly remembered: StoredWorkspaceHandle | null }
  | { readonly kind: 'running'; readonly remembered: StoredWorkspaceHandle | null }
  | { readonly facts: readonly SmokeFact[]; readonly kind: 'pass' }
  | { readonly kind: 'unsupported' }
  | {
      readonly kind: 'failed';
      readonly message: string;
      readonly remembered: StoredWorkspaceHandle | null;
    };

function safeMessage(error: unknown): string {
  if (error instanceof WebRepositoryError) return `${error.code}：${error.message}`;
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return '目录权限被拒绝；未创建或覆盖任何文件。';
  }
  return '真实目录验证未完成；未创建或覆盖未知文件。';
}

async function verifyHandle(
  handle: FileSystemDirectoryHandle,
  expectedWorkspaceId?: string,
): Promise<{ readonly facts: readonly SmokeFact[]; readonly stored: StoredWorkspaceHandle }> {
  const permission = await queryReadWritePermission(handle);
  if (permission !== 'granted') throw new DOMException('permission denied', 'NotAllowedError');
  const folder = new BrowserLocalFolderPort(handle);
  const repository = new BrowserWorkspaceRepository(folder, { lock: new NavigatorWorkspaceLock() });
  const loaded = await repository.connect(expectedWorkspaceId);
  const marker = await folder.read('rednote-workspace.json');
  const indexPath = `state/index-${loaded.generation % 2 === 0 ? 'b' : 'a'}.json`;
  const index = await folder.read(indexPath);
  const snapshot = await folder.read(loaded.index.snapshotPath);
  const reopened = await repository.load(loaded.state.workspaceId);
  if (
    marker === null ||
    index === null ||
    snapshot === null ||
    reopened.generation !== loaded.generation
  ) {
    throw new WebRepositoryError(
      'RECOVERY_FAILED',
      'repository',
      '重新读取未得到同一有效 generation。',
    );
  }
  return {
    facts: Object.freeze([
      { detail: 'Chrome/Edge 原生 showDirectoryPicker', label: '真实目录句柄' },
      { detail: `${handle.name} · ${loaded.state.workspaceId.slice(0, 12)}`, label: '工作区身份' },
      { detail: `rednote-workspace.json · ${marker.byteLength} bytes`, label: '严格 marker' },
      { detail: `${indexPath} · generation ${loaded.generation}`, label: '双槽 index' },
      {
        detail: `${loaded.index.snapshotPath} · ${snapshot.byteLength} bytes`,
        label: '不可变 snapshot',
      },
      { detail: `${loaded.index.sha256.slice(0, 12)} · schema v1`, label: 'readback / SHA-256' },
      { detail: `generation ${reopened.generation}`, label: '关闭后重新读取' },
    ]),
    stored: { directoryName: handle.name, handle, workspaceId: loaded.state.workspaceId },
  };
}

function FsaSmokeApp(): React.JSX.Element {
  const [state, setState] = useState<SmokeState>({ kind: 'idle', remembered: null });
  useEffect(() => {
    if (typeof window.showDirectoryPicker !== 'function') {
      setState({ kind: 'unsupported' });
      return;
    }
    let active = true;
    void loadWorkspaceHandle()
      .then(async (remembered) => {
        if (!active) return;
        if (remembered === null) return setState({ kind: 'idle', remembered: null });
        if ((await queryReadWritePermission(remembered.handle)) !== 'granted') {
          return setState({ kind: 'idle', remembered });
        }
        const result = await verifyHandle(remembered.handle, remembered.workspaceId);
        if (active) setState({ facts: result.facts, kind: 'pass' });
      })
      .catch((error: unknown) => {
        if (active) setState({ kind: 'failed', message: safeMessage(error), remembered: null });
      });
    return () => {
      active = false;
    };
  }, []);

  const run = async (): Promise<void> => {
    if (window.showDirectoryPicker === undefined) return;
    const remembered = state.kind === 'idle' || state.kind === 'failed' ? state.remembered : null;
    setState({ kind: 'running', remembered });
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
      const result = await verifyHandle(handle, remembered?.workspaceId);
      await saveWorkspaceHandle(result.stored);
      setState({ facts: result.facts, kind: 'pass' });
    } catch (error) {
      setState({ kind: 'failed', message: safeMessage(error), remembered });
    }
  };

  return (
    <main className="web-connect-shell">
      <section aria-labelledby="fsa-title" className="v2-card web-connect-card">
        <p className="v2-kicker">W1 · 用户权限门禁</p>
        <h1 id="fsa-title">真实本地文件夹验收</h1>
        <p>
          请选择不含真实数据的空测试目录。此页面使用浏览器原生目录句柄，不调用模型、网络或平台。
        </p>
        {state.kind === 'unsupported' ? (
          <p className="web-inline-error" role="alert">
            当前浏览器不支持 File System Access API；请使用最新版 Chrome 或 Edge。
          </p>
        ) : null}
        {state.kind === 'failed' ? (
          <p aria-live="polite" className="web-inline-error" role="status">
            {state.message}
          </p>
        ) : null}
        {state.kind === 'pass' ? (
          <div aria-live="polite" className="web-diagnostics">
            <StatusPill status="全部通过" />
            <dl>
              {state.facts.map((fact) => (
                <div key={fact.label}>
                  <dt>{fact.label}</dt>
                  <dd>
                    <strong>PASS</strong> · {fact.detail}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ) : (
          <Button
            disabled={state.kind === 'running' || state.kind === 'unsupported'}
            icon="books"
            onClick={() => void run()}
            tone="primary"
          >
            {state.kind === 'running'
              ? '正在验证…'
              : state.kind === 'idle' && state.remembered !== null
                ? '重新连接原测试目录'
                : '选择空测试目录并验证'}
          </Button>
        )}
        <p>刷新页面后应继续显示全部 PASS；若浏览器要求权限，请点击“重新连接原测试目录”。</p>
      </section>
    </main>
  );
}

const root = document.querySelector('#fsa-smoke-root');
if (root === null) throw new Error('FSA smoke root is unavailable.');
// Reuse the production artifact inspector's established test-entry sentinel.
root.setAttribute('data-artifact-exclusion-sentinel', '__V2_R01_SMOKE__');
createRoot(root).render(
  <ErrorBoundary>
    <FsaSmokeApp />
  </ErrorBoundary>,
);
