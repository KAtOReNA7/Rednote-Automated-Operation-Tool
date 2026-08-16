import { useState } from 'react';

import { Button, Icon, PageHeader, useV2Controller } from '../components.js';

export function LibraryPage(): React.JSX.Element {
  const { notify, session } = useV2Controller();
  const [query, setQuery] = useState('');
  const books = session.books.filter((book) =>
    `${book.title}${book.author}${book.angle}`.toLowerCase().includes(query.toLowerCase()),
  );
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
                placeholder="搜索作品或角度"
                value={query}
              />
            </label>
            <Button onClick={() => notify('数据导入尚未接入；当前书库为模拟数据。')}>
              导入数据（未接入）
            </Button>
          </>
        }
        description="围绕运营价值、内容角度和历史表现管理作品。"
        eyebrow="6 本重点作品 · 模拟数据"
        title="书库"
      />
      <section aria-label="作品运营卡片" className="v2-book-grid">
        {books.map((book, index) => (
          <article className="v2-card v2-book" key={book.id}>
            <div data-tone={index % 3}>
              <Icon name="books" size={30} />
            </div>
            <section>
              <p className="v2-kicker">{book.author}</p>
              <h2>《{book.title}》</h2>
              <span>{book.angle}</span>
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
        ))}
      </section>
    </div>
  );
}
