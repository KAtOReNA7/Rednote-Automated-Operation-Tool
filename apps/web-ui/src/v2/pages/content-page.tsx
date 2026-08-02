import { Button, Icon, PageHeader, StatusPill, useV2Controller } from '../components.js';

export function ContentPage(): React.JSX.Element {
  const { notify, session, setSession, setUi, ui } = useV2Controller();
  const { activeContentId: activeId, contentSelectedIds: selectedIds } = ui;
  const active = session.content.find(({ id }) => id === activeId) ?? session.content[0];
  if (active === undefined) throw new Error('V2 content fixture is unavailable.');
  const update = (field: 'body' | 'title', value: string): void =>
    setSession((current) => ({
      ...current,
      content: current.content.map((item) =>
        item.id === active.id ? { ...item, [field]: value } : item,
      ),
    }));
  const approve = (): void => {
    if (selectedIds.length === 0) {
      notify('请先选择内容包。');
      return;
    }
    setSession((current) => ({
      ...current,
      content: current.content.map((item) =>
        selectedIds.includes(item.id) ? { ...item, status: '已通过' } : item,
      ),
    }));
    notify(`已通过 ${selectedIds.length} 个模拟内容包；未导出、未发布。`);
    setUi((current) => ({ ...current, contentSelectedIds: [] }));
  };
  return (
    <div className="v2-page">
      <PageHeader
        actions={
          <>
            <Button
              icon="export"
              onClick={() => notify('本地包仅作模拟预览；没有创建文件或平台操作。')}
            >
              预览本地包
            </Button>
            <Button icon="check" onClick={approve} tone="primary">
              批量通过 {selectedIds.length > 0 ? `(${selectedIds.length})` : ''}
            </Button>
          </>
        }
        description="封面、标题、正文、标签、建议发布时间和素材说明在一个工作区完成确认。"
        eyebrow="完整内容包 · 模拟数据"
        title="内容"
      />
      <div className="v2-content-grid">
        <section aria-label="内容包列表" className="v2-card v2-package-list">
          <header>
            <strong>待确认 3</strong>
            <button
              onClick={() =>
                setUi((current) => ({
                  ...current,
                  contentSelectedIds:
                    selectedIds.length === session.content.length
                      ? []
                      : session.content.map(({ id }) => id),
                }))
              }
              type="button"
            >
              {selectedIds.length === session.content.length ? '取消全选' : '全选'}
            </button>
          </header>
          {session.content.map((item) => {
            const selected = selectedIds.includes(item.id);
            return (
              <article data-active={active.id === item.id} key={item.id}>
                <button
                  aria-label={`${selected ? '取消选择' : '选择'} ${item.book}`}
                  onClick={() =>
                    setUi((current) => ({
                      ...current,
                      contentSelectedIds: selected
                        ? current.contentSelectedIds.filter((id) => id !== item.id)
                        : [...current.contentSelectedIds, item.id],
                    }))
                  }
                  type="button"
                >
                  <Icon name={selected ? 'check-square' : 'square'} />
                </button>
                <button
                  onClick={() => setUi((current) => ({ ...current, activeContentId: item.id }))}
                  type="button"
                >
                  <span>
                    <strong>{item.book}</strong>
                    <small>{item.title}</small>
                  </span>
                  <StatusPill status={item.status} />
                </button>
              </article>
            );
          })}
        </section>
        <section aria-label={`${active.book} 内容包`} className="v2-card v2-package-detail">
          <div className="v2-section-head">
            <div>
              <p className="v2-kicker">{active.book}</p>
              <h2>{active.title}</h2>
            </div>
            <Button
              icon="pencil-simple"
              onClick={() => notify('编辑仅写入当前模拟会话。')}
              tone="quiet"
            >
              编辑
            </Button>
          </div>
          <div className="v2-package-grid">
            <figure>
              <img alt={active.coverAlt} src={active.cover} />
              <figcaption>
                <Icon name="image-square" size={16} />
                封面建议 · 复古纸张 · 低饱和 · 无剧透
              </figcaption>
            </figure>
            <div className="v2-package-fields">
              <label className="v2-field">
                <span>标题</span>
                <input
                  aria-label="标题"
                  onChange={(event) => update('title', event.target.value)}
                  value={active.title}
                />
              </label>
              <label className="v2-field">
                <span>正文</span>
                <textarea
                  aria-label="正文"
                  onChange={(event) => update('body', event.target.value)}
                  rows={7}
                  value={active.body}
                />
              </label>
              <div className="v2-field-row">
                <div>
                  <Icon name="clock" />
                  <span>
                    <small>建议发布时间</small>
                    <strong>{active.time}</strong>
                  </span>
                </div>
                <div>
                  <Icon name="tag" />
                  <span>
                    <small>标签</small>
                    <strong>{active.tags.join(' · ')}</strong>
                  </span>
                </div>
              </div>
              <div className="v2-material">
                <strong>素材说明</strong>
                <p>{active.materials}</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
