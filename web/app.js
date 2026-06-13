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
  agentTab: 'dashboard',
  lastSuccessfulLlmTest: null,
  taskAgentSelection: '',
  approvalAgentSelection: '',
  runningTaskIds: new Set(),
  knownQueueTaskIds: new Set(),
  retainedTerminalTaskIds: new Set(),
  hiddenTerminalTaskIds: new Set(),
  resultExport: { status: '', message: '' },
  isComposingMessage: false,
  isSendingMessage: false
};

const $ = (id) => document.getElementById(id);
const APP_CURRENT_URL_KEY = 'connect-ai-current-url';
const APP_PREVIOUS_URL_KEY = 'connect-ai-previous-url';
const GROK_PROXY_STATUS_URL = '/api/llm/proxy/cliproxyapi';
const TERMINAL_TASK_STATUSES = new Set(['done', 'cancelled', 'failed', 'completed']);
const AGENT_MANAGER_TABS = [
  { id: 'dashboard', label: '대시보드' },
  { id: 'instructions', label: '지침' },
  { id: 'skills', label: '스킬' },
  { id: 'settings', label: '설정' },
  { id: 'runs', label: '실행기록' },
  { id: 'budget', label: '예산' }
];
const AGENT_MANAGER_TAB_IDS = new Set(AGENT_MANAGER_TABS.map((tab) => tab.id));

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

function safeDecode(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function fmtTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtRelativeTime(value) {
  if (!value) return '기록 없음';
  const date = new Date(value);
  const diffMs = Date.now() - date.getTime();
  if (Number.isNaN(diffMs)) return fmtTime(value);
  const minutes = Math.max(0, Math.round(diffMs / 60000));
  if (minutes < 1) return '방금 전';
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  return `${days}일 전`;
}

function fmtCents(value) {
  const cents = Math.max(0, Number(value) || 0);
  return `$${(cents / 100).toFixed(2)}`;
}

function parseAgentRoute() {
  const raw = String(window.location.hash || '').replace(/^#/, '');
  const parts = raw.split('/').map(safeDecode);
  if (parts[0] !== 'agent' || !parts[1]) return null;
  const tab = AGENT_MANAGER_TAB_IDS.has(parts[2]) ? parts[2] : 'dashboard';
  return { agentId: parts[1], tab };
}

function agentRoute(agentId, tab = 'dashboard') {
  const safeTab = AGENT_MANAGER_TAB_IDS.has(tab) ? tab : 'dashboard';
  return `#agent/${encodeURIComponent(agentId)}/${safeTab}`;
}

function navigateAgent(agentId, tab = 'dashboard') {
  if (!agentId) return;
  state.selectedAgent = agentId;
  state.agentTab = AGENT_MANAGER_TAB_IDS.has(tab) ? tab : 'dashboard';
  const nextHash = agentRoute(agentId, state.agentTab);
  if (window.location.hash === nextHash) {
    renderAll();
    return;
  }
  window.location.hash = nextHash;
  renderAll();
}

function syncAgentRoute() {
  const route = parseAgentRoute();
  if (!route) return null;
  if (state.agents.length && !state.agents.some((agent) => agent.id === route.agentId)) return null;
  state.selectedAgent = route.agentId;
  state.agentTab = route.tab;
  return route;
}

function taskAgent(task) {
  return state.agents.find((item) => item.id === task.agent) || state.agents[0] || {};
}

function allDashboardTasks() {
  return state.dashboard && state.dashboard.tasks ? state.dashboard.tasks.all || [] : [];
}

function taskProgressPercent(task) {
  const percent = Number(task && task.progress && task.progress.percent);
  return Number.isFinite(percent) ? percent : 0;
}

function taskIsTerminal(task) {
  if (!task) return false;
  if (TERMINAL_TASK_STATUSES.has(task.status || 'open')) return true;
  return taskProgressPercent(task) >= 100;
}

function syncRetainedTerminalTasks(tasks) {
  tasks.forEach((task) => {
    if (!task || !task.id) return;
    if (taskIsTerminal(task)) {
      if (state.knownQueueTaskIds.has(task.id) || state.runningTaskIds.has(task.id)) {
        state.retainedTerminalTaskIds.add(task.id);
      }
      return;
    }
    state.knownQueueTaskIds.add(task.id);
    state.hiddenTerminalTaskIds.delete(task.id);
  });
}

function clearTerminalTasksFromQueue(tasks) {
  tasks.forEach((task) => {
    if (!task || !task.id || !taskIsTerminal(task)) return;
    state.hiddenTerminalTaskIds.add(task.id);
    state.retainedTerminalTaskIds.delete(task.id);
  });
  if (state.selectedTaskId) {
    const selected = tasks.find((task) => task.id === state.selectedTaskId);
    if (taskIsTerminal(selected)) state.selectedTaskId = '';
  }
}

function taskQueueVisible(task) {
  if (!task) return false;
  if (state.hiddenTerminalTaskIds.has(task.id)) return false;
  if (taskIsTerminal(task)) return state.retainedTerminalTaskIds.has(task.id);
  return true;
}

function taskHasResultPayload(task) {
  return Boolean(task && (task.result || task.error));
}

function selectedTask() {
  const tasks = allDashboardTasks();
  const selected = tasks.find((task) => task.id === state.selectedTaskId);
  if (selected && !taskIsTerminal(selected)) return selected;
  return null;
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
  instagram: { x: 82, y: 29 },
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
const RESULT_PANEL_COLLAPSED_KEY = 'connect-ai-result-panel-collapsed';
const LAYOUT_DEFAULTS_VERSION_KEY = 'connect-ai-layout-defaults-version';
const LAYOUT_DEFAULTS_VERSION = '20260608-left-open-result-collapsed';

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

function applyResultPanelState(collapsed) {
  document.body.classList.toggle('result-collapsed', collapsed);
  const toggle = $('resultPanelToggle');
  if (!toggle) return;
  toggle.textContent = collapsed ? '‹' : '›';
  toggle.setAttribute('aria-label', collapsed ? '결과 패널 열기' : '결과 패널 닫기');
  toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function loadResultPanelState() {
  const saved = localStorage.getItem(RESULT_PANEL_COLLAPSED_KEY);
  applyResultPanelState(saved === null ? true : saved === 'true');
}

function toggleResultPanel() {
  const collapsed = !document.body.classList.contains('result-collapsed');
  localStorage.setItem(RESULT_PANEL_COLLAPSED_KEY, String(collapsed));
  applyResultPanelState(collapsed);
}

function applyDefaultLayoutState() {
  if (localStorage.getItem(LAYOUT_DEFAULTS_VERSION_KEY) === LAYOUT_DEFAULTS_VERSION) return;
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, 'false');
  localStorage.setItem(RESULT_PANEL_COLLAPSED_KEY, 'true');
  localStorage.setItem(LAYOUT_DEFAULTS_VERSION_KEY, LAYOUT_DEFAULTS_VERSION);
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

function messageTime() {
  return new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function safeDecodeUrl(value) {
  try {
    return decodeURIComponent(String(value || ''));
  } catch {
    return String(value || '');
  }
}

function repairUrlProtocol(value) {
  return String(value || '').replace(/^(https?):\/(?!\/)/i, '$1://');
}

function embeddedMarkdownUrl(value) {
  const raw = String(value || '');
  const decoded = safeDecodeUrl(raw);
  for (const candidate of [raw, decoded]) {
    const match = candidate.match(/\]\((https?:\/{1,2}[^\s)]+)/i);
    if (match) return repairUrlProtocol(match[1]);
  }
  return '';
}

function reutersCanonicalHref(url) {
  if (!/reuters/i.test(url.hostname) || !/\.arcpublishing\.com$/i.test(url.hostname)) return '';
  const cleanPath = safeDecodeUrl(url.pathname).split(/\]\(/)[0].replace(/\/+$/, '/');
  if (!/^\/[a-z0-9-]+\/.+-\d{4}-\d{2}-\d{2}\/?$/i.test(cleanPath)) return '';
  try {
    return new URL(cleanPath, 'https://www.reuters.com').href;
  } catch {
    return '';
  }
}

function normalizeMessageLink(value) {
  const candidate = embeddedMarkdownUrl(value) || repairUrlProtocol(value);
  try {
    const url = new URL(candidate);
    const href = reutersCanonicalHref(url) || url.href;
    return { href, label: href };
  } catch {
    return null;
  }
}

function splitTrailingUrlPunctuation(value) {
  const match = String(value || '').match(/^(.+?)([.,;:!?)]*)$/);
  return match ? { url: match[1], trailing: match[2] || '' } : { url: value, trailing: '' };
}

function appendLinkedText(target, value) {
  const text = String(value || '');
  const urlPattern = /https?:\/{1,2}[^\s<>"']+/gi;
  let cursor = 0;
  let match;

  while ((match = urlPattern.exec(text)) !== null) {
    if (match.index > cursor) {
      target.appendChild(document.createTextNode(text.slice(cursor, match.index)));
    }
    const { url, trailing } = splitTrailingUrlPunctuation(match[0]);
    const parsed = normalizeMessageLink(url);
    if (parsed) {
      const link = document.createElement('a');
      link.className = 'message-link';
      link.href = parsed.href;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = parsed.label;
      target.appendChild(link);
      if (trailing) target.appendChild(document.createTextNode(trailing));
    } else {
      target.appendChild(document.createTextNode(match[0]));
    }
    cursor = match.index + match[0].length;
  }

  if (cursor < text.length) {
    target.appendChild(document.createTextNode(text.slice(cursor)));
  }
}

function setMessageContent(node, kind, name, text) {
  node.className = `message ${kind}`.trim();
  node.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'message-head';
  const sender = document.createElement('strong');
  sender.textContent = name || 'Connect AI';
  const time = document.createElement('time');
  time.dateTime = new Date().toISOString();
  time.textContent = messageTime();
  head.append(sender, time);

  const body = document.createElement('div');
  body.className = 'message-body';
  appendLinkedText(body, text);

  node.append(head, body);
}

function addMessage(kind, name, text) {
  const node = document.createElement('article');
  setMessageContent(node, kind, name, text);
  $('chatLog').appendChild(node);
  $('chatLog').scrollTop = $('chatLog').scrollHeight;
  return node;
}

function renderAgentOptions() {
  ['taskAgent', 'approvalAgent'].forEach((id) => {
    const select = $(id);
    if (!select) return;
    const remembered = id === 'taskAgent' ? state.taskAgentSelection : state.approvalAgentSelection;
    const fallback = state.agents.some((agent) => agent.id === state.selectedAgent)
      ? state.selectedAgent
      : state.agents[0] ? state.agents[0].id : '';
    const selectedAgentId = state.agents.some((agent) => agent.id === remembered) ? remembered : fallback;
    select.innerHTML = '';
    state.agents.forEach((agent) => {
      const option = document.createElement('option');
      option.value = agent.id;
      option.textContent = agent.name;
      option.selected = agent.id === selectedAgentId;
      select.appendChild(option);
    });
  });
}

function managerSourceHtml(source = {}) {
  const docs = Array.isArray(source.docs) ? source.docs : [];
  return `
    <div class="manager-source">
      <strong>Paperclip source</strong>
      <span>${escapeHtml(source.repository || 'paperclipai/paperclip')}</span>
      <a href="${escapeHtml(source.url || 'https://github.com/paperclipai/paperclip.git')}" target="_blank" rel="noreferrer">GitHub</a>
      ${docs.length ? `<p>${docs.map((doc) => `<code>${escapeHtml(doc)}</code>`).join(' ')}</p>` : ''}
    </div>
  `;
}

function agentAvatarHtml(agent, className = 'manager-avatar') {
  return `
    <span class="${className}" style="--accent:${escapeHtml(agent.accent || '#35c8ff')}">
      ${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="">` : `<span>${escapeHtml(agent.emoji || '')}</span>`}
    </span>
  `;
}

function managerTabsHtml(agent, activeTab) {
  return `
    <nav class="manager-tabs" aria-label="에이전트 관리 탭">
      ${AGENT_MANAGER_TABS.map((tab) => `
        <button type="button" class="manager-tab${tab.id === activeTab ? ' active' : ''}" data-agent-tab="${escapeHtml(tab.id)}">
          ${escapeHtml(tab.label)}
        </button>
      `).join('')}
    </nav>
  `;
}

function managerMetric(label, value, detail = '') {
  return `
    <article class="manager-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${detail ? `<em>${escapeHtml(detail)}</em>` : ''}
    </article>
  `;
}

function managerProgress(percent, label = '') {
  const safePercent = Math.max(0, Math.min(100, Number(percent) || 0));
  return `
    <div class="manager-progress" aria-label="${escapeHtml(label || `${safePercent}%`)}">
      <span style="width:${safePercent}%"></span>
    </div>
  `;
}

function managerAgentOptions(selectedId = '', excludeId = '') {
  const selected = String(selectedId || '');
  return [
    `<option value=""${selectedAttr(selected, '')}>대표 / 최상위</option>`,
    ...state.agents
      .filter((item) => item.id !== excludeId)
      .map((item) => `<option value="${escapeHtml(item.id)}"${selectedAttr(selected, item.id)}>${escapeHtml(item.name)}</option>`)
  ].join('');
}

function managerDirectReportChecks(selectedIds = [], excludeId = '') {
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id || '')));
  return state.agents
    .filter((item) => item.id !== excludeId)
    .map((item) => `
      <label class="manager-agent-check">
        <input type="checkbox" name="agentOrgDirectReports" value="${escapeHtml(item.id)}"${selected.has(item.id) ? ' checked' : ''}>
        <span>${escapeHtml(item.name)}</span>
      </label>
    `).join('');
}

function renderManagerDashboard(agent, management) {
  const overview = management.overview || {};
  const budget = management.budget || {};
  const org = management.org || {};
  const settings = management.settings || {};
  const adapter = settings.adapter || {};
  const heartbeat = settings.heartbeat || {};
  const reportsToId = org.reportsToId !== undefined ? org.reportsToId : ((org.reportsTo && org.reportsTo.id) || '');
  const directReportIds = Array.isArray(org.directReportIds)
    ? org.directReportIds
    : (org.directReports || []).map((item) => item.id).filter(Boolean);
  return `
    <div class="manager-form-actions manager-dashboard-top-actions">
      <button type="button" data-agent-save="dashboard">Save dashboard</button>
    </div>
    <div class="manager-grid">
      ${managerMetric('상태', overview.status === 'running' ? 'Running' : 'Paused', overview.adapterType || '')}
      ${managerMetric('모델', overview.model || '-', overview.modelProfile || '')}
      ${managerMetric('열린 작업', String(overview.openTasks || 0), `승인 ${overview.approvalsPending || 0}`)}
      ${managerMetric('월 예산', `${fmtCents(budget.spentCents)} / ${fmtCents(budget.monthlyCents)}`, `${budget.percent || 0}% 사용`)}
    </div>
    <div class="manager-two-col">
      <section class="manager-card">
        <div class="section-kicker">Summary</div>
        <h3>운영 요약</h3>
        <dl class="manager-kv">
          <div><dt>Heartbeat</dt><dd>${overview.heartbeatIntervalSec ? `${overview.heartbeatIntervalSec}초 간격` : 'Disabled'}</dd></div>
          <div><dt>Last heartbeat</dt><dd>${escapeHtml(fmtRelativeTime(overview.lastHeartbeatAt))}</dd></div>
          <div><dt>Session</dt><dd>${escapeHtml(overview.sessionId || 'No session')}</dd></div>
          <div><dt>Budget</dt><dd>${managerProgress(budget.percent || 0, '예산 사용률')}</dd></div>
        </dl>
        <div class="manager-dashboard-form">
          <label class="field compact">
            <span>상태</span>
            <select id="agentDashboardStatus">
              <option value="running"${selectedAttr(overview.status || 'running', 'running')}>Running</option>
              <option value="paused"${selectedAttr(overview.status || 'running', 'paused')}>Paused</option>
            </select>
          </label>
          <label class="field compact">
            <span>Heartbeat seconds</span>
            <input id="agentDashboardHeartbeatInterval" type="number" min="0" step="1" value="${escapeHtml(heartbeat.intervalSec ?? overview.heartbeatIntervalSec ?? 300)}">
          </label>
          <label class="field compact">
            <span>Monthly budget USD</span>
            <input id="agentDashboardMonthlyBudget" type="number" min="0" step="0.01" value="${escapeHtml(((Number(budget.monthlyCents) || 0) / 100).toFixed(2))}">
          </label>
        </div>
      </section>
      <section class="manager-card">
        <div class="section-kicker">Org Position</div>
        <h3>조직 위치</h3>
        <dl class="manager-kv">
          <div>
            <dt>Reports to</dt>
            <dd>${org.reportsTo ? `<button type="button" class="text-link" data-agent-link="${escapeHtml(org.reportsTo.id)}">${escapeHtml(org.reportsTo.name)}</button>` : '대표 / 최상위'}</dd>
          </div>
          <div>
            <dt>Direct reports</dt>
            <dd class="manager-chip-row">
              ${(org.directReports || []).length
                ? org.directReports.map((item) => `<button type="button" class="manager-chip" data-agent-link="${escapeHtml(item.id)}">${escapeHtml(item.name)}</button>`).join('')
                : '<span class="muted">직속 보고 없음</span>'}
            </dd>
          </div>
        </dl>
        <div class="manager-dashboard-form">
          <label class="field compact">
            <span>Reports to</span>
            <select id="agentOrgReportsTo">
              ${managerAgentOptions(reportsToId, agent.id)}
            </select>
          </label>
          <div class="field compact">
            <span>Direct reports</span>
            <div class="manager-agent-checks">
              ${managerDirectReportChecks(directReportIds, agent.id)}
            </div>
          </div>
        </div>
      </section>
    </div>
    <section class="manager-card">
      <div class="section-kicker">Runtime Routing</div>
      <h3>모델/어댑터</h3>
      <div class="manager-dashboard-form three">
        <label class="field compact">
          <span>Adapter type</span>
          <input id="agentDashboardAdapterType" type="text" value="${escapeHtml(adapter.type || overview.adapterType || 'connect_ai_local')}">
        </label>
        <label class="field compact">
          <span>Model</span>
          <input id="agentDashboardModel" type="text" value="${escapeHtml(adapter.model || overview.model || '')}">
        </label>
        <label class="field compact">
          <span>Model profile</span>
          <input id="agentDashboardModelProfile" type="text" value="${escapeHtml(adapter.modelProfile || overview.modelProfile || '')}">
        </label>
      </div>
      <div class="manager-form-actions">
        <button type="button" data-agent-save="dashboard">Save dashboard</button>
      </div>
    </section>
  `;
}

function renderManagerInstructions(agent, management) {
  const instructions = management.instructions || {};
  const primary = Array.isArray(instructions.primary) ? instructions.primary : [];
  return `
    <section class="manager-card">
      <div class="section-kicker">Instructions</div>
      <h3>${escapeHtml(agent.name)} 지침 편집</h3>
      <div class="manager-edit-form">
        <label class="field">
          <span>Primary instructions</span>
          <textarea id="agentInstructionInput" rows="8" placeholder="한 줄에 하나씩 입력">${escapeHtml(primary.join('\n'))}</textarea>
        </label>
        <label class="field">
          <span>Operating policy</span>
          <textarea id="agentPolicyInput" rows="8" placeholder="공통 운영 원칙">${escapeHtml(instructions.operatingPolicy || '')}</textarea>
        </label>
        <button type="button" data-agent-save="instructions">Save</button>
      </div>
    </section>
    ${managerSourceHtml(management.source)}
  `;
}

function selectedAttr(value, option) {
  return String(value || '') === String(option || '') ? ' selected' : '';
}

function checkedAttr(value) {
  return value ? ' checked' : '';
}

function managerSkillEditorRow(skill = {}) {
  const status = skill.status || 'enabled';
  return `
    <article class="manager-skill manager-skill-edit" data-skill-row>
      <label class="field compact">
        <span>Skill</span>
        <input class="manager-skill-name" type="text" value="${escapeHtml(skill.name || '')}" placeholder="스킬 이름">
      </label>
      <label class="field compact">
        <span>Source</span>
        <input class="manager-skill-source" type="text" value="${escapeHtml(skill.source || 'Connect AI')}" placeholder="출처">
      </label>
      <label class="field compact">
        <span>Status</span>
        <select class="manager-skill-status">
          <option value="enabled"${selectedAttr(status, 'enabled')}>enabled</option>
          <option value="disabled"${selectedAttr(status, 'disabled')}>disabled</option>
        </select>
      </label>
      <button type="button" class="danger small" data-agent-skill-remove>삭제</button>
    </article>
  `;
}

function renderManagerSkills(management) {
  const skills = Array.isArray(management.skills) ? management.skills : [];
  return `
    <section class="manager-card">
      <div class="section-kicker">Skills</div>
      <h3>스킬 편집</h3>
      <div id="agentSkillsEditor" class="manager-skill-grid editable">
        ${skills.map((skill) => managerSkillEditorRow(skill)).join('')}
      </div>
      <div class="manager-form-actions">
        <button type="button" class="secondary" data-agent-skill-add>스킬 추가</button>
        <button type="button" data-agent-save="skills">Save</button>
      </div>
    </section>
    ${managerSourceHtml(management.source)}
  `;
}

function settingsRows(values) {
  return Object.entries(values || {}).map(([key, value]) => `
    <div>
      <dt>${escapeHtml(key)}</dt>
      <dd>${escapeHtml(Array.isArray(value) ? value.join(', ') : value === true ? 'true' : value === false ? 'false' : value || '-')}</dd>
    </div>
  `).join('');
}

function managerInput(id, label, value, type = 'text', extra = '') {
  return `
    <label class="field">
      <span>${escapeHtml(label)}</span>
      <input id="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(value ?? '')}" ${extra}>
    </label>
  `;
}

function renderManagerSettings(agent, management) {
  const settings = management.settings || {};
  const identity = settings.identity || {};
  const adapter = settings.adapter || {};
  const heartbeat = settings.heartbeat || {};
  const runtime = settings.runtime || {};
  return `
    <section class="manager-card">
      <div class="section-kicker">Editable</div>
      <h3>상태 관리</h3>
      <div class="manager-edit-form">
        <label class="manager-toggle">
          <input id="agentActiveToggle" type="checkbox"${agent.active ? ' checked' : ''}>
          <span>에이전트 활성화</span>
        </label>
        <label class="field">
          <span>Goal Memo</span>
          <textarea id="agentGoalInput" rows="3" placeholder="이 에이전트의 현재 목표">${escapeHtml(agent.goal || '')}</textarea>
        </label>
      </div>
    </section>
    <div class="manager-two-col">
      <section class="manager-card">
        <div class="section-kicker">Identity</div>
        <h3>정체성 편집</h3>
        <div class="manager-edit-form">
          ${managerInput('agentIdentityName', 'Name', identity.name || agent.name)}
          ${managerInput('agentIdentityRole', 'Role', identity.role || agent.role)}
          ${managerInput('agentIdentityTitle', 'Title', identity.title || '')}
          <label class="field">
            <span>Capabilities</span>
            <textarea id="agentIdentityCapabilities" rows="4">${escapeHtml(identity.capabilities || '')}</textarea>
          </label>
        </div>
      </section>
      <section class="manager-card">
        <div class="section-kicker">Adapter</div>
        <h3>어댑터 편집</h3>
        <div class="manager-edit-form">
          ${managerInput('agentAdapterType', 'Type', adapter.type || 'connect_ai_local')}
          ${managerInput('agentAdapterModel', 'Model', adapter.model || '')}
          ${managerInput('agentAdapterProfile', 'Model profile', adapter.modelProfile || '')}
          ${managerInput('agentAdapterTemperature', 'Temperature', adapter.temperature ?? 0.35, 'number', 'min="0" max="2" step="0.05"')}
          ${managerInput('agentAdapterContext', 'Context mode', adapter.contextMode || 'brain')}
        </div>
      </section>
      <section class="manager-card">
        <div class="section-kicker">Heartbeat</div>
        <h3>실행 정책 편집</h3>
        <div class="manager-edit-form">
          <label class="manager-toggle">
            <input id="agentHeartbeatEnabled" type="checkbox"${checkedAttr(heartbeat.enabled !== false)}>
            <span>Heartbeat enabled</span>
          </label>
          ${managerInput('agentHeartbeatInterval', 'Interval seconds', heartbeat.intervalSec ?? 300, 'number', 'min="0" step="1"')}
          ${managerInput('agentHeartbeatCooldown', 'Cooldown seconds', heartbeat.cooldownSec ?? 10, 'number', 'min="0" step="1"')}
          <label class="manager-toggle"><input id="agentWakeAssignment" type="checkbox"${checkedAttr(heartbeat.wakeOnAssignment !== false)}><span>Wake on assignment</span></label>
          <label class="manager-toggle"><input id="agentWakeDemand" type="checkbox"${checkedAttr(heartbeat.wakeOnDemand !== false)}><span>Wake on demand</span></label>
          <label class="manager-toggle"><input id="agentWakeAutomation" type="checkbox"${checkedAttr(heartbeat.wakeOnAutomation !== false)}><span>Wake on automation</span></label>
        </div>
      </section>
      <section class="manager-card">
        <div class="section-kicker">Runtime</div>
        <h3>런타임 편집</h3>
        <div class="manager-edit-form">
          ${managerInput('agentRuntimeTimeout', 'Timeout seconds', runtime.timeoutSec ?? 45, 'number', 'min="1" step="1"')}
          ${managerInput('agentRuntimeGrace', 'Grace period seconds', runtime.gracePeriodSec ?? 15, 'number', 'min="0" step="1"')}
          ${managerInput('agentRuntimeConcurrency', 'Max concurrent runs', runtime.maxConcurrentRuns ?? 1, 'number', 'min="1" step="1"')}
          <label class="field">
            <span>Handoff targets</span>
            <textarea id="agentHandoffTargets" rows="3" placeholder="한 줄에 하나씩 입력">${escapeHtml(Array.isArray(settings.handoffTargets) ? settings.handoffTargets.join('\n') : '')}</textarea>
          </label>
        </div>
      </section>
    </div>
    <div class="manager-form-actions sticky-actions">
      <button type="button" data-agent-save="settings">Save</button>
    </div>
  `;
}

function runStatusLabel(status) {
  return status === 'done' || status === 'completed' ? '완료'
    : status === 'failed' ? '실패'
      : status === 'running' ? '실행 중'
        : status === 'cancelled' ? '취소'
          : '대기';
}

function renderManagerRuns(management) {
  const runs = Array.isArray(management.runs) ? management.runs : [];
  return `
    <section class="manager-card">
      <div class="section-kicker">Runs</div>
      <h3>실행기록</h3>
      <div class="manager-run-list">
        ${runs.length ? runs.map((run) => `
          <article class="manager-run">
            <span class="run-status status-${escapeHtml(run.status || 'open')}">${escapeHtml(runStatusLabel(run.status))}</span>
            <div>
              <strong>#${escapeHtml(String(run.id || '').slice(-8))} · ${escapeHtml(run.title || '작업')}</strong>
              <p>${escapeHtml(run.invocationSource || 'manual')} · ${escapeHtml(fmtRelativeTime(run.updatedAt || run.createdAt))} · ${Number(run.inputTokens || 0) + Number(run.outputTokens || 0)} tokens · ${fmtCents(run.costCents)}</p>
              <span>${escapeHtml(String(run.summary || '').split('\n')[0].slice(0, 180))}</span>
            </div>
          </article>
        `).join('') : '<div class="empty">아직 실행기록이 없습니다.</div>'}
      </div>
    </section>
    ${managerSourceHtml(management.source)}
  `;
}

function renderManagerBudget(management) {
  const budget = management.budget || {};
  const runs = Array.isArray(management.runs) ? management.runs : [];
  return `
    <section class="manager-card">
      <div class="section-kicker">Budget</div>
      <h3>월 예산 편집</h3>
      <div class="budget-hero manager-edit-form">
        <strong>${fmtCents(budget.spentCents)} / ${fmtCents(budget.monthlyCents)}</strong>
        ${managerProgress(budget.percent || 0, '월 예산 사용률')}
        ${managerInput('agentBudgetMonthlyDollars', 'Monthly budget USD', ((Number(budget.monthlyCents) || 0) / 100).toFixed(2), 'number', 'min="0" step="0.01"')}
        ${managerInput('agentBudgetSoftAlert', 'Soft alert percent', budget.softAlertPercent ?? 80, 'number', 'min="0" max="100" step="1"')}
        ${managerInput('agentBudgetHardStop', 'Hard stop percent', budget.hardStopPercent ?? 100, 'number', 'min="0" max="100" step="1"')}
        <label class="field">
          <span>Policy</span>
          <textarea id="agentBudgetPolicy" rows="3">${escapeHtml(budget.policy || '80% 소프트 알림, 100% 하드 스톱')}</textarea>
        </label>
        <button type="button" data-agent-save="budget">Save</button>
      </div>
    </section>
    <section class="manager-card">
      <div class="section-kicker">Per Run Cost</div>
      <h3>실행별 비용</h3>
      <div class="manager-cost-table">
        <div class="manager-cost-row head"><span>날짜</span><span>Run</span><span>Tokens</span><span>Cost</span></div>
        ${runs.length ? runs.map((run) => `
          <div class="manager-cost-row">
            <span>${escapeHtml(fmtTime(run.updatedAt || run.createdAt))}</span>
            <span>#${escapeHtml(String(run.id || '').slice(-8))}</span>
            <span>${Number(run.inputTokens || 0) + Number(run.outputTokens || 0)}</span>
            <span>${fmtCents(run.costCents)}</span>
          </div>
        `).join('') : '<div class="empty">비용 기록이 없습니다.</div>'}
      </div>
    </section>
    ${managerSourceHtml(management.source)}
  `;
}

function renderManagerTab(agent, management, tab) {
  if (tab === 'instructions') return renderManagerInstructions(agent, management);
  if (tab === 'skills') return renderManagerSkills(management);
  if (tab === 'settings') return renderManagerSettings(agent, management);
  if (tab === 'runs') return renderManagerRuns(management);
  if (tab === 'budget') return renderManagerBudget(management);
  return renderManagerDashboard(agent, management);
}

function renderAgentManager() {
  const box = $('agentManagerView');
  if (!box) return;
  const agent = currentAgent();
  const management = agent.management || {};
  const tab = AGENT_MANAGER_TAB_IDS.has(state.agentTab) ? state.agentTab : 'dashboard';
  box.innerHTML = `
    <section class="manager-hero surface" style="--accent:${escapeHtml(agent.accent || '#35c8ff')}">
      ${agentAvatarHtml(agent)}
      <div>
        <div class="section-kicker">Agent Management</div>
        <h1>${escapeHtml(agent.name)}</h1>
        <p>${escapeHtml(agent.role || '')}</p>
        <span>${escapeHtml(agent.tagline || agent.specialty || '')}</span>
      </div>
      <div class="manager-hero-actions">
        <button type="button" class="secondary small" data-dashboard-home>대시보드</button>
        <span class="manager-status ${agent.active ? 'on' : 'off'}">${agent.active ? 'Running' : 'Paused'}</span>
      </div>
    </section>
    ${managerTabsHtml(agent, tab)}
    <div class="manager-body">
      ${renderManagerTab(agent, management, tab)}
    </div>
  `;
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
      navigateAgent(agent.id, 'dashboard');
    });
    list.appendChild(item);
  });
}

function selectDashboardAgent(agentId) {
  if (!agentId) return;
  state.selectedAgent = agentId;
  state.agentTab = 'dashboard';
  renderAll();
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
      selectDashboardAgent(agent.id);
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
  if (raw.startsWith('local:') || raw.startsWith('openai:') || raw.startsWith('zai:') || raw.startsWith('moonshot:') || raw.startsWith('xai:')) return raw;
  return `local:${raw}`;
}

function preferredGrokChatModel(models, fallback = 'grok-4.3') {
  const list = Array.isArray(models) ? models : [];
  return list.find((model) => model === fallback)
    || list.find((model) => /grok/i.test(model) && !isNonChatModel(model))
    || fallback;
}

function isNonChatModel(model) {
  return /embed|embedding|image|imagine|video|composer/i.test(String(model || ''));
}

function isGrokProxyBase(base) {
  return String(base || '').replace(/\/+$/, '') === 'http://127.0.0.1:8317/v1';
}

function normalizeTestModelForBase(base, value) {
  const modelValue = normalizeModelValue(value);
  const modelName = modelValue.replace(/^(local|xai):/, '');
  if (isGrokProxyBase(base) && /grok/i.test(modelName) && isNonChatModel(modelName)) {
    return 'local:grok-4.3';
  }
  return modelValue;
}

function providerFromModelValue(id) {
  if (id.startsWith('openai:')) return 'openai';
  if (id.startsWith('zai:')) return 'zai';
  if (id.startsWith('moonshot:')) return 'moonshot';
  if (id.startsWith('xai:')) return 'xai';
  return 'local';
}

function isHiddenDirectProvider(provider) {
  return provider === 'moonshot' || provider === 'xai';
}

function modelNameFromValue(id, provider) {
  if (provider === 'openai') return id.slice('openai:'.length);
  if (provider === 'zai') return id.slice('zai:'.length);
  if (provider === 'moonshot') return id.slice('moonshot:'.length);
  if (provider === 'xai') return id.slice('xai:'.length);
  return id.slice('local:'.length);
}

function providerLabel(provider) {
  if (provider === 'openai') return 'OpenAI GPT-5.6';
  if (provider === 'zai') return 'GLM 5.1';
  if (provider === 'moonshot') return 'Kimi 2.6';
  if (provider === 'xai') return 'Grok 4.3';
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

function isVisibleModelOption(model) {
  return model && model.id && !isHiddenDirectProvider(model.provider) && !isNonChatModel(model.model || model.id);
}

function renderModels() {
  const select = $('modelSelect');
  select.innerHTML = '';
  const optionsById = new Map();
  [state.config.defaultModel, ...state.models].filter(Boolean).forEach((model) => {
    const option = normalizeModelOption(model);
    if (isVisibleModelOption(option)) optionsById.set(option.id, option);
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
    ['zai', 'GLM 5.1']
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
  all.filter((model) => !['local', 'openai', 'zai', 'moonshot', 'xai'].includes(model.provider)).forEach((model) => {
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

function renderGrokProxyCard() {
  return `
    <article class="api-provider grok-proxy-provider">
      <div class="api-provider-head">
        <div>
          <strong>Grok 4.3</strong>
          <span>구독 계정 · CLIProxyAPI</span>
        </div>
        <span class="api-status">Proxy</span>
      </div>
      <div class="subscription-auth-row">
        <span>Grok Build OAuth 프록시로 연결</span>
        <button type="button" data-api-action="grok-proxy">구독계정</button>
      </div>
      <div class="api-action-row">
        <button type="button" class="secondary" data-api-action="grok-proxy">Grok Proxy</button>
        <button type="button" class="secondary" data-api-action="grok-proxy-docs">Docs</button>
      </div>
    </article>
  `;
}

function renderApiProviders() {
  const list = $('apiProviderList');
  if (!list) return;
  if (!state.providers.length) {
    list.innerHTML = '<div class="empty">연결할 LLM 공급자가 없습니다.</div>';
    return;
  }
  list.innerHTML = state.providers.filter((provider) => !['moonshot', 'xai'].includes(provider.id)).map((provider) => {
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
    const isXaiProvider = provider.id === 'xai';
    const isApiKeyOnlyProvider = isZaiProvider || isMoonshotProvider || isXaiProvider;
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
      : isApiKeyOnlyProvider || !provider.oauthConfigured
        ? ''
        : `<button type="button" class="secondary" data-api-action="oauth" data-provider="${escapeHtml(provider.id)}">OAuth</button>`;
    const accountLabel = isSubscriptionProvider ? '구독 계정' : isXaiProvider ? '구독계정' : isApiKeyOnlyProvider ? '키 상태' : 'Account';
    const billingLabel = isSubscriptionProvider ? '구독 관리' : isZaiProvider ? 'Plan' : 'Billing';
    const card = `
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
    return provider.id === 'openai' ? `${card}${renderGrokProxyCard()}` : card;
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
  const open = tasks.filter((task) => taskQueueVisible(task) && !taskIsTerminal(task));
  const selected = open.find((task) => task.id === state.selectedTaskId) || open[0];
  if (!selected) {
    state.selectedTaskId = '';
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
      localStorage.setItem(RESULT_PANEL_COLLAPSED_KEY, 'false');
      applyResultPanelState(false);
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
  const visible = tasks.filter(taskQueueVisible).slice(0, 12);
  if (visible.length === 0) {
    list.innerHTML = '<div class="empty">열린 작업이 없습니다.</div>';
    state.selectedTaskId = '';
    renderTaskDetail();
    return;
  }
  list.innerHTML = visible.map((task) => {
    const agent = taskAgent(task);
    const disabled = task.source === 'company' ? ' disabled title="확장 tracker 작업은 웹에서 직접 수정하지 않습니다."' : '';
    const isTerminal = taskIsTerminal(task);
    const isRunning = task.status === 'running' || state.runningTaskIds.has(task.id);
    const runDisabled = disabled || isRunning ? ' disabled' : '';
    const progress = task.progress || { percent: 0, label: '진행 중' };
    const actionsHtml = isTerminal
      ? `<span class="task-terminal-note">${escapeHtml(progress.label || '완료')}</span>`
      : `
          <button type="button" class="icon-btn" data-run-task="${escapeHtml(task.id)}"${runDisabled} title="LLM으로 작업 실행">${isRunning ? '…' : '▶'}</button>
          <button type="button" class="icon-btn" data-task="${escapeHtml(task.id)}" data-status="done"${disabled}>✓</button>
          <button type="button" class="icon-btn danger" data-task="${escapeHtml(task.id)}" data-status="cancelled"${disabled}>×</button>
        `;
    return `
      <article class="work-item priority-${escapeHtml(task.priority)} ${isTerminal ? 'terminal' : ''} ${!isTerminal && task.id === state.selectedTaskId ? 'selected' : ''}"${isTerminal ? '' : ` data-task-row="${escapeHtml(task.id)}"`}>
        <div class="work-main">
          <span class="work-dot" style="background:${escapeHtml(agent.accent || '#90a0a8')}"></span>
          <div>
            <strong>${escapeHtml(task.title)}</strong>
            <span>${escapeHtml(agent.name || task.agent || 'Agent')} · ${escapeHtml(progress.label)} · ${progress.percent}%</span>
            <div class="mini-progress"><span style="width:${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%"></span></div>
          </div>
        </div>
        <div class="item-actions">${actionsHtml}</div>
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
  const activeVisible = visible.filter((task) => !taskIsTerminal(task));
  if (!state.selectedTaskId || !activeVisible.some((task) => task.id === state.selectedTaskId)) {
    state.selectedTaskId = activeVisible[0] ? activeVisible[0].id : '';
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

function renderResearch(report) {
  const box = $('brainResults');
  const items = report && Array.isArray(report.results) ? report.results : [];
  const insights = report && report.insights && typeof report.insights === 'object' ? report.insights : {};
  const nextActions = Array.isArray(insights.nextActions) ? insights.nextActions.filter(Boolean).slice(0, 3) : [];
  const nextActionHtml = nextActions.length
    ? `<div class="research-next-actions">
        <strong>다음 행동</strong>
        <ul>${nextActions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ul>
      </div>`
    : '';
  const summary = report
    ? `<div class="research-summary ${escapeHtml(report.status || '')}">
        <strong>${escapeHtml(report.status === 'ok' ? 'Research complete' : report.status === 'error' ? 'Research issue' : report.status === 'empty' ? 'Research empty' : 'Research')}</strong>
        <span>${escapeHtml(`${report.count || items.length} sources · ${report.mode || 'web'}${report.error ? ` · ${report.error}` : ''}`)}</span>
      </div>`
    : '';
  if (items.length === 0) {
    const isError = report && report.status === 'error';
    box.innerHTML = `${summary}${nextActionHtml}<div class="empty">${escapeHtml(isError && report.error ? `리서치 실패 · ${report.error}` : '리서치 결과가 없습니다.')}</div>`;
    return;
  }
  box.innerHTML = summary + items.slice(0, 6).map((item) => `
    <article class="brain-result research-result" title="${escapeHtml(item.url)}">
      <strong>${escapeHtml(item.title || item.url)}</strong>
      <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.url)}</a>
      <div class="research-meta">
        ${item.sourceType ? `<span>${escapeHtml(item.sourceType)}</span>` : ''}
        ${item.sourceQuality ? `<span>${escapeHtml(item.sourceQuality)}</span>` : ''}
        ${item.sourceReason ? `<span>${escapeHtml(item.sourceReason)}</span>` : ''}
      </div>
      <p>${escapeHtml(item.snippet || item.excerpt || '')}</p>
    </article>
  `).join('') + nextActionHtml;
}

function renderAll() {
  const dashboard = state.dashboard || {};
  state.agents = dashboard.agents || state.agents || [];
  state.config = dashboard.config || state.config || {};
  const agentRouteState = syncAgentRoute();
  const isManagerView = Boolean(agentRouteState);
  const dashboardView = $('dashboardView');
  const managerView = $('agentManagerView');
  if (dashboardView) dashboardView.classList.toggle('hidden', isManagerView);
  if (managerView) managerView.classList.toggle('hidden', !isManagerView);

  $('companyName').textContent = isManagerView ? `${currentAgent().name} · Agent` : 'AI Company';
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
  renderAgentManager();
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

async function refreshDashboard(options = {}) {
  state.dashboard = await api('/api/dashboard');
  state.agents = state.dashboard.agents || [];
  state.config = state.dashboard.config || {};
  const tasks = allDashboardTasks();
  syncRetainedTerminalTasks(tasks);
  if (options.clearTerminalTasks) clearTerminalTasksFromQueue(tasks);
  if (!state.agents.some((agent) => agent.id === state.selectedAgent)) {
    state.selectedAgent = state.agents[0] ? state.agents[0].id : 'ceo';
  }
  syncAgentRoute();
  renderAll();
}

async function refreshModels(options = {}) {
  try {
    const data = await api('/api/models');
    state.models = data.models || [];
    state.auth = data.auth || {};
    const successfulModel = options.applySuccessfulModel && state.lastSuccessfulLlmTest
      ? normalizeModelValue(state.lastSuccessfulLlmTest.model)
      : '';
    state.config.defaultModel = successfulModel || data.defaultModel || state.config.defaultModel || '';
    renderModels();
    if (successfulModel && [...$('modelSelect').options].some((option) => option.value === successfulModel)) {
      $('modelSelect').value = successfulModel;
    }
    if (successfulModel && options.persistSuccessfulModel) {
      const result = await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({
          ollamaBase: $('ollamaBase').value.trim(),
          defaultModel: successfulModel,
          localBrainPath: $('brainPath').value.trim()
        })
      });
      state.config = result.config || { ...state.config, defaultModel: successfulModel };
      renderModels();
      if ([...$('modelSelect').options].some((option) => option.value === successfulModel)) {
        $('modelSelect').value = successfulModel;
      }
      setLlmTestResult('ok', `모델 반영 완료 · ${successfulModel}`);
      setApiPanelResult('ok', `LLM Test 성공 모델을 반영했습니다.\n${successfulModel}`);
    }
    if (data.errors && data.errors.length) {
      const errorText = data.errors.map((item) => `${item.provider}: ${item.error}`).join('\n');
      setLlmTestResult('pending', `일부 모델 목록 실패 · ${errorText}`);
    } else if (options.fromButton && !successfulModel) {
      setLlmTestResult('ok', '모델 목록을 새로고침했습니다.');
      setApiPanelResult('ok', '모델 목록을 새로고침했습니다.');
    }
    return data;
  } catch (error) {
    state.models = [];
    renderModels();
    addMessage('error', 'Model check', `모델 목록을 가져오지 못했습니다.\n${error.message}`);
    return { models: [], errors: [{ provider: 'local', error: error.message }] };
  }
}

async function refreshModelsFromButton() {
  const button = $('refreshModels');
  const originalText = button ? button.textContent : 'Refresh';
  if (button) {
    button.disabled = true;
    button.textContent = 'Refreshing...';
  }
  const hasSuccessfulModel = Boolean(state.lastSuccessfulLlmTest && state.lastSuccessfulLlmTest.model);
  setLlmTestResult('pending', hasSuccessfulModel ? '성공한 LLM Test 모델을 반영 중...' : '모델 목록 새로고침 중...');
  setApiPanelResult('pending', hasSuccessfulModel ? '성공한 LLM Test 모델을 반영 중...' : '모델 목록 새로고침 중...');
  try {
    return await refreshModels({
      fromButton: true,
      applySuccessfulModel: true,
      persistSuccessfulModel: true
    });
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
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
      : providerId === 'xai'
        ? 'xAI 콘솔에서 xai- API Key를 발급한 뒤 입력해 주세요.'
      : 'API Key를 입력하고 Save를 눌러 주세요.';
    setApiPanelResult('error', `인증 필요 · ${result.provider || providerLabel(providerId)} · ${result.error || '인증 정보가 없습니다.'} · ${nextAction}`);
  } else if (result.errorKind === 'billing') {
    state.providerIssues[providerId] = { kind: 'billing', message: result.error };
    renderApiProviders();
    const nextAction = providerId === 'zai'
      ? 'Plan 버튼으로 현재 GLM Coding Plan 사용량과 키 상태를 확인해 주세요.'
      : providerId === 'xai'
        ? 'Billing 버튼으로 xAI 콘솔의 결제/사용량 상태를 확인해 주세요.'
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
    const selectedModel = normalizeTestModelForBase($('ollamaBase').value.trim(), $('modelSelect').value.trim());
    if ($('modelSelect').value !== selectedModel && [...$('modelSelect').options].some((option) => option.value === selectedModel)) {
      $('modelSelect').value = selectedModel;
    }
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
      state.lastSuccessfulLlmTest = null;
      const text = `${result.provider || 'LLM'} API key 필요 · ${result.error || '환경 변수를 설정해 주세요.'}`;
      setLlmTestResult('error', text);
      addMessage('error', 'LLM Test', `${text}\n${result.authUrl || ''}`);
      return;
    }
    if (result.connected) {
      state.lastSuccessfulLlmTest = {
        model: selectedModel,
        resultModel: result.model || '',
        upstreamModel: result.upstreamModel || '',
        provider: result.provider || '',
        base: $('ollamaBase').value.trim(),
        testedAt: new Date().toISOString()
      };
      const text = `연결 성공 · ${result.provider || 'LLM'} · ${result.model} · ${result.latencyMs}ms`;
      setLlmTestResult('ok', text);
      addMessage('system', 'LLM Test', `${text}\n${stageText}`);
    } else {
      state.lastSuccessfulLlmTest = null;
      const text = `연결 실패 · ${result.model || $('modelSelect').value || '모델 없음'} · ${result.error || '알 수 없는 오류'}`;
      setLlmTestResult('error', text);
      addMessage('error', 'LLM Test', `${text}\n${stageText}`);
    }
    await refreshDashboard();
  } catch (error) {
    state.lastSuccessfulLlmTest = null;
    setLlmTestResult('error', `연결 실패 · ${error.message}`);
    addMessage('error', 'LLM Test', error.message);
  } finally {
    button.disabled = false;
  }
}

async function saveConfig() {
  const button = $('saveConfig');
  const originalText = button ? button.textContent : 'Save';
  const payload = {
    ollamaBase: $('ollamaBase').value.trim(),
    defaultModel: $('modelSelect').value.trim(),
    localBrainPath: $('brainPath').value.trim()
  };
  if (button) {
    button.disabled = true;
    button.textContent = 'Saving...';
  }
  setLlmTestResult('pending', '설정 저장 중...');
  setApiPanelResult('pending', '설정 저장 중...');
  try {
    const result = await api('/api/config', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    state.config = result.config || { ...state.config, ...payload };
    await refreshDashboard();
    await refreshModels();
    renderModels();
    const savedModel = normalizeModelValue((state.config && state.config.defaultModel) || payload.defaultModel);
    if (savedModel && [...$('modelSelect').options].some((option) => option.value === savedModel)) {
      $('modelSelect').value = savedModel;
    }
    const savedBase = (state.config && state.config.ollamaBase) || payload.ollamaBase;
    const savedBrain = (state.config && state.config.localBrainPath) || payload.localBrainPath;
    const message = `저장 완료 · ${savedBase || 'LLM URL 유지'} · ${savedModel || '모델 유지'}`;
    setLlmTestResult('ok', message);
    setApiPanelResult('ok', `${message}\nBrain Folder · ${savedBrain || '기존 경로 유지'}`);
    addMessage('system', 'Saved', '웹 앱 설정을 저장했습니다.');
  } catch (error) {
    setLlmTestResult('error', `저장 실패 · ${error.message}`);
    setApiPanelResult('error', `저장 실패 · ${error.message}`);
    throw error;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function managerValue(id) {
  const input = $(id);
  return input ? input.value.trim() : '';
}

function managerNumber(id, fallback = 0) {
  const value = Number(managerValue(id));
  return Number.isFinite(value) ? value : fallback;
}

function managerChecked(id, fallback = false) {
  const input = $(id);
  return input ? input.checked : fallback;
}

function managerCheckedValues(name) {
  return [...document.querySelectorAll(`input[name="${name}"]:checked`)]
    .map((item) => item.value.trim())
    .filter(Boolean);
}

function managerLines(id) {
  return managerValue(id)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function collectManagerSkills() {
  return [...document.querySelectorAll('#agentSkillsEditor [data-skill-row]')]
    .map((row) => {
      const name = row.querySelector('.manager-skill-name') ? row.querySelector('.manager-skill-name').value.trim() : '';
      if (!name) return null;
      return {
        name,
        source: row.querySelector('.manager-skill-source') ? row.querySelector('.manager-skill-source').value.trim() : 'Connect AI',
        status: row.querySelector('.manager-skill-status') ? row.querySelector('.manager-skill-status').value : 'enabled'
      };
    })
    .filter(Boolean);
}

function collectAgentManagerPayload(section) {
  const activeInput = $('agentActiveToggle');
  const goalInput = $('agentGoalInput');
  const payload = {};
  if (activeInput) payload.active = activeInput.checked;
  if (goalInput) payload.goal = goalInput.value.trim();

  if (section === 'instructions') {
    payload.management = {
      instructions: {
        primary: managerLines('agentInstructionInput'),
        operatingPolicy: managerValue('agentPolicyInput')
      }
    };
  } else if (section === 'dashboard') {
    const dashboardStatus = managerValue('agentDashboardStatus') || 'running';
    const isRunning = dashboardStatus !== 'paused';
    payload.active = isRunning;
    payload.management = {
      settings: {
        adapter: {
          type: managerValue('agentDashboardAdapterType'),
          model: managerValue('agentDashboardModel'),
          modelProfile: managerValue('agentDashboardModelProfile')
        },
        heartbeat: {
          enabled: isRunning,
          intervalSec: managerNumber('agentDashboardHeartbeatInterval', 300)
        }
      },
      budget: {
        monthlyCents: Math.round(managerNumber('agentDashboardMonthlyBudget', 0) * 100)
      },
      org: {
        reportsToId: managerValue('agentOrgReportsTo'),
        directReportIds: managerCheckedValues('agentOrgDirectReports')
      }
    };
  } else if (section === 'skills') {
    payload.management = { skills: collectManagerSkills() };
  } else if (section === 'settings') {
    payload.management = {
      settings: {
        identity: {
          name: managerValue('agentIdentityName'),
          role: managerValue('agentIdentityRole'),
          title: managerValue('agentIdentityTitle'),
          capabilities: managerValue('agentIdentityCapabilities')
        },
        adapter: {
          type: managerValue('agentAdapterType'),
          model: managerValue('agentAdapterModel'),
          modelProfile: managerValue('agentAdapterProfile'),
          temperature: managerNumber('agentAdapterTemperature', 0.35),
          contextMode: managerValue('agentAdapterContext')
        },
        heartbeat: {
          enabled: managerChecked('agentHeartbeatEnabled', true),
          intervalSec: managerNumber('agentHeartbeatInterval', 300),
          cooldownSec: managerNumber('agentHeartbeatCooldown', 10),
          wakeOnAssignment: managerChecked('agentWakeAssignment', true),
          wakeOnDemand: managerChecked('agentWakeDemand', true),
          wakeOnAutomation: managerChecked('agentWakeAutomation', true)
        },
        runtime: {
          timeoutSec: managerNumber('agentRuntimeTimeout', 45),
          gracePeriodSec: managerNumber('agentRuntimeGrace', 15),
          maxConcurrentRuns: managerNumber('agentRuntimeConcurrency', 1)
        },
        handoffTargets: managerLines('agentHandoffTargets')
      }
    };
  } else if (section === 'budget') {
    payload.management = {
      budget: {
        monthlyCents: Math.round(managerNumber('agentBudgetMonthlyDollars', 0) * 100),
        softAlertPercent: managerNumber('agentBudgetSoftAlert', 80),
        hardStopPercent: managerNumber('agentBudgetHardStop', 100),
        policy: managerValue('agentBudgetPolicy')
      }
    };
  }

  return payload;
}

async function saveAgentManagerSettings(button = null, section = state.agentTab) {
  const agent = currentAgent();
  if (!agent || !agent.id) return;
  const payload = collectAgentManagerPayload(section);
  const originalText = button ? button.textContent : '';
  if (button) {
    button.disabled = true;
    button.textContent = 'Saving...';
  }
  try {
    await api(`/api/agents/${encodeURIComponent(agent.id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    });
    addMessage('system', 'Agent saved', `${agent.name} ${section} 저장 완료`);
    await refreshDashboard();
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

async function applyGrokProxy() {
  const buttons = [...document.querySelectorAll('#useGrokProxy, [data-api-action="grok-proxy"]')];
  buttons.forEach((button) => { button.disabled = true; });
  setLlmTestResult('pending', 'Grok OAuth Proxy 상태 확인 중...');
  setApiPanelResult('pending', 'Grok OAuth Proxy 상태 확인 중...');
  try {
    const status = await api(GROK_PROXY_STATUS_URL);
    const model = preferredGrokChatModel(status.models, status.model || 'grok-4.3');
    const modelValue = normalizeModelValue(model);
    const payload = {
      ollamaBase: status.base,
      defaultModel: modelValue,
      localBrainPath: $('brainPath').value.trim()
    };
    const result = await api('/api/config', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    state.config = result.config;
    $('ollamaBase').value = result.config.ollamaBase || status.base;
    await refreshDashboard();
    await refreshModels();
    renderModels();
    const selectedValue = normalizeModelValue(result.config.defaultModel || modelValue);
    if ([...$('modelSelect').options].some((option) => option.value === selectedValue)) {
      $('modelSelect').value = selectedValue;
    }
    const nextStep = status.running
      ? 'LLM Test로 확인할 수 있습니다.'
      : status.installed
        ? `${status.loginCommand} 후 ${status.serviceCommand}를 실행해 주세요.`
        : `${status.installCommand} 후 ${status.loginCommand}를 실행해 주세요.`;
    const message = `Grok OAuth Proxy 설정 저장 · ${status.base} · ${model} · ${nextStep}`;
    setLlmTestResult(status.running ? 'ok' : 'pending', message);
    setApiPanelResult(status.running ? 'ok' : 'pending', message);
    addMessage('system', 'Grok Proxy', `CLIProxyAPI 설정을 저장했습니다.\n${status.base}\n${nextStep}`);
    if (status.running) await testLlmConnection();
  } catch (error) {
    setLlmTestResult('error', `Grok OAuth Proxy 설정 실패 · ${error.message}`);
    setApiPanelResult('error', `Grok OAuth Proxy 설정 실패 · ${error.message}`);
    addMessage('error', 'Grok Proxy', error.message);
  } finally {
    buttons.forEach((button) => { button.disabled = false; });
  }
}

function openGrokProxyDocs() {
  window.open('https://help.router-for.me/configuration/provider/xai', '_blank');
  setApiPanelResult('pending', 'CLIProxyAPI Grok OAuth 문서를 열었습니다.');
}

async function createTask(event) {
  event.preventDefault();
  const context = $('taskTitle').value.trim();
  const title = context.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
  if (!title) return;
  state.taskAgentSelection = $('taskAgent').value;
  await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({
      title,
      description: context,
      agent: state.taskAgentSelection,
      priority: $('taskPriority').value,
      autoRun: true
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
  state.approvalAgentSelection = $('approvalAgent').value;
  await api('/api/approvals', {
    method: 'POST',
    body: JSON.stringify({
      title,
      agent: state.approvalAgentSelection,
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

async function autoResearch(source = 'web') {
  const query = $('brainQuery').value.trim();
  if (!query) return;
  const box = $('brainResults');
  const sourceConfig = {
    web: { button: 'autoResearchButton', param: '', loading: 'Researching', label: 'Research', pending: '리서치 중...' },
    x: { button: 'xResearchButton', param: '&source=x', loading: 'X Searching', label: 'X Search', pending: 'X 검색 중...' },
    threads: { button: 'threadsResearchButton', param: '&source=threads', loading: 'Threads Searching', label: 'Threads', pending: 'Threads 검색 중...' },
    instagram: { button: 'instagramResearchButton', param: '&source=instagram', loading: 'Instagram Searching', label: 'Instagram', pending: 'Instagram 검색 중...' },
    linkedin: { button: 'linkedinResearchButton', param: '&source=linkedin', loading: 'LinkedIn Searching', label: 'LinkedIn', pending: 'LinkedIn 검색 중...' },
    youtube: { button: 'youtubeResearchButton', param: '&source=youtube', loading: 'YouTube Searching', label: 'YouTube', pending: 'YouTube 검색 중...' }
  }[source] || { button: 'autoResearchButton', param: '', loading: 'Researching', label: 'Research', pending: '리서치 중...' };
  const button = $(sourceConfig.button);
  const sourceParam = sourceConfig.param;
  if (button) {
    button.disabled = true;
    button.textContent = sourceConfig.loading;
  }
  box.innerHTML = `<div class="empty">${sourceConfig.pending}</div>`;
  try {
    const result = await api(`/api/research?q=${encodeURIComponent(query)}${sourceParam}`);
    renderResearch(result);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = sourceConfig.label;
    }
  }
}

async function sendMessage(message) {
  if (state.isSendingMessage) return;
  state.isSendingMessage = true;
  const selected = currentAgent();
  addMessage('user', 'You', message);
  const pending = addMessage('assistant pending', selected ? selected.name : 'Connect AI', '답변 작성 중...');
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
    const sourceItems = Array.isArray(result.sources)
      ? result.sources.map((source) => typeof source === 'string' ? source : source.url || source.title || '').filter(Boolean)
      : [];
    const sources = sourceItems.length ? `\n\n출처\n${sourceItems.join('\n')}` : '';
    setMessageContent(pending, 'assistant', selected ? selected.name : 'Connect AI', (result.text || '(빈 응답)') + sources);
    await refreshDashboard();
  } catch (error) {
    setMessageContent(pending, 'error', 'Error', error.message);
  } finally {
    state.isSendingMessage = false;
    $('sendButton').disabled = false;
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
  }
}

function resizeMessageInput() {
  const input = $('messageInput');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 168)}px`;
}

function submitChatMessage() {
  if (state.isComposingMessage || state.isSendingMessage) return;
  const input = $('messageInput');
  const message = input.value.trim();
  if (!message) return;
  input.value = '';
  resizeMessageInput();
  sendMessage(message);
}

function goHome() {
  state.agentTab = 'dashboard';
  window.location.hash = '';
  renderAll();
  try {
    if (String(navigator.userAgent || '').includes('jsdom')) return;
    window.scrollTo({ top: 0, left: 0 });
  } catch {
    // Some test DOMs do not implement scrollTo.
  }
}

function bindEvents() {
  $('brandHome').addEventListener('click', goHome);
  $('sidebarToggle').addEventListener('click', toggleSidebar);
  $('resultPanelToggle').addEventListener('click', toggleResultPanel);
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
  $('agentManagerView').addEventListener('click', (event) => {
    const tabButton = event.target.closest('[data-agent-tab]');
    if (tabButton) {
      navigateAgent(state.selectedAgent, tabButton.dataset.agentTab || 'dashboard');
      return;
    }
    const agentLink = event.target.closest('[data-agent-link]');
    if (agentLink) {
      navigateAgent(agentLink.dataset.agentLink || '', 'dashboard');
      return;
    }
    const dashboardButton = event.target.closest('[data-dashboard-home]');
    if (dashboardButton) {
      window.location.hash = '';
      renderAll();
      return;
    }
    const addSkillButton = event.target.closest('[data-agent-skill-add]');
    if (addSkillButton) {
      const editor = $('agentSkillsEditor');
      if (editor) editor.insertAdjacentHTML('beforeend', managerSkillEditorRow({ name: '', source: 'Connect AI', status: 'enabled' }));
      return;
    }
    const removeSkillButton = event.target.closest('[data-agent-skill-remove]');
    if (removeSkillButton) {
      const row = removeSkillButton.closest('[data-skill-row]');
      if (row) row.remove();
      return;
    }
    const saveButton = event.target.closest('[data-agent-save]');
    if (saveButton) {
      saveAgentManagerSettings(saveButton, saveButton.dataset.agentSave || state.agentTab)
        .catch((error) => addMessage('error', 'Agent save failed', error.message));
    }
  });
  window.addEventListener('hashchange', () => {
    syncAgentRoute();
    renderAll();
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
        ? (provider === 'xai' ? applyGrokProxy() : startProviderAccountAuth(provider))
      : action === 'oauth'
        ? startProviderOAuth(provider)
        : action === 'test'
          ? testProvider(provider)
          : action === 'billing'
            ? Promise.resolve(openProviderBilling(provider))
          : action === 'disconnect'
            ? disconnectProvider(provider)
            : action === 'grok-proxy'
              ? applyGrokProxy()
              : action === 'grok-proxy-docs'
                ? Promise.resolve(openGrokProxyDocs())
            : Promise.resolve();
    run.catch((error) => setApiPanelResult('error', error.message))
      .finally(() => { button.disabled = false; });
  });
  $('saveConfig').addEventListener('click', () => {
    saveConfig().catch((error) => addMessage('error', 'Save failed', error.message));
  });
  $('refreshModels').addEventListener('click', () => {
    refreshModelsFromButton().catch((error) => addMessage('error', 'Refresh failed', error.message));
  });
  $('testLlm').addEventListener('click', () => {
    testLlmConnection().catch((error) => addMessage('error', 'LLM Test failed', error.message));
  });
  $('refreshDashboard').addEventListener('click', () => {
    refreshDashboard({ clearTerminalTasks: true }).catch((error) => addMessage('error', 'Refresh failed', error.message));
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
  $('taskAgent').addEventListener('change', (event) => {
    state.taskAgentSelection = event.target.value;
  });
  $('approvalForm').addEventListener('submit', (event) => {
    createApproval(event).catch((error) => addMessage('error', 'Approval failed', error.message));
  });
  $('approvalAgent').addEventListener('change', (event) => {
    state.approvalAgentSelection = event.target.value;
  });
  $('brainSearchForm').addEventListener('submit', (event) => {
    searchBrain(event).catch((error) => addMessage('error', 'Search failed', error.message));
  });
  $('autoResearchButton').addEventListener('click', () => {
    autoResearch().catch((error) => {
      renderResearch({ status: 'error', mode: 'web', count: 0, error: error.message, results: [], sources: [] });
      addMessage('error', 'Research failed', error.message);
    });
  });
  $('xResearchButton').addEventListener('click', () => {
    autoResearch('x').catch((error) => {
      renderResearch({ status: 'error', mode: 'x-grok-oauth-proxy', count: 0, error: error.message, results: [], sources: [] });
      addMessage('error', 'X Search failed', error.message);
    });
  });
  $('threadsResearchButton').addEventListener('click', () => {
    autoResearch('threads').catch((error) => {
      renderResearch({ status: 'error', mode: 'threads-web-search', count: 0, error: error.message, results: [], sources: [] });
      addMessage('error', 'Threads Search failed', error.message);
    });
  });
  $('instagramResearchButton').addEventListener('click', () => {
    autoResearch('instagram').catch((error) => {
      renderResearch({ status: 'error', mode: 'instagram-web-search', count: 0, error: error.message, results: [], sources: [] });
      addMessage('error', 'Instagram Search failed', error.message);
    });
  });
  $('linkedinResearchButton').addEventListener('click', () => {
    autoResearch('linkedin').catch((error) => {
      renderResearch({ status: 'error', mode: 'linkedin-web-search', count: 0, error: error.message, results: [], sources: [] });
      addMessage('error', 'LinkedIn Search failed', error.message);
    });
  });
  $('youtubeResearchButton').addEventListener('click', () => {
    autoResearch('youtube').catch((error) => {
      renderResearch({ status: 'error', mode: 'youtube-web-search', count: 0, error: error.message, results: [], sources: [] });
      addMessage('error', 'YouTube Search failed', error.message);
    });
  });
  $('chatForm').addEventListener('submit', (event) => {
    event.preventDefault();
    submitChatMessage();
  });
  $('messageInput').addEventListener('keydown', (event) => {
    if (event.isComposing || state.isComposingMessage || event.keyCode === 229 || event.key === 'Process') return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitChatMessage();
    }
  });
  $('messageInput').addEventListener('compositionstart', () => {
    state.isComposingMessage = true;
  });
  $('messageInput').addEventListener('compositionend', () => {
    state.isComposingMessage = false;
  });
  $('messageInput').addEventListener('input', resizeMessageInput);
  resizeMessageInput();
}

async function boot() {
  rememberInternalRoute();
  updateResultBackLink();
  loadOfficePositions();
  applyDefaultLayoutState();
  loadSidebarState();
  loadResultPanelState();
  bindEvents();
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
