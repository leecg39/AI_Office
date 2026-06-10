'use client';

import { useEffect, useState } from 'react';

interface Agent {
  id: string;
  name: string;
  role: string;
  emoji: string;
  accent: string;
  avatar: string;
  active: boolean;
  openTasks: number;
  x?: number;
  y?: number;
}

interface Dashboard {
  ok: boolean;
  company: string;
  agents: Agent[];
  tasks: { open: number; urgent: number };
  approvals: { pending: number };
  brain: { fileCount: number; capped: boolean };
  sessions: { id: string; title: string }[];
  events: { title: string; createdAt: string }[];
}

export default function Shell() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedAgent, setSelectedAgent] = useState('ceo');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resultCollapsed, setResultCollapsed] = useState(true);

  useEffect(() => {
    document.body.classList.toggle('result-collapsed', resultCollapsed);
    return () => {
      document.body.classList.remove('result-collapsed');
    };
  }, [resultCollapsed]);

  useEffect(() => {
    document.body.classList.toggle('sidebar-collapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  useEffect(() => {
    fetch('/api/dashboard')
      .then((r) => r.json())
      .then((data) => setDashboard(data))
      .catch((err) => console.error('Dashboard fetch failed', err));
  }, []);

  const agents = dashboard?.agents || [];
  const currentAgent = agents.find((a) => a.id === selectedAgent) || agents[0];

  return (
    <>
      <div className="shell">
        <aside className="sidebar">
          <button
            id="sidebarToggle"
            type="button"
            className="sidebar-toggle"
            aria-label={sidebarCollapsed ? '패널 열기' : '패널 닫기'}
            aria-expanded={!sidebarCollapsed}
            onClick={() => setSidebarCollapsed((c) => !c)}
          >
            {sidebarCollapsed ? '›' : '‹'}
          </button>
          <div className="brand-row">
            <button id="brandHome" type="button" className="brand-home" aria-label="홈 화면으로 이동">
              <img className="brand-logo" src="/assets/petasos-logo.png" alt="Petasos" />
            </button>
          </div>

          <section className="panel">
            <div className="panel-title">Dashboard</div>
            <div className="kpi-grid sidebar-kpi-grid">
              <div className="kpi">
                <span>Open Tasks</span>
                <strong id="kpiOpen">{dashboard?.tasks?.open ?? 0}</strong>
              </div>
              <div className="kpi">
                <span>Approvals</span>
                <strong id="kpiApprovals">{dashboard?.approvals?.pending ?? 0}</strong>
              </div>
              <div className="kpi">
                <span>Brain Files</span>
                <strong id="kpiBrain">{dashboard?.brain?.fileCount ?? 0}{dashboard?.brain?.capped ? '+' : ''}</strong>
              </div>
              <div className="kpi">
                <span>Sessions</span>
                <strong id="kpiSessions">{dashboard?.sessions?.length ?? 0}</strong>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-title">Agents</div>
            <div id="agentList" className="agent-list">
              {agents.map((agent) => (
                <button
                  key={agent.id}
                  type="button"
                  className={`agent${agent.id === selectedAgent ? ' active' : ''}`}
                  onClick={() => setSelectedAgent(agent.id)}
                >
                  <span
                    className="agent-avatar small"
                    style={{ ['--accent' as any]: agent.accent || '#35c8ff' }}
                  >
                    {agent.avatar ? (
                      <img
                        src={agent.avatar}
                        alt=""
                        style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => { console.error('Sidebar avatar img failed:', agent.avatar); (e.target as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <span>{agent.emoji || ''}</span>
                    )}
                  </span>
                  <span>
                    <span className="agent-name">{agent.name}</span>
                    <span className="agent-role">{agent.role}</span>
                  </span>
                  <span className={`agent-status${agent.active ? ' on' : ''}`}></span>
                </button>
              ))}
            </div>
          </section>

          <section className="panel runtime-panel">
            <div className="panel-title">Runtime</div>
            <div className="kv">
              <span>Server</span>
              <strong id="serverState">{dashboard ? 'ok' : 'checking'}</strong>
            </div>
            <div className="kv">
              <span>Brain</span>
              <strong id="brainState">{dashboard?.brain?.path ? 'connected' : '-'}</strong>
            </div>
            <div className="kv">
              <span>Session</span>
              <strong id="sessionState">new</strong>
            </div>
          </section>
        </aside>

        <main className="main">
          <header className="topbar">
            <div>
              <p id="companyName" className="eyebrow">
                {dashboard?.company || 'AI Company'}
              </p>
            </div>
            <div className="topbar-actions">
              <a href="/completed" className="secondary nav-link">
                완료
              </a>
              <button id="apiPanelToggle" type="button" className="secondary api-toggle">
                API
              </button>
            </div>
          </header>

          <section id="agentManagerView" className="agent-manager hidden" aria-live="polite"></section>

          <div id="dashboardView" className="dashboard-view">
            <section className="overview">
              <div className="office-map">
                <img src="/assets/office.png" alt="Connect AI office map" />
                <svg
                  id="officeFlow"
                  className="office-flow"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                ></svg>
                <div id="officeAgents" className="office-agents" aria-label="Agent work activity">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      className="office-agent-marker"
                      style={{ left: `${agent.x ?? 50}%`, top: `${agent.y ?? 50}%`, ['--accent' as any]: agent.accent || '#35c8ff' }}
                    >
                      <div className="marker-avatar">
                        {agent.avatar ? (
                          <img
                            src={agent.avatar}
                            alt={agent.name}
                            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
                            onError={(e) => { console.error('Office marker img failed:', agent.avatar); (e.target as HTMLImageElement).style.display = 'none'; }}
                          />
                        ) : (
                          <span>{agent.emoji || ''}</span>
                        )}
                      </div>
                      <div className="marker-work">
                        <strong>{agent.name}</strong>
                        <em>{agent.role}</em>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="office-copy">
                  <span id="selectedAgentName">{currentAgent?.name || 'CEO'}</span>
                  <strong>Virtual Office</strong>
                </div>
              </div>
            </section>

            <div className="work-grid">
              <section className="surface">
                <div className="surface-head">
                  <div>
                    <div className="section-kicker">Work Queue</div>
                    <h2>작업</h2>
                  </div>
                  <button id="refreshDashboard" type="button" className="secondary small">
                    Refresh
                  </button>
                </div>
                <form id="taskForm" className="task-form">
                  <textarea
                    id="taskTitle"
                    className="task-context-input"
                    rows={4}
                    placeholder="작업 내용 / 컨텍스트"
                  ></textarea>
                  <div className="task-controls">
                    <select id="taskAgent" aria-label="Agent">
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <select id="taskPriority" aria-label="Priority">
                      <option value="normal">normal</option>
                      <option value="high">high</option>
                      <option value="urgent">urgent</option>
                      <option value="low">low</option>
                    </select>
                    <button type="submit">Add</button>
                  </div>
                </form>
                <div id="taskList" className="item-list"></div>
                <aside id="taskDetail" className="task-detail" aria-live="polite"></aside>
              </section>

              <section className="surface chat-surface">
                <div className="surface-head">
                  <div>
                    <div className="section-kicker">Agent Console</div>
                    <h2>채팅</h2>
                  </div>
                  <label className="brain-toggle">
                    <input id="useBrain" type="checkbox" /> Brain
                  </label>
                </div>
                <section id="chatLog" className="chat-log" aria-live="polite"></section>
                <form id="chatForm" className="composer">
                  <textarea
                    id="messageInput"
                    rows={3}
                    placeholder="예: 오늘 AI 뉴스 5개를 근거 URL과 함께 정리해줘"
                  ></textarea>
                  <div className="composer-footer">
                    <span id="hint">Enter 전송 · Shift+Enter 줄바꿈 · 한글 조합 중 Enter는 전송하지 않음</span>
                    <button id="sendButton" type="submit">
                      Send
                    </button>
                  </div>
                </form>
              </section>
            </div>

            <section className="team-carousel" aria-label="Agent team">
              <button id="teamPrev" type="button" className="team-nav" aria-label="이전 에이전트">
                ‹
              </button>
              <div id="teamGrid" className="team-grid" tabIndex={0}>
                {agents.map((agent) => (
                  <button
                    key={agent.id}
                    type="button"
                    className={`team-card${agent.id === selectedAgent ? ' active' : ''}${agent.active ? '' : ' off'}`}
                    style={{ ['--accent' as any]: agent.accent || '#39d7ff' }}
                    onClick={() => setSelectedAgent(agent.id)}
                  >
                    <div className="portrait">
                      {agent.avatar ? (
                        <img
                          src={agent.avatar}
                          alt={agent.name}
                          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => { console.error('Team card portrait img failed:', agent.avatar); (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ) : (
                        <span>{agent.emoji || ''}</span>
                      )}
                    </div>
                    <div className="team-meta">
                      <strong>{agent.name}</strong>
                      <span>{agent.role}</span>
                    </div>
                    <div className="task-pill">{agent.openTasks || 0}</div>
                  </button>
                ))}
              </div>
              <button id="teamNext" type="button" className="team-nav" aria-label="다음 에이전트">
                ›
              </button>
            </section>

            <div className="work-grid bottom-grid">
              <section className="surface">
                <div className="surface-head">
                  <div>
                    <div className="section-kicker">Second Brain</div>
                    <h2>검색</h2>
                  </div>
                </div>
                <form id="brainSearchForm" className="search-form">
                  <input id="brainQuery" placeholder="지식 파일 검색어" />
                  <button type="submit">Search</button>
                  <button type="button" id="autoResearchButton" className="secondary">
                    Research
                  </button>
                  <button type="button" id="xResearchButton" className="secondary">
                    X Search
                  </button>
                  <button type="button" id="threadsResearchButton" className="secondary">
                    Threads
                  </button>
                  <button type="button" id="instagramResearchButton" className="secondary">
                    Instagram
                  </button>
                  <button type="button" id="linkedinResearchButton" className="secondary">
                    LinkedIn
                  </button>
                  <button type="button" id="youtubeResearchButton" className="secondary">
                    YouTube
                  </button>
                </form>
                <div id="brainResults" className="brain-results"></div>
              </section>

              <section className="surface">
                <div className="surface-head">
                  <div>
                    <div className="section-kicker">Approval Gate</div>
                    <h2>승인</h2>
                  </div>
                </div>
                <form id="approvalForm" className="stack-form">
                  <input id="approvalTitle" placeholder="승인 제목" />
                  <div className="split">
                    <select id="approvalAgent">
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name}
                        </option>
                      ))}
                    </select>
                    <input id="approvalKind" placeholder="kind" defaultValue="general" />
                  </div>
                  <textarea id="approvalSummary" rows={3} placeholder="승인 내용 요약"></textarea>
                  <button type="submit">Queue</button>
                </form>
                <div id="approvalList" className="item-list"></div>
              </section>
            </div>

            <section className="surface events-surface">
              <div className="surface-head">
                <div>
                  <div className="section-kicker">Activity</div>
                  <h2>최근 이벤트</h2>
                </div>
              </div>
              <div id="eventsList" className="events-list">
                {(dashboard?.events || []).map((event, idx) => (
                  <div key={idx} className="event-item">
                    <span>{event.title}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </main>

        <aside id="resultPanel" className="result-panel surface" aria-live="polite">
          <div className="surface-head">
            <div>
              <div className="section-kicker">Result</div>
              <h2>결과물</h2>
            </div>
            <div className="result-panel-actions">
              <button id="resultRefresh" type="button" className="secondary small">
                Refresh
              </button>
              <a id="resultBack" href="/completed" className="secondary small result-back-link">
                이전
              </a>
            </div>
          </div>
          <div id="resultPanelBody" className="result-panel-body">
            <div className="empty">작업을 선택하면 결과물이 여기에 표시됩니다.</div>
          </div>
        </aside>
        <button
          id="resultPanelToggle"
          type="button"
          className="result-panel-toggle"
          aria-label={resultCollapsed ? '결과 패널 열기' : '결과 패널 닫기'}
          aria-expanded={!resultCollapsed}
          onClick={() => setResultCollapsed((c) => !c)}
        >
          {resultCollapsed ? '‹' : '›'}
        </button>
      </div>

      <div id="apiPanel" className="api-panel hidden" aria-hidden="true">
        <button className="api-backdrop" type="button" data-close-api aria-label="닫기"></button>
        <section className="api-dialog" role="dialog" aria-modal="true" aria-labelledby="apiPanelTitle">
          <div className="api-head">
            <div>
              <div className="section-kicker">LLM API</div>
              <h2 id="apiPanelTitle">연결</h2>
            </div>
            <button id="apiPanelClose" type="button" className="secondary small">
              Close
            </button>
          </div>
          <section className="api-settings">
            <div className="panel-title">Settings</div>
            <label className="field">
              <span>LLM URL</span>
              <input id="ollamaBase" autoComplete="off" />
            </label>
            <label className="field">
              <span>Model</span>
              <select id="modelSelect"></select>
            </label>
            <label className="field">
              <span>Brain Folder</span>
              <input id="brainPath" autoComplete="off" />
            </label>
            <div className="button-row settings-actions">
              <button id="saveConfig" type="button">
                Save
              </button>
              <button id="refreshModels" type="button" className="secondary">
                Refresh
              </button>
              <button id="testLlm" type="button" className="secondary">
                LLM Test
              </button>
            </div>
            <div id="llmTestResult" className="test-result" aria-live="polite"></div>
          </section>
          <div id="apiProviderList" className="api-provider-list"></div>
          <div id="apiPanelResult" className="test-result" aria-live="polite"></div>
        </section>
      </div>
    </>
  );
}
