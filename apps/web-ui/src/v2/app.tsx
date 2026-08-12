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
  currentShanghaiWeekIdentity,
} from './components.js';
import {
  v2MockProvider,
  withPersistedContentPackages,
  withPersistedInteractions,
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
const currentWeekKey = (): string => currentShanghaiWeekIdentity().weekKey;
const V2_SMOKE_WEEK_KEY = '2026-W31';

function restoreSession(
  session: V2Session,
  persona: V2Session['persona'],
  plan: PersistedWeeklyPlan,
  content?: V2ContentWorkspaceContract,
  interactions?: V2InteractionWorkspaceContract,
): V2Session {
  const restored = withPersistedWeeklyPlan({ ...session, persona: { ...persona } }, plan);
  const withContent =
    content === undefined ? restored : withPersistedContentPackages(restored, content);
  return interactions === undefined
    ? withContent
    : withPersistedInteractions(withContent, interactions);
}

export function V2App(): React.JSX.Element {
  const [route, setRoute] = useState(() => resolveV2Route(window.location.hash).route);
  const [session, setSession] = useState(() => v2MockProvider.loadSession(!!window.rednoteV2));
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
      bridge.readWeeklyPlan({ weekKey: currentWeekKey() }),
      bridge.readContentPackages({ weekKey: currentWeekKey() }),
      bridge.readInteractions(),
    ]).then(([persona, plan, content, interactions]) => {
      if (cancelled || !persona.ok || !plan.ok || !content.ok || !interactions.ok) return;
      setSession((current) =>
        restoreSession(current, persona.value, plan.value, content.value, interactions.value),
      );
      setUi((current) => ({
        ...current,
        activeContentId: content.value.packages[0]?.id ?? '',
        activeInteractionId: interactions.value.items[0]?.itemId ?? '',
        contentSelectedIds: [],
        interactionSelectedIds: [],
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
        bridge.readWeeklyPlan({ weekKey: V2_SMOKE_WEEK_KEY }),
        bridge.readContentPackages({ weekKey: V2_SMOKE_WEEK_KEY }),
      ]);
      if (!planRead.ok || !contentRead.ok) throw new Error('V2 read failed');
      let packages = contentRead.value.packages;
      if (packages.length === 0) {
        const locked = await bridge.lockWeeklyPlan({
          expectedRevision: planRead.value.revision,
          weekKey: V2_SMOKE_WEEK_KEY,
        });
        if (!locked.ok) throw new Error('V2 setup failed');
        const generated = await bridge.generateContentPackages({
          candidateIds: ['mon-1', 'tue-2', 'sun-2'],
          expectedPlanRevision: locked.value.revision,
          idempotencyKey: 'content-r04-smoke',
          weekKey: V2_SMOKE_WEEK_KEY,
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
        const refreshed = await bridge.readContentPackages({ weekKey: V2_SMOKE_WEEK_KEY });
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
      let interactionRead = await bridge.readInteractions();
      if (!interactionRead.ok) throw new Error('V2 interaction read failed');
      if (interactionRead.value.items.length === 0) {
        const relatedContentPackageId = packages[0]?.id;
        if (relatedContentPackageId === undefined) throw new Error('V2 interaction setup failed');
        const createInput = {
          expectedRevision: 0 as const,
          kind: 'COMMENT' as const,
          relatedContentPackageId,
          userText: '这篇内容适合第一次读古典推理的人吗？',
        };
        const created = await bridge.createInteraction(createInput);
        const replay = await bridge.createInteraction(createInput);
        if (!created.ok || !replay.ok || !replay.value.duplicate)
          throw new Error('V2 interaction dedup failed');
        if (replay.value.item.itemId !== created.value.item.itemId)
          throw new Error('V2 interaction dedup identity failed');
        const suggested = await bridge.generateReplySuggestion({
          expectedRevision: created.value.item.revision,
          idempotencyKey: 'reply-r05-comment-smoke',
          itemId: created.value.item.itemId,
        });
        if (!suggested.ok || suggested.value.currentSuggestion === null)
          throw new Error('V2 interaction suggestion failed');
        const edited = await bridge.saveReplySuggestion({
          expectedRevision: suggested.value.revision,
          expectedVersionId: suggested.value.currentSuggestionVersionId ?? '',
          itemId: suggested.value.itemId,
          replyText: `${suggested.value.currentSuggestion}（本地 smoke 修订）`,
        });
        if (!edited.ok) throw new Error('V2 interaction edit failed');
        const confirmed = await bridge.confirmReplySuggestions({
          items: [
            {
              expectedRevision: edited.value.revision,
              expectedVersionId: edited.value.currentSuggestionVersionId ?? '',
              itemId: edited.value.itemId,
            },
          ],
        });
        const confirmedItem = confirmed.ok ? confirmed.value.items[0] : undefined;
        if (confirmedItem === undefined) throw new Error('V2 interaction confirmation failed');
        const sent = await bridge.markInteractionManualSent({
          confirmed: true,
          expectedRevision: confirmedItem.revision,
          expectedVersionId: confirmedItem.currentSuggestionVersionId ?? '',
          itemId: confirmedItem.itemId,
        });
        if (!sent.ok) throw new Error('V2 interaction manual record failed');
        const undone = await bridge.undoInteractionManualSent({
          expectedRevision: sent.value.revision,
          itemId: sent.value.itemId,
        });
        const direct = await bridge.createInteraction({
          expectedRevision: 0,
          kind: 'DIRECT_MESSAGE',
          relatedContentPackageId: null,
          userText: '可以推荐一篇短篇推理吗？',
        });
        if (!undone.ok || !direct.ok) throw new Error('V2 interaction state setup failed');
        const directSuggested = await bridge.generateReplySuggestion({
          expectedRevision: direct.value.item.revision,
          idempotencyKey: 'reply-r05-message-smoke',
          itemId: direct.value.item.itemId,
        });
        if (!directSuggested.ok) throw new Error('V2 direct message suggestion failed');
        const skipped = await bridge.skipInteraction({
          expectedRevision: directSuggested.value.revision,
          itemId: directSuggested.value.itemId,
        });
        if (!skipped.ok) throw new Error('V2 interaction skip failed');
        const reopened = await bridge.reopenInteraction({
          expectedRevision: skipped.value.revision,
          itemId: skipped.value.itemId,
        });
        if (!reopened.ok) throw new Error('V2 interaction reopen failed');
        const preview = await bridge.previewInteractionDelete({ itemId: reopened.value.itemId });
        if (
          !preview.ok ||
          preview.value.physicalDeletion ||
          preview.value.retainedManagedReferenceCount !== 2
        )
          throw new Error('V2 interaction delete preview failed');
        const deleted = await bridge.deleteInteraction({
          confirmed: true,
          expectedRevision: reopened.value.revision,
          itemId: reopened.value.itemId,
        });
        if (!deleted.ok) throw new Error('V2 interaction delete failed');
        interactionRead = await bridge.readInteractions();
        if (!interactionRead.ok) throw new Error('V2 interaction final read failed');
      }
      const finalInteraction = interactionRead.value.items[0];
      const valid =
        packages.length === 3 &&
        packages.every(({ status }) => status === 'APPROVED') &&
        Math.max(...packages.map(({ version }) => version)) === 2 &&
        /^r04-[a-f0-9]{24}$/u.test(exported.value.exportId) &&
        interactionRead.value.items.length === 1 &&
        finalInteraction?.kind === 'COMMENT' &&
        finalInteraction.status === 'CONFIRMED' &&
        finalInteraction.currentSuggestionVersion === 2;
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
