const state = {
  agents: [],
  selectedAgent: 'ceo',
  config: {},
  models: [],
  dashboard: null,
  sessionId: '',
  selectedTaskId: ''
};

const $ = (id) => document.getElementById(id);

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function fmtTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function taskAgent(task) {
  return state.agents.find((item) => item.id === task.agent) || state.agents[0] || {};
}

const officePositions = {
  ceo: { x: 13, y: 47 },
  youtube: { x: 27, y: 55 },
  developer: { x: 43, y: 50 },
  business: { x: 57, y: 48 },
  secretary: { x: 68, y: 56 },
  editor: { x: 78, y: 50 },
  designer: { x: 51, y: 70 },
  writer: { x: 34, y: 70 },
  researcher: { x: 87, y: 44 }
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || response.statusText);
  }
  return data;
}

function currentAgent() {
  return state.agents.find((agent) => agent.id === state.selectedAgent) || state.agents[0] || { id: 'ceo', name: 'CEO' };
}

function addMessage(kind, name, text) {
  const node = document.createElement('article');
  node.className = `message ${kind}`;
  node.innerHTML = `<div class="message-head">${escapeHtml(name)}</div><div>${escapeHtml(text)}</div>`;
  $('chatLog').appendChild(node);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  return node;
}

function renderAgentOptions() {
  ['taskAgent', 'approvalAgent'].forEach((id) => {
    const select = $(id);
    if (!select) return;
    select.innerHTML = '';
    state.agents.forEach((agent) => {
      const option = document.createElement('option');
      option.value = agent.id;
      option.textContent = agent.name;
      option.selected = agent.id === state.selectedAgent;
      select.appendChild(option);
    });
  });
}

function renderSidebarAgents() {
  const list = $('agentList');
  list.innerHTML = '';
  state.agents.forEach((agent) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `agent${agent.id === state.selectedAgent ? ' active' : ''}`;
    item.innerHTML = `
      <span class="agent-avatar small" style="--accent:${agent.accent}">
        ${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="">` : `<span>${escapeHtml(agent.emoji || '')}</span>`}
      </span>
      <span>
        <span class="agent-name">${escapeHtml(agent.name)}</span>
        <span class="agent-role">${escapeHtml(agent.role)}</span>
      </span>
      <span class="agent-status ${agent.active ? 'on' : ''}"></span>
    `;
    item.addEventListener('click', () => {
      state.selectedAgent = agent.id;
      renderAll();
    });
    list.appendChild(item);
  });
}

function renderTeam() {
  const grid = $('teamGrid');
  grid.innerHTML = '';
  state.agents.forEach((agent) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `team-card${agent.id === state.selectedAgent ? ' active' : ''}${agent.active ? '' : ' off'}`;
    card.style.setProperty('--accent', agent.accent || '#39d7ff');
    card.innerHTML = `
      <div class="portrait">
        ${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="${escapeHtml(agent.name)}">` : `<span>${escapeHtml(agent.emoji || '')}</span>`}
      </div>
      <div class="team-meta">
        <strong>${escapeHtml(agent.name)}</strong>
        <span>${escapeHtml(agent.role)}</span>
      </div>
      <div class="task-pill">${Number(agent.openTasks || 0)}</div>
    `;
    card.addEventListener('click', () => {
      state.selectedAgent = agent.id;
      renderAll();
    });
    grid.appendChild(card);
  });
}

function renderModels() {
  const select = $('modelSelect');
  select.innerHTML = '';
  const all = Array.from(new Set([state.config.defaultModel, ...state.models].filter(Boolean)));
  if (all.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '모델 없음';
    select.appendChild(option);
    return;
  }
  all.forEach((model) => {
    const option = document.createElement('option');
    option.value = model;
    option.textContent = model;
    option.selected = model === state.config.defaultModel;
    select.appendChild(option);
  });
}

function setLlmTestResult(kind, text) {
  const box = $('llmTestResult');
  if (!box) return;
  box.className = `test-result ${kind || ''}`;
  box.textContent = text || '';
}

function renderOfficeActivity() {
  const layer = $('officeAgents');
  if (!layer) return;
  const tasks = state.dashboard && state.dashboard.tasks ? state.dashboard.tasks.all : [];
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
  const byAgent = new Map();
  open.forEach((task) => {
    if (!byAgent.has(task.agent)) byAgent.set(task.agent, []);
    byAgent.get(task.agent).push(task);
  });
  const markers = Array.from(byAgent.entries()).map(([agentId, agentTasks]) => {
    const agent = state.agents.find((item) => item.id === agentId) || {};
    const task = agentTasks[0];
    const pos = officePositions[agentId] || { x: 50, y: 50 };
    const progress = task.progress || { percent: 0, label: '진행 중' };
    const title = `${agent.name || agentId}: ${task.title} (${progress.percent}%)`;
    return `
      <button class="office-agent-marker" data-task-id="${escapeHtml(task.id)}" title="${escapeHtml(title)}" style="--x:${pos.x};--y:${pos.y};--accent:${escapeHtml(agent.accent || '#22e58e')}">
        <span class="marker-avatar">${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="">` : escapeHtml(agent.emoji || '')}</span>
        <span class="marker-work">
          <strong>${escapeHtml(agent.name || agentId)}</strong>
          <em>${escapeHtml(progress.label)} · ${progress.percent}%</em>
        </span>
      </button>
    `;
  });
  layer.innerHTML = markers.join('');
  layer.querySelectorAll('[data-task-id]').forEach((button) => {
    button.addEventListener('click', () => selectTask(button.dataset.taskId));
  });
}

function renderTaskDetail() {
  const box = $('taskDetail');
  if (!box) return;
  const tasks = state.dashboard && state.dashboard.tasks ? state.dashboard.tasks.all : [];
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled');
  const selected = tasks.find((task) => task.id === state.selectedTaskId) || open[0] || tasks[0];
  if (!selected) {
    box.innerHTML = '<div class="empty">작업을 선택하면 진행 상황이 표시됩니다.</div>';
    return;
  }
  state.selectedTaskId = selected.id;
  const agent = taskAgent(selected);
  const progress = selected.progress || { percent: 0, label: '진행 중', timeline: [] };
  box.innerHTML = `
    <div class="detail-head">
      <span class="agent-avatar small" style="--accent:${escapeHtml(agent.accent || '#22e58e')}">
        ${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="">` : `<span>${escapeHtml(agent.emoji || '')}</span>`}
      </span>
      <div>
        <div class="section-kicker">Progress</div>
        <h3>${escapeHtml(selected.title)}</h3>
        <p>${escapeHtml(agent.name || selected.agent || 'Agent')} · ${escapeHtml(progress.label)} · ${escapeHtml(selected.priority || 'normal')}</p>
      </div>
    </div>
    <div class="progress-meter" aria-label="progress">
      <span style="width:${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%"></span>
    </div>
    <div class="progress-meta">
      <strong>${Number(progress.percent || 0)}%</strong>
      <span>${escapeHtml(progress.activity || '')}</span>
    </div>
    <ol class="progress-steps">
      ${(progress.timeline || []).map((step) => `
        <li class="${step.done ? 'done' : ''} ${step.current ? 'current' : ''}">
          <span></span>
          <strong>${escapeHtml(step.label)}</strong>
        </li>
      `).join('')}
    </ol>
  `;
}

function renderTasks() {
  const list = $('taskList');
  const tasks = state.dashboard && state.dashboard.tasks ? state.dashboard.tasks.all : [];
  const visible = tasks.filter((task) => task.status !== 'done' && task.status !== 'cancelled').slice(0, 12);
  if (visible.length === 0) {
    list.innerHTML = '<div class="empty">열린 작업이 없습니다.</div>';
    return;
  }
  list.innerHTML = visible.map((task) => {
    const agent = taskAgent(task);
    const disabled = task.source === 'company' ? ' disabled title="확장 tracker 작업은 웹에서 직접 수정하지 않습니다."' : '';
    const progress = task.progress || { percent: 0, label: '진행 중' };
    return `
      <article class="work-item priority-${escapeHtml(task.priority)} ${task.id === state.selectedTaskId ? 'selected' : ''}" data-task-row="${escapeHtml(task.id)}">
        <div class="work-main">
          <span class="work-dot" style="background:${escapeHtml(agent.accent || '#90a0a8')}"></span>
          <div>
            <strong>${escapeHtml(task.title)}</strong>
            <span>${escapeHtml(agent.name || task.agent || 'Agent')} · ${escapeHtml(progress.label)} · ${progress.percent}%</span>
            <div class="mini-progress"><span style="width:${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%"></span></div>
          </div>
        </div>
        <div class="item-actions">
          <button type="button" class="icon-btn" data-task="${escapeHtml(task.id)}" data-status="done"${disabled}>✓</button>
          <button type="button" class="icon-btn danger" data-task="${escapeHtml(task.id)}" data-status="cancelled"${disabled}>×</button>
        </div>
      </article>
    `;
  }).join('');
  list.querySelectorAll('[data-task-row]').forEach((row) => {
    row.addEventListener('click', () => selectTask(row.dataset.taskRow));
  });
  list.querySelectorAll('[data-task]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      updateTask(button.dataset.task, button.dataset.status);
    });
  });
  if (!state.selectedTaskId || !visible.some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = visible[0] ? visible[0].id : '';
  }
  renderTaskDetail();
}

function renderApprovals() {
  const list = $('approvalList');
  const approvals = state.dashboard && state.dashboard.approvals ? state.dashboard.approvals.all : [];
  const visible = approvals.filter((approval) => approval.status === 'pending').slice(0, 10);
  if (visible.length === 0) {
    list.innerHTML = '<div class="empty">승인 대기 항목이 없습니다.</div>';
    return;
  }
  list.innerHTML = visible.map((approval) => {
    const agent = state.agents.find((item) => item.id === approval.agent) || {};
    return `
      <article class="approval-item">
        <div class="work-main">
          <span class="approval-kind">${escapeHtml(approval.kind || 'general')}</span>
          <div>
            <strong>${escapeHtml(approval.title)}</strong>
            <span>${escapeHtml(agent.name || approval.agent || 'Agent')} · ${fmtTime(approval.createdAt)}</span>
            <p>${escapeHtml(approval.summary || '')}</p>
          </div>
        </div>
        <div class="item-actions">
          <button type="button" class="icon-btn" data-approval="${escapeHtml(approval.id)}" data-status="approved">✓</button>
          <button type="button" class="icon-btn danger" data-approval="${escapeHtml(approval.id)}" data-status="rejected">×</button>
        </div>
      </article>
    `;
  }).join('');
  list.querySelectorAll('[data-approval]').forEach((button) => {
    button.addEventListener('click', () => updateApproval(button.dataset.approval, button.dataset.status));
  });
}

function renderEvents() {
  const events = state.dashboard ? state.dashboard.events || [] : [];
  const list = $('eventsList');
  if (events.length === 0) {
    list.innerHTML = '<div class="empty">아직 이벤트가 없습니다.</div>';
    return;
  }
  list.innerHTML = events.map((event) => `
    <div class="event-row">
      <span>${escapeHtml(event.type)}</span>
      <strong>${escapeHtml(event.title)}</strong>
      <time>${fmtTime(event.createdAt)}</time>
    </div>
  `).join('');
}

function renderBrain(files) {
  const box = $('brainResults');
  const items = files || [];
  if (items.length === 0) {
    box.innerHTML = '<div class="empty">검색 결과가 없습니다.</div>';
    return;
  }
  box.innerHTML = items.slice(0, 8).map((file) => `
    <article class="brain-result" title="${escapeHtml(file.path)}">
      <strong>${escapeHtml(file.title || file.path)}</strong>
      <span>${escapeHtml(file.path)}</span>
      <p>${escapeHtml(file.snippet || '')}</p>
    </article>
  `).join('');
}

function renderAll() {
  const dashboard = state.dashboard || {};
  state.agents = dashboard.agents || state.agents || [];
  state.config = dashboard.config || state.config || {};

  $('companyName').textContent = dashboard.company || 'Connect AI Company';
  $('serverState').textContent = dashboard.version ? `${dashboard.version} online` : 'online';
  $('brainState').textContent = dashboard.brain ? `${dashboard.brain.fileCount}${dashboard.brain.capped ? '+' : ''} files` : '-';
  $('sessionState').textContent = state.sessionId ? state.sessionId.slice(-8) : 'new';
  $('kpiOpen').textContent = dashboard.tasks ? dashboard.tasks.open : 0;
  $('kpiApprovals').textContent = dashboard.approvals ? dashboard.approvals.pending : 0;
  $('kpiBrain').textContent = dashboard.brain ? dashboard.brain.fileCount : 0;
  $('kpiSessions').textContent = Array.isArray(dashboard.sessions) ? dashboard.sessions.length : 0;
  $('selectedAgentName').textContent = currentAgent().name || 'CEO';
  $('ollamaBase').value = state.config.ollamaBase || '';
  $('brainPath').value = state.config.localBrainPath || '';

  renderSidebarAgents();
  renderAgentOptions();
  renderTeam();
  renderOfficeActivity();
  renderTasks();
  renderApprovals();
  renderEvents();
  renderModels();
}

async function selectTask(id) {
  if (!id) return;
  state.selectedTaskId = id;
  try {
    const data = await api(`/api/tasks/${encodeURIComponent(id)}`);
    if (data.task && state.dashboard && state.dashboard.tasks) {
      const tasks = state.dashboard.tasks.all || [];
      const index = tasks.findIndex((task) => task.id === data.task.id);
      if (index >= 0) tasks[index] = data.task;
    }
  } catch {
    // The dashboard copy is enough for company-sourced tasks if detail lookup fails.
  }
  renderTasks();
  renderOfficeActivity();
}

async function refreshDashboard() {
  state.dashboard = await api('/api/dashboard');
  state.agents = state.dashboard.agents || [];
  state.config = state.dashboard.config || {};
  if (!state.agents.some((agent) => agent.id === state.selectedAgent)) {
    state.selectedAgent = state.agents[0] ? state.agents[0].id : 'ceo';
  }
  renderAll();
}

async function refreshModels() {
  try {
    const data = await api('/api/models');
    state.models = data.models || [];
    state.config.defaultModel = data.defaultModel || state.config.defaultModel || '';
    renderModels();
  } catch (error) {
    state.models = [];
    renderModels();
    addMessage('error', 'Model check', `모델 목록을 가져오지 못했습니다.\n${error.message}`);
  }
}

async function testLlmConnection() {
  const button = $('testLlm');
  button.disabled = true;
  setLlmTestResult('pending', 'LLM 연결 테스트 중...');
  try {
    const response = await fetch('/api/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ollamaBase: $('ollamaBase').value.trim(),
        model: $('modelSelect').value.trim(),
        chatTimeoutMs: 12000
      })
    });
    const result = await response.json().catch(() => ({}));
    const stageText = Array.isArray(result.stages)
      ? result.stages.map((stage) => `${stage.name}:${stage.ok ? 'ok' : 'fail'}`).join(' · ')
      : '';
    if (result.connected) {
      const text = `연결 성공 · ${result.provider || 'LLM'} · ${result.model} · ${result.latencyMs}ms`;
      setLlmTestResult('ok', text);
      addMessage('system', 'LLM Test', `${text}\n${stageText}`);
    } else {
      const text = `연결 실패 · ${result.model || $('modelSelect').value || '모델 없음'} · ${result.error || '알 수 없는 오류'}`;
      setLlmTestResult('error', text);
      addMessage('error', 'LLM Test', `${text}\n${stageText}`);
    }
    await refreshDashboard();
  } catch (error) {
    setLlmTestResult('error', `연결 실패 · ${error.message}`);
    addMessage('error', 'LLM Test', error.message);
  } finally {
    button.disabled = false;
  }
}

async function saveConfig() {
  const payload = {
    ollamaBase: $('ollamaBase').value.trim(),
    defaultModel: $('modelSelect').value.trim(),
    localBrainPath: $('brainPath').value.trim()
  };
  const result = await api('/api/config', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  state.config = result.config;
  addMessage('system', 'Saved', '웹 앱 설정을 저장했습니다.');
  await refreshDashboard();
  await refreshModels();
}

async function createTask(event) {
  event.preventDefault();
  const title = $('taskTitle').value.trim();
  if (!title) return;
  await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      agent: $('taskAgent').value,
      priority: $('taskPriority').value
    })
  });
  $('taskTitle').value = '';
  await refreshDashboard();
}

async function updateTask(id, status) {
  await api(`/api/tasks/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
  await refreshDashboard();
}

async function createApproval(event) {
  event.preventDefault();
  const title = $('approvalTitle').value.trim();
  if (!title) return;
  await api('/api/approvals', {
    method: 'POST',
    body: JSON.stringify({
      title,
      agent: $('approvalAgent').value,
      kind: $('approvalKind').value.trim() || 'general',
      summary: $('approvalSummary').value.trim()
    })
  });
  $('approvalTitle').value = '';
  $('approvalSummary').value = '';
  await refreshDashboard();
}

async function updateApproval(id, status) {
  await api(`/api/approvals/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ status })
  });
  await refreshDashboard();
}

async function searchBrain(event) {
  event.preventDefault();
  const query = $('brainQuery').value.trim();
  if (!query) return;
  const result = await api(`/api/brain/search?q=${encodeURIComponent(query)}`);
  renderBrain(result.files || []);
}

async function sendMessage(message) {
  const selected = currentAgent();
  addMessage('user', 'You', message);
  const pending = addMessage('system', selected ? selected.name : 'Connect AI', '생각 중...');
  $('sendButton').disabled = true;

  try {
    const result = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({
        message,
        sessionId: state.sessionId,
        model: $('modelSelect').value,
        agent: state.selectedAgent,
        useBrain: $('useBrain').checked
      })
    });
    state.sessionId = result.sessionId || state.sessionId;
    pending.className = 'message';
    const sources = result.sources && result.sources.length ? `\n\n출처\n${result.sources.join('\n')}` : '';
    pending.innerHTML = `<div class="message-head">${escapeHtml(selected ? selected.name : 'Connect AI')}</div><div>${escapeHtml((result.text || '(빈 응답)') + sources)}</div>`;
    await refreshDashboard();
  } catch (error) {
    pending.className = 'message error';
    pending.innerHTML = `<div class="message-head">Error</div><div>${escapeHtml(error.message)}</div>`;
  } finally {
    $('sendButton').disabled = false;
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
  }
}

function bindEvents() {
  $('saveConfig').addEventListener('click', () => {
    saveConfig().catch((error) => addMessage('error', 'Save failed', error.message));
  });
  $('refreshModels').addEventListener('click', () => {
    refreshModels().catch((error) => addMessage('error', 'Refresh failed', error.message));
  });
  $('testLlm').addEventListener('click', () => {
    testLlmConnection().catch((error) => addMessage('error', 'LLM Test failed', error.message));
  });
  $('refreshDashboard').addEventListener('click', () => {
    refreshDashboard().catch((error) => addMessage('error', 'Refresh failed', error.message));
  });
  $('taskForm').addEventListener('submit', (event) => {
    createTask(event).catch((error) => addMessage('error', 'Task failed', error.message));
  });
  $('approvalForm').addEventListener('submit', (event) => {
    createApproval(event).catch((error) => addMessage('error', 'Approval failed', error.message));
  });
  $('brainSearchForm').addEventListener('submit', (event) => {
    searchBrain(event).catch((error) => addMessage('error', 'Search failed', error.message));
  });
  $('chatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const message = $('messageInput').value.trim();
    if (!message) return;
    $('messageInput').value = '';
    sendMessage(message);
  });
  $('messageInput').addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      $('chatForm').requestSubmit();
    }
  });
}

async function boot() {
  bindEvents();
  addMessage('system', 'Connect AI Web', '웹사이트 모드로 운영실을 시작했습니다.');
  await refreshDashboard();
  await refreshModels();
  const brain = await api('/api/brain');
  renderBrain(brain.files || []);
}

boot().catch((error) => {
  $('serverState').textContent = 'offline';
  addMessage('error', 'Boot failed', error.message);
});
