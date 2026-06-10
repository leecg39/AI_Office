const completedState = {
  agents: [],
  tasks: [],
  selectedTaskId: '',
  selectedDeleteIds: new Set()
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

function repairSourceProtocol(value) {
  return String(value || '').replace(/^(https?):\/(?!\/)/i, '$1://');
}

function splitTrailingSourcePunctuation(value) {
  const match = String(value || '').match(/^(.+?)([.,;:!?)]*)$/);
  return match ? { url: match[1], trailing: match[2] || '' } : { url: value, trailing: '' };
}

function sourceHref(value) {
  const { url } = splitTrailingSourcePunctuation(repairSourceProtocol(value));
  try {
    const parsed = new URL(url);
    return /^https?:$/i.test(parsed.protocol) ? parsed.href : '';
  } catch {
    return '';
  }
}

function renderCompletedSource(source) {
  const text = String(source || '').trim();
  if (!text) return '';
  const href = sourceHref(text);
  if (!href) return `<span>${escapeHtml(text)}</span>`;
  return `<a class="completed-source-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(text)}</a>`;
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

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
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

function pruneSelectedDeleteIds(tasks) {
  const visibleIds = new Set(tasks.map((task) => task.id));
  completedState.selectedDeleteIds.forEach((id) => {
    if (!visibleIds.has(id)) completedState.selectedDeleteIds.delete(id);
  });
}

function updateSelectionControls(tasks = completedTasks()) {
  const allCheckbox = $('completedSelectAll');
  const deleteButton = $('deleteSelectedCompleted');
  if (!allCheckbox || !deleteButton) return;
  const selectedCount = completedState.selectedDeleteIds.size;
  allCheckbox.disabled = tasks.length === 0;
  allCheckbox.checked = tasks.length > 0 && selectedCount === tasks.length;
  allCheckbox.indeterminate = selectedCount > 0 && selectedCount < tasks.length;
  deleteButton.disabled = selectedCount === 0;
  deleteButton.setAttribute('aria-label', selectedCount ? `${selectedCount}개 항목 삭제` : '선택 항목 삭제');
}

function renderCompletedList() {
  const list = $('completedList');
  const tasks = completedTasks();
  pruneSelectedDeleteIds(tasks);
  $('completedCount').textContent = String(tasks.length);
  if (!tasks.length) {
    list.innerHTML = '<div class="empty">완료된 작업이 없습니다.</div>';
    renderCompletedDetail(null);
    updateSelectionControls(tasks);
    return;
  }
  if (!tasks.some((task) => task.id === completedState.selectedTaskId)) {
    completedState.selectedTaskId = tasks[0].id;
  }
  list.innerHTML = tasks.map((task) => {
    const agent = taskAgent(task);
    const selected = task.id === completedState.selectedTaskId ? ' selected' : '';
    const checked = completedState.selectedDeleteIds.has(task.id) ? ' checked' : '';
    const resultState = task.result ? '결과 저장됨' : '결과 없음';
    return `
      <article class="completed-item${selected}" data-task-id="${escapeHtml(task.id)}">
        <button class="completed-item-select" type="button" data-select-task="${escapeHtml(task.id)}">
          <span class="agent-avatar small" style="--accent:${escapeHtml(agent.accent || '#35c8ff')}">
            ${agent.avatar ? `<img src="${escapeHtml(agent.avatar)}" alt="">` : `<span>${escapeHtml(agent.emoji || '')}</span>`}
          </span>
          <span class="completed-item-main">
            <strong>${escapeHtml(task.title || '완료 작업')}</strong>
            <span>${escapeHtml(agent.name || task.agent || 'Agent')} · ${escapeHtml(fmtTime(task.completedAt || task.updatedAt || task.createdAt))}</span>
          </span>
          <em>${escapeHtml(resultState)}</em>
        </button>
        <label class="completed-check" aria-label="${escapeHtml(`${task.title || '완료 작업'} 선택`)}">
          <input class="completed-checkbox" type="checkbox" data-toggle-task="${escapeHtml(task.id)}"${checked}>
        </label>
      </article>
    `;
  }).join('');
  renderCompletedDetail(tasks.find((task) => task.id === completedState.selectedTaskId) || tasks[0]);
  updateSelectionControls(tasks);
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
    ? `<div class="completed-sources"><strong>Sources</strong>${task.sources.map(renderCompletedSource).join('')}</div>`
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

function setAllCompletedChecked(checked) {
  const tasks = completedTasks();
  completedState.selectedDeleteIds.clear();
  if (checked) {
    tasks.forEach((task) => completedState.selectedDeleteIds.add(task.id));
  }
  renderCompletedList();
}

function setCompletedChecked(id, checked) {
  if (!id) return;
  if (checked) {
    completedState.selectedDeleteIds.add(id);
  } else {
    completedState.selectedDeleteIds.delete(id);
  }
  updateSelectionControls();
}

async function deleteSelectedCompletedTasks() {
  const ids = Array.from(completedState.selectedDeleteIds);
  if (!ids.length) return;
  const count = ids.length;
  if (typeof window.confirm === 'function' && !window.confirm(`선택한 ${count}개 항목을 삭제할까요?`)) return;
  const button = $('deleteSelectedCompleted');
  if (button) button.disabled = true;
  try {
    for (const id of ids) {
      await api(`/api/tasks/${encodeURIComponent(id)}`, { method: 'DELETE' });
    }
  } finally {
    if (button) button.disabled = false;
  }
  const deleted = new Set(ids);
  completedState.selectedDeleteIds.clear();
  completedState.tasks = completedState.tasks.filter((item) => !deleted.has(item.id));
  if (deleted.has(completedState.selectedTaskId)) {
    const next = completedTasks()[0];
    completedState.selectedTaskId = next ? next.id : '';
    window.history.replaceState(null, '', completedState.selectedTaskId ? `#${encodeURIComponent(completedState.selectedTaskId)}` : window.location.pathname);
  }
  renderCompletedList();
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
    if (event.target.closest('[data-toggle-task]') || event.target.closest('.completed-check')) {
      event.stopPropagation();
      return;
    }
    const selectButton = event.target.closest('[data-select-task]');
    if (!selectButton) return;
    event.preventDefault();
    selectCompletedTask(selectButton.dataset.selectTask || '');
  });
  $('completedList').addEventListener('change', (event) => {
    const checkbox = event.target.closest('[data-toggle-task]');
    if (!checkbox) return;
    setCompletedChecked(checkbox.dataset.toggleTask || '', checkbox.checked);
  });
  window.addEventListener('hashchange', () => {
    selectCompletedTask(decodeURIComponent((window.location.hash || '').replace(/^#/, '')), false);
  });
  $('completedSelectAll').addEventListener('change', (event) => {
    setAllCompletedChecked(event.target.checked);
  });
  $('deleteSelectedCompleted').addEventListener('click', () => {
    deleteSelectedCompletedTasks().catch((error) => {
      $('completedDetail').innerHTML = `<div class="empty">삭제 실패: ${escapeHtml(error.message)}</div>`;
      updateSelectionControls();
    });
  });
  loadCompleted().catch((error) => {
    $('completedList').innerHTML = '';
    $('completedDetail').innerHTML = `<div class="empty">불러오기 실패: ${escapeHtml(error.message)}</div>`;
  });
});
