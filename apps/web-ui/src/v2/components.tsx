import {
  createContext,
  useContext,
  useEffect,
  useRef,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';

import iconSpriteUrl from './assets/icons/phosphor-v2-subset.svg';
import type { V2Session } from './mock-provider.js';
import { V2_ROUTES, toV2Hash, type V2RouteId } from './routes.js';

export type PlanFilter = 'all' | 'pending' | 'conflict';
export interface ReviewItem {
  readonly kind: '内容' | '排程' | '互动';
  readonly reason: string;
  readonly title: string;
}
export interface V2UiState {
  readonly activeContentId: string;
  readonly activeInteractionId: string;
  readonly batchMode: boolean;
  readonly contentSelectedIds: readonly string[];
  readonly interactionSelectedIds: readonly string[];
  readonly interactionTab: '评论' | '私信';
  readonly normalExpanded: boolean;
  readonly onlyExceptions: boolean;
  readonly planFilter: PlanFilter;
  readonly planSelectedIds: readonly string[];
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
  return (
    <div className="v2-shell" data-v2-mock="true" data-v2-shell>
      <header className="v2-window-bar">
        <div className="v2-brand">
          <Icon name="bookmark-simple" size={21} />
          <span>Rednote V2</span>
        </div>
        <strong className="v2-mock-label">模拟数据 · 未连接真实服务</strong>
      </header>
      <div className="v2-app-body">
        <aside aria-label="主导航" className="v2-sidebar">
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
            onClick={() => notify('账号切换尚未接入；当前为单账号模拟会话。')}
            type="button"
          >
            <Icon name="user-circle" size={29} />
            <span>
              <strong>雾灯书页</strong>
              <small>个人悬疑推理图书账号</small>
            </span>
            <Icon name="caret-down" size={15} />
          </button>
        </aside>
        <main className="v2-main">{children}</main>
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
    status === '已确认' || status === '已导出' || status === '已通过'
      ? 'success'
      : status === '时间冲突'
        ? 'danger'
        : status.includes('待')
          ? 'warning'
          : 'neutral';
  return <span className={`v2-status v2-status--${tone}`}>{status}</span>;
}

function useDialog(
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
      returnFocus?.focus();
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
  onClose,
  onConfirm,
  returnFocus,
}: {
  readonly count: number;
  readonly onClose: () => void;
  readonly onConfirm: (value: string) => void;
  readonly returnFocus: HTMLElement | null;
}): React.JSX.Element {
  const ref = useDialog(true, onClose, returnFocus);
  const selectRef = useRef<HTMLSelectElement>(null);
  return (
    <div className="v2-overlay" onMouseDown={onClose} role="presentation">
      <div
        aria-labelledby="v2-date-title"
        aria-modal="true"
        className="v2-modal"
        onMouseDown={(event) => event.stopPropagation()}
        ref={ref}
        role="dialog"
      >
        <div className="v2-overlay-head">
          <div>
            <p className="v2-kicker">批量操作</p>
            <h2 id="v2-date-title">调整 {count} 篇内容日期</h2>
          </div>
          <button aria-label="关闭改期" className="v2-icon-button" onClick={onClose} type="button">
            <Icon name="x" />
          </button>
        </div>
        <label className="v2-field">
          <span>新的发布时间</span>
          <select defaultValue="周日 14:00" ref={selectRef}>
            <option>周六 18:30</option>
            <option>周日 10:00</option>
            <option>周日 14:00</option>
            <option>周日 20:00</option>
          </select>
        </label>
        <p className="v2-help">确认后会在当前模拟会话中更新，并重新标记状态。</p>
        <div className="v2-overlay-actions">
          <Button onClick={onClose}>取消</Button>
          <Button
            onClick={() => onConfirm(selectRef.current?.value ?? '周日 14:00')}
            tone="primary"
          >
            确认调整
          </Button>
        </div>
      </div>
    </div>
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
