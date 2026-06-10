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
const webServerRuntime = require(path.join(ROOT, 'scripts', 'web-server.js'));
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

function agentManagementFixture(agentId, name) {
  return {
    tabs: [
      { id: 'dashboard', label: '대시보드' },
      { id: 'instructions', label: '지침' },
      { id: 'skills', label: '스킬' },
      { id: 'settings', label: '설정' },
      { id: 'runs', label: '실행기록' },
      { id: 'budget', label: '예산' }
    ],
    source: {
      repository: 'paperclipai/paperclip',
      url: 'https://github.com/paperclipai/paperclip.git',
      docs: ['docs/api/agents.md', 'docs/specs/agent-config-ui.md', 'docs/api/costs.md']
    },
    overview: {
      status: 'running',
      adapterType: 'codex_local',
      model: 'local:grok-4.3',
      modelProfile: 'qa',
      heartbeatIntervalSec: 300,
      lastHeartbeatAt: '2026-06-07T00:00:00.000Z',
      sessionId: `ses_${agentId}`,
      openTasks: 1,
      approvalsPending: 0
    },
    org: {
      reportsTo: agentId === 'ceo' ? null : { id: 'ceo', name: 'Anna', role: 'CEO' },
      directReports: agentId === 'ceo' ? [{ id: 'writer', name: 'Jenny', role: 'Copywriter' }] : []
    },
    instructions: {
      primary: [`${name} QA instruction`],
      operatingPolicy: '증거 기반 운영 원칙'
    },
    skills: [{ name: 'QA Skill', status: 'enabled', source: 'Paperclip import' }],
    settings: {
      identity: { name, role: 'QA', title: 'QA Agent', capabilities: 'QA management' },
      adapter: { type: 'codex_local', model: 'local:grok-4.3', temperature: 0.2, contextMode: 'brain' },
      heartbeat: { enabled: true, intervalSec: 300, wakeOnAssignment: true, wakeOnDemand: true },
      runtime: { timeoutSec: 45, gracePeriodSec: 15, maxConcurrentRuns: 1 }
    },
    runs: [{
      id: `task_${agentId}_run`,
      title: `${name} QA run`,
      status: 'done',
      invocationSource: 'manual',
      createdAt: '2026-06-07T00:00:00.000Z',
      updatedAt: '2026-06-07T00:01:00.000Z',
      inputTokens: 1000,
      outputTokens: 300,
      costCents: 12,
      summary: 'QA run completed'
    }],
    budget: {
      monthlyCents: 5000,
      spentCents: 1200,
      percent: 24,
      policy: '80% 소프트 알림, 100% 하드 스톱'
    }
  };
}

async function createRunningAppDom(appOptions = {}) {
  const runtime = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'http://127.0.0.1:8788/',
    pretendToBeVisual: true
  });
  const calls = [];
  const configWrites = [];
  const agentPatchWrites = [];
  let configFixture = {
    ollamaBase: 'http://127.0.0.1:8317/v1',
    defaultModel: 'local:grok-4.3',
    localBrainPath: '/Users/qa/connect-ai-brain'
  };
  let dashboardCallCount = 0;
  runtime.window.setInterval = () => 0;
  runtime.window.fetch = async (requestPath, options = {}) => {
    const url = String(requestPath);
    const method = String(options.method || 'GET').toUpperCase();
    calls.push(url);
    if (method !== 'GET') calls.push(`${method} ${url}`);
    if (url === '/api/dashboard') {
      const dashboardFixture = Array.isArray(appOptions.dashboards)
        ? appOptions.dashboards[Math.min(dashboardCallCount, appOptions.dashboards.length - 1)]
        : appOptions.dashboard;
      dashboardCallCount += 1;
      return mockResponse(dashboardFixture || {
        ok: true,
        version: 'qa',
        config: { ...configFixture },
        brain: { fileCount: 1, capped: false },
        agents: [
          { id: 'ceo', name: 'Anna', role: 'CEO', avatar: '', active: true, openTasks: 0, management: agentManagementFixture('ceo', 'Anna') },
          { id: 'writer', name: 'Jenny', role: 'Copywriter', avatar: '', active: true, openTasks: 0, goal: '', management: agentManagementFixture('writer', 'Jenny') }
        ],
        tasks: { open: 0, all: [] },
        approvals: { pending: 0, all: [] },
        events: []
      });
    }
    if (url.startsWith('/api/agents/') && method === 'PATCH') {
      agentPatchWrites.push({
        id: url.split('/').pop(),
        body: JSON.parse(options.body || '{}')
      });
      return mockResponse({ ok: true, agent: { id: url.split('/').pop(), active: true } });
    }
    if (url === '/api/config' && method === 'POST') {
      const payload = JSON.parse(options.body || '{}');
      configWrites.push(payload);
      configFixture = {
        ...configFixture,
        ...payload
      };
      return mockResponse({ ok: true, config: { ...configFixture } });
    }
    if (url === '/api/llm/test' && method === 'POST') {
      const payload = JSON.parse(options.body || '{}');
      return mockResponse({
        ok: true,
        connected: true,
        provider: 'QA LLM',
        model: payload.model || configFixture.defaultModel,
        upstreamModel: payload.model || configFixture.defaultModel,
        latencyMs: 12,
        stages: [{ name: 'chat', ok: true }]
      });
    }
    if (url === '/api/models') {
      return mockResponse({
        ok: true,
        defaultModel: configFixture.defaultModel || 'local:grok-4.3',
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
      if (url.includes('source=instagram')) {
        return mockResponse({
          ok: true,
          query: 'QA_AUTO_RESEARCH_FIXTURE',
          mode: 'instagram-web-search-mock',
          status: 'ok',
          searchedAt: '2026-06-07T00:00:00.000Z',
          count: 1,
          sources: ['https://www.instagram.com/blackpinkofficial/'],
          results: [{
            title: 'Instagram Fixture',
            url: 'https://www.instagram.com/blackpinkofficial/',
            snippet: 'Instagram web search fixture.'
          }]
        });
      }
      if (url.includes('source=linkedin')) {
        return mockResponse({
          ok: true,
          query: 'QA_AUTO_RESEARCH_FIXTURE',
          mode: 'linkedin-web-search-mock',
          status: 'ok',
          searchedAt: '2026-06-07T00:00:00.000Z',
          count: 1,
          sources: ['https://www.linkedin.com/company/connect-ai-qa/'],
          results: [{
            title: 'LinkedIn Fixture',
            url: 'https://www.linkedin.com/company/connect-ai-qa/',
            snippet: 'LinkedIn web search fixture.'
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
  return { calls, configWrites, agentPatchWrites, window: runtime.window, document: runtime.window.document };
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
      sources: [
        'https://example.com/connect-ai/source-one',
        'https://example.com/connect-ai/source-two.',
        'not-a-url'
      ],
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
      'brandHome',
      'modelSelect',
      'brainSearchForm',
      'brainQuery',
      'autoResearchButton',
      'xResearchButton',
      'threadsResearchButton',
      'instagramResearchButton',
      'linkedinResearchButton',
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

  await check('api settings save posts config and reports success', async () => {
    const runtime = await createRunningAppDom();
    runtime.document.querySelector('#apiPanelToggle').click();
    await waitFor(
      () => !runtime.document.querySelector('#apiPanel').classList.contains('hidden'),
      'API panel did not open'
    );
    runtime.document.querySelector('#ollamaBase').value = 'http://127.0.0.1:8317/v1';
    runtime.document.querySelector('#modelSelect').value = 'zai:glm-5.1';
    runtime.document.querySelector('#brainPath').value = '/Users/qa/brain-saved';
    runtime.document.querySelector('#saveConfig').click();
    await waitFor(
      () => runtime.calls.includes('POST /api/config'),
      'Config save API was not called'
    );
    await waitFor(
      () => runtime.document.querySelector('#apiPanelResult').textContent.includes('저장 완료'),
      'Config save success was not shown in the API panel'
    );
    assert(runtime.configWrites.length === 1, 'Config save payload was not captured');
    assert(runtime.configWrites[0].ollamaBase === 'http://127.0.0.1:8317/v1', 'Saved LLM URL payload is wrong');
    assert(runtime.configWrites[0].defaultModel === 'zai:glm-5.1', 'Saved model payload is wrong');
    assert(runtime.configWrites[0].localBrainPath === '/Users/qa/brain-saved', 'Saved brain path payload is wrong');
    assert(runtime.document.querySelector('#modelSelect').value === 'zai:glm-5.1', 'Saved model did not stay selected');
    assert(runtime.document.querySelector('#saveConfig').textContent === 'Save', 'Save button label did not recover');
    assert(!runtime.document.querySelector('#saveConfig').disabled, 'Save button stayed disabled');
  });

  await check('refresh applies the last successful LLM Test model', async () => {
    const runtime = await createRunningAppDom();
    runtime.document.querySelector('#apiPanelToggle').click();
    await waitFor(
      () => !runtime.document.querySelector('#apiPanel').classList.contains('hidden'),
      'API panel did not open for model refresh'
    );
    runtime.document.querySelector('#modelSelect').value = 'zai:glm-5.1';
    runtime.document.querySelector('#testLlm').click();
    await waitFor(
      () => runtime.document.querySelector('#llmTestResult').textContent.includes('연결 성공'),
      'LLM Test success was not shown'
    );
    await waitFor(
      () => runtime.calls.filter((url) => url === '/api/dashboard').length >= 2,
      'Dashboard was not refreshed after LLM Test'
    );
    assert(runtime.document.querySelector('#modelSelect').value === 'local:grok-4.3', 'Dashboard refresh fixture should restore the old saved model before Refresh');
    runtime.document.querySelector('#refreshModels').click();
    await waitFor(
      () => runtime.document.querySelector('#apiPanelResult').textContent.includes('LLM Test 성공 모델을 반영했습니다.'),
      'Refresh did not report successful model application'
    );
    assert(runtime.configWrites.some((payload) => payload.defaultModel === 'zai:glm-5.1'), 'Refresh did not persist the successful LLM Test model');
    assert(runtime.document.querySelector('#modelSelect').value === 'zai:glm-5.1', 'Refresh did not keep the successful model selected');
    assert(runtime.document.querySelector('#refreshModels').textContent === 'Refresh', 'Refresh button label did not recover');
    assert(!runtime.document.querySelector('#refreshModels').disabled, 'Refresh button stayed disabled');
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

  await check('team carousel agent click stays on dashboard', async () => {
    const runtime = await createRunningAppDom();
    const writerCard = [...runtime.document.querySelectorAll('#teamGrid .team-card')]
      .find((button) => button.textContent.includes('Jenny'));
    assert(writerCard, 'Jenny team card is missing');
    writerCard.click();
    await waitFor(
      () => runtime.document.querySelector('#selectedAgentName').textContent === 'Jenny',
      'Team card did not update the selected dashboard agent'
    );
    assert(runtime.window.location.hash === '', 'Team card click should not open an agent route');
    assert(!runtime.document.querySelector('#dashboardView').classList.contains('hidden'), 'Dashboard view should stay visible after team card click');
    assert(runtime.document.querySelector('#agentManagerView').classList.contains('hidden'), 'Agent manager should stay hidden after team card click');
  });

  await check('agent sidebar opens Paperclip-style management pages', async () => {
    const runtime = await createRunningAppDom();
    const writerAgent = [...runtime.document.querySelectorAll('#agentList .agent')]
      .find((button) => button.textContent.includes('Jenny'));
    assert(writerAgent, 'Writer agent button is missing');
    writerAgent.click();
    await waitFor(() => runtime.window.location.hash === '#agent/writer/dashboard', 'Agent click did not navigate to management route');
    assert(runtime.document.querySelector('#dashboardView').classList.contains('hidden'), 'Dashboard view should hide on agent management route');
    assert(!runtime.document.querySelector('#agentManagerView').classList.contains('hidden'), 'Agent management view should be visible');
    assert(runtime.document.body.textContent.includes('Agent Management'), 'Agent management header is missing');
    assert(runtime.document.body.textContent.includes('대시보드'), 'Agent dashboard tab is missing');
    assert(runtime.document.body.textContent.includes('지침'), 'Agent instructions tab is missing');
    assert(runtime.document.body.textContent.includes('스킬'), 'Agent skills tab is missing');
    assert(runtime.document.body.textContent.includes('설정'), 'Agent settings tab is missing');
    assert(runtime.document.body.textContent.includes('실행기록'), 'Agent runs tab is missing');
    assert(runtime.document.body.textContent.includes('예산'), 'Agent budget tab is missing');

    runtime.document.querySelector('[data-agent-tab="instructions"]').click();
    await waitFor(() => runtime.window.location.hash === '#agent/writer/instructions', 'Instructions tab did not update route');
    assert(runtime.document.body.textContent.includes('Jenny QA instruction'), 'Agent instructions content did not render');
    assert(runtime.document.body.textContent.includes('paperclipai/paperclip'), 'Paperclip source reference is missing');
    runtime.document.querySelector('#agentInstructionInput').value = '첫 번째 QA 지침\n두 번째 QA 지침';
    runtime.document.querySelector('#agentPolicyInput').value = 'QA 운영 원칙 업데이트';
    runtime.document.querySelector('[data-agent-save="instructions"]').click();
    await waitFor(() => runtime.agentPatchWrites.some((write) => write.body.management && write.body.management.instructions), 'Agent instructions PATCH was not captured');
    const instructionsPatch = runtime.agentPatchWrites.find((write) => write.body.management && write.body.management.instructions);
    assert(instructionsPatch.body.management.instructions.primary.length === 2, 'Agent instructions should save newline-separated primary rules');
    assert(instructionsPatch.body.management.instructions.operatingPolicy === 'QA 운영 원칙 업데이트', 'Agent operating policy payload is wrong');

    runtime.document.querySelector('[data-agent-tab="skills"]').click();
    await waitFor(() => runtime.window.location.hash === '#agent/writer/skills', 'Skills tab did not update route');
    runtime.document.querySelector('[data-agent-skill-add]').click();
    const skillRows = runtime.document.querySelectorAll('#agentSkillsEditor [data-skill-row]');
    const addedSkill = skillRows[skillRows.length - 1];
    addedSkill.querySelector('.manager-skill-name').value = 'QA 신규 스킬';
    addedSkill.querySelector('.manager-skill-source').value = 'QA Source';
    addedSkill.querySelector('.manager-skill-status').value = 'disabled';
    runtime.document.querySelector('[data-agent-save="skills"]').click();
    await waitFor(() => runtime.agentPatchWrites.some((write) => write.body.management && write.body.management.skills), 'Agent skills PATCH was not captured');
    const skillsPatch = runtime.agentPatchWrites.find((write) => write.body.management && write.body.management.skills);
    assert(skillsPatch.body.management.skills.some((skill) => skill.name === 'QA 신규 스킬' && skill.status === 'disabled'), 'Agent skills payload is wrong');

    runtime.document.querySelector('[data-agent-tab="settings"]').click();
    await waitFor(() => runtime.window.location.hash === '#agent/writer/settings', 'Settings tab did not update route');
    runtime.document.querySelector('#agentGoalInput').value = 'QA 관리 목표';
    runtime.document.querySelector('#agentAdapterModel').value = 'local:qa-edit-model';
    runtime.document.querySelector('#agentAdapterTemperature').value = '0.45';
    runtime.document.querySelector('#agentHeartbeatEnabled').checked = false;
    runtime.document.querySelector('[data-agent-save="settings"]').click();
    await waitFor(() => runtime.calls.includes('PATCH /api/agents/writer'), 'Agent settings PATCH was not called');
    await waitFor(() => runtime.agentPatchWrites.some((write) => write.body.management && write.body.management.settings), 'Agent settings PATCH was not captured');
    const settingsPatch = runtime.agentPatchWrites.find((write) => write.body.management && write.body.management.settings);
    assert(settingsPatch.body.goal === 'QA 관리 목표', 'Agent goal payload is wrong');
    assert(settingsPatch.body.management.settings.adapter.model === 'local:qa-edit-model', 'Agent adapter model payload is wrong');
    assert(settingsPatch.body.management.settings.adapter.temperature === 0.45, 'Agent adapter temperature payload is wrong');
    assert(settingsPatch.body.management.settings.heartbeat.enabled === false, 'Agent heartbeat payload is wrong');

    runtime.document.querySelector('[data-agent-tab="budget"]').click();
    await waitFor(() => runtime.window.location.hash === '#agent/writer/budget', 'Budget tab did not update route');
    assert(runtime.document.body.textContent.includes('$12.00 / $50.00'), 'Agent budget summary did not render');
    runtime.document.querySelector('#agentBudgetMonthlyDollars').value = '88.25';
    runtime.document.querySelector('#agentBudgetSoftAlert').value = '70';
    runtime.document.querySelector('#agentBudgetHardStop').value = '95';
    runtime.document.querySelector('#agentBudgetPolicy').value = 'QA budget policy';
    runtime.document.querySelector('[data-agent-save="budget"]').click();
    await waitFor(() => runtime.agentPatchWrites.some((write) => write.body.management && write.body.management.budget), 'Agent budget PATCH was not captured');
    const budgetPatch = runtime.agentPatchWrites.find((write) => write.body.management && write.body.management.budget);
    assert(budgetPatch.body.management.budget.monthlyCents === 8825, 'Agent monthly budget payload is wrong');
    assert(budgetPatch.body.management.budget.softAlertPercent === 70, 'Agent soft alert payload is wrong');
    assert(budgetPatch.body.management.budget.hardStopPercent === 95, 'Agent hard stop payload is wrong');
  });

  await check('brand logo returns from agent page to dashboard home', async () => {
    const runtime = await createRunningAppDom();
    const writerAgent = [...runtime.document.querySelectorAll('#agentList .agent')]
      .find((button) => button.textContent.includes('Jenny'));
    assert(writerAgent, 'Writer agent button is missing for logo home check');
    writerAgent.click();
    await waitFor(() => runtime.window.location.hash === '#agent/writer/dashboard', 'Agent page did not open before logo home check');
    runtime.document.querySelector('#brandHome').click();
    await waitFor(() => runtime.window.location.hash === '', 'Brand logo did not clear the agent route');
    assert(!runtime.document.querySelector('#dashboardView').classList.contains('hidden'), 'Dashboard view should be visible after logo home click');
    assert(runtime.document.querySelector('#agentManagerView').classList.contains('hidden'), 'Agent management view should hide after logo home click');
    assert(runtime.document.querySelector('#companyName').textContent === 'AI Company', 'Company title did not return to home state');
  });

  await check('terminal 100 percent tasks stay listed until manual refresh', async () => {
    const taskId = 'task_qa_done_100';
    const activeTask = {
      id: taskId,
      title: 'QA terminal task should stay listed',
      agent: 'writer',
      priority: 'urgent',
      status: 'running',
      progress: {
        percent: 92,
        label: '검토 중',
        activity: '결과 생성 대기',
        timeline: [
          { key: 'queued', label: '요청 접수', done: true, current: false },
          { key: 'review', label: '결과 정리', done: true, current: true }
        ]
      }
    };
    const terminalTask = {
      id: taskId,
      title: activeTask.title,
      agent: 'writer',
      priority: 'urgent',
      status: 'failed',
      error: 'QA timeout',
      progress: {
        percent: 100,
        label: '오류',
        activity: '작업 실행 중 오류가 발생했습니다.',
        timeline: [
          { key: 'queued', label: '요청 접수', done: true, current: false },
          { key: 'done', label: '오류', done: true, current: true }
        ]
      }
    };
    const dashboardBase = {
      ok: true,
      version: 'qa',
      config: { defaultModel: 'local:grok-4.3' },
      brain: { fileCount: 1, capped: false },
      agents: [
        { id: 'ceo', name: 'Anna', role: 'CEO', avatar: '', active: true, openTasks: 0 },
        { id: 'writer', name: 'Jenny', role: 'Copywriter', avatar: '', active: true, openTasks: 0 }
      ],
      approvals: { pending: 0, all: [] },
      events: []
    };
    const runtime = await createRunningAppDom({
      dashboards: [
        { ...dashboardBase, tasks: { open: 1, all: [activeTask] } },
        { ...dashboardBase, tasks: { open: 0, all: [terminalTask] } },
        { ...dashboardBase, tasks: { open: 0, all: [terminalTask] } }
      ]
    });
    await runtime.window.refreshDashboard();
    const retainedListText = runtime.document.querySelector('#taskList').textContent || '';
    const retainedDetailText = runtime.document.querySelector('#taskDetail').textContent || '';
    assert(retainedListText.includes(activeTask.title), 'Terminal 100% task should remain as a list row after non-manual refresh');
    assert(!retainedDetailText.includes(activeTask.title), 'Terminal 100% task should not remain in progress detail');
    assert(retainedDetailText.includes('작업을 선택하면 진행 상황이 표시됩니다.'), 'Progress detail should show empty prompt for terminal-only queue');

    runtime.document.querySelector('#refreshDashboard').click();
    await waitFor(
      () => (runtime.document.querySelector('#taskList').textContent || '').includes('열린 작업이 없습니다.'),
      'Manual refresh did not clear terminal task fixture'
    );
    const taskListText = runtime.document.querySelector('#taskList').textContent || '';
    const taskDetailText = runtime.document.querySelector('#taskDetail').textContent || '';
    assert(taskListText.includes('열린 작업이 없습니다.'), 'Manual refresh should clear terminal 100% task from work queue');
    assert(taskDetailText.includes('작업을 선택하면 진행 상황이 표시됩니다.'), 'Terminal 100% task should not remain in progress detail');
    assert(!taskListText.includes(activeTask.title), 'Terminal task title still appears in work queue after manual refresh');
    assert(!taskDetailText.includes(activeTask.title), 'Terminal task title still appears in progress detail after manual refresh');
  });

  await check('task creation auto-runs and review-stage tasks are recovered', () => {
    assert(app.includes('autoRun: true'), 'Task form should request automatic execution');
    assert(webServer.includes('const taskRunQueue = new Map()'), 'Task run queue is missing');
    assert(webServer.includes('function scheduleAutoRunnableTasks'), 'Auto-run recovery scheduler is missing');
    assert(webServer.includes('taskProgress(task).percent >= 92'), '92% review-stage tasks are not recovered');
    assert(webServer.includes("task.status = 'failed'"), 'Failed task terminal state is missing');
    assert(webServer.includes("task.status = 'done'"), 'Done task terminal state is missing');
  });

  await check('anntar migration policy is available to standalone web', () => {
    assert(webServer.includes('function seedBundledAnntarBrainSeeds'), 'Anntar seed copier is missing');
    assert(webServer.includes("'brain-seeds', 'anntar'"), 'Anntar seed source path is missing');
    assert(webServer.includes("30_운영', 'anntar'"), 'Anntar seed target path is missing');
    assert(webServer.includes("id: 'instagram'"), 'Standalone Instagram agent is missing');
    assert(webServer.includes('증거 기반 운영 원칙'), 'Standalone task prompt policy is missing');
  });

  await check('instagram tasks are routed through automatic research', () => {
    assert(webServer.includes('function runInstagramResearch'), 'Instagram research runner is missing');
    assert(webServer.includes('if (!source) source = researchSourceFromText(cleanQuery);'), 'Automatic research source detection is missing');
    assert(webServer.includes("source === 'instagram' || source === 'ig'"), 'Instagram source route is missing');
    assert(webServer.includes("String(agent || '').toLowerCase() === 'instagram'"), 'Instagram agent source detection is missing');
    assert(webServer.includes('인스타\\s*그램'), 'Korean Instagram source detection is missing');
    assert(webServer.includes('instagram-web-search'), 'Instagram research mode is missing');
    assert(webServerRuntime.researchSourceFromText('인스타 그램에서 블랙핑크 공식 계정 찾아줘') === 'instagram', 'Spaced Korean Instagram text was not detected');
    assert(webServerRuntime.researchSourceFromAgent('instagram') === 'instagram', 'Instagram agent was not detected as a source');
    assert(webServerRuntime.requestedResearchLimit('인스타그램에서 블랙핑크 공식 계정 찾아서 1주일 행적을 요약해줘', 4) === 4, 'One-week duration should not reduce research limit to 1');
    assert(webServerRuntime.requestedResearchLimit('유튜브 AI 뉴스 10가지 찾아줘', 4) === 10, 'Explicit result count should still set research limit');
  });

  await check('linkedin research source is routed through automatic research', () => {
    assert(webServer.includes('function runLinkedInResearch'), 'LinkedIn research runner is missing');
    assert(webServer.includes("source === 'linkedin' || source === 'li'"), 'LinkedIn source route is missing');
    assert(webServer.includes('linkedin-web-search'), 'LinkedIn research mode is missing');
    assert(webServer.includes('링크드\\s*인'), 'Korean LinkedIn source detection is missing');
    assert(webServerRuntime.researchSourceFromText('링크드인에서 Connect AI 회사 계정 찾아줘') === 'linkedin', 'Korean LinkedIn text was not detected');
    assert(webServerRuntime.researchSourceFromText('linkedin에서 AI founder 찾아줘') === 'linkedin', 'English LinkedIn text was not detected');
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
    assert(form.querySelector('#instagramResearchButton'), 'Instagram button is missing from form');
    assert(form.querySelector('#linkedinResearchButton'), 'LinkedIn button is missing from form');
    assert(form.querySelector('#youtubeResearchButton'), 'YouTube button is missing from form');
    assert(app.includes("api(`/api/research?q=${encodeURIComponent(query)}${sourceParam}`)"), 'autoResearch does not call /api/research');
    assert(app.includes("instagram: { button: 'instagramResearchButton', param: '&source=instagram'"), 'Instagram source parameter is missing');
    assert(app.includes("linkedin: { button: 'linkedinResearchButton', param: '&source=linkedin'"), 'LinkedIn source parameter is missing');
    assert(app.includes("threads: { button: 'threadsResearchButton', param: '&source=threads'"), 'Threads source parameter is missing');
    assert(app.includes("youtube: { button: 'youtubeResearchButton', param: '&source=youtube'"), 'YouTube source parameter is missing');
    assert(app.includes('Instagram Searching'), 'Instagram loading state is missing');
    assert(app.includes('LinkedIn Searching'), 'LinkedIn loading state is missing');
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

  await check('instagram button uses instagram research mode', async () => {
    const runtime = await createRunningAppDom();
    runtime.document.querySelector('#brainQuery').value = 'QA_AUTO_RESEARCH_FIXTURE';
    runtime.document.querySelector('#instagramResearchButton').click();
    await waitFor(
      () => runtime.document.querySelector('#brainResults .research-result a'),
      'Instagram result card was not rendered'
    );
    const link = runtime.document.querySelector('#brainResults .research-result a');
    assert(link.getAttribute('href').startsWith('https://www.instagram.com/'), 'Instagram result should point to Instagram');
    assert(runtime.calls.some((url) => url.includes('source=instagram')), 'Instagram API was not called with source=instagram');
    assert(runtime.document.querySelector('#instagramResearchButton').textContent === 'Instagram', 'Instagram button did not recover');
  });

  await check('linkedin button uses linkedin research mode', async () => {
    const runtime = await createRunningAppDom();
    runtime.document.querySelector('#brainQuery').value = 'QA_AUTO_RESEARCH_FIXTURE';
    runtime.document.querySelector('#linkedinResearchButton').click();
    await waitFor(
      () => runtime.document.querySelector('#brainResults .research-result a'),
      'LinkedIn result card was not rendered'
    );
    const link = runtime.document.querySelector('#brainResults .research-result a');
    assert(link.getAttribute('href').startsWith('https://www.linkedin.com/'), 'LinkedIn result should point to LinkedIn');
    assert(runtime.calls.some((url) => url.includes('source=linkedin')), 'LinkedIn API was not called with source=linkedin');
    assert(runtime.document.querySelector('#linkedinResearchButton').textContent === 'LinkedIn', 'LinkedIn button did not recover');
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
    const sourceLinks = runtime.document.querySelectorAll('.completed-sources a.completed-source-link');
    assert(sourceLinks.length === 2, `Completed sources should render two URL links, got ${sourceLinks.length}`);
    assert(sourceLinks[0].getAttribute('href') === 'https://example.com/connect-ai/source-one', 'Completed source href is incorrect');
    assert(sourceLinks[1].getAttribute('href') === 'https://example.com/connect-ai/source-two', 'Completed source href kept trailing punctuation');
    assert(sourceLinks[0].getAttribute('target') === '_blank', 'Completed source should open in a new tab');
    assert(sourceLinks[0].getAttribute('rel') === 'noreferrer', 'Completed source rel should be safe');
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
