export const runtime = 'nodejs';

export async function GET() {
  const path = require('path');
  const legacy = __non_webpack_require__(path.resolve(process.cwd(), 'src/lib/server/legacy-server.js'));
  const config = legacy.getConfig();
  return Response.json(legacy.buildDashboard(config));
}
