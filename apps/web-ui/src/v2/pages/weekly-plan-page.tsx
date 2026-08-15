import { useEffect, useState } from 'react';

import {
  Button,
  Icon,
  PageHeader,
  StatusPill,
  currentShanghaiWeekIdentity,
  isPlanWeekConsistent,
  nextWeekIdentity,
  useV2Controller,
} from '../components.js';
import { withPersistedWeeklyPlan } from '../mock-provider.js';
import { ProviderActionControl } from '../provider-action-control.js';

const dayOrder = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

function shortDate(value: string): string {
  if (!value.includes('-')) return value;
  const [, month = '', day = ''] = value.split('-');
  return `${String(Number(month))}/${String(Number(day))}`;
}

function shanghaiDateText(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(now);
  const values = Object.fromEntries(
    parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

export function WeeklyPlanPage(): React.JSX.Element {
  const { notify, openDate, session, setSession, setUi, ui } = useV2Controller();
  const { planFilter: filter, planSelectedIds: selectedIds } = ui;
  const currentWeek = currentShanghaiWeekIdentity();
  const nextWeek = nextWeekIdentity(currentWeek);
  const locked = session.planStatus === 'CONFIRMED';
  const planConsistent = isPlanWeekConsistent({
    candidates: session.plan,
    weekKey: session.weekKey,
  });
  const targetWeekKey = nextWeek.weekKey;
  const today = shanghaiDateText();
  const [targetPlan, setTargetPlan] = useState<{
    readonly revision: number;
    readonly weekKey: string;
  } | null>(null);
  useEffect(() => {
    const bridge = window.rednoteV2;
    if (bridge === undefined) return;
    setTargetPlan(null);
    void bridge.readWeeklyPlan({ weekKey: targetWeekKey }).then((result) => {
      if (result.ok)
        setTargetPlan({ revision: result.value.revision, weekKey: result.value.weekKey });
    });
  }, [targetWeekKey]);
  const targetRevision = targetPlan?.weekKey === targetWeekKey ? targetPlan.revision : null;
  const pending = session.plan.filter(({ status }) => status === '待审批');
  const conflicts = session.plan.filter(({ status }) => status === '时间冲突');
  const skipped = session.plan.filter(({ status }) => status === '已跳过');
  const activeByDay = dayOrder.map(
    (day) => session.plan.filter((item) => item.day === day && item.status !== '已跳过').length,
  );
  const lockReasons = [
    ...(session.plan.filter(({ status }) => status !== '已跳过').length === 21
      ? []
      : [
          `还差${Math.max(0, 21 - session.plan.filter(({ status }) => status !== '已跳过').length)}篇`,
        ]),
    ...(activeByDay.every((count) => count === 3) ? [] : ['每天必须各有3篇']),
    ...(pending.length === 0 ? [] : [`${pending.length}篇待确认`]),
    ...(conflicts.length === 0 ? [] : [`${conflicts.length}处冲突`]),
  ];
  const clearSelection = (): void =>
    setUi((current) => ({
      ...current,
      planSelectedIds: [],
      planSelectionAnchorId: '',
    }));
  const reloadAfterConflict = (): void => {
    const bridge = window.rednoteV2;
    if (bridge === undefined) return;
    void bridge.readWeeklyPlan({ weekKey: session.weekKey }).then((latest) => {
      if (latest.ok) setSession((current) => withPersistedWeeklyPlan(current, latest.value));
    });
  };
  const selectPending = (): void => {
    setUi((current) => ({
      ...current,
      planSelectedIds: pending.map(({ id }) => id),
      planSelectionAnchorId: pending.at(-1)?.id ?? '',
    }));
    notify(`已选中 ${pending.length} 篇待确认内容，未自动选择时间冲突项。`);
  };
  const toggleCandidate = (candidateId: string, shiftKey: boolean): void => {
    setUi((current) => {
      const visibleIds = session.plan.filter(({ status }) => visible(status)).map(({ id }) => id);
      if (shiftKey && current.planSelectionAnchorId !== '') {
        const from = visibleIds.indexOf(current.planSelectionAnchorId);
        const to = visibleIds.indexOf(candidateId);
        if (from >= 0 && to >= 0) {
          const range = visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1);
          return {
            ...current,
            planSelectedIds: [...new Set([...current.planSelectedIds, ...range])],
          };
        }
      }
      const selected = current.planSelectedIds.includes(candidateId);
      return {
        ...current,
        planSelectedIds: selected
          ? current.planSelectedIds.filter((id) => id !== candidateId)
          : [...current.planSelectedIds, candidateId],
        planSelectionAnchorId: candidateId,
      };
    });
  };
  const visible = (status: string): boolean =>
    filter === 'all' || (filter === 'pending' ? status === '待审批' : status === '时间冲突');
  const mutateSelection = (action: 'confirm' | 'skip'): void => {
    if (selectedIds.length === 0) {
      notify('请先选择至少一篇内容。');
      return;
    }
    const bridge = window.rednoteV2;
    if (bridge === undefined) {
      notify('本机周计划桥接不可用，未修改计划。');
      return;
    }
    const request = {
      candidateIds: selectedIds,
      expectedRevision: session.planRevision,
      weekKey: session.weekKey,
    };
    const operation =
      action === 'confirm'
        ? bridge.confirmPlanCandidates(request)
        : bridge.skipPlanCandidates(request);
    void operation.then((result) => {
      if (!result.ok) {
        notify(result.error.message);
        if (result.error.code === 'REVISION_CONFLICT') reloadAfterConflict();
        return;
      }
      setSession((current) => withPersistedWeeklyPlan(current, result.value));
      notify(`已${action === 'confirm' ? '确认' : '跳过'} ${selectedIds.length} 篇并保存到本机。`);
      clearSelection();
    });
  };
  const lock = (): void => {
    const bridge = window.rednoteV2;
    if (bridge === undefined) {
      notify('本机周计划桥接不可用，未锁定计划。');
      return;
    }
    void bridge
      .lockWeeklyPlan({ expectedRevision: session.planRevision, weekKey: session.weekKey })
      .then((result) => {
        if (!result.ok) {
          notify(result.error.message);
          return;
        }
        setSession((current) => withPersistedWeeklyPlan(current, result.value));
        notify('计划已锁定并保存到本机。');
        clearSelection();
      });
  };
  const unlock = (): void => {
    const bridge = window.rednoteV2;
    if (bridge === undefined) return notify('本机周计划桥接不可用，未解锁计划。');
    void bridge
      .unlockWeeklyPlan({ expectedRevision: session.planRevision, weekKey: session.weekKey })
      .then((result) => {
        if (!result.ok) return notify(result.error.message);
        setSession((current) => withPersistedWeeklyPlan(current, result.value));
        notify('已派生可调整草稿；原锁定版本保留为历史引用。');
      });
  };
  const openScheduler = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (selectedIds.length === 0) {
      notify('请先选择至少一篇内容。');
      return;
    }
    openDate(event.currentTarget);
  };

  return (
    <div className="v2-page v2-weekly-page">
      <PageHeader
        actions={
          <ProviderActionControl
            disabled={
              window.rednoteV2 !== undefined && (targetRevision === null || !planConsistent)
            }
            disabledReason="正在读取目标周的真实 revision。"
            intent={{
              expectedRevision: targetRevision ?? 0,
              kind: 'WEEKLY_PLAN',
              weekKey: targetWeekKey,
            }}
            label="预览生成下周计划"
            onSuccess={async () => {
              const result = await window.rednoteV2?.readWeeklyPlan({ weekKey: targetWeekKey });
              if (result?.ok === true)
                setSession((current) => withPersistedWeeklyPlan(current, result.value));
            }}
          />
        }
        description={`七日周历支持单篇、批量与 Shift 连续选择；所有时间均为 Asia/Shanghai (UTC+8)。 · 本机 revision ${session.planRevision}`}
        eyebrow={`查看计划周 ${session.weekKey} · 自然当前周 ${currentWeek.weekKey}（${currentWeek.startDate} 至 ${currentWeek.endDate}）`}
        title="本周计划"
      />
      {!planConsistent ? (
        <section className="v2-locked-banner" role="alert">
          <Icon name="warning-circle" />
          <div>
            <strong>本地计划日期与周标识不一致</strong>
            <p>请使用现有日期编辑并保存后再生成；系统不会猜测或覆盖你的计划。</p>
          </div>
        </section>
      ) : null}
      <p className="v2-plan-boundary">
        下周预览目标：{nextWeek.weekKey} · {nextWeek.startDate} 至 {nextWeek.endDate}。
      </p>
      <p className="v2-plan-boundary">本地计划不会自动发布到任何平台。</p>
      {locked ? (
        <section className="v2-locked-banner" role="status">
          <Icon name="check-circle" />
          <div>
            <strong>本周计划已锁定</strong>
            <p>当前为真实只读状态；可解锁调整并重新处理确认、冲突和锁定。</p>
          </div>
          <Button onClick={unlock} tone="quiet">
            解锁调整
          </Button>
        </section>
      ) : null}
      <div className="v2-plan-toolbar">
        <div aria-label="筛选计划" className="v2-segments">
          {(
            [
              ['all', `全部 ${session.plan.length}`],
              ['pending', `待确认 ${pending.length}`],
              ['conflict', `时间冲突 ${conflicts.length}`],
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
          <Button
            disabled={locked || pending.length === 0}
            icon="check-square"
            onClick={selectPending}
            tone="quiet"
          >
            选择待确认
          </Button>
        </div>
      </div>
      <div className="v2-plan-grid">
        <section aria-label="一周内容排程" className="v2-calendar">
          {dayOrder.map((day) => {
            const dayItems = session.plan.filter((item) => item.day === day);
            const date = shortDate(dayItems[0]?.date ?? '');
            return (
              <section className="v2-day" data-today={day === '周日'} key={day}>
                <header>
                  <strong>{day}</strong>
                  <span>{date}</span>
                  {dayItems.some((item) => item.date === today) ? <b>今天</b> : null}
                </header>
                <div>
                  {dayItems
                    .filter((item) => visible(item.status))
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
                            onClick={() => notify(`${item.title}详情尚未进入 R03。`)}
                            type="button"
                          >
                            {item.title}
                          </button>
                          <p>{item.book}</p>
                          <button
                            aria-label={`${selected ? '取消选择' : '选择'} ${item.title}`}
                            aria-pressed={selected}
                            className="v2-select-post"
                            disabled={locked || item.status === '已跳过'}
                            onClick={(event) => toggleCandidate(item.id, event.shiftKey)}
                            type="button"
                          >
                            <Icon name={selected ? 'check-square' : 'square'} size={17} />
                            {selected ? '已选择' : '选择'}
                          </button>
                        </article>
                      );
                    })}
                </div>
                <button className="v2-add-slot" disabled type="button">
                  <Icon name="plus" size={16} />
                  空闲时段
                </button>
              </section>
            );
          })}
        </section>
        <aside className="v2-stack">
          <section className="v2-card v2-side-card">
            <p className="v2-kicker">保持全局视角</p>
            <h2>本周节奏</h2>
            <dl className="v2-facts">
              <div>
                <dt>计划</dt>
                <dd>{session.plan.length} 篇</dd>
              </div>
              <div>
                <dt>待确认</dt>
                <dd className="v2-accent">{pending.length} 篇</dd>
              </div>
              <div>
                <dt>已跳过</dt>
                <dd>{skipped.length} 篇</dd>
              </div>
              <div>
                <dt>空位</dt>
                <dd>{Math.max(0, 21 - session.plan.length + skipped.length)} 个</dd>
              </div>
            </dl>
            {conflicts.length === 0 ? null : (
              <button
                className="v2-conflict"
                onClick={() => setUi((current) => ({ ...current, planFilter: 'conflict' }))}
                type="button"
              >
                <Icon name="warning-circle" />
                <span>
                  <strong>{conflicts.length} 处时间冲突</strong>
                  <small>需要你明确决定</small>
                </span>
                <b>查看</b>
              </button>
            )}
          </section>
          <section className="v2-card v2-side-card v2-quick-actions">
            <p className="v2-kicker">不依赖拖拽</p>
            <h2>快速操作</h2>
            <Button
              disabled={locked || selectedIds.length === 0}
              icon="calendar-blank"
              onClick={openScheduler}
            >
              自由选择日期时间
            </Button>
            <Button disabled={locked || lockReasons.length > 0} onClick={lock} tone="primary">
              锁定本周计划
            </Button>
          </section>
        </aside>
      </div>
      {selectedIds.length === 0 || locked ? null : (
        <section aria-label="批量操作" className="v2-batch-bar">
          <div>
            <Icon name="check-square" />
            <span>
              <strong>已选择 {selectedIds.length} 篇</strong>
              <small>支持 Shift 连续选择</small>
            </span>
          </div>
          <Button icon="calendar-blank" onClick={openScheduler}>
            调整日期
          </Button>
          <Button icon="clock" onClick={openScheduler}>
            调整时间
          </Button>
          <Button onClick={openScheduler}>移动到其他周</Button>
          <Button onClick={() => mutateSelection('skip')}>跳过所选</Button>
          <Button onClick={() => mutateSelection('confirm')} tone="primary">
            确认所选
          </Button>
          <Button onClick={clearSelection} tone="quiet">
            取消选择
          </Button>
        </section>
      )}
      {!locked && lockReasons.length > 0 ? (
        <p className="v2-form-error" role="status">
          锁定前仍需处理：{lockReasons.join('、')}。
        </p>
      ) : null}
    </div>
  );
}
