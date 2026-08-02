import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AppFrame,
  DateModal,
  DetailDrawer,
  Toast,
  V2ControllerContext,
  type ReviewItem,
  type V2UiState,
} from './components.js';
import { v2MockProvider, type V2Session } from './mock-provider.js';
import { resolveV2Route, toV2Hash, type V2RouteId } from './routes.js';
import { ContentPage } from './pages/content-page.js';
import { InteractionPage } from './pages/interaction-page.js';
import { LibraryPage } from './pages/library-page.js';
import { OverviewPage } from './pages/overview-page.js';
import { ReviewPage } from './pages/review-page.js';
import { SettingsPage } from './pages/settings-page.js';
import { WeeklyPlanPage } from './pages/weekly-plan-page.js';

const V2_SMOKE_PREFIX = '__V2_R01_SMOKE__:';

export function V2App(): React.JSX.Element {
  const [route, setRoute] = useState(() => resolveV2Route(window.location.hash).route);
  const [session, setSession] = useState<V2Session>(() => v2MockProvider.loadSession());
  const [ui, setUi] = useState<V2UiState>(() => ({
    activeContentId: session.content[0]?.id ?? '',
    activeInteractionId: session.interactions[0]?.id ?? '',
    batchMode: false,
    contentSelectedIds: session.content.map(({ id }) => id),
    interactionSelectedIds: [],
    interactionTab: '评论',
    normalExpanded: false,
    onlyExceptions: false,
    planFilter: 'all',
    planSelectedIds: [],
    savedOpportunityIds: [],
  }));
  const [toast, setToast] = useState('');
  const [drawerItem, setDrawerItem] = useState<ReviewItem | null>(null);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const notify = useCallback((message: string): void => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(''), 2_800);
  }, []);
  const navigate = useCallback((next: V2RouteId): void => {
    const hash = toV2Hash(next);
    if (window.location.hash !== hash) window.location.hash = hash.slice(1);
    setRoute(next);
    window.scrollTo({ behavior: 'smooth', top: 0 });
  }, []);
  const openDrawer = (item: ReviewItem, trigger: HTMLElement): void => {
    returnFocus.current = trigger;
    setDrawerItem(item);
  };
  const openDate = (trigger: HTMLElement): void => {
    returnFocus.current = trigger;
    setDateModalOpen(true);
  };

  useEffect(() => {
    const sync = (): void => {
      const next = resolveV2Route(window.location.hash);
      if (!next.valid) window.history.replaceState(null, '', toV2Hash('overview'));
      setRoute(next.route);
    };
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  useEffect(() => {
    if (window.location.search !== '?smoke=1') return;
    queueMicrotask(() => {
      const report = {
        marker: document.querySelector('[data-v2-shell]') !== null,
        mockMode: document.querySelector('[data-v2-mock="true"]') !== null,
        navigationCount: document.querySelectorAll('[data-v2-navigation-item]').length,
        preload: false,
      };
      document.title = `${V2_SMOKE_PREFIX}${encodeURIComponent(JSON.stringify(report))}`;
    });
  }, []);

  const Page =
    route === 'weekly-plan'
      ? WeeklyPlanPage
      : route === 'content'
        ? ContentPage
        : route === 'interaction'
          ? InteractionPage
          : route === 'library'
            ? LibraryPage
            : route === 'review'
              ? ReviewPage
              : route === 'settings'
                ? SettingsPage
                : OverviewPage;
  const controller = { navigate, notify, openDate, openDrawer, session, setSession, setUi, ui };

  return (
    <V2ControllerContext.Provider value={controller}>
      <AppFrame activeRoute={route} notify={notify}>
        <Page />
        <DetailDrawer
          item={drawerItem}
          onClose={() => setDrawerItem(null)}
          onNavigate={navigate}
          returnFocus={returnFocus.current}
        />
        {dateModalOpen ? (
          <DateModal
            count={ui.planSelectedIds.length}
            onClose={() => setDateModalOpen(false)}
            onConfirm={(value) => {
              const [day = '周日', time = '14:00'] = value.split(' ');
              setSession((current) => ({
                ...current,
                plan: current.plan.map((item) =>
                  ui.planSelectedIds.includes(item.id)
                    ? { ...item, date: day === '周日' ? '8/2' : item.date, day, time }
                    : item,
                ),
              }));
              setDateModalOpen(false);
              notify(`已将 ${ui.planSelectedIds.length} 篇内容调整到${value}（仅模拟会话）。`);
            }}
            returnFocus={returnFocus.current}
          />
        ) : null}
        <Toast message={toast} />
      </AppFrame>
    </V2ControllerContext.Provider>
  );
}
