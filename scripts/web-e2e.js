#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const net = require('net');

const BASE_URL = String(process.env.CONNECT_AI_QA_BASE_URL || 'http://127.0.0.1:8788').replace(/\/+$/, '');
const LIVE_LLM = process.env.CONNECT_AI_QA_LIVE_LLM !== '0';
const LIVE_RESEARCH = process.env.CONNECT_AI_QA_LIVE_RESEARCH !== '0';
const STATE_FILE = path.join(__dirname, '..', 'web', 'data', 'state.json');
const HIDDEN_PROVIDERS = new Set(['moonshot', 'xai']);
const SECRET_KEYS = new Set(['llmApiKey', 'localLlmApiKey', 'apiKey', 'token', 'accessToken', 'clientSecret']);
const QA_RESIDUE_PATTERN = /QA e2e|QA_AUTO_RESEARCH_(FIXTURE|EMPTY|ERROR)|qa-auto-research/;

const checks = [];

function request(pathname, options = {}) {
  const url = new URL(pathname, BASE_URL);
  const body = options.body === undefined ? null : JSON.stringify(options.body);
  const client = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = client.request(url, {
      method: options.method || 'GET',
      timeout: options.timeout || 20000,
      headers: {
        ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
        ...(options.headers || {})
      }
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let data = raw;
        try {
          data = raw ? JSON.parse(raw) : null;
        } catch {
          // Keep raw text for static HTML checks.
        }
        resolve({ status: res.statusCode, data, raw });
      });
    });
    req.on('timeout', () => req.destroy(new Error(`Request timed out: ${url.href}`)));
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertOk(response, label) {
  assert(response.status >= 200 && response.status < 300, `${label} returned HTTP ${response.status}`);
  if (response.data && typeof response.data === 'object' && 'ok' in response.data) {
    assert(response.data.ok !== false, `${label} returned ok=false`);
  }
}

function assertNoSecretKeys(value, path = 'root') {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    assert(!SECRET_KEYS.has(key), `Public response leaked secret field ${nextPath}`);
    assertNoSecretKeys(child, nextPath);
  }
}

function providerIdFromModel(model) {
  const id = String(model && (model.id || model.model || model.value) || model || '');
  return id.includes(':') ? id.split(':')[0] : 'local';
}

function isNonChatModelId(value) {
  return /embed|embedding|image|imagine|video|composer/i.test(String(value || ''));
}

function ipv4FromMappedIpv6(host) {
  if (!host.startsWith('::ffff:')) return '';
  const tail = host.slice('::ffff:'.length);
  if (net.isIP(tail) === 4) return tail;
  const parts = tail.split(':');
  if (parts.length !== 2) return '';
  const high = parseInt(parts[0], 16);
  const low = parseInt(parts[1], 16);
  if (!Number.isFinite(high) || !Number.isFinite(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) return '';
  return `${(high >> 8) & 255}.${high & 255}.${(low >> 8) & 255}.${low & 255}`;
}

function isUnsafeResearchHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const mappedIpv4 = ipv4FromMappedIpv6(host);
  if (mappedIpv4) return isUnsafeResearchHost(mappedIpv4);
  const ipVersion = net.isIP(host);
  if (ipVersion === 4) {
    const parts = host.split('.').map((part) => Number(part));
    return parts[0] === 0
      || parts[0] === 10
      || parts[0] === 127
      || (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127)
      || (parts[0] === 169 && parts[1] === 254)
      || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
      || (parts[0] === 192 && parts[1] === 0 && parts[2] === 0)
      || (parts[0] === 192 && parts[1] === 0 && parts[2] === 2)
      || (parts[0] === 192 && parts[1] === 168)
      || (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19))
      || (parts[0] === 198 && parts[1] === 51 && parts[2] === 100)
      || (parts[0] === 203 && parts[1] === 0 && parts[2] === 113)
      || parts[0] >= 224;
  }
  if (ipVersion === 6) {
    return host === '::'
      || host === '::1'
      || host.startsWith('fc')
      || host.startsWith('fd')
      || host.startsWith('fe80')
      || host.startsWith('ff')
      || host.startsWith('2001:db8');
  }
  return false;
}

function isUnsafeResearchUrl(value) {
  try {
    const url = new URL(value);
    return !['http:', 'https:'].includes(url.protocol) || isUnsafeResearchHost(url.hostname);
  } catch {
    return true;
  }
}

function assertResearchReportContract(data, label) {
  assert(data && data.ok === true, `${label} did not return ok=true`);
  assert(['ok', 'empty', 'error'].includes(data.status), `${label} returned invalid status: ${data.status}`);
  assert(data.query && typeof data.query === 'string', `${label} query metadata is missing`);
  assert(data.searchedAt, `${label} searchedAt metadata is missing`);
  assert(Array.isArray(data.results), `${label} results is not an array`);
  assert(Array.isArray(data.sources), `${label} sources is not an array`);
  assert(data.count === data.results.length, `${label} count does not match results length`);
  for (const item of data.results) {
    assert(item && item.title && item.url, `${label} result is missing title or URL`);
    assert(!isUnsafeResearchUrl(item.url), `${label} returned unsafe URL: ${item.url}`);
  }
  for (const source of data.sources) {
    assert(!isUnsafeResearchUrl(source), `${label} returned unsafe source URL: ${source}`);
  }
  if (data.status === 'ok') {
    assert(data.results.length > 0, `${label} status ok returned no results`);
    assert(data.sources.length > 0, `${label} status ok returned no sources`);
  } else {
    assert(data.count === 0, `${label} ${data.status} status should not report a positive count`);
  }
}

function isOptionalLiveLlmUnavailable(response) {
  const text = `${response && response.status || ''} ${JSON.stringify(response && response.data || {})} ${response && response.raw || ''}`;
  return /auth_unavailable|no auth available|unauthorized|forbidden|payment|required|credits|license|billing/i.test(text);
}

function pruneQaEvents() {
  if (!fs.existsSync(STATE_FILE)) return;
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  if (!Array.isArray(state.events)) return;
  const nextEvents = state.events.filter((event) => !QA_RESIDUE_PATTERN.test(String(event.title || '')));
  if (nextEvents.length === state.events.length) return;
  fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, events: nextEvents }, null, 2));
}

function pruneQaStateRecords() {
  if (!fs.existsSync(STATE_FILE)) return;
  const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  const nextState = { ...state };
  let changed = false;
  for (const key of ['tasks', 'approvals', 'events', 'sessions']) {
    if (!Array.isArray(nextState[key])) continue;
    const nextItems = nextState[key].filter((record) => !recordMatchesQaResidue(record));
    if (nextItems.length !== nextState[key].length) {
      nextState[key] = nextItems;
      changed = true;
    }
  }
  if (changed) fs.writeFileSync(STATE_FILE, JSON.stringify(nextState, null, 2));
}

function assertNoQaStateResidue() {
  if (!fs.existsSync(STATE_FILE)) return;
  const raw = fs.readFileSync(STATE_FILE, 'utf8');
  assert(!QA_RESIDUE_PATTERN.test(raw), 'QA residue is still present in web/data/state.json');
}

function assertNoQaExportResidue(exportInfos, config = null) {
  const dirs = qaExportDirs(exportInfos, config);
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const residue = fs.readdirSync(dir).filter((name) => QA_RESIDUE_PATTERN.test(name));
    assert(residue.length === 0, `QA export residue is still present in ${dir}: ${residue.join(', ')}`);
  }
}

function qaExportDirs(exportInfos, config = null) {
  const dirs = new Set();
  for (const exportInfo of exportInfos.filter(Boolean)) {
    if (exportInfo.exportDir) dirs.add(exportInfo.exportDir);
  }
  if (config && config.obsidianVaultPath) {
    dirs.add(path.join(config.obsidianVaultPath, 'Connect AI', 'Results'));
  }
  return dirs;
}

function recordMatchesQaResidue(record) {
  return QA_RESIDUE_PATTERN.test(JSON.stringify(record || {}));
}

function removeQaExportResidue(exportInfos, config = null) {
  for (const dir of qaExportDirs(exportInfos, config)) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (!QA_RESIDUE_PATTERN.test(name)) continue;
      const file = path.join(dir, name);
      if (fs.existsSync(file) && fs.statSync(file).isFile()) fs.unlinkSync(file);
    }
  }
}

async function deleteIfExists(pathname, label) {
  const response = await request(pathname, { method: 'DELETE' });
  assert(response.status === 200 || response.status === 404, `${label} returned HTTP ${response.status}`);
}

async function cleanupQaRecords() {
  const tasks = await request('/api/tasks');
  if (tasks.status >= 200 && tasks.status < 300 && tasks.data && Array.isArray(tasks.data.tasks)) {
    for (const task of tasks.data.tasks.filter(recordMatchesQaResidue)) {
      if (task.id) await deleteIfExists(`/api/tasks/${encodeURIComponent(task.id)}`, 'DELETE QA task residue');
    }
  }

  const approvals = await request('/api/approvals');
  if (approvals.status >= 200 && approvals.status < 300 && approvals.data && Array.isArray(approvals.data.approvals)) {
    for (const approval of approvals.data.approvals.filter(recordMatchesQaResidue)) {
      if (approval.id) await deleteIfExists(`/api/approvals/${encodeURIComponent(approval.id)}`, 'DELETE QA approval residue');
    }
  }
}

async function cleanupQaResidue(exportInfos = [], config = null) {
  removeQaExportResidue(exportInfos, config);
  await cleanupQaRecords();
  pruneQaStateRecords();
  pruneQaEvents();
}

async function check(name, run) {
  const startedAt = Date.now();
  try {
    await run();
    checks.push({ name, ok: true, latencyMs: Date.now() - startedAt });
  } catch (error) {
    checks.push({ name, ok: false, latencyMs: Date.now() - startedAt, error: error.message || String(error) });
  }
}

async function main() {
  let originalConfig = null;
  let qaTaskId = '';
  let qaResearchTaskId = '';
  let qaApprovalId = '';
  let qaExport = null;
  let qaResearchExport = null;

  await check('web shell loads', async () => {
    const response = await request('/');
    assertOk(response, 'GET /');
    assert(String(response.raw).includes('apiProviderList'), 'API provider panel anchor is missing');
    assert(String(response.raw).includes('modelSelect'), 'Model selector is missing');
    assert(String(response.raw).includes('autoResearchButton'), 'Auto research button is missing');
  });

  await check('public APIs hide local LLM secrets', async () => {
    const response = await request('/api/config');
    assertOk(response, 'GET /api/config');
    originalConfig = response.data.config;
    assert(originalConfig && typeof originalConfig === 'object', 'Config payload is missing');
    assertNoSecretKeys(response.data);

    const status = await request('/api/status');
    assertOk(status, 'GET /api/status');
    assertNoSecretKeys(status.data);

    const dashboard = await request('/api/dashboard');
    assertOk(dashboard, 'GET /api/dashboard');
    assertNoSecretKeys(dashboard.data);
  });

  await check('preflight QA residue can be cleaned up', async () => {
    assert(originalConfig, 'Original config was not loaded');
    await cleanupQaResidue([], originalConfig);
    assertNoQaStateResidue();
    assertNoQaExportResidue([], originalConfig);
  });

  await check('provider list excludes removed direct providers', async () => {
    const response = await request('/api/llm/providers');
    assertOk(response, 'GET /api/llm/providers');
    assertNoSecretKeys(response.data);
    const ids = (response.data.providers || []).map((provider) => provider.id);
    for (const hidden of HIDDEN_PROVIDERS) {
      assert(!ids.includes(hidden), `Hidden provider still listed: ${hidden}`);
    }
    assert(ids.includes('openai'), 'OpenAI provider is missing');
    assert(ids.includes('zai'), 'GLM/Z.AI provider is missing');
  });

  await check('model list excludes hidden and non-chat models', async () => {
    const response = await request('/api/models');
    assertOk(response, 'GET /api/models');
    assertNoSecretKeys(response.data);
    const models = response.data.models || [];
    for (const model of models) {
      const provider = providerIdFromModel(model);
      const id = String(model.id || '');
      assert(!HIDDEN_PROVIDERS.has(provider), `Hidden provider model still listed: ${id}`);
      assert(!isNonChatModelId(id), `Non-chat model still listed: ${id}`);
    }
    assert(!HIDDEN_PROVIDERS.has(providerIdFromModel(response.data.defaultModel)), `Hidden default model still active: ${response.data.defaultModel}`);
  });

  await check('research report URL guard matches private network policy', async () => {
    [
      'http://127.0.0.1:8788/api/status',
      'http://100.64.1.1/private',
      'http://169.254.10.10/private',
      'http://192.0.2.1/private',
      'http://198.18.0.1/private',
      'http://203.0.113.1/private',
      'http://[::1]/private',
      'http://[::ffff:127.0.0.1]/private',
      'file:///etc/passwd'
    ].forEach((url) => assert(isUnsafeResearchUrl(url), `Research URL guard allowed unsafe URL: ${url}`));
    assert(!isUnsafeResearchUrl('https://example.com/connect-ai/qa'), 'Research URL guard rejected a public HTTPS URL');
  });

  await check('auto research endpoint returns grounded sources', async () => {
    const response = await request('/api/research?q=QA_AUTO_RESEARCH_FIXTURE&mock=1&fetch=0');
    assertOk(response, 'GET /api/research');
    assertNoSecretKeys(response.data);
    assertResearchReportContract(response.data, 'Fixture research report');
    const results = response.data.results || [];
    assert(response.data.status === 'ok', `Research endpoint status is not ok: ${response.data.status}`);
    assert(response.data.count === results.length, 'Research count metadata does not match result length');
    assert(response.data.searchedAt, 'Research timestamp is missing');
    assert(results.length >= 2, 'Research endpoint did not return fixture results');
    assert((response.data.sources || []).includes('https://example.com/connect-ai/qa-auto-research'), 'Research sources missing fixture URL');
    assert(results.every((item) => item.title && item.url), 'Research result is missing title or URL');
  });

  await check('live auto research response contract survives upstream variability', async () => {
    if (!LIVE_RESEARCH) return;
    const response = await request('/api/research?q=Connect%20AI%20automatic%20research%20QA&limit=3&fetch=0', {
      timeout: 30000
    });
    assertOk(response, 'GET /api/research live contract');
    assertNoSecretKeys(response.data);
    assertResearchReportContract(response.data, 'Live research report');
  });

  await check('auto research rejects empty query safely', async () => {
    const response = await request('/api/research?q=&fetch=0');
    assert(response.status === 400, `GET /api/research empty query returned HTTP ${response.status}`);
    assert(response.data && response.data.ok === false, 'Empty research query did not return ok=false');
    assert(Array.isArray(response.data.results) && response.data.results.length === 0, 'Empty research query returned results');
    assert(Array.isArray(response.data.sources) && response.data.sources.length === 0, 'Empty research query returned sources');
    assertNoSecretKeys(response.data);
  });

  await check('auto research reports empty and error states', async () => {
    const empty = await request('/api/research?q=QA_AUTO_RESEARCH_EMPTY&mock=empty&fetch=0');
    assertOk(empty, 'GET /api/research empty state');
    assertNoSecretKeys(empty.data);
    assert(empty.data.status === 'empty', `Empty research status is ${empty.data.status}`);
    assert(empty.data.count === 0, 'Empty research count should be 0');
    assert(Array.isArray(empty.data.results) && empty.data.results.length === 0, 'Empty research returned results');
    assert(Array.isArray(empty.data.sources) && empty.data.sources.length === 0, 'Empty research returned sources');
    assert(empty.data.error === '검색 결과가 없습니다.', 'Empty research error message is missing');

    const error = await request('/api/research?q=QA_AUTO_RESEARCH_ERROR&mock=error&fetch=0');
    assertOk(error, 'GET /api/research error state');
    assertNoSecretKeys(error.data);
    assert(error.data.status === 'error', `Error research status is ${error.data.status}`);
    assert(error.data.count === 0, 'Error research count should be 0');
    assert(Array.isArray(error.data.results) && error.data.results.length === 0, 'Error research returned results');
    assert(Array.isArray(error.data.sources) && error.data.sources.length === 0, 'Error research returned sources');
    assert(String(error.data.error || '').includes('QA mock research upstream error'), 'Error research message is missing');
  });

  await check('task lifecycle and export works', async () => {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const title = `QA e2e 결과 저장 ${stamp}`;
    const create = await request('/api/tasks', {
      method: 'POST',
      body: {
        title,
        description: `${title}\n작업/완료/export 자동 검증`,
        agent: 'ceo',
        priority: 'high'
      }
    });
    assert(create.status === 201, `POST /api/tasks returned HTTP ${create.status}`);
    qaTaskId = create.data.task && create.data.task.id;
    assert(qaTaskId, 'Created task id is missing');
    assert(create.data.task.progress && create.data.task.progress.percent > 0, 'Created task progress is missing');

    const done = await request(`/api/tasks/${encodeURIComponent(qaTaskId)}`, {
      method: 'PATCH',
      body: {
        status: 'done',
        result: 'QA e2e export result: 작업 결과 저장 검증 완료'
      }
    });
    assertOk(done, 'PATCH /api/tasks/:id');
    assert(done.data.task.status === 'done', 'Task did not move to done');
    assert(done.data.task.progress && done.data.task.progress.percent === 100, 'Done task progress is not 100%');

    const exported = await request(`/api/tasks/${encodeURIComponent(qaTaskId)}/export`, {
      method: 'POST',
      body: { target: 'all' }
    });
    assertOk(exported, 'POST /api/tasks/:id/export');
    qaExport = exported.data.export || {};
    assert(qaExport.markdownPath && fs.existsSync(qaExport.markdownPath), 'Markdown export file was not written');
    assert(qaExport.pdfPath && fs.existsSync(qaExport.pdfPath), 'PDF export file was not written');
    const markdown = fs.readFileSync(qaExport.markdownPath, 'utf8');
    assert(markdown.includes(title), 'Markdown export is missing task title');
    assert(markdown.includes('QA e2e export result'), 'Markdown export is missing task result');
    const pdfHeader = fs.readFileSync(qaExport.pdfPath).subarray(0, 5).toString('ascii');
    assert(pdfHeader === '%PDF-', 'PDF export does not have a PDF header');

    const tasks = await request('/api/tasks');
    assertOk(tasks, 'GET /api/tasks after export');
    const listed = (tasks.data.tasks || []).find((task) => task.id === qaTaskId);
    assert(listed && listed.status === 'done', 'Done task is missing from task list');
    assert(listed.exports && listed.exports.markdownPath === qaExport.markdownPath, 'Task export metadata was not persisted');
  });

  await check('approval lifecycle works', async () => {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
    const create = await request('/api/approvals', {
      method: 'POST',
      body: {
        title: `QA e2e 승인 ${stamp}`,
        summary: '승인 생성/처리 자동 검증',
        kind: 'qa',
        agent: 'ceo'
      }
    });
    assert(create.status === 201, `POST /api/approvals returned HTTP ${create.status}`);
    qaApprovalId = create.data.approval && create.data.approval.id;
    assert(qaApprovalId, 'Created approval id is missing');

    const approved = await request(`/api/approvals/${encodeURIComponent(qaApprovalId)}`, {
      method: 'PATCH',
      body: { status: 'approved' }
    });
    assertOk(approved, 'PATCH /api/approvals/:id');
    assert(approved.data.approval.status === 'approved', 'Approval did not move to approved');

    const approvals = await request('/api/approvals');
    assertOk(approvals, 'GET /api/approvals');
    const listed = (approvals.data.approvals || []).find((approval) => approval.id === qaApprovalId);
    assert(listed && listed.status === 'approved', 'Approved item is missing from approval list');
  });

  await check('research task persists auto research sources', async () => {
    assert(originalConfig, 'Original config was not loaded');
    const forcedConfig = {
      ...originalConfig,
      ollamaBase: 'http://127.0.0.1:9',
      defaultModel: 'local:grok-4.3',
      chatTimeoutMs: 1000
    };
    const configResponse = await request('/api/config', {
      method: 'POST',
      body: forcedConfig
    });
    assertOk(configResponse, 'POST /api/config forced research fallback');
    try {
      const create = await request('/api/tasks', {
        method: 'POST',
        body: {
          title: 'QA_AUTO_RESEARCH_FIXTURE 리서치',
          description: '자동 리서치 출처 저장 e2e',
          agent: 'researcher',
          priority: 'normal'
        }
      });
      assert(create.status === 201, `POST /api/tasks research returned HTTP ${create.status}`);
      qaResearchTaskId = create.data.task && create.data.task.id;
      assert(qaResearchTaskId, 'Created research task id is missing');

      const run = await request(`/api/tasks/${encodeURIComponent(qaResearchTaskId)}/run`, {
        method: 'POST',
        timeout: 30000,
        body: {}
      });
      assertOk(run, 'POST /api/tasks/:id/run research');
      assert(run.data.task && run.data.task.status === 'done', 'Research task did not complete');
      assert((run.data.task.sources || []).includes('https://example.com/connect-ai/qa-auto-research'), 'Research task did not persist auto research source');
      assert(String(run.data.task.result || '').includes('자동 리서치 결과를 저장했습니다.'), 'Research fallback result was not saved');
      assert(!isOptionalLiveLlmUnavailable(run), 'Research task returned an external auth failure instead of saving fallback research');

      const exported = await request(`/api/tasks/${encodeURIComponent(qaResearchTaskId)}/export`, {
        method: 'POST',
        body: { target: 'all' }
      });
      assertOk(exported, 'POST /api/tasks/:id/export research');
      qaResearchExport = exported.data.export || {};
      assert(qaResearchExport.markdownPath && fs.existsSync(qaResearchExport.markdownPath), 'Research markdown export file was not written');
      assert(qaResearchExport.pdfPath && fs.existsSync(qaResearchExport.pdfPath), 'Research PDF export file was not written');
      const markdown = fs.readFileSync(qaResearchExport.markdownPath, 'utf8');
      assert(markdown.includes('## Sources'), 'Research markdown export is missing Sources section');
      assert(markdown.includes('https://example.com/connect-ai/qa-auto-research'), 'Research markdown export is missing source URL');
      assert(markdown.includes('자동 리서치 결과를 저장했습니다.'), 'Research markdown export is missing fallback result');
      const pdfHeader = fs.readFileSync(qaResearchExport.pdfPath).subarray(0, 5).toString('ascii');
      assert(pdfHeader === '%PDF-', 'Research PDF export does not have a PDF header');
    } finally {
      const restored = await request('/api/config', {
        method: 'POST',
        body: originalConfig
      });
      assertOk(restored, 'POST /api/config restore after research fallback');
    }
  });

  await check('stale hidden default model is normalized', async () => {
    assert(originalConfig, 'Original config was not loaded');
    const response = await request('/api/config', {
      method: 'POST',
      body: {
        ...originalConfig,
        defaultModel: 'moonshot:kimi-k2.6'
      }
    });
    assertOk(response, 'POST /api/config stale default');
    const nextModel = response.data.config && response.data.config.defaultModel;
    assert(nextModel !== 'moonshot:kimi-k2.6', 'Stale Kimi default model was preserved');
    assert(!HIDDEN_PROVIDERS.has(providerIdFromModel(nextModel)), `Stale hidden default normalized to another hidden provider: ${nextModel}`);
  });

  await check('restore original public config', async () => {
    if (!originalConfig) return;
    const response = await request('/api/config', {
      method: 'POST',
      body: originalConfig
    });
    assertOk(response, 'POST /api/config restore');
  });

  await check('grok proxy status is safe', async () => {
    const response = await request('/api/llm/proxy/cliproxyapi');
    assertOk(response, 'GET /api/llm/proxy/cliproxyapi');
    assertNoSecretKeys(response.data);
    if (response.data.model) {
      assert(!isNonChatModelId(response.data.model), `Proxy selected non-chat model: ${response.data.model}`);
    }
  });

  await check('grok proxy chat test coerces image model', async () => {
    if (!LIVE_LLM) return;
    const config = originalConfig || (await request('/api/config')).data.config;
    const status = await request('/api/llm/proxy/cliproxyapi');
    if (!status.data || !status.data.running) return;
    const response = await request('/api/llm/test', {
      method: 'POST',
      timeout: 30000,
      body: {
        ollamaBase: status.data.base || config.ollamaBase,
        model: 'local:grok-imagine-image',
        chatTimeoutMs: 15000
      }
    });
    if (isOptionalLiveLlmUnavailable(response)) return;
    assertOk(response, 'POST /api/llm/test grok image coercion');
    assert(response.data.connected === true, response.data.error || 'Grok proxy chat test did not connect');
    assert(!isNonChatModelId(response.data.model), `Chat test used non-chat model: ${response.data.model}`);
  });

  await check('qa artifacts can be cleaned up', async () => {
    const exportFiles = new Set();
    for (const exportInfo of [qaExport, qaResearchExport].filter(Boolean)) {
      for (const file of [exportInfo.markdownPath, exportInfo.pdfPath].filter(Boolean)) {
        exportFiles.add(file);
      }
    }
    for (const file of exportFiles) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
      assert(!fs.existsSync(file), `QA export file was not removed: ${file}`);
    }
    if (qaTaskId) {
      await deleteIfExists(`/api/tasks/${encodeURIComponent(qaTaskId)}`, 'DELETE /api/tasks/:id');
      const task = await request(`/api/tasks/${encodeURIComponent(qaTaskId)}`);
      assert(task.status === 404, 'Deleted task is still readable');
    }
    if (qaResearchTaskId) {
      await deleteIfExists(`/api/tasks/${encodeURIComponent(qaResearchTaskId)}`, 'DELETE /api/tasks/:id research');
      const task = await request(`/api/tasks/${encodeURIComponent(qaResearchTaskId)}`);
      assert(task.status === 404, 'Deleted research task is still readable');
    }
    if (qaApprovalId) {
      await deleteIfExists(`/api/approvals/${encodeURIComponent(qaApprovalId)}`, 'DELETE /api/approvals/:id');
      const approvals = await request('/api/approvals');
      assertOk(approvals, 'GET /api/approvals after delete');
      assert(!(approvals.data.approvals || []).some((approval) => approval.id === qaApprovalId), 'Deleted approval is still listed');
    }
    await cleanupQaResidue([qaExport, qaResearchExport], originalConfig);
    const dashboard = await request('/api/dashboard');
    assertOk(dashboard, 'GET /api/dashboard after QA cleanup');
    assert(!(dashboard.data.events || []).some((event) => QA_RESIDUE_PATTERN.test(String(event.title || ''))), 'QA event residue is still visible');
    assertNoQaStateResidue();
    assertNoQaExportResidue([qaExport, qaResearchExport], originalConfig);
  });

  const failed = checks.filter((item) => !item.ok);
  const summary = {
    ok: failed.length === 0,
    baseUrl: BASE_URL,
    checks
  };
  console.log(JSON.stringify(summary, null, 2));
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
