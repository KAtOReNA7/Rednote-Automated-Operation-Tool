import { useEffect, useState } from 'react';

import type { FetchStateView } from '@mystery-operations/shared';

export function FetchRunPanel(): React.JSX.Element {
  const [state, setState] = useState<FetchStateView | null>(null);

  useEffect(() => {
    let active = true;
    void window.rednoteDesktop?.getFetchState?.().then((result) => {
      if (active && result.ok) setState(result.value);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section aria-labelledby="fetch-runs-title" className="runtime-card">
      <div>
        <p className="section-kicker">Fetch V1</p>
        <h2 id="fetch-runs-title">受控页面任务</h2>
        <p>仅显示有限运行元数据；不显示网址 query、正文、HTML、header、DNS 或内部路径。</p>
      </div>
      {state === null || state.recentRuns.length === 0 ? (
        <p>尚无抓取运行。Issue 016 不会自动入队。</p>
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>阶段</th>
                <th>候选</th>
                <th>Host</th>
                <th>MIME / Charset</th>
                <th>Bytes</th>
                <th>Redirect / Redaction / Requests</th>
                <th>文档</th>
                <th>稳定错误</th>
              </tr>
            </thead>
            <tbody>
              {state.recentRuns.map((run) => (
                <tr key={run.fetchRunId}>
                  <td>{run.stage}</td>
                  <td>{run.candidateId}</td>
                  <td>{run.displayHost}</td>
                  <td>
                    {run.mimeType ?? '—'} / {run.charset ?? '—'}
                  </td>
                  <td>{run.receivedBytes}</td>
                  <td>
                    {run.redirectCount} / {run.redactionCount} / {run.externalRequestCount}
                  </td>
                  <td>{run.documentSaved ? '已保存' : '—'}</td>
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
