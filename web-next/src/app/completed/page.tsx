'use client';

import { useEffect, useState } from 'react';

export default function CompletedPage() {
  const [items, setItems] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((data) => {
        const allTasks = data?.tasks?.all || [];
        setItems(allTasks.filter((t: any) => t.status === 'done' || t.status === 'completed'));
      })
      .catch((err) => console.error('Failed to load completed tasks', err));
  }, []);

  return (
    <main className="main completed-main">
      <header className="topbar">
        <div>
          <p className="eyebrow">Completed Work</p>
          <h1>완료 항목</h1>
        </div>
        <div className="topbar-actions">
          <a href="/" className="secondary nav-link">대시보드</a>
        </div>
      </header>

      <section className="completed-layout">
        <aside className="surface completed-list-panel">
          <div className="surface-head">
            <div>
              <div className="section-kicker">Done</div>
              <h2>
                결과 목록 <span className="count-badge">{items.length}</span>
              </h2>
            </div>
          </div>
          <div className="completed-list">
            {items.length === 0 && <div className="empty">완료된 항목이 없습니다.</div>}
            {items.map((item) => (
              <div key={item.id} className="completed-item">
                <strong>{item.title}</strong>
                <span>{item.agent}</span>
              </div>
            ))}
          </div>
        </aside>

        <section className="surface completed-detail" aria-live="polite">
          <div className="empty">완료 항목을 선택하면 상세 내용이 표시됩니다.</div>
        </section>
      </section>
    </main>
  );
}
