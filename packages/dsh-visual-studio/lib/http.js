/**
 * HTTP façade of dsh-visual-studio.
 *
 * Three exact routes under the plugin's own prefix:
 *
 *   GET  /plugins/dsh-visual-studio/manifest   JSON snapshot for the panel
 *   GET  /plugins/dsh-visual-studio/artifact   one stored HTML version
 *   POST /plugins/dsh-visual-studio/ask        the user's widget answer
 *
 * Trust is delegated to the Host: every route calls `ctx.connection.admit`
 * (the iframe document is same-origin and carries the session cookie, so it
 * passes without a custom header), and the mutating route additionally
 * requires the plugin's intent header. Published HTML is always served with a
 * sandboxing CSP, so even opening a visual in a separate browser tab keeps it
 * on an opaque origin with no network access.
 */
import { parseRevision } from './store.js';
import { normalizeAskAnswer, SpecError } from './spec.js';

export const HEADER = 'x-dsh-visual-studio';
export const MAX_BODY_BYTES = 256 * 1024;
export const ROUTE_MANIFEST = '/plugins/dsh-visual-studio/manifest';
export const ROUTE_ARTIFACT = '/plugins/dsh-visual-studio/artifact';
export const ROUTE_ASK = '/plugins/dsh-visual-studio/ask';

const ARTIFACT_CSP = [
  "sandbox allow-scripts",
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
].join('; ');

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  res.end(payload);
}

function sendText(res, status, text) {
  const payload = typeof text === 'string' ? text : String(text);
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
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
    if (size > MAX_BODY_BYTES) throw new SpecError('BODY_TOO_LARGE', 'request body is too large');
    chunks.push(buffer);
  }
  if (size === 0) throw new SpecError('INVALID_REQUEST', 'request body is empty');
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      throw new SpecError('INVALID_REQUEST', 'request body must be a JSON object');
    }
    return value;
  } catch (error) {
    if (error instanceof SpecError) throw error;
    throw new SpecError('INVALID_REQUEST', 'request body is not valid JSON');
  }
}

/** Browser-trust admission, tolerant to a Host that throws instead of returning. */
export function isAdmitted(admit, req) {
  if (typeof admit !== 'function') return true;
  try {
    const decision = admit(req);
    if (decision === undefined || decision === null) return true;
    if (typeof decision === 'object') {
      if (decision.rejection !== undefined && decision.rejection !== null) return false;
      if (decision.peer === undefined || decision.peer === null) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function intentHeaderOk(req) {
  return req.headers?.[HEADER] === '1';
}

/**
 * Build an ASCII-safe Content-Disposition value. Header values are Latin-1 only,
 * so a Cyrillic title travels in the RFC 5987 `filename*` parameter while the
 * plain `filename` keeps a readable fallback for older clients.
 */
function attachmentDisposition(title) {
  const fallback = String(title ?? 'visual')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
  const ascii = (fallback === '' ? 'visual' : fallback).replace(/\.html$/i, '');
  const encoded = encodeURIComponent(String(title ?? 'visual'))
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
    .slice(0, 300);
  return `attachment; filename="${ascii}.html"; filename*=UTF-8''${encoded}.html`;
}

function artifactHandler(store, previewKey, admit) {
  return async function handler(req, res) {
    if (req.method !== 'GET') return sendText(res, 405, 'method-not-allowed');
    const url = new URL(req.url ?? '/', 'http://dsh.local');
    // The panel embeds visuals in a sandboxed iframe and appends the capability
    // key from the manifest; a direct browser open also carries it. An admitted
    // peer may read the same route without the key (for example a future viewer).
    const authorized = isAdmitted(admit, req) || (typeof previewKey === 'string' && previewKey !== '' && url.searchParams.get('k') === previewKey);
    if (!authorized) return sendText(res, 403, 'forbidden');
    const id = url.searchParams.get('id') ?? '';
    const revision = parseRevision(url.searchParams.get('rev'));
    if (revision === null) return sendText(res, 400, 'invalid-revision');
    const version = await store.readVersion(id, revision ?? undefined);
    if (version === undefined) return sendText(res, 404, 'not-found');
    const headers = {
      'content-type': 'text/html; charset=utf-8',
      'content-length': Buffer.byteLength(version.html, 'utf8'),
      'cache-control': 'no-store',
      'content-security-policy': ARTIFACT_CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    };
    if (url.searchParams.get('download') === '1') {
      headers['content-disposition'] = attachmentDisposition(version.title);
    }
    res.writeHead(200, headers);
    res.end(version.html);
  };
}

function manifestHandler(store, admit, previewKey) {
  return async function handler(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
    if (!intentHeaderOk(req)) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN' } });
    if (!isAdmitted(admit, req)) return sendJson(res, 401, { ok: false, error: { code: 'UNAUTHENTICATED' } });
    const snapshot = await store.ensureReady();
    return sendJson(res, 200, { ok: true, value: { ...snapshot, previewKey } });
  };
}

function askHandler(asks, admit) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED' } });
    if (!intentHeaderOk(req)) return sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN' } });
    if (!isAdmitted(admit, req)) return sendJson(res, 401, { ok: false, error: { code: 'UNAUTHENTICATED' } });
    const contentType = req.headers?.['content-type'];
    if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return sendJson(res, 415, { ok: false, error: { code: 'CONTENT_TYPE' } });
    }
    try {
      const body = await readJson(req);
      const callId = typeof body.callId === 'string' ? body.callId : '';
      if (callId === '') return sendJson(res, 400, { ok: false, error: { code: 'MISSING_CALL_ID' } });
      const pending = asks.pendingFor(callId);
      if (pending === undefined) return sendJson(res, 409, { ok: false, error: { code: 'NOT_PENDING' } });
      const answer = normalizeAskAnswer(pending.spec, body);
      const resolved = asks.submit(callId, answer);
      if (!resolved) return sendJson(res, 409, { ok: false, error: { code: 'NOT_PENDING' } });
      return sendJson(res, 200, { ok: true, value: { submitted: true, changed: answer.changed } });
    } catch (error) {
      if (error instanceof SpecError) return sendJson(res, 400, { ok: false, error: { code: error.code, message: error.message } });
      return sendJson(res, 500, { ok: false, error: { code: 'OPERATION_FAILED' } });
    }
  };
}

/**
 * @param {object} deps
 * @param {ReturnType<import('./store.js').createStore>} deps.store
 * @param {ReturnType<import('./ask.js').createAskRegistry>} deps.asks
 * @param {(req: object) => unknown} deps.admit
 */
export function createRoutes({ store, asks, admit, previewKey }) {
  return {
    [ROUTE_MANIFEST]: manifestHandler(store, admit, previewKey),
    [ROUTE_ARTIFACT]: artifactHandler(store, previewKey, admit),
    [ROUTE_ASK]: askHandler(asks, admit),
  };
}
