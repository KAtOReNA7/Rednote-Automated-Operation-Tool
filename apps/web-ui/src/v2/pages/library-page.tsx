import { useState } from 'react';

import { Button, Icon, PageHeader, useV2Controller } from '../components.js';

const coverTones = ['midnight', 'wine', 'stone'] as const;

export function LibraryPage(): React.JSX.Element {
  const { notify, session } = useV2Controller();
  const [query, setQuery] = useState('');
  const books = session.books.filter((book) =>
    `${book.title}${book.author}${book.angle}`.toLowerCase().includes(query.toLowerCase()),
  );
  const featuredBook = books.at(0);
  const recentBooks = books.slice(1);
  return (
    <div className="v2-page v2-library-page">
      <PageHeader
        actions={
          <>
            <label className="v2-search">
              <Icon name="magnifying-glass" size={17} />
              <input
                aria-label="搜索作品"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索作品、作者或运营角度"
                value={query}
              />
            </label>
            <Button onClick={() => notify('数据导入尚未接入；当前书库为模拟数据。')}>
              <Icon name="plus" size={16} /> 导入数据（未接入）
            </Button>
          </>
        }
        description="从作品、角度到历史表现，快速找到下一条值得做的内容。"
        eyebrow="作品资料库"
        title="把书变成可持续经营的内容资产"
      />
      <section className="v2-library-overview" aria-label="书库概览">
        <div>
          <p className="v2-kicker">当前作品池</p>
          <strong>{session.books.length}</strong>
          <span>本重点作品</span>
        </div>
        <p>
          选择一部作品，围绕可复用的内容角度建立持续运营节奏。封面仅为中性占位，不代表真实素材。
        </p>
      </section>
      {books.length === 0 ? (
        <section className="v2-card v2-library-empty" aria-label="没有匹配作品">
          <Icon name="books" size={30} />
          <div>
            <h2>没有匹配的作品</h2>
            <p>请调整关键词，或清空搜索以查看当前书库。</p>
          </div>
        </section>
      ) : (
        <>
          {featuredBook === undefined ? null : (
            <section className="v2-library-feature" aria-label="重点作品">
              <div className="v2-library-feature-cover" data-tone="midnight">
                <span>重点作品</span>
                <strong>《{featuredBook.title}》</strong>
                <small>中性封面占位 · 本地作品资料</small>
              </div>
              <div>
                <p className="v2-kicker">作品运营摘要</p>
                <h2>《{featuredBook.title}》</h2>
                <p>{featuredBook.angle}</p>
                <dl>
                  <div>
                    <dt>已发布</dt>
                    <dd>{featuredBook.posts} 篇</dd>
                  </div>
                  <div>
                    <dt>收藏率</dt>
                    <dd>{featuredBook.saves}</dd>
                  </div>
                </dl>
              </div>
            </section>
          )}
          <section aria-label="近期作品卡片" className="v2-book-grid v2-library-shelf">
            {recentBooks.map((book, index) => {
              const tone = coverTones[index % coverTones.length];
              return (
                <article className="v2-card v2-book" key={book.id}>
                  <div className="v2-book-cover" data-tone={tone}>
                    <span>推理小说</span>
                    <Icon name="books" size={32} />
                    <strong>《{book.title}》</strong>
                    <small>本地作品资料</small>
                  </div>
                  <section className="v2-book-copy">
                    <p className="v2-kicker">{book.author}</p>
                    <h2>《{book.title}》</h2>
                    <p className="v2-book-angle">{book.angle}</p>
                    <dl>
                      <div>
                        <dt>已发布</dt>
                        <dd>{book.posts} 篇</dd>
                      </div>
                      <div>
                        <dt>收藏率</dt>
                        <dd>{book.saves}</dd>
                      </div>
                    </dl>
                    <button
                      onClick={() => notify(`《${book.title}》运营摘要仅作模拟展示。`)}
                      type="button"
                    >
                      查看运营摘要 <Icon name="arrow-right" size={14} />
                    </button>
                  </section>
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
}
