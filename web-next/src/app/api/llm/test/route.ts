export const runtime = 'nodejs';

export async function POST(request: Request) {
  const path = require('path');
  const legacy = __non_webpack_require__(path.resolve(process.cwd(), 'src/lib/server/legacy-server.js'));
  const state = legacy.loadState();
  try {
    const body = await request.json();
    const config = legacy.getConfig();
    const result = await legacy.testLlmConnection(config, body);
    legacy.pushEvent(
      state,
      result.connected ? 'llm.test.ok' : 'llm.test.failed',
      result.connected
        ? `LLM 연결 성공: ${result.model}`
        : `LLM 연결 실패: ${result.error || result.model}`,
      { agent: 'ceo' }
    );
    legacy.saveState(state);
    return Response.json(result);
  } catch (error: any) {
    const message = legacy.modelErrorMessage(error);
    legacy.pushEvent(state, 'llm.test.failed', message, { agent: 'ceo' });
    legacy.saveState(state);
    return Response.json({ ok: true, connected: false, error: message, stages: [] });
  }
}
