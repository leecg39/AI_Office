const completedState = {
  agents: [],
  tasks: [],
  selectedTaskId: ''
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
    // Session storage can be unavailable in restricted contexts.
  }
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

function fmtTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

async function api(path) {
  const response = await fetch(path);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

function completedTasks() {
  return completedState.tasks
    .filter((task) => task.status === 'done')
    .sort((a, b) => String(b.completedAt || b.updatedAt || b.createdAt || '')
      .localeCompare(String(a.completedAt || a.updatedAt || a.createdAt || '')));
}

function taskAgent(task) {
  return completedState.agents.find((agent) => agent.id === task.agent) || {};
}

function renderCompletedList() {
  const list = $('completedList');
  const tasks = completedTasks();
  $('completedCount').textContent = String(tasks.length);
  if (!tasks.length) {
    list.innerHTML = '<div class="empty">완료된 작업이 없습니다.</div>';
    renderCompletedDetail(null);
    return;
  }
  if (!tasks.some((task) => task.id === completedState.selectedTaskId)) {
    completedState.selectedTaskId = tasks[0].id;
  }
  list.innerHTML = tasks.map((task) => {
    const agent = taskAgent(task);
    const selected = task.id === completedState.selectedTaskId ? ' selected' : '';
    const resultState = task.result ? '결과 저장됨' : '결과 없음';
    return `
      <a class="completed-item${selected}" href="#${encodeURIComponent(task.id)}" data-task-id="${escapeHtml(task.id)}">
        <span class="agent-avatar small" style="--accent:${escapeHtml(agent.accent || '#35c8ff')}">
          ${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="">` : `<span>${escapeHtml(agent.emoji || '')}</span>`}
        </span>
        <span class="completed-item-main">
          <strong>${escapeHtml(task.title || '완료 작업')}</strong>
          <span>${escapeHtml(agent.name || task.agent || 'Agent')} · ${escapeHtml(fmtTime(task.completedAt || task.updatedAt || task.createdAt))}</span>
        </span>
        <em>${escapeHtml(resultState)}</em>
      </a>
    `;
  }).join('');
  renderCompletedDetail(tasks.find((task) => task.id === completedState.selectedTaskId) || tasks[0]);
}

function selectCompletedTask(id, updateHash = true) {
  completedState.selectedTaskId = id || '';
  if (updateHash) {
    window.history.replaceState(null, '', completedState.selectedTaskId ? `#${encodeURIComponent(completedState.selectedTaskId)}` : '#');
  }
  renderCompletedList();
}

function renderCompletedDetail(task) {
  const detail = $('completedDetail');
  if (!task) {
    detail.innerHTML = '<div class="empty">완료된 결과물이 생기면 여기에 표시됩니다.</div>';
    return;
  }
  const agent = taskAgent(task);
  const sources = Array.isArray(task.sources) && task.sources.length
    ? `<div class="completed-sources"><strong>Sources</strong>${task.sources.map((source) => `<span>${escapeHtml(source)}</span>`).join('')}</div>`
    : '';
  const result = task.result
    ? `<div class="completed-result">${escapeHtml(task.result)}</div>`
    : '<div class="completed-result empty-result">저장된 결과물이 없습니다.</div>';
  detail.innerHTML = `
    <div class="completed-detail-head">
      <span class="agent-avatar small" style="--accent:${escapeHtml(agent.accent || '#35c8ff')}">
        ${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="">` : `<span>${escapeHtml(agent.emoji || '')}</span>`}
      </span>
      <div>
        <div class="section-kicker">${escapeHtml(agent.name || task.agent || 'Agent')}</div>
        <h2>${escapeHtml(task.title || '완료 작업')}</h2>
        <p>${escapeHtml(fmtTime(task.completedAt || task.updatedAt || task.createdAt))}</p>
      </div>
    </div>
    ${task.description ? `<p class="completed-description">${escapeHtml(task.description)}</p>` : ''}
    ${result}
    ${sources}
  `;
}

async function loadCompleted() {
  const [status, tasks] = await Promise.all([
    api('/api/status'),
    api('/api/tasks')
  ]);
  completedState.agents = status.agents || [];
  completedState.tasks = tasks.tasks || [];
  const hashId = decodeURIComponent((window.location.hash || '').replace(/^#/, ''));
  if (hashId) completedState.selectedTaskId = hashId;
  renderCompletedList();
}

document.addEventListener('DOMContentLoaded', () => {
  rememberInternalRoute();
  $('completedList').addEventListener('click', (event) => {
    const item = event.target.closest('[data-task-id]');
    if (!item) return;
    event.preventDefault();
    selectCompletedTask(item.dataset.taskId || '');
  });
  window.addEventListener('hashchange', () => {
    selectCompletedTask(decodeURIComponent((window.location.hash || '').replace(/^#/, '')), false);
  });
  $('refreshCompleted').addEventListener('click', () => {
    loadCompleted().catch((error) => {
      $('completedDetail').innerHTML = `<div class="empty">불러오기 실패: ${escapeHtml(error.message)}</div>`;
    });
  });
  loadCompleted().catch((error) => {
    $('completedList').innerHTML = '';
    $('completedDetail').innerHTML = `<div class="empty">불러오기 실패: ${escapeHtml(error.message)}</div>`;
  });
});
