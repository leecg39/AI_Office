const state = {
  agents: [],
  selectedAgent: 'ceo',
  config: {},
  models: [],
  auth: {},
  providers: [],
  providerIssues: {},
  dashboard: null,
  sessionId: '',
  selectedTaskId: '',
  runningTaskIds: new Set(),
  resultExport: { status: '', message: '' }
};

const $ = (id) => document.getElementById(id);
const APP_CURRENT_URL_KEY = 'connect-ai-current-url';
const APP_PREVIOUS_URL_KEY = 'connect-ai-previous-url';

function sameOriginHref(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin ? url.href : '';
  } catch {
    return '';
  }
}

function rememberInternalRoute() {
  try {
    const current = window.location.href;
    const savedCurrent = sameOriginHref(sessionStorage.getItem(APP_CURRENT_URL_KEY) || '');
    if (savedCurrent && savedCurrent !== current) {
      sessionStorage.setItem(APP_PREVIOUS_URL_KEY, savedCurrent);
    }
    sessionStorage.setItem(APP_CURRENT_URL_KEY, current);
  } catch {
    // Session storage can be disabled in private or restricted contexts.
  }
}

function previousInternalRoute() {
  try {
    const savedPrevious = sameOriginHref(sessionStorage.getItem(APP_PREVIOUS_URL_KEY) || '');
    if (savedPrevious && savedPrevious !== window.location.href) return savedPrevious;
  } catch {
    // Fall through to referrer and final fallback.
  }
  const referrer = sameOriginHref(document.referrer || '');
  if (referrer && referrer !== window.location.href) return referrer;
  return `${window.location.origin}/completed`;
}

function updateResultBackLink() {
  const link = $('resultBack');
  if (!link) return;
  link.href = previousInternalRoute();
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function safeDomId(value) {
  return String(value || 'item').replace(/[^a-zA-Z0-9_-]/g, '-');
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

function allDashboardTasks() {
  return state.dashboard && state.dashboard.tasks ? state.dashboard.tasks.all || [] : [];
}

function taskHasResultPayload(task) {
  return Boolean(task && (task.result || task.error));
}

function selectedTask() {
  const tasks = allDashboardTasks();
  const selected = tasks.find((task) => task.id === state.selectedTaskId);
  if (taskHasResultPayload(selected)) return selected;
  return tasks.find((task) => task.status === 'done' && task.result)
    || tasks.find(taskHasResultPayload)
    || selected
    || tasks[0]
    || null;
}

function resultPathItems(exports = {}) {
  return [
    exports.pdfPath ? { type: 'PDF', path: exports.pdfPath } : null,
    exports.markdownPath ? { type: 'Vault', path: exports.markdownPath } : null
  ].filter(Boolean);
}

function renderResultPathLinks(exports = {}) {
  const items = resultPathItems(exports);
  if (!items.length) return '';
  return `
    <div class="result-paths">
      ${items.map((item) => `
        <details class="result-path-item">
          <summary class="result-path-link">
            <strong>${escapeHtml(item.type)}</strong>
            <span>${escapeHtml(item.path)}</span>
          </summary>
          <div class="result-open-menu">
            <span>${escapeHtml(item.type)} 열기</span>
            <button type="button" class="secondary small" data-open-result-path="${escapeHtml(item.path)}" data-open-action="finder">Finder</button>
            <button type="button" class="secondary small" data-open-result-path="${escapeHtml(item.path)}" data-open-action="preview">미리보기</button>
            <button type="button" class="secondary small" data-open-result-path="${escapeHtml(item.path)}" data-open-action="obsidian">Obsidian</button>
          </div>
        </details>
      `).join('')}
    </div>
  `;
}

const officePositions = {
  ceo: { x: 13, y: 50 },
  youtube: { x: 29, y: 28 },
  designer: { x: 43, y: 19 },
  developer: { x: 45, y: 58 },
  business: { x: 58, y: 55 },
  secretary: { x: 68, y: 64 },
  editor: { x: 81, y: 66 },
  writer: { x: 37, y: 73 },
  researcher: { x: 90, y: 37 }
};

const OFFICE_POSITION_KEY = 'connect-ai-office-positions';
const SIDEBAR_COLLAPSED_KEY = 'connect-ai-sidebar-collapsed';

function loadOfficePositions() {
  try {
    const saved = JSON.parse(localStorage.getItem(OFFICE_POSITION_KEY) || '{}');
    Object.entries(saved).forEach(([agentId, pos]) => {
      if (!pos || typeof pos.x !== 'number' || typeof pos.y !== 'number') return;
      officePositions[agentId] = {
        x: Math.min(98, Math.max(2, pos.x)),
        y: Math.min(98, Math.max(2, pos.y))
      };
    });
  } catch {
    localStorage.removeItem(OFFICE_POSITION_KEY);
  }
}

function saveOfficePositions() {
  localStorage.setItem(OFFICE_POSITION_KEY, JSON.stringify(officePositions));
}

function applySidebarState(collapsed) {
  document.body.classList.toggle('sidebar-collapsed', collapsed);
  const toggle = $('sidebarToggle');
  if (!toggle) return;
  toggle.textContent = collapsed ? '›' : '‹';
  toggle.setAttribute('aria-label', collapsed ? '패널 열기' : '패널 닫기');
  toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function loadSidebarState() {
  applySidebarState(localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === 'true');
}

function toggleSidebar() {
  const collapsed = !document.body.classList.contains('sidebar-collapsed');
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  applySidebarState(collapsed);
}

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
  updateTeamNav();
}

function scrollTeam(direction) {
  const grid = $('teamGrid');
  if (!grid) return;
  const card = grid.querySelector('.team-card');
  const cardWidth = card ? card.getBoundingClientRect().width : 160;
  grid.scrollBy({ left: direction * (cardWidth + 10), behavior: 'smooth' });
  window.setTimeout(updateTeamNav, 240);
}

function updateTeamNav() {
  const grid = $('teamGrid');
  const prev = $('teamPrev');
  const next = $('teamNext');
  if (!grid || !prev || !next) return;
  const maxScroll = Math.max(0, grid.scrollWidth - grid.clientWidth);
  prev.disabled = grid.scrollLeft <= 1;
  next.disabled = grid.scrollLeft >= maxScroll - 1;
}

function normalizeModelValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw === 'openai:gpt-5.5') return 'openai:gpt-5.6';
  if (raw.startsWith('local:') || raw.startsWith('openai:') || raw.startsWith('zai:') || raw.startsWith('moonshot:')) return raw;
  return `local:${raw}`;
}

function providerFromModelValue(id) {
  if (id.startsWith('openai:')) return 'openai';
  if (id.startsWith('zai:')) return 'zai';
  if (id.startsWith('moonshot:')) return 'moonshot';
  return 'local';
}

function modelNameFromValue(id, provider) {
  return provider === 'openai'
    ? id.slice('openai:'.length)
    : provider === 'zai'
      ? id.slice('zai:'.length)
      : provider === 'moonshot'
        ? id.slice('moonshot:'.length)
      : id.slice('local:'.length);
}

function providerLabel(provider) {
  if (provider === 'openai') return 'OpenAI GPT-5.6';
  if (provider === 'zai') return 'GLM 5.1';
  if (provider === 'moonshot') return 'Kimi 2.6';
  return 'Local';
}

function normalizeModelOption(model) {
  if (typeof model === 'string') {
    const id = normalizeModelValue(model);
    const provider = providerFromModelValue(id);
    const name = modelNameFromValue(id, provider);
    return {
      id,
      provider,
      model: name,
      label: `${providerLabel(provider)} · ${name}`
    };
  }
  const id = normalizeModelValue(model.id || model.value || model.model);
  const provider = model.provider || providerFromModelValue(id);
  const name = model.model || modelNameFromValue(id, provider);
  return {
    id,
    provider,
    model: name,
    label: model.label || `${providerLabel(provider)} · ${name}`
  };
}

function renderModels() {
  const select = $('modelSelect');
  select.innerHTML = '';
  const optionsById = new Map();
  [state.config.defaultModel, ...state.models].filter(Boolean).forEach((model) => {
    const option = normalizeModelOption(model);
    if (option.id) optionsById.set(option.id, option);
  });
  const all = Array.from(optionsById.values());
  if (all.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '모델 없음';
    select.appendChild(option);
    return;
  }
  const selectedValue = normalizeModelValue(state.config.defaultModel);
  const groups = [
    ['local', 'Local LLM'],
    ['openai', 'OpenAI'],
    ['zai', 'GLM 5.1'],
    ['moonshot', 'Kimi 2.6']
  ];
  groups.forEach(([provider, label]) => {
    const items = all.filter((model) => model.provider === provider);
    if (!items.length) return;
    const group = document.createElement('optgroup');
    group.label = label;
    items.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.id;
      option.textContent = model.label;
      option.selected = model.id === selectedValue;
      group.appendChild(option);
    });
    select.appendChild(group);
  });
  all.filter((model) => !['local', 'openai', 'zai', 'moonshot'].includes(model.provider)).forEach((model) => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = model.label;
    option.selected = model.id === selectedValue;
    select.appendChild(option);
  });
}

function setLlmTestResult(kind, text) {
  const box = $('llmTestResult');
  if (!box) return;
  box.className = `test-result ${kind || ''}`;
  box.textContent = text || '';
}

function setApiPanelResult(kind, text) {
  const box = $('apiPanelResult');
  if (!box) return;
  box.className = `test-result ${kind || ''}`;
  box.textContent = text || '';
}

function providerModelValue(providerId) {
  const option = state.models.map(normalizeModelOption).find((model) => model.provider === providerId);
  return option ? option.id : '';
}

function renderApiProviders() {
  const list = $('apiProviderList');
  if (!list) return;
  if (!state.providers.length) {
    list.innerHTML = '<div class="empty">연결할 LLM 공급자가 없습니다.</div>';
    return;
  }
  list.innerHTML = state.providers.map((provider) => {
    const issue = state.providerIssues[provider.id] || {};
    const method = provider.source === 'env'
      ? provider.apiKeyEnv
      : provider.authFlow === 'chatmock'
        ? '구독 인증'
      : provider.method === 'oauth'
        ? 'OAuth'
      : provider.method === 'apiKey'
        ? 'API Key'
        : 'Not connected';
    const statusClass = issue.kind === 'billing' ? 'billing' : provider.connected ? 'connected' : '';
    const statusText = issue.kind === 'billing' ? 'Billing' : provider.connected ? 'Connected' : 'Offline';
    const isSubscriptionProvider = provider.id === 'openai';
    const isZaiProvider = provider.id === 'zai';
    const isMoonshotProvider = provider.id === 'moonshot';
    const authRow = isSubscriptionProvider
      ? `<div class="subscription-auth-row">
          <span>ChatGPT 구독 계정으로 연결</span>
          <button type="button" data-api-action="oauth" data-provider="${escapeHtml(provider.id)}">구독 인증</button>
        </div>`
      : `<div class="api-key-row">
          <input id="apiKey-${escapeHtml(provider.id)}" type="password" autocomplete="off" placeholder="${escapeHtml(provider.name)} API Key">
          <button type="button" data-api-action="save-key" data-provider="${escapeHtml(provider.id)}">Save</button>
        </div>`;
    const subscriptionButton = isSubscriptionProvider
      ? ''
      : isZaiProvider || isMoonshotProvider || !provider.oauthConfigured
        ? ''
      : `<button type="button" class="secondary" data-api-action="oauth" data-provider="${escapeHtml(provider.id)}">OAuth</button>`;
    const accountLabel = isSubscriptionProvider ? '구독 계정' : (isZaiProvider || isMoonshotProvider) ? '키 상태' : 'Account';
    const billingLabel = isSubscriptionProvider ? '구독 관리' : isZaiProvider ? 'Plan' : 'Billing';
    return `
      <article class="api-provider ${statusClass}">
        <div class="api-provider-head">
          <div>
            <strong>${escapeHtml(provider.name)}</strong>
            <span>${escapeHtml(method)}</span>
          </div>
          <span class="api-status ${statusClass}">${statusText}</span>
        </div>
        ${authRow}
        <div class="api-action-row">
          <button type="button" class="secondary" data-api-action="account" data-provider="${escapeHtml(provider.id)}">${accountLabel}</button>
          ${subscriptionButton}
          <button type="button" class="secondary" data-api-action="test" data-provider="${escapeHtml(provider.id)}">Test</button>
          <button type="button" class="secondary" data-api-action="billing" data-provider="${escapeHtml(provider.id)}">${billingLabel}</button>
          <button type="button" class="secondary danger-outline" data-api-action="disconnect" data-provider="${escapeHtml(provider.id)}">Disconnect</button>
        </div>
      </article>
    `;
  }).join('');
}

function openTasksByAgent() {
  const tasks = state.dashboard && state.dashboard.tasks ? state.dashboard.tasks.all : [];
  const open = tasks.filter((task) => !['done', 'cancelled', 'failed'].includes(task.status || 'open'));
  const byAgent = new Map();
  open.forEach((task) => {
    if (!byAgent.has(task.agent)) byAgent.set(task.agent, []);
    byAgent.get(task.agent).push(task);
  });
  return byAgent;
}

function flowPathForPosition(pos, index, total) {
  const spread = (index - ((total - 1) / 2)) * 4;
  const startX = Math.min(72, Math.max(28, 50 + spread));
  const startY = 90;
  const targetX = Math.min(98, Math.max(2, pos.x));
  const targetY = Math.min(95, Math.max(5, pos.y + 5));
  const elbowY = Math.min(86, Math.max(28, (startY + targetY) / 2));
  return `M ${startX.toFixed(2)} ${startY.toFixed(2)} L ${startX.toFixed(2)} ${elbowY.toFixed(2)} L ${targetX.toFixed(2)} ${elbowY.toFixed(2)} L ${targetX.toFixed(2)} ${targetY.toFixed(2)}`;
}

function renderOfficeFlow(flow, byAgent) {
  if (!flow) return;
  const workingAgents = state.agents.filter((agent) => byAgent.has(agent.id));
  if (!workingAgents.length) {
    flow.innerHTML = '';
    flow.classList.add('idle');
    return;
  }

  flow.classList.remove('idle');
  const defs = `
    <defs>
      <marker id="flowArrow" markerWidth="5" markerHeight="5" refX="3.9" refY="2.5" orient="auto" markerUnits="strokeWidth">
        <path d="M 0 0 L 5 2.5 L 0 5 Z" fill="#eaffff"></path>
      </marker>
    </defs>
  `;
  const paths = workingAgents.map((agent, index) => {
    const task = byAgent.get(agent.id)[0] || {};
    const pos = officePositions[agent.id] || { x: 50, y: 50 };
    const path = flowPathForPosition(pos, index, workingAgents.length);
    const routeId = `flow-route-${safeDomId(agent.id)}`;
    const accent = escapeHtml(agent.accent || '#35c8ff');
    const delay = `${(index * -0.32).toFixed(2)}s`;
    const title = task.title ? `${agent.name}: ${task.title}` : `${agent.name}: 작업 중`;
    const runners = [0, 1.55, 3.1].map((offset) => `
      <polygon class="flow-runner" points="-0.6,-0.48 1.15,0 -0.6,0.48">
        <animateMotion dur="8s" begin="${(index * 0.18 + offset).toFixed(2)}s" repeatCount="indefinite" rotate="auto">
          <mpath href="#${routeId}"></mpath>
        </animateMotion>
      </polygon>
    `).join('');
    return `
      <g class="flow-route" style="--accent:${accent};--delay:${delay}">
        <title>${escapeHtml(title)}</title>
        <path id="${routeId}" class="flow-motion-path" d="${path}"></path>
        <path class="flow-track" d="${path}"></path>
        <path class="flow-line" d="${path}"></path>
        <path class="flow-pulse" d="${path}"></path>
        ${runners}
        <path class="flow-direction" d="${path}" marker-end="url(#flowArrow)"></path>
        <circle class="flow-node" cx="${Number(pos.x).toFixed(2)}" cy="${Number(pos.y).toFixed(2)}" r="1.1"></circle>
      </g>
    `;
  }).join('');
  flow.innerHTML = `${defs}${paths}`;
}

function refreshOfficeFlow() {
  renderOfficeFlow($('officeFlow'), openTasksByAgent());
}

function renderOfficeActivity() {
  const layer = $('officeAgents');
  if (!layer) return;
  const byAgent = openTasksByAgent();
  renderOfficeFlow($('officeFlow'), byAgent);
  const markers = state.agents.map((agent) => {
    const agentTasks = byAgent.get(agent.id) || [];
    const task = agentTasks[0];
    const pos = officePositions[agent.id] || { x: 50, y: 50 };
    const hasWork = agentTasks.length > 0;
    const progress = hasWork && task.progress ? task.progress : { percent: 0, label: '대기 중' };
    const title = hasWork
      ? `${agent.name}: ${task.title} (${progress.percent}%)`
      : `${agent.name}: ${progress.label}`;
    const taskAttr = hasWork ? ` data-task-id="${escapeHtml(task.id)}"` : '';
    return `
      <button type="button" class="office-agent-marker ${hasWork ? 'working' : 'seated'}"${taskAttr} data-agent-id="${escapeHtml(agent.id)}" aria-label="${escapeHtml(title)}" title="${escapeHtml(title)}" style="--x:${pos.x};--y:${pos.y};--accent:${escapeHtml(agent.accent || '#22e58e')}">
        <span class="marker-avatar">${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="${escapeHtml(agent.name)}">` : escapeHtml(agent.emoji || '')}</span>
        <span class="marker-work">
          <strong>${escapeHtml(agent.name)}</strong>
          <em>${escapeHtml(progress.label)}</em>
        </span>
      </button>
    `;
  });
  layer.innerHTML = markers.join('');
  layer.querySelectorAll('.office-agent-marker').forEach((button) => {
    bindOfficeMarkerDrag(button, layer);
  });
  layer.querySelectorAll('[data-task-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      if (button.dataset.dragged === 'true') {
        event.preventDefault();
        button.dataset.dragged = 'false';
        return;
      }
      selectTask(button.dataset.taskId);
    });
  });
}

function bindOfficeMarkerDrag(button, layer) {
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    const agentId = button.dataset.agentId;
    if (!agentId) return;

    event.preventDefault();
    const rect = layer.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    button.classList.add('dragging');
    button.dataset.dragged = 'false';
    if (button.setPointerCapture) button.setPointerCapture(event.pointerId);

    const moveTo = (clientX, clientY) => {
      const x = Math.min(98, Math.max(2, ((clientX - rect.left) / rect.width) * 100));
      const y = Math.min(98, Math.max(2, ((clientY - rect.top) / rect.height) * 100));
      officePositions[agentId] = { x: Number(x.toFixed(2)), y: Number(y.toFixed(2)) };
      button.style.setProperty('--x', officePositions[agentId].x);
      button.style.setProperty('--y', officePositions[agentId].y);
      refreshOfficeFlow();
    };

    const onPointerMove = (moveEvent) => {
      if (!button.classList.contains('dragging')) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 4) {
        moved = true;
        button.dataset.dragged = 'true';
      }
      if (!moved) return;
      moveEvent.preventDefault();
      moveTo(moveEvent.clientX, moveEvent.clientY);
    };

    const onPointerUp = () => {
      if (!button.classList.contains('dragging')) return;
      button.classList.remove('dragging');
      if (button.releasePointerCapture) {
        try {
          button.releasePointerCapture(event.pointerId);
        } catch {}
      }
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      if (moved) {
        saveOfficePositions();
      }
    };

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  });
}

function renderTaskDetail() {
  const box = $('taskDetail');
  if (!box) return;
  const tasks = allDashboardTasks();
  const open = tasks.filter((task) => !['done', 'cancelled', 'failed'].includes(task.status || 'open'));
  const selected = tasks.find((task) => task.id === state.selectedTaskId) || open[0] || tasks[0];
  if (!selected) {
    box.innerHTML = '<div class="empty">작업을 선택하면 진행 상황이 표시됩니다.</div>';
    return;
  }
  state.selectedTaskId = selected.id;
  const agent = taskAgent(selected);
  const progress = selected.progress || { percent: 0, label: '진행 중', timeline: [] };
  const resultHtml = selected.result
    ? `<div class="task-result"><strong>Result</strong><p>${escapeHtml(selected.result)}</p></div>`
    : '';
  const errorHtml = selected.error
    ? `<div class="task-result error"><strong>Error</strong><p>${escapeHtml(selected.error)}</p></div>`
    : '';
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
    <div class="result-inline-actions">
      <button type="button" class="secondary small" data-open-result="${escapeHtml(selected.id)}">결과 패널</button>
    </div>
    ${errorHtml}
    ${resultHtml}
  `;
  const openButton = box.querySelector('[data-open-result]');
  if (openButton) {
    openButton.addEventListener('click', () => {
      state.selectedTaskId = openButton.dataset.openResult || state.selectedTaskId;
      state.resultExport = { status: '', message: '' };
      renderResultPanel();
    });
  }
}

function renderResultPanel() {
  const panel = $('resultPanelBody');
  if (!panel) return;
  const task = selectedTask();
  if (!task) {
    panel.innerHTML = '<div class="empty">작업을 선택하면 결과물이 여기에 표시됩니다.</div>';
    return;
  }
  state.selectedTaskId = task.id;
  const agent = taskAgent(task);
  const hasResult = Boolean(task.result || task.error);
  const content = task.result || task.error || '아직 저장된 결과물이 없습니다. 작업을 실행하거나 완료 결과를 저장하면 이곳에 표시됩니다.';
  const exports = task.exports || {};
  const exportMessage = state.resultExport.message
    ? `<div class="result-export-message ${escapeHtml(state.resultExport.status)}">${escapeHtml(state.resultExport.message)}</div>`
    : '';
  const savedPaths = renderResultPathLinks(exports);
  const sources = Array.isArray(task.sources) && task.sources.length
    ? `<div class="result-sources"><strong>Sources</strong>${task.sources.map((source) => `<span>${escapeHtml(source)}</span>`).join('')}</div>`
    : '';
  panel.innerHTML = `
    <div class="result-head">
      <span class="agent-avatar small" style="--accent:${escapeHtml(agent.accent || '#35c8ff')}">
        ${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="">` : `<span>${escapeHtml(agent.emoji || '')}</span>`}
      </span>
      <div>
        <div class="section-kicker">${escapeHtml(agent.name || task.agent || 'Agent')}</div>
        <h3>${escapeHtml(task.title || '작업 결과')}</h3>
        <p>${escapeHtml(task.status || 'open')} · ${escapeHtml(fmtTime(task.completedAt || task.updatedAt || task.createdAt))}</p>
      </div>
    </div>
    <div class="result-actions">
      <button type="button" class="secondary small" data-result-export="pdf"${hasResult ? '' : ' disabled'}>PDF 저장</button>
      <button type="button" class="secondary small" data-result-export="obsidian"${hasResult ? '' : ' disabled'}>Vault 저장</button>
      <button type="button" class="small" data-result-export="all"${hasResult ? '' : ' disabled'}>둘 다 저장</button>
    </div>
    ${exportMessage}
    ${savedPaths}
    <div class="result-content ${task.error ? 'error' : ''}">${escapeHtml(content)}</div>
    ${sources}
  `;
}

function renderTasks() {
  const list = $('taskList');
  const tasks = state.dashboard && state.dashboard.tasks ? state.dashboard.tasks.all : [];
  const visible = tasks.filter((task) => !['done', 'cancelled', 'failed'].includes(task.status || 'open')).slice(0, 12);
  if (visible.length === 0) {
    list.innerHTML = '<div class="empty">열린 작업이 없습니다.</div>';
    if (!state.selectedTaskId) {
      const latestFailed = tasks.find((task) => task.status === 'failed');
      state.selectedTaskId = latestFailed ? latestFailed.id : '';
    }
    renderTaskDetail();
    return;
  }
  list.innerHTML = visible.map((task) => {
    const agent = taskAgent(task);
    const disabled = task.source === 'company' ? ' disabled title="확장 tracker 작업은 웹에서 직접 수정하지 않습니다."' : '';
    const isRunning = task.status === 'running' || state.runningTaskIds.has(task.id);
    const runDisabled = disabled || isRunning ? ' disabled' : '';
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
          <button type="button" class="icon-btn" data-run-task="${escapeHtml(task.id)}"${runDisabled} title="LLM으로 작업 실행">${isRunning ? '…' : '▶'}</button>
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
  list.querySelectorAll('[data-run-task]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation();
      runTask(button.dataset.runTask);
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

  $('companyName').textContent = 'AI Company';
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
  renderResultPanel();
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
  renderResultPanel();
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
    state.auth = data.auth || {};
    state.config.defaultModel = data.defaultModel || state.config.defaultModel || '';
    renderModels();
    if (data.errors && data.errors.length) {
      const errorText = data.errors.map((item) => `${item.provider}: ${item.error}`).join('\n');
      setLlmTestResult('pending', `일부 모델 목록 실패 · ${errorText}`);
    }
  } catch (error) {
    state.models = [];
    renderModels();
    addMessage('error', 'Model check', `모델 목록을 가져오지 못했습니다.\n${error.message}`);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadProviders() {
  const data = await api('/api/llm/providers');
  state.providers = data.providers || [];
  renderApiProviders();
}

function openApiPanel() {
  const panel = $('apiPanel');
  if (!panel) return;
  panel.classList.remove('hidden');
  panel.setAttribute('aria-hidden', 'false');
  setApiPanelResult('', '');
  loadProviders().catch((error) => setApiPanelResult('error', error.message));
}

function closeApiPanel() {
  const panel = $('apiPanel');
  if (!panel) return;
  panel.classList.add('hidden');
  panel.setAttribute('aria-hidden', 'true');
}

async function saveProviderKey(providerId) {
  const input = $(`apiKey-${providerId}`);
  const apiKey = input ? input.value.trim() : '';
  if (!apiKey) {
    setApiPanelResult('error', 'API Key를 입력해 주세요.');
    return;
  }
  setApiPanelResult('pending', 'API Key 저장 중...');
  try {
    await api('/api/llm/credentials', {
      method: 'POST',
      body: JSON.stringify({ provider: providerId, apiKey })
    });
    delete state.providerIssues[providerId];
    if (input) input.value = '';
    await loadProviders();
    await refreshModels();
    setApiPanelResult('ok', `${providerLabel(providerId)} API Key 저장 완료`);
  } catch (error) {
    setApiPanelResult('error', error.message === 'API_KEY_INVALID'
      ? `${providerLabel(providerId)} API Key 형식이 올바르지 않습니다.`
      : error.message);
  }
}

async function disconnectProvider(providerId) {
  setApiPanelResult('pending', '연결 해제 중...');
  await api(`/api/llm/credentials/${encodeURIComponent(providerId)}`, { method: 'DELETE' });
  delete state.providerIssues[providerId];
  await loadProviders();
  await refreshModels();
  setApiPanelResult('ok', `${providerLabel(providerId)} 로컬 연결 정보를 삭제했습니다.`);
}

async function pollOAuthStatus(providerId, flowId, attempts = 45) {
  if (!flowId) return null;
  for (let index = 0; index < attempts; index += 1) {
    await delay(2000);
    const status = await api(`/api/llm/oauth/status?provider=${encodeURIComponent(providerId)}&flowId=${encodeURIComponent(flowId)}`);
    if (status.provider && status.provider.connected) return status.provider;
    if (status.flow && status.flow.status === 'error') {
      throw new Error(status.flow.error || '인증에 실패했습니다.');
    }
  }
  throw new Error('인증 대기 시간이 초과되었습니다.');
}

async function startProviderOAuth(providerId) {
  const isSubscriptionProvider = providerId === 'openai';
  setApiPanelResult('pending', isSubscriptionProvider ? '구독 인증 준비 중...' : 'OAuth 인증 준비 중...');
  const result = await api('/api/llm/oauth/start', {
    method: 'POST',
    body: JSON.stringify({ provider: providerId })
  });
  if (!result.available) {
    if (result.authUrl) window.open(result.authUrl, '_blank');
    setApiPanelResult('pending', result.message || '인증 설정이 없습니다.');
    return;
  }
  if (result.authUrl) window.open(result.authUrl, '_blank');
  setApiPanelResult('pending', result.message || (isSubscriptionProvider ? '구독 인증 창을 열었습니다.' : 'OAuth 인증 창을 열었습니다.'));
  const attempts = result.mode === 'openai-api-key-assisted' || result.mode === 'chatmock-openai' ? 180 : 45;
  await pollOAuthStatus(providerId, result.flowId, attempts);
  await loadProviders();
  await refreshModels();
  const doneText = result.mode === 'chatmock-openai'
    ? 'OpenAI 구독 인증 연결 완료'
    : result.mode === 'openai-api-key-assisted'
      ? 'OpenAI 인증 연결 완료'
    : `${providerLabel(providerId)} OAuth 연결 완료`;
  setApiPanelResult('ok', doneText);
}

async function startProviderAccountAuth(providerId) {
  setApiPanelResult('pending', `${providerLabel(providerId)} 계정 인증 확인 중...`);
  const result = await api('/api/llm/account/start', {
    method: 'POST',
    body: JSON.stringify({ provider: providerId })
  });
  if (result.authUrl) window.open(result.authUrl, '_blank');
  setApiPanelResult(result.available ? 'ok' : 'pending', result.message || '공급자 계정 페이지를 열었습니다.');
}

async function testProvider(providerId) {
  const model = providerModelValue(providerId);
  if (!model) {
    setApiPanelResult('error', `${providerLabel(providerId)} 모델이 없습니다.`);
    return;
  }
  setApiPanelResult('pending', `${providerLabel(providerId)} 연결 테스트 중...`);
  const response = await fetch('/api/llm/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ollamaBase: $('ollamaBase').value.trim(),
      model,
      chatTimeoutMs: 12000
    })
  });
  const result = await response.json().catch(() => ({}));
  if (result.connected) {
    delete state.providerIssues[providerId];
    renderApiProviders();
    const modelText = result.upstreamModel && result.upstreamModel !== result.model
      ? `${result.model} → ${result.upstreamModel}`
      : result.model;
    setApiPanelResult('ok', `연결 성공 · ${result.provider} · ${modelText} · ${result.latencyMs}ms`);
  } else if (result.authRequired) {
    state.providerIssues[providerId] = { kind: 'auth', message: result.error || '' };
    renderApiProviders();
    const nextAction = providerId === 'openai'
      ? '구독 인증 버튼으로 ChatGPT 계정을 다시 연결해 주세요.'
      : 'API Key를 입력하고 Save를 눌러 주세요.';
    setApiPanelResult('error', `인증 필요 · ${result.provider || providerLabel(providerId)} · ${result.error || '인증 정보가 없습니다.'} · ${nextAction}`);
  } else if (result.errorKind === 'billing') {
    state.providerIssues[providerId] = { kind: 'billing', message: result.error };
    renderApiProviders();
    const nextAction = providerId === 'zai'
      ? 'Plan 버튼으로 현재 GLM Coding Plan 사용량과 키 상태를 확인해 주세요.'
      : 'Billing 버튼으로 결제 페이지를 열어주세요.';
    setApiPanelResult('error', `요금제 확인 필요 · ${result.error} · ${nextAction}`);
  } else if (result.errorKind === 'unsupported') {
    state.providerIssues[providerId] = { kind: 'error', message: result.error || '' };
    renderApiProviders();
    setApiPanelResult('error', `모델 지원 불가 · ${result.provider || providerLabel(providerId)} · ${result.error || '현재 구독 인증에서 사용할 수 없는 모델입니다.'}`);
  } else {
    state.providerIssues[providerId] = { kind: result.errorKind || 'error', message: result.error || '' };
    renderApiProviders();
    setApiPanelResult('error', `연결 실패 · ${result.provider || providerLabel(providerId)} · ${result.error || '알 수 없는 오류'}`);
  }
}

function openProviderBilling(providerId) {
  const provider = state.providers.find((item) => item.id === providerId);
  const url = provider && (provider.billingUrl || provider.keyUrl);
  if (!url) {
    setApiPanelResult('error', providerId === 'zai' ? '요금제 상태 페이지 주소가 없습니다.' : '결제 페이지 주소가 없습니다.');
    return;
  }
  window.open(url, '_blank');
  setApiPanelResult('pending', providerId === 'zai'
    ? `${providerLabel(providerId)} 요금제/키 상태 페이지를 열었습니다.`
    : `${providerLabel(providerId)} 결제 페이지를 열었습니다.`);
}

async function testLlmConnection() {
  const button = $('testLlm');
  button.disabled = true;
  setLlmTestResult('pending', 'LLM 연결 테스트 중...');
  try {
    const selectedModel = $('modelSelect').value.trim();
    const response = await fetch('/api/llm/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ollamaBase: $('ollamaBase').value.trim(),
        model: selectedModel,
        chatTimeoutMs: 12000
      })
    });
    const result = await response.json().catch(() => ({}));
    const stageText = Array.isArray(result.stages)
      ? result.stages.map((stage) => `${stage.name}:${stage.ok ? 'ok' : 'fail'}`).join(' · ')
      : '';
    if (result.authRequired) {
      const text = `${result.provider || 'LLM'} API key 필요 · ${result.error || '환경 변수를 설정해 주세요.'}`;
      setLlmTestResult('error', text);
      addMessage('error', 'LLM Test', `${text}\n${result.authUrl || ''}`);
      return;
    }
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
  const context = $('taskTitle').value.trim();
  const title = context.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  if (!title) return;
  await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description: context,
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

async function runTask(id) {
  if (!id) return;
  state.runningTaskIds.add(id);
  renderTasks();
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(id)}/run`, {
      method: 'POST',
      body: JSON.stringify({})
    });
    const task = result.task || {};
    addMessage('system', 'Task completed', `${task.title || '작업'}\n${task.result || '완료 처리되었습니다.'}`);
  } catch (error) {
    addMessage('error', 'Task failed', error.message);
  } finally {
    state.runningTaskIds.delete(id);
    await refreshDashboard();
  }
}

async function exportSelectedResult(target) {
  const task = selectedTask();
  if (!task) return;
  state.resultExport = { status: 'pending', message: '결과 저장 중...' };
  renderResultPanel();
  try {
    const result = await api(`/api/tasks/${encodeURIComponent(task.id)}/export`, {
      method: 'POST',
      body: JSON.stringify({ target })
    });
    if (result.task && state.dashboard && state.dashboard.tasks) {
      const tasks = state.dashboard.tasks.all || [];
      const index = tasks.findIndex((item) => item.id === result.task.id);
      if (index >= 0) tasks[index] = result.task;
    }
    state.resultExport = {
      status: 'ok',
      message: '저장 완료'
    };
    renderResultPanel();
    await refreshDashboard();
    state.resultExport = {
      status: 'ok',
      message: '저장 완료'
    };
    renderResultPanel();
  } catch (error) {
    state.resultExport = { status: 'error', message: error.message };
    renderResultPanel();
  }
}

async function openResultPath(filePath, action) {
  if (!filePath || !action) return;
  const labels = { finder: 'Finder', preview: '미리보기', obsidian: 'Obsidian' };
  state.resultExport = { status: 'pending', message: `${labels[action] || action}로 여는 중...` };
  renderResultPanel();
  try {
    await api('/api/open-path', {
      method: 'POST',
      body: JSON.stringify({ path: filePath, action })
    });
    state.resultExport = { status: 'ok', message: `${labels[action] || action}로 열었습니다.` };
  } catch (error) {
    state.resultExport = { status: 'error', message: `열기 실패 · ${error.message}` };
  }
  renderResultPanel();
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
  $('sidebarToggle').addEventListener('click', toggleSidebar);
  $('apiPanelToggle').addEventListener('click', openApiPanel);
  $('apiPanelClose').addEventListener('click', closeApiPanel);
  $('teamPrev').addEventListener('click', () => scrollTeam(-1));
  $('teamNext').addEventListener('click', () => scrollTeam(1));
  $('teamGrid').addEventListener('scroll', updateTeamNav);
  $('teamGrid').addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      scrollTeam(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      scrollTeam(1);
    }
  });
  document.querySelectorAll('[data-close-api]').forEach((button) => {
    button.addEventListener('click', closeApiPanel);
  });
  $('apiProviderList').addEventListener('click', (event) => {
    const button = event.target.closest('[data-api-action]');
    if (!button) return;
    const provider = button.dataset.provider;
    const action = button.dataset.apiAction;
    button.disabled = true;
    const run = action === 'save-key'
      ? saveProviderKey(provider)
      : action === 'account'
        ? startProviderAccountAuth(provider)
      : action === 'oauth'
        ? startProviderOAuth(provider)
        : action === 'test'
          ? testProvider(provider)
          : action === 'billing'
            ? Promise.resolve(openProviderBilling(provider))
          : action === 'disconnect'
            ? disconnectProvider(provider)
            : Promise.resolve();
    run.catch((error) => setApiPanelResult('error', error.message))
      .finally(() => { button.disabled = false; });
  });
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
  $('resultRefresh').addEventListener('click', () => {
    state.resultExport = { status: '', message: '' };
    refreshDashboard().catch((error) => addMessage('error', 'Refresh failed', error.message));
  });
  $('resultPanel').addEventListener('click', (event) => {
    const exportButton = event.target.closest('[data-result-export]');
    if (exportButton) {
      exportSelectedResult(exportButton.dataset.resultExport || 'all');
      return;
    }
    const openButton = event.target.closest('[data-open-result-path]');
    if (openButton) {
      openResultPath(openButton.dataset.openResultPath || '', openButton.dataset.openAction || '');
    }
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
  rememberInternalRoute();
  updateResultBackLink();
  loadOfficePositions();
  loadSidebarState();
  bindEvents();
  addMessage('system', 'Connect AI Web', '웹사이트 모드로 운영실을 시작했습니다.');
  await refreshDashboard();
  await refreshModels();
  await loadProviders();
  const brain = await api('/api/brain');
  renderBrain(brain.files || []);
  setInterval(() => {
    refreshDashboard().catch(() => {});
  }, 15000);
}

boot().catch((error) => {
  $('serverState').textContent = 'offline';
  addMessage('error', 'Boot failed', error.message);
});
