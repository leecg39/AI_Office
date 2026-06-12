export const runtime = 'nodejs';

function createMockReq(request: Request, bodyText: string, pathname: string) {
  const listeners: Record<string, ((...args: any[]) => void)[]> = {};
  return {
    method: request.method,
    url: pathname + new URL(request.url).search,
    headers: Object.fromEntries(request.headers.entries()),
    on(event: string, handler: (...args: any[]) => void) {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
      return this;
    },
    destroy() {},
    emit(event: string, ...args: any[]) {
      (listeners[event] || []).forEach((h) => h(...args));
    }
  };
}

async function handleTaskRequest(request: Request, { params }: { params: Promise<{ slug?: string[] }> }) {
  const path = require('path');
  const legacy = __non_webpack_require__(path.resolve(process.cwd(), 'src/lib/server/legacy-server.js'));
  const { slug = [] } = await params;
  const pathname = '/api/tasks' + (slug.length ? '/' + slug.join('/') : '');

  const bodyText = ['POST', 'PATCH', 'PUT'].includes(request.method || '') ? await request.text() : '';
  const fakeReq = createMockReq(request, bodyText, pathname) as any;
  const fakeRes = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader() { return this; },
    writeHead(code: number) { this.statusCode = code; return this; },
    end(body: string) {
      this.body = body;
      return this;
    },
    body: ''
  } as any;

  const handledPromise = legacy.handleTasks(fakeReq, fakeRes, pathname, legacy.getConfig());

  if (bodyText) {
    // Emit body after the legacy handler has attached stream listeners
    setTimeout(() => {
      fakeReq.emit('data', Buffer.from(bodyText));
      fakeReq.emit('end');
    }, 0);
  }

  const handled = await handledPromise;

  if (!handled) {
    return Response.json({ ok: false, error: 'NOT_HANDLED' }, { status: 404 });
  }

  const status = fakeRes.statusCode || 200;
  const data = fakeRes.body ? JSON.parse(fakeRes.body) : {};
  return Response.json(data, { status });
}

export const GET = handleTaskRequest;
export const POST = handleTaskRequest;
export const PATCH = handleTaskRequest;
export const DELETE = handleTaskRequest;
