export const runtime = 'nodejs';

export async function GET() {
  const path = require('path');
  const legacy = __non_webpack_require__(path.resolve(process.cwd(), 'src/lib/server/legacy-server.js'));
  return Response.json({ ok: true, config: legacy.publicConfig(legacy.getConfig()) });
}

export async function POST(request: Request) {
  const path = require('path');
  const legacy = __non_webpack_require__(path.resolve(process.cwd(), 'src/lib/server/legacy-server.js'));
  const body = await request.json();
  const config = legacy.getConfig();

  const local = legacy.readJson(legacy.LOCAL_CONFIG, {});
  const next: any = {
    ollamaBase: body.ollamaBase || config.ollamaBase,
    defaultModel: body.defaultModel || config.defaultModel,
    localBrainPath: legacy.expandHome(body.localBrainPath || config.localBrainPath),
    obsidianVaultPath: legacy.resolveObsidianVaultPath(
      body.obsidianVaultPath || config.obsidianVaultPath,
      body.localBrainPath || config.localBrainPath
    ),
    timeoutMs: Number(body.timeoutMs || config.timeoutMs),
    chatTimeoutMs: Number(body.chatTimeoutMs || config.chatTimeoutMs)
  };
  next.defaultModel = legacy.normalizeDefaultModelForConfig(next.ollamaBase, next.defaultModel);
  const savedLlmApiKey = legacy.cleanSecret(
    body.llmApiKey || local.llmApiKey || local.localLlmApiKey || config.llmApiKey || '',
    3000
  );
  if (savedLlmApiKey) next.llmApiKey = savedLlmApiKey;
  legacy.writeJson(legacy.LOCAL_CONFIG, next);

  return Response.json({ ok: true, config: legacy.publicConfig(legacy.getConfig()) });
}
