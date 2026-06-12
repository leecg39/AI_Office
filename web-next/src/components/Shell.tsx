'use client';

import { useEffect, useRef, useState } from 'react';

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
  commandRoutes?: { id: string; from: string; to: string; title: string }[];
}

export default function Shell() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [selectedAgent, setSelectedAgent] = useState('ceo');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [resultCollapsed, setResultCollapsed] = useState(true);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [dragging, setDragging] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const positionsRef = useRef(positions);
  positionsRef.current = positions;

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

  const openTasks = (dashboard?.tasks?.all || []).filter(
    (t: any) => !['done', 'cancelled', 'failed'].includes(t.status || 'open')
  );
  const openTasksByAgent = new Map<string, any[]>();
  openTasks.forEach((task: any) => {
    const aid = task.agent || '';
    if (!openTasksByAgent.has(aid)) openTasksByAgent.set(aid, []);
    openTasksByAgent.get(aid)!.push(task);
  });
  const workingAgents = agents.filter((a) => openTasksByAgent.has(a.id));

  function flowPathForPosition(pos: { x: number; y: number }, index: number, total: number) {
    const step = total > 1 ? 28 / (total - 1) : 0;
    const startX = 36 + index * step;
    const startY = 90;
    const targetX = Math.min(98, Math.max(2, pos.x));
    const targetY = Math.min(95, Math.max(5, pos.y + 5));
    const elbowY = Math.min(86, Math.max(28, (startY + targetY) / 2));
    return `M ${startX.toFixed(2)} ${startY.toFixed(2)} L ${startX.toFixed(2)} ${elbowY.toFixed(2)} L ${targetX.toFixed(2)} ${elbowY.toFixed(2)} L ${targetX.toFixed(2)} ${targetY.toFixed(2)}`;
  }

  function commandPathForPositions(from: { x: number; y: number }, to: { x: number; y: number }) {
    const sourceX = Math.min(98, Math.max(2, from.x));
    const sourceY = Math.min(95, Math.max(5, from.y));
    const targetX = Math.min(98, Math.max(2, to.x));
    const targetY = Math.min(95, Math.max(5, to.y));
    const midX = (sourceX + targetX) / 2;
    const midY = (sourceY + targetY) / 2;
    const controlX = midX;
    const controlY = Math.min(92, Math.max(8, midY - 14));
    return `M ${sourceX.toFixed(2)} ${sourceY.toFixed(2)} Q ${controlX.toFixed(2)} ${controlY.toFixed(2)} ${targetX.toFixed(2)} ${targetY.toFixed(2)}`;
  }

  const handleTaskSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const title = (form.querySelector('#taskTitle') as HTMLTextAreaElement)?.value.trim();
    const agent = (form.querySelector('#taskAgent') as HTMLSelectElement)?.value;
    const fromAgent = (form.querySelector('#taskFromAgent') as HTMLSelectElement)?.value;
    const priority = (form.querySelector('#taskPriority') as HTMLSelectElement)?.value;
    if (!title) return;
    try {
      await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description: title, agent, fromAgent, priority, autoRun: true }),
      });
      const res = await fetch('/api/dashboard');
      const data = await res.json();
      setDashboard(data);
    } catch (err) {
      console.error('Task creation failed', err);
    }
    (form.querySelector('#taskTitle') as HTMLTextAreaElement).value = '';
  };

  // Load saved positions from localStorage once dashboard data arrives
  useEffect(() => {
    if (!dashboard) return;
    const saved = typeof window !== 'undefined' ? localStorage.getItem('office-agent-positions') : null;
    const savedMap = saved ? JSON.parse(saved) : {};
    const initial: Record<string, { x: number; y: number }> = {};
    for (const agent of dashboard.agents) {
      initial[agent.id] = savedMap[agent.id] ?? { x: agent.x ?? 50, y: agent.y ?? 50 };
    }
    setPositions(initial);
  }, [dashboard]);

  const handleMouseDown = (e: React.MouseEvent, agentId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragging(agentId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragging || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    const next = { x: Math.max(0, Math.min(100, x)), y: Math.max(0, Math.min(100, y)) };
    setPositions((prev) => ({ ...prev, [dragging]: next }));
  };

  const handleMouseUp = () => {
    if (dragging) {
      localStorage.setItem('office-agent-positions', JSON.stringify(positionsRef.current));
    }
    setDragging(null);
  };

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
              <div
                className="office-map"
                ref={containerRef}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <img src="/assets/office.png" alt="Connect AI office map" />
                <svg
                  id="officeFlow"
                  className={`office-flow${workingAgents.length === 0 ? ' idle' : ''}`}
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <marker
                      id="flowArrow"
                      markerWidth="5"
                      markerHeight="5"
                      refX="3.9"
                      refY="2.5"
                      orient="auto"
                      markerUnits="strokeWidth"
                    >
                      <path d="M 0 0 L 5 2.5 L 0 5 Z" fill="#eaffff" />
                    </marker>
                  </defs>
                  {workingAgents.map((agent, index) => {
                    const tasks = openTasksByAgent.get(agent.id) || [];
                    const task = tasks[0] || {};
                    const pos = { x: positions[agent.id]?.x ?? agent.x ?? 50, y: positions[agent.id]?.y ?? agent.y ?? 50 };
                    const path = flowPathForPosition(pos, index, workingAgents.length);
                    const routeId = `flow-route-${agent.id.replace(/[^a-z0-9]/gi, '-')}`;
                    const accent = agent.accent || '#35c8ff';
                    const delay = `${(index * -0.32).toFixed(2)}s`;
                    const titleText = task.title ? `${agent.name}: ${task.title}` : `${agent.name}: 작업 중`;
                    return (
                      <g key={agent.id} className="flow-route" style={{ ['--accent' as any]: accent, ['--delay' as any]: delay }}>
                        <title>{titleText}</title>
                        <path id={routeId} className="flow-motion-path" d={path} />
                        <path className="flow-track" d={path} />
                        <path className="flow-line" d={path} />
                        <path className="flow-pulse" d={path} />
                        {[0, 1.55, 3.1].map((offset) => (
                          <polygon key={offset} className="flow-runner" points="-0.6,-0.48 1.15,0 -0.6,0.48">
                            <animateMotion
                              dur="8s"
                              begin={`${(index * 0.18 + offset).toFixed(2)}s`}
                              repeatCount="indefinite"
                              rotate="auto"
                            >
                              <mpath href={`#${routeId}`} />
                            </animateMotion>
                          </polygon>
                        ))}
                        <path className="flow-direction" d={path} markerEnd="url(#flowArrow)" />
                        <circle className="flow-node" cx={pos.x.toFixed(2)} cy={pos.y.toFixed(2)} r="1.1" />
                      </g>
                    );
                  })}
                  {(dashboard?.commandRoutes || []).map((route, index) => {
                    const fromAgent = agents.find((a) => a.id === route.from);
                    const toAgent = agents.find((a) => a.id === route.to);
                    if (!fromAgent || !toAgent) return null;
                    const fromPos = {
                      x: positions[fromAgent.id]?.x ?? fromAgent.x ?? 50,
                      y: positions[fromAgent.id]?.y ?? fromAgent.y ?? 50,
                    };
                    const toPos = {
                      x: positions[toAgent.id]?.x ?? toAgent.x ?? 50,
                      y: positions[toAgent.id]?.y ?? toAgent.y ?? 50,
                    };
                    const path = commandPathForPositions(fromPos, toPos);
                    const routeId = `command-route-${route.id.replace(/[^a-z0-9]/gi, '-')}`;
                    const accent = fromAgent.accent || '#eaffff';
                    return (
                      <g key={route.id} className="command-route" style={{ ['--accent' as any]: accent }}>
                        <title>{`${fromAgent.name} → ${toAgent.name}: ${route.title}`}</title>
                        <path id={routeId} className="command-motion-path" d={path} />
                        <path className="command-track" d={path} />
                        <path className="command-line" d={path} markerEnd="url(#flowArrow)" />
                        <circle className="command-node" cx={toPos.x.toFixed(2)} cy={toPos.y.toFixed(2)} r="0.9" />
                      </g>
                    );
                  })}
                </svg>
                <div id="officeAgents" className="office-agents" aria-label="Agent work activity">
                  {agents.map((agent) => (
                    <div
                      key={agent.id}
                      className={`office-agent-marker${dragging === agent.id ? ' dragging' : ''}`}
                      style={{ left: `${positions[agent.id]?.x ?? agent.x ?? 50}%`, top: `${positions[agent.id]?.y ?? agent.y ?? 50}%`, ['--accent' as any]: agent.accent || '#35c8ff' }}
                      onMouseDown={(e) => handleMouseDown(e, agent.id)}
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
                <form id="taskForm" className="task-form" onSubmit={handleTaskSubmit}>
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
                    <select id="taskFromAgent" aria-label="From Agent">
                      <option value="">명령 에이전트 (선택)</option>
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
