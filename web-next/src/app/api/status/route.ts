export const runtime = 'nodejs';

export async function GET() {
  const path = require('path');
  const legacy = __non_webpack_require__(path.resolve(process.cwd(), 'src/lib/server/legacy-server.js'));
  const config = legacy.getConfig();
  const dashboard = legacy.buildDashboard(config);
  return Response.json({
    ok: true,
    mode: dashboard.mode,
    version: dashboard.version,
    config: legacy.publicConfig(config),
    brain: dashboard.brain,
    agents: dashboard.agents
  });
}
