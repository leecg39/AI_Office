export const runtime = 'nodejs';

export async function POST(request: Request) {
  const path = require('path');
  const legacy = __non_webpack_require__(path.resolve(process.cwd(), 'src/lib/server/legacy-server.js'));
  const state = legacy.loadState();
  let session: any = null;
  let agent = 'ceo';

  try {
    const body = await request.json();
    const message = legacy.cleanText(body.message, 8000);
    if (!message) {
      return Response.json({ ok: false, error: 'MESSAGE_REQUIRED' }, { status: 400 });
    }
    agent = legacy.AGENTS.some((item: any) => item.id === body.agent) ? body.agent : 'ceo';
    session = body.sessionId ? state.sessions.find((item: any) => item.id === body.sessionId) : null;
    if (!session) {
      session = {
        id: legacy.newId('ses'),
        title: message.slice(0, 40) || '새 대화',
        agent,
        createdAt: legacy.nowIso(),
        updatedAt: legacy.nowIso(),
        messages: []
      };
      state.sessions.unshift(session);
    }
    session.agent = agent;
    session.messages.push({
      id: legacy.newId('msg'),
      role: 'user',
      agent,
      content: message,
      createdAt: legacy.nowIso()
    });

    const research = await legacy.researchForChat(message, agent);
    const researchContext = legacy.formatResearchContext(research);
    const researchSources = research && Array.isArray(research.sources) ? research.sources : [];
    const result = await legacy.callModel(
      legacy.getConfig(),
      researchContext
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
        : { ...body, message, agent }
    );
    result.sources = Array.from(new Set([...(result.sources || []), ...researchSources]));
    const text =
      result.text ||
      '모델이 빈 응답을 반환했습니다. 모델 설정이나 컨텍스트 길이를 확인해 주세요.';
    session.messages.push({
      id: legacy.newId('msg'),
      role: 'assistant',
      agent,
      content: text,
      sources: result.sources,
      createdAt: legacy.nowIso()
    });
    session.updatedAt = legacy.nowIso();
    legacy.pushEvent(state, 'chat.completed', `${legacy.getAgent(state, agent).name} 응답 완료`, {
      agent
    });
    legacy.saveState(state);
    return Response.json({ ok: true, sessionId: session.id, text, sources: result.sources });
  } catch (error: any) {
    const errorText = legacy.modelErrorMessage(error);
    if (session) {
      session.messages.push({
        id: legacy.newId('msg'),
        role: 'assistant',
        agent,
        content: errorText,
        error: true,
        createdAt: legacy.nowIso()
      });
      session.updatedAt = legacy.nowIso();
    }
    legacy.pushEvent(state, 'chat.failed', errorText.slice(0, 220), { agent });
    legacy.saveState(state);
    const code = error && error.message === 'MODEL_REQUIRED' ? 400 : 502;
    return Response.json(
      { ok: false, sessionId: session ? session.id : '', error: errorText },
      { status: code }
    );
  }
}
