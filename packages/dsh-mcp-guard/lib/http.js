/**
 * Loopback HTTP façade of dsh-mcp-guard.
 *
 * Registered as one exact webServer route. Trust is delegated to the Host:
 * the request must carry the plugin's intent header and pass
 * `ctx.connection.admit(req)` (signed-peer admission). Responses never include
 * user values, upstream diagnostics or secret material.
 */
import { ManagerError } from './errors.js';

export const ROUTE = '/api/dsh-mcp-guard';
export const HEADER = 'x-dsh-mcp-guard';
export const MAX_BODY_BYTES = 1024 * 1024;

function send(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new ManagerError('BODY_TOO_LARGE', 413);
    chunks.push(buffer);
  }
  if (size === 0) throw new ManagerError('INVALID_REQUEST', 400);
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new ManagerError('INVALID_REQUEST', 400);
    }
    return value;
  } catch (error) {
    if (error instanceof ManagerError) throw error;
    throw new ManagerError('INVALID_REQUEST', 400);
  }
}

function errorResponse(error, log) {
  if (error instanceof ManagerError) {
    return { status: error.status, code: error.code };
  }
  if (typeof error?.code === 'string') {
    // ValidationError / ImportError: stable code, never a message.
    return { status: typeof error.status === 'number' ? error.status : 400, code: error.code };
  }
  log?.('OPERATION_FAILED');
  return { status: 500, code: 'OPERATION_FAILED' };
}

/**
 * @param {object} deps
 * @param {object} deps.manager controller created by createManager()
 * @param {(req: object) => {peer?: unknown, rejection?: unknown}} deps.admit signed-peer admission
 * @param {(code: string) => void} [deps.log] value-free diagnostics
 */
export function createHandler({ manager, admit, log = () => {} }) {
  const actions = {
    analyze: (body) => manager.analyze(body),
    create: (body) => manager.create(body),
    update: (body) => manager.update(body),
    remove: (body) => manager.remove(body),
    toggle: (body) => manager.toggle(body),
    executionPreview: (body) => manager.executionPreview(body),
    check: (body) => manager.check(body),
    previewImport: (body) => manager.previewImport(body),
    import: (body) => manager.importServers(body),
    export: () => manager.export(),
    externalDetail: (body) => manager.externalDetail(body),
    adoptExternal: (body) => manager.adoptExternal(body),
    discover: () => manager.discoverConfigs(),
    importDiscovered: (body) => manager.importDiscovered(body),
  };

  return async function handler(req, res) {
    try {
      if (req.headers?.[HEADER] !== '1') {
        return send(res, 403, { ok: false, error: { code: 'FORBIDDEN' } });
      }
      let admission;
      try {
        admission = admit(req);
      } catch {
        admission = null;
      }
      if (!admission || !admission.peer || admission.rejection !== undefined) {
        return send(res, 401, { ok: false, error: { code: 'UNAUTHENTICATED' } });
      }
      if (req.method === 'GET') {
        const value = await manager.list();
        return send(res, 200, { ok: true, value });
      }
      if (req.method !== 'POST') {
        return send(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
      }
      const contentType = req.headers?.['content-type'];
      if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
        return send(res, 415, { ok: false, error: { code: 'CONTENT_TYPE' } });
      }
      const body = await readJson(req);
      const action = body.action;
      if (typeof action !== 'string' || !Object.hasOwn(actions, action)) {
        return send(res, 400, { ok: false, error: { code: 'INVALID_REQUEST' } });
      }
      const value = await actions[action](body);
      return send(res, 200, { ok: true, value });
    } catch (error) {
      const { status, code } = errorResponse(error, log);
      try {
        return send(res, status, { ok: false, error: { code } });
      } catch {
        // The connection may already be gone; nothing else to do.
        return undefined;
      }
    }
  };
}
