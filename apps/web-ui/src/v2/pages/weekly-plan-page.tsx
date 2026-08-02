import { Button, Icon, PageHeader, StatusPill, useV2Controller } from '../components.js';
import { withPersistedWeeklyPlan } from '../mock-provider.js';
const days = [
  ['周一', '7/27'],
  ['周二', '7/28'],
  ['周三', '7/29'],
  ['周四', '7/30'],
  ['周五', '7/31'],
  ['周六', '8/1'],
  ['周日', '8/2'],
] as const;

export function WeeklyPlanPage(): React.JSX.Element {
  const { notify, openDate, session, setSession, setUi, ui } = useV2Controller();
  const { batchMode, planFilter: filter, planSelectedIds: selectedIds } = ui;
  const selectPending = (): void => {
    setUi((current) => ({
      ...current,
      batchMode: true,
      planSelectedIds: session.plan.filter(({ status }) => status === '待审批').map(({ id }) => id),
    }));
    notify('已严格选中 3 篇待审批内容，时间冲突项未选择。');
  };
  const visible = (status: string): boolean =>
    filter === 'all' || (filter === 'pending' ? status === '待审批' : status === '时间冲突');
  const confirm = (): void => {
    if (selectedIds.length === 0) {
      notify('请先选择内容。');
      return;
    }
    const bridge = window.rednoteV2;
    if (bridge === undefined) {
      setSession((current) => ({
        ...current,
        plan: current.plan.map((item) =>
          selectedIds.includes(item.id) ? { ...item, status: '已确认' } : item,
        ),
      }));
      notify(`已确认 ${selectedIds.length} 篇内容（仅模拟会话）。`);
      setUi((current) => ({ ...current, planSelectedIds: [] }));
      return;
    }
    void bridge
      .confirmPlanCandidates({
        candidateIds: selectedIds,
        expectedRevision: session.planRevision,
        weekKey: session.weekKey,
      })
      .then((result) => {
        if (!result.ok) {
          notify(result.error.message);
          if (result.error.code === 'REVISION_CONFLICT') {
            void bridge.readWeeklyPlan({ weekKey: session.weekKey }).then((latest) => {
              if (latest.ok)
                setSession((current) => withPersistedWeeklyPlan(current, latest.value));
            });
          }
          return;
        }
        setSession((current) => withPersistedWeeklyPlan(current, result.value));
        notify(`已确认 ${selectedIds.length} 篇内容并保存到本机。`);
        setUi((current) => ({ ...current, planSelectedIds: [] }));
      });
  };
  return (
    <div className="v2-page">
      <PageHeader
        actions={
          <>
            <Button
              aria-pressed={batchMode}
              icon="check-square"
              onClick={() => setUi((current) => ({ ...current, batchMode: !current.batchMode }))}
            >
              {batchMode ? '退出批量' : '批量选择'}
            </Button>
            <Button
              icon="sparkle"
              onClick={() => notify('下周计划草案已生成（模拟数据，未调用模型）。')}
              tone="primary"
            >
              生成下周计划
            </Button>
          </>
        }
        description={`21 篇 · 已完成 8 · 待审批 3。周历负责排程，批量工具负责高效调整。 · 本机 revision ${session.planRevision}`}
        eyebrow="7月27日—8月2日"
        title="本周计划"
      />
      <div className="v2-plan-toolbar">
        <div aria-label="筛选计划" className="v2-segments">
          {(
            [
              ['all', '全部'],
              ['pending', '待审批'],
              ['conflict', '时间冲突'],
            ] as const
          ).map(([value, label]) => (
            <button
              data-active={filter === value}
              key={value}
              onClick={() => setUi((current) => ({ ...current, planFilter: value }))}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <div>
          <Button icon="check-square" onClick={selectPending} tone="quiet">
            选择待确认
          </Button>
          <Button
            disabled={selectedIds.length === 0}
            icon="calendar-blank"
            onClick={(event) => openDate(event.currentTarget)}
          >
            调整日期
          </Button>
          <Button disabled={selectedIds.length === 0} icon="check" onClick={confirm} tone="primary">
            确认所选 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
          </Button>
        </div>
      </div>
      <div className="v2-plan-grid">
        <section aria-label="一周内容排程" className="v2-calendar">
          {days.map(([day, date]) => (
            <section className="v2-day" data-today={day === '周日'} key={day}>
              <header>
                <strong>{day}</strong>
                <span>{date}</span>
                {day === '周日' ? <b>今天</b> : null}
              </header>
              <div>
                {session.plan
                  .filter((item) => item.day === day && visible(item.status))
                  .map((item) => {
                    const selected = selectedIds.includes(item.id);
                    return (
                      <article
                        className="v2-post"
                        data-danger={item.status === '时间冲突'}
                        data-selected={selected}
                        key={item.id}
                      >
                        <div>
                          <span>{item.time}</span>
                          <StatusPill status={item.status} />
                        </div>
                        <button
                          onClick={() => notify(`${item.title}详情为模拟数据。`)}
                          type="button"
                        >
                          {item.title}
                        </button>
                        <p>{item.book}</p>
                        {batchMode ? (
                          <button
                            aria-pressed={selected}
                            className="v2-select-post"
                            onClick={() =>
                              setUi((current) => ({
                                ...current,
                                planSelectedIds: selected
                                  ? current.planSelectedIds.filter((id) => id !== item.id)
                                  : [...current.planSelectedIds, item.id],
                              }))
                            }
                            type="button"
                          >
                            <Icon name={selected ? 'check-square' : 'square'} size={17} />
                            {selected ? '已选择' : '选择'}
                          </button>
                        ) : null}
                      </article>
                    );
                  })}
              </div>
              <button
                className="v2-add-slot"
                onClick={() => notify(`${day}新增内容入口仅作模拟展示。`)}
                type="button"
              >
                <Icon name="plus" size={16} />
                添加内容
              </button>
              {day === '周日' ? <small>仍有 2 个空位</small> : null}
            </section>
          ))}
        </section>
        <aside className="v2-card v2-side-card">
          <p className="v2-kicker">保持全局视角</p>
          <h2>本周节奏</h2>
          <dl className="v2-facts">
            <div>
              <dt>计划</dt>
              <dd>21 篇</dd>
            </div>
            <div>
              <dt>已完成</dt>
              <dd>8 篇</dd>
            </div>
            <div>
              <dt>待审批</dt>
              <dd className="v2-accent">3 篇</dd>
            </div>
            <div>
              <dt>空位</dt>
              <dd>周日 2 个</dd>
            </div>
          </dl>
          <button
            className="v2-conflict"
            onClick={() => setUi((current) => ({ ...current, planFilter: 'conflict' }))}
            type="button"
          >
            <Icon name="warning-circle" />
            <span>
              <strong>周五 20:00</strong>
              <small>1 处时间冲突</small>
            </span>
            <b>查看</b>
          </button>
        </aside>
      </div>
    </div>
  );
}
