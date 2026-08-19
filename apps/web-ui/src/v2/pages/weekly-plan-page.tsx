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
  weekIdentity,
  weekKeyForDate,
} from '../components.js';
import { withPersistedWeeklyPlan } from '../mock-provider.js';
import { ProviderActionControl } from '../provider-action-control.js';

const dayOrder = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const;

interface TargetPlanValue {
  readonly brief: V2WeeklyPlanContract['brief'];
  readonly revision: number;
  readonly weekKey: string;
}

type TargetPlanState =
  | { readonly status: 'loading'; readonly weekKey: string }
  | { readonly message: string; readonly status: 'error'; readonly weekKey: string }
  | {
      readonly plan: TargetPlanValue;
      readonly source: 'read' | 'saved';
      readonly status: 'ready';
      readonly weekKey: string;
    };

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
  const expectedPlanWeek = weekIdentity(session.weekKey);
  const mismatchedCandidates = session.plan.filter(
    (candidate) => !isPlanWeekConsistent({ candidates: [candidate], weekKey: session.weekKey }),
  );
  const planConsistent = isPlanWeekConsistent({
    candidates: session.plan,
    weekKey: session.weekKey,
  });
  const targetWeekKey = nextWeek.weekKey;
  const today = shanghaiDateText();
  const [focusedDay, setFocusedDay] = useState<(typeof dayOrder)[number]>(() => {
    const current = dayOrder.find((day) =>
      session.plan.some((item) => item.day === day && item.date === today),
    );
    return current ?? '周一';
  });
  const [targetReadAttempt, setTargetReadAttempt] = useState(0);
  const [targetPlanState, setTargetPlanState] = useState<TargetPlanState>({
    status: 'loading',
    weekKey: targetWeekKey,
  });
  const [briefDraft, setBriefDraft] = useState('');
  const [feedbackDetails, setFeedbackDetails] = useState('');
  const [feedbackReason, setFeedbackReason] =
    useState<V2PlanFeedbackReasonContract>('TOPIC_MISMATCH');
  const [replacementDraft, setReplacementDraft] = useState<V2PlanCandidateShapeContract | null>(
    null,
  );
  useEffect(() => {
    const bridge = window.rednoteV2;
    let current = true;
    setTargetPlanState({ status: 'loading', weekKey: targetWeekKey });
    if (bridge === undefined) {
      setTargetPlanState({
        message: '本机周计划桥接不可用。',
        status: 'error',
        weekKey: targetWeekKey,
      });
      return () => {
        current = false;
      };
    }
    void bridge
      .readWeeklyPlan({ weekKey: targetWeekKey })
      .then((result) => {
        if (!current) return;
        if (!result.ok) {
          setTargetPlanState({
            message: result.error.message,
            status: 'error',
            weekKey: targetWeekKey,
          });
          return;
        }
        if (result.value.weekKey !== targetWeekKey) {
          setTargetPlanState({
            message: `返回的目标周为 ${result.value.weekKey}，与 ${targetWeekKey} 不一致。`,
            status: 'error',
            weekKey: targetWeekKey,
          });
          return;
        }
        const plan = {
          brief: result.value.brief,
          revision: result.value.revision,
          weekKey: result.value.weekKey,
        };
        setTargetPlanState({ plan, source: 'read', status: 'ready', weekKey: targetWeekKey });
        setBriefDraft(result.value.brief.text);
      })
      .catch(() => {
        if (!current) return;
        setTargetPlanState({
          message: '目标周读取异常，请重试。',
          status: 'error',
          weekKey: targetWeekKey,
        });
      });
    return () => {
      current = false;
    };
  }, [targetReadAttempt, targetWeekKey]);
  const targetPlan = targetPlanState.status === 'ready' ? targetPlanState.plan : null;
  const targetRevision = targetPlan?.revision ?? null;
  const selectedCandidate =
    selectedIds.length === 1 ? session.plan.find(({ id }) => id === selectedIds[0]) : undefined;
  const latestFeedback = [...session.planItemFeedback]
    .reverse()
    .find(
      ({ candidateId, status }) =>
        candidateId === selectedCandidate?.id && ['RECORDED', 'CANDIDATE_READY'].includes(status),
    );
  useEffect(() => {
    setReplacementDraft(latestFeedback?.candidate ?? null);
  }, [latestFeedback?.feedbackId, latestFeedback?.status]);
  const pending = session.plan.filter(({ status }) => status === '待审批');
  const conflicts = session.plan.filter(({ status }) => status === '时间冲突');
  const skipped = session.plan.filter(({ status }) => status === '已跳过');
  const activeByDay = dayOrder.map(
    (day) => session.plan.filter((item) => item.day === day && item.status !== '已跳过').length,
  );
  const lockReasons = [
    ...(pending.length === 0 ? [] : [`${pending.length}篇待确认`]),
    ...(conflicts.length === 0 ? [] : [`${conflicts.length}处冲突`]),
  ];
  const softTargetWarnings = dayOrder.flatMap((day, index) =>
    activeByDay[index] === 3 ? [] : [`${day}当前 ${activeByDay[index] ?? 0} 篇，建议目标 3 篇`],
  );
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
    const firstPendingDay = pending[0]?.day;
    if (dayOrder.includes(firstPendingDay as (typeof dayOrder)[number]))
      setFocusedDay(firstPendingDay as (typeof dayOrder)[number]);
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
  const unlock = async (): Promise<boolean> => {
    const bridge = window.rednoteV2;
    if (bridge === undefined) {
      notify('本机周计划桥接不可用，未解锁计划。');
      return false;
    }
    const result = await bridge.unlockWeeklyPlan({
      expectedRevision: session.planRevision,
      weekKey: session.weekKey,
    });
    if (!result.ok) {
      notify(result.error.message);
      return false;
    }
    setSession((current) => withPersistedWeeklyPlan(current, result.value));
    notify('已派生可调整草稿；原锁定版本保留为历史引用。');
    return true;
  };
  const openScheduler = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (selectedIds.length === 0) {
      notify('请先选择至少一篇内容。');
      return;
    }
    openDate(event.currentTarget);
  };
  const repairCandidateDate = async (
    event: React.MouseEvent<HTMLButtonElement>,
    candidate: (typeof session.plan)[number],
  ): Promise<void> => {
    const trigger = event.currentTarget;
    if (locked && !(await unlock())) return;
    setFocusedDay(candidate.day as (typeof dayOrder)[number]);
    setUi((current) => ({
      ...current,
      planSelectedIds: [candidate.id],
      planSelectionAnchorId: candidate.id,
    }));
    openDate(trigger, [candidate.id]);
  };
  const saveBrief = async (): Promise<void> => {
    if (targetPlan === null || window.rednoteV2 === undefined)
      return notify('目标周尚未读取完成，未保存 Brief。');
    const result = await window.rednoteV2.saveWeeklyPlanningBrief({
      briefText: briefDraft,
      expectedRevision: targetPlan.revision,
      weekKey: targetWeekKey,
    });
    if (!result.ok) return notify(result.error.message);
    const plan = {
      brief: result.value.brief,
      revision: result.value.revision,
      weekKey: result.value.weekKey,
    };
    setTargetPlanState({ plan, source: 'saved', status: 'ready', weekKey: targetWeekKey });
    notify('目标周 Brief 已保存到本机。');
  };
  const recordFeedback = async (): Promise<void> => {
    if (selectedCandidate === undefined || window.rednoteV2 === undefined)
      return notify('请只选择一个计划项。');
    const result = await window.rednoteV2.recordPlanItemFeedback({
      candidateId: selectedCandidate.id,
      details: feedbackDetails,
      expectedRevision: session.planRevision,
      reason: feedbackReason,
      weekKey: session.weekKey,
    });
    if (!result.ok) return notify(result.error.message);
    setSession((current) => withPersistedWeeklyPlan(current, result.value));
    notify('不满意原因已保存；当前计划项未被修改。');
  };
  const finishReplacement = async (adopt: boolean): Promise<void> => {
    if (latestFeedback === undefined || window.rednoteV2 === undefined) return;
    const result = adopt
      ? replacementDraft === null
        ? null
        : await window.rednoteV2.adoptPlanItemReplacement({
            candidate: replacementDraft,
            expectedRevision: session.planRevision,
            feedbackId: latestFeedback.feedbackId,
            weekKey: session.weekKey,
          })
      : await window.rednoteV2.dismissPlanItemReplacement({
          expectedRevision: session.planRevision,
          feedbackId: latestFeedback.feedbackId,
          weekKey: session.weekKey,
        });
    if (result === null) return notify('替换候选不完整，未采用。');
    if (!result.ok) return notify(result.error.message);
    setSession((current) => withPersistedWeeklyPlan(current, result.value));
    notify(adopt ? '已采用当前替换候选，并保留反馈轨迹。' : '已取消替换，原计划项保持不变。');
  };

  const targetDisabledReason = !planConsistent
    ? '当前计划日期与周标识不一致，请先修正。'
    : targetPlanState.status === 'loading'
      ? `正在读取目标周 ${targetWeekKey}…`
      : targetPlanState.status === 'error'
        ? '目标周读取失败，请重试'
        : undefined;

  return (
    <div
      className="v2-page v2-weekly-page"
      data-selection-active={selectedIds.length > 0 && !locked}
    >
      <PageHeader
        actions={
          <ProviderActionControl
            disabled={
              window.rednoteV2 !== undefined && (targetRevision === null || !planConsistent)
            }
            disabledReason={targetDisabledReason}
            intent={{
              briefRevision: targetPlan?.brief.revision ?? 0,
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
            presentation="dialog"
          />
        }
        description={`${currentWeek.startDate}—${currentWeek.endDate} · Asia/Shanghai · 本机 revision ${session.planRevision}`}
        eyebrow="编辑日历"
        title="本周计划"
      />
      {!planConsistent ? (
        <section
          aria-labelledby="v2-plan-mismatch-title"
          className="v2-card v2-plan-mismatch"
          role="alert"
        >
          <header>
            <Icon name="warning-circle" />
            <div>
              <strong id="v2-plan-mismatch-title">本地计划日期与周标识不一致</strong>
              <p>请逐项使用现有日期编辑完成修正；系统不会猜测或覆盖你的计划。</p>
            </div>
          </header>
          <ul>
            {mismatchedCandidates.map((candidate) => {
              const actualWeek = /^\d{4}-\d{2}-\d{2}$/u.test(candidate.date)
                ? weekKeyForDate(candidate.date)
                : '日期格式无效';
              return (
                <li key={candidate.id}>
                  <div>
                    <strong>{candidate.title}</strong>
                    <p>
                      当前 {candidate.date} · 实际 {actualWeek}
                    </p>
                    <small>
                      期望 {session.weekKey} · {expectedPlanWeek.startDate} 至{' '}
                      {expectedPlanWeek.endDate}
                    </small>
                  </div>
                  <Button onClick={(event) => void repairCandidateDate(event, candidate)}>
                    修正此项日期
                  </Button>
                </li>
              );
            })}
          </ul>
          <div className="v2-plan-mismatch-summary" role="status">
            {mismatchedCandidates.length} 项待修正；全部完成后才能预览下周计划。
          </div>
        </section>
      ) : null}
      <section className="v2-weekly-context v2-weekly-meta" aria-label="计划边界说明">
        <p className="v2-plan-boundary">
          下周预览目标：{nextWeek.weekKey} · {nextWeek.startDate} 至 {nextWeek.endDate}。
          Asia/Shanghai (UTC+8)。
        </p>
        <p className="v2-plan-boundary">本地计划不会自动发布到任何平台。</p>
      </section>
      <section className="v2-card v2-weekly-brief" aria-label="目标周内容重点">
        <div>
          <p className="v2-kicker">目标周 Brief · {targetWeekKey}</p>
          <h2>先说明下周最想讲什么</h2>
          <p>保存后会绑定目标周与 Brief revision，并随生成预览一起确认。</p>
        </div>
        <label className="v2-field">
          <span>下周内容重点（可留空）</span>
          <textarea
            onChange={(event) => setBriefDraft(event.target.value)}
            rows={3}
            value={briefDraft}
          />
        </label>
        <Button
          disabled={targetPlan === null || briefDraft === targetPlan.brief.text}
          onClick={() => void saveBrief()}
        >
          保存目标周 Brief
        </Button>
        <div
          className="v2-target-plan-state"
          data-status={targetPlanState.status}
          role={targetPlanState.status === 'error' ? 'alert' : 'status'}
        >
          {targetPlanState.status === 'loading' ? (
            <span>正在读取目标周 {targetWeekKey}…</span>
          ) : targetPlanState.status === 'error' ? (
            <>
              <span>目标周读取失败：{targetPlanState.message}</span>
              <Button onClick={() => setTargetReadAttempt((attempt) => attempt + 1)} tone="quiet">
                重试读取
              </Button>
            </>
          ) : targetPlanState.source === 'saved' ? (
            <span>
              已保存到 {targetWeekKey} · revision {targetPlanState.plan.revision} · Brief revision{' '}
              {targetPlanState.plan.brief.revision}
            </span>
          ) : (
            <span>
              已读取 {targetWeekKey} · 计划 revision {targetPlanState.plan.revision} · Brief
              revision {targetPlanState.plan.brief.revision}
            </span>
          )}
        </div>
      </section>
      {locked && planConsistent ? (
        <section className="v2-locked-banner" role="status">
          <Icon name="check-circle" />
          <div>
            <strong>本周计划已锁定</strong>
            <p>当前为真实只读状态；可解锁调整并重新处理确认、冲突和锁定。</p>
          </div>
          <Button onClick={() => void unlock()} tone="quiet">
            解锁调整
          </Button>
        </section>
      ) : null}
      <section aria-label="选择查看日期" className="v2-week-strip v2-weekly-date-ribbon">
        {dayOrder.map((day) => {
          const dayItems = session.plan.filter((item) => item.day === day);
          const visibleItems = dayItems.filter((item) => visible(item.status));
          const date = shortDate(dayItems[0]?.date ?? '');
          const attentionCount = dayItems.filter(
            ({ status }) => status === '待审批' || status === '时间冲突',
          ).length;
          return (
            <button
              aria-pressed={focusedDay === day}
              data-attention={attentionCount > 0}
              data-today={dayItems.some((item) => item.date === today)}
              key={day}
              onClick={() => setFocusedDay(day)}
              type="button"
            >
              <span>{day}</span>
              <strong>{date}</strong>
              <small>
                {visibleItems.length} 篇{attentionCount > 0 ? ` · ${attentionCount} 待处理` : ''}
              </small>
            </button>
          );
        })}
      </section>
      <div className="v2-plan-grid v2-weekly-stage">
        <section aria-label="一周内容排程" className="v2-day-focus v2-weekly-day-stage">
          <header>
            <div>
              <p className="v2-kicker">当前查看</p>
              <h2>
                {focusedDay} ·{' '}
                {shortDate(session.plan.find((item) => item.day === focusedDay)?.date ?? '')}
              </h2>
            </div>
            <span>
              {
                session.plan.filter((item) => item.day === focusedDay && visible(item.status))
                  .length
              }{' '}
              篇内容
            </span>
          </header>
          <div className="v2-plan-toolbar v2-weekly-inline-filters">
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
                  onClick={() => {
                    setUi((current) => ({ ...current, planFilter: value }));
                    const firstMatch = session.plan.find(({ status }) =>
                      value === 'all'
                        ? true
                        : value === 'pending'
                          ? status === '待审批'
                          : status === '时间冲突',
                    );
                    if (dayOrder.includes(firstMatch?.day as (typeof dayOrder)[number]))
                      setFocusedDay(firstMatch?.day as (typeof dayOrder)[number]);
                  }}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="v2-day-focus-list">
            {session.plan
              .filter((item) => item.day === focusedDay && visible(item.status))
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
                      <time>{item.time}</time>
                      <StatusPill status={item.status} />
                    </div>
                    <button onClick={() => notify(`${item.title}详情尚未进入 R03。`)} type="button">
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
            {session.plan.filter((item) => item.day === focusedDay && visible(item.status))
              .length === 0 ? (
              <div className="v2-day-focus-empty">
                <Icon name="calendar-blank" size={24} />
                <strong>当前筛选下没有内容</strong>
                <p>切换上方日期，或返回“全部”查看本周安排。</p>
              </div>
            ) : null}
          </div>
          <button className="v2-add-slot" disabled type="button">
            <Icon name="plus" size={16} />
            空闲时段
          </button>
        </section>
        <aside aria-label="本周节奏和批量操作" className="v2-stack v2-weekly-rail">
          <section className="v2-card v2-side-card v2-rhythm-card">
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
              disabled={locked || pending.length === 0}
              icon="check-square"
              onClick={selectPending}
              tone="quiet"
            >
              选择待确认
            </Button>
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
            {softTargetWarnings.length === 0 ? null : (
              <p className="v2-soft-target" role="status">
                每天 3 篇是建议目标，不是锁定门禁。{softTargetWarnings.join('；')}。
              </p>
            )}
          </section>
          {selectedCandidate === undefined || locked ? null : (
            <section className="v2-card v2-side-card v2-item-feedback">
              <p className="v2-kicker">仅当前计划项</p>
              <h2>哪里不满意？</h2>
              <select
                onChange={(event) =>
                  setFeedbackReason(event.target.value as V2PlanFeedbackReasonContract)
                }
                value={feedbackReason}
              >
                <option value="TOPIC_MISMATCH">选题不匹配</option>
                <option value="REPEATED_ANGLE">角度重复</option>
                <option value="NOT_WEEKLY_FOCUS">不符合本周重点</option>
                <option value="TIME_UNSUITABLE">发布时间不合适</option>
                <option value="OTHER">其他</option>
              </select>
              <textarea
                aria-label="补充反馈"
                onChange={(event) => setFeedbackDetails(event.target.value)}
                placeholder="补充说明（可选）"
                rows={3}
                value={feedbackDetails}
              />
              {latestFeedback === undefined ? (
                <Button onClick={() => void recordFeedback()}>保存反馈</Button>
              ) : latestFeedback.status === 'RECORDED' ? (
                <>
                  <div className="v2-feedback-saved" role="status">
                    <strong>反馈已保存，当前计划未修改</strong>
                    <p>下一步可以预览重新生成当前项；只有确认执行时才可能调用模型。</p>
                  </div>
                  <ProviderActionControl
                    intent={{
                      expectedRevision: session.planRevision,
                      feedbackId: latestFeedback.feedbackId,
                      kind: 'PLAN_ITEM_REPLACEMENT',
                      weekKey: session.weekKey,
                    }}
                    label="预览重新生成当前项"
                    onSuccess={async () => {
                      const result = await window.rednoteV2?.readWeeklyPlan({
                        weekKey: session.weekKey,
                      });
                      if (result?.ok === true)
                        setSession((current) => withPersistedWeeklyPlan(current, result.value));
                    }}
                    presentation="dialog"
                  />
                </>
              ) : replacementDraft === null ? null : (
                <div className="v2-replacement-candidate">
                  <strong>替换候选（尚未覆盖）</strong>
                  <input
                    aria-label="替换候选标题"
                    onChange={(event) =>
                      setReplacementDraft({ ...replacementDraft, title: event.target.value })
                    }
                    value={replacementDraft.title}
                  />
                  <input
                    aria-label="替换候选图书"
                    onChange={(event) =>
                      setReplacementDraft({ ...replacementDraft, book: event.target.value })
                    }
                    value={replacementDraft.book}
                  />
                  <div>
                    <input
                      aria-label="替换候选日期"
                      onChange={(event) =>
                        setReplacementDraft({ ...replacementDraft, date: event.target.value })
                      }
                      type="date"
                      value={replacementDraft.date}
                    />
                    <input
                      aria-label="替换候选时间"
                      onChange={(event) =>
                        setReplacementDraft({ ...replacementDraft, time: event.target.value })
                      }
                      type="time"
                      value={replacementDraft.time}
                    />
                  </div>
                  <Button onClick={() => void finishReplacement(false)}>取消替换</Button>
                  <Button onClick={() => void finishReplacement(true)} tone="primary">
                    采用候选
                  </Button>
                </div>
              )}
            </section>
          )}
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
            调整发布时间
          </Button>
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
