import { Button, Icon, useV2Controller, type ReviewItem } from '../components.js';
import { planDateWeekKey } from '../mock-provider.js';
import type { V2RouteId } from '../routes.js';

const reviews: readonly ReviewItem[] = [
  { kind: '内容', reason: '标题需要你确认，避免提前揭示凶手', title: '《莫格街凶杀案》' },
  { kind: '排程', reason: '建议发布时间与另一篇冲突', title: '《黄色房间的秘密》' },
  { kind: '互动', reason: '对方问题信息不足，建议先追问', title: '一条私信回复' },
];

export function OverviewPage(): React.JSX.Element {
  const { navigate, notify, openDrawer, session, setUi, ui } = useV2Controller();
  const currentPlan = session.plan.filter(
    ({ date }) => planDateWeekKey(date, session.weekKey) === session.weekKey,
  );
  const pendingCount = currentPlan.filter(({ status }) => status === '待审批').length;
  const conflictCount = currentPlan.filter(({ status }) => status === '时间冲突').length;
  const skippedCount = currentPlan.filter(({ status }) => status === '已跳过').length;
  const locked = session.planStatus === 'CONFIRMED';
  const emptySlots = Math.max(0, 23 - currentPlan.length + skippedCount);
  const activeReviews = reviews.filter(({ kind }) => kind !== '排程' || conflictCount > 0);
  const toggleExceptions = (): void =>
    setUi((current) => ({ ...current, onlyExceptions: !current.onlyExceptions }));
  return (
    <div className="v2-page">
      <header className="v2-page-header">
        <div>
          <p className="v2-kicker">7月27日—8月2日</p>
          <h1>总览</h1>
          <p>普通内容已折叠，先处理需要你决定的事项。</p>
        </div>
        <div className="v2-header-actions">
          <button
            aria-checked={ui.onlyExceptions}
            className="v2-switch"
            onClick={toggleExceptions}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleExceptions();
              }
            }}
            role="switch"
            type="button"
          >
            <span>只看异常</span>
            <i aria-hidden="true" />
          </button>
          <Button
            icon="sparkle"
            onClick={() => {
              navigate('weekly-plan');
              notify('已进入本机周计划；计划行为会持久化，模型调用为 0。');
            }}
            tone="primary"
          >
            生成下周计划
          </Button>
        </div>
      </header>
      <div className="v2-overview-grid">
        <div className="v2-stack">
          <section aria-label="需要处理" className="v2-card v2-queue">
            {[
              [
                'calendar-blank',
                '计划待确认',
                String(pendingCount),
                locked
                  ? `计划已锁定 · ${currentPlan.length} 篇 · revision ${session.planRevision}`
                  : `${currentPlan.length} 篇 · ${conflictCount} 处冲突 · ${emptySlots} 个空位`,
                locked ? '查看只读计划' : pendingCount > 0 ? '处理本周计划' : '锁定本周计划',
                'weekly-plan',
              ],
              ['file-text', '内容待确认', '3', '本周有 3 篇内容需要你确认', '批量通过', 'content'],
              [
                'chats-circle',
                '互动待回复',
                '8',
                '评论 6 条 · 私信 2 条；确认后请在官方端手动发送',
                '确认回复建议',
                'interaction',
              ],
            ].map(([icon, title, count, description, action, destination]) => (
              <article className="v2-queue-row" key={title}>
                <span className="v2-round-icon">
                  <Icon name={icon as 'calendar-blank'} />
                </span>
                <div>
                  <h2>
                    {title} <b>{count}</b>
                  </h2>
                  <p>{description}</p>
                </div>
                <Button onClick={() => navigate(destination as V2RouteId)} tone="primary">
                  {action}
                </Button>
                <Icon name="caret-right" />
              </article>
            ))}
          </section>
          {!ui.onlyExceptions ? (
            <section aria-expanded={ui.normalExpanded} className="v2-card v2-collapsed">
              <button
                onClick={() =>
                  setUi((current) => ({ ...current, normalExpanded: !current.normalExpanded }))
                }
                type="button"
              >
                <Icon name={ui.normalExpanded ? 'caret-up' : 'caret-down'} />
                <span>
                  <strong>普通内容 18 篇</strong>
                  <small>
                    {ui.normalExpanded ? '结构与表达检查均无异常' : '已折叠，不需要逐篇处理'}
                  </small>
                </span>
                <b>{ui.normalExpanded ? '收起' : '展开查看'}</b>
              </button>
              {ui.normalExpanded ? (
                <div>
                  <p>普通内容目前无需你处理。</p>
                  <Button onClick={() => navigate('content')}>前往内容页</Button>
                </div>
              ) : null}
            </section>
          ) : null}
          <section className="v2-card v2-review-list">
            <header>
              <div>
                <p className="v2-kicker">只列出需要判断的地方</p>
                <h2>重点复核</h2>
              </div>
              <span>{activeReviews.length}</span>
            </header>
            {activeReviews.map((item) => (
              <button
                key={item.title}
                onClick={(event) => openDrawer(item, event.currentTarget)}
                type="button"
              >
                <em>{item.kind}</em>
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.reason}</small>
                </span>
                <b>查看</b>
              </button>
            ))}
          </section>
        </div>
        <aside aria-label="运营摘要" className="v2-stack">
          <section className="v2-card v2-side-card">
            <p className="v2-kicker">{locked ? '计划已锁定' : '本机计划实时同步'}</p>
            <h2>本周节奏</h2>
            <dl className="v2-facts">
              <div>
                <dt>计划</dt>
                <dd>{currentPlan.length} 篇</dd>
              </div>
              <div>
                <dt>待确认</dt>
                <dd className="v2-accent">{pendingCount} 篇</dd>
              </div>
              <div>
                <dt>空位</dt>
                <dd>{emptySlots} 个</dd>
              </div>
            </dl>
          </section>
          <section className="v2-card v2-side-card">
            <div className="v2-section-head">
              <div>
                <p className="v2-kicker">7月27日—8月2日</p>
                <h2>近期表现</h2>
              </div>
              <button onClick={() => navigate('review')} type="button">
                查看复盘
              </button>
            </div>
            <div className="v2-metrics">
              {([] as typeof session.metrics).map((metric) => (
                <div key={metric.label}>
                  <span>{metric.label}</span>
                  <strong>{metric.value}</strong>
                  <small>↗ {metric.change}</small>
                </div>
              ))}
            </div>
          </section>
          <section className="v2-card v2-side-card">
            <p className="v2-kicker">3 个值得关注的方向</p>
            <h2>近期机会</h2>
            <div className="v2-opportunities">
              {([] as typeof session.opportunities).map((item) => {
                const saved = ui.savedOpportunityIds.includes(item.id);
                return (
                  <article key={item.id}>
                    <Icon name="sparkle" size={17} />
                    <div>
                      <h3>{item.title}</h3>
                      <p>{item.reason}</p>
                      <small>{item.book}</small>
                    </div>
                    <button
                      aria-pressed={saved}
                      onClick={() => {
                        setUi((current) => ({
                          ...current,
                          savedOpportunityIds: saved
                            ? current.savedOpportunityIds.filter((id) => id !== item.id)
                            : [...current.savedOpportunityIds, item.id],
                        }));
                        notify(`${saved ? '已移出' : '已加入'}模拟计划：${item.title}`);
                      }}
                      type="button"
                    >
                      {saved ? '移出计划' : '加入计划'}
                    </button>
                  </article>
                );
              })}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
