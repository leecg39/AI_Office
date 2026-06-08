#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const completedHtml = fs.readFileSync(path.join(ROOT, 'web', 'completed.html'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'web', 'app.js'), 'utf8');
const completedApp = fs.readFileSync(path.join(ROOT, 'web', 'completed.js'), 'utf8');
const webServer = fs.readFileSync(path.join(ROOT, 'scripts', 'web-server.js'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'web', 'styles.css'), 'utf8');
const dom = new JSDOM(html);
const document = dom.window.document;

const checks = [];

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function check(name, run) {
  try {
    await run();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message || String(error) });
  }
}

function byId(id) {
  return document.getElementById(id);
}

function mockResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    json: async () => data
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, message, timeoutMs = 800) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await delay(10);
  }
  throw new Error(message);
}

async function createRunningAppDom() {
  const runtime = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1:8788/',
    pretendToBeVisual: true
  });
  const calls = [];
  runtime.window.setInterval = () => 0;
  runtime.window.fetch = async (requestPath, options = {}) => {
    const url = String(requestPath);
    calls.push(url);
    if (url === '/api/dashboard') {
      return mockResponse({
        ok: true,
        version: 'qa',
        config: { defaultModel: 'local:grok-4.3' },
        brain: { fileCount: 1, capped: false },
        agents: [
          { id: 'ceo', name: 'Anna', role: 'CEO', avatar: '', active: true, openTasks: 0 },
          { id: 'writer', name: 'Jenny', role: 'Copywriter', avatar: '', active: true, openTasks: 0 }
        ],
        tasks: { open: 0, all: [] },
        approvals: { pending: 0, all: [] },
        events: []
      });
    }
    if (url === '/api/models') {
      return mockResponse({
        ok: true,
        defaultModel: 'local:grok-4.3',
        models: [
          { id: 'local:grok-4.3', provider: 'local', model: 'grok-4.3' },
          { id: 'local:grok-imagine-image', provider: 'local', model: 'grok-imagine-image' },
          { id: 'moonshot:kimi-k2.6', provider: 'moonshot', model: 'kimi-k2.6' },
          { id: 'xai:grok-4.3', provider: 'xai', model: 'grok-4.3' },
          { id: 'zai:glm-5.1', provider: 'zai', model: 'glm-5.1' }
        ],
        auth: {}
      });
    }
    if (url === '/api/llm/providers') {
      return mockResponse({
        ok: true,
        providers: [
          { id: 'openai', name: 'OpenAI GPT-5.6', connected: true, method: 'chatmock', authFlow: 'chatmock' },
          { id: 'moonshot', name: 'Kimi 2.6', connected: true, method: 'apiKey' },
          { id: 'xai', name: 'Grok 4.3', connected: true, method: 'apiKey' },
          { id: 'zai', name: 'GLM 5.1', connected: true, method: 'apiKey' }
        ]
      });
    }
    if (url === '/api/brain') {
      return mockResponse({
        ok: true,
        files: [{ path: 'qa.md', title: 'QA Brain Seed', snippet: 'seed' }],
        capped: false
      });
    }
    if (url === '/api/chat') {
      await delay(5);
      const payload = JSON.parse(options.body || '{}');
      return mockResponse({
        ok: true,
        sessionId: payload.sessionId || 'qa-session',
        text: '확인했습니다. 자세한 내용은 https://example.com/connect-ai/chat 을 참고하세요.\nReuters 원문: http://reuters-reuters-prod.cdn.arcpublishing.com/technology/eu-ai-act-enforcement-begins-2025-04-17/%5d(https:/www.reuters.com/technology/eu-ai-act-enforcement-begins-2025-04-17/',
        sources: ['https://example.com/connect-ai/source-one', 'https://example.com/connect-ai/source-two.']
      });
    }
    if (url.startsWith('/api/research?q=')) {
      await delay(5);
      if (url.includes('source=youtube')) {
        return mockResponse({
          ok: true,
          query: 'QA_AUTO_RESEARCH_FIXTURE',
          mode: 'youtube-web-search-mock',
          status: 'ok',
          searchedAt: '2026-06-07T00:00:00.000Z',
          count: 1,
          sources: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
          results: [{
            title: 'YouTube Search Fixture',
            url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            snippet: '채널: Connect AI QA · 게시: 2026. 06. 07. · 조회수: 123,456회'
          }]
        });
      }
      if (url.includes('source=threads')) {
        return mockResponse({
          ok: true,
          query: 'QA_AUTO_RESEARCH_FIXTURE',
          mode: 'threads-web-search-mock',
          status: 'ok',
          searchedAt: '2026-06-07T00:00:00.000Z',
          count: 1,
          sources: ['https://www.threads.net/search?q=QA_AUTO_RESEARCH_FIXTURE'],
          results: [{
            title: 'Threads Search Fixture',
            url: 'https://www.threads.net/search?q=QA_AUTO_RESEARCH_FIXTURE',
            snippet: 'Threads web search fixture.'
          }]
        });
      }
      if (url.includes('source=x')) {
        return mockResponse({
          ok: true,
          query: 'QA_AUTO_RESEARCH_FIXTURE',
          mode: 'x-grok-oauth-proxy-mock',
          status: 'ok',
          searchedAt: '2026-06-07T00:00:00.000Z',
          count: 1,
          sources: ['https://x.com/search?q=QA_AUTO_RESEARCH_FIXTURE&src=typed_query&f=live'],
          results: [{
            title: 'X Search Fixture',
            url: 'https://x.com/search?q=QA_AUTO_RESEARCH_FIXTURE&src=typed_query&f=live',
            snippet: 'Grok OAuth subscription research fixture.'
          }]
        });
      }
      if (url.includes('QA_AUTO_RESEARCH_HTTP_ERROR')) {
        return mockResponse({
          ok: false,
          error: 'QA HTTP research outage'
        }, 502);
      }
      if (url.includes('QA_AUTO_RESEARCH_EMPTY')) {
        return mockResponse({
          ok: true,
          query: 'QA_AUTO_RESEARCH_EMPTY',
          mode: 'mock',
          status: 'empty',
          searchedAt: '2026-06-07T00:00:00.000Z',
          count: 0,
          sources: [],
          results: [],
          error: '검색 결과가 없습니다.'
        });
      }
      if (url.includes('QA_AUTO_RESEARCH_ERROR')) {
        return mockResponse({
          ok: true,
          query: 'QA_AUTO_RESEARCH_ERROR',
          mode: 'mock',
          status: 'error',
          searchedAt: '2026-06-07T00:00:00.000Z',
          count: 0,
          sources: [],
          results: [],
          error: 'QA mock research upstream error'
        });
      }
      return mockResponse({
        ok: true,
        query: 'QA_AUTO_RESEARCH_FIXTURE',
        mode: 'mock',
        status: 'ok',
        searchedAt: '2026-06-07T00:00:00.000Z',
        count: 1,
        sources: ['https://example.com/connect-ai/qa-auto-research'],
        results: [{
          title: 'QA Auto Research Fixture',
          url: 'https://example.com/connect-ai/qa-auto-research',
          snippet: 'Dynamic UI research rendering fixture.'
        }]
      });
    }
    return mockResponse({ ok: false, error: `Unhandled QA fetch: ${url}` }, 404);
  };
  runtime.window.eval(app);
  await waitFor(() => runtime.window.document.querySelector('#modelSelect option'), 'App did not boot model selector');
  return { calls, window: runtime.window, document: runtime.window.document };
}

async function createRunningCompletedDom() {
  const runtime = new JSDOM(completedHtml, {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1:8788/completed#task_done_1',
    pretendToBeVisual: true
  });
  const calls = [];
  const tasks = [
    {
      id: 'task_done_1',
      status: 'done',
      title: 'QA 완료 항목 1',
      agent: 'writer',
      result: '첫 번째 완료 결과',
      completedAt: '2026-06-07T06:00:00.000Z'
    },
    {
      id: 'task_done_2',
      status: 'done',
      title: 'QA 완료 항목 2',
      agent: 'ceo',
      result: '두 번째 완료 결과',
      completedAt: '2026-06-07T05:00:00.000Z'
    }
  ];
  runtime.window.confirm = () => true;
  runtime.window.fetch = async (requestPath, options = {}) => {
    const url = String(requestPath);
    const method = String(options.method || 'GET').toUpperCase();
    calls.push(`${method} ${url}`);
    if (url === '/api/status') {
      return mockResponse({
        ok: true,
        agents: [
          { id: 'writer', name: 'Jenny', role: 'Copywriter', avatar: '', accent: '#fbbf24' },
          { id: 'ceo', name: 'Anna', role: 'CEO', avatar: '', accent: '#f8fafc' }
        ]
      });
    }
    if (url === '/api/tasks' && method === 'GET') {
      return mockResponse({ ok: true, tasks });
    }
    if (url === '/api/tasks/task_done_1' && method === 'DELETE') {
      const index = tasks.findIndex((task) => task.id === 'task_done_1');
      if (index >= 0) tasks.splice(index, 1);
      return mockResponse({ ok: true });
    }
    if (url === '/api/tasks/task_done_2' && method === 'DELETE') {
      const index = tasks.findIndex((task) => task.id === 'task_done_2');
      if (index >= 0) tasks.splice(index, 1);
      return mockResponse({ ok: true });
    }
    return mockResponse({ ok: false, error: `Unhandled completed QA fetch: ${method} ${url}` }, 404);
  };
  runtime.window.eval(completedApp);
  runtime.window.document.dispatchEvent(new runtime.window.Event('DOMContentLoaded'));
  await waitFor(() => runtime.window.document.querySelectorAll('.completed-item').length === 2, 'Completed list did not render');
  return { calls, window: runtime.window, document: runtime.window.document };
}

async function main() {
  await check('core UI anchors exist', () => {
    [
      'apiPanel',
      'apiProviderList',
      'modelSelect',
      'brainSearchForm',
      'brainQuery',
      'autoResearchButton',
      'xResearchButton',
      'threadsResearchButton',
      'youtubeResearchButton',
      'brainResults',
      'taskForm',
      'approvalForm',
      'resultPanelBody'
    ].forEach((id) => assert(byId(id), `missing #${id}`));
  });

  await check('api panel starts hidden and accessible', () => {
    const panel = byId('apiPanel');
    assert(panel.classList.contains('hidden'), 'API panel should start hidden');
    assert(panel.getAttribute('aria-hidden') === 'true', 'API panel should start aria-hidden');
    assert(document.querySelector('#apiPanel section[role="dialog"]'), 'API panel dialog role is missing');
  });

  await check('default layout shows left and center with result panel collapsed', async () => {
    assert(!document.body.classList.contains('sidebar-collapsed'), 'Sidebar should be open in static default layout');
    assert(document.body.classList.contains('result-collapsed'), 'Result panel should be collapsed in static default layout');
    assert(byId('resultPanelToggle').getAttribute('aria-expanded') === 'false', 'Result panel toggle should start collapsed');
    const runtime = await createRunningAppDom();
    assert(!runtime.document.body.classList.contains('sidebar-collapsed'), 'Sidebar should be open after app boot');
    assert(runtime.document.body.classList.contains('result-collapsed'), 'Result panel should be collapsed after app boot');
    const toggle = runtime.document.getElementById('resultPanelToggle');
    toggle.click();
    assert(!runtime.document.body.classList.contains('result-collapsed'), 'Result panel toggle should open the panel');
    assert(toggle.getAttribute('aria-expanded') === 'true', 'Result panel toggle should report expanded after open');
    toggle.click();
    assert(runtime.document.body.classList.contains('result-collapsed'), 'Result panel toggle should close the panel');
    assert(toggle.getAttribute('aria-expanded') === 'false', 'Result panel toggle should report collapsed after close');
  });

  await check('task agent selection survives dashboard refresh', async () => {
    const runtime = await createRunningAppDom();
    const select = runtime.document.querySelector('#taskAgent');
    select.value = 'writer';
    select.dispatchEvent(new runtime.window.Event('change', { bubbles: true }));
    runtime.document.querySelector('#refreshDashboard').click();
    await waitFor(
      () => runtime.calls.filter((url) => url === '/api/dashboard').length >= 2,
      'Dashboard refresh was not triggered'
    );
    assert(select.value === 'writer', `Task agent should remain writer, got ${select.value}`);
  });

  await check('task creation auto-runs and review-stage tasks are recovered', () => {
    assert(app.includes('autoRun: true'), 'Task form should request automatic execution');
    assert(webServer.includes('const taskRunQueue = new Map()'), 'Task run queue is missing');
    assert(webServer.includes('function scheduleAutoRunnableTasks'), 'Auto-run recovery scheduler is missing');
    assert(webServer.includes('taskProgress(task).percent >= 92'), '92% review-stage tasks are not recovered');
    assert(webServer.includes("task.status = 'failed'"), 'Failed task terminal state is missing');
    assert(webServer.includes("task.status = 'done'"), 'Done task terminal state is missing');
  });

  await check('chat starts without boot announcement', async () => {
    const runtime = await createRunningAppDom();
    const text = runtime.document.querySelector('#chatLog').textContent || '';
    assert(!text.includes('웹사이트 모드로 운영실을 시작했습니다.'), 'Boot announcement is still rendered in chat');
    assert(!text.includes('Connect AI Web'), 'Boot sender is still rendered in chat');
  });

  await check('chat links URLs and blocks IME enter submit', async () => {
    const runtime = await createRunningAppDom();
    const input = runtime.document.querySelector('#messageInput');
    const form = runtime.document.querySelector('#chatForm');

    input.value = '한글 조합 중';
    input.dispatchEvent(new runtime.window.Event('compositionstart', { bubbles: true }));
    input.dispatchEvent(new runtime.window.KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Enter',
      keyCode: 229,
      isComposing: true
    }));
    assert(!runtime.calls.includes('/api/chat'), 'IME Enter should not submit chat');

    input.dispatchEvent(new runtime.window.Event('compositionend', { bubbles: true }));
    form.dispatchEvent(new runtime.window.Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(
      () => runtime.document.querySelector('#chatLog .message.assistant a.message-link'),
      'Chat answer did not render linked URLs'
    );

    const links = [...runtime.document.querySelectorAll('#chatLog .message.assistant a.message-link')];
    assert(links.length === 4, `Expected 4 linked URLs, found ${links.length}`);
    links.forEach((link) => {
      assert(link.getAttribute('target') === '_blank', 'Chat URL should open in a new tab');
      assert(link.getAttribute('rel') === 'noreferrer', 'Chat URL rel should be safe');
      assert(!link.getAttribute('href').includes('arcpublishing.com'), 'Chat URL kept inaccessible Reuters CDN href');
    });
    assert(links[1].getAttribute('href') === 'https://www.reuters.com/technology/eu-ai-act-enforcement-begins-2025-04-17/', 'Malformed Reuters URL was not normalized in chat links');
    assert(links[3].getAttribute('href') === 'https://example.com/connect-ai/source-two', 'Trailing punctuation should not be part of URL href');
    assert(runtime.calls.filter((url) => url === '/api/chat').length === 1, 'Chat should submit exactly once');
  });

  await check('second brain research controls are wired', () => {
    const form = byId('brainSearchForm');
    assert(form.querySelector('#brainQuery'), 'Brain query input is missing from form');
    assert(form.querySelector('#autoResearchButton'), 'Research button is missing from form');
    assert(form.querySelector('#xResearchButton'), 'X Search button is missing from form');
    assert(form.querySelector('#threadsResearchButton'), 'Threads button is missing from form');
    assert(form.querySelector('#youtubeResearchButton'), 'YouTube button is missing from form');
    assert(app.includes("api(`/api/research?q=${encodeURIComponent(query)}${sourceParam}`)"), 'autoResearch does not call /api/research');
    assert(app.includes("const sourceParam = isXSearch ? '&source=x' : isThreadsSearch ? '&source=threads' : isYouTubeSearch ? '&source=youtube' : '';"), 'Research source parameter routing is missing');
    assert(app.includes("isThreadsSearch ? '&source=threads'"), 'Threads source parameter is missing');
    assert(app.includes("isYouTubeSearch ? '&source=youtube'"), 'YouTube source parameter is missing');
    assert(app.includes("isThreadsSearch ? 'Threads Searching'"), 'Threads loading state is missing');
    assert(app.includes("isYouTubeSearch ? 'YouTube Searching'"), 'YouTube loading state is missing');
    assert(app.includes("isThreadsSearch ? 'Threads'"), 'Threads restore state is missing');
    assert(app.includes("isYouTubeSearch ? 'YouTube'"), 'YouTube restore state is missing');
  });

  await check('research renderer includes source-safe cards', () => {
    assert(app.includes('function renderResearch(report)'), 'renderResearch function is missing');
    assert(app.includes('research-summary'), 'Research summary renderer is missing');
    assert(app.includes('research-result'), 'Research result card class is missing');
    assert(app.includes('target="_blank" rel="noreferrer"'), 'Research links should open safely');
    assert(css.includes('.research-summary'), 'Research summary styles are missing');
    assert(css.includes('.research-result'), 'Research result styles are missing');
  });

  await check('research button renders API results dynamically', async () => {
    const runtime = await createRunningAppDom();
    runtime.document.querySelector('#brainQuery').value = 'QA_AUTO_RESEARCH_FIXTURE';
    runtime.document.querySelector('#autoResearchButton').click();
    await waitFor(
      () => runtime.document.querySelector('#brainResults .research-result a'),
      'Research result card was not rendered'
    );
    const link = runtime.document.querySelector('#brainResults .research-result a');
    assert(link.textContent.includes('https://example.com/connect-ai/qa-auto-research'), 'Research result URL is not visible');
    assert(link.getAttribute('rel') === 'noreferrer', 'Research result link rel is not safe');
    assert(link.getAttribute('target') === '_blank', 'Research result link target is not _blank');
    assert(runtime.document.querySelector('#brainResults .research-summary').textContent.includes('Research complete'), 'Research summary did not render complete state');
    assert(runtime.calls.some((url) => url.startsWith('/api/research?q=QA_AUTO_RESEARCH_FIXTURE')), 'Research API was not called with the query');
  });

  await check('x search button uses subscription research mode', async () => {
    const runtime = await createRunningAppDom();
    runtime.document.querySelector('#brainQuery').value = 'QA_AUTO_RESEARCH_FIXTURE';
    runtime.document.querySelector('#xResearchButton').click();
    await waitFor(
      () => runtime.document.querySelector('#brainResults .research-result a'),
      'X Search result card was not rendered'
    );
    const link = runtime.document.querySelector('#brainResults .research-result a');
    assert(link.getAttribute('href').startsWith('https://x.com/search?'), 'X Search result should point to X');
    assert(runtime.calls.some((url) => url.includes('source=x')), 'X Search API was not called with source=x');
    assert(runtime.document.querySelector('#xResearchButton').textContent === 'X Search', 'X Search button did not recover');
  });

  await check('threads button uses threads research mode', async () => {
    const runtime = await createRunningAppDom();
    runtime.document.querySelector('#brainQuery').value = 'QA_AUTO_RESEARCH_FIXTURE';
    runtime.document.querySelector('#threadsResearchButton').click();
    await waitFor(
      () => runtime.document.querySelector('#brainResults .research-result a'),
      'Threads result card was not rendered'
    );
    const link = runtime.document.querySelector('#brainResults .research-result a');
    assert(link.getAttribute('href').startsWith('https://www.threads.net/search?'), 'Threads result should point to Threads');
    assert(runtime.calls.some((url) => url.includes('source=threads')), 'Threads API was not called with source=threads');
    assert(runtime.document.querySelector('#threadsResearchButton').textContent === 'Threads', 'Threads button did not recover');
  });

  await check('youtube button uses youtube research mode', async () => {
    const runtime = await createRunningAppDom();
    runtime.document.querySelector('#brainQuery').value = 'QA_AUTO_RESEARCH_FIXTURE';
    runtime.document.querySelector('#youtubeResearchButton').click();
    await waitFor(
      () => runtime.document.querySelector('#brainResults .research-result a'),
      'YouTube result card was not rendered'
    );
    const link = runtime.document.querySelector('#brainResults .research-result a');
    assert(link.getAttribute('href').startsWith('https://www.youtube.com/watch?'), 'YouTube result should point to YouTube');
    assert(runtime.calls.some((url) => url.includes('source=youtube')), 'YouTube API was not called with source=youtube');
    assert(runtime.document.querySelector('#youtubeResearchButton').textContent === 'YouTube', 'YouTube button did not recover');
  });

  await check('research button renders empty and error states', async () => {
    const emptyRuntime = await createRunningAppDom();
    emptyRuntime.document.querySelector('#brainQuery').value = 'QA_AUTO_RESEARCH_EMPTY';
    emptyRuntime.document.querySelector('#autoResearchButton').click();
    await waitFor(
      () => emptyRuntime.document.querySelector('#brainResults .research-summary.empty'),
      'Research empty summary was not rendered'
    );
    const emptyText = emptyRuntime.document.querySelector('#brainResults').textContent;
    assert(emptyText.includes('Research empty'), 'Empty research summary label is missing');
    assert(emptyText.includes('리서치 결과가 없습니다.'), 'Empty research message is missing');
    assert(!emptyText.includes('리서치 실패'), 'Empty research should not be labeled as a failure');

    const errorRuntime = await createRunningAppDom();
    errorRuntime.document.querySelector('#brainQuery').value = 'QA_AUTO_RESEARCH_ERROR';
    errorRuntime.document.querySelector('#autoResearchButton').click();
    await waitFor(
      () => errorRuntime.document.querySelector('#brainResults .research-summary.error'),
      'Research error summary was not rendered'
    );
    const errorText = errorRuntime.document.querySelector('#brainResults').textContent;
    assert(errorText.includes('Research issue'), 'Error research summary label is missing');
    assert(errorText.includes('리서치 실패 · QA mock research upstream error'), 'Error research message is missing');

    const httpErrorRuntime = await createRunningAppDom();
    httpErrorRuntime.document.querySelector('#brainQuery').value = 'QA_AUTO_RESEARCH_HTTP_ERROR';
    httpErrorRuntime.document.querySelector('#autoResearchButton').click();
    await waitFor(
      () => httpErrorRuntime.document.querySelector('#brainResults .research-summary.error'),
      'Research HTTP error summary was not rendered'
    );
    const httpErrorText = httpErrorRuntime.document.querySelector('#brainResults').textContent;
    assert(httpErrorText.includes('Research issue'), 'HTTP error research summary label is missing');
    assert(httpErrorText.includes('리서치 실패 · QA HTTP research outage'), 'HTTP error research message is missing');
    assert(httpErrorRuntime.document.querySelector('#autoResearchButton').textContent === 'Research', 'Research button did not recover after HTTP error');
  });

  await check('api provider panel renders only supported provider cards', async () => {
    const runtime = await createRunningAppDom();
    await waitFor(
      () => runtime.document.querySelectorAll('#apiProviderList .api-provider').length >= 3,
      'API provider cards were not rendered'
    );
    const providerList = runtime.document.querySelector('#apiProviderList');
    const text = providerList.textContent.replace(/\s+/g, ' ').trim();
    const headings = [...providerList.querySelectorAll('.api-provider-head strong')].map((node) => node.textContent.trim());
    assert(headings.join(' > ') === 'OpenAI GPT-5.6 > Grok 4.3 > GLM 5.1', `Unexpected provider order: ${headings.join(' > ')}`);
    assert(providerList.querySelector('.grok-proxy-provider'), 'Grok proxy provider card is missing');
    assert(text.includes('구독 계정 · CLIProxyAPI'), 'Grok proxy subscription status is missing');
    assert(!text.includes('Kimi 2.6'), 'Hidden Kimi provider rendered dynamically');
    assert(!text.includes('Grok 4.3 API Key'), 'Direct xAI API key provider rendered dynamically');
    assert(!providerList.querySelector('#apiKey-moonshot'), 'Hidden Kimi API key input rendered');
    assert(!providerList.querySelector('#apiKey-xai'), 'Hidden xAI API key input rendered');
    assert(runtime.calls.includes('/api/llm/providers'), 'Provider API was not called during boot');
  });

  await check('model selector hides hidden direct and non-chat models', async () => {
    const runtime = await createRunningAppDom();
    const values = [...runtime.document.querySelectorAll('#modelSelect option')].map((option) => option.value);
    const labels = [...runtime.document.querySelectorAll('#modelSelect option')].map((option) => option.textContent);
    assert(values.includes('local:grok-4.3'), 'Visible local chat model is missing');
    assert(values.includes('zai:glm-5.1'), 'Visible GLM model is missing');
    assert(!values.includes('moonshot:kimi-k2.6'), 'Hidden Kimi model rendered in selector');
    assert(!values.includes('xai:grok-4.3'), 'Hidden direct xAI model rendered in selector');
    assert(!values.includes('local:grok-imagine-image'), 'Non-chat local image model rendered in selector');
    assert(!labels.join(' ').includes('Kimi 2.6'), 'Hidden Kimi label rendered in selector');
  });

  await check('completed page supports checkbox bulk delete', async () => {
    assert(completedHtml.includes('completedList'), 'Completed list anchor is missing');
    assert(completedHtml.includes('completedSelectAll'), 'Completed select-all checkbox is missing');
    assert(completedHtml.includes('deleteSelectedCompleted'), 'Completed bulk delete button is missing');
    assert(!completedHtml.includes('refreshCompleted'), 'Completed refresh button should be replaced by delete');
    assert(completedApp.includes('data-toggle-task'), 'Completed item checkbox renderer is missing');
    assert(completedApp.includes("method: 'DELETE'"), 'Completed delete flow does not call DELETE');
    assert(css.includes('.completed-check'), 'Completed checkbox styles are missing');
    const runtime = await createRunningCompletedDom();
    const items = runtime.document.querySelectorAll('.completed-item');
    const itemChecks = runtime.document.querySelectorAll('[data-toggle-task]');
    const selectAll = runtime.document.querySelector('#completedSelectAll');
    const deleteButton = runtime.document.querySelector('#deleteSelectedCompleted');
    assert(itemChecks.length === items.length, 'Not every completed item has a checkbox');
    assert(deleteButton.textContent.trim() === '삭제', 'Top action button is not Delete');
    assert(deleteButton.disabled, 'Bulk delete should start disabled');
    itemChecks[0].click();
    assert(!deleteButton.disabled, 'Bulk delete did not enable after selecting one item');
    assert(selectAll.indeterminate, 'Select-all should be indeterminate after selecting one item');
    deleteButton.click();
    await waitFor(() => runtime.document.querySelectorAll('.completed-item').length === 1, 'Completed item was not removed after delete');
    assert(runtime.calls.includes('DELETE /api/tasks/task_done_1'), 'Completed delete API was not called');
    assert(!runtime.document.body.textContent.includes('QA 완료 항목 1'), 'Deleted completed item is still visible');
    assert(runtime.document.body.textContent.includes('QA 완료 항목 2'), 'Next completed item is not visible after delete');
    selectAll.click();
    assert(selectAll.checked, 'Select-all did not check the remaining item');
    assert(!deleteButton.disabled, 'Bulk delete did not enable after select-all');
    deleteButton.click();
    await waitFor(() => runtime.document.querySelectorAll('.completed-item').length === 0, 'All selected completed items were not removed');
    assert(runtime.calls.includes('DELETE /api/tasks/task_done_2'), 'Select-all delete API was not called');
  });

  await check('removed direct provider cards are not static HTML', () => {
    const bodyText = document.body.textContent || '';
    assert(!bodyText.includes('Kimi 2.6'), 'Kimi direct provider text is present in static HTML');
    assert(!bodyText.includes('Grok 4.3 API Key'), 'Direct xAI API key provider text is present in static HTML');
  });

  await check('web scripts are cache-busted', () => {
    const script = document.querySelector('script[src^="/app.js"]');
    assert(script, 'web/app.js script tag is missing');
    assert(script.getAttribute('src').includes('?v='), 'web/app.js script is not cache-busted');
    const completedDocument = (new JSDOM(completedHtml)).window.document;
    const completedScript = completedDocument.querySelector('script[src^="/completed.js"]');
    assert(completedScript, 'web/completed.js script tag is missing');
    assert(completedScript.getAttribute('src').includes('?v='), 'web/completed.js script is not cache-busted');
  });

  const failed = checks.filter((item) => !item.ok);
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
