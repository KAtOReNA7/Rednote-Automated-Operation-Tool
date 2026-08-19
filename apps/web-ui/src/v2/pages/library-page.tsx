import { useCallback, useEffect, useMemo, useState } from 'react';

import { Button, Icon, PageHeader } from '../components.js';

const PAGE_LIMIT = 8;
const coverTones = ['midnight', 'wine', 'stone'] as const;
const catalogDisplayLabels: Readonly<Record<string, string>> = Object.freeze({
  ACTIVE: '当前有效',
  ADAPTER: '改编者',
  AGENCY: '代理机构',
  ALTERNATIVE: '其他名称',
  AUTHOR: '作者',
  BROWSER_CLIP_CANDIDATE: '浏览器收藏候选',
  CANONICAL: '规范标题',
  COAUTHOR: '合著者',
  CONTRIBUTOR: '贡献者',
  CURATED_SOURCE: '整理来源',
  DISTRIBUTOR: '发行方',
  EDITION: '具体版本',
  EDITOR: '编辑',
  EXPRESSION: '表达形态',
  FETCH_DOCUMENT: '页面获取记录',
  ILLUSTRATOR: '插画作者',
  IMPRINT: '出版品牌',
  LEGACY_UNSPECIFIED: '旧数据未标注类型',
  LICENSEE: '被许可方',
  LICENSOR: '许可方',
  MERGED: '已合并',
  NOT_A_FACT: '非事实陈述',
  OBSERVED_UNVERIFIED: '观察记录未验证',
  ORIGINAL: '原始语言版本',
  ORIGINAL_CREATOR: '原作作者',
  PUBLISHER: '出版社',
  RETIRED: '已归档',
  RIGHTS_HOLDER: '权利方',
  SEARCH_CANDIDATE: '搜索候选记录',
  SYNTHETIC_FIXTURE: '合成测试数据',
  TRANSLATED: '译本',
  TRANSLATION: '翻译',
  TRANSLATOR: '译者',
  UNVERIFIED: '未验证',
  USER_LOCAL_INPUT: '本地用户录入',
  WORK: '作品',
});

type CatalogBridge = NonNullable<typeof window.rednoteV2>;
type CatalogWorksMethod = NonNullable<CatalogBridge['readCatalogWorks']>;
type CatalogWorkMethod = NonNullable<CatalogBridge['readCatalogWork']>;
type CatalogWorksResult = Awaited<ReturnType<CatalogWorksMethod>>;
type CatalogWorkResult = Awaited<ReturnType<CatalogWorkMethod>>;
type CatalogWorksView = Extract<CatalogWorksResult, { readonly ok: true }>['value'];
type CatalogWorkDetail = NonNullable<Extract<CatalogWorkResult, { readonly ok: true }>['value']>;

type LoadState = 'EMPTY' | 'ERROR' | 'LOADING' | 'READY';

function visible(value: string | null): string {
  return value === null || value.trim() === '' ? '信息未标注' : value;
}

export function catalogDisplayLabel(value: string | null): string {
  if (value === null || value.trim() === '') return '信息未标注';
  return catalogDisplayLabels[value] ?? '未识别类型';
}

function TechnicalLabel({ value }: { readonly value: string | null }): React.JSX.Element {
  return <span title={value ?? undefined}>{catalogDisplayLabel(value)}</span>;
}

function SourceBadge({ detail }: { readonly detail: CatalogWorkDetail | null }): React.JSX.Element {
  if (detail === null) return <span className="v2-library-source-badge">来源读取中</span>;
  return (
    <span className="v2-library-source-badge" data-boundary={detail.sourceBoundary}>
      {detail.sourceBoundary === 'MISSING' ? '来源缺失' : '观察记录未验证'}
    </span>
  );
}

function WorkDetail({ detail }: { readonly detail: CatalogWorkDetail }): React.JSX.Element {
  return (
    <section className="v2-library-detail" aria-label={`${detail.canonicalTitle} 书目详情`}>
      <header>
        <div>
          <p className="v2-kicker">作品只读详情</p>
          <h2>{detail.canonicalTitle}</h2>
        </div>
        <div className="v2-library-detail-status">
          <TechnicalLabel value={detail.state} />
          <small>修订版本 {detail.revision}</small>
        </div>
      </header>

      <details>
        <summary>
          表达与版本
          <span>
            {detail.expressionCount} 个表达形态 · {detail.editionCount} 个具体版本
          </span>
        </summary>
        <div className="v2-library-detail-body v2-library-expression-list">
          {detail.expressions.length === 0 ? (
            <p className="v2-library-missing">尚无表达形态记录。</p>
          ) : (
            detail.expressions.map((expression) => (
              <article className="v2-library-expression" key={expression.expressionId}>
                <header>
                  <div>
                    <TechnicalLabel value={expression.kind} />
                    <strong>{visible(expression.title)}</strong>
                  </div>
                  <small>
                    {visible(expression.language)} · {catalogDisplayLabel(expression.state)}
                  </small>
                </header>
                {expression.editions.length === 0 ? (
                  <p className="v2-library-missing">该表达形态尚无具体版本。</p>
                ) : (
                  <div className="v2-library-editions">
                    {expression.editions.map((edition) => (
                      <section key={edition.editionId}>
                        <div>
                          <strong>
                            {edition.label === null || edition.label.trim() === ''
                              ? '版本信息未标注'
                              : edition.label}
                          </strong>
                          <span>
                            {edition.publisher === null || edition.publisher.trim() === ''
                              ? '出版社未标注'
                              : edition.publisher}
                          </span>
                        </div>
                        <small>{catalogDisplayLabel(edition.state)}</small>
                        <p>
                          {edition.identifiers.length === 0
                            ? '标识符缺失'
                            : edition.identifiers
                                .map(({ namespace, value }) => `${namespace} ${value}`)
                                .join(' · ')}
                        </p>
                      </section>
                    ))}
                  </div>
                )}
              </article>
            ))
          )}
        </div>
      </details>

      <details>
        <summary>
          别名与来源
          <span>{detail.observations.length} 条观察记录</span>
        </summary>
        <div className="v2-library-detail-body v2-library-source-grid">
          <section>
            <h3>别名</h3>
            {detail.aliases.length === 0 ? (
              <p className="v2-library-missing">别名缺失。</p>
            ) : (
              <ul>
                {detail.aliases.map((alias) => (
                  <li key={`${alias.kind}-${alias.normalized}`}>
                    <strong>{alias.raw}</strong>
                    <TechnicalLabel value={alias.kind} />
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3>来源边界</h3>
            {detail.observations.length === 0 ? (
              <p className="v2-library-missing">没有可追溯观察记录，来源保持缺失。</p>
            ) : (
              <ul>
                {detail.observations.map((observation) => (
                  <li key={observation.observationId}>
                    <strong>
                      {catalogDisplayLabel(observation.truthStatus)} ·{' '}
                      {catalogDisplayLabel(observation.factStatus)}
                    </strong>
                    <span>
                      {catalogDisplayLabel(observation.originKind)} ·{' '}
                      {observation.fieldProvenanceCount} 个字段来源
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </details>

      <details>
        <summary>
          人物与出版关系
          <span>{detail.relations.length + detail.publicationRelationships.length} 条关系</span>
        </summary>
        <div className="v2-library-detail-body v2-library-relation-list">
          {detail.relations.length === 0 && detail.publicationRelationships.length === 0 ? (
            <p className="v2-library-missing">关系记录缺失。</p>
          ) : null}
          {detail.relations.map((relation) => (
            <section key={`${relation.scopeType}-${relation.scopeId}-${relation.role}`}>
              <strong>{relation.agentName}</strong>
              <span>
                {catalogDisplayLabel(relation.role)} · {catalogDisplayLabel(relation.scopeType)} ·{' '}
                {catalogDisplayLabel(relation.verificationState)}
              </span>
            </section>
          ))}
          {detail.publicationRelationships.map((relation, index) => (
            <section key={`${relation.role}-${relation.scopeId ?? 'unknown'}-${index}`}>
              <strong>
                {relation.subjectAgentName} → {visible(relation.objectAgentName)}
              </strong>
              <span>
                {catalogDisplayLabel(relation.role)} · {catalogDisplayLabel(relation.scopeType)} ·{' '}
                {catalogDisplayLabel(relation.verificationState)}
              </span>
              <small>
                语言 {visible(relation.language)} · 地区 {visible(relation.territory)}
              </small>
            </section>
          ))}
        </div>
      </details>
    </section>
  );
}

export function LibraryPage(): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<CatalogWorksView | null>(null);
  const [listState, setListState] = useState<LoadState>('LOADING');
  const [listError, setListError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<CatalogWorkDetail | null>(null);
  const [detailState, setDetailState] = useState<LoadState>('EMPTY');
  const [detailError, setDetailError] = useState('');

  const loadWorks = useCallback(async (requestedQuery: string, offset: number): Promise<void> => {
    const method = window.rednoteV2?.readCatalogWorks;
    if (method === undefined) {
      setListState('ERROR');
      setListError('本机书库只读桥接不可用；未显示任何模拟作品。');
      return;
    }
    setListState('LOADING');
    setListError('');
    const result = await method({ limit: PAGE_LIMIT, offset, query: requestedQuery });
    if (!result.ok) {
      setListState('ERROR');
      setListError(result.error.message);
      return;
    }
    setList(result.value);
    setListState(result.value.works.length === 0 ? 'EMPTY' : 'READY');
    setSelectedId((current) =>
      result.value.works.some(({ workId }) => workId === current)
        ? current
        : (result.value.works[0]?.workId ?? ''),
    );
  }, []);

  useEffect(() => {
    void loadWorks('', 0);
  }, [loadWorks]);

  useEffect(() => {
    if (selectedId === '') {
      setDetail(null);
      setDetailState('EMPTY');
      return;
    }
    const method = window.rednoteV2?.readCatalogWork;
    if (method === undefined) {
      setDetailState('ERROR');
      setDetailError('本机作品详情桥接不可用。');
      return;
    }
    let active = true;
    setDetailState('LOADING');
    setDetailError('');
    void method({ workId: selectedId }).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setDetailState('ERROR');
        setDetailError(result.error.message);
        return;
      }
      setDetail(result.value);
      setDetailState(result.value === null ? 'EMPTY' : 'READY');
      if (result.value === null) setDetailError('该作品已不存在，请重新载入书库。');
    });
    return () => {
      active = false;
    };
  }, [selectedId]);

  const selected = useMemo(
    () => list?.works.find(({ workId }) => workId === selectedId) ?? null,
    [list, selectedId],
  );

  const submitSearch = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void loadWorks(query, 0);
  };

  return (
    <div className="v2-page v2-library-page">
      <PageHeader
        actions={
          <>
            <form className="v2-library-search-form" onSubmit={submitSearch} role="search">
              <label className="v2-search">
                <Icon name="magnifying-glass" size={17} />
                <input
                  aria-label="搜索本机作品"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索作品标题"
                  value={query}
                />
              </label>
              <Button disabled={listState === 'LOADING'} type="submit">
                搜索
              </Button>
            </form>
            <span className="v2-library-readonly">本地 Catalog · 只读</span>
          </>
        }
        description="从本机 Catalog 查看作品、表达形态、具体版本与可追溯来源。"
        eyebrow="作品资料库"
        title="把书变成可持续经营的内容资产"
      />

      {listState === 'LOADING' ? (
        <section className="v2-card v2-library-empty" aria-label="正在读取书库" role="status">
          <Icon name="books" size={30} />
          <div>
            <h2>正在读取本机 Catalog</h2>
            <p>只读取作品、表达形态、具体版本与现有来源状态。</p>
          </div>
        </section>
      ) : null}

      {listState === 'ERROR' ? (
        <section className="v2-card v2-library-empty" role="alert">
          <Icon name="books" size={30} />
          <div>
            <h2>书库暂时无法读取</h2>
            <p>{listError}</p>
            <Button onClick={() => void loadWorks(list?.query ?? query, list?.offset ?? 0)}>
              重新读取
            </Button>
          </div>
        </section>
      ) : null}

      {listState === 'EMPTY' ? (
        <section className="v2-card v2-library-empty" aria-label="书库为空">
          <Icon name="books" size={30} />
          <div>
            <h2>{list?.query === '' ? '本机 Catalog 尚无作品' : '没有匹配的作品'}</h2>
            <p>
              {list?.query === ''
                ? '请通过旧版回退入口维护本地书库；当前页面只读，不会自动导入或写入示例。'
                : '请调整搜索词。当前查询不会改变 Catalog 中的任何记录。'}
            </p>
          </div>
        </section>
      ) : null}

      {listState === 'READY' && selected !== null ? (
        <>
          <section className="v2-library-feature" aria-label="当前选中作品">
            <div className="v2-library-feature-cover" data-tone="midnight">
              <span title="WORK">作品</span>
              <strong>{selected.canonicalTitle}</strong>
              <small>本机 Catalog · 中性占位</small>
            </div>
            <div className="v2-library-feature-copy">
              <p className="v2-kicker">当前选择</p>
              <h2>{selected.canonicalTitle}</h2>
              <p>
                {catalogDisplayLabel(selected.state)} · 修订版本 {selected.revision}
              </p>
              <dl>
                <div>
                  <dt>表达形态</dt>
                  <dd>{selected.expressionCount} 个</dd>
                </div>
                <div>
                  <dt>具体版本</dt>
                  <dd>{selected.editionCount} 个</dd>
                </div>
              </dl>
              <SourceBadge detail={detailState === 'READY' ? detail : null} />
            </div>
          </section>

          <header className="v2-library-shelf-head">
            <div>
              <h2>本机作品</h2>
              <p>卡片对应作品；表达形态与具体版本仅在详情中分层展示</p>
            </div>
            <span>
              当前页 {list?.works.length ?? 0} · 全库 {list?.totalWorks ?? 0}
            </span>
          </header>
          <section aria-label="本机作品列表" className="v2-book-grid v2-library-shelf">
            {list?.works.map((work, index) => {
              const tone = coverTones[index % coverTones.length];
              return (
                <article
                  className="v2-card v2-book"
                  data-selected={work.workId === selectedId}
                  key={work.workId}
                >
                  <div className="v2-book-cover" data-tone={tone}>
                    <span title="WORK">作品</span>
                    <Icon name="books" size={32} />
                    <strong>{work.canonicalTitle}</strong>
                    <small>{catalogDisplayLabel(work.state)}</small>
                  </div>
                  <section className="v2-book-copy">
                    <p className="v2-kicker">修订版本 {work.revision}</p>
                    <p className="v2-book-angle">
                      {work.expressionCount} 个表达形态 · {work.editionCount} 个具体版本
                    </p>
                    <button
                      aria-current={work.workId === selectedId ? 'true' : undefined}
                      onClick={() => setSelectedId(work.workId)}
                      type="button"
                    >
                      {work.workId === selectedId ? '当前详情' : '查看只读详情'}{' '}
                      <Icon name="arrow-right" size={14} />
                    </button>
                  </section>
                </article>
              );
            })}
          </section>

          <nav aria-label="书库分页" className="v2-library-pagination">
            <Button
              disabled={(list?.offset ?? 0) === 0}
              onClick={() =>
                void loadWorks(list?.query ?? '', Math.max(0, (list?.offset ?? 0) - PAGE_LIMIT))
              }
            >
              上一页
            </Button>
            <span>第 {Math.floor((list?.offset ?? 0) / PAGE_LIMIT) + 1} 页</span>
            <Button
              disabled={!list?.hasMore}
              onClick={() => void loadWorks(list?.query ?? '', (list?.offset ?? 0) + PAGE_LIMIT)}
            >
              下一页
            </Button>
          </nav>

          {detailState === 'LOADING' ? (
            <p className="v2-library-detail-loading" role="status">
              正在读取作品详情…
            </p>
          ) : null}
          {detailState === 'ERROR' || (detailState === 'EMPTY' && detailError !== '') ? (
            <p className="v2-library-detail-error" role="alert">
              {detailError}
            </p>
          ) : null}
          {detailState === 'READY' && detail !== null ? <WorkDetail detail={detail} /> : null}
        </>
      ) : null}
    </div>
  );
}
