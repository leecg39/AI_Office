#!/usr/bin/env node
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const { createHash, randomBytes, randomUUID } = require('crypto');
const axios = require('axios');

const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const ASSETS_DIR = path.join(ROOT, 'assets');
const DATA_DIR = path.join(WEB_DIR, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LLM_CREDENTIALS_FILE = path.join(DATA_DIR, 'llm-credentials.local.json');
const LOCAL_CONFIG = path.join(WEB_DIR, 'config.local.json');
const DEFAULT_OBSIDIAN_VAULTS = [
  path.join(os.homedir(), 'Documents', 'Obsidian Vault'),
  path.join(os.homedir(), 'Documents', 'AIS', 'AIS'),
  path.join(os.homedir(), 'Documents', 'zettel-connect-starter')
];
const PORT = Number(process.env.CONNECT_AI_WEB_PORT || process.env.PORT || 8788);
const MAX_BODY = 2 * 1024 * 1024;
const BRAIN_CACHE_TTL_MS = 10 * 1000;
const MAX_TASK_RUN_TIMEOUT_MS = 60000;
const OPENAI_API_BASE = 'https://api.openai.com/v1';
const ZAI_API_BASE = process.env.ZAI_API_BASE || 'https://api.z.ai/api/coding/paas/v4';
const MOONSHOT_API_BASE = process.env.MOONSHOT_API_BASE || 'https://api.moonshot.ai/v1';
const CHATGPT_RESPONSES_URL = 'https://chatgpt.com/backend-api/codex/responses';
const CHATMOCK_OPENAI_CLIENT_ID = process.env.CONNECT_AI_CHATMOCK_CLIENT_ID
  || process.env.CHATGPT_LOCAL_CLIENT_ID
  || 'app_EMoamEEZ73f0CkXaXp7hrann';
const CHATMOCK_OPENAI_ISSUER = String(process.env.CONNECT_AI_CHATMOCK_ISSUER
  || process.env.CHATGPT_LOCAL_ISSUER
  || 'https://auth.openai.com').replace(/\/+$/, '');
const CHATMOCK_OPENAI_TOKEN_URL = `${CHATMOCK_OPENAI_ISSUER}/oauth/token`;
const CHATMOCK_CALLBACK_PORT = Number(process.env.CONNECT_AI_CHATMOCK_CALLBACK_PORT || 1455);
const CHATMOCK_CALLBACK_BASE = String(process.env.CONNECT_AI_CHATMOCK_CALLBACK_BASE
  || `http://localhost:${CHATMOCK_CALLBACK_PORT}`).replace(/\/+$/, '');
const PROVIDERS = {
  openai: {
    id: 'openai',
    name: 'OpenAI GPT-5.6',
    apiKeyEnv: 'OPENAI_API_KEY',
    accountUrl: 'https://chatgpt.com/#settings/Subscription',
    keyUrl: 'https://platform.openai.com/settings/organization/api-keys',
    billingUrl: 'https://chatgpt.com/#settings/Subscription',
    docsUrl: 'https://developers.openai.com/api/docs/guides/latest-model',
    accountAuthMessage: 'ChatGPT 구독 계정 페이지를 열었습니다. Connect AI 인증은 구독 인증 버튼으로 진행해 주세요.'
  },
  zai: {
    id: 'zai',
    name: 'GLM 5.1',
    apiKeyEnv: 'ZAI_API_KEY',
    accountUrl: 'https://z.ai/manage-apikey/apikey-list',
    keyUrl: 'https://z.ai/manage-apikey/apikey-list',
    billingUrl: 'https://z.ai/manage-apikey/billing',
    docsUrl: 'https://docs.z.ai/guides/llm/glm-5.1',
    accountAuthMessage: 'Z.AI Lite / GLM Coding Plan 키는 Coding Plan API 엔드포인트로 연결됩니다. API Key 페이지에서 키 상태를 확인해 주세요.'
  },
  moonshot: {
    id: 'moonshot',
    name: 'Kimi 2.6',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    accountUrl: 'https://platform.kimi.ai/console/api-keys',
    keyUrl: 'https://platform.kimi.ai/console/api-keys',
    billingUrl: 'https://platform.kimi.ai/console/billing',
    docsUrl: 'https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart',
    accountAuthMessage: 'Kimi 2.6은 Moonshot/Kimi API Key로 연결됩니다. API Key 페이지에서 키 상태를 확인해 주세요.'
  }
};
const PAID_MODELS = [
  {
    id: 'openai:gpt-5.6',
    provider: 'openai',
    model: 'gpt-5.6',
    label: 'OpenAI · GPT-5.6',
    paid: true
  },
  {
    id: 'zai:glm-5.1',
    provider: 'zai',
    model: 'glm-5.1',
    label: 'GLM 5.1 · Z.AI Lite / Coding Plan (glm-5.1)',
    paid: true,
    contextLength: 200000
  },
  {
    id: 'moonshot:kimi-k2.6',
    provider: 'moonshot',
    model: 'kimi-k2.6',
    label: 'Kimi 2.6 · Moonshot API (kimi-k2.6)',
    paid: true,
    contextLength: 256000
  }
];
const OPENAI_CHATMOCK_MODEL_FALLBACKS = {
  'gpt-5.6': ['gpt-5.5']
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8'
};

function resolveAgentImage(fileName) {
  if (!fileName) return '';
  try {
    const wanted = fileName.normalize('NFC');
    const found = fs.readdirSync(path.join(ASSETS_DIR, 'agents'))
      .find((name) => name.normalize('NFC') === wanted);
    return found ? `/assets/agents/${encodeURIComponent(found)}` : '';
  } catch {
    return '';
  }
}

const AGENTS = [
  {
    id: 'ceo',
    name: 'Anna',
    role: 'Chief Executive Agent',
    emoji: '🧭',
    accent: '#f8fafc',
    avatar: resolveAgentImage('anna_ceo.jpeg'),
    specialty: '작업 분해, 종합 판단, 다음 액션 결정',
    tagline: '회사 전체 의사결정과 작업 분배를 맡습니다'
  },
  {
    id: 'youtube',
    name: '레오',
    role: 'Head of YouTube',
    emoji: '📺',
    accent: '#ff4444',
    specialty: '영상 기획, 트렌드 분석, 업로드 전략',
    tagline: '채널 운영과 콘텐츠 전략을 담당합니다',
    avatar: resolveAgentImage('leo_profile.png')
  },
  {
    id: 'developer',
    name: '코다리',
    role: '시니어 풀스택 엔지니어',
    emoji: '💻',
    accent: '#22d3ee',
    specialty: '코드 작성, 디버깅, API 통합, 자동화',
    tagline: '읽고, 짜고, 검증하는 개발 담당입니다',
    avatar: resolveAgentImage('코다리.png')
  },
  {
    id: 'business',
    name: '현빈',
    role: '비즈니스 전략가',
    emoji: '💼',
    accent: '#f5c518',
    specialty: '수익화, 가격 전략, 시장 분석',
    tagline: '비즈니스 판단과 KPI를 같이 봅니다',
    avatar: resolveAgentImage('현빈.jpeg')
  },
  {
    id: 'secretary',
    name: '영숙',
    role: '비서 · Personal Assistant',
    emoji: '📱',
    accent: '#84cc16',
    specialty: '일정, 할 일, 보고, 알림',
    tagline: '오늘 해야 할 일을 정리하고 챙깁니다',
    avatar: resolveAgentImage('영숙에이전트비서.jpeg')
  },
  {
    id: 'editor',
    name: '루나',
    role: 'Sound Director & Composer',
    emoji: '🎵',
    accent: '#f472b6',
    specialty: 'BGM, 사운드 디자인, 영상 오디오',
    tagline: '영상에 맞는 사운드 감각을 더합니다',
    avatar: resolveAgentImage('luna_greeting_pixar.png')
  },
  {
    id: 'designer',
    name: '옥순',
    role: 'Lead Designer',
    emoji: '🎨',
    accent: '#a78bfa',
    specialty: '브랜드, 썸네일, 디자인 시스템',
    tagline: '시각 자산과 화면 품질을 담당합니다',
    avatar: resolveAgentImage('oksun_designer.webp')
  },
  {
    id: 'writer',
    name: 'Jenny',
    role: 'Copywriter',
    emoji: '✍️',
    accent: '#fbbf24',
    specialty: '카피, 스크립트, 후크 작성',
    tagline: '글과 메시지를 선명하게 만듭니다',
    avatar: resolveAgentImage('jenny_writer.webp')
  },
  {
    id: 'researcher',
    name: '정후',
    role: 'Trend & Data Researcher',
    emoji: '🔍',
    accent: '#60a5fa',
    specialty: '리서치, 경쟁 분석, 사실 확인',
    tagline: '근거와 자료를 찾아 정리합니다',
    avatar: resolveAgentImage('junghu_researcher.webp')
  }
];

const DEFAULT_STATE = {
  schemaVersion: 1,
  sessions: [],
  tasks: [],
  approvals: [],
  agentState: {},
  events: []
};

const brainCache = new Map();
const oauthFlows = new Map();
let chatMockCallbackServer = null;

function expandHome(input) {
  if (!input) return '';
  const trimmed = String(input).trim();
  if (trimmed === '~') return os.homedir();
  if (trimmed.startsWith('~/')) return path.join(os.homedir(), trimmed.slice(2));
  return trimmed;
}

function isObsidianVault(dir) {
  try {
    return Boolean(dir) && fs.existsSync(path.join(dir, '.obsidian'));
  } catch {
    return false;
  }
}

function resolveObsidianVaultPath(raw, localBrainPath = '') {
  const explicit = expandHome(raw || process.env.CONNECT_AI_OBSIDIAN_VAULT || '');
  if (explicit) return explicit;
  const candidates = [localBrainPath, ...DEFAULT_OBSIDIAN_VAULTS].filter(Boolean);
  return candidates.find(isObsidianVault) || DEFAULT_OBSIDIAN_VAULTS[0];
}

function stripJsonComments(text) {
  return String(text)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/,\s*([}\]])/g, '$1');
}

function readJson(file, fallback = {}) {
  try {
    return JSON.parse(stripJsonComments(fs.readFileSync(file, 'utf8')));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function readLlmCredentials() {
  const value = readJson(LLM_CREDENTIALS_FILE, {});
  return value && typeof value === 'object' ? value : {};
}

function writeLlmCredentials(value) {
  writeJson(LLM_CREDENTIALS_FILE, value);
  try {
    fs.chmodSync(LLM_CREDENTIALS_FILE, 0o600);
  } catch {
    // Best effort only; credentials are stored under ignored local web/data.
  }
}

function providerConfig(provider) {
  return PROVIDERS[provider] || null;
}

function providerOAuthConfig(provider) {
  const upper = String(provider || '').toUpperCase();
  return {
    authUrl: process.env[`CONNECT_AI_${upper}_OAUTH_AUTH_URL`] || '',
    tokenUrl: process.env[`CONNECT_AI_${upper}_OAUTH_TOKEN_URL`] || '',
    clientId: process.env[`CONNECT_AI_${upper}_OAUTH_CLIENT_ID`] || '',
    clientSecret: process.env[`CONNECT_AI_${upper}_OAUTH_CLIENT_SECRET`] || '',
    scope: process.env[`CONNECT_AI_${upper}_OAUTH_SCOPE`] || ''
  };
}

function providerApiKeyLooksValid(provider, apiKey) {
  const key = String(apiKey || '').trim();
  if (!key) return false;
  if (provider === 'moonshot') return /^sk-[A-Za-z0-9_-]{20,}$/.test(key);
  return true;
}

function providerCredential(provider) {
  const config = providerConfig(provider);
  if (!config) return { token: '', source: '', method: '' };
  if (process.env[config.apiKeyEnv]) {
    const token = process.env[config.apiKeyEnv];
    if (!providerApiKeyLooksValid(provider, token)) return { token: '', source: 'env', method: 'apiKey', invalid: true };
    return { token, source: 'env', method: 'apiKey' };
  }
  const credentials = readLlmCredentials();
  const saved = credentials[provider] || {};
  if (provider === 'openai' && saved.authFlow === 'chatmock' && saved.tokens) {
    const accessToken = saved.tokens.accessToken || saved.tokens.access_token || '';
    const accountId = saved.tokens.accountId || saved.tokens.account_id || '';
    if (accessToken && accountId) {
      return {
        token: saved.apiKey || accessToken,
        source: 'local',
        method: saved.apiKey ? 'apiKey' : 'chatmock',
        authFlow: 'chatmock',
        chatMockAccessToken: accessToken,
        chatMockAccountId: accountId
      };
    }
  }
  if (saved.method === 'oauth' && saved.oauth && saved.oauth.accessToken) {
    return { token: saved.oauth.accessToken, source: 'local', method: 'oauth', authFlow: saved.authFlow || '' };
  }
  if (saved.method === 'apiKey' && saved.apiKey) {
    if (!providerApiKeyLooksValid(provider, saved.apiKey)) return { token: '', source: 'local', method: 'apiKey', authFlow: saved.authFlow || '', invalid: true };
    return { token: saved.apiKey, source: 'local', method: 'apiKey', authFlow: saved.authFlow || '' };
  }
  if (saved.oauth && saved.oauth.accessToken) {
    return { token: saved.oauth.accessToken, source: 'local', method: 'oauth', authFlow: saved.authFlow || '' };
  }
  if (saved.apiKey) {
    if (!providerApiKeyLooksValid(provider, saved.apiKey)) return { token: '', source: 'local', method: 'apiKey', authFlow: saved.authFlow || '', invalid: true };
    return { token: saved.apiKey, source: 'local', method: 'apiKey', authFlow: saved.authFlow || '' };
  }
  return { token: '', source: '', method: '' };
}

function getProviderSummaries() {
  return Object.values(PROVIDERS).map((provider) => {
    const credential = providerCredential(provider.id);
    const oauth = providerOAuthConfig(provider.id);
    return {
      id: provider.id,
      name: provider.name,
      accountUrl: provider.accountUrl,
      keyUrl: provider.keyUrl,
      billingUrl: provider.billingUrl,
      docsUrl: provider.docsUrl,
      accountAuthSupported: false,
      accountAuthMessage: provider.accountAuthMessage,
      apiKeyEnv: provider.apiKeyEnv,
      connected: Boolean(credential.token),
      method: credential.method,
      authFlow: credential.authFlow || '',
      source: credential.source,
      oauthConfigured: Boolean(oauth.authUrl && oauth.tokenUrl && oauth.clientId)
    };
  });
}

function getAuthStatus() {
  return Object.fromEntries(getProviderSummaries().map((provider) => [
    provider.id,
    {
      connected: provider.connected,
      method: provider.method,
      source: provider.source,
      oauthConfigured: provider.oauthConfigured
    }
  ]));
}

function readVsCodeSettings() {
  const candidates = [
    path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'settings.json'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'settings.json')
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return readJson(file);
  }
  return {};
}

function getConfig() {
  const local = readJson(LOCAL_CONFIG);
  const settings = readVsCodeSettings();
  const ollamaBase = process.env.CONNECT_AI_LLM_URL
    || local.ollamaBase
    || settings['connectAiLab.ollamaUrl']
    || 'http://127.0.0.1:1234';
  const defaultModel = process.env.CONNECT_AI_MODEL
    || local.defaultModel
    || settings['connectAiLab.defaultModel']
    || '';
  const localBrainPath = expandHome(process.env.CONNECT_AI_BRAIN
    || local.localBrainPath
    || settings['connectAiLab.localBrainPath']
    || path.join(os.homedir(), '.connect-ai-brain'));
  const obsidianVaultPath = resolveObsidianVaultPath(
    process.env.CONNECT_AI_OBSIDIAN_VAULT
      || local.obsidianVaultPath
      || settings['connectAiLab.obsidianVaultPath'],
    localBrainPath
  );
  const timeoutMs = Number(process.env.CONNECT_AI_TIMEOUT_MS
    || local.timeoutMs
    || ((settings['connectAiLab.requestTimeout'] || 300) * 1000));
  const chatTimeoutMs = Number(process.env.CONNECT_AI_CHAT_TIMEOUT_MS
    || local.chatTimeoutMs
    || Math.min(timeoutMs || 300000, 45000));
  return {
    ollamaBase: String(ollamaBase).replace(/\/+$/, ''),
    defaultModel: String(defaultModel || ''),
    localBrainPath,
    obsidianVaultPath,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 300000,
    chatTimeoutMs: Number.isFinite(chatTimeoutMs) ? chatTimeoutMs : 45000
  };
}

function loadState() {
  const stored = readJson(STATE_FILE, {});
  return {
    ...DEFAULT_STATE,
    ...stored,
    sessions: Array.isArray(stored.sessions) ? stored.sessions : [],
    tasks: Array.isArray(stored.tasks) ? stored.tasks : [],
    approvals: Array.isArray(stored.approvals) ? stored.approvals : [],
    agentState: stored.agentState && typeof stored.agentState === 'object' ? stored.agentState : {},
    events: Array.isArray(stored.events) ? stored.events : []
  };
}

function saveState(state) {
  writeJson(STATE_FILE, {
    ...state,
    sessions: state.sessions.slice(0, 60),
    tasks: state.tasks.slice(0, 300),
    approvals: state.approvals.slice(0, 300),
    events: state.events.slice(0, 120)
  });
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomUUID().slice(0, 8)}`;
}

function requestBaseUrl(req) {
  const host = req && req.headers && req.headers.host ? req.headers.host : `127.0.0.1:${PORT}`;
  return `http://${host}`;
}

function ensureChatMockCallbackServer() {
  if (chatMockCallbackServer && chatMockCallbackServer.listening) return true;
  chatMockCallbackServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `${CHATMOCK_CALLBACK_BASE}`);
      if (url.pathname === '/auth/callback') {
        await handleChatMockLocalCallback(res, url);
        return;
      }
      if (url.pathname === '/success') {
        sendHtml(res, 200, oauthCallbackPage('OpenAI 구독 인증 연결 완료', 'Connect AI로 돌아가 연결 상태를 확인하세요. 이 창은 닫아도 됩니다.'));
        return;
      }
      sendHtml(res, 404, oauthCallbackPage('OpenAI 구독 인증 실패', '지원하지 않는 콜백 경로입니다.'));
    } catch (error) {
      sendHtml(res, 500, oauthCallbackPage('OpenAI 구독 인증 실패', error.message || String(error)));
    }
  });
  chatMockCallbackServer.on('error', (error) => {
    console.warn(`[chatmock] callback server error: ${error.message || error}`);
  });
  chatMockCallbackServer.listen(CHATMOCK_CALLBACK_PORT);
  return true;
}

function createOAuthFlow(req, providerId) {
  const provider = providerConfig(providerId);
  if (!provider) throw new Error('PROVIDER_NOT_FOUND');
  const oauth = providerOAuthConfig(providerId);
  if (!oauth.authUrl || !oauth.tokenUrl || !oauth.clientId) {
    if (providerId === 'openai') return createChatMockOpenAiAuthFlow(req, provider);
    return {
      provider: providerId,
      available: false,
      authUrl: '',
      message: `${provider.name} OAuth 클라이언트 설정이 없습니다. Account 또는 API Key로 연결해 주세요.`
    };
  }

  const flowId = newId('oauth');
  const codeVerifier = randomBytes(64).toString('base64url');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const callbackUrl = `${requestBaseUrl(req)}/oauth/${encodeURIComponent(providerId)}/callback`;
  const authUrl = new URL(oauth.authUrl);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', oauth.clientId);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('state', flowId);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  if (oauth.scope) authUrl.searchParams.set('scope', oauth.scope);
  oauthFlows.set(flowId, {
    provider: providerId,
    status: 'pending',
    codeVerifier,
    callbackUrl,
    createdAt: Date.now(),
    error: ''
  });
  return {
    provider: providerId,
    available: true,
    flowId,
    authUrl: authUrl.toString(),
    message: `${provider.name} OAuth 인증 창을 열었습니다.`
  };
}

function createChatMockOpenAiAuthFlow(req, provider) {
  ensureChatMockCallbackServer();
  const flowId = newId('oauth');
  const codeVerifier = randomBytes(64).toString('hex');
  const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');
  const callbackUrl = `${CHATMOCK_CALLBACK_BASE}/auth/callback`;
  const authUrl = new URL(`${CHATMOCK_OPENAI_ISSUER}/oauth/authorize`);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', CHATMOCK_OPENAI_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', callbackUrl);
  authUrl.searchParams.set('scope', 'openid profile email offline_access');
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('id_token_add_organizations', 'true');
  authUrl.searchParams.set('codex_cli_simplified_flow', 'true');
  authUrl.searchParams.set('state', flowId);
  oauthFlows.set(flowId, {
    provider: provider.id,
    status: 'pending',
    mode: 'chatmock-openai',
    clientId: CHATMOCK_OPENAI_CLIENT_ID,
    tokenEndpoint: CHATMOCK_OPENAI_TOKEN_URL,
    callbackUrl,
    codeVerifier,
    createdAt: Date.now(),
    error: ''
  });
  return {
    provider: provider.id,
    available: true,
    mode: 'chatmock-openai',
    flowId,
    authUrl: authUrl.toString(),
    message: 'ChatGPT 구독 계정 인증 창을 열었습니다. 인증이 끝나면 LLM 연결이 자동 완료됩니다.'
  };
}

function createAccountAuthFlow(providerId) {
  const provider = providerConfig(providerId);
  if (!provider) throw new Error('PROVIDER_NOT_FOUND');
  return {
    provider: providerId,
    available: false,
    authUrl: provider.accountUrl || provider.billingUrl || provider.keyUrl,
    keyUrl: provider.keyUrl,
    billingUrl: provider.billingUrl,
    message: provider.accountAuthMessage || `${provider.name} 구독 계정 인증은 API 호출 인증으로 직접 사용할 수 없습니다. API Key 또는 OAuth 연결을 사용해 주세요.`
  };
}

function escapeHtmlForPage(value) {
  return String(value || '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function oauthCallbackPage(title, body) {
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtmlForPage(title)}</title>
    <style>
      body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07090d;color:#eef5f3;font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      main{width:min(520px,calc(100vw - 32px));border:1px solid rgba(255,255,255,.12);border-radius:10px;background:#0e1418;padding:24px}
      h1{margin:0 0 8px;font-size:22px}
      p{margin:0;color:#93a2aa}
    </style>
  </head>
  <body><main><h1>${escapeHtmlForPage(title)}</h1><p>${escapeHtmlForPage(body)}</p></main></body>
</html>`;
}

function parseJwtClaims(token) {
  if (!token || String(token).split('.').length !== 3) return {};
  try {
    const payload = String(token).split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

async function exchangeChatMockOpenAiCode(flow, code) {
  const tokenBody = new URLSearchParams();
  tokenBody.set('grant_type', 'authorization_code');
  tokenBody.set('code', code);
  tokenBody.set('redirect_uri', flow.callbackUrl);
  tokenBody.set('client_id', flow.clientId);
  tokenBody.set('code_verifier', flow.codeVerifier);
  const tokenResponse = await axios.post(flow.tokenEndpoint, tokenBody.toString(), {
    timeout: 30000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
  });

  const idToken = tokenResponse.data && tokenResponse.data.id_token;
  const accessToken = tokenResponse.data && tokenResponse.data.access_token;
  const refreshToken = tokenResponse.data && tokenResponse.data.refresh_token;
  if (!idToken || !accessToken) throw new Error('ChatMock OpenAI token response is missing expected tokens.');

  const idClaims = parseJwtClaims(idToken);
  const accessClaims = parseJwtClaims(accessToken);
  const authClaims = idClaims['https://api.openai.com/auth'] || {};
  const orgId = idClaims.organization_id || '';
  const projectId = idClaims.project_id || '';
  let apiKey = '';
  let needsPlatformSetup = false;
  if (orgId && projectId) {
    const exchangeBody = new URLSearchParams();
    exchangeBody.set('grant_type', 'urn:ietf:params:oauth:grant-type:token-exchange');
    exchangeBody.set('client_id', flow.clientId);
    exchangeBody.set('requested_token', 'openai-api-key');
    exchangeBody.set('subject_token', idToken);
    exchangeBody.set('subject_token_type', 'urn:ietf:params:oauth:token-type:id_token');
    exchangeBody.set('name', `ChatMock [Connect AI] (${new Date().toISOString().slice(0, 10)})`);
    const exchangeResponse = await axios.post(flow.tokenEndpoint, exchangeBody.toString(), {
      timeout: 30000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    apiKey = exchangeResponse.data && exchangeResponse.data.access_token ? exchangeResponse.data.access_token : '';
  } else {
    needsPlatformSetup = true;
  }

  return {
    apiKey,
    tokens: {
      idToken,
      accessToken,
      refreshToken: refreshToken || '',
      accountId: authClaims.chatgpt_account_id || ''
    },
    chatmock: {
      orgId,
      projectId,
      needsPlatformSetup,
      planType: accessClaims.chatgpt_plan_type || accessClaims['https://api.openai.com/auth']?.chatgpt_plan_type || '',
      issuer: CHATMOCK_OPENAI_ISSUER
    }
  };
}

async function handleChatMockOpenAiCallback(res, flow, code) {
  try {
    const auth = await exchangeChatMockOpenAiCode(flow, code);
    const credentials = readLlmCredentials();
    credentials.openai = {
      ...(credentials.openai || {}),
      apiKey: auth.apiKey,
      method: auth.apiKey ? 'apiKey' : 'chatmock',
      authFlow: 'chatmock',
      chatmock: {
        ...auth.chatmock,
        clientId: flow.clientId,
        savedAt: nowIso()
      },
      tokens: auth.tokens,
      savedAt: nowIso()
    };
    writeLlmCredentials(credentials);
    flow.status = 'connected';
    flow.error = '';
    const message = auth.apiKey
      ? 'Connect AI로 돌아가 연결 상태를 확인하세요. 이 창은 닫아도 됩니다.'
      : 'OpenAI API Key는 자동 발급되지 않았지만 ChatGPT 구독 인증 토큰은 저장되었습니다. Connect AI로 돌아가 연결 상태를 확인하세요.';
    sendHtml(res, 200, oauthCallbackPage('OpenAI 구독 인증 연결 완료', message));
  } catch (error) {
    flow.status = 'error';
    flow.error = 'OpenAI 구독 인증은 완료되지 않았습니다. ChatGPT 구독 계정 상태를 확인한 뒤 다시 시도해 주세요.';
    sendHtml(res, 502, oauthCallbackPage('OpenAI 구독 인증 실패', flow.error));
  }
}

async function handleChatMockLocalCallback(res, url) {
  const flowId = url.searchParams.get('state') || '';
  const flow = flowId ? oauthFlows.get(flowId) : null;
  if (!flow || flow.provider !== 'openai' || flow.mode !== 'chatmock-openai') {
    sendHtml(res, 404, oauthCallbackPage('OpenAI 구독 인증 실패', '인증 세션을 찾을 수 없습니다. API 패널에서 다시 시도해 주세요.'));
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error || !code) {
    flow.status = 'error';
    flow.error = error || '인증 코드가 없습니다.';
    sendHtml(res, 400, oauthCallbackPage('OpenAI 구독 인증 실패', flow.error));
    return;
  }

  await handleChatMockOpenAiCallback(res, flow, code);
}

async function handleOAuthCallback(req, res, url) {
  const match = url.pathname.match(/^\/oauth\/([^/]+)\/callback$/);
  const providerId = match ? decodeURIComponent(match[1]) : '';
  const provider = providerConfig(providerId);
  const flowId = url.searchParams.get('state') || '';
  const flow = flowId ? oauthFlows.get(flowId) : null;
  if (!provider || !flow || flow.provider !== providerId) {
    sendHtml(res, 404, oauthCallbackPage('OAuth 인증 실패', '인증 세션을 찾을 수 없습니다. API 패널에서 다시 시도해 주세요.'));
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');
  if (error || !code) {
    flow.status = 'error';
    flow.error = error || '인증 코드가 없습니다.';
    sendHtml(res, 400, oauthCallbackPage('OAuth 인증 실패', flow.error));
    return;
  }

  const oauth = providerOAuthConfig(providerId);
  try {
    if (flow.mode === 'chatmock-openai') {
      await handleChatMockOpenAiCallback(res, flow, code);
      return;
    }
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('code', code);
    body.set('redirect_uri', flow.callbackUrl);
    body.set('client_id', oauth.clientId);
    body.set('code_verifier', flow.codeVerifier);
    if (oauth.clientSecret) body.set('client_secret', oauth.clientSecret);
    const response = await axios.post(oauth.tokenUrl, body.toString(), {
      timeout: 15000,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });
    const accessToken = response.data && response.data.access_token;
    if (!accessToken) throw new Error('OAuth access token이 응답에 없습니다.');
    const credentials = readLlmCredentials();
    credentials[providerId] = {
      ...(credentials[providerId] || {}),
      oauth: {
        accessToken,
        refreshToken: response.data.refresh_token || '',
        tokenType: response.data.token_type || 'Bearer',
        expiresAt: response.data.expires_in ? Date.now() + Number(response.data.expires_in) * 1000 : 0,
        savedAt: nowIso()
      },
      method: 'oauth'
    };
    writeLlmCredentials(credentials);
    flow.status = 'connected';
    flow.error = '';
    sendHtml(res, 200, oauthCallbackPage(`${provider.name} OAuth 연결 완료`, 'Connect AI로 돌아가 연결 상태를 확인하세요. 이 창은 닫아도 됩니다.'));
  } catch (exchangeError) {
    flow.status = 'error';
    flow.error = modelErrorMessage(exchangeError);
    sendHtml(res, 502, oauthCallbackPage('OAuth 인증 실패', flow.error));
  }
}

function sanitizeSensitiveText(value) {
  return String(value || '')
    .replace(/\borg-[A-Za-z0-9_-]{8,}\b/g, 'org-[redacted]')
    .replace(/<\s*ak-[^>]+>/gi, '<ak-[redacted]>')
    .replace(/\bak-[A-Za-z0-9_-]{8,}\b/g, 'ak-[redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, 'sk-[redacted]');
}

function cleanText(value, max = 4000) {
  return sanitizeSensitiveText(String(value || '').replace(/\0/g, '').trim()).slice(0, max);
}

function cleanSecret(value, max = 4000) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max);
}

function safeFileName(value, fallback = 'connect-ai-result') {
  const cleaned = String(value || '')
    .normalize('NFC')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return (cleaned || fallback).replace(/\s/g, '-');
}

function formatDateForFile(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

function taskExportBaseName(task) {
  const date = formatDateForFile(task.completedAt || task.updatedAt || task.createdAt || nowIso());
  return `${date}-${safeFileName(task.title || task.id)}-${safeFileName(task.id, 'task')}`;
}

function taskExportMarkdown(task, config, agent = {}) {
  const resultText = task.result || task.error || task.description || '저장된 결과물이 없습니다.';
  const sources = Array.isArray(task.sources) ? task.sources.filter(Boolean) : [];
  const lines = [
    '---',
    `title: ${JSON.stringify(task.title || 'Connect AI Result')}`,
    `task_id: ${JSON.stringify(task.id || '')}`,
    `agent: ${JSON.stringify(agent.name || task.agent || 'Agent')}`,
    `status: ${JSON.stringify(task.status || '')}`,
    `created: ${JSON.stringify(task.createdAt || '')}`,
    `completed: ${JSON.stringify(task.completedAt || '')}`,
    `source: ${JSON.stringify('Connect AI Web')}`,
    '---',
    '',
    `# ${task.title || 'Connect AI Result'}`,
    '',
    `- Agent: ${agent.name || task.agent || 'Agent'}`,
    `- Status: ${task.status || '-'}`,
    `- Created: ${task.createdAt || '-'}`,
    `- Completed: ${task.completedAt || task.updatedAt || '-'}`,
    `- Brain Folder: ${config.localBrainPath || '-'}`,
    '',
    '## Result',
    '',
    resultText,
    ''
  ];
  if (sources.length) {
    lines.push('## Sources', '', ...sources.map((source) => `- ${source}`), '');
  }
  return lines.join('\n');
}

function wrapTextForPdf(value, maxChars = 58) {
  const output = [];
  String(value || '').replace(/\r\n/g, '\n').split('\n').forEach((line) => {
    const chars = Array.from(line);
    if (!chars.length) {
      output.push('');
      return;
    }
    let chunk = '';
    chars.forEach((char) => {
      const next = chunk + char;
      if (Array.from(next).length > maxChars) {
        output.push(chunk);
        chunk = char;
      } else {
        chunk = next;
      }
    });
    if (chunk) output.push(chunk);
  });
  return output;
}

function utf16beHex(value) {
  const le = Buffer.from(String(value || ''), 'utf16le');
  const be = Buffer.alloc(le.length);
  for (let index = 0; index < le.length; index += 2) {
    be[index] = le[index + 1] || 0;
    be[index + 1] = le[index] || 0;
  }
  return be.toString('hex').toUpperCase();
}

function createPdfBuffer(markdownText) {
  const lines = wrapTextForPdf(markdownText, 56);
  const pages = [];
  for (let index = 0; index < lines.length; index += 44) {
    pages.push(lines.slice(index, index + 44));
  }
  if (!pages.length) pages.push(['']);

  const objects = new Map();
  objects.set(1, Buffer.from('<< /Type /Catalog /Pages 2 0 R >>\n'));
  objects.set(3, Buffer.from([
    '<< /Type /Font /Subtype /Type0 /BaseFont /HYSMyeongJo-Medium',
    '/Encoding /UniKS-UCS2-H',
    '/DescendantFonts [ << /Type /Font /Subtype /CIDFontType0 /BaseFont /HYSMyeongJo-Medium',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (Korea1) /Supplement 2 >>',
    '/FontDescriptor << /Type /FontDescriptor /FontName /HYSMyeongJo-Medium /Flags 6',
    '/FontBBox [-6 -145 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -145 /CapHeight 880 /StemV 80 >>',
    '>> ] >>\n'
  ].join(' ')));

  const pageRefs = [];
  pages.forEach((pageLines, index) => {
    const pageObj = 4 + index * 2;
    const contentObj = pageObj + 1;
    pageRefs.push(`${pageObj} 0 R`);
    const commands = ['BT', '/F1 11 Tf', '48 790 Td', '15 TL'];
    pageLines.forEach((line) => {
      commands.push(`<${utf16beHex(line)}> Tj`, 'T*');
    });
    commands.push('ET');
    const stream = Buffer.from(commands.join('\n'), 'ascii');
    objects.set(pageObj, Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>\n`));
    objects.set(contentObj, Buffer.concat([
      Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),
      stream,
      Buffer.from('\nendstream\n')
    ]));
  });
  objects.set(2, Buffer.from(`<< /Type /Pages /Count ${pages.length} /Kids [${pageRefs.join(' ')}] >>\n`));

  const maxObject = Math.max(...objects.keys());
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'binary')];
  const offsets = Array(maxObject + 1).fill(0);
  for (let objectNumber = 1; objectNumber <= maxObject; objectNumber += 1) {
    const content = objects.get(objectNumber);
    if (!content) continue;
    offsets[objectNumber] = parts.reduce((sum, part) => sum + part.length, 0);
    parts.push(Buffer.from(`${objectNumber} 0 obj\n`), content, Buffer.from('endobj\n'));
  }
  const xrefOffset = parts.reduce((sum, part) => sum + part.length, 0);
  const xref = [
    'xref',
    `0 ${maxObject + 1}`,
    '0000000000 65535 f ',
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n `),
    'trailer',
    `<< /Size ${maxObject + 1} /Root 1 0 R >>`,
    'startxref',
    String(xrefOffset),
    '%%EOF',
    ''
  ].join('\n');
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

function writeTaskExport(task, config, target = 'all') {
  const agent = AGENTS.find((item) => item.id === task.agent) || {};
  const vaultPath = resolveObsidianVaultPath(config.obsidianVaultPath, config.localBrainPath);
  const exportDir = path.join(vaultPath, 'Connect AI', 'Results');
  const baseName = taskExportBaseName(task);
  const markdown = taskExportMarkdown(task, config, agent);
  const output = {
    vaultPath,
    exportDir,
    markdownPath: '',
    pdfPath: ''
  };
  fs.mkdirSync(exportDir, { recursive: true });
  if (target === 'all' || target === 'obsidian') {
    output.markdownPath = path.join(exportDir, `${baseName}.md`);
    fs.writeFileSync(output.markdownPath, markdown, 'utf8');
  }
  if (target === 'all' || target === 'pdf') {
    output.pdfPath = path.join(exportDir, `${baseName}.pdf`);
    fs.writeFileSync(output.pdfPath, createPdfBuffer(markdown));
  }
  return output;
}

function pathInside(parent, child) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function runOpenCommand(args) {
  return new Promise((resolve, reject) => {
    execFile('open', args, { timeout: 10000 }, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function openResultPath(config, rawPath, action) {
  const requested = expandHome(String(rawPath || '').trim());
  if (!requested) throw new Error('PATH_REQUIRED');
  const filePath = path.resolve(requested);
  const vaultPath = path.resolve(resolveObsidianVaultPath(config.obsidianVaultPath, config.localBrainPath));
  if (!pathInside(vaultPath, filePath)) throw new Error('PATH_NOT_ALLOWED');
  if (!fs.existsSync(filePath)) throw new Error('FILE_NOT_FOUND');

  const stat = fs.statSync(filePath);
  if (action === 'finder') {
    await runOpenCommand(stat.isDirectory() ? [filePath] : ['-R', filePath]);
    return { action, path: filePath };
  }
  if (action === 'preview') {
    if (stat.isDirectory()) throw new Error('PREVIEW_REQUIRES_FILE');
    await runOpenCommand(['-a', 'Preview', filePath]);
    return { action, path: filePath };
  }
  if (action === 'obsidian') {
    const relative = path.relative(vaultPath, filePath).split(path.sep).join('/');
    const uri = `obsidian://open?vault=${encodeURIComponent(path.basename(vaultPath))}&file=${encodeURIComponent(relative)}`;
    await runOpenCommand([uri]);
    return { action, path: filePath, uri };
  }
  throw new Error('OPEN_ACTION_REQUIRED');
}

function pushEvent(state, type, title, meta = {}) {
  state.events.unshift({
    id: newId('evt'),
    type,
    title: cleanText(title, 240),
    agent: meta.agent || '',
    createdAt: nowIso()
  });
  state.events = state.events.slice(0, 120);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function sendHtml(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const text = await readBody(req);
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function safeJoin(root, requestPath) {
  const decoded = decodeURIComponent(requestPath.split('?')[0]);
  const normalized = path.normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  const full = path.resolve(root, normalized.replace(/^[/\\]/, ''));
  if (!full.startsWith(root + path.sep) && full !== root) return null;
  return full;
}

function serveFile(res, file) {
  if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  const ext = path.extname(file).toLowerCase();
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream' };
  if (['.html', '.css', '.js'].includes(ext)) {
    headers['Cache-Control'] = 'no-store';
  }
  res.writeHead(200, headers);
  fs.createReadStream(file).pipe(res);
}

function resolveCompanyDir(config) {
  const root = config.localBrainPath;
  const candidates = [
    root,
    path.join(root, '_company'),
    path.join(root, 'AI_COMPANY'),
    path.join(root, 'company')
  ];
  return candidates.find((dir) => {
    try {
      return fs.existsSync(path.join(dir, 'company_state.json'))
        || fs.existsSync(path.join(dir, '_shared', 'active.json'))
        || fs.existsSync(path.join(dir, '_shared', 'tracker.json'))
        || fs.existsSync(path.join(dir, 'approvals', 'pending'));
    } catch {
      return false;
    }
  }) || root;
}

function readCompanyState(config) {
  const companyDir = resolveCompanyDir(config);
  const direct = readJson(path.join(companyDir, 'company_state.json'), null);
  const root = readJson(path.join(config.localBrainPath, 'company_state.json'), null);
  return direct || root || {};
}

function readActiveAgents(config) {
  const companyDir = resolveCompanyDir(config);
  const direct = readJson(path.join(companyDir, '_shared', 'active.json'), null);
  const root = readJson(path.join(config.localBrainPath, '_company', '_shared', 'active.json'), null);
  return direct || root || {};
}

function externalTrackerTasks(config) {
  const companyDir = resolveCompanyDir(config);
  const tracker = readJson(path.join(companyDir, '_shared', 'tracker.json'), { tasks: [] });
  return Array.isArray(tracker.tasks) ? tracker.tasks.map((task) => ({
    id: String(task.id || newId('exttask')),
    title: cleanText(task.title || task.task || '작업', 500),
    description: cleanText(task.description || '', 1000),
    agent: Array.isArray(task.agentIds) && task.agentIds[0] ? task.agentIds[0] : cleanText(task.owner || '', 80),
    priority: task.priority || 'normal',
    status: task.status || 'open',
    dueAt: task.dueAt || '',
    createdAt: task.createdAt || '',
    updatedAt: task.updatedAt || '',
    source: 'company'
  })) : [];
}

function parseApprovalMarkdown(file) {
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/);
  const titleLine = lines.find((line) => line.trim().startsWith('#'));
  const title = titleLine ? titleLine.replace(/^#+\s*/, '').trim() : path.basename(file, '.md');
  const summary = lines
    .filter((line) => line.trim() && !line.trim().startsWith('#') && !line.includes('---'))
    .slice(0, 4)
    .join(' ')
    .slice(0, 500);
  return {
    id: path.basename(file, '.md'),
    title,
    summary,
    kind: 'file',
    agent: '',
    status: 'pending',
    createdAt: fs.statSync(file).mtime.toISOString(),
    source: 'company'
  };
}

function externalApprovals(config) {
  const pendingDir = path.join(resolveCompanyDir(config), 'approvals', 'pending');
  try {
    if (!fs.existsSync(pendingDir)) return [];
    return fs.readdirSync(pendingDir)
      .filter((name) => name.endsWith('.md'))
      .slice(0, 40)
      .map((name) => parseApprovalMarkdown(path.join(pendingDir, name)));
  } catch {
    return [];
  }
}

function moveExternalApproval(config, id, action) {
  const companyDir = resolveCompanyDir(config);
  const pending = safeJoin(path.join(companyDir, 'approvals', 'pending'), `${id}.md`);
  if (!pending || !fs.existsSync(pending)) return false;
  const historyDir = path.join(companyDir, 'approvals', 'history');
  fs.mkdirSync(historyDir, { recursive: true });
  fs.renameSync(pending, path.join(historyDir, `${Date.now()}-${action}-${path.basename(pending)}`));
  return true;
}

function termsFromMessage(message) {
  return String(message || '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 12);
}

function walkBrain(root, opts = {}) {
  const limit = Math.min(Number(opts.limit) || 120, 700);
  const snippets = opts.snippets || false;
  const terms = (opts.terms || []).map((term) => String(term).toLowerCase()).filter(Boolean);
  const snippetChars = Math.min(Number(opts.snippetChars) || 1200, 4000);
  const cacheKey = JSON.stringify({ root, limit, snippets, terms, snippetChars });
  const cached = brainCache.get(cacheKey);
  if (cached && Date.now() - cached.createdAt < BRAIN_CACHE_TTL_MS) return cached.value;

  const skipDirs = new Set([
    '.git',
    '.hg',
    '.svn',
    '.obsidian',
    '.next',
    '.turbo',
    'node_modules',
    'dist',
    'out',
    'build',
    'coverage',
    'Library',
    'Caches'
  ]);
  const files = [];
  let capped = false;

  function scoreText(rel, text) {
    if (terms.length === 0) return 0;
    const hay = `${rel}\n${text}`.toLowerCase();
    return terms.reduce((sum, term) => sum + (hay.includes(term) ? 1 : 0), 0);
  }

  function walk(dir, depth) {
    if (capped || depth > 7) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (capped) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) walk(full, depth + 1);
        continue;
      }
      if (!entry.name.endsWith('.md') && !entry.name.endsWith('.txt')) continue;
      const rel = path.relative(root, full);
      let firstLine = '';
      let snippet = '';
      try {
        const text = fs.readFileSync(full, 'utf8');
        firstLine = text.split(/\r?\n/).find((line) => line.trim()) || '';
        snippet = snippets ? text.slice(0, snippetChars) : '';
      } catch {
        // Keep the file path even when the file cannot be read.
      }
      const score = scoreText(rel, `${firstLine}\n${snippet}`);
      if (terms.length === 0 || score > 0) {
        files.push({
          path: rel,
          title: firstLine.replace(/^#+\s*/, '').slice(0, 120) || rel,
          snippet,
          score
        });
      }
      if (files.length >= limit) capped = true;
    }
  }

  if (fs.existsSync(root)) walk(root, 0);
  files.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  const value = { files, capped };
  brainCache.set(cacheKey, { createdAt: Date.now(), value });
  return value;
}

function isLmStudio(base) {
  return base.includes('1234') || base.endsWith('/v1') || base.includes('/v1/');
}

function lmBase(base) {
  return base.replace(/\/v1\/?$/, '');
}

async function listLocalModels(config) {
  if (isLmStudio(config.ollamaBase)) {
    const url = `${lmBase(config.ollamaBase)}/v1/models`;
    const response = await axios.get(url, { timeout: 3500 });
    return (response.data && response.data.data || []).map((model) => model.id).filter(Boolean);
  }
  const response = await axios.get(`${config.ollamaBase}/api/tags`, { timeout: 3500 });
  return (response.data && response.data.models || []).map((model) => model.name).filter(Boolean);
}

function isEmbeddingModel(model) {
  return /embed|embedding/i.test(String(model || ''));
}

function parseModelRef(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('openai:')) return { provider: 'openai', model: raw.slice('openai:'.length) };
  if (raw.startsWith('zai:')) return { provider: 'zai', model: raw.slice('zai:'.length) };
  if (raw.startsWith('moonshot:')) return { provider: 'moonshot', model: raw.slice('moonshot:'.length) };
  if (raw.startsWith('local:')) return { provider: 'local', model: raw.slice('local:'.length) };
  return { provider: 'local', model: raw };
}

function modelRef(provider, model) {
  return `${provider}:${String(model || '').trim()}`;
}

function firstChatModel(models, preferred) {
  const preferredRef = parseModelRef(preferred);
  if (preferredRef.provider === 'local' && preferredRef.model && !isEmbeddingModel(preferredRef.model)) {
    return preferredRef.model;
  }
  return (models || []).find((model) => !isEmbeddingModel(model)) || '';
}

function isActiveTaskStatus(status) {
  return !['done', 'cancelled', 'failed'].includes(status || 'open');
}

function taskRunTimeoutMs(config) {
  const configured = Number(config.chatTimeoutMs) || 45000;
  const globalLimit = Number(config.timeoutMs) || 300000;
  return Math.max(5000, Math.min(configured, globalLimit, MAX_TASK_RUN_TIMEOUT_MS));
}

async function listModelOptions(config) {
  const errors = [];
  const localResult = await Promise.resolve(listLocalModels(config)).then(
    (models) => ({ status: 'fulfilled', value: models }),
    (error) => ({ status: 'rejected', reason: error })
  );
  const models = [];

  if (localResult.status === 'fulfilled') {
    localResult.value.forEach((model) => {
      models.push({
        id: modelRef('local', model),
        provider: 'local',
        model,
        label: `Local · ${model}`,
        paid: false
      });
    });
  } else {
    errors.push({ provider: 'local', error: modelErrorMessage(localResult.reason) });
  }

  models.push(...PAID_MODELS.map((model) => ({ ...model })));
  return { models, errors };
}

function buildMessages({ message, agent, brainFiles }) {
  const selected = AGENTS.find((item) => item.id === agent) || AGENTS[0];
  const brainContext = brainFiles.length
    ? brainFiles.map((file) => {
      const heading = `- ${file.path}: ${String(file.title || '').slice(0, 120)}`;
      const excerpt = String(file.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 600);
      return excerpt ? `${heading}\n  ${excerpt}` : heading;
    }).join('\n')
    : '(관련 로컬 지식 파일 없음)';

  return [{
    role: 'user',
    content:
      `역할: Connect AI의 ${selected.name} (${selected.role}).\n` +
      `답변: 한국어, 결론 먼저, 짧고 실행 가능하게.\n` +
      `참고자료:\n${brainContext}\n\n` +
      `요청: ${String(message || '')}`
  }];
}

function extractModelText(data) {
  const choice = data && data.choices && data.choices[0];
  const message = choice && choice.message;
  if (message) {
    if (typeof message.content === 'string' && message.content.trim()) return message.content;
    if (Array.isArray(message.content)) {
      const text = message.content.map((part) => part.text || part.content || '').join('').trim();
      if (text) return text;
    }
  }
  if (typeof data.output_text === 'string') return data.output_text;
  if (typeof data.response === 'string') return data.response;
  if (data.message && typeof data.message.content === 'string') return data.message.content;
  return '';
}

function extractResponsesText(data) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) return data.output_text;
  const output = Array.isArray(data && data.output) ? data.output : [];
  const parts = [];
  output.forEach((item) => {
    const content = Array.isArray(item.content) ? item.content : [];
    content.forEach((part) => {
      if (typeof part.text === 'string') parts.push(part.text);
      if (typeof part.content === 'string') parts.push(part.content);
    });
  });
  return parts.join('').trim();
}

function streamToText(stream) {
  if (!stream || typeof stream.on !== 'function') return Promise.resolve(String(stream || ''));
  return new Promise((resolve, reject) => {
    let text = '';
    stream.on('data', (chunk) => { text += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk); });
    stream.on('end', () => resolve(text));
    stream.on('error', reject);
  });
}

function aggregateSseResponse(stream) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    let responseObj = null;
    let errorObj = null;
    let outputText = '';
    function processLine(line) {
      if (!line.startsWith('data: ')) return;
      const data = line.slice(6).trim();
      if (!data || data === '[DONE]') return;
      try {
        const event = JSON.parse(data);
        if (event && typeof event === 'object') {
          if (event.response && typeof event.response === 'object') responseObj = event.response;
          if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
            outputText += event.delta;
          }
          if (event.type === 'response.output_text.done' && typeof event.text === 'string') {
            outputText = event.text;
          }
          if (event.type === 'response.failed') {
            errorObj = event.response && event.response.error
              ? { error: event.response.error }
              : { error: { message: 'response.failed' } };
          }
        }
      } catch {
        // Ignore non-JSON SSE lines.
      }
    }
    stream.on('data', (chunk) => {
      buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      lines.forEach(processLine);
    });
    stream.on('end', () => {
      if (buffer) processLine(buffer);
      if (errorObj) {
        const error = new Error(errorObj.error && errorObj.error.message ? errorObj.error.message : 'ChatMock response failed.');
        error.response = { status: 502, data: errorObj };
        reject(error);
        return;
      }
      if (outputText.trim()) {
        resolve({ output_text: outputText.trim(), ...(responseObj || {}) });
        return;
      }
      resolve(responseObj || {});
    });
    stream.on('error', reject);
  });
}

function chatMockInputItems(messages) {
  return messages.filter((message) => (message.role || 'user') !== 'system').map((message) => ({
    type: 'message',
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: [{ type: message.role === 'assistant' ? 'output_text' : 'input_text', text: String(message.content || '') }]
  }));
}

function chatMockInstructions(messages) {
  return messages
    .filter((message) => message.role === 'system')
    .map((message) => String(message.content || '').trim())
    .filter(Boolean)
    .join('\n\n');
}

function chatMockModelCandidates(model) {
  const wanted = String(model || '').trim();
  return [wanted, ...(OPENAI_CHATMOCK_MODEL_FALLBACKS[wanted] || [])].filter(Boolean);
}

async function callChatMockOpenAiModelOnce(credential, model, messages, requestTimeout) {
  const sessionId = createHash('sha256')
    .update(JSON.stringify(messages).slice(0, 4000))
    .digest('hex')
    .slice(0, 32);
  const instructions = chatMockInstructions(messages) || 'Answer concisely in Korean. Return only the final answer.';
  const payload = {
    model,
    instructions,
    input: chatMockInputItems(messages),
    tools: [],
    tool_choice: 'auto',
    parallel_tool_calls: false,
    store: false,
    stream: true,
    prompt_cache_key: sessionId,
    reasoning: { effort: 'low', summary: 'auto' }
  };
  const response = await axios.post(CHATGPT_RESPONSES_URL, payload, {
    timeout: requestTimeout,
    responseType: 'stream',
    validateStatus: () => true,
    headers: {
      Authorization: `Bearer ${credential.chatMockAccessToken}`,
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'chatgpt-account-id': credential.chatMockAccountId,
      'OpenAI-Beta': 'responses=experimental',
      session_id: sessionId
    }
  });
  if (response.status >= 400) {
    const text = await streamToText(response.data);
    const error = new Error(text || `ChatMock upstream ${response.status}`);
    error.response = { status: response.status, data: text };
    throw error;
  }
  const responseObj = await aggregateSseResponse(response.data);
  return {
    text: extractResponsesText(responseObj).trim(),
    upstreamModel: model
  };
}

async function callChatMockOpenAiModel(credential, model, messages, requestTimeout) {
  let lastError = null;
  for (const candidate of chatMockModelCandidates(model)) {
    try {
      const result = await callChatMockOpenAiModelOnce(credential, candidate, messages, requestTimeout);
      return { ...result, requestedModel: model };
    } catch (error) {
      lastError = error;
      if (modelErrorKind(error) !== 'unsupported') throw error;
    }
  }
  throw lastError || new Error('ChatMock OpenAI model call failed.');
}

function providerName(provider, config) {
  if (provider === 'openai') return 'OpenAI GPT-5.6';
  if (provider === 'zai') return 'GLM 5.1';
  if (provider === 'moonshot') return 'Kimi 2.6';
  return isLmStudio(config.ollamaBase) ? 'LM Studio' : 'Ollama';
}

function providerBase(provider, config) {
  if (provider === 'openai') return OPENAI_API_BASE;
  if (provider === 'zai') return ZAI_API_BASE;
  if (provider === 'moonshot') return MOONSHOT_API_BASE;
  return config.ollamaBase;
}

function looksLikeReasoningText(text) {
  const head = String(text || '').slice(0, 900);
  return /^\s*(here'?s a thinking process|thinking process|analysis|분석 과정|사고 과정)/i.test(head)
    || /analy[sz]e the request/i.test(head);
}

function rawModelErrorDetail(error) {
  const data = error && error.response && error.response.data;
  if (data && typeof data === 'object') {
    const detail = data.error && typeof data.error === 'object' ? data.error.message : data.error;
    return detail || data.message || JSON.stringify(data).slice(0, 500);
  }
  if (typeof data === 'string') {
    return data.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  }
  return error && error.message ? error.message : String(error);
}

function modelErrorKind(error) {
  const status = error && error.response && error.response.status;
  const detail = rawModelErrorDetail(error).toLowerCase();
  if (/not supported|unsupported model|model.*unsupported/.test(detail)) {
    return 'unsupported';
  }
  if ((status === 402 || status === 429)
    && /insufficient|balance|billing|recharge|quota|credit|suspended/.test(detail)) {
    return 'billing';
  }
  if ((status === 401 || status === 403)
    || /invalid api key|unauthorized|forbidden|permission|auth/.test(detail)) {
    return 'auth';
  }
  if (error && error.code === 'ECONNABORTED') return 'timeout';
  return '';
}

function modelErrorMessage(error) {
  const status = error && error.response && error.response.status;
  const detail = rawModelErrorDetail(error);
  const kind = modelErrorKind(error);
  if (kind === 'billing') {
    return '결제/잔액 문제로 LLM 호출이 차단되었습니다. 공급자 콘솔에서 충전 또는 결제 상태를 확인해 주세요.';
  }
  if (kind === 'unsupported') {
    return `현재 구독 인증 경로에서 지원되지 않는 모델입니다. (${detail})`;
  }
  if (error && error.code === 'ECONNABORTED') {
    return `모델 응답 시간이 초과되었습니다. (${detail})`;
  }
  return status ? `LLM ${status}: ${detail}` : detail;
}

async function callModel(config, payload) {
  const selectedModel = parseModelRef(payload.model || config.defaultModel);
  const model = selectedModel.model;
  if (!model) throw new Error('MODEL_REQUIRED');
  const requestedTimeout = Number(payload.chatTimeoutMs || payload.timeoutMs);
  const requestTimeout = Number.isFinite(requestedTimeout) && requestedTimeout > 0
    ? Math.max(1000, Math.min(requestedTimeout, config.timeoutMs))
    : (config.chatTimeoutMs || config.timeoutMs);
  const shouldUseBrain = payload.useBrain === true || payload.useBrain === 'true';
  const terms = shouldUseBrain ? termsFromMessage(payload.message) : [];
  const brain = shouldUseBrain
    ? walkBrain(config.localBrainPath, { limit: 3, snippets: true, snippetChars: 600, terms })
    : { files: [] };
  const maxTokens = Math.min(Number(payload.maxTokens) || 700, 1400);
  const hasExplicitMessages = Array.isArray(payload.messages) && payload.messages.length > 0;
  const directMessages = hasExplicitMessages
    ? payload.messages
    : [{ role: 'user', content: String(payload.message || '') }];
  // When the user opts into brain grounding (single-turn chat only), inject the
  // matched local knowledge as context. Falls back to directMessages below if
  // the grounded call returns empty or errors.
  const messages = (shouldUseBrain && !hasExplicitMessages && brain.files.length)
    ? buildMessages({ message: payload.message, agent: payload.agent, brainFiles: brain.files })
    : directMessages;

  async function completeOnce(nextMessages) {
    if (selectedModel.provider === 'openai') {
      const credential = providerCredential('openai');
      if (!credential.token) {
        const error = new Error('OpenAI 구독 인증이 필요합니다.');
        error.code = 'OPENAI_AUTH_REQUIRED';
        throw error;
      }
      if (credential.authFlow === 'chatmock' && credential.chatMockAccessToken && credential.chatMockAccountId) {
        return callChatMockOpenAiModel(credential, model, nextMessages, requestTimeout);
      }
      const response = await axios.post(`${OPENAI_API_BASE}/responses`, {
        model,
        input: nextMessages.map((message) => ({
          role: message.role || 'user',
          content: String(message.content || '')
        })),
        max_output_tokens: maxTokens,
        reasoning: { effort: 'low' },
        store: false
      }, {
        timeout: requestTimeout,
        headers: {
          Authorization: `Bearer ${credential.token}`,
          'Content-Type': 'application/json'
        }
      });
      return extractResponsesText(response.data).trim();
    }

    if (selectedModel.provider === 'zai') {
      const credential = providerCredential('zai');
      if (!credential.token) {
        const error = new Error('GLM 5.1 / Z.AI API Key가 필요합니다.');
        error.code = 'ZAI_AUTH_REQUIRED';
        throw error;
      }
      const response = await axios.post(`${ZAI_API_BASE}/chat/completions`, {
        model,
        messages: nextMessages,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
        temperature: 1,
        stream: false
      }, {
        timeout: requestTimeout,
        headers: {
          Authorization: `Bearer ${credential.token}`,
          'Accept-Language': 'en-US,en',
          'Content-Type': 'application/json'
        }
      });
      return extractModelText(response.data).trim();
    }

    if (selectedModel.provider === 'moonshot') {
      const credential = providerCredential('moonshot');
      if (!credential.token) {
        const error = new Error('Kimi 2.6 / Moonshot API Key가 필요합니다.');
        error.code = 'MOONSHOT_AUTH_REQUIRED';
        throw error;
      }
      const response = await axios.post(`${MOONSHOT_API_BASE}/chat/completions`, {
        model,
        messages: nextMessages,
        max_tokens: maxTokens,
        thinking: { type: 'disabled' },
        stream: false
      }, {
        timeout: requestTimeout,
        headers: {
          Authorization: `Bearer ${credential.token}`,
          'Content-Type': 'application/json'
        }
      });
      return extractModelText(response.data).trim();
    }

    if (isLmStudio(config.ollamaBase)) {
      const response = await axios.post(`${lmBase(config.ollamaBase)}/v1/chat/completions`, {
        model,
        messages: nextMessages,
        temperature: 0.4,
        max_tokens: maxTokens,
        reasoning: { effort: 'none' },
        stream: false
      }, { timeout: requestTimeout });
      return extractModelText(response.data).trim();
    }

    const response = await axios.post(`${config.ollamaBase}/api/chat`, {
      model,
      messages: nextMessages,
      options: { num_predict: maxTokens },
      stream: false
    }, { timeout: requestTimeout });
    return extractModelText(response.data).trim();
  }

  function normalizeCompletion(value) {
    if (value && typeof value === 'object') {
      return {
        text: String(value.text || ''),
        upstreamModel: value.upstreamModel || '',
        requestedModel: value.requestedModel || ''
      };
    }
    return { text: String(value || ''), upstreamModel: '', requestedModel: '' };
  }

  let completion = { text: '', upstreamModel: '', requestedModel: '' };
  try {
    completion = normalizeCompletion(await completeOnce(messages));
  } catch (error) {
    if (!shouldUseBrain) throw error;
  }
  if (!completion.text && shouldUseBrain) {
    completion = normalizeCompletion(await completeOnce(directMessages));
  }
  return {
    text: completion.text,
    upstreamModel: completion.upstreamModel,
    requestedModel: completion.requestedModel,
    sources: brain.files.slice(0, 3).map((file) => file.path)
  };
}

function buildTaskPrompt(task) {
  return [
    `작업 제목: ${task.title || ''}`,
    task.description ? `상세 설명: ${task.description}` : '',
    `우선순위: ${task.priority || 'normal'}`
  ].filter(Boolean).join('\n');
}

async function runTaskWithModel(config, task) {
  const timeoutMs = taskRunTimeoutMs(config);
  const primary = await callModel(config, {
    agent: task.agent || 'ceo',
    messages: [
      {
        role: 'system',
        content: 'You are a concise Korean task executor. Return only the final answer. Never write reasoning, analysis, or thinking process. If live web data is required and unavailable, say that live lookup is required instead of guessing.'
      },
      { role: 'user', content: `${buildTaskPrompt(task)}\n\n결과:` }
    ],
    message: task.title || '',
    model: config.defaultModel,
    useBrain: false,
    maxTokens: 220,
    chatTimeoutMs: timeoutMs
  });
  if (primary.text && primary.text.trim()) return primary;

  const fallback = await callModel(config, {
    agent: task.agent || 'ceo',
    messages: [{
      role: 'user',
      content:
        `${buildTaskPrompt(task)}\n\n` +
        '위 작업의 최종 답변만 한국어로 작성해 주세요. 추론 과정은 쓰지 마세요. ' +
        '실시간 웹/소셜 데이터 조회가 필요하지만 사용할 수 없다면, "실시간 조회가 필요합니다"라고 명확히 답하세요.'
    }],
    message: task.title || '',
    model: config.defaultModel,
    useBrain: false,
    maxTokens: 220,
    chatTimeoutMs: timeoutMs
  });
  return {
    ...fallback,
    sources: fallback.sources && fallback.sources.length ? fallback.sources : primary.sources
  };
}

async function testLlmConnection(config, payload = {}) {
  const effective = {
    ...config,
    ollamaBase: String(payload.ollamaBase || config.ollamaBase).replace(/\/+$/, ''),
    defaultModel: String(payload.model || payload.defaultModel || config.defaultModel || ''),
    chatTimeoutMs: Math.max(1000, Math.min(Number(payload.chatTimeoutMs || 12000), config.timeoutMs))
  };
  const selectedRef = parseModelRef(effective.defaultModel);
  const startedAt = Date.now();
  const result = {
    ok: true,
    connected: false,
    provider: providerName(selectedRef.provider, effective),
    base: providerBase(selectedRef.provider, effective),
    model: '',
    upstreamModel: '',
    models: [],
    latencyMs: 0,
    stages: [],
    authRequired: false,
    authUrl: '',
    billingUrl: selectedRef.provider === 'openai' || selectedRef.provider === 'zai' || selectedRef.provider === 'moonshot'
      ? (providerConfig(selectedRef.provider).billingUrl || '')
      : '',
    flowId: '',
    errorKind: '',
    error: '',
    text: ''
  };

  if (selectedRef.provider === 'openai' || selectedRef.provider === 'zai' || selectedRef.provider === 'moonshot') {
    result.model = selectedRef.model;
    if (!result.model) {
      result.error = `${result.provider} 모델을 선택해 주세요.`;
      result.latencyMs = Date.now() - startedAt;
      result.stages.push({ name: 'model', ok: false, error: result.error });
      return result;
    }

    const credential = providerCredential(selectedRef.provider);
    if (!credential.token) {
      result.authRequired = true;
      result.errorKind = 'auth';
      result.authUrl = selectedRef.provider === 'openai'
        ? 'https://chatgpt.com/#settings/Subscription'
        : providerConfig(selectedRef.provider).keyUrl || providerConfig(selectedRef.provider).accountUrl || '';
      result.error = selectedRef.provider === 'openai'
        ? 'OpenAI 구독 인증이 필요합니다.'
        : selectedRef.provider === 'zai'
          ? 'GLM 5.1 / Z.AI API Key가 필요합니다.'
          : 'Kimi 2.6 / Moonshot API Key가 필요합니다.';
      result.latencyMs = Date.now() - startedAt;
      result.stages.push({ name: 'auth', ok: false, error: result.error });
      return result;
    }

    result.models = [result.model];
    result.stages.push({ name: 'model', ok: true, count: 1 });

    try {
      const chatStarted = Date.now();
      const response = await callModel(effective, {
        model: modelRef(selectedRef.provider, result.model),
        message: '한국어로 안녕이라고만 답해',
        useBrain: false,
        maxTokens: 64,
        chatTimeoutMs: effective.chatTimeoutMs
      });
      result.text = response.text;
      result.upstreamModel = response.upstreamModel || '';
      result.connected = Boolean(response.text);
      result.error = result.connected ? '' : '모델이 빈 응답을 반환했습니다.';
      if (result.upstreamModel && result.upstreamModel !== result.model) {
        result.stages.push({ name: 'chatmock-model', ok: true, requested: result.model, upstream: result.upstreamModel });
      }
      result.stages.push({ name: 'chat', ok: result.connected, latencyMs: Date.now() - chatStarted, error: result.error });
    } catch (error) {
      result.errorKind = modelErrorKind(error);
      result.error = modelErrorMessage(error);
      result.stages.push({ name: 'chat', ok: false, error: result.error });
    }

    result.latencyMs = Date.now() - startedAt;
    return result;
  }

  try {
    const listStarted = Date.now();
    result.models = await listLocalModels(effective);
    result.stages.push({ name: 'models', ok: true, latencyMs: Date.now() - listStarted, count: result.models.length });
  } catch (error) {
    result.error = modelErrorMessage(error);
    result.latencyMs = Date.now() - startedAt;
    result.stages.push({ name: 'models', ok: false, error: result.error });
    return result;
  }

  const selectedModel = firstChatModel(result.models, effective.defaultModel);
  result.model = selectedModel;
  if (!selectedModel) {
    result.error = '채팅 가능한 모델이 없습니다. LM Studio에서 chat 모델을 로드해 주세요.';
    result.latencyMs = Date.now() - startedAt;
    result.stages.push({ name: 'chat', ok: false, error: result.error });
    return result;
  }
  if (!result.models.includes(selectedModel)) {
    result.stages.push({ name: 'model-match', ok: false, error: `"${selectedModel}" 모델이 목록에 없습니다.` });
  }
  if (isEmbeddingModel(selectedModel)) {
    result.error = `"${selectedModel}"은 embedding 모델이라 채팅 테스트에 사용할 수 없습니다.`;
    result.latencyMs = Date.now() - startedAt;
    result.stages.push({ name: 'chat', ok: false, error: result.error });
    return result;
  }

  try {
    const chatStarted = Date.now();
    const response = await callModel(effective, {
      model: selectedModel,
      message: '한국어로 안녕이라고만 답해',
      useBrain: false,
      maxTokens: 64,
      chatTimeoutMs: effective.chatTimeoutMs
    });
    result.text = response.text;
    result.connected = Boolean(response.text);
    result.error = result.connected ? '' : '모델이 빈 응답을 반환했습니다.';
    result.stages.push({ name: 'chat', ok: result.connected, latencyMs: Date.now() - chatStarted, error: result.error });
  } catch (error) {
    result.errorKind = modelErrorKind(error);
    result.error = modelErrorMessage(error);
    result.stages.push({ name: 'chat', ok: false, error: result.error });
  }

  result.latencyMs = Date.now() - startedAt;
  return result;
}

function getAgent(state, id) {
  const base = AGENTS.find((agent) => agent.id === id) || AGENTS[0];
  const active = state.agentState[id] || {};
  return {
    ...base,
    active: active.active !== false,
    goal: active.goal || '',
    lastUpdatedAt: active.updatedAt || ''
  };
}

function taskProgress(task) {
  const status = task.status || 'open';
  const created = new Date(task.createdAt || task.updatedAt || Date.now()).getTime();
  const ageMinutes = Number.isFinite(created) ? Math.max(0, (Date.now() - created) / 60000) : 0;
  const priorityBoost = { urgent: 18, high: 10, normal: 4, low: 0 }[task.priority] || 0;
  const seed = String(task.id || task.title || '').split('').reduce((sum, char) => sum + char.charCodeAt(0), 0) % 9;
  let percent = Math.min(92, Math.round(14 + priorityBoost + seed + ageMinutes * 2.4));
  if (status === 'running') percent = Math.max(percent, 64);
  if (status === 'done') percent = 100;
  if (status === 'cancelled') percent = 0;
  if (status === 'failed') percent = 100;

  const phase = percent >= 100 ? 'done'
    : percent >= 74 ? 'review'
      : percent >= 38 ? 'working'
        : percent >= 16 ? 'assigned'
          : 'queued';
  const labels = {
    queued: '대기',
    assigned: '배정됨',
    working: '진행 중',
    review: '검토 중',
    done: '완료',
    cancelled: '취소',
    failed: '오류'
  };
  const activePhase = ['cancelled', 'failed'].includes(status) ? status : phase;
  const terminal = ['done', 'cancelled', 'failed'].includes(status);
  const timeline = [
    { key: 'queued', label: '요청 접수', done: percent >= 1 || status !== 'open', current: activePhase === 'queued' },
    { key: 'assigned', label: '에이전트 배정', done: percent >= 16 || status === 'done', current: activePhase === 'assigned' },
    { key: 'working', label: '자료 확인 및 작업', done: percent >= 38 || status === 'done', current: activePhase === 'working' },
    { key: 'review', label: '결과 정리', done: percent >= 74 || status === 'done', current: activePhase === 'review' },
    { key: 'done', label: status === 'cancelled' ? '취소됨' : status === 'failed' ? '오류' : '완료', done: terminal, current: activePhase === 'done' || activePhase === 'cancelled' || activePhase === 'failed' }
  ];
  const activity = status === 'done'
    ? '결과가 완료 처리되었습니다.'
    : status === 'cancelled'
      ? '작업이 취소되었습니다.'
      : status === 'failed'
        ? `작업 실행 중 오류가 발생했습니다.${task.error ? ` ${task.error}` : ''}`
        : status === 'running'
          ? 'LLM이 작업을 실행하고 있습니다.'
          : activePhase === 'review'
            ? '결과 생성 대기 · LLM 실행 또는 완료 체크가 필요합니다.'
            : `${labels[activePhase] || '진행 중'} · 에이전트가 요청을 처리하고 있습니다.`;
  return {
    percent,
    phase: activePhase,
    label: labels[activePhase] || labels.working,
    updatedAt: task.updatedAt || task.createdAt || '',
    startedAt: task.startedAt || task.createdAt || '',
    timeline,
    activity,
    mode: 'local-progress'
  };
}

function enrichTask(task) {
  const safeTask = {
    ...task,
    title: cleanText(task.title, 500),
    description: cleanText(task.description, 1000),
    result: cleanText(task.result, 12000),
    error: cleanText(task.error, 1200)
  };
  return {
    ...safeTask,
    progress: taskProgress(safeTask)
  };
}

function listTasks(state, config) {
  const external = externalTrackerTasks(config);
  const known = new Set(state.tasks.map((task) => task.id));
  return [
    ...state.tasks.map((task) => ({ ...task, source: task.source || 'web' })),
    ...external.filter((task) => !known.has(task.id))
  ].map(enrichTask).sort((a, b) => {
    const order = { urgent: 0, high: 1, normal: 2, low: 3 };
    const pa = order[a.priority] ?? 2;
    const pb = order[b.priority] ?? 2;
    if (pa !== pb) return pa - pb;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });
}

function listApprovals(state, config) {
  const external = externalApprovals(config);
  const known = new Set(state.approvals.map((approval) => approval.id));
  return [
    ...state.approvals.map((approval) => ({ ...approval, source: approval.source || 'web' })),
    ...external.filter((approval) => !known.has(approval.id))
  ].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

function recoverStaleRunningTasks(state, config) {
  const staleAfterMs = taskRunTimeoutMs(config) + 30000;
  const now = Date.now();
  let changed = false;
  state.tasks.forEach((task) => {
    if (task.status !== 'running') return;
    const lastUpdate = new Date(task.updatedAt || task.startedAt || task.createdAt || 0).getTime();
    if (!Number.isFinite(lastUpdate) || now - lastUpdate < staleAfterMs) return;
    task.status = 'failed';
    task.error = '작업 실행이 완료 신호 없이 멈췄습니다. 서버 재시작, 요청 중단, 클라이언트 타임아웃, 또는 모델 타임아웃 이후 상태가 running으로 남아 있었습니다.';
    task.failedAt = nowIso();
    task.updatedAt = task.failedAt;
    task.staleRecoveredAt = task.failedAt;
    pushEvent(state, 'task.failed', `멈춘 작업 자동 복구: ${task.title}`, { agent: task.agent });
    changed = true;
  });
  return changed;
}

function buildDashboard(config) {
  const state = loadState();
  if (recoverStaleRunningTasks(state, config)) saveState(state);
  const brain = walkBrain(config.localBrainPath, { limit: 500 });
  const tasks = listTasks(state, config);
  const approvals = listApprovals(state, config);
  const openTasks = tasks.filter((task) => isActiveTaskStatus(task.status));
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');
  const companyState = readCompanyState(config);
  const activeAgents = readActiveAgents(config);
  const agents = AGENTS.map((agent) => {
    const local = getAgent(state, agent.id);
    const activeFlag = activeAgents[agent.id];
    const active = typeof activeFlag === 'boolean' ? activeFlag : local.active;
    return {
      ...local,
      active,
      openTasks: openTasks.filter((task) => task.agent === agent.id || (Array.isArray(task.agentIds) && task.agentIds.includes(agent.id))).length
    };
  });
  return {
    ok: true,
    mode: 'standalone-web',
    version: require(path.join(ROOT, 'package.json')).version,
    company: companyState.name || companyState.companyName || 'Connect AI Company',
    config,
    brain: { fileCount: brain.files.length, capped: brain.capped, path: config.localBrainPath },
    agents,
    tasks: {
      open: openTasks.length,
      urgent: openTasks.filter((task) => task.priority === 'urgent').length,
      top: openTasks.slice(0, 8),
      all: tasks
    },
    approvals: {
      pending: pendingApprovals.length,
      all: approvals
    },
    sessions: state.sessions.slice(0, 10).map((session) => ({
      id: session.id,
      title: session.title,
      agent: session.agent,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: Array.isArray(session.messages) ? session.messages.length : 0
    })),
    events: state.events.slice(0, 14).map((event) => ({
      ...event,
      title: cleanText(event.title, 240)
    }))
  };
}

function routeParam(pathname, prefix) {
  if (!pathname.startsWith(prefix)) return '';
  return decodeURIComponent(pathname.slice(prefix.length).replace(/^\/+/, ''));
}

async function handleTasks(req, res, pathname, config) {
  const state = loadState();
  if (req.method === 'GET' && pathname === '/api/tasks') {
    sendJson(res, 200, { ok: true, tasks: listTasks(state, config) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/tasks') {
    const body = await readJsonBody(req);
    const title = cleanText(body.title, 500);
    if (!title) {
      sendJson(res, 400, { ok: false, error: 'TITLE_REQUIRED' });
      return true;
    }
    const agent = AGENTS.some((item) => item.id === body.agent) ? body.agent : 'ceo';
    const task = {
      id: newId('task'),
      title,
      description: cleanText(body.description, 1000),
      agent,
      agentIds: [agent],
      priority: ['urgent', 'high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal',
      status: 'open',
      dueAt: cleanText(body.dueAt, 80),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: 'web'
    };
    state.tasks.unshift(task);
    pushEvent(state, 'task.created', `${getAgent(state, agent).name}에게 작업 등록: ${title}`, { agent });
    saveState(state);
    sendJson(res, 201, { ok: true, task: enrichTask(task) });
    return true;
  }

  const runMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/run$/);
  if (runMatch && req.method === 'POST') {
    const id = decodeURIComponent(runMatch[1]);
    const task = state.tasks.find((item) => item.id === id);
    if (!task) {
      sendJson(res, 404, { ok: false, error: 'TASK_NOT_FOUND' });
      return true;
    }
    if (task.source === 'company') {
      sendJson(res, 400, { ok: false, error: 'COMPANY_TASK_READ_ONLY' });
      return true;
    }

    task.status = 'running';
    task.startedAt = nowIso();
    task.updatedAt = task.startedAt;
    delete task.error;
    delete task.result;
    delete task.sources;
    delete task.failedAt;
    delete task.staleRecoveredAt;
    pushEvent(state, 'task.running', `작업 실행 시작: ${task.title}`, { agent: task.agent });
    saveState(state);

    try {
      const result = await runTaskWithModel(config, task);
      const latest = loadState();
      const latestTask = latest.tasks.find((item) => item.id === id);
      if (!latestTask) {
        sendJson(res, 404, { ok: false, error: 'TASK_NOT_FOUND' });
        return true;
      }
      if (latestTask.status === 'cancelled') {
        sendJson(res, 200, { ok: true, task: enrichTask(latestTask) });
        return true;
      }
      const text = cleanText(result.text, 12000);
      if (!text) throw new Error('모델이 빈 응답을 반환했습니다.');
      if (looksLikeReasoningText(text)) {
        throw new Error('모델이 최종 답변 대신 추론 과정을 반환했습니다. reasoning 비활성 옵션이나 모델 설정을 확인해 주세요.');
      }
      latestTask.status = 'done';
      latestTask.result = text;
      latestTask.sources = Array.isArray(result.sources) ? result.sources : [];
      latestTask.completedAt = nowIso();
      latestTask.updatedAt = latestTask.completedAt;
      delete latestTask.error;
      pushEvent(latest, 'task.completed', `작업 완료: ${latestTask.title}`, { agent: latestTask.agent });
      saveState(latest);
      sendJson(res, 200, { ok: true, task: enrichTask(latestTask) });
    } catch (error) {
      const latest = loadState();
      const latestTask = latest.tasks.find((item) => item.id === id);
      if (latestTask) {
        latestTask.status = 'failed';
        latestTask.error = modelErrorMessage(error);
        latestTask.failedAt = nowIso();
        latestTask.updatedAt = latestTask.failedAt;
        delete latestTask.result;
        delete latestTask.sources;
        pushEvent(latest, 'task.failed', `작업 실패: ${latestTask.error}`, { agent: latestTask.agent });
        saveState(latest);
      }
      sendJson(res, 502, { ok: false, error: modelErrorMessage(error), task: latestTask ? enrichTask(latestTask) : undefined });
    }
    return true;
  }

  const exportMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/export$/);
  if (exportMatch && req.method === 'POST') {
    const id = decodeURIComponent(exportMatch[1]);
    const body = await readJsonBody(req);
    const target = ['all', 'pdf', 'obsidian'].includes(body.target) ? body.target : 'all';
    const listedTask = listTasks(state, config).find((item) => item.id === id);
    if (!listedTask) {
      sendJson(res, 404, { ok: false, error: 'TASK_NOT_FOUND' });
      return true;
    }
    if (!listedTask.result && !listedTask.error && !listedTask.description) {
      sendJson(res, 400, { ok: false, error: 'RESULT_NOT_AVAILABLE' });
      return true;
    }
    try {
      const exportInfo = writeTaskExport(listedTask, config, target);
      const localTask = state.tasks.find((item) => item.id === id);
      if (localTask) {
        localTask.exports = {
          ...(localTask.exports || {}),
          markdownPath: exportInfo.markdownPath || (localTask.exports && localTask.exports.markdownPath) || '',
          pdfPath: exportInfo.pdfPath || (localTask.exports && localTask.exports.pdfPath) || '',
          vaultPath: exportInfo.vaultPath,
          exportDir: exportInfo.exportDir,
          exportedAt: nowIso()
        };
        localTask.updatedAt = nowIso();
        pushEvent(state, 'task.exported', `결과 저장: ${localTask.title}`, { agent: localTask.agent });
        saveState(state);
      } else {
        pushEvent(state, 'task.exported', `회사 작업 결과 저장: ${listedTask.title}`, { agent: listedTask.agent });
        saveState(state);
      }
      sendJson(res, 200, { ok: true, target, export: exportInfo, task: localTask ? enrichTask(localTask) : listedTask });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message || String(error) });
    }
    return true;
  }

  const id = routeParam(pathname, '/api/tasks/');
  if (id && req.method === 'GET') {
    const task = listTasks(state, config).find((item) => item.id === id);
    sendJson(res, task ? 200 : 404, task ? { ok: true, task } : { ok: false, error: 'TASK_NOT_FOUND' });
    return true;
  }

  if (id && req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const task = state.tasks.find((item) => item.id === id);
    if (!task) {
      sendJson(res, 404, { ok: false, error: 'TASK_NOT_FOUND' });
      return true;
    }
    if (body.status && ['open', 'running', 'done', 'cancelled', 'failed'].includes(body.status)) {
      task.status = body.status;
      if (body.status === 'done') task.completedAt = nowIso();
      if (body.status === 'cancelled') task.cancelledAt = nowIso();
      if (body.status === 'open') {
        delete task.error;
        delete task.failedAt;
      }
    }
    if (body.priority && ['urgent', 'high', 'normal', 'low'].includes(body.priority)) task.priority = body.priority;
    if (body.title !== undefined) task.title = cleanText(body.title, 500) || task.title;
    if (body.result !== undefined) task.result = cleanText(body.result, 12000);
    if (body.error !== undefined) task.error = cleanText(body.error, 1200);
    if (body.agent && AGENTS.some((item) => item.id === body.agent)) {
      task.agent = body.agent;
      task.agentIds = [body.agent];
    }
    task.updatedAt = nowIso();
    pushEvent(state, 'task.updated', `작업 업데이트: ${task.title}`, { agent: task.agent });
    saveState(state);
    sendJson(res, 200, { ok: true, task: enrichTask(task) });
    return true;
  }

  return false;
}

async function handleApprovals(req, res, pathname, config) {
  const state = loadState();
  if (req.method === 'GET' && pathname === '/api/approvals') {
    sendJson(res, 200, { ok: true, approvals: listApprovals(state, config) });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/approvals') {
    const body = await readJsonBody(req);
    const title = cleanText(body.title, 500);
    if (!title) {
      sendJson(res, 400, { ok: false, error: 'TITLE_REQUIRED' });
      return true;
    }
    const agent = AGENTS.some((item) => item.id === body.agent) ? body.agent : 'ceo';
    const approval = {
      id: newId('apr'),
      title,
      summary: cleanText(body.summary, 1200),
      kind: cleanText(body.kind, 80) || 'general',
      agent,
      status: 'pending',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: 'web'
    };
    state.approvals.unshift(approval);
    pushEvent(state, 'approval.created', `승인 대기 등록: ${title}`, { agent });
    saveState(state);
    sendJson(res, 201, { ok: true, approval });
    return true;
  }

  const id = routeParam(pathname, '/api/approvals/');
  if (id && req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const nextStatus = ['approved', 'rejected', 'pending'].includes(body.status) ? body.status : '';
    if (!nextStatus) {
      sendJson(res, 400, { ok: false, error: 'STATUS_REQUIRED' });
      return true;
    }
    const approval = state.approvals.find((item) => item.id === id);
    if (approval) {
      approval.status = nextStatus;
      approval.updatedAt = nowIso();
      approval.resolvedAt = nextStatus === 'pending' ? '' : nowIso();
      pushEvent(state, `approval.${nextStatus}`, `승인 상태 변경: ${approval.title}`, { agent: approval.agent });
      saveState(state);
      sendJson(res, 200, { ok: true, approval });
      return true;
    }
    if (moveExternalApproval(config, id, nextStatus)) {
      pushEvent(state, `approval.${nextStatus}`, `회사 승인 파일 처리: ${id}`);
      saveState(state);
      sendJson(res, 200, { ok: true, approval: { id, status: nextStatus, source: 'company' } });
      return true;
    }
    sendJson(res, 404, { ok: false, error: 'APPROVAL_NOT_FOUND' });
    return true;
  }

  return false;
}

async function handleSessions(req, res, pathname) {
  const state = loadState();
  if (req.method === 'GET' && pathname === '/api/sessions') {
    sendJson(res, 200, { ok: true, sessions: state.sessions });
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/sessions') {
    const body = await readJsonBody(req);
    const agent = AGENTS.some((item) => item.id === body.agent) ? body.agent : 'ceo';
    const session = {
      id: newId('ses'),
      title: cleanText(body.title, 100) || '새 대화',
      agent,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messages: []
    };
    state.sessions.unshift(session);
    pushEvent(state, 'session.created', `새 대화 시작: ${session.title}`, { agent });
    saveState(state);
    sendJson(res, 201, { ok: true, session });
    return true;
  }

  const id = routeParam(pathname, '/api/sessions/');
  if (id && req.method === 'GET') {
    const session = state.sessions.find((item) => item.id === id);
    sendJson(res, session ? 200 : 404, session ? { ok: true, session } : { ok: false, error: 'SESSION_NOT_FOUND' });
    return true;
  }

  if (id && req.method === 'DELETE') {
    const before = state.sessions.length;
    state.sessions = state.sessions.filter((item) => item.id !== id);
    if (state.sessions.length === before) {
      sendJson(res, 404, { ok: false, error: 'SESSION_NOT_FOUND' });
      return true;
    }
    pushEvent(state, 'session.deleted', `대화 삭제: ${id}`);
    saveState(state);
    sendJson(res, 200, { ok: true });
    return true;
  }

  return false;
}

async function handleAgents(req, res, pathname) {
  const state = loadState();
  const id = routeParam(pathname, '/api/agents/');
  if (!id || !AGENTS.some((item) => item.id === id)) return false;

  if (req.method === 'PATCH') {
    const body = await readJsonBody(req);
    const current = state.agentState[id] || {};
    state.agentState[id] = {
      ...current,
      active: body.active === undefined ? current.active : body.active !== false,
      goal: body.goal === undefined ? current.goal || '' : cleanText(body.goal, 500),
      updatedAt: nowIso()
    };
    pushEvent(state, 'agent.updated', `${getAgent(state, id).name} 상태 업데이트`, { agent: id });
    saveState(state);
    sendJson(res, 200, { ok: true, agent: getAgent(state, id) });
    return true;
  }

  return false;
}

async function handleApi(req, res, pathname, url) {
  const config = getConfig();

  if (await handleTasks(req, res, pathname, config)) return;
  if (await handleApprovals(req, res, pathname, config)) return;
  if (await handleSessions(req, res, pathname)) return;
  if (await handleAgents(req, res, pathname)) return;

  if (req.method === 'GET' && pathname === '/api/status') {
    const dashboard = buildDashboard(config);
    sendJson(res, 200, {
      ok: true,
      mode: dashboard.mode,
      version: dashboard.version,
      config,
      brain: dashboard.brain,
      agents: dashboard.agents
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/dashboard') {
    sendJson(res, 200, buildDashboard(config));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/llm/providers') {
    sendJson(res, 200, { ok: true, providers: getProviderSummaries() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/llm/credentials') {
    try {
      const body = await readJsonBody(req);
      const provider = cleanText(body.provider, 40);
      const apiKey = cleanSecret(body.apiKey, 3000);
      const meta = providerConfig(provider);
      if (!meta) {
        sendJson(res, 400, { ok: false, error: 'PROVIDER_NOT_FOUND' });
        return;
      }
      if (!apiKey) {
        sendJson(res, 400, { ok: false, error: 'API_KEY_REQUIRED' });
        return;
      }
      if (!providerApiKeyLooksValid(provider, apiKey)) {
        sendJson(res, 400, { ok: false, error: 'API_KEY_INVALID' });
        return;
      }
      const credentials = readLlmCredentials();
      credentials[provider] = {
        ...(credentials[provider] || {}),
        apiKey,
        method: 'apiKey',
        savedAt: nowIso()
      };
      writeLlmCredentials(credentials);
      sendJson(res, 200, { ok: true, provider: getProviderSummaries().find((item) => item.id === provider) });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  if (req.method === 'DELETE' && pathname.startsWith('/api/llm/credentials/')) {
    const provider = decodeURIComponent(pathname.slice('/api/llm/credentials/'.length));
    const meta = providerConfig(provider);
    if (!meta) {
      sendJson(res, 404, { ok: false, error: 'PROVIDER_NOT_FOUND' });
      return;
    }
    const credentials = readLlmCredentials();
    delete credentials[provider];
    writeLlmCredentials(credentials);
    sendJson(res, 200, { ok: true, provider: getProviderSummaries().find((item) => item.id === provider) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/llm/oauth/start') {
    try {
      const body = await readJsonBody(req);
      const provider = cleanText(body.provider, 40);
      const result = createOAuthFlow(req, provider);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/llm/account/start') {
    try {
      const body = await readJsonBody(req);
      const provider = cleanText(body.provider, 40);
      const result = createAccountAuthFlow(provider);
      sendJson(res, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/llm/oauth/status') {
    const provider = cleanText(url.searchParams.get('provider') || '', 40);
    const flowId = url.searchParams.get('flowId') || '';
    const flow = flowId ? oauthFlows.get(flowId) : null;
    const summary = getProviderSummaries().find((item) => item.id === provider) || null;
    sendJson(res, 200, {
      ok: true,
      provider: summary,
      flow: flow ? {
        id: flowId,
        status: flow.status,
        error: flow.error || ''
      } : null
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/models') {
    try {
      const result = await listModelOptions(config);
      sendJson(res, 200, {
        ok: true,
        models: result.models,
        errors: result.errors,
        defaultModel: config.defaultModel,
        auth: getAuthStatus()
      });
    } catch (error) {
      sendJson(res, 502, {
        ok: false,
        error: error.message || String(error),
        models: [],
        defaultModel: config.defaultModel,
        auth: getAuthStatus()
      });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/llm/test') {
    const state = loadState();
    try {
      const body = await readJsonBody(req);
      const result = await testLlmConnection(config, body);
      pushEvent(
        state,
        result.connected ? 'llm.test.ok' : 'llm.test.failed',
        result.connected ? `LLM 연결 성공: ${result.model}` : `LLM 연결 실패: ${result.error || result.model}`,
        { agent: 'ceo' }
      );
      saveState(state);
      sendJson(res, 200, result);
    } catch (error) {
      const message = modelErrorMessage(error);
      pushEvent(state, 'llm.test.failed', message, { agent: 'ceo' });
      saveState(state);
      sendJson(res, 200, { ok: true, connected: false, error: message, stages: [] });
    }
    return;
  }

  if (req.method === 'GET' && pathname === '/api/brain') {
    const brain = walkBrain(config.localBrainPath, { limit: 80 });
    sendJson(res, 200, { ok: true, files: brain.files, capped: brain.capped, path: config.localBrainPath });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/brain/search') {
    const query = cleanText(url.searchParams.get('q') || '', 200);
    const terms = termsFromMessage(query);
    const brain = walkBrain(config.localBrainPath, { limit: 50, snippets: true, snippetChars: 800, terms });
    sendJson(res, 200, { ok: true, query, files: brain.files, capped: brain.capped, path: config.localBrainPath });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/brain/file') {
    const requested = url.searchParams.get('path') || '';
    const file = safeJoin(config.localBrainPath, requested);
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      sendJson(res, 404, { ok: false, error: 'FILE_NOT_FOUND' });
      return;
    }
    const text = fs.readFileSync(file, 'utf8').slice(0, 16000);
    sendJson(res, 200, { ok: true, path: path.relative(config.localBrainPath, file), text });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/config') {
    sendJson(res, 200, { ok: true, config });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    try {
      const body = await readJsonBody(req);
      const next = {
        ollamaBase: body.ollamaBase || config.ollamaBase,
        defaultModel: body.defaultModel || config.defaultModel,
        localBrainPath: expandHome(body.localBrainPath || config.localBrainPath),
        obsidianVaultPath: resolveObsidianVaultPath(body.obsidianVaultPath || config.obsidianVaultPath, body.localBrainPath || config.localBrainPath),
        timeoutMs: Number(body.timeoutMs || config.timeoutMs),
        chatTimeoutMs: Number(body.chatTimeoutMs || config.chatTimeoutMs)
      };
      writeJson(LOCAL_CONFIG, next);
      brainCache.clear();
      sendJson(res, 200, { ok: true, config: getConfig() });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/open-path') {
    try {
      const body = await readJsonBody(req);
      const opened = await openResultPath(config, body.path, body.action);
      sendJson(res, 200, { ok: true, ...opened });
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || String(error) });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    const state = loadState();
    let session = null;
    let agent = 'ceo';
    try {
      const body = await readJsonBody(req);
      const message = cleanText(body.message, 8000);
      if (!message) {
        sendJson(res, 400, { ok: false, error: 'MESSAGE_REQUIRED' });
        return;
      }
      agent = AGENTS.some((item) => item.id === body.agent) ? body.agent : 'ceo';
      session = body.sessionId ? state.sessions.find((item) => item.id === body.sessionId) : null;
      if (!session) {
        session = {
          id: newId('ses'),
          title: message.slice(0, 40) || '새 대화',
          agent,
          createdAt: nowIso(),
          updatedAt: nowIso(),
          messages: []
        };
        state.sessions.unshift(session);
      }
      session.agent = agent;
      session.messages.push({ id: newId('msg'), role: 'user', agent, content: message, createdAt: nowIso() });

      const result = await callModel(config, { ...body, message, agent });
      const text = result.text || '모델이 빈 응답을 반환했습니다. 모델 설정이나 컨텍스트 길이를 확인해 주세요.';
      session.messages.push({ id: newId('msg'), role: 'assistant', agent, content: text, sources: result.sources, createdAt: nowIso() });
      session.updatedAt = nowIso();
      pushEvent(state, 'chat.completed', `${getAgent(state, agent).name} 응답 완료`, { agent });
      saveState(state);
      sendJson(res, 200, { ok: true, sessionId: session.id, text, sources: result.sources });
    } catch (error) {
      const errorText = modelErrorMessage(error);
      if (session) {
        session.messages.push({ id: newId('msg'), role: 'assistant', agent, content: errorText, error: true, createdAt: nowIso() });
        session.updatedAt = nowIso();
      }
      pushEvent(state, 'chat.failed', errorText.slice(0, 220), { agent });
      saveState(state);
      const code = error && error.message === 'MODEL_REQUIRED' ? 400 : 502;
      sendJson(res, code, { ok: false, sessionId: session ? session.id : '', error: errorText });
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
    if (url.pathname.startsWith('/oauth/') && url.pathname.endsWith('/callback')) {
      await handleOAuthCallback(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url.pathname, url);
      return;
    }
    if (url.pathname.startsWith('/assets/')) {
      serveFile(res, safeJoin(ASSETS_DIR, url.pathname.replace(/^\/assets\//, '')));
      return;
    }
    const file = url.pathname === '/'
      ? path.join(WEB_DIR, 'index.html')
      : url.pathname === '/completed'
        ? path.join(WEB_DIR, 'completed.html')
        : safeJoin(WEB_DIR, url.pathname);
    serveFile(res, file);
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || String(error) });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Connect AI web app running at http://127.0.0.1:${PORT}`);
});
