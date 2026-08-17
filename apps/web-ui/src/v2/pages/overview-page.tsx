import { Button, Icon, useV2Controller } from '../components.js';
import { planDateWeekKey } from '../mock-provider.js';
import type { V2RouteId } from '../routes.js';

export function OverviewPage(): React.JSX.Element {
  const { navigate, notify, session, setUi, ui } = useV2Controller();
  const currentPlan = session.plan.filter(
    ({ date }) => planDateWeekKey(date, session.weekKey) === session.weekKey,
  );
  const pendingCount = currentPlan.filter(({ status }) => status === '待审批').length;
  const conflictCount = currentPlan.filter(({ status }) => status === '时间冲突').length;
  const interactionCount = session.interactions.length;
  const locked = session.planStatus === 'CONFIRMED';
  const featuredContent = session.content.slice(0, 4);
  const heroContent = featuredContent[0];
  const decisionCount = pendingCount + conflictCount + session.content.length + interactionCount;
  const toggleExceptions = (): void =>
    setUi((current) => ({ ...current, onlyExceptions: !current.onlyExceptions }));
  const decisions: readonly [
    'calendar-blank' | 'file-text' | 'chats-circle',
    string,
    string,
    V2RouteId,
  ][] = [
    [
      'calendar-blank',
      '本周计划',
      conflictCount > 0 ? `${conflictCount} 处冲突需要处理` : `${pendingCount} 篇待确认`,
      'weekly-plan',
    ],
    ['file-text', '内容包', `${session.content.length} 个本地版本`, 'content'],
    ['chats-circle', '评论与私信', `${interactionCount} 条本地互动`, 'interaction'],
  ];

  return (
    <div className="v2-page v2-overview-page">
      <header className="v2-page-header">
        <div>
          <p className="v2-kicker">今日编辑台</p>
          <h1>今天值得关注什么</h1>
          <p>结果、异常和下一步动作都在首屏完成。</p>
        </div>
        <div className="v2-header-actions">
          <button
            aria-checked={ui.onlyExceptions}
            className="v2-switch v2-overview-exception-switch"
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
              notify('已进入本机周计划。');
            }}
            tone="primary"
          >
            生成下周计划
          </Button>
        </div>
      </header>

      <section aria-label="今日运营摘要" className="v2-editorial-lead v2-overview-lead">
        <article
          className="v2-feature-hero v2-overview-hero"
          data-has-content={heroContent !== undefined}
        >
          <div className="v2-overview-hero-copy">
            <p className="v2-kicker">本周编辑精选</p>
            <h2>{locked ? '让计划像一张专辑，形成连续的内容节奏' : '先完成本周最重要的决定'}</h2>
            <p>
              {currentPlan.length} 篇计划保存在本机；{pendingCount} 篇待确认
              {conflictCount > 0 ? `，${conflictCount} 处时间冲突需要处理` : '，当前没有时间冲突'}。
            </p>
            <Button icon="arrow-right" onClick={() => navigate('weekly-plan')} tone="primary">
              查看本周计划
            </Button>
          </div>
          <div className="v2-overview-feature-card">
            <small>本周主打</small>
            <strong title={heroContent?.book ?? '等待首份内容'}>
              {heroContent?.book ?? '等待首份内容'}
            </strong>
            <span>{heroContent?.title ?? '完成周计划后形成本周内容主线'}</span>
          </div>
        </article>

        <section className="v2-card v2-today-decisions">
          <header>
            <div>
              <h2>今天需要你决定</h2>
            </div>
            <span>{decisionCount}</span>
          </header>
          {decisions.map(([icon, title, detail, destination]) => (
            <button key={title} onClick={() => navigate(destination)} type="button">
              <span className="v2-round-icon">
                <Icon name={icon} />
              </span>
              <span>
                <strong>{title}</strong>
                <small>{detail}</small>
              </span>
              <Icon name="caret-right" size={17} />
            </button>
          ))}
        </section>
      </section>

      <section className="v2-featured-section v2-overview-shelf-section">
        <header className="v2-section-head">
          <div>
            <h2>当前内容</h2>
          </div>
          <button onClick={() => navigate('content')} type="button">
            查看全部 <Icon name="arrow-right" size={15} />
          </button>
        </header>
        <div className="v2-featured-row v2-overview-shelf-row">
          {featuredContent.length === 0 ? (
            <section className="v2-card v2-editorial-empty">
              <Icon name="file-text" size={24} />
              <div>
                <strong>内容包尚未生成</strong>
                <p>完成并锁定周计划后，可在内容页按需生成本地内容包。</p>
              </div>
            </section>
          ) : (
            <div className="v2-featured-grid">
              {featuredContent.map((item, index) => (
                <button
                  data-tone={index % 4}
                  key={item.id}
                  onClick={() => navigate('content')}
                  type="button"
                >
                  <img alt="" src={item.cover} />
                  <span>
                    <strong>{item.book}</strong>
                    <small>{item.title}</small>
                    <em>{item.status}</em>
                  </span>
                </button>
              ))}
              {Array.from({ length: Math.max(0, 4 - featuredContent.length) }, (_, index) => (
                <button
                  className="v2-featured-empty-slot"
                  key={`empty-${index}`}
                  onClick={() => navigate('content')}
                  type="button"
                >
                  <Icon name="plus" size={18} />
                  <span>
                    <strong>等待下一份内容</strong>
                    <small>从已锁定计划生成</small>
                    <em>未生成</em>
                  </span>
                </button>
              ))}
            </div>
          )}
          <section className="v2-week-performance">
            <p className="v2-kicker">近期表现</p>
            {session.metrics.length === 0 ? (
              <div>
                <strong>暂无真实指标</strong>
                <p>录入已发布内容的表现后，这里会显示真实汇总。</p>
              </div>
            ) : (
              <div>
                {session.metrics.slice(0, 3).map((metric) => (
                  <span key={metric.label}>
                    <small>{metric.label}</small>
                    <strong>{metric.value}</strong>
                  </span>
                ))}
              </div>
            )}
            <button onClick={() => navigate('review')} type="button">
              查看数据复盘 <Icon name="arrow-right" size={14} />
            </button>
          </section>
        </div>
      </section>
    </div>
  );
}
