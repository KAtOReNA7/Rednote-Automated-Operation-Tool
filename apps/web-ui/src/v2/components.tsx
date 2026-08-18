import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import iconSpriteUrl from './assets/icons/phosphor-v2-subset.svg';
import {
  planDateWeekKey,
  type RendererPlanRescheduleFields,
  type RendererPlanRescheduleMode,
  type RendererPlanReschedulePreview,
  type V2Session,
} from './mock-provider.js';
import { V2_ROUTES, toV2Hash, type V2RouteId } from './routes.js';

export interface WeekIdentity {
  readonly endDate: string;
  readonly startDate: string;
  readonly weekKey: string;
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function weekKeyForDate(date: string): string {
  const target = new Date(`${date}T00:00:00Z`);
  target.setUTCDate(target.getUTCDate() + 3 - ((target.getUTCDay() + 6) % 7));
  const first = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  first.setUTCDate(first.getUTCDate() + 3 - ((first.getUTCDay() + 6) % 7));
  const week = 1 + Math.round((target.getTime() - first.getTime()) / 604_800_000);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function weekIdentity(weekKey: string): WeekIdentity {
  const [, yearText, weekText] = /^(\d{4})-W(\d{2})$/u.exec(weekKey) ?? [];
  const year = Number(yearText);
  const week = Number(weekText);
  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53)
    throw new Error('Invalid ISO week key.');
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(januaryFourth);
  monday.setUTCDate(
    januaryFourth.getUTCDate() - ((januaryFourth.getUTCDay() + 6) % 7) + (week - 1) * 7,
  );
  const thursday = new Date(monday);
  thursday.setUTCDate(monday.getUTCDate() + 3);
  if (weekKeyForDate(isoDate(thursday)) !== weekKey) throw new Error('Invalid ISO week key.');
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);
  return Object.freeze({ endDate: isoDate(sunday), startDate: isoDate(monday), weekKey });
}

export function currentShanghaiWeekIdentity(now = new Date()): WeekIdentity {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
  }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? '';
  return weekIdentity(weekKeyForDate(`${part('year')}-${part('month')}-${part('day')}`));
}

export function nextWeekIdentity(identity: WeekIdentity): WeekIdentity {
  const monday = new Date(`${identity.startDate}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() + 7);
  return weekIdentity(weekKeyForDate(isoDate(monday)));
}

export function isPlanWeekConsistent(plan: {
  readonly weekKey: string;
  readonly candidates: readonly { readonly date: string }[];
}): boolean {
  return plan.candidates.every(
    ({ date }) => /^\d{4}-\d{2}-\d{2}$/u.test(date) && weekKeyForDate(date) === plan.weekKey,
  );
}

export type PlanFilter = 'all' | 'pending' | 'conflict';
export interface ReviewItem {
  readonly kind: '内容' | '排程' | '互动';
  readonly reason: string;
  readonly title: string;
}
export interface V2UiState {
  readonly activeContentId: string;
  readonly activeInteractionId: string;
  readonly contentSelectedIds: readonly string[];
  readonly interactionSelectedIds: readonly string[];
  readonly interactionTab: '评论' | '私信';
  readonly normalExpanded: boolean;
  readonly onlyExceptions: boolean;
  readonly planFilter: PlanFilter;
  readonly planSelectionAnchorId: string;
  readonly planSelectedIds: readonly string[];
  readonly personaErrors: readonly string[];
  readonly savedOpportunityIds: readonly string[];
}
export interface V2Controller {
  readonly navigate: (route: V2RouteId) => void;
  readonly notify: (message: string) => void;
  readonly openDate: (trigger: HTMLElement) => void;
  readonly openDrawer: (item: ReviewItem, trigger: HTMLElement) => void;
  readonly session: V2Session;
  readonly setSession: Dispatch<SetStateAction<V2Session>>;
  readonly setUi: Dispatch<SetStateAction<V2UiState>>;
  readonly ui: V2UiState;
}
export const V2ControllerContext = createContext<V2Controller | null>(null);
export function useV2Controller(): V2Controller {
  const value = useContext(V2ControllerContext);
  if (value === null) throw new Error('V2 controller is unavailable.');
  return value;
}

export type IconName =
  | 'arrow-right'
  | 'bookmark-simple'
  | 'books'
  | 'calendar-blank'
  | 'caret-down'
  | 'caret-right'
  | 'caret-up'
  | 'chart-line-up'
  | 'chats-circle'
  | 'check'
  | 'check-circle'
  | 'check-square'
  | 'clock'
  | 'export'
  | 'file-text'
  | 'gear-six'
  | 'house'
  | 'image-square'
  | 'magnifying-glass'
  | 'paper-plane-tilt'
  | 'pencil-simple'
  | 'plus'
  | 'sparkle'
  | 'square'
  | 'tag'
  | 'user-circle'
  | 'warning-circle'
  | 'x';

export function Icon({
  name,
  size = 20,
}: {
  readonly name: IconName;
  readonly size?: number;
}): React.JSX.Element {
  return (
    <svg aria-hidden="true" className="v2-icon" height={size} width={size}>
      <use href={`${iconSpriteUrl}#${name}`} />
    </svg>
  );
}

export function Button({
  children,
  icon,
  tone = 'secondary',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  readonly icon?: IconName;
  readonly tone?: 'primary' | 'secondary' | 'quiet';
}): React.JSX.Element {
  return (
    <button className={`v2-button v2-button--${tone}`} type="button" {...props}>
      {icon === undefined ? null : <Icon name={icon} size={18} />}
      <span>{children}</span>
    </button>
  );
}

export function AppFrame({
  activeRoute,
  children,
  notify,
}: {
  readonly activeRoute: V2RouteId;
  readonly children: ReactNode;
  readonly notify: (message: string) => void;
}): React.JSX.Element {
  const { session } = useV2Controller();
  const [providerStatus, setProviderStatus] = useState<
    'BLOCKED' | 'CONFIGURE' | 'DEGRADED' | 'READY' | 'UNAVAILABLE' | 'VERIFY'
  >(window.rednoteV2 === undefined ? 'UNAVAILABLE' : 'CONFIGURE');
  useEffect(() => {
    const bridge = window.rednoteV2;
    if (bridge === undefined) return;
    if (bridge.readProviderSettings === undefined) return setProviderStatus('CONFIGURE');
    void bridge.readProviderSettings().then((result) => {
      if (!result.ok) return setProviderStatus('CONFIGURE');
      const settings = result.value;
      setProviderStatus(
        settings.overallState === 'READY'
          ? 'READY'
          : settings.overallState === 'DEGRADED'
            ? 'DEGRADED'
            : settings.providerConfigured && settings.credentialState === 'CONFIGURED'
              ? settings.textReady ||
                settings.imageReady ||
                settings.capabilityProbe.steps.some(
                  (step) => step.diagnosticCode === 'AUTHENTICATION_REJECTED',
                )
                ? 'BLOCKED'
                : 'VERIFY'
              : 'CONFIGURE',
      );
    });
  }, [activeRoute]);
  return (
    <div className="v2-shell" data-v2-mock={window.rednoteV2 === undefined} data-v2-shell>
      <aside aria-label="主导航" className="v2-sidebar">
        <a className="v2-side-brand" href={toV2Hash('overview')}>
          <span aria-hidden="true">◉</span>
          <strong>Rednote Studio</strong>
        </a>
        <nav className="v2-nav">
          {V2_ROUTES.map((route) => (
            <a
              aria-current={activeRoute === route.id ? 'page' : undefined}
              className="v2-nav-item"
              data-active={activeRoute === route.id}
              data-v2-navigation-item
              href={toV2Hash(route.id)}
              key={route.id}
            >
              <Icon name={route.icon} size={21} />
              <span>{route.label}</span>
            </a>
          ))}
        </nav>
        <button
          className="v2-account"
          onClick={() => notify('当前版本为本机单用户工作区。')}
          type="button"
        >
          <Icon name="user-circle" size={29} />
          <span>
            <strong>{session.persona.name}</strong>
            <small>本地工作区 · 悬疑推理图书账号</small>
          </span>
          <Icon name="caret-down" size={15} />
        </button>
      </aside>
      <div className="v2-workspace">
        <header className="v2-window-bar">
          <div className="v2-brand">
            <Icon name="bookmark-simple" size={19} />
            <span>Rednote Studio</span>
          </div>
          <strong className="v2-mock-label">
            {providerStatus === 'READY'
              ? '本地工作区已连接 · AI 服务已就绪'
              : providerStatus === 'DEGRADED'
                ? '本地工作区已连接 · AI 服务部分可用'
                : providerStatus === 'BLOCKED'
                  ? '本地工作区已连接 · AI 服务不可用'
                  : providerStatus === 'VERIFY'
                    ? '本地工作区已连接 · AI 能力待验证'
                    : providerStatus === 'CONFIGURE'
                      ? '本地工作区已连接 · AI 服务待配置'
                      : '本地工作区未连接 · AI 服务不可用'}
          </strong>
        </header>
        <div className="v2-app-body">
          <main className="v2-main">{children}</main>
        </div>
      </div>
    </div>
  );
}

export function PageHeader({
  actions,
  description,
  eyebrow,
  title,
}: {
  readonly actions?: ReactNode;
  readonly description: string;
  readonly eyebrow: string;
  readonly title: string;
}): React.JSX.Element {
  return (
    <header className="v2-page-header">
      <div>
        <p className="v2-kicker">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions === undefined ? null : <div className="v2-header-actions">{actions}</div>}
    </header>
  );
}

export function StatusPill({ status }: { readonly status: string }): React.JSX.Element {
  const tone =
    status === '已确认' || status === '已导出' || status === '已通过' || status === '已锁定'
      ? 'success'
      : status === '时间冲突'
        ? 'danger'
        : status.includes('待')
          ? 'warning'
          : 'neutral';
  return <span className={`v2-status v2-status--${tone}`}>{status}</span>;
}

export function useDialog(
  open: boolean,
  onClose: () => void,
  returnFocus: HTMLElement | null,
): React.RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const dialog = ref.current;
    const focusable = dialog?.querySelector<HTMLElement>('button, input, textarea, select, [href]');
    focusable?.focus();
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || dialog === null) return;
      const nodes = [
        ...dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, textarea, select, [href]',
        ),
      ];
      const first = nodes[0];
      const last = nodes.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      returnFocus?.focus({ preventScroll: true });
    };
  }, [onClose, open, returnFocus]);
  return ref;
}

export function DetailDrawer({
  item,
  onClose,
  onNavigate,
  returnFocus,
}: {
  readonly item: {
    readonly kind: '内容' | '排程' | '互动';
    readonly reason: string;
    readonly title: string;
  } | null;
  readonly onClose: () => void;
  readonly onNavigate: (route: V2RouteId) => void;
  readonly returnFocus: HTMLElement | null;
}): React.JSX.Element | null {
  const ref = useDialog(item !== null, onClose, returnFocus);
  if (item === null) return null;
  const route =
    item.kind === '互动' ? 'interaction' : item.kind === '排程' ? 'weekly-plan' : 'content';
  return (
    <div className="v2-overlay v2-overlay--end" onMouseDown={onClose} role="presentation">
      <div
        aria-labelledby="v2-drawer-title"
        aria-modal="true"
        className="v2-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        ref={ref}
        role="dialog"
      >
        <div className="v2-overlay-head">
          <div>
            <p className="v2-kicker">{item.kind}</p>
            <h2 id="v2-drawer-title">{item.title}</h2>
          </div>
          <button aria-label="关闭详情" className="v2-icon-button" onClick={onClose} type="button">
            <Icon name="x" />
          </button>
        </div>
        <section className="v2-decision-note">
          <Icon name="warning-circle" />
          <div>
            <strong>为什么需要你决定</strong>
            <p>{item.reason}</p>
          </div>
        </section>
        <dl className="v2-facts">
          <div>
            <dt>系统建议</dt>
            <dd>保留当前内容，由你确认表达或安排。</dd>
          </div>
          <div>
            <dt>影响范围</dt>
            <dd>仅影响当前模拟会话，不执行真实操作。</dd>
          </div>
        </dl>
        <div className="v2-overlay-actions">
          <Button onClick={onClose}>稍后处理</Button>
          <Button
            onClick={() => {
              onClose();
              onNavigate(route);
            }}
            tone="primary"
          >
            前往对应页面
          </Button>
        </div>
      </div>
    </div>
  );
}

export function DateModal({
  count,
  initialDate,
  initialTime,
  onClose,
  onApply,
  onPreview,
  returnFocus,
}: {
  readonly count: number;
  readonly initialDate: string;
  readonly initialTime: string;
  readonly onClose: () => void;
  readonly onApply: (
    fields: Omit<RendererPlanRescheduleFields, 'candidateIds' | 'expectedRevision' | 'weekKey'>,
    allowConflicts: boolean,
    preview: RendererPlanReschedulePreview,
  ) => Promise<boolean>;
  readonly onPreview: (
    fields: Omit<RendererPlanRescheduleFields, 'candidateIds' | 'expectedRevision' | 'weekKey'>,
  ) => Promise<RendererPlanReschedulePreview | null>;
  readonly returnFocus: HTMLElement | null;
}): React.JSX.Element {
  const ref = useDialog(true, onClose, returnFocus);
  const [date, setDate] = useState(initialDate);
  const [mode, setMode] = useState<RendererPlanRescheduleMode>('DATE_TIME');
  const [preview, setPreview] = useState<RendererPlanReschedulePreview | null>(null);
  const [stagger, setStagger] = useState(count > 1);
  const [submitting, setSubmitting] = useState(false);
  const [time, setTime] = useState(initialTime);
  const fields = (): Omit<
    RendererPlanRescheduleFields,
    'candidateIds' | 'expectedRevision' | 'weekKey'
  > => ({
    date: mode === 'TIME_ONLY' ? null : date,
    mode,
    staggerMinutes: stagger && mode !== 'DATE_ONLY' ? 30 : 0,
    time: mode === 'DATE_ONLY' ? null : time,
  });
  const inspect = async (): Promise<void> => {
    setSubmitting(true);
    try {
      const result = await onPreview(fields());
      if (result === null) return;
      setPreview(result);
    } finally {
      setSubmitting(false);
    }
  };
  const targetWeek = date === '' ? '待选择' : planDateWeekKey(date);
  return (
    <div className="v2-overlay v2-overlay--end" onMouseDown={onClose} role="presentation">
      <div
        aria-labelledby="v2-date-title"
        aria-modal="true"
        className="v2-drawer v2-schedule-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        ref={ref}
        role="dialog"
      >
        <div className="v2-overlay-head">
          <div>
            <p className="v2-kicker">{preview === null ? '发布时间' : '变更预览'}</p>
            <h2 id="v2-date-title">
              {preview === null ? `调整 ${count} 篇内容的发布时间` : '确认原时间与新时间'}
            </h2>
          </div>
          <button aria-label="关闭改期" className="v2-icon-button" onClick={onClose} type="button">
            <Icon name="x" />
          </button>
        </div>
        {preview === null ? (
          <>
            <div aria-label="调整模式" className="v2-segments v2-schedule-modes">
              {(
                [
                  ['DATE_TIME', '日期和时间'],
                  ['DATE_ONLY', '仅日期'],
                  ['TIME_ONLY', '仅时间'],
                ] as const
              ).map(([value, label]) => (
                <button
                  aria-pressed={mode === value}
                  data-active={mode === value}
                  key={value}
                  onClick={() => setMode(value)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="v2-schedule-inputs">
              {mode === 'TIME_ONLY' ? null : (
                <label className="v2-field">
                  <span>日期</span>
                  <input
                    aria-describedby="v2-timezone-help"
                    onChange={(event) => setDate(event.target.value)}
                    type="date"
                    value={date}
                  />
                </label>
              )}
              {mode === 'DATE_ONLY' ? null : (
                <label className="v2-field">
                  <span>时间（24 小时制）</span>
                  <input
                    aria-describedby="v2-timezone-help"
                    onChange={(event) => setTime(event.target.value)}
                    type="time"
                    value={time}
                  />
                </label>
              )}
            </div>
            <p className="v2-help" id="v2-timezone-help">
              时区：Asia/Shanghai (UTC+8)。初始值来自所选计划项；未设置时会明确显示为空。
            </p>
            <label className="v2-stagger-toggle">
              <input
                checked={stagger}
                disabled={count < 2}
                onChange={(event) => setStagger(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>每篇间隔 30 分钟</strong>
                <small>按当前选择顺序，从起始时间依次排开。</small>
              </span>
            </label>
            <section aria-label="影响预览" className="v2-impact-preview">
              <strong>应用前影响预览</strong>
              <dl>
                <div>
                  <dt>影响内容</dt>
                  <dd>{count} 篇</dd>
                </div>
                <div>
                  <dt>目标周</dt>
                  <dd>{mode === 'TIME_ONLY' ? '保留原日期' : targetWeek}</dd>
                </div>
                <div>
                  <dt>冲突处理</dt>
                  <dd>先检查，不自动解决</dd>
                </div>
              </dl>
            </section>
            <div className="v2-overlay-actions">
              <Button
                onClick={() => {
                  setDate(initialDate);
                  setTime(initialTime);
                }}
                tone="quiet"
              >
                重置
              </Button>
              <Button onClick={onClose}>取消</Button>
              <Button disabled={submitting} onClick={() => void inspect()} tone="primary">
                预览发布时间变更
              </Button>
            </div>
          </>
        ) : (
          <>
            <section className="v2-conflict-summary">
              <div>
                <Icon name={preview.conflictCount > 0 ? 'warning-circle' : 'check-circle'} />
                <p>
                  {preview.conflictCount > 0
                    ? `发现 ${preview.conflictCount} 处冲突。系统不会自动顺延、交换、覆盖或删除内容。`
                    : '未发现冲突；确认前仍不会修改计划。'}
                </p>
              </div>
              <div className="v2-schedule-change-list">
                {preview.items.map((item) => (
                  <article key={item.candidateId}>
                    <div>
                      <span>原发布时间</span>
                      <strong>
                        {item.fromDate} · {item.fromTime}
                      </strong>
                    </div>
                    <div>
                      <span>新发布时间</span>
                      <strong>
                        {item.targetDate} · {item.targetTime}
                      </strong>
                    </div>
                  </article>
                ))}
              </div>
              {preview.conflicts.map((conflict) => (
                <article key={`${conflict.existing.candidateId}-${conflict.incoming.candidateId}`}>
                  <div>
                    <span>已有计划</span>
                    <strong>{conflict.existing.title}</strong>
                    <small>
                      {conflict.existing.date} · {conflict.existing.time}
                    </small>
                  </div>
                  <div>
                    <span>本次调整</span>
                    <strong>{conflict.incoming.title}</strong>
                    <small>
                      {conflict.incoming.date} · {conflict.incoming.time}
                    </small>
                  </div>
                </article>
              ))}
            </section>
            <p className="v2-help">返回修改不会写入任何计划；仍然应用会保留相同时间并记录冲突。</p>
            <div className="v2-overlay-actions">
              <Button onClick={onClose} tone="quiet">
                取消调整
              </Button>
              <Button onClick={() => setPreview(null)}>返回修改时间</Button>
              <Button
                disabled={submitting}
                onClick={() => {
                  setSubmitting(true);
                  void onApply(fields(), preview.conflictCount > 0, preview).finally(() =>
                    setSubmitting(false),
                  );
                }}
                tone="primary"
              >
                确认保存发布时间
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ScheduleSuccess({
  message,
  onDismiss,
}: {
  readonly message: string;
  readonly onDismiss: () => void;
}): React.JSX.Element {
  return (
    <section aria-live="polite" className="v2-schedule-success" role="status">
      <Icon name="check-circle" size={24} />
      <div>
        <strong>计划已更新</strong>
        <p>{message}</p>
      </div>
      <button
        aria-label="关闭成功提示"
        className="v2-icon-button"
        onClick={onDismiss}
        type="button"
      >
        <Icon name="x" size={16} />
      </button>
    </section>
  );
}

export function Toast({ message }: { readonly message: string }): React.JSX.Element {
  return (
    <div aria-live="polite" className="v2-toast" role="status">
      {message === '' ? null : (
        <>
          <Icon name="check-circle" />
          <span>{message}</span>
        </>
      )}
    </div>
  );
}
