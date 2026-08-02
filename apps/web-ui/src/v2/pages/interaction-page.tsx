import { Button, Icon, PageHeader, useV2Controller } from '../components.js';
import type { InteractionItem } from '../mock-provider.js';

export function InteractionPage(): React.JSX.Element {
  const { notify, session, setSession, setUi, ui } = useV2Controller();
  const {
    activeInteractionId: activeId,
    interactionSelectedIds: selectedIds,
    interactionTab: tab,
  } = ui;
  const filtered = session.interactions.filter(({ type }) => type === tab);
  const active = filtered.find(({ id }) => id === activeId) ?? filtered[0];
  if (active === undefined) throw new Error('V2 interaction fixture is unavailable.');
  const patchItems = (ids: readonly string[], patch: Partial<InteractionItem>): void =>
    setSession((current) => ({
      ...current,
      interactions: current.interactions.map((item) =>
        ids.includes(item.id) ? { ...item, ...patch } : item,
      ),
    }));
  const changeTab = (next: '评论' | '私信'): void => {
    setUi((current) => ({
      ...current,
      interactionTab: next,
      interactionSelectedIds: [],
      activeInteractionId: session.interactions.find(({ type }) => type === next)?.id ?? '',
    }));
  };
  const confirmSelected = (): void => {
    const ids = selectedIds.length > 0 ? selectedIds : filtered.map(({ id }) => id);
    patchItems(ids, { status: 'CONFIRMED' });
    notify(`已确认 ${ids.length} 条${tab}建议；没有执行发送。`);
    setUi((current) => ({ ...current, interactionSelectedIds: [] }));
  };
  return (
    <div className="v2-page">
      <PageHeader
        actions={
          <Button icon="check" onClick={confirmSelected} tone="primary">
            批量确认建议
          </Button>
        }
        description="这里只提供回复建议；确认后仍由你在小红书官方端手动发送。"
        eyebrow="评论 6 条 · 私信 2 条 · 模拟数据"
        title="互动"
      />
      <div className="v2-interaction-grid">
        <section aria-label="待回复列表" className="v2-card v2-inbox">
          <div className="v2-segments">
            {(['评论', '私信'] as const).map((value) => (
              <button
                data-active={tab === value}
                key={value}
                onClick={() => changeTab(value)}
                type="button"
              >
                {value} {value === '评论' ? '6' : '2'}
              </button>
            ))}
          </div>
          {filtered.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <article data-active={active.id === item.id} key={item.id}>
                <button
                  aria-label={`${selected ? '取消选择' : '选择'} ${item.author}`}
                  onClick={() =>
                    setUi((current) => ({
                      ...current,
                      interactionSelectedIds: selected
                        ? current.interactionSelectedIds.filter((id) => id !== item.id)
                        : [...current.interactionSelectedIds, item.id],
                    }))
                  }
                  type="button"
                >
                  <Icon name={selected ? 'check-square' : 'square'} size={17} />
                </button>
                <button
                  onClick={() => setUi((current) => ({ ...current, activeInteractionId: item.id }))}
                  type="button"
                >
                  <span className="v2-avatar">{item.author.slice(0, 1)}</span>
                  <span>
                    <strong>{item.author}</strong>
                    <small>{item.original}</small>
                  </span>
                  {item.status !== 'PENDING' ? (
                    <b>{item.status === 'MANUAL_SENT' ? '已手动发送' : '已确认'}</b>
                  ) : null}
                </button>
              </article>
            );
          })}
        </section>
        <section aria-label="回复详情" className="v2-card v2-reply-detail">
          <div>
            <p className="v2-kicker">{active.source}</p>
            <h2>{active.author}</h2>
            <blockquote>{active.original}</blockquote>
          </div>
          <label className="v2-field">
            <span>
              <Icon name="sparkle" size={16} />
              回复建议
            </span>
            <textarea
              aria-label="回复建议"
              onChange={(event) => patchItems([active.id], { suggestion: event.target.value })}
              rows={7}
              value={active.suggestion}
            />
          </label>
          <span
            className={`v2-confidence ${active.confidence === '需要追问' ? 'v2-confidence--warning' : ''}`}
          >
            <Icon
              name={active.confidence === '需要追问' ? 'warning-circle' : 'check-circle'}
              size={17}
            />
            {active.confidence}
          </span>
          <div className="v2-reply-actions">
            <Button
              icon="check"
              onClick={() => {
                patchItems([active.id], { status: 'CONFIRMED' });
                notify('回复建议已确认，尚未发送。');
              }}
            >
              确认建议
            </Button>
            <Button
              disabled={active.status === 'PENDING'}
              icon="paper-plane-tilt"
              onClick={() => {
                patchItems([active.id], { status: 'MANUAL_SENT' });
                notify('仅记录“已在官方端手动发送”；应用没有发送能力。');
              }}
              tone="primary"
            >
              标记已在官方端手动发送
            </Button>
          </div>
          <p className="v2-manual-note">未连接平台，不会自动发送评论或私信。</p>
        </section>
      </div>
    </div>
  );
}
