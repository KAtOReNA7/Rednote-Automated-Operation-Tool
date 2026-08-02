import { Button, Icon, PageHeader, useV2Controller } from '../components.js';

export function ReviewPage(): React.JSX.Element {
  const { notify, session, setSession } = useV2Controller();
  const decide = (id: string, status: 'ACCEPTED' | 'REJECTED'): void => {
    setSession((current) => ({
      ...current,
      recommendations: current.recommendations.map((item) =>
        item.id === id ? { ...item, status } : item,
      ),
    }));
    notify(`${status === 'ACCEPTED' ? '已采纳' : '已拒绝'}模拟策略建议。`);
  };
  return (
    <div className="v2-page">
      <PageHeader
        actions={
          <Button onClick={() => notify('指标更新尚未接入；当前为固定模拟数据。')} tone="primary">
            更新指标（未接入）
          </Button>
        }
        description="用可解释的表现数据形成下周建议，不执行真实数据导入。"
        eyebrow="最近 4 周 · 模拟数据"
        title="数据复盘"
      />
      <section className="v2-card v2-side-card">
        <p className="v2-kicker">7月27日—8月2日</p>
        <h2>近期表现</h2>
        <div className="v2-metrics">
          {session.metrics.map((metric) => (
            <div key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>↗ {metric.change}</small>
            </div>
          ))}
        </div>
      </section>
      <div className="v2-review-grid">
        <section className="v2-card v2-dashboard">
          <p className="v2-kicker">按内容类型</p>
          <h2>哪些内容更有效</h2>
          {[
            ['密室拆解', 84, '收藏率 14.8%'],
            ['经典书单', 72, '关注转化 6.1%'],
            ['人物分析', 58, '评论率 3.4%'],
            ['冷知识短评', 46, '完读率 41%'],
          ].map(([label, value, note]) => (
            <div className="v2-performance" key={label}>
              <span>{label}</span>
              <progress aria-label={`${label}相对表现 ${value}`} max="100" value={Number(value)} />
              <strong>{note}</strong>
            </div>
          ))}
        </section>
        <section className="v2-card v2-dashboard">
          <p className="v2-kicker">可采纳、可拒绝</p>
          <h2>下周策略建议</h2>
          {session.recommendations.map((item) => (
            <article className="v2-recommendation" key={item.id}>
              <Icon name="sparkle" size={18} />
              <div>
                <h3>{item.title}</h3>
                <p>{item.reason}</p>
                <span>{item.action}</span>
              </div>
              {item.status === 'PENDING' ? (
                <div>
                  <Button onClick={() => decide(item.id, 'ACCEPTED')} tone="quiet">
                    采纳
                  </Button>
                  <Button onClick={() => decide(item.id, 'REJECTED')} tone="quiet">
                    拒绝
                  </Button>
                </div>
              ) : (
                <b>{item.status === 'ACCEPTED' ? '已采纳' : '已拒绝'}</b>
              )}
            </article>
          ))}
        </section>
      </div>
    </div>
  );
}
