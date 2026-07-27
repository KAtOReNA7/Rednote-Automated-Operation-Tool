import { useEffect } from 'react';

import { NAVIGATION_ITEMS, resolveRoute } from './routes.js';
import { SettingsPage } from './settings-page.js';
import { useDesktopStatus } from './use-desktop-status.js';
import { useHashRoute } from './use-hash-route.js';

const SMOKE_TITLE_PREFIX = '__ISSUE006_SMOKE__:';

function StatusPill({
  state,
}: {
  readonly state: 'error' | 'loading' | 'ready';
}): React.JSX.Element {
  const labels = {
    error: '基础自检不可用',
    loading: '正在检查本地基础设施',
    ready: '本机基础设施正常',
  };
  return (
    <span className={`status-pill status-pill--${state}`}>
      <span aria-hidden="true" className="status-dot" />
      {labels[state]}
    </span>
  );
}

export function App(): React.JSX.Element {
  const routePath = useHashRoute();
  const route = resolveRoute(routePath);
  const desktop = useDesktopStatus();
  const readyDesktop = desktop.phase === 'ready' ? desktop : null;

  useEffect(() => {
    if (window.location.search !== '?smoke=1' || desktop.phase === 'loading') {
      return;
    }
    let active = true;
    const bridge = window.rednoteDesktop;
    if (bridge === undefined) {
      return;
    }
    void Promise.all([
      bridge.getSetupState(),
      bridge.getSettings(),
      bridge.getCredentialStatus({ slot: 'CONTENT_AI_API_KEY' }),
      bridge.getLocalApiStatus(),
      bridge.listLocalApiClients(),
    ]).then(([setup, settings, credential, localApiStatus, localApiClients]) => {
      if (!active) {
        return;
      }
      queueMicrotask(() => {
        const report = {
          appInfo: desktop.phase === 'ready',
          credentialStatus: credential.ok && credential.value.status === 'NOT_CONFIGURED',
          foundation: desktop.phase === 'ready' && desktop.foundation.status === 'ready',
          localApiBridge: localApiStatus.ok && localApiClients.ok,
          navigationCount: document.querySelectorAll('[data-navigation-item]').length,
          preload: window.rednoteDesktop !== undefined,
          renderer: document.querySelector('[data-desktop-shell]') !== null,
          runtimeCapabilities: desktop.phase === 'ready' && desktop.runtime.nodeSqlite,
          settings: settings.ok && settings.value.providerCapability === 'UNPROBED',
          setupState: setup.ok && setup.value.project.status === 'READY',
          windowState: desktop.phase === 'ready',
        };
        document.title = `${SMOKE_TITLE_PREFIX}${encodeURIComponent(JSON.stringify(report))}`;
      });
    });
    return () => {
      active = false;
    };
  }, [desktop]);

  return (
    <div className="desktop-shell" data-desktop-shell>
      <aside className="sidebar">
        <div className="brand">
          <span aria-hidden="true" className="brand-mark">
            谜
          </span>
          <div>
            <p className="brand-name">红笺</p>
            <p className="brand-subtitle">本地运营台</p>
          </div>
        </div>

        <nav aria-label="主要导航" className="navigation">
          {NAVIGATION_ITEMS.map((item) => {
            const active = route?.path === item.path;
            return (
              <a
                aria-current={active ? 'page' : undefined}
                className={active ? 'nav-item nav-item--active' : 'nav-item'}
                data-navigation-item
                href={`#${item.path}`}
                key={item.path}
              >
                <span aria-hidden="true" className="nav-icon">
                  {item.shortLabel}
                </span>
                <span>{item.label}</span>
              </a>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <p>仅在本机运行</p>
          <p>{readyDesktop === null ? '版本读取中' : `版本 ${readyDesktop.appInfo.version}`}</p>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">推理小说内容工作区</p>
            <h1>{route?.label ?? '页面不存在'}</h1>
          </div>
          <StatusPill state={desktop.phase} />
        </header>

        <section className="content-area">
          {desktop.phase === 'loading' ? (
            <div aria-live="polite" className="state-card">
              <span aria-hidden="true" className="loading-mark" />
              <h2>正在准备本地桌面环境</h2>
              <p>正在执行一次只读运行时检查和临时基础设施自检。</p>
            </div>
          ) : route === null ? (
            <div className="state-card">
              <p className="section-kicker">404</p>
              <h2>没有这个本地页面</h2>
              <p>该地址不属于当前桌面壳层。</p>
              <a className="text-link" href="#/overview">
                返回总览
              </a>
            </div>
          ) : desktop.phase === 'error' ? (
            <div className="state-card" role="alert">
              <p className="section-kicker">基础设施状态</p>
              <h2>本地基础自检未完成</h2>
              <p>界面不会继续执行任务，也不会连接任何外部服务。请重新启动应用。</p>
            </div>
          ) : route.path === '/settings' ? (
            <SettingsPage />
          ) : route.path === '/overview' ? (
            <div className="overview-grid">
              <article className="overview-lead">
                <p className="section-kicker">当前里程碑 · Issue 006</p>
                <h2>安全桌面壳层已就绪</h2>
                <p>
                  当前仅提供本地窗口、导航骨架和基础设施健康检查。内容、数据与业务操作尚未接入。
                </p>
              </article>
              <article className="metric-card">
                <p>运行方式</p>
                <strong>Windows 本机</strong>
                <span>不加载远程页面</span>
              </article>
              <article className="metric-card">
                <p>数据库结构</p>
                <strong>v{readyDesktop?.foundation.schemaVersion}</strong>
                <span>临时自检通过</span>
              </article>
              <article className="metric-card">
                <p>本地队列</p>
                <strong>就绪</strong>
                <span>仅完成临时生命周期自检</span>
              </article>
              <article className="runtime-card">
                <div>
                  <p className="section-kicker">运行时</p>
                  <h2>受控的桌面执行边界</h2>
                </div>
                <dl>
                  <div>
                    <dt>Electron</dt>
                    <dd>{readyDesktop?.runtime.electronVersion}</dd>
                  </div>
                  <div>
                    <dt>Chromium</dt>
                    <dd>{readyDesktop?.runtime.chromiumVersion}</dd>
                  </div>
                  <div>
                    <dt>Node.js</dt>
                    <dd>{readyDesktop?.runtime.nodeVersion}</dd>
                  </div>
                </dl>
              </article>
            </div>
          ) : (
            <div className="state-card">
              <p className="section-kicker">{route.label}</p>
              <h2>这里还是一个清晰的占位页</h2>
              <p>{route.description}</p>
              <div className="scope-note">
                <span aria-hidden="true">—</span>
                本轮不会写入业务数据，也不会调用模型或外部平台。
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
