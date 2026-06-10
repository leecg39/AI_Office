export const runtime = 'nodejs';

export async function GET() {
  const path = require('path');
  const legacy = __non_webpack_require__(path.resolve(process.cwd(), 'src/lib/server/legacy-server.js'));
  const config = legacy.getConfig();
  try {
    const result = await legacy.listModelOptions(config);
    return Response.json({
      ok: true,
      models: result.models,
      errors: result.errors,
      defaultModel: config.defaultModel,
      auth: legacy.getAuthStatus()
    });
  } catch (error: any) {
    return Response.json(
      {
        ok: false,
        error: error.message || String(error),
        models: [],
        defaultModel: config.defaultModel,
        auth: legacy.getAuthStatus()
      },
      { status: 502 }
    );
  }
}
