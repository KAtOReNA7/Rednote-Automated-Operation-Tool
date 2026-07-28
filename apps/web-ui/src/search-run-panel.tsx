import type { SearchStateView } from '@mystery-operations/shared';
import { useEffect, useState } from 'react';

export function SearchRunPanel(): React.JSX.Element {
  const [state, setState] = useState<SearchStateView | null>(null);

  useEffect(() => {
    const load = async (): Promise<void> => {
      const method = window.rednoteDesktop?.getSearchState;
      if (method === undefined) return;
      const result = await method();
      if (result.ok) setState(result.value);
    };
    void load();
  }, []);

  if (state === null) return <></>;
  return (
    <section className="accounting-card" aria-labelledby="search-runs-title">
      <div className="accounting-card-heading">
        <div>
          <p className="section-kicker">SearchRun · metadata only</p>
          <h3 id="search-runs-title">搜索运行摘要</h3>
          <p>仅显示状态和计数；不显示查询、预览、完整 URL、endpoint 或秘密。</p>
        </div>
        <span className="local-api-state">{state.overallReadiness}</span>
      </div>
      {state.recentRuns.length === 0 ? (
        <p className="empty-note">尚无 SearchRun；Issue 015 不会自动创建搜索任务。</p>
      ) : (
        <div className="capability-table-wrap">
          <table className="capability-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>状态</th>
                <th>候选</th>
                <th>拒绝</th>
                <th>重复</th>
                <th>错误</th>
              </tr>
            </thead>
            <tbody>
              {state.recentRuns.map((run) => (
                <tr key={run.searchRunId}>
                  <td>{run.providerInstanceId}</td>
                  <td>{run.status}</td>
                  <td>{run.candidateCount}</td>
                  <td>{run.rejectedCount}</td>
                  <td>{run.duplicateCount}</td>
                  <td>{run.stableError ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
