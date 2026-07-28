import { useEffect, useState } from 'react';

import type { BrowserClipView } from '@mystery-operations/shared';

export function BrowserClipLibrary(): React.JSX.Element {
  const [clips, setClips] = useState<readonly BrowserClipView[]>([]);
  const [selected, setSelected] = useState<BrowserClipView | null>(null);
  const [state, setState] = useState<'error' | 'loading' | 'ready'>('loading');

  useEffect(() => {
    let active = true;
    const bridge = window.rednoteDesktop;
    if (bridge?.listBrowserClips === undefined) {
      setState('error');
      return;
    }
    void bridge.listBrowserClips().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setState('error');
        return;
      }
      setClips(result.value);
      setSelected(result.value[0] ?? null);
      setState('ready');
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <article className="runtime-card" data-browser-clip-library>
      <div>
        <p className="section-kicker">浏览器收藏 · 本地样本</p>
        <h2>收藏样本</h2>
        <p>仅显示你通过 Chrome / Edge 插件主动保存到当前项目的数据。</p>
      </div>
      {state === 'loading' ? <p role="status">正在读取本地样本…</p> : null}
      {state === 'error' ? <p role="alert">本地样本暂时不可用，请确认项目已打开。</p> : null}
      {state === 'ready' && clips.length === 0 ? <p>尚无收藏样本。</p> : null}
      {clips.length > 0 ? (
        <div className="clip-library-grid">
          <ul aria-label="收藏样本列表" className="clip-list">
            {clips.map((clip) => (
              <li key={clip.clipId}>
                <button
                  className="clip-list-button"
                  onClick={() => setSelected(clip)}
                  type="button"
                >
                  <strong>{clip.pageTitle}</strong>
                  <span>{clip.displayHost}</span>
                  <span>
                    {clip.platform} · {clip.capturedAt}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected === null ? null : (
            <section aria-label="收藏样本详情" className="clip-detail">
              <h3>{selected.pageTitle}</h3>
              <dl>
                <div>
                  <dt>规范 URL</dt>
                  <dd>{selected.pageUrl}</dd>
                </div>
                <div>
                  <dt>账号</dt>
                  <dd>{selected.accountName ?? '未填写'}</dd>
                </div>
                <div>
                  <dt>收藏客户端</dt>
                  <dd>{selected.clientLabel ?? '未命名客户端'}</dd>
                </div>
                <div>
                  <dt>发布时间</dt>
                  <dd>{selected.publishedAt ?? '未填写'}</dd>
                </div>
                <div>
                  <dt>标签</dt>
                  <dd>{selected.tags.join('、') || '未填写'}</dd>
                </div>
                <div>
                  <dt>候选</dt>
                  <dd>
                    {selected.candidateId} · LEAD_ONLY / NOT_FETCHED / UNVERIFIED / NOT_A_FACT
                  </dd>
                </div>
              </dl>
              <h4>选中文本</h4>
              <p className="clip-text">{selected.selectedText ?? '未选择文本'}</p>
              <h4>用户备注</h4>
              <p className="clip-text">{selected.userNote ?? '未填写备注'}</p>
              <h4>可见互动数据</h4>
              <p>
                {Object.entries(selected.visibleMetrics)
                  .map(([key, value]) => `${key}: ${value ?? '未填写'}`)
                  .join(' · ')}
              </p>
              {selected.hasScreenshot ? (
                <img
                  alt="用户主动截取的当前可见区域"
                  className="clip-screenshot"
                  src={`rednote://app/clip-screenshot/${selected.clipId}`}
                />
              ) : (
                <p>未保存截图。</p>
              )}
            </section>
          )}
        </div>
      ) : null}
    </article>
  );
}
