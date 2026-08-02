import { useCallback, useEffect, useRef, useState } from 'react';

import {
  AppFrame,
  DateModal,
  DetailDrawer,
  ScheduleSuccess,
  Toast,
  V2ControllerContext,
  type ReviewItem,
  type V2UiState,
} from './components.js';
import {
  v2MockProvider,
  withPersistedContentPackages,
  withPersistedWeeklyPlan,
  type PersistedWeeklyPlan,
  type RendererPlanRescheduleFields,
  type RendererPlanReschedulePreview,
  type V2Session,
} from './mock-provider.js';
import { resolveV2Route, toV2Hash, type V2RouteId } from './routes.js';
import { ContentPage } from './pages/content-page.js';
import { InteractionPage } from './pages/interaction-page.js';
import { LibraryPage } from './pages/library-page.js';
import { OverviewPage } from './pages/overview-page.js';
import { ReviewPage } from './pages/review-page.js';
import { SettingsPage } from './pages/settings-page.js';
import { WeeklyPlanPage } from './pages/weekly-plan-page.js';

const V2_SMOKE_PREFIX = '__V2_R01_SMOKE__:';
const V2_DEFAULT_WEEK_KEY = '2026-W31';

function restoreSession(
  session: V2Session,
  persona: V2Session['persona'],
  plan: PersistedWeeklyPlan,
  content?: V2ContentWorkspaceContract,
): V2Session {
  const restored = withPersistedWeeklyPlan({ ...session, persona: { ...persona } }, plan);
  return content === undefined ? restored : withPersistedContentPackages(restored, content);
}

export function V2App(): React.JSX.Element {
  const [route, setRoute] = useState(() => resolveV2Route(window.location.hash).route);
  const [session, setSession] = useState<V2Session>(() => v2MockProvider.loadSession());
  const [ui, setUi] = useState<V2UiState>(() => ({
    activeContentId: session.content[0]?.id ?? '',
    activeInteractionId: session.interactions[0]?.id ?? '',
    contentSelectedIds: session.content.map(({ id }) => id),
    interactionSelectedIds: [],
    interactionTab: '评论',
    normalExpanded: false,
    onlyExceptions: false,
    planFilter: 'all',
    planSelectionAnchorId: '',
    planSelectedIds: [],
    personaErrors: [],
    savedOpportunityIds: [],
  }));
  const [toast, setToast] = useState('');
  const [drawerItem, setDrawerItem] = useState<ReviewItem | null>(null);
  const [dateModalOpen, setDateModalOpen] = useState(false);
  const [scheduleSuccess, setScheduleSuccess] = useState('');
  const returnFocus = useRef<HTMLElement | null>(null);
  const smokeStarted = useRef(false);
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
    const bridge = window.rednoteV2;
    if (bridge === undefined) return;
    let cancelled = false;
    void Promise.all([
      bridge.readPersona(),
      bridge.readWeeklyPlan({ weekKey: V2_DEFAULT_WEEK_KEY }),
      bridge.readContentPackages({ weekKey: V2_DEFAULT_WEEK_KEY }),
    ]).then(([persona, plan, content]) => {
      if (cancelled || !persona.ok || !plan.ok || !content.ok) return;
      setSession((current) => restoreSession(current, persona.value, plan.value, content.value));
      setUi((current) => ({
        ...current,
        activeContentId: content.value.packages[0]?.id ?? '',
        contentSelectedIds: [],
      }));
    });
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (window.location.search !== '?smoke=1' || smokeStarted.current) return;
    smokeStarted.current = true;
    const bridge = window.rednoteV2;
    void (async () => {
      if (bridge === undefined) throw new Error('V2 bridge unavailable');
      const [planRead, contentRead] = await Promise.all([
        bridge.readWeeklyPlan({ weekKey: V2_DEFAULT_WEEK_KEY }),
        bridge.readContentPackages({ weekKey: V2_DEFAULT_WEEK_KEY }),
      ]);
      if (!planRead.ok || !contentRead.ok) throw new Error('V2 read failed');
      let packages = contentRead.value.packages;
      if (packages.length === 0) {
        const locked = await bridge.lockWeeklyPlan({
          expectedRevision: planRead.value.revision,
          weekKey: V2_DEFAULT_WEEK_KEY,
        });
        if (!locked.ok) throw new Error('V2 setup failed');
        const generated = await bridge.generateContentPackages({
          candidateIds: ['mon-1', 'tue-2', 'sun-2'],
          expectedPlanRevision: locked.value.revision,
          idempotencyKey: 'content-r04-smoke',
          weekKey: V2_DEFAULT_WEEK_KEY,
        });
        if (!generated.ok || generated.value.packages[0] === undefined)
          throw new Error('V2 generation failed');
        const first = generated.value.packages[0];
        const saved = await bridge.saveContentPackage({
          expectedRevision: first.revision,
          expectedVersionId: first.versionId,
          fields: { ...first.fields, title: `${first.fields.title}（smoke 修订）` },
          packageId: first.id,
        });
        const refreshed = await bridge.readContentPackages({ weekKey: V2_DEFAULT_WEEK_KEY });
        if (!saved.ok || !refreshed.ok) throw new Error('V2 edit failed');
        packages = refreshed.value.packages;
      }
      const refs = () =>
        packages.map((item) => ({
          expectedRevision: item.revision,
          expectedVersionId: item.versionId,
          packageId: item.id,
        }));
      if (!packages.every(({ status }) => status === 'APPROVED')) {
        const approved = await bridge.approveContentPackages({ items: refs() });
        if (!approved.ok) throw new Error('V2 approval failed');
        packages = approved.value.packages;
      }
      const exported = await bridge.exportContentPackages({
        idempotencyKey: 'export-r04-smoke',
        items: refs(),
      });
      if (!exported.ok) throw new Error('V2 export failed');
      const valid =
        packages.length === 3 &&
        packages.every(({ status }) => status === 'APPROVED') &&
        Math.max(...packages.map(({ version }) => version)) === 2 &&
        /^r04-[a-f0-9]{24}$/u.test(exported.value.exportId);
      const report = {
        marker: valid && document.querySelector('[data-v2-shell]') !== null,
        mockMode: document.querySelector('[data-v2-mock="true"]') !== null,
        navigationCount: document.querySelectorAll('[data-v2-navigation-item]').length,
        preload: bridge !== undefined,
      };
      document.title = `${V2_SMOKE_PREFIX}${encodeURIComponent(JSON.stringify(report))}`;
    })().catch(() => {
      document.title = `${V2_SMOKE_PREFIX}${encodeURIComponent(
        JSON.stringify({ marker: false, mockMode: true, navigationCount: 7, preload: true }),
      )}`;
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
            onApply={async (fields, allowConflicts, preview) => {
              const bridge = window.rednoteV2;
              if (bridge === undefined) {
                notify('本机周计划桥接不可用，未修改计划。');
                return false;
              }
              const result = await bridge.reschedulePlanCandidates({
                allowConflicts,
                candidateIds: ui.planSelectedIds,
                expectedRevision: session.planRevision,
                ...fields,
                weekKey: session.weekKey,
              });
              if (!result.ok) {
                notify(result.error.message);
                return false;
              }
              setSession((current) => withPersistedWeeklyPlan(current, result.value));
              setDateModalOpen(false);
              const first = preview.items[0];
              setScheduleSuccess(
                `${preview.affectedCount} 篇 · ${first?.targetDate ?? ''} · ${
                  first?.targetTime ?? ''
                } 起${fields.staggerMinutes === 30 ? '，每篇间隔 30 分钟' : ''}`,
              );
              return true;
            }}
            onPreview={async (fields) => {
              const input: RendererPlanRescheduleFields = {
                candidateIds: ui.planSelectedIds,
                expectedRevision: session.planRevision,
                ...fields,
                weekKey: session.weekKey,
              };
              const bridge = window.rednoteV2;
              if (bridge === undefined) {
                notify('本机周计划桥接不可用，未修改计划。');
                return null;
              }
              const result = await bridge.previewPlanReschedule(input);
              if (!result.ok) {
                notify(result.error.message);
                return null;
              }
              return result.value as RendererPlanReschedulePreview;
            }}
            returnFocus={returnFocus.current}
          />
        ) : null}
        {scheduleSuccess === '' ? null : (
          <ScheduleSuccess message={scheduleSuccess} onDismiss={() => setScheduleSuccess('')} />
        )}
        <Toast message={toast} />
      </AppFrame>
    </V2ControllerContext.Provider>
  );
}
