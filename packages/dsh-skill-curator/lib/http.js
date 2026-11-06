/**
 * Loopback HTTP façade of dsh-skill-curator.
 *
 * Registered as one exact webServer route. Trust is delegated to the Host: the
 * request must carry the plugin's intent header and pass
 * `ctx.connection.admit(req)`. Responses never include file bodies for list
 * actions, never include secret material, and are always `no-store`.
 */
import { CuratorError } from './errors.js';

export const ROUTE = '/api/dsh-skill-curator';
export const HEADER = 'x-dsh-skill-curator';
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
    if (size > MAX_BODY_BYTES) throw new CuratorError('BODY_TOO_LARGE', 413);
    chunks.push(buffer);
  }
  if (size === 0) throw new CuratorError('INVALID_REQUEST', 400);
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new CuratorError('INVALID_REQUEST', 400);
    }
    return value;
  } catch (error) {
    if (error instanceof CuratorError) throw error;
    throw new CuratorError('INVALID_REQUEST', 400);
  }
}

function errorResponse(error, log) {
  if (error instanceof CuratorError) {
    const payload = { status: error.status, code: error.code };
    if (error.details !== undefined) payload.details = error.details;
    return payload;
  }
  if (typeof error?.code === 'string') {
    const payload = { status: typeof error.status === 'number' ? error.status : 400, code: error.code };
    if (error.details !== undefined) payload.details = error.details;
    return payload;
  }
  log?.('OPERATION_FAILED');
  return { status: 500, code: 'OPERATION_FAILED' };
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./catalog.js').createCatalog>} deps.manager
 * @param {(req: object) => {peer?: unknown, rejection?: unknown}} deps.admit
 * @param {(code: string) => void} [deps.log]
 */
export function createHandler({ manager, admit, log = () => {} }) {
  const actions = {
    snapshot: (body) => manager.snapshot(body),
    detail: (body) => manager.detail(body),
    readFile: (body) => manager.readFile(body),
    validate: (body) => manager.validateDraft(body),
    save: (body) => manager.saveSkill(body),
    writeFile: (body) => manager.writeFile(body),
    toggle: (body) => manager.toggleSkill(body),
    create: (body) => manager.createSkill(body),
    remove: (body) => manager.removeSkill(body),
    trashList: (body) => manager.listTrash(body),
    restore: (body) => manager.restoreTrash(body),
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
        const value = await manager.snapshot({});
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
      const { status, code, details } = errorResponse(error, log);
      try {
        const payload = details === undefined ? { code } : { code, details };
        return send(res, status, { ok: false, error: payload });
      } catch {
        return undefined;
      }
    }
  };
}
