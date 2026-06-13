#!/usr/bin/env node
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const net = require('net');
const dns = require('dns');
const dnsPromises = dns.promises;
const { execFile } = require('child_process');
const { createHash, randomBytes, randomUUID } = require('crypto');
const axios = require('axios');

const ROOT = path.resolve(__dirname, '../../../../');
const WEB_DIR = path.join(ROOT, 'web');
const ASSETS_DIR = path.join(ROOT, 'assets');
const DATA_DIR = path.join(ROOT, 'web-next', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const LLM_CREDENTIALS_FILE = path.join(DATA_DIR, 'llm-credentials.local.json');
const LOCAL_CONFIG = path.join(ROOT, 'web-next', 'config.local.json');
const DEFAULT_OBSIDIAN_VAULTS = [
  path.join(os.homedir(), 'Documents', 'Obsidian Vault'),
  path.join(os.homedir(), 'Documents', 'AIS', 'AIS'),
  path.join(os.homedir(), 'Documents', 'zettel-connect-starter')
];
const PORT = Number(process.env.CONNECT_AI_WEB_PORT || process.env.PORT || 8788);
const MAX_BODY = 2 * 1024 * 1024;
const BRAIN_CACHE_TTL_MS = 10 * 1000;
const MAX_TASK_RUN_TIMEOUT_MS = 60000;
const RESEARCH_TIMEOUT_MS = Math.max(1000, Math.min(Number(process.env.CONNECT_AI_RESEARCH_TIMEOUT_MS) || 12000, 30000));
const RESEARCH_USER_AGENT = 'ConnectAIResearch/1.0 (+https://github.com/wonseokjung/connect-ai)';
const OPENAI_API_BASE = 'https://api.openai.com/v1';
const ZAI_API_BASE = process.env.ZAI_API_BASE || 'https://api.z.ai/api/coding/paas/v4';
const MOONSHOT_API_BASE = process.env.MOONSHOT_API_BASE || 'https://api.moonshot.ai/v1';
const XAI_API_BASE = process.env.XAI_API_BASE || 'https://api.x.ai/v1';
const GROK_PROXY_BASE = String(process.env.CONNECT_AI_GROK_PROXY_URL || 'http://127.0.0.1:8317/v1').replace(/\/+$/, '');
const GROK_PROXY_MODEL = String(process.env.CONNECT_AI_GROK_PROXY_MODEL || 'grok-4.3').trim();
const GROK_PROXY = {
  id: 'cliproxyapi',
  name: 'Grok OAuth Proxy',
  base: GROK_PROXY_BASE,
  model: GROK_PROXY_MODEL,
  installCommand: 'brew install cliproxyapi',
  loginCommand: 'cliproxyapi --xai-login',
  serviceCommand: 'brew services start cliproxyapi',
  docsUrl: 'https://help.router-for.me/configuration/provider/xai',
  repoUrl: 'https://github.com/router-for-me/CLIProxyAPI'
};
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
    hidden: true,
    apiKeyEnv: 'MOONSHOT_API_KEY',
    accountUrl: 'https://platform.kimi.ai/console/api-keys',
    keyUrl: 'https://platform.kimi.ai/console/api-keys',
    billingUrl: 'https://platform.kimi.ai/console/billing',
    docsUrl: 'https://platform.kimi.ai/docs/guide/kimi-k2-6-quickstart',
    accountAuthMessage: 'Kimi 2.6은 Moonshot/Kimi API Key로 연결됩니다. API Key 페이지에서 키 상태를 확인해 주세요.'
  },
  xai: {
    id: 'xai',
    name: 'Grok 4.3',
    hidden: true,
    apiKeyEnv: 'XAI_API_KEY',
    accountUrl: 'https://console.x.ai/team/default/api-keys',
    keyUrl: 'https://console.x.ai/team/default/api-keys',
    billingUrl: 'https://console.x.ai/',
    docsUrl: 'https://docs.x.ai/docs/api-reference#chat-completions',
    accountAuthMessage: 'X Premium 구독과 xAI API는 별개입니다. xAI 콘솔에서 xai-로 시작하는 API Key를 발급해 연결해 주세요.'
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
  },
  {
    id: 'xai:grok-4.3',
    provider: 'xai',
    model: 'grok-4.3',
    label: 'Grok 4.3 · xAI API (grok-4.3)',
    paid: true,
    contextLength: 1000000
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
    role: '마케팅 팀장 · 총괄 오케스트레이터',
    emoji: '🧭',
    accent: '#f8fafc',
    avatar: resolveAgentImage('anna_ceo.jpeg'),
    specialty: '전문 에이전트 라우팅, 요구사항 분해, 승인 게이트, 결과 취합, 리스크 기반 우선순위',
    tagline: '사업, 카피, SEO, 마케팅, 법무, 고객응대, 영업 에이전트를 배정합니다'
  },
  {
    id: 'youtube',
    name: '레오',
    role: 'SEO Consultant · SEO 전문가',
    emoji: '🔎',
    accent: '#ff4444',
    specialty: '키워드 리서치, 콘텐츠 구조, 온페이지 SEO, 테크니컬 SEO, 로컬 SEO, 검색 노출 개선',
    tagline: '키워드와 콘텐츠 구조를 개선해 검색 노출을 높입니다',
    avatar: resolveAgentImage('leo_profile.png')
  },
  {
    id: 'instagram',
    name: 'Instagram',
    role: 'SNS 캡션 에이전트 · SNS 카피라이터',
    emoji: '📷',
    accent: '#e1306c',
    specialty: 'Instagram 훅, 해시태그, LinkedIn 카피, X 280자 카피, Threads 글타래',
    tagline: '채널별 짧은 카피와 SNS 반응 포인트를 만듭니다',
    avatar: ''
  },
  {
    id: 'developer',
    name: '코다리',
    role: '기술 검증 에이전트 · 구현 담당',
    emoji: '💻',
    accent: '#22d3ee',
    specialty: '기술 타당성 검증, 코드 수정, API/OAuth 통합, 로컬 서버 운영, 자동화, 테스트와 화면 확인',
    tagline: 'Annatar 운영에 필요한 구현과 기술 검증을 맡습니다',
    avatar: resolveAgentImage('codari.png')
  },
  {
    id: 'business',
    name: '현빈',
    role: 'Business Advisor · 사업 전략가',
    emoji: '💼',
    accent: '#f5c518',
    specialty: '사업 전략, 포지셔닝, 가격, 목표, 성장 판단, 브랜드와 비즈니스 의사결정',
    tagline: '사업 전략과 성장 판단을 현실적인 실행안으로 정리합니다',
    avatar: resolveAgentImage('hyunbin.jpeg')
  },
  {
    id: 'secretary',
    name: '영숙',
    role: 'Legal Advisor · 법무 보조',
    emoji: '⚖️',
    accent: '#84cc16',
    specialty: '정책, 약관, 계약서, 컴플라이언스, 권리 보호, 전자상거래 정책',
    tagline: '정책, 약관, 계약서 초안을 리스크 중심으로 점검합니다',
    avatar: resolveAgentImage('youngsook_secretary.jpeg')
  },
  {
    id: 'editor',
    name: '루나',
    role: 'Customer Comms · 커뮤니케이션 전문가',
    emoji: '💬',
    accent: '#f472b6',
    specialty: '고객 이메일, 보도자료, 사과문, 리뷰 대응, 클레임 처리, 외부 커뮤니케이션',
    tagline: '고객과 외부 이해관계자 메시지를 차분하게 정리합니다',
    avatar: resolveAgentImage('luna_greeting_pixar.png')
  },
  {
    id: 'designer',
    name: '옥순',
    role: 'Marketing Planner · 마케팅 전략가',
    emoji: '📣',
    accent: '#a78bfa',
    specialty: '캠페인 전략, SNS, 이메일, 광고, 프로모션, 성장 실험, 콘텐츠 캘린더',
    tagline: '캠페인과 광고, SNS, 이메일 실행 계획을 설계합니다',
    avatar: resolveAgentImage('oksun_designer.webp')
  },
  {
    id: 'writer',
    name: 'Jenny',
    role: 'Creative Writer · 콘텐츠/카피라이터',
    emoji: '✍️',
    accent: '#fbbf24',
    specialty: '블로그, 웹사이트 카피, 상품 설명, 브랜드 톤, 랜딩 페이지, 소셜 캡션',
    tagline: '브랜드 톤에 맞는 블로그와 웹사이트 카피를 작성합니다',
    avatar: resolveAgentImage('jenny_writer.webp')
  },
  {
    id: 'researcher',
    name: '정후',
    role: 'Sales & Outreach · 세일즈 전문가',
    emoji: '🤝',
    accent: '#60a5fa',
    specialty: '콜드아웃리치, 제안서, 견적, 영업 대화, 클로징, 리텐션',
    tagline: '아웃리치부터 제안, 견적, 클로징까지 영업 문구를 만듭니다',
    avatar: resolveAgentImage('junghu_researcher.webp')
  }
];

const CONNECT_AI_OPERATING_POLICY = [
  '증거 기반 운영 원칙:',
  '- 결과는 요약, 진행 상황, 리스크/막힌 점, 다음 행동 순서로 정리합니다.',
  '- 사실, 수치, 날짜, 외부 주장에는 출처를 붙이고 출처가 없으면 추정이라고 표시합니다.',
  '- 링크는 접근 가능한 원본 URL만 남기고, 접근이 막히면 대체 출처와 실패 사유를 함께 보고합니다.',
  '- 파일 삭제, 외부 배포, 결제, 대량 전송, API 키 또는 OAuth 변경은 승인 후 실행합니다.',
  '- 작업은 완료, 실패, 막힘, 취소 중 하나로 끝까지 닫고 중간 진행률에서 방치하지 않습니다.',
  '- 사업, 카피, SEO, 마케팅, 법무, 고객응대, 영업 요청은 해당 전문 에이전트와 승인 필요 여부를 함께 표시합니다.'
].join('\n');

const PAPERCLIP_AGENT_MANAGEMENT_SOURCE = {
  repository: 'paperclipai/paperclip',
  url: 'https://github.com/paperclipai/paperclip.git',
  localClone: '/tmp/connect-ai-paperclip-src',
  docs: [
    'docs/api/agents.md',
    'docs/api/costs.md',
    'docs/specs/agent-config-ui.md',
    'doc/plans/2026-03-14-budget-policies-and-enforcement.md'
  ]
};

const AGENT_MANAGER_TABS = [
  { id: 'dashboard', label: '대시보드' },
  { id: 'instructions', label: '지침' },
  { id: 'skills', label: '스킬' },
  { id: 'settings', label: '설정' },
  { id: 'runs', label: '실행기록' },
  { id: 'budget', label: '예산' }
];

const AGENT_SKILL_LIBRARY = {
  business: [
    'Validate my business idea',
    'Define my value proposition',
    'Review my pricing',
    'Set quarterly goals',
    'One-page business plan',
    'Build a customer persona',
    'Craft an elevator pitch',
    'Brainstorm business names',
    'Define my brand voice',
    'Pick a color palette',
    'Design a logo',
    'Analyze my competitors',
    'Weekly priorities',
    'Quick wins audit',
    'Get your first 100 customers',
    'Growth experiments',
    'Side hustle to business',
    'Raise your prices',
    'Build recurring revenue',
    'SWOT analysis',
    'Lean canvas',
    'Pareto analysis (80/20)',
    'Set SMART goals',
    'Find your niche',
    'Eisenhower matrix',
    'MVP thinking',
    'Five whys',
    'Pricing psychology',
    'Should I hire?',
    'Go or no-go',
    'Pivot or persist',
    'Time management',
    'Automate the boring stuff',
    'Solopreneur systems',
    'Break-even calculator',
    'Understand profit margins',
    'Simple financial forecast',
    'Image generator',
    'Content generator',
    'Background remover',
    'Image upscaler',
    'AI heatmap'
  ],
  writer: [
    'Write a blog post',
    'Write a newsletter',
    'Write a case study',
    'Write a listicle',
    'Generate content ideas',
    'Write a how-to guide',
    'Write website copy',
    'Write product description',
    'Write an About page',
    'Write an FAQ page',
    'Write a landing page',
    'Write a pricing page',
    'Write a Google Business Profile',
    'Write a product listing',
    'Write a comparison page',
    'Write a lead magnet',
    'Write a thank-you page',
    'Write a social media bio',
    'Write social captions',
    'Write a tagline or slogan',
    'Write a video script',
    'Write a brand story',
    'Write a job posting',
    'Write a course outline',
    'Write podcast show notes',
    'Rewrite and improve',
    'Change the tone',
    'Make it shorter',
    'Write in my voice',
    'Humanize AI text'
  ],
  youtube: [
    'Keyword research',
    'Content gap analysis',
    'Competitor SEO analysis',
    "Find what I'm ranking for",
    'What are people searching?',
    'SEO audit',
    'Optimize meta tags',
    'Optimize image alt text',
    'Internal linking strategy',
    'Review my page',
    'Write SEO headings',
    'Optimize for featured snippet',
    'Fix my title tags',
    'Turn a blog post into traffic',
    'Local SEO optimization',
    'Google Business Profile audit',
    'Get more Google reviews',
    'SEO content brief',
    'Pillar page strategy',
    'SEO blog calendar',
    'Backlink strategy',
    'Plan site structure',
    'Page speed advice'
  ],
  designer: [
    'Campaign strategy',
    'Product launch plan',
    'Social media content',
    'Email campaign',
    'Content calendar',
    'Newsletter strategy',
    'Instagram strategy',
    'TikTok strategy',
    'Social media audit',
    'First 1,000 followers',
    'Hashtag strategy',
    'Grow my email list',
    'Welcome email sequence',
    'Abandoned cart emails',
    'Write ad copy',
    'Landing page strategy',
    'Facebook ads plan',
    'Google Ads plan',
    'First ad campaign',
    'Plan a sale',
    'Giveaway or contest',
    'Coupon strategy',
    'Referral program',
    'Influencer outreach plan',
    'Brand awareness plan'
  ],
  secretary: [
    'Privacy policy',
    'Terms of service',
    'Refund policy',
    'Cookie policy',
    'Disclaimer page',
    'Acceptable use policy',
    'Contract review',
    'Freelance contract',
    'NDA draft',
    'Licensing agreement',
    'Client service agreement',
    'Partnership agreement',
    'Business structure advice',
    'Trademark basics',
    'Copyright basics',
    'Shipping policy',
    'Subscription terms',
    'GDPR compliance check',
    'Accessibility compliance',
    'Email marketing compliance',
    'Affiliate disclosure',
    'Sales tax basics',
    'Cease and desist letter',
    'Handle a chargeback'
  ],
  editor: [
    'Professional email',
    'Press release',
    'Crisis communication',
    'Partnership outreach',
    'Media pitch',
    'Event invitation',
    'Negotiate with a vendor',
    'Meeting follow-up',
    'Write a customer apology',
    'Ask for a testimonial',
    'Ask for feedback',
    'Customer onboarding email',
    'Respond to a bad review',
    'Post-purchase follow-up',
    'Re-engage inactive customers',
    'Write a thank-you note',
    'Decline a request',
    'Chase a late payment',
    'Fire a client',
    'Respond to a complaint',
    'Auto-reply templates',
    'Out-of-office message'
  ],
  researcher: [
    'Sales outreach',
    'Follow-up sequence',
    'Cold call script',
    'LinkedIn outreach',
    'Ask for a referral',
    'DM outreach',
    'Networking introduction',
    'Sales proposal',
    'Objection handling',
    'Write a quote',
    'Freelance rate card',
    'Discovery call script',
    'Handle price shoppers',
    'Is this lead worth it?',
    'Deal closing email',
    'Proposal follow-up',
    'Pricing negotiation',
    'Win back a cold lead',
    'Upsell an existing customer'
  ]
};

const AGENT_MANAGEMENT_PROFILES = {
  ceo: {
    reportsTo: '',
    adapterType: 'connect_ai_annatar_orchestrator',
    modelProfile: 'connect-ai-business-orchestrator',
    temperature: 0.3,
    monthlyBudgetCents: 50000,
    instructions: [
      '사용자 요청을 사업, 카피, SEO, 마케팅, 법무, 고객 커뮤니케이션, 영업 영역으로 분해합니다.',
      '필요한 전문 에이전트만 최소 인원으로 배정하고 각 결과의 승인 필요 항목을 확인합니다.',
      '삭제, 외부 발송, 결제, 법률/재무 최종 판단, API/OAuth 변경은 사용자 승인 게이트로 보냅니다.'
    ],
    skills: ['전문가 라우팅', '업무 범위 분해', '승인 게이트 판단', '리스크 기반 우선순위', '결과 취합'],
    handoffTargets: ['business', 'writer', 'youtube', 'designer', 'secretary', 'editor', 'researcher']
  },
  youtube: {
    reportsTo: 'ceo',
    adapterType: 'connect_ai_seo_consultant',
    modelProfile: 'connect-ai-seo-consultant',
    temperature: 0.4,
    monthlyBudgetCents: 30000,
    instructions: [
      '키워드, 검색 의도, 콘텐츠 구조, 온페이지/테크니컬/로컬 SEO를 점검합니다.',
      '제목 태그, 메타 설명, 헤딩, 내부 링크, 이미지 alt, 사이트 구조 개선안을 우선순위로 제시합니다.',
      '검색량, 순위, 트래픽 전망은 확정값으로 쓰지 말고 입력 URL, 추정, 확인 필요 데이터를 구분합니다.'
    ],
    skills: AGENT_SKILL_LIBRARY.youtube,
    handoffTargets: ['writer', 'designer', 'developer', 'business']
  },
  instagram: {
    reportsTo: 'youtube',
    adapterType: 'connect_ai_sns_copywriter',
    modelProfile: 'annatar-sns-copy',
    temperature: 0.65,
    monthlyBudgetCents: 24000,
    instructions: [
      'Instagram, LinkedIn, X, Threads 등 채널별 짧은 카피를 작성합니다.',
      'Instagram 훅과 해시태그, X 280자 카피, Threads 글타래를 채널 특성에 맞게 분리합니다.',
      '외부 게시 전 승인 필요 여부와 광고/표현 리스크를 표시합니다.'
    ],
    skills: ['Instagram 훅', '해시태그 전략', 'LinkedIn 카피', 'X 280자 카피', 'Threads 글타래'],
    handoffTargets: ['youtube', 'writer', 'designer']
  },
  developer: {
    reportsTo: 'business',
    adapterType: 'codex_local',
    modelProfile: 'annatar-technical-validation',
    temperature: 0.15,
    monthlyBudgetCents: 65000,
    instructions: [
      'Annatar 운영에 필요한 파일, 설정, API, OAuth, 서버, 자동화 구현 가능성을 검증합니다.',
      '구현 전 관련 파일을 읽고 변경 후 테스트 또는 실제 UI 확인으로 닫습니다.',
      '비밀키와 토큰은 출력하지 않습니다.'
    ],
    skills: ['기술 타당성 검증', '코드 작성/수정', 'API/OAuth 통합', '로컬 서버 운영', '테스트와 화면 확인'],
    handoffTargets: ['business', 'ceo', 'secretary']
  },
  business: {
    reportsTo: 'ceo',
    adapterType: 'connect_ai_business_advisor',
    modelProfile: 'connect-ai-business-advisor',
    temperature: 0.35,
    monthlyBudgetCents: 42000,
    instructions: [
      '사업 아이디어, 가치 제안, 포지셔닝, 가격, 목표, 성장 판단을 실행 가능한 선택지로 정리합니다.',
      '비용, 마진, 손익분기, 고객 세그먼트, MVP, 성장 실험의 가정과 리스크를 분리합니다.',
      '법률/세무/투자 판단은 확정 결론 대신 확인 필요 항목과 전문가 검토 필요 여부를 표시합니다.'
    ],
    skills: AGENT_SKILL_LIBRARY.business,
    handoffTargets: ['designer', 'writer', 'researcher', 'secretary', 'developer', 'ceo']
  },
  secretary: {
    reportsTo: 'ceo',
    adapterType: 'connect_ai_legal_advisor',
    modelProfile: 'connect-ai-legal-advisor',
    temperature: 0.25,
    monthlyBudgetCents: 18000,
    instructions: [
      '정책, 약관, 계약서, 컴플라이언스, 권리 보호 문서의 초안과 검토 메모를 작성합니다.',
      '개인정보, 환불, 쿠키, 구독, 이메일 마케팅, 접근성, 세금 등 규정 이슈는 관할과 사실관계를 먼저 확인합니다.',
      '법률 자문을 대체하지 않으며 리스크, 협상 포인트, 변호사 확인 필요 항목을 명확히 표시합니다.'
    ],
    skills: AGENT_SKILL_LIBRARY.secretary,
    handoffTargets: ['business', 'writer', 'editor', 'ceo']
  },
  editor: {
    reportsTo: 'ceo',
    adapterType: 'connect_ai_customer_comms',
    modelProfile: 'connect-ai-customer-comms',
    temperature: 0.55,
    monthlyBudgetCents: 24000,
    instructions: [
      '고객, 파트너, 언론, 공급업체 등 외부 이해관계자에게 보낼 메시지를 작성합니다.',
      '사과문, 리뷰/클레임 대응, 위기 커뮤니케이션은 공감, 책임, 사실 확인, 다음 조치를 균형 있게 담습니다.',
      '외부 발송 전 승인 필요 여부와 법무 검토가 필요한 표현을 표시합니다.'
    ],
    skills: AGENT_SKILL_LIBRARY.editor,
    handoffTargets: ['secretary', 'writer', 'business', 'ceo']
  },
  designer: {
    reportsTo: 'ceo',
    adapterType: 'connect_ai_marketing_planner',
    modelProfile: 'connect-ai-marketing-planner',
    temperature: 0.55,
    monthlyBudgetCents: 32000,
    instructions: [
      '제품과 목표를 캠페인, SNS, 이메일, 광고, 프로모션, 성장 실험으로 나눠 계획합니다.',
      '각 계획에는 대상, 채널, 일정, KPI, 예산 가정, 필요한 카피/크리에이티브 산출물을 포함합니다.',
      '광고 집행, 대량 발송, 할인 정책 변경은 승인 필요 항목으로 표시합니다.'
    ],
    skills: AGENT_SKILL_LIBRARY.designer,
    handoffTargets: ['writer', 'instagram', 'youtube', 'business', 'editor']
  },
  writer: {
    reportsTo: 'designer',
    adapterType: 'connect_ai_creative_writer',
    modelProfile: 'connect-ai-creative-writer',
    temperature: 0.75,
    monthlyBudgetCents: 26000,
    instructions: [
      '블로그, 웹사이트 카피, 상품 설명, 랜딩 페이지, 브랜드 스토리, 소셜 문구를 작성합니다.',
      '독자, 목적, 브랜드 톤, CTA, 핵심 메시지를 먼저 정리하고 초안을 구조화합니다.',
      '사실 기반 문구, 감성/설득 문구, 확인이 필요한 주장, 외부 게시 승인 필요 여부를 구분합니다.'
    ],
    skills: AGENT_SKILL_LIBRARY.writer,
    handoffTargets: ['youtube', 'designer', 'instagram', 'editor']
  },
  researcher: {
    reportsTo: 'business',
    adapterType: 'connect_ai_sales_outreach',
    modelProfile: 'connect-ai-sales-outreach',
    temperature: 0.55,
    monthlyBudgetCents: 38000,
    instructions: [
      '콜드아웃리치, 팔로업, 콜 스크립트, LinkedIn/DM 메시지, 제안서, 견적, 클로징 문구를 작성합니다.',
      '리드 적합도, 의사결정자, 제안 가치, 반대 의견, 다음 액션을 분리해 영업 흐름을 설계합니다.',
      '과장, 압박, 스팸성 표현은 피하고 가격 협상과 제안 범위는 확인 필요 항목으로 표시합니다.'
    ],
    skills: AGENT_SKILL_LIBRARY.researcher,
    handoffTargets: ['business', 'writer', 'editor', 'ceo']
  }
};

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
const taskRunQueue = new Map();
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

function seedBundledAnntarBrainSeeds(brainRoot) {
  if (!brainRoot) return 0;
  const source = path.join(ASSETS_DIR, 'brain-seeds', 'anntar');
  const target = path.join(brainRoot, '30_운영', 'anntar');
  let copied = 0;
  try {
    if (!fs.existsSync(source)) return 0;
    fs.mkdirSync(target, { recursive: true });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
      const dst = path.join(target, entry.name);
      if (fs.existsSync(dst)) continue;
      fs.copyFileSync(path.join(source, entry.name), dst);
      copied += 1;
    }
    if (copied > 0) brainCache.clear();
  } catch (error) {
    console.warn(`[brain-seeds] Anntar seed skipped: ${error.message || error}`);
  }
  return copied;
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
  if (provider === 'xai') return /^xai-[A-Za-z0-9_-]{8,}$/.test(key);
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
  return Object.values(PROVIDERS).filter((provider) => !provider.hidden).map((provider) => {
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

function isGrokProxyBase(base) {
  const current = String(base || '').replace(/\/+$/, '');
  return lmBase(current) === lmBase(GROK_PROXY.base);
}

function hiddenProviderDefaultFallback(ollamaBase) {
  return isGrokProxyBase(ollamaBase) ? modelRef('local', GROK_PROXY_MODEL) : '';
}

function normalizeDefaultModelForConfig(ollamaBase, defaultModel) {
  const current = String(defaultModel || '').trim();
  const provider = current.match(/^([A-Za-z0-9_-]+):/)?.[1] || '';
  if (provider && (providerConfig(provider) || {}).hidden) {
    return hiddenProviderDefaultFallback(ollamaBase);
  }
  const model = current.replace(/^(local|xai):/, '');
  if (isGrokProxyBase(ollamaBase) && (!current || (/grok/i.test(model) && isNonChatModel(model)))) {
    return modelRef('local', GROK_PROXY_MODEL);
  }
  return current;
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
  const normalizedDefaultModel = normalizeDefaultModelForConfig(ollamaBase, defaultModel);
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
  const llmApiKey = process.env.CONNECT_AI_LLM_API_KEY
    || local.llmApiKey
    || local.localLlmApiKey
    || '';
  return {
    ollamaBase: String(ollamaBase).replace(/\/+$/, ''),
    defaultModel: normalizedDefaultModel,
    localBrainPath,
    obsidianVaultPath,
    llmApiKey: cleanSecret(llmApiKey, 3000),
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 300000,
    chatTimeoutMs: Number.isFinite(chatTimeoutMs) ? chatTimeoutMs : 45000
  };
}

function publicConfig(config) {
  const { llmApiKey, localLlmApiKey, ...safeConfig } = config || {};
  return safeConfig;
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

function cleanNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function cleanBoolean(value, fallback = false) {
  if (value === undefined) return fallback;
  return value === true || value === 'true' || value === 1 || value === '1';
}

function cleanStringList(value, maxItems = 20, maxLength = 500) {
  const items = Array.isArray(value)
    ? value
    : String(value || '').split('\n');
  return items
    .map((item) => cleanText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function cleanStringMap(value, keys, maxLength = 500) {
  const source = value && typeof value === 'object' ? value : {};
  return keys.reduce((result, key) => {
    if (source[key] !== undefined) result[key] = cleanText(source[key], maxLength);
    return result;
  }, {});
}

function cleanAgentSkills(value) {
  if (!Array.isArray(value)) return undefined;
  return value
    .map((skill) => {
      const item = skill && typeof skill === 'object' ? skill : { name: skill };
      const name = cleanText(item.name, 120);
      if (!name) return null;
      const status = ['enabled', 'disabled'].includes(item.status) ? item.status : 'enabled';
      return {
        name,
        status,
        source: cleanText(item.source || 'Connect AI', 120)
      };
    })
    .filter(Boolean)
    .slice(0, 30);
}

function cleanAgentManagementPatch(value) {
  const input = value && typeof value === 'object' ? value : {};
  const patch = {};

  if (input.instructions && typeof input.instructions === 'object') {
    patch.instructions = {};
    if (input.instructions.primary !== undefined) {
      patch.instructions.primary = cleanStringList(input.instructions.primary, 20, 700);
    }
    if (input.instructions.operatingPolicy !== undefined) {
      patch.instructions.operatingPolicy = cleanText(input.instructions.operatingPolicy, 6000);
    }
  }

  if (input.skills !== undefined) {
    const skills = cleanAgentSkills(input.skills);
    if (skills) patch.skills = skills;
  }

  if (input.org && typeof input.org === 'object') {
    patch.org = {};
    if (input.org.reportsToId !== undefined) {
      patch.org.reportsToId = cleanText(input.org.reportsToId, 80);
    }
    if (input.org.directReportIds !== undefined) {
      patch.org.directReportIds = cleanStringList(input.org.directReportIds, 30, 80);
    }
  }

  if (input.settings && typeof input.settings === 'object') {
    patch.settings = {};
    if (input.settings.identity) {
      patch.settings.identity = cleanStringMap(input.settings.identity, ['name', 'role', 'title', 'capabilities'], 700);
    }
    if (input.settings.adapter) {
      patch.settings.adapter = cleanStringMap(input.settings.adapter, ['type', 'model', 'modelProfile', 'contextMode'], 160);
      if (input.settings.adapter.temperature !== undefined) {
        patch.settings.adapter.temperature = cleanNumber(input.settings.adapter.temperature, 0.35, 0, 2);
      }
    }
    if (input.settings.heartbeat) {
      patch.settings.heartbeat = {};
      ['enabled', 'wakeOnAssignment', 'wakeOnDemand', 'wakeOnAutomation'].forEach((key) => {
        if (input.settings.heartbeat[key] !== undefined) patch.settings.heartbeat[key] = cleanBoolean(input.settings.heartbeat[key]);
      });
      ['intervalSec', 'cooldownSec'].forEach((key) => {
        if (input.settings.heartbeat[key] !== undefined) {
          patch.settings.heartbeat[key] = Math.round(cleanNumber(input.settings.heartbeat[key], 0, 0, 86400));
        }
      });
    }
    if (input.settings.runtime) {
      patch.settings.runtime = {};
      ['timeoutSec', 'gracePeriodSec', 'maxConcurrentRuns'].forEach((key) => {
        if (input.settings.runtime[key] !== undefined) {
          patch.settings.runtime[key] = Math.round(cleanNumber(input.settings.runtime[key], 0, 0, 86400));
        }
      });
    }
    if (input.settings.handoffTargets !== undefined) {
      patch.settings.handoffTargets = cleanStringList(input.settings.handoffTargets, 20, 80);
    }
  }

  if (input.budget && typeof input.budget === 'object') {
    patch.budget = {};
    if (input.budget.monthlyCents !== undefined) patch.budget.monthlyCents = Math.round(cleanNumber(input.budget.monthlyCents, 0, 0, 100000000));
    if (input.budget.softAlertPercent !== undefined) patch.budget.softAlertPercent = Math.round(cleanNumber(input.budget.softAlertPercent, 80, 0, 100));
    if (input.budget.hardStopPercent !== undefined) patch.budget.hardStopPercent = Math.round(cleanNumber(input.budget.hardStopPercent, 100, 0, 100));
    if (input.budget.policy !== undefined) patch.budget.policy = cleanText(input.budget.policy, 500);
  }

  return patch;
}

function mergeAgentManagementPatch(current, incoming) {
  const base = cleanAgentManagementPatch(current);
  const patch = cleanAgentManagementPatch(incoming);
  const merged = { ...base };
  ['instructions', 'budget', 'org'].forEach((section) => {
    if (!patch[section]) return;
    merged[section] = {
      ...(merged[section] || {}),
      ...patch[section]
    };
  });
  if (patch.settings) {
    merged.settings = { ...(merged.settings || {}) };
    ['identity', 'adapter', 'heartbeat', 'runtime'].forEach((nested) => {
      if (!patch.settings[nested]) return;
      merged.settings[nested] = {
        ...((merged.settings && merged.settings[nested]) || {}),
        ...patch.settings[nested]
      };
    });
    if (patch.settings.handoffTargets !== undefined) {
      merged.settings.handoffTargets = patch.settings.handoffTargets;
    }
  }
  if (patch.skills) merged.skills = patch.skills;
  return merged;
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

function execFileText(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout: options.timeout || 3000,
      maxBuffer: options.maxBuffer || 1024 * 1024
    }, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(String(stdout || '').trim());
    });
  });
}

async function findCommand(names) {
  for (const name of names) {
    try {
      const resolved = path.isAbsolute(name)
        ? (fs.existsSync(name) ? name : '')
        : await execFileText('/usr/bin/which', [name], { timeout: 1500 });
      if (resolved) return resolved;
    } catch {
      // Try the next candidate.
    }
  }
  return '';
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

function decodeHtml(value = '') {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value = '') {
  return decodeHtml(String(value || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .replace(/\s+(-(?=[A-Za-z0-9]))/g, '$1')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim();
}

function safeDecodeUri(value) {
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
  const candidates = [
    String(value || ''),
    decodeHtml(value),
    safeDecodeUri(value),
    safeDecodeUri(decodeHtml(value))
  ];
  for (const candidate of candidates) {
    const match = String(candidate || '').match(/\]\((https?:\/{1,2}[^\s)]+)/i);
    if (match) return repairUrlProtocol(match[1]);
  }
  return '';
}

function reutersCanonicalUrl(url) {
  if (!/reuters/i.test(url.hostname) || !/\.arcpublishing\.com$/i.test(url.hostname)) return '';
  const cleanPath = safeDecodeUri(url.pathname).split(/\]\(/)[0].replace(/\/+$/, '/');
  if (!/^\/[a-z0-9-]+\/.+-\d{4}-\d{2}-\d{2}\/?$/i.test(cleanPath)) return '';
  try {
    return new URL(cleanPath, 'https://www.reuters.com').href;
  } catch {
    return '';
  }
}

function normalizeResearchUrl(raw) {
  const value = decodeHtml(raw).trim();
  try {
    const url = new URL(embeddedMarkdownUrl(value) || repairUrlProtocol(value), 'https://duckduckgo.com');
    const redirected = url.searchParams.get('uddg');
    const finalCandidate = redirected
      ? (embeddedMarkdownUrl(redirected) || repairUrlProtocol(redirected))
      : (embeddedMarkdownUrl(url.href) || url.href);
    const finalUrl = new URL(finalCandidate);
    if (!['http:', 'https:'].includes(finalUrl.protocol)) return '';
    const reutersUrl = reutersCanonicalUrl(finalUrl);
    if (reutersUrl) return reutersUrl;
    return finalUrl.href;
  } catch {
    return '';
  }
}

function normalizeResearchHostname(hostname) {
  return String(hostname || '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
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

function isPrivateResearchHost(hostname) {
  const host = normalizeResearchHostname(hostname);
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  const mappedIpv4 = ipv4FromMappedIpv6(host);
  if (mappedIpv4) return isPrivateResearchHost(mappedIpv4);
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

async function isResolvedSafeResearchHost(hostname) {
  const host = normalizeResearchHostname(hostname);
  if (isPrivateResearchHost(host)) return false;
  if (net.isIP(host)) return true;
  try {
    const records = await dnsPromises.lookup(host, { all: true, verbatim: true });
    return records.length > 0 && records.every((record) => !isPrivateResearchHost(record.address));
  } catch {
    return false;
  }
}

function researchSafeLookup(hostname, options, callback) {
  const host = normalizeResearchHostname(hostname);
  if (isPrivateResearchHost(host)) {
    callback(new Error('RESEARCH_PRIVATE_HOST_BLOCKED'));
    return;
  }
  dns.lookup(host, options, (error, address, family) => {
    if (error) {
      callback(error);
      return;
    }
    const records = Array.isArray(address) ? address : [{ address, family }];
    if (records.some((record) => isPrivateResearchHost(record.address || record))) {
      callback(new Error('RESEARCH_PRIVATE_HOST_BLOCKED'));
      return;
    }
    callback(null, address, family);
  });
}

const RESEARCH_HTTP_AGENT = new http.Agent({ lookup: researchSafeLookup });
const RESEARCH_HTTPS_AGENT = new https.Agent({ lookup: researchSafeLookup });

function isSafeResearchUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !isPrivateResearchHost(url.hostname);
  } catch {
    return false;
  }
}

async function isFetchSafeResearchUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && await isResolvedSafeResearchHost(url.hostname);
  } catch {
    return false;
  }
}

async function filterSafeResearchResults(results) {
  const safe = [];
  for (const item of Array.isArray(results) ? results : []) {
    if (item && item.url && await isFetchSafeResearchUrl(item.url)) safe.push(item);
  }
  return safe;
}

function extractDuckDuckGoResults(html, limit = 5) {
  const blocks = String(html || '').split(/<div[^>]+class="[^"]*\bresult\b[^"]*"[^>]*>/i).slice(1);
  const results = [];
  for (const block of blocks) {
    const anchor = block.match(/<a[^>]+class="[^"]*\bresult__a\b[^"]*"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!anchor) continue;
    const url = normalizeResearchUrl(anchor[1]);
    if (!url || !isSafeResearchUrl(url)) continue;
    const title = stripHtml(anchor[2]);
    if (!title) continue;
    const snippetMatch = block.match(/<(?:a|div)[^>]+class="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/(?:a|div)>/i);
    const snippet = snippetMatch ? stripHtml(snippetMatch[1]) : '';
    if (results.some((item) => item.url === url)) continue;
    results.push({ title: cleanText(title, 240), url, snippet: cleanText(snippet, 600) });
    if (results.length >= limit) break;
  }
  return results;
}

function mockResearchResults(query, mode = 'ok') {
  if (mode === 'empty') {
    return {
      ok: true,
      query,
      mode: 'mock',
      status: 'empty',
      searchedAt: nowIso(),
      results: [],
      sources: [],
      count: 0,
      error: '검색 결과가 없습니다.'
    };
  }
  if (mode === 'error') {
    return {
      ok: true,
      query,
      mode: 'mock',
      status: 'error',
      searchedAt: nowIso(),
      results: [],
      sources: [],
      count: 0,
      error: 'QA mock research upstream error'
    };
  }
  return {
    ok: true,
    query,
    mode: 'mock',
    status: 'ok',
    searchedAt: nowIso(),
    results: [
      {
        title: 'QA Auto Research Fixture',
        url: 'https://example.com/connect-ai/qa-auto-research',
        snippet: 'Deterministic source used by Connect AI e2e to verify automatic research grounding.',
        excerpt: 'QA fixture excerpt: automatic research collected a source, stored a citation, and passed it to task execution.'
      },
      {
        title: 'Connect AI Research Notes',
        url: 'https://example.com/connect-ai/research-notes',
        snippet: 'A second deterministic source for citation rendering and export coverage.',
        excerpt: 'Research notes fixture: result cards should include title, URL, snippet, and optional excerpt.'
      }
    ],
    sources: [
      'https://example.com/connect-ai/qa-auto-research',
      'https://example.com/connect-ai/research-notes'
    ],
    count: 2,
    error: ''
  };
}

function mockXResearchResults(query) {
  return {
    ok: true,
    query,
    mode: 'x-grok-oauth-proxy-mock',
    status: 'ok',
    searchedAt: nowIso(),
    count: 1,
    sources: ['https://x.com/search?q=QA_AUTO_RESEARCH_FIXTURE&src=typed_query&f=live'],
    results: [{
      title: 'X Search Fixture',
      url: 'https://x.com/search?q=QA_AUTO_RESEARCH_FIXTURE&src=typed_query&f=live',
      snippet: 'Grok OAuth subscription research fixture for X search.'
    }],
    error: ''
  };
}

function mockThreadsResearchResults(query) {
  return {
    ok: true,
    query,
    mode: 'threads-web-search-mock',
    status: 'ok',
    searchedAt: nowIso(),
    count: 1,
    sources: ['https://www.threads.net/search?q=QA_AUTO_RESEARCH_FIXTURE'],
    results: [{
      title: 'Threads Search Fixture',
      url: 'https://www.threads.net/search?q=QA_AUTO_RESEARCH_FIXTURE',
      snippet: 'Threads web search fixture for social research.'
    }],
    error: ''
  };
}

function mockYouTubeResearchResults(query) {
  return {
    ok: true,
    query,
    mode: 'youtube-web-search-mock',
    status: 'ok',
    searchedAt: nowIso(),
    count: 1,
    sources: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
    results: [{
      title: 'YouTube Search Fixture',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      snippet: '채널: Connect AI QA · 게시: 2026. 06. 07. · 조회수: 123,456회 · YouTube web search fixture.'
    }],
    error: ''
  };
}

function mockInstagramResearchResults(query) {
  return {
    ok: true,
    query,
    mode: 'instagram-web-search-mock',
    status: 'ok',
    searchedAt: nowIso(),
    count: 1,
    sources: ['https://www.instagram.com/blackpinkofficial/'],
    results: [{
      title: 'Instagram @blackpinkofficial',
      url: 'https://www.instagram.com/blackpinkofficial/',
      snippet: 'Instagram web search fixture for social research.'
    }],
    error: ''
  };
}

function mockLinkedInResearchResults(query) {
  return {
    ok: true,
    query,
    mode: 'linkedin-web-search-mock',
    status: 'ok',
    searchedAt: nowIso(),
    count: 1,
    sources: ['https://www.linkedin.com/company/connect-ai-qa/'],
    results: [{
      title: 'LinkedIn Connect AI QA',
      url: 'https://www.linkedin.com/company/connect-ai-qa/',
      snippet: 'LinkedIn web search fixture for professional profile and company research.'
    }],
    error: ''
  };
}

async function searchWeb(query, limit = 5) {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await axios.get(url, {
    timeout: Math.min(RESEARCH_TIMEOUT_MS, 15000),
    responseType: 'text',
    httpAgent: RESEARCH_HTTP_AGENT,
    httpsAgent: RESEARCH_HTTPS_AGENT,
    proxy: false,
    maxContentLength: 1024 * 1024,
    headers: {
      'User-Agent': RESEARCH_USER_AGENT,
      Accept: 'text/html,application/xhtml+xml'
    }
  });
  return extractDuckDuckGoResults(response.data, limit);
}

async function fetchResearchPage(url) {
  if (!await isFetchSafeResearchUrl(url)) return '';
  try {
    const response = await axios.get(url, {
      timeout: Math.min(RESEARCH_TIMEOUT_MS, 12000),
      responseType: 'text',
      maxRedirects: 0,
      httpAgent: RESEARCH_HTTP_AGENT,
      httpsAgent: RESEARCH_HTTPS_AGENT,
      proxy: false,
      maxContentLength: 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        'User-Agent': RESEARCH_USER_AGENT,
        Accept: 'text/html,text/plain'
      }
    });
    return cleanText(stripHtml(response.data), 1400);
  } catch {
    return '';
  }
}

function xSearchUrl(query) {
  const url = new URL('https://x.com/search');
  url.searchParams.set('q', query);
  url.searchParams.set('src', 'typed_query');
  url.searchParams.set('f', 'live');
  return url.href;
}

function threadsSearchUrl(query) {
  const url = new URL('https://www.threads.net/search');
  url.searchParams.set('q', query);
  return url.href;
}

function youtubeSearchUrl(query) {
  const url = new URL('https://www.youtube.com/results');
  url.searchParams.set('search_query', query);
  return url.href;
}

function instagramSearchUrl(query) {
  const url = new URL('https://www.instagram.com/explore/search/keyword/');
  url.searchParams.set('q', query);
  return url.href;
}

function linkedInSearchUrl(query) {
  const url = new URL('https://www.linkedin.com/search/results/all/');
  url.searchParams.set('keywords', query);
  return url.href;
}

function grokProxyResearchHelp(status) {
  if (!status.installed) {
    return `${GROK_PROXY.installCommand} 후 ${GROK_PROXY.loginCommand}를 실행해 Grok Build OAuth 로그인을 완료해 주세요.`;
  }
  if (!status.running) {
    return `${GROK_PROXY.loginCommand}로 Grok Build OAuth 로그인을 완료한 뒤 ${GROK_PROXY.serviceCommand} 또는 cliproxyapi 서버를 실행해 주세요.`;
  }
  return 'Grok OAuth Proxy 인증 상태를 확인해 주세요.';
}

function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeXResearchResult(item) {
  const url = normalizeResearchUrl(item && (item.url || item.link || item.source));
  if (!url || !isSafeResearchUrl(url)) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, '').toLowerCase();
    if (host !== 'x.com' && host !== 'twitter.com') return null;
  } catch {
    return null;
  }
  const title = cleanText(item.title || item.author || 'X Search result', 240);
  const snippetParts = [
    item.author ? `작성자: ${item.author}` : '',
    item.publishedAt ? `시간: ${item.publishedAt}` : '',
    item.snippet || item.summary || item.text || ''
  ].filter(Boolean);
  return {
    title,
    url,
    snippet: cleanText(snippetParts.join(' · '), 700)
  };
}

async function runXSubscriptionResearch(query, options = {}, config = getConfig()) {
  const cleanQuery = cleanText(query, 300);
  if (!cleanQuery) throw new Error('QUERY_REQUIRED');
  if (options.mock || /QA_AUTO_RESEARCH_(FIXTURE|EMPTY|ERROR)/i.test(cleanQuery)) {
    return mockXResearchResults(cleanQuery);
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 4, 10));
  const report = {
    ok: true,
    query: cleanQuery,
    mode: 'x-grok-oauth-proxy',
    status: 'pending',
    searchedAt: nowIso(),
    results: [],
    sources: [],
    count: 0,
    error: ''
  };
  const fallbackSearch = {
    title: `X Search: ${cleanQuery}`,
    url: xSearchUrl(cleanQuery),
    snippet: 'X 검색 페이지를 직접 열어 구독 계정으로 확인할 수 있습니다.'
  };

  const status = await getGrokProxyStatus(config);
  if (!status.running) {
    report.status = 'error';
    report.error = grokProxyResearchHelp(status);
    report.results = [{
      title: 'Grok Build OAuth Proxy 연결 안내',
      url: status.docsUrl || GROK_PROXY.docsUrl,
      snippet: report.error
    }, fallbackSearch].filter((item) => item.url && isSafeResearchUrl(item.url));
    report.sources = report.results.map((item) => item.url);
    report.count = report.results.length;
    return report;
  }

  try {
    const model = preferredGrokChatModel(status.models, status.model || GROK_PROXY.model);
    const response = await axios.post(`${GROK_PROXY.base}/chat/completions`, {
      model,
      temperature: 0.2,
      max_tokens: 1200,
      stream: false,
      messages: [
        {
          role: 'system',
          content: [
            'You are Connect AI X Search.',
            'Use the authenticated Grok/X subscription session to search X/Twitter for the user query.',
            'Return strict JSON only: {"status":"ok|empty|error","results":[{"title":"","url":"","snippet":"","author":"","publishedAt":""}],"error":""}.',
            'Every result URL must be an exact https://x.com/... or https://twitter.com/... URL.',
            'Do not invent post URLs. If exact URLs are unavailable, return an empty results array and explain in error.',
            'Write snippets in Korean.'
          ].join(' ')
        },
        {
          role: 'user',
          content: `X에서 다음 내용을 검색해 상위 ${limit}개 결과를 JSON으로 반환해줘.\n검색어: ${cleanQuery}`
        }
      ]
    }, {
      timeout: Math.min(config.chatTimeoutMs || config.timeoutMs || 45000, 45000),
      headers: {
        ...localLlmHeaders(config),
        'Content-Type': 'application/json'
      }
    });
    const text = extractModelText(response.data);
    const parsed = parseJsonObject(text) || {};
    const results = (Array.isArray(parsed.results) ? parsed.results : [])
      .map(normalizeXResearchResult)
      .filter(Boolean)
      .slice(0, limit);
    report.results = results.length ? await filterSafeResearchResults(results) : [fallbackSearch];
    report.sources = Array.from(new Set(report.results.map((item) => item.url).filter(Boolean)));
    report.count = report.results.length;
    report.status = results.length ? 'ok' : (parsed.status === 'error' ? 'error' : 'empty');
    report.error = cleanText(parsed.error || (!results.length ? 'Grok이 정확한 X 게시물 링크를 반환하지 않아 X 검색 링크를 제공했습니다.' : ''), 500);
  } catch (error) {
    report.status = 'error';
    report.error = modelErrorMessage(error);
    report.results = [fallbackSearch];
    report.sources = [fallbackSearch.url];
    report.count = 1;
  }
  return report;
}

function isThreadsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'threads.net';
  } catch {
    return false;
  }
}

function extractResearchUrls(text) {
  const matches = String(text || '').match(/https?:\/\/[^\s<>"')\]]+/gi) || [];
  return Array.from(new Set(matches
    .map((raw) => normalizeResearchUrl(raw.replace(/[.,;:!?]+$/g, '')))
    .filter(Boolean)));
}

async function runThreadsResearch(query, options = {}) {
  const cleanQuery = cleanText(query, 300);
  if (!cleanQuery) throw new Error('QUERY_REQUIRED');
  if (options.mock || /QA_AUTO_RESEARCH_(FIXTURE|EMPTY|ERROR)/i.test(cleanQuery)) {
    return mockThreadsResearchResults(cleanQuery);
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 4, 10));
  const fetchPages = options.fetchPages !== false;
  const fallbackSearch = {
    title: `Threads Search: ${cleanQuery}`,
    url: threadsSearchUrl(cleanQuery),
    snippet: 'Threads 검색 페이지를 직접 열어 확인할 수 있습니다.'
  };
  const report = {
    ok: true,
    query: cleanQuery,
    mode: 'threads-web-search',
    status: 'pending',
    searchedAt: nowIso(),
    results: [],
    sources: [],
    count: 0,
    error: ''
  };

  try {
    const directResults = extractResearchUrls(cleanQuery)
      .filter(isThreadsUrl)
      .slice(0, limit)
      .map((url) => ({ title: `Threads: ${url}`, url, snippet: '사용자가 제공한 Threads 링크입니다.' }));
    const rawResults = directResults.length ? [] : await searchWeb(`site:threads.net ${cleanQuery}`, limit + 2);
    report.results = directResults.length ? directResults : (await filterSafeResearchResults(rawResults))
      .filter((item) => isThreadsUrl(item.url))
      .slice(0, limit);
    if (fetchPages) {
      for (const item of report.results.slice(0, 3)) {
        item.excerpt = await fetchResearchPage(item.url);
      }
    }
    if (!report.results.length) {
      report.results = [fallbackSearch];
      report.error = '검색 결과에서 정확한 Threads 게시물 링크를 찾지 못해 Threads 검색 링크를 제공합니다.';
    }
    report.sources = Array.from(new Set(report.results.map((item) => item.url).filter(Boolean)));
    report.count = report.results.length;
    report.status = report.error ? 'empty' : 'ok';
  } catch (error) {
    report.status = 'error';
    report.error = error.message || String(error);
    report.results = [fallbackSearch];
    report.sources = [fallbackSearch.url];
    report.count = 1;
  }
  return report;
}

function isInstagramUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'instagram.com';
  } catch {
    return false;
  }
}

function instagramProfileUrl(handle) {
  return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}

function extractInstagramHandles(text) {
  const reserved = new Set(['about', 'accounts', 'api', 'developer', 'direct', 'explore', 'legal', 'p', 'reel', 'reels', 'stories', 'tv']);
  const handles = [];
  const seen = new Set();
  const value = String(text || '');
  const patterns = [
    /@([a-z0-9._]{2,30})(?=$|[^a-z0-9._])/gi,
    /instagram\.com\/([a-z0-9._]{2,30})(?=$|[/?#\s])/gi
  ];
  for (const pattern of patterns) {
    for (const match of value.matchAll(pattern)) {
      const handle = String(match[1] || '').toLowerCase().replace(/\.+$/g, '');
      if (!handle || reserved.has(handle) || seen.has(handle)) continue;
      seen.add(handle);
      handles.push(handle);
    }
  }
  return handles;
}

function instagramSearchQueryFromText(query) {
  const original = cleanText(query, 300);
  const cleaned = cleanText(original
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/(?:^|\s)(?:인스타\s*그램|인스타)(?:에서도|에서|으로|로|의|를|도)?/gi, ' ')
    .replace(/\b(?:instagram|ig)\b/gi, ' ')
    .replace(/\d{1,2}\s*(?:주일|주|일|days?|weeks?)?/gi, ' ')
    .replace(/(?:찾아(?:와|서|줘)?|검색(?:해|해서|해줘)?|가져와서?|요약(?:해|해서|해줘)?|정리(?:해|해서|해줘)?|분석(?:해|해서|해줘)?|행적)/g, ' '), 180);
  return cleaned || original;
}

async function runInstagramResearch(query, options = {}) {
  const cleanQuery = cleanText(query, 300);
  if (!cleanQuery) throw new Error('QUERY_REQUIRED');
  if (options.mock || /QA_AUTO_RESEARCH_(FIXTURE|EMPTY|ERROR)/i.test(cleanQuery)) {
    return mockInstagramResearchResults(cleanQuery);
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 4, 10));
  const fetchPages = options.fetchPages !== false;
  const searchQuery = instagramSearchQueryFromText(cleanQuery);
  const fallbackSearch = {
    title: `Instagram Search: ${searchQuery}`,
    url: instagramSearchUrl(searchQuery),
    snippet: 'Instagram 검색 페이지를 구독/로그인 계정으로 직접 열어 확인할 수 있습니다.'
  };
  const report = {
    ok: true,
    query: cleanQuery,
    mode: 'instagram-web-search',
    status: 'pending',
    searchedAt: nowIso(),
    results: [],
    sources: [],
    count: 0,
    error: ''
  };

  try {
    const directUrls = extractResearchUrls(cleanQuery)
      .filter(isInstagramUrl)
      .slice(0, limit)
      .map((url) => ({ title: `Instagram: ${url}`, url, snippet: '사용자가 제공한 Instagram 링크입니다.' }));
    const directHandles = extractInstagramHandles(cleanQuery)
      .slice(0, limit)
      .map((handle) => ({
        title: `Instagram @${handle}`,
        url: instagramProfileUrl(handle),
        snippet: '요청에서 확인된 Instagram 계정 후보입니다.'
      }));
    const directResults = [...directUrls, ...directHandles]
      .filter((item, index, items) => items.findIndex((other) => other.url === item.url) === index)
      .slice(0, limit);
    const rawResults = directResults.length ? [] : await searchWeb(`site:instagram.com ${searchQuery} instagram official account`, limit + 4);
    const searchedResults = directResults.length ? [] : (await filterSafeResearchResults(rawResults))
      .filter((item) => isInstagramUrl(item.url))
      .slice(0, limit);
    report.results = (directResults.length ? directResults : searchedResults).slice(0, limit);
    if (fetchPages) {
      for (const item of report.results.slice(0, 3)) {
        item.excerpt = await fetchResearchPage(item.url);
      }
    }
    if (!report.results.length) {
      report.results = [fallbackSearch];
      report.error = '검색 결과에서 정확한 Instagram 링크를 찾지 못해 Instagram 검색 링크를 제공합니다.';
    }
    report.sources = Array.from(new Set(report.results.map((item) => item.url).filter(Boolean)));
    report.count = report.results.length;
    report.status = report.error ? 'empty' : 'ok';
  } catch (error) {
    report.status = 'error';
    report.error = error.message || String(error);
    report.results = [fallbackSearch];
    report.sources = [fallbackSearch.url];
    report.count = 1;
  }
  return report;
}

function isLinkedInUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'linkedin.com';
  } catch {
    return false;
  }
}

function linkedInSearchQueryFromText(query) {
  const original = cleanText(query, 300);
  const cleaned = cleanText(original
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/(?:^|\s)(?:링크드인|링크드 인)(?:에서도|에서|으로|로|의|를|도)?/gi, ' ')
    .replace(/\blinkedin\b/gi, ' ')
    .replace(/\d{1,2}\s*(?:개|가지|건|명|곳|items?|profiles?|companies?)?/gi, ' ')
    .replace(/(?:찾아(?:와|서|줘)?|검색(?:해|해서|해줘)?|가져와서?|요약(?:해|해서|해줘)?|정리(?:해|해서|해줘)?|분석(?:해|해서|해줘)?|프로필|회사|계정)/g, ' '), 180);
  return cleaned || original;
}

async function runLinkedInResearch(query, options = {}) {
  const cleanQuery = cleanText(query, 300);
  if (!cleanQuery) throw new Error('QUERY_REQUIRED');
  if (options.mock || /QA_AUTO_RESEARCH_(FIXTURE|EMPTY|ERROR)/i.test(cleanQuery)) {
    return mockLinkedInResearchResults(cleanQuery);
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 4, 10));
  const fetchPages = options.fetchPages !== false;
  const searchQuery = linkedInSearchQueryFromText(cleanQuery);
  const fallbackSearch = {
    title: `LinkedIn Search: ${searchQuery}`,
    url: linkedInSearchUrl(searchQuery),
    snippet: 'LinkedIn 검색 페이지를 로그인 계정으로 직접 열어 확인할 수 있습니다.'
  };
  const report = {
    ok: true,
    query: cleanQuery,
    mode: 'linkedin-web-search',
    status: 'pending',
    searchedAt: nowIso(),
    results: [],
    sources: [],
    count: 0,
    error: ''
  };

  try {
    const directResults = extractResearchUrls(cleanQuery)
      .filter(isLinkedInUrl)
      .slice(0, limit)
      .map((url) => ({ title: `LinkedIn: ${url}`, url, snippet: '사용자가 제공한 LinkedIn 링크입니다.' }));
    const rawResults = directResults.length ? [] : await searchWeb(`site:linkedin.com/in OR site:linkedin.com/company ${searchQuery} linkedin`, limit + 4);
    const searchedResults = directResults.length ? [] : (await filterSafeResearchResults(rawResults))
      .filter((item) => isLinkedInUrl(item.url))
      .slice(0, limit);
    report.results = (directResults.length ? directResults : searchedResults).slice(0, limit);
    if (fetchPages) {
      for (const item of report.results.slice(0, 3)) {
        item.excerpt = await fetchResearchPage(item.url);
      }
    }
    if (!report.results.length) {
      report.results = [fallbackSearch];
      report.error = '검색 결과에서 정확한 LinkedIn 링크를 찾지 못해 LinkedIn 검색 링크를 제공합니다.';
    }
    report.sources = Array.from(new Set(report.results.map((item) => item.url).filter(Boolean)));
    report.count = report.results.length;
    report.status = report.error ? 'empty' : 'ok';
  } catch (error) {
    report.status = 'error';
    report.error = error.message || String(error);
    report.results = [fallbackSearch];
    report.sources = [fallbackSearch.url];
    report.count = 1;
  }
  return report;
}

function isYouTubeUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    return host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be';
  } catch {
    return false;
  }
}

function youtubeVideoIdFromUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^www\./i, '').toLowerCase();
    if (host === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (url.pathname === '/watch') return url.searchParams.get('v') || '';
      const parts = url.pathname.split('/').filter(Boolean);
      if (['shorts', 'live', 'embed'].includes(parts[0])) return parts[1] || '';
    }
  } catch {
    return '';
  }
  return '';
}

function youtubeWatchUrl(videoId) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function youtubeText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.simpleText === 'string') return value.simpleText;
  if (Array.isArray(value.runs)) return value.runs.map((run) => run.text || '').join('');
  if (Array.isArray(value)) return value.map(youtubeText).filter(Boolean).join(' ');
  return '';
}

function parseViewCount(value) {
  const text = String(value || '').replace(/,/g, '').toLowerCase();
  const ko = text.match(/조회수\s*([\d.]+)\s*(천|만|억)?/);
  if (ko) {
    const base = Number(ko[1]);
    const unit = ko[2] === '억' ? 100000000 : ko[2] === '만' ? 10000 : ko[2] === '천' ? 1000 : 1;
    return Number.isFinite(base) ? Math.round(base * unit) : 0;
  }
  const en = text.match(/([\d.]+)\s*([kmb])?\s*views?/i);
  if (en) {
    const base = Number(en[1]);
    const unit = en[2] === 'b' ? 1000000000 : en[2] === 'm' ? 1000000 : en[2] === 'k' ? 1000 : 1;
    return Number.isFinite(base) ? Math.round(base * unit) : 0;
  }
  return /no views?|조회수\s*없음/.test(text) ? 0 : 0;
}

function extractBalancedJson(text, startIndex) {
  const start = String(text || '').indexOf('{', startIndex);
  if (start < 0) return '';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  return '';
}

function parseYtInitialData(html) {
  const text = String(html || '');
  const markerIndex = text.search(/(?:var\s+)?ytInitialData\s*=/);
  if (markerIndex < 0) return null;
  const json = extractBalancedJson(text, markerIndex);
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function collectYouTubeRenderers(node, out = []) {
  if (!node || out.length > 80) return out;
  if (Array.isArray(node)) {
    node.forEach((item) => collectYouTubeRenderers(item, out));
    return out;
  }
  if (typeof node !== 'object') return out;
  if (node.videoRenderer) out.push(node.videoRenderer);
  Object.values(node).forEach((value) => collectYouTubeRenderers(value, out));
  return out;
}

function normalizeYouTubeRenderer(renderer) {
  const videoId = renderer && renderer.videoId ? String(renderer.videoId) : '';
  if (!videoId) return null;
  const title = cleanText(youtubeText(renderer.title) || youtubeText(renderer.headline) || 'YouTube video', 240);
  const channel = cleanText(youtubeText(renderer.ownerText) || youtubeText(renderer.longBylineText) || youtubeText(renderer.shortBylineText), 160);
  const published = cleanText(youtubeText(renderer.publishedTimeText), 120);
  const viewsText = cleanText(youtubeText(renderer.viewCountText) || youtubeText(renderer.shortViewCountText), 120);
  const description = cleanText(youtubeText(renderer.detailedMetadataSnippets) || youtubeText(renderer.descriptionSnippet), 500);
  const viewCount = parseViewCount(viewsText);
  const snippet = [
    channel ? `채널: ${channel}` : '',
    published ? `게시: ${published}` : '',
    viewsText,
    description
  ].filter(Boolean).join(' · ');
  return {
    title,
    url: youtubeWatchUrl(videoId),
    snippet: cleanText(snippet, 700),
    viewCount
  };
}

function extractYouTubeResults(html, limit = 10) {
  const initialData = parseYtInitialData(html);
  const renderers = collectYouTubeRenderers(initialData);
  const results = [];
  const seen = new Set();
  for (const renderer of renderers) {
    const item = normalizeYouTubeRenderer(renderer);
    if (!item || seen.has(item.url)) continue;
    seen.add(item.url);
    results.push(item);
    if (results.length >= Math.max(limit, 20)) break;
  }
  return results.slice(0, Math.max(limit, 1));
}

async function searchYouTube(query, limit = 10) {
  const url = youtubeSearchUrl(query);
  const response = await axios.get(url, {
    timeout: Math.min(RESEARCH_TIMEOUT_MS, 15000),
    responseType: 'text',
    httpAgent: RESEARCH_HTTP_AGENT,
    httpsAgent: RESEARCH_HTTPS_AGENT,
    proxy: false,
    maxContentLength: 3 * 1024 * 1024,
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml'
    }
  });
  return extractYouTubeResults(response.data, limit);
}

function shouldSortYouTubeByViews(query) {
  return /조회수|인기|높은\s*순|많은\s*순|view|popular|top/i.test(String(query || ''));
}

function youtubeSearchQueryFromText(query) {
  const original = cleanText(query, 300);
  const cleaned = cleanText(original
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/(?:^|\s)(?:유튜브|유투브)(?:에서도|에서|으로|로|의|를|도)?/gi, ' ')
    .replace(/\b(?:youtube|yt)\b/gi, ' ')
    .replace(/\d{1,2}\s*(?:개|가지|건|편|위|videos?|items?)?/gi, ' ')
    .replace(/(?:조회수|인기|높은\s*순서?|높은\s*순|많은\s*순|순서|정렬|top|popular|views?)/gi, ' ')
    .replace(/(?:찾아(?:와|서|줘)?|검색(?:해|해서|해줘)?|가져와서?|요약(?:해|해서|해줘)?|정리(?:해|해서|해줘)?|분석(?:해|해서|해줘)?)/g, ' '), 180);
  return cleaned || original;
}

async function runYouTubeResearch(query, options = {}) {
  const cleanQuery = cleanText(query, 300);
  if (!cleanQuery) throw new Error('QUERY_REQUIRED');
  if (options.mock || /QA_AUTO_RESEARCH_(FIXTURE|EMPTY|ERROR)/i.test(cleanQuery)) {
    return mockYouTubeResearchResults(cleanQuery);
  }

  const limit = Math.max(1, Math.min(Number(options.limit) || 5, 10));
  const searchQuery = youtubeSearchQueryFromText(cleanQuery);
  const fallbackSearch = {
    title: `YouTube Search: ${searchQuery}`,
    url: youtubeSearchUrl(searchQuery),
    snippet: 'YouTube 검색 페이지를 직접 열어 확인할 수 있습니다.'
  };
  const report = {
    ok: true,
    query: cleanQuery,
    mode: 'youtube-web-search',
    status: 'pending',
    searchedAt: nowIso(),
    results: [],
    sources: [],
    count: 0,
    error: ''
  };

  try {
    const directResults = extractResearchUrls(cleanQuery)
      .filter(isYouTubeUrl)
      .slice(0, limit)
      .map((url) => ({ title: `YouTube: ${url}`, url, snippet: '사용자가 제공한 YouTube 링크입니다.', viewCount: 0 }));
    let results = directResults.length ? directResults : await searchYouTube(searchQuery, Math.max(limit * 2, 10));
    if (shouldSortYouTubeByViews(cleanQuery)) {
      results = results.slice().sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
    }
    report.results = results.slice(0, limit);
    if (!report.results.length) {
      report.results = [fallbackSearch];
      report.error = 'YouTube 검색 결과를 파싱하지 못해 YouTube 검색 링크를 제공합니다.';
    }
    report.sources = Array.from(new Set(report.results.map((item) => item.url).filter(Boolean)));
    report.count = report.results.length;
    report.status = report.error ? 'empty' : 'ok';
  } catch (error) {
    report.status = 'error';
    report.error = error.message || String(error);
    report.results = [fallbackSearch];
    report.sources = [fallbackSearch.url];
    report.count = 1;
  }
  return report;
}

async function runAutoResearch(query, options = {}) {
  const cleanQuery = cleanText(query, 300);
  if (!cleanQuery) throw new Error('QUERY_REQUIRED');
  let source = cleanText(options.source || '', 30).toLowerCase();
  if (!source) source = researchSourceFromText(cleanQuery);
  if (source === 'x' || source === 'twitter') {
    return runXSubscriptionResearch(cleanQuery, options, options.config || getConfig());
  }
  if (source === 'threads' || source === 'thread') {
    return runThreadsResearch(cleanQuery, options);
  }
  if (source === 'instagram' || source === 'ig') {
    return runInstagramResearch(cleanQuery, options);
  }
  if (source === 'linkedin' || source === 'li') {
    return runLinkedInResearch(cleanQuery, options);
  }
  if (source === 'youtube' || source === 'yt') {
    return runYouTubeResearch(cleanQuery, options);
  }
  if (options.mock || /QA_AUTO_RESEARCH_(FIXTURE|EMPTY|ERROR)/i.test(cleanQuery)) {
    const mockMode = options.mock === 'empty' || /QA_AUTO_RESEARCH_EMPTY/i.test(cleanQuery)
      ? 'empty'
      : options.mock === 'error' || /QA_AUTO_RESEARCH_ERROR/i.test(cleanQuery)
        ? 'error'
        : 'ok';
    return mockResearchResults(cleanQuery, mockMode);
  }
  const limit = Math.max(1, Math.min(Number(options.limit) || 4, 10));
  const fetchPages = options.fetchPages !== false;
  const report = { ok: true, query: cleanQuery, mode: 'duckduckgo-html', status: 'pending', searchedAt: nowIso(), results: [], sources: [], count: 0, error: '' };
  try {
    report.results = await filterSafeResearchResults(await searchWeb(cleanQuery, limit));
    if (fetchPages) {
      for (const item of report.results.slice(0, 3)) {
        item.excerpt = await fetchResearchPage(item.url);
      }
    }
    report.sources = report.results.map((item) => item.url).filter(Boolean);
    report.count = report.results.length;
    report.status = report.results.length ? 'ok' : 'empty';
    if (!report.results.length) report.error = '검색 결과가 없습니다.';
  } catch (error) {
    report.status = 'error';
    report.error = error.message || String(error);
  }
  return report;
}

function taskNeedsAutoResearch(task) {
  const text = `${task.title || ''}\n${task.description || ''}`.toLowerCase();
  return task.agent === 'researcher'
    || Boolean(researchSourceFromAgent(task.agent))
    || Boolean(researchSourceFromText(text))
    || /리서치|조사|검색|뉴스|최근|오늘|현재|트렌드|자료|출처|근거|fact|research|news|web|source/.test(text);
}

function researchSourceFromAgent(agent) {
  if (String(agent || '').toLowerCase() === 'instagram') return 'instagram';
  return '';
}

function researchSourceFromText(text) {
  const value = String(text || '');
  if (/instagram\.com|(?:^|\s)(?:인스타\s*그램|인스타)(?:에서|로|를|의|$)|\binstagram\b|\big\b/i.test(value)) {
    return 'instagram';
  }
  if (/linkedin\.com|(?:^|\s)(?:링크드인|링크드\s*인)(?:에서|로|를|의|$)|\blinkedin\b/i.test(value)) {
    return 'linkedin';
  }
  if (/youtube\.com|youtu\.be|(?:^|\s)(?:유튜브|유투브)(?:에서|로|를|의|$)|\byoutube\b|\byt\b/i.test(value)) {
    return 'youtube';
  }
  if (/threads\.net|메타\s*(?:쓰레드|스레드)|(?:^|\s)(?:쓰레드|스레드)(?:에서|로|를|의|$)|\bmeta\s+threads\b/i.test(value)) {
    return 'threads';
  }
  if (/\b(?:twitter|x\.com)\b|(?:^|\s)X에서|트위터|엑스\s*검색|x\s*search/i.test(value)) {
    return 'x';
  }
  return '';
}

function requestedResearchLimit(text, fallback = 4) {
  const value = String(text || '');
  const matches = [
    ...value.matchAll(/\btop\s*(\d{1,2})\b/gi),
    ...value.matchAll(/(\d{1,2})\s*(?:개|가지|건|편|위|videos?|items?)(?=$|[^\p{L}\p{N}_])/giu)
  ]
    .map((match) => Number(match[1]))
    .filter((number) => Number.isFinite(number) && number > 0);
  const requested = matches.length ? Math.max(...matches) : fallback;
  return Math.max(1, Math.min(requested, 10));
}

async function researchForTask(task) {
  if (!taskNeedsAutoResearch(task)) return null;
  try {
    const query = cleanText(`${task.title || ''} ${task.description || ''}`, 300);
    const source = researchSourceFromText(query) || researchSourceFromAgent(task.agent);
    const report = await runAutoResearch(query, {
      limit: requestedResearchLimit(query, 4),
      fetchPages: true,
      mock: /QA_AUTO_RESEARCH_FIXTURE/i.test(query),
      source
    });
    return report.results.length ? report : null;
  } catch {
    return null;
  }
}

async function researchForChat(message, agent = '') {
  const source = researchSourceFromText(message) || researchSourceFromAgent(agent);
  const needsResearch = Boolean(source)
    || /리서치|조사|검색|뉴스|최근|오늘|현재|트렌드|자료|출처|근거|fact|research|news|web|source/.test(String(message || '').toLowerCase());
  if (!needsResearch) return null;
  try {
    const query = cleanText(message, 300);
    const report = await runAutoResearch(query, {
      limit: requestedResearchLimit(query, source === 'youtube' ? 5 : 4),
      fetchPages: true,
      mock: /QA_AUTO_RESEARCH_FIXTURE/i.test(query),
      source
    });
    return report.results.length ? report : null;
  } catch {
    return null;
  }
}

function formatResearchContext(report) {
  if (!report || !Array.isArray(report.results) || !report.results.length) return '';
  const lines = [
    '자동 리서치 자료:',
    ...report.results.slice(0, 4).map((item, index) => [
      `${index + 1}. ${item.title}`,
      `URL: ${item.url}`,
      item.snippet ? `요약: ${item.snippet}` : '',
      item.excerpt ? `본문 발췌: ${item.excerpt.slice(0, 900)}` : ''
    ].filter(Boolean).join('\n'))
  ];
  return lines.join('\n\n');
}

function buildResearchFallbackResult(report, error) {
  const results = Array.isArray(report && report.results) ? report.results : [];
  const sources = Array.from(new Set([
    ...((report && Array.isArray(report.sources)) ? report.sources : []),
    ...results.map((item) => item && item.url).filter(Boolean)
  ]));
  const lines = [
    '자동 리서치 결과를 저장했습니다.',
    researchFallbackReason(error),
    '',
    ...results.slice(0, 4).map((item, index) => [
      `${index + 1}. ${item.title || item.url || '리서치 결과'}`,
      item.url ? `URL: ${item.url}` : '',
      item.snippet ? `요약: ${item.snippet}` : '',
      item.excerpt ? `본문 발췌: ${item.excerpt.slice(0, 600)}` : ''
    ].filter(Boolean).join('\n'))
  ];
  return {
    text: cleanText(lines.join('\n'), 12000),
    sources
  };
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

function localLlmHeaders(config) {
  const apiKey = cleanSecret(config && config.llmApiKey, 3000);
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

function preferredGrokChatModel(models, fallback = GROK_PROXY_MODEL) {
  const list = Array.isArray(models) ? models : [];
  return list.find((model) => model === fallback)
    || list.find((model) => /grok/i.test(model) && !/image|imagine|video|composer/i.test(model))
    || fallback;
}

async function listLocalModels(config) {
  if (isLmStudio(config.ollamaBase)) {
    const url = `${lmBase(config.ollamaBase)}/v1/models`;
    const response = await axios.get(url, {
      timeout: 3500,
      headers: localLlmHeaders(config)
    });
    return (response.data && response.data.data || []).map((model) => model.id).filter(Boolean);
  }
  const response = await axios.get(`${config.ollamaBase}/api/tags`, { timeout: 3500 });
  return (response.data && response.data.models || []).map((model) => model.name).filter(Boolean);
}

async function getGrokProxyStatus(config = getConfig()) {
  const command = await findCommand([
    'cli-proxy-api',
    'cliproxyapi',
    '/opt/homebrew/bin/cli-proxy-api',
    '/opt/homebrew/bin/cliproxyapi',
    '/usr/local/bin/cli-proxy-api',
    '/usr/local/bin/cliproxyapi'
  ]);
  const status = {
    ok: true,
    ...GROK_PROXY,
    installed: Boolean(command),
    command,
    running: false,
    authConfigured: Boolean(config.llmApiKey),
    models: [],
    error: ''
  };
  try {
    status.models = await listLocalModels({ ...config, ollamaBase: GROK_PROXY.base });
    status.running = true;
    status.model = preferredGrokChatModel(status.models, status.model);
  } catch (error) {
    status.error = modelErrorMessage(error);
  }
  return status;
}

function isEmbeddingModel(model) {
  return /embed|embedding/i.test(String(model || ''));
}

function isNonChatModel(model) {
  return isEmbeddingModel(model) || /image|imagine|video|composer/i.test(String(model || ''));
}

function parseModelRef(value) {
  const raw = String(value || '').trim();
  if (raw.startsWith('openai:')) return { provider: 'openai', model: raw.slice('openai:'.length) };
  if (raw.startsWith('zai:')) return { provider: 'zai', model: raw.slice('zai:'.length) };
  if (raw.startsWith('moonshot:')) return { provider: 'moonshot', model: raw.slice('moonshot:'.length) };
  if (raw.startsWith('xai:')) return { provider: 'xai', model: raw.slice('xai:'.length) };
  if (raw.startsWith('local:')) return { provider: 'local', model: raw.slice('local:'.length) };
  return { provider: 'local', model: raw };
}

function modelRef(provider, model) {
  return `${provider}:${String(model || '').trim()}`;
}

function firstChatModel(models, preferred) {
  const preferredRef = parseModelRef(preferred);
  if (preferredRef.provider === 'local' && preferredRef.model && !isNonChatModel(preferredRef.model)) {
    return preferredRef.model;
  }
  return (models || []).find((model) => !isNonChatModel(model)) || '';
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
    localResult.value.filter((model) => !isNonChatModel(model)).forEach((model) => {
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

  models.push(...PAID_MODELS
    .filter((model) => !(providerConfig(model.provider) || {}).hidden)
    .map((model) => ({ ...model })));
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
      `전문성: ${selected.specialty || ''}\n` +
      `답변: 한국어, 결론 먼저, 짧고 실행 가능하게.\n` +
      `${CONNECT_AI_OPERATING_POLICY}\n` +
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
  if (provider === 'xai') return 'Grok 4.3';
  return isLmStudio(config.ollamaBase) ? 'LM Studio' : 'Ollama';
}

function providerBase(provider, config) {
  if (provider === 'openai') return OPENAI_API_BASE;
  if (provider === 'zai') return ZAI_API_BASE;
  if (provider === 'moonshot') return MOONSHOT_API_BASE;
  if (provider === 'xai') return XAI_API_BASE;
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
  if ((status === 402 || status === 403 || status === 429)
    && /insufficient|balance|billing|recharge|quota|credit|licen[cs]e|purchase|payment|suspended/.test(detail)) {
    return 'billing';
  }
  if ((status === 401 || status === 403)
    || /invalid api key|unauthorized|forbidden|permission|auth/.test(detail)) {
    return 'auth';
  }
  if (error && error.code === 'ECONNABORTED') return 'timeout';
  return '';
}

function isGrokProxyAuthUnavailable(error) {
  const detail = rawModelErrorDetail(error).toLowerCase();
  return /auth_unavailable|no auth available/.test(detail);
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
  if (isGrokProxyAuthUnavailable(error)) {
    return `Grok OAuth Proxy 인증 세션을 사용할 수 없습니다. API 패널의 Grok Proxy 버튼을 다시 누르거나 터미널에서 ${GROK_PROXY.loginCommand}를 실행해 xAI OAuth 로그인을 갱신해 주세요. (${detail})`;
  }
  if (error && error.code === 'ECONNABORTED') {
    return `모델 응답 시간이 초과되었습니다. (${detail})`;
  }
  return status ? `LLM ${status}: ${detail}` : detail;
}

function researchFallbackReason(error) {
  const kind = modelErrorKind(error);
  if (kind === 'billing') return 'LLM 결제/잔액 상태 때문에 답변 생성이 차단되었습니다.';
  if (kind === 'unsupported') return '선택한 모델이 현재 인증 경로에서 지원되지 않아 답변 생성이 중단되었습니다.';
  if (kind === 'auth') return 'LLM 인증 상태 때문에 답변 생성이 중단되었습니다.';
  if (kind === 'timeout' || (error && error.code === 'ECONNABORTED')) return 'LLM 응답 시간이 초과되어 답변 생성이 중단되었습니다.';
  return 'LLM 호출 실패로 답변 생성이 중단되었습니다.';
}

async function callModel(config, payload) {
  const selectedModel = parseModelRef(payload.model || config.defaultModel);
  let model = selectedModel.model;
  if (selectedModel.provider === 'local' && isGrokProxyBase(config.ollamaBase) && /grok/i.test(model) && isNonChatModel(model)) {
    model = GROK_PROXY_MODEL;
  }
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

    if (selectedModel.provider === 'xai') {
      const credential = providerCredential('xai');
      if (!credential.token) {
        const error = new Error('Grok / xAI API Key가 필요합니다.');
        error.code = 'XAI_AUTH_REQUIRED';
        throw error;
      }
      const response = await axios.post(`${XAI_API_BASE}/chat/completions`, {
        model,
        messages: nextMessages,
        max_tokens: maxTokens,
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
      const url = `${lmBase(config.ollamaBase)}/v1/chat/completions`;
      const body = {
        model,
        messages: nextMessages,
        temperature: 0.4,
        max_tokens: maxTokens,
        reasoning: { effort: 'none' },
        stream: false
      };
      const request = () => axios.post(url, body, {
        timeout: requestTimeout,
        headers: localLlmHeaders(config)
      });
      let response;
      try {
        response = await request();
      } catch (error) {
        if (!isGrokProxyBase(config.ollamaBase) || !isGrokProxyAuthUnavailable(error)) throw error;
        await listLocalModels({ ...config, ollamaBase: GROK_PROXY.base });
        response = await request();
      }
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
  const research = await researchForTask(task);
  const researchContext = formatResearchContext(research);
  const researchSources = research && Array.isArray(research.sources) ? research.sources : [];
  const taskPrompt = researchContext
    ? `${buildTaskPrompt(task)}\n\n${researchContext}\n\n위 자동 리서치 자료의 URL을 근거로 최종 답변에 핵심 근거를 반영하세요.`
    : buildTaskPrompt(task);
  let primary;
  try {
    primary = await callModel(config, {
      agent: task.agent || 'ceo',
      messages: [
        {
          role: 'system',
          content: researchContext
            ? `You are a concise Korean research executor. Return only the final answer in Korean. Use the provided research sources and do not invent facts beyond them. Never write reasoning, analysis, or thinking process.\n\n${CONNECT_AI_OPERATING_POLICY}`
            : `You are a concise Korean task executor. Return only the final answer. Never write reasoning, analysis, or thinking process. If live web data is required and unavailable, say that live lookup is required instead of guessing.\n\n${CONNECT_AI_OPERATING_POLICY}`
        },
        { role: 'user', content: `${taskPrompt}\n\n결과:` }
      ],
      message: task.title || '',
      model: config.defaultModel,
      useBrain: false,
      maxTokens: researchContext ? 700 : 220,
      chatTimeoutMs: timeoutMs
    });
  } catch (error) {
    if (researchContext) return buildResearchFallbackResult(research, error);
    throw error;
  }
  if (primary.text && primary.text.trim()) {
    return {
      ...primary,
      sources: Array.from(new Set([...(primary.sources || []), ...researchSources]))
    };
  }

  let fallback;
  try {
    fallback = await callModel(config, {
      agent: task.agent || 'ceo',
      messages: [{
        role: 'user',
        content:
          `${taskPrompt}\n\n` +
          '위 작업의 최종 답변만 한국어로 작성해 주세요. 추론 과정은 쓰지 마세요. ' +
          (researchContext
            ? '제공된 자동 리서치 자료의 근거를 반영하고, 없는 내용은 추측하지 마세요.'
            : '실시간 웹/소셜 데이터 조회가 필요하지만 사용할 수 없다면, "실시간 조회가 필요합니다"라고 명확히 답하세요.')
      }],
      message: task.title || '',
      model: config.defaultModel,
      useBrain: false,
      maxTokens: researchContext ? 700 : 220,
      chatTimeoutMs: timeoutMs
    });
  } catch (error) {
    if (researchContext) return buildResearchFallbackResult(research, error);
    throw error;
  }
  return {
    ...fallback,
    sources: Array.from(new Set([...(fallback.sources || []), ...(primary.sources || []), ...researchSources]))
  };
}

function markTaskRunning(state, task, trigger = 'manual') {
  const startedAt = nowIso();
  task.status = 'running';
  task.startedAt = task.startedAt || startedAt;
  task.updatedAt = startedAt;
  task.runTrigger = trigger;
  delete task.error;
  delete task.result;
  delete task.sources;
  delete task.failedAt;
  delete task.staleRecoveredAt;
  pushEvent(state, trigger === 'manual' ? 'task.running' : 'task.autorun', `작업 실행 시작: ${task.title}`, { agent: task.agent });
}

function finishTaskSuccess(state, task, result) {
  const text = cleanText(result && result.text, 12000);
  if (!text) throw new Error('모델이 빈 응답을 반환했습니다.');
  if (looksLikeReasoningText(text)) {
    throw new Error('모델이 최종 답변 대신 추론 과정을 반환했습니다. reasoning 비활성 옵션이나 모델 설정을 확인해 주세요.');
  }
  task.status = 'done';
  task.result = text;
  task.sources = Array.isArray(result.sources) ? result.sources : [];
  task.completedAt = nowIso();
  task.updatedAt = task.completedAt;
  delete task.error;
  delete task.failedAt;
  pushEvent(state, 'task.completed', `작업 완료: ${task.title}`, { agent: task.agent });
}

function finishTaskFailure(state, task, error) {
  task.status = 'failed';
  task.error = modelErrorMessage(error);
  task.failedAt = nowIso();
  task.updatedAt = task.failedAt;
  delete task.result;
  delete task.sources;
  pushEvent(state, 'task.failed', `작업 실패: ${task.error}`, { agent: task.agent });
}

async function runTaskToTerminal(config, id, trigger = 'manual') {
  const state = loadState();
  const task = state.tasks.find((item) => item.id === id);
  if (!task) {
    const error = new Error('TASK_NOT_FOUND');
    error.statusCode = 404;
    throw error;
  }
  if (task.source === 'company') {
    const error = new Error('COMPANY_TASK_READ_ONLY');
    error.statusCode = 400;
    throw error;
  }
  if (!isActiveTaskStatus(task.status) && task.status !== 'running') return enrichTask(task);

  markTaskRunning(state, task, trigger);
  saveState(state);

  try {
    const result = await runTaskWithModel(config, task);
    const latest = loadState();
    const latestTask = latest.tasks.find((item) => item.id === id);
    if (!latestTask) {
      const error = new Error('TASK_NOT_FOUND');
      error.statusCode = 404;
      throw error;
    }
    if (latestTask.status === 'cancelled') return enrichTask(latestTask);
    finishTaskSuccess(latest, latestTask, result);
    saveState(latest);
    return enrichTask(latestTask);
  } catch (error) {
    const latest = loadState();
    const latestTask = latest.tasks.find((item) => item.id === id);
    if (latestTask) {
      finishTaskFailure(latest, latestTask, error);
      saveState(latest);
      return enrichTask(latestTask);
    }
    throw error;
  }
}

function scheduleTaskRun(config, id, trigger = 'auto') {
  if (!id) return null;
  if (taskRunQueue.has(id)) return taskRunQueue.get(id);
  const run = runTaskToTerminal(config, id, trigger)
    .catch((error) => {
      console.warn(`[task:${id}] auto run failed: ${modelErrorMessage(error)}`);
      return null;
    })
    .finally(() => {
      taskRunQueue.delete(id);
    });
  taskRunQueue.set(id, run);
  return run;
}

async function testLlmConnection(config, payload = {}) {
  const effective = {
    ...config,
    ollamaBase: String(payload.ollamaBase || config.ollamaBase).replace(/\/+$/, ''),
    defaultModel: String(payload.model || payload.defaultModel || config.defaultModel || ''),
    chatTimeoutMs: Math.max(1000, Math.min(Number(payload.chatTimeoutMs || 12000), config.timeoutMs))
  };
  effective.defaultModel = normalizeDefaultModelForConfig(effective.ollamaBase, effective.defaultModel);
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
    billingUrl: selectedRef.provider === 'openai' || selectedRef.provider === 'zai' || selectedRef.provider === 'moonshot' || selectedRef.provider === 'xai'
      ? (providerConfig(selectedRef.provider).billingUrl || '')
      : '',
    flowId: '',
    errorKind: '',
    error: '',
    text: ''
  };

  if (selectedRef.provider === 'openai' || selectedRef.provider === 'zai' || selectedRef.provider === 'moonshot' || selectedRef.provider === 'xai') {
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
          : selectedRef.provider === 'moonshot'
            ? 'Kimi 2.6 / Moonshot API Key가 필요합니다.'
            : 'Grok / xAI API Key가 필요합니다.';
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

function agentRecordMatches(record, agentId) {
  if (!record || !agentId) return false;
  if (record.agent === agentId) return true;
  return Array.isArray(record.agentIds) && record.agentIds.includes(agentId);
}

function estimateRunTokens(task, index) {
  const textLength = String(`${task.title || ''}\n${task.description || ''}\n${task.result || ''}`).length;
  return Math.max(240, Math.min(16000, Math.round(textLength * 1.8) + 320 + index * 45));
}

function estimateRunCostCents(task, index) {
  const tokens = estimateRunTokens(task, index);
  const priorityFactor = task.priority === 'urgent' ? 1.6 : task.priority === 'high' ? 1.25 : 1;
  return Math.max(1, Math.round((tokens / 1000) * 4 * priorityFactor));
}

function managementSkillList(agent, profile) {
  const skills = Array.isArray(profile.skills) ? profile.skills : [];
  const specialty = String(agent.specialty || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  return Array.from(new Set([...skills, ...specialty, 'Second Brain', '승인 게이트']));
}

function applyAgentManagementOverrides(management, rawOverrides) {
  const overrides = cleanAgentManagementPatch(rawOverrides);
  const next = {
    ...management,
    instructions: {
      ...(management.instructions || {}),
      ...(overrides.instructions || {})
    },
    settings: {
      ...(management.settings || {}),
      identity: {
        ...((management.settings || {}).identity || {}),
        ...((overrides.settings || {}).identity || {})
      },
      adapter: {
        ...((management.settings || {}).adapter || {}),
        ...((overrides.settings || {}).adapter || {})
      },
      heartbeat: {
        ...((management.settings || {}).heartbeat || {}),
        ...((overrides.settings || {}).heartbeat || {})
      },
      runtime: {
        ...((management.settings || {}).runtime || {}),
        ...((overrides.settings || {}).runtime || {})
      }
    },
    budget: {
      ...(management.budget || {}),
      ...(overrides.budget || {})
    },
    org: {
      ...(management.org || {}),
      ...(overrides.org || {})
    }
  };
  if (overrides.settings && overrides.settings.handoffTargets !== undefined) {
    next.settings.handoffTargets = overrides.settings.handoffTargets;
  }
  if (overrides.skills) next.skills = overrides.skills;

  next.overview = {
    ...(management.overview || {}),
    status: next.settings.heartbeat.enabled === false ? 'paused' : (management.overview || {}).status,
    adapterType: next.settings.adapter.type || (management.overview || {}).adapterType,
    model: next.settings.adapter.model || (management.overview || {}).model,
    modelProfile: next.settings.adapter.modelProfile || (management.overview || {}).modelProfile,
    heartbeatIntervalSec: next.settings.heartbeat.enabled === false ? 0 : next.settings.heartbeat.intervalSec
  };

  const monthlyCents = Math.max(0, Number(next.budget.monthlyCents) || 0);
  const spentCents = Math.max(0, Number(next.budget.spentCents) || 0);
  const percent = monthlyCents > 0 ? Math.round((spentCents / monthlyCents) * 100) : 0;
  next.budget = {
    ...next.budget,
    monthlyCents,
    spentCents,
    percent,
    softAlertPercent: Math.max(0, Number(next.budget.softAlertPercent) || 0),
    hardStopPercent: Math.max(0, Number(next.budget.hardStopPercent) || 0)
  };
  if (!next.budget.policy) {
    next.budget.policy = `${next.budget.softAlertPercent}% 소프트 알림, ${next.budget.hardStopPercent}% 하드 스톱`;
  }
  return next;
}

function buildAgentManagement(agent, config, tasks, approvals, sessions, events, agents, overrides = {}) {
  const cleanedOverrides = cleanAgentManagementPatch(overrides);
  const profile = AGENT_MANAGEMENT_PROFILES[agent.id] || {};
  const agentTasks = tasks.filter((task) => agentRecordMatches(task, agent.id));
  const agentApprovals = approvals.filter((approval) => agentRecordMatches(approval, agent.id));
  const agentSessions = sessions.filter((session) => session.agent === agent.id);
  const agentEvents = events.filter((event) => event.agent === agent.id || String(event.title || '').includes(agent.name));
  const monthlyBudgetCents = Math.max(0, Number(profile.monthlyBudgetCents || 25000));
  const runHistory = agentTasks.slice(0, 12).map((task, index) => ({
    id: task.id,
    title: task.title,
    status: task.status || 'open',
    invocationSource: task.runTrigger || (task.autoRun ? 'assignment' : 'manual'),
    createdAt: task.createdAt || '',
    updatedAt: task.updatedAt || '',
    completedAt: task.completedAt || '',
    inputTokens: Math.round(estimateRunTokens(task, index) * 0.72),
    outputTokens: Math.round(estimateRunTokens(task, index) * 0.28),
    costCents: estimateRunCostCents(task, index),
    summary: task.result || task.error || task.description || task.title || ''
  }));
  const spentMonthlyCents = Math.min(monthlyBudgetCents, runHistory.reduce((sum, run) => sum + run.costCents, 0));
  const budgetPercent = monthlyBudgetCents > 0 ? Math.round((spentMonthlyCents / monthlyBudgetCents) * 100) : 0;
  const orgOverride = cleanedOverrides.org || {};
  const reportsToId = orgOverride.reportsToId !== undefined ? orgOverride.reportsToId : (profile.reportsTo || '');
  const reportsToAgent = reportsToId ? agents.find((item) => item.id === reportsToId) || null : null;
  const directReports = Array.isArray(orgOverride.directReportIds)
    ? orgOverride.directReportIds
      .map((id) => agents.find((item) => item.id === id && item.id !== agent.id))
      .filter(Boolean)
      .map((item) => ({ id: item.id, name: item.name, role: item.role }))
    : agents
      .filter((item) => (AGENT_MANAGEMENT_PROFILES[item.id] || {}).reportsTo === agent.id)
      .map((item) => ({ id: item.id, name: item.name, role: item.role }));
  const importedSkillNames = new Set(Array.isArray(profile.skills) ? profile.skills : []);

  const baseManagement = {
    tabs: AGENT_MANAGER_TABS,
    source: PAPERCLIP_AGENT_MANAGEMENT_SOURCE,
    overview: {
      status: agent.active ? 'running' : 'paused',
      adapterType: profile.adapterType || 'connect_ai_local',
      model: config.defaultModel || 'local:grok-4.3',
      modelProfile: profile.modelProfile || 'general',
      heartbeatIntervalSec: 300,
      lastHeartbeatAt: agentEvents[0] ? agentEvents[0].createdAt : (agentTasks[0] ? agentTasks[0].updatedAt || agentTasks[0].createdAt : ''),
      sessionId: agentSessions[0] ? agentSessions[0].id : '',
      openTasks: agentTasks.filter((task) => isActiveTaskStatus(task.status)).length,
      approvalsPending: agentApprovals.filter((approval) => approval.status === 'pending').length
    },
    org: {
      reportsTo: reportsToAgent ? { id: reportsToAgent.id, name: reportsToAgent.name, role: reportsToAgent.role } : null,
      reportsToId: reportsToAgent ? reportsToAgent.id : '',
      directReports,
      directReportIds: directReports.map((item) => item.id)
    },
    instructions: {
      primary: Array.isArray(profile.instructions) ? profile.instructions : [],
      operatingPolicy: CONNECT_AI_OPERATING_POLICY
    },
    skills: managementSkillList(agent, profile).map((name) => ({
      name,
      status: 'enabled',
      source: importedSkillNames.has(name) ? 'Paperclip import' : 'Connect AI'
    })),
    settings: {
      identity: {
        name: agent.name,
        role: agent.role,
        title: agent.tagline || '',
        capabilities: agent.specialty || ''
      },
      adapter: {
        type: profile.adapterType || 'connect_ai_local',
        model: config.defaultModel || 'local:grok-4.3',
        temperature: profile.temperature ?? 0.35,
        contextMode: 'brain'
      },
      heartbeat: {
        enabled: agent.active,
        intervalSec: 300,
        wakeOnAssignment: true,
        wakeOnDemand: true,
        wakeOnAutomation: true,
        cooldownSec: 10
      },
      runtime: {
        timeoutSec: Math.round((config.chatTimeoutMs || 45000) / 1000),
        gracePeriodSec: 15,
        maxConcurrentRuns: 1
      },
      handoffTargets: Array.isArray(profile.handoffTargets) ? profile.handoffTargets : []
    },
    runs: runHistory,
    budget: {
      monthlyCents: monthlyBudgetCents,
      spentCents: spentMonthlyCents,
      percent: budgetPercent,
      softAlertPercent: 80,
      hardStopPercent: 100,
      policy: '80% 소프트 알림, 100% 하드 스톱'
    }
  };
  return applyAgentManagementOverrides(baseManagement, cleanedOverrides);
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

function shouldAutoRunTask(task) {
  if (!task || task.source === 'company') return false;
  if (taskRunQueue.has(task.id)) return false;
  if (task.status === 'running') return false;
  if (task.status !== 'open') return false;
  if (task.autoRun === true) return true;
  return taskProgress(task).percent >= 92;
}

function scheduleAutoRunnableTasks(state, config) {
  let scheduled = 0;
  state.tasks.forEach((task) => {
    if (!shouldAutoRunTask(task)) return;
    scheduled += 1;
    scheduleTaskRun(config, task.id, task.autoRun === true ? 'auto' : 'review-auto');
  });
  return scheduled;
}

function buildDashboard(config) {
  let state = loadState();
  if (recoverStaleRunningTasks(state, config)) saveState(state);
  if (scheduleAutoRunnableTasks(state, config)) state = loadState();
  seedBundledAnntarBrainSeeds(config.localBrainPath);
  const brain = walkBrain(config.localBrainPath, { limit: 500 });
  const tasks = listTasks(state, config);
  const approvals = listApprovals(state, config);
  const openTasks = tasks.filter((task) => isActiveTaskStatus(task.status));
  const pendingApprovals = approvals.filter((approval) => approval.status === 'pending');
  const companyState = readCompanyState(config);
  const activeAgents = readActiveAgents(config);
  const commandRoutes = openTasks
    .filter((task) => task.fromAgent && task.fromAgent !== task.agent)
    .map((task) => ({
      id: task.id,
      from: task.fromAgent,
      to: task.agent,
      title: task.title
    }));
  const baseAgents = AGENTS.map((agent) => {
    const local = getAgent(state, agent.id);
    const activeFlag = activeAgents[agent.id];
    const active = typeof activeFlag === 'boolean' ? activeFlag : local.active;
    return {
      ...local,
      active,
      openTasks: openTasks.filter((task) => task.agent === agent.id || (Array.isArray(task.agentIds) && task.agentIds.includes(agent.id))).length
    };
  });
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
  const agents = baseAgents.map((agent) => {
    const pos = officePositions[agent.id] || { x: 50, y: 50 };
    return {
      ...agent,
      x: pos.x,
      y: pos.y,
      management: buildAgentManagement(
        agent,
        config,
        tasks,
        approvals,
        state.sessions,
        state.events,
        baseAgents,
        (state.agentState[agent.id] || {}).management
      )
    };
  });
  return {
    ok: true,
    mode: 'standalone-web',
    version: require(path.join(ROOT, 'package.json')).version,
    company: companyState.name || companyState.companyName || 'Connect AI Company',
    config: publicConfig(config),
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
    commandRoutes,
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
    const fromAgent = AGENTS.some((item) => item.id === body.fromAgent) ? body.fromAgent : '';
    const task = {
      id: newId('task'),
      title,
      description: cleanText(body.description, 1000),
      agent,
      agentIds: [agent],
      fromAgent,
      priority: ['urgent', 'high', 'normal', 'low'].includes(body.priority) ? body.priority : 'normal',
      status: 'open',
      autoRun: body.autoRun === true,
      dueAt: cleanText(body.dueAt, 80),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      source: 'web'
    };
    state.tasks.unshift(task);
    pushEvent(state, 'task.created', `${getAgent(state, agent).name}에게 작업 등록: ${title}`, { agent });
    saveState(state);
    if (task.autoRun) scheduleTaskRun(config, task.id, 'auto');
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

    try {
      const running = taskRunQueue.get(id);
      const completedTask = running ? await running : await runTaskToTerminal(config, id, 'manual');
      if (!completedTask) {
        sendJson(res, 500, { ok: false, error: 'TASK_RUN_FAILED' });
        return true;
      }
      if (completedTask.status === 'failed') {
        sendJson(res, 502, { ok: false, error: completedTask.error || 'TASK_RUN_FAILED', task: completedTask });
        return true;
      }
      sendJson(res, 200, { ok: true, task: completedTask });
    } catch (error) {
      const status = error.statusCode || 502;
      sendJson(res, status, { ok: false, error: modelErrorMessage(error) });
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

  if (id && req.method === 'DELETE') {
    const index = state.tasks.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { ok: false, error: 'TASK_NOT_FOUND' });
      return true;
    }
    const [task] = state.tasks.splice(index, 1);
    pushEvent(state, 'task.deleted', `작업 삭제: ${task.title || id}`, { agent: task.agent });
    saveState(state);
    sendJson(res, 200, { ok: true });
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

  if (id && req.method === 'DELETE') {
    const index = state.approvals.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { ok: false, error: 'APPROVAL_NOT_FOUND' });
      return true;
    }
    const [approval] = state.approvals.splice(index, 1);
    pushEvent(state, 'approval.deleted', `승인 삭제: ${approval.title || id}`, { agent: approval.agent });
    saveState(state);
    sendJson(res, 200, { ok: true });
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
      management: body.management === undefined
        ? mergeAgentManagementPatch(current.management || {}, {})
        : mergeAgentManagementPatch(current.management || {}, body.management),
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
      config: publicConfig(config),
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

  if (req.method === 'GET' && pathname === '/api/llm/proxy/cliproxyapi') {
    sendJson(res, 200, await getGrokProxyStatus(config));
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

  if (req.method === 'GET' && pathname === '/api/research') {
    try {
      const query = cleanText(url.searchParams.get('q') || '', 300);
      const mockParam = cleanText(url.searchParams.get('mock') || '', 20);
      const mock = ['1', 'ok', 'empty', 'error'].includes(mockParam)
        ? (mockParam === '1' ? 'ok' : mockParam)
        : '';
      const source = cleanText(url.searchParams.get('source') || '', 30).toLowerCase();
      const limit = Math.max(1, Math.min(Number(url.searchParams.get('limit') || 4), 10));
      const report = await runAutoResearch(query, { mock, source, limit, fetchPages: url.searchParams.get('fetch') !== '0', config });
      sendJson(res, 200, report);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error.message || String(error), results: [], sources: [] });
    }
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
    sendJson(res, 200, { ok: true, config: publicConfig(config) });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/config') {
    try {
      const body = await readJsonBody(req);
      const local = readJson(LOCAL_CONFIG);
      const next = {
        ollamaBase: body.ollamaBase || config.ollamaBase,
        defaultModel: body.defaultModel || config.defaultModel,
        localBrainPath: expandHome(body.localBrainPath || config.localBrainPath),
        obsidianVaultPath: resolveObsidianVaultPath(body.obsidianVaultPath || config.obsidianVaultPath, body.localBrainPath || config.localBrainPath),
        timeoutMs: Number(body.timeoutMs || config.timeoutMs),
        chatTimeoutMs: Number(body.chatTimeoutMs || config.chatTimeoutMs)
      };
      next.defaultModel = normalizeDefaultModelForConfig(next.ollamaBase, next.defaultModel);
      const savedLlmApiKey = cleanSecret(body.llmApiKey || local.llmApiKey || local.localLlmApiKey || config.llmApiKey || '', 3000);
      if (savedLlmApiKey) next.llmApiKey = savedLlmApiKey;
      writeJson(LOCAL_CONFIG, next);
      brainCache.clear();
      sendJson(res, 200, { ok: true, config: publicConfig(getConfig()) });
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

      const research = await researchForChat(message, agent);
      const researchContext = formatResearchContext(research);
      const researchSources = research && Array.isArray(research.sources) ? research.sources : [];
      const result = await callModel(config, researchContext
        ? {
          ...body,
          message,
          agent,
          useBrain: false,
          maxTokens: Math.max(Number(body.maxTokens) || 700, 1000),
          messages: [
            {
              role: 'system',
              content: [
                'You are a concise Korean research assistant for Connect AI.',
                'Use the provided automatic research sources.',
                'Do not say you cannot access Instagram, Threads, X, YouTube, or web data when sources are provided.',
                'If the source is only a platform search URL, clearly say it is a search link rather than an individual post.',
                'Never invent post contents, authors, dates, or URLs.'
              ].join(' ')
            },
            {
              role: 'user',
              content: `${message}\n\n${researchContext}\n\n위 자료의 URL을 근거로 한국어로 요약해줘.`
            }
          ]
        }
        : { ...body, message, agent });
      result.sources = Array.from(new Set([...(result.sources || []), ...researchSources]));
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

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`Connect AI web app running at http://127.0.0.1:${PORT}`);
  });
}

module.exports = {
  extractDuckDuckGoResults,
  isFetchSafeResearchUrl,
  isPrivateResearchHost,
  isSafeResearchUrl,
  normalizeResearchHostname,
  normalizeResearchUrl,
  researchSafeLookup,
  researchSourceFromAgent,
  researchSourceFromText,
  requestedResearchLimit,
  getConfig,
  buildDashboard,
  loadState,
  saveState,
  publicConfig,
  AGENTS,
  handleApi,
  listModelOptions,
  testLlmConnection,
  callModel,
  readJson,
  writeJson,
  nowIso,
  newId,
  cleanText,
  cleanSecret,
  expandHome,
  walkBrain,
  termsFromMessage,
  runAutoResearch,
  listTasks,
  enrichTask,
  handleTasks,
  pushEvent,
  getAgent,
  modelErrorMessage,
  researchForChat,
  formatResearchContext,
  providerConfig,
  providerCredential,
  getProviderSummaries,
  getAuthStatus,
  createOAuthFlow,
  handleOAuthCallback,
  readLlmCredentials,
  writeLlmCredentials,
  readActiveAgents,
  listApprovals,
  normalizeDefaultModelForConfig,
  resolveObsidianVaultPath,
  isGrokProxyBase,
  lmBase,
  modelRef,
  LOCAL_CONFIG,
  DATA_DIR,
  STATE_FILE,
  LLM_CREDENTIALS_FILE,
  PROVIDERS,
  PAID_MODELS,
  OPENAI_API_BASE,
  ZAI_API_BASE,
  MOONSHOT_API_BASE,
  XAI_API_BASE,
  GROK_PROXY_BASE,
  GROK_PROXY_MODEL,
  GROK_PROXY,
  CHATGPT_RESPONSES_URL,
  CHATMOCK_OPENAI_CLIENT_ID,
  CHATMOCK_OPENAI_ISSUER,
  CHATMOCK_OPENAI_TOKEN_URL,
  CHATMOCK_CALLBACK_PORT,
  CHATMOCK_CALLBACK_BASE,
  RESEARCH_TIMEOUT_MS,
  RESEARCH_USER_AGENT,
  OPENAI_CHATMOCK_MODEL_FALLBACKS,
  AGENT_MANAGEMENT_PROFILES,
  CONNECT_AI_OPERATING_POLICY,
  PAPERCLIP_AGENT_MANAGEMENT_SOURCE,
  AGENT_MANAGER_TABS
};
