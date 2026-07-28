import type {
  CuratedSearchEntryInput,
  SearchAdapterView,
  SearchStateView,
} from '@mystery-operations/shared';
import { useEffect, useState } from 'react';

function SearchAdapterCard({
  adapter,
  onSaved,
}: {
  readonly adapter: SearchAdapterView;
  readonly onSaved: (state: SearchStateView) => void;
}): React.JSX.Element {
  const [enabled, setEnabled] = useState(adapter.enabled);
  const [maxResults, setMaxResults] = useState(String(adapter.maxResults));
  const [timeoutMs, setTimeoutMs] = useState(String(adapter.timeoutMs));
  const [maxConcurrent, setMaxConcurrent] = useState(
    String(adapter.ratePolicy?.maxConcurrent ?? 1),
  );
  const [minIntervalMs, setMinIntervalMs] = useState(
    String(adapter.ratePolicy?.minIntervalMs ?? 1_000),
  );
  const [maxRequests, setMaxRequests] = useState(
    String(adapter.ratePolicy?.maxRequestsPerWindow ?? 30),
  );
  const [windowMs, setWindowMs] = useState(String(adapter.ratePolicy?.windowMs ?? 60_000));
  const [entries, setEntries] = useState<readonly CuratedSearchEntryInput[]>(
    adapter.curatedEntries,
  );
  const [entryTitle, setEntryTitle] = useState('');
  const [entryUrl, setEntryUrl] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnabled(adapter.enabled);
    setEntries(adapter.curatedEntries);
    setMaxResults(String(adapter.maxResults));
    setTimeoutMs(String(adapter.timeoutMs));
  }, [adapter]);

  const save = async (): Promise<void> => {
    const bridge = window.rednoteDesktop;
    if (bridge?.updateSearchProviderConfig === undefined) {
      setMessage('搜索设置桥不可用。');
      return;
    }
    setBusy(true);
    setMessage('');
    const maximum = Number(maxResults);
    const timeout = Number(timeoutMs);
    const ratePolicy =
      adapter.mode !== 'ACTIVE_REMOTE'
        ? null
        : {
            contractVersion: 'search-rate-policy-v1' as const,
            maxConcurrent: Number(maxConcurrent),
            maxRequestsPerWindow: Number(maxRequests),
            maxResponseBytes: adapter.ratePolicy?.maxResponseBytes ?? 2 * 1024 * 1024,
            maxResults: maximum,
            minIntervalMs: Number(minIntervalMs),
            revision: (adapter.ratePolicy?.revision ?? 0) + 1,
            timeoutMs: timeout,
            windowMs: Number(windowMs),
          };
    const result = await bridge.updateSearchProviderConfig({
      curatedEntries: entries,
      enabled,
      expectedRevision: adapter.settingsRevision,
      maxResults: maximum,
      providerInstanceId: adapter.providerInstanceId,
      ratePolicy,
      timeoutMs: timeout,
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error.message);
      return;
    }
    setMessage('搜索适配器设置已保存到本地。');
    onSaved(result.value);
  };

  const addCuratedEntry = (): void => {
    if (entryTitle.trim() === '' || entryUrl.trim() === '') {
      setMessage('定向来源需要名称和固定 URL 模板。');
      return;
    }
    const entry: CuratedSearchEntryInput = {
      entryId: `curated-${String(entries.length + 1).padStart(3, '0')}`,
      intent: 'BOOK_DISCOVERY',
      languageHint: 'zh-CN',
      title: entryTitle.trim(),
      urlTemplate: entryUrl.trim(),
    };
    setEntries((current) => [...current, entry]);
    setEntryTitle('');
    setEntryUrl('');
    setMessage('定向来源已加入草稿；请保存适配器设置。');
  };

  return (
    <article className="search-adapter-card">
      <div className="search-adapter-heading">
        <div>
          <strong>{adapter.displayName}</strong>
          <small>
            {adapter.kind} · {adapter.mode}
          </small>
        </div>
        <span className={`search-readiness search-readiness--${adapter.readiness.toLowerCase()}`}>
          {adapter.readiness}
        </span>
      </div>
      <dl className="search-facets">
        <div>
          <dt>能力</dt>
          <dd>{adapter.capabilityState}</dd>
        </div>
        <div>
          <dt>限速</dt>
          <dd>{adapter.rateState}</dd>
        </div>
        <div>
          <dt>预算</dt>
          <dd>{adapter.budgetState}</dd>
        </div>
        <div>
          <dt>凭据</dt>
          <dd>{adapter.credentialState}</dd>
        </div>
        <div>
          <dt>Codec</dt>
          <dd>{adapter.codecState}</dd>
        </div>
      </dl>
      <div className="search-config-grid">
        <label className="check-row">
          <input
            checked={enabled}
            disabled={adapter.kind === 'BROWSER_CLIP'}
            onChange={(event) => setEnabled(event.target.checked)}
            type="checkbox"
          />
          启用本地配置
        </label>
        <label className="field">
          最大结果数
          <input
            max="20"
            min="1"
            onChange={(event) => setMaxResults(event.target.value)}
            type="number"
            value={maxResults}
          />
        </label>
        <label className="field">
          超时（毫秒）
          <input
            max="600000"
            min="100"
            onChange={(event) => setTimeoutMs(event.target.value)}
            type="number"
            value={timeoutMs}
          />
        </label>
        {adapter.mode !== 'ACTIVE_REMOTE' ? null : (
          <>
            <label className="field">
              最大并发
              <input
                max="32"
                min="1"
                onChange={(event) => setMaxConcurrent(event.target.value)}
                type="number"
                value={maxConcurrent}
              />
            </label>
            <label className="field">
              最小调用间隔（毫秒）
              <input
                min="0"
                onChange={(event) => setMinIntervalMs(event.target.value)}
                type="number"
                value={minIntervalMs}
              />
            </label>
            <label className="field">
              窗口请求上限
              <input
                min="1"
                onChange={(event) => setMaxRequests(event.target.value)}
                type="number"
                value={maxRequests}
              />
            </label>
            <label className="field">
              窗口长度（毫秒）
              <input
                min="1"
                onChange={(event) => setWindowMs(event.target.value)}
                type="number"
                value={windowMs}
              />
            </label>
          </>
        )}
      </div>
      {adapter.kind !== 'CURATED_SOURCE' ? null : (
        <div className="curated-editor">
          <p>
            定向来源只生成本地入口，不访问 URL。模板必须在查询参数值中使用一个
            {'{query}'} 占位符，主机与路径保持固定。
          </p>
          <div className="search-config-grid">
            <label className="field">
              来源名称
              <input
                maxLength={512}
                onChange={(event) => setEntryTitle(event.target.value)}
                value={entryTitle}
              />
            </label>
            <label className="field">
              固定 URL 模板
              <input
                maxLength={4096}
                onChange={(event) => setEntryUrl(event.target.value)}
                placeholder="https://example.org/search?q={query}"
                value={entryUrl}
              />
            </label>
          </div>
          <button className="button" onClick={addCuratedEntry} type="button">
            加入定向来源草稿
          </button>
          <ul className="curated-list">
            {entries.map((entry, index) => (
              <li key={entry.entryId}>
                <span>{entry.title}</span>
                <button
                  className="button"
                  onClick={() =>
                    setEntries((current) =>
                      current.filter((_item, itemIndex) => itemIndex !== index),
                    )
                  }
                  type="button"
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="search-features">已声明能力：{adapter.features.join('、') || '无'}</p>
      <div className="button-row">
        <button
          className="button button--primary"
          disabled={busy}
          onClick={() => void save()}
          type="button"
        >
          保存搜索设置
        </button>
      </div>
      {message === '' ? null : <p className="capability-note">{message}</p>}
    </article>
  );
}

export function SearchProviderSettings(): React.JSX.Element {
  const [state, setState] = useState<SearchStateView | null>(null);
  const [message, setMessage] = useState('正在读取搜索适配器状态…');

  useEffect(() => {
    const load = async (): Promise<void> => {
      const method = window.rednoteDesktop?.getSearchState;
      if (method === undefined) {
        setMessage('搜索状态桥不可用。');
        return;
      }
      const result = await method();
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setState(result.value);
      setMessage('');
    };
    void load();
  }, []);

  return (
    <section className="search-settings-card" aria-labelledby="search-settings-title">
      <div className="search-settings-heading">
        <div>
          <p className="section-kicker">Unified SearchProvider · Issue 015</p>
          <h3 id="search-settings-title">搜索适配器状态与本地策略</h3>
          <p>这里没有搜索执行框，也不会访问候选网页或调用真实 Search API。</p>
        </div>
        <span className="local-api-state">{state?.overallReadiness ?? 'LOADING'}</span>
      </div>
      {message === '' ? null : <p className="settings-message">{message}</p>}
      {state === null ? null : (
        <>
          <div className="search-boundaries">
            <p>{state.boundaries.discovery}</p>
            <p>{state.boundaries.fetching}</p>
            <p>{state.boundaries.browserClip}</p>
          </div>
          <div className="search-adapter-grid">
            {state.adapters.map((adapter) => (
              <SearchAdapterCard
                adapter={adapter}
                key={adapter.providerInstanceId}
                onSaved={setState}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
