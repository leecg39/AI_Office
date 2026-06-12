'use client';

import { useEffect, useState } from 'react';

export default function CompletedPage() {
  const [items, setItems] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((data) => {
        const allTasks = data?.tasks?.all || [];
        setItems(allTasks.filter((t: any) => t.status === 'done' || t.status === 'completed'));
      })
      .catch((err) => console.error('Failed to load completed tasks', err));
  }, []);

  const selected = items.find((i) => i.id === selectedId) || null;

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
              <button
                key={item.id}
                type="button"
                className={`completed-item${selectedId === item.id ? ' selected' : ''}`}
                onClick={() => setSelectedId(item.id)}
              >
                <div className="completed-item-main">
                  <strong>{item.title}</strong>
                  <span>{item.agent}</span>
                </div>
              </button>
            ))}
          </div>
        </aside>

        <section className="surface completed-detail" aria-live="polite">
          {!selected ? (
            <div className="empty">완료 항목을 선택하면 상세 내용이 표시됩니다.</div>
          ) : (
            <>
              <div className="surface-head">
                <div>
                  <div className="section-kicker">Detail</div>
                  <h2>{selected.title}</h2>
                </div>
              </div>
              <div className="completed-detail-head">
                <div className="marker-avatar small" style={{ ['--accent' as any]: '#22e58e' }}>
                  <span>✅</span>
                </div>
                <div>
                  <p className="completed-description">
                    <strong>에이전트:</strong> {selected.agent} · <strong>상태:</strong> {selected.status}
                    {selected.createdAt ? ` · ${new Date(selected.createdAt).toLocaleDateString('ko-KR')}` : ''}
                  </p>
                </div>
              </div>
              {selected.description && (
                <div className="completed-result">
                  <div className="section-kicker">Description</div>
                  <p style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{selected.description}</p>
                </div>
              )}
            </>
          )}
        </section>
      </section>
    </main>
  );
}
