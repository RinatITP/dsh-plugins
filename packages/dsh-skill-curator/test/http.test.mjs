/**
 * HTTP envelope tests with an in-memory manager (no Host services needed).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHandler, HEADER, ROUTE } from '../lib/http.js';

function fakeRequest({ method = 'GET', headers = {}, body = null }) {
  const chunks = body === null ? [] : [Buffer.from(JSON.stringify(body), 'utf8')];
  return {
    method,
    headers,
    url: ROUTE,
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield chunk;
    },
  };
}

function fakeResponse() {
  return {
    status: 0,
    headers: {},
    payload: '',
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(payload = '') {
      this.payload = payload;
    },
    json() {
      return JSON.parse(this.payload);
    },
  };
}

const manager = {
  async snapshot() {
    return { revision: 'rev', skills: [], sources: [], summary: { skills: 0 } };
  },
  async detail({ id }) {
    if (id !== 'known') {
      const error = new Error('missing');
      error.code = 'SKILL_NOT_FOUND';
      error.status = 404;
      throw error;
    }
    return { skill: { id: 'known' }, content: 'x', files: [] };
  },
  async readFile() {
    return { ok: true, content: 'data' };
  },
};

const admitPeer = () => ({ peer: { kind: 'test' } });

test('rejects requests without the intent header', async () => {
  const handler = createHandler({ manager, admit: admitPeer });
  const res = fakeResponse();
  await handler(fakeRequest({}), res);
  assert.equal(res.status, 403);
  assert.deepEqual(res.json(), { ok: false, error: { code: 'FORBIDDEN' } });
});

test('rejects requests without signed-peer admission', async () => {
  const handler = createHandler({ manager, admit: () => ({ rejection: 'no-peer' }) });
  const res = fakeResponse();
  await handler(fakeRequest({ headers: { [HEADER]: '1' } }), res);
  assert.equal(res.status, 401);
  assert.equal(res.json().error.code, 'UNAUTHENTICATED');
});

test('GET returns a snapshot with no-store headers', async () => {
  const handler = createHandler({ manager, admit: admitPeer });
  const res = fakeResponse();
  await handler(fakeRequest({ headers: { [HEADER]: '1' } }), res);
  assert.equal(res.status, 200);
  assert.equal(res.json().ok, true);
  assert.equal(res.json().value.revision, 'rev');
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.headers['x-content-type-options'], 'nosniff');
});

test('POST requires JSON content type', async () => {
  const handler = createHandler({ manager, admit: admitPeer });
  const res = fakeResponse();
  await handler(fakeRequest({
    method: 'POST',
    headers: { [HEADER]: '1', 'content-type': 'text/plain' },
    body: { action: 'snapshot' },
  }), res);
  assert.equal(res.status, 415);
  assert.equal(res.json().error.code, 'CONTENT_TYPE');
});

test('POST routes known actions and returns stable errors for unknown ones', async () => {
  const handler = createHandler({ manager, admit: admitPeer });
  const ok = fakeResponse();
  await handler(fakeRequest({
    method: 'POST',
    headers: { [HEADER]: '1', 'content-type': 'application/json' },
    body: { action: 'detail', id: 'known' },
  }), ok);
  assert.equal(ok.status, 200);
  assert.equal(ok.json().value.skill.id, 'known');

  const unknown = fakeResponse();
  await handler(fakeRequest({
    method: 'POST',
    headers: { [HEADER]: '1', 'content-type': 'application/json' },
    body: { action: 'nope' },
  }), unknown);
  assert.equal(unknown.status, 400);
  assert.equal(unknown.json().error.code, 'INVALID_REQUEST');
});

test('manager error codes become HTTP errors without leaking messages', async () => {
  const handler = createHandler({ manager, admit: admitPeer });
  const res = fakeResponse();
  await handler(fakeRequest({
    method: 'POST',
    headers: { [HEADER]: '1', 'content-type': 'application/json' },
    body: { action: 'detail', id: 'absent' },
  }), res);
  assert.equal(res.status, 404);
  assert.deepEqual(res.json(), { ok: false, error: { code: 'SKILL_NOT_FOUND' } });
});

test('rejects malformed JSON bodies with INVALID_REQUEST', async () => {
  const handler = createHandler({ manager, admit: admitPeer });
  const req = {
    method: 'POST',
    headers: { [HEADER]: '1', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from('{ not json', 'utf8');
    },
  };
  const res = fakeResponse();
  await handler(req, res);
  assert.equal(res.status, 400);
  assert.equal(res.json().error.code, 'INVALID_REQUEST');
});

test('rejects bodies above the 1 MiB limit with BODY_TOO_LARGE', async () => {
  const handler = createHandler({ manager, admit: admitPeer });
  const big = Buffer.alloc(1024 * 1024 + 16, 0x20);
  const req = {
    method: 'POST',
    headers: { [HEADER]: '1', 'content-type': 'application/json' },
    async *[Symbol.asyncIterator]() {
      yield big;
    },
  };
  const res = fakeResponse();
  await handler(req, res);
  assert.equal(res.status, 413);
  assert.equal(res.json().error.code, 'BODY_TOO_LARGE');
});

test('rejects unknown HTTP methods', async () => {
  const handler = createHandler({ manager, admit: admitPeer });
  const res = fakeResponse();
  await handler(fakeRequest({ method: 'DELETE', headers: { [HEADER]: '1' } }), res);
  assert.equal(res.status, 405);
});
