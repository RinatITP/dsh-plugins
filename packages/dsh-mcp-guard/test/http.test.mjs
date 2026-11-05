/**
 * HTTP façade tests: trust header, signed-peer admission, body limits and
 * value-free error mapping. The manager is faked; no DSH runtime is needed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHandler, ROUTE, HEADER } from '../lib/http.js';
import { ManagerError } from '../lib/errors.js';

function makeRequest({ method = 'GET', headers = {}, body = undefined } = {}) {
  const chunks = body === undefined ? [] : [Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))];
  const req = Readable.from(chunks);
  req.method = method;
  req.headers = headers;
  return req;
}

function makeResponse() {
  const state = { status: null, headers: null, body: null };
  const res = {
    writeHead(status, headers) {
      state.status = status;
      state.headers = headers;
    },
    end(payload) {
      state.body = payload;
    },
    get state() {
      return state;
    },
  };
  return res;
}

function decode(res) {
  return JSON.parse(res.state.body);
}

const baseHeaders = {
  [HEADER]: '1',
  'content-type': 'application/json',
};

function handlerWith(manager, admit = () => ({ peer: { id: 'test' } })) {
  return createHandler({ manager, admit });
}

test('route and header constants stay stable', () => {
  assert.equal(ROUTE, '/api/dsh-mcp-guard');
  assert.equal(HEADER, 'x-dsh-mcp-guard');
});

test('rejects a request without the intent header', async () => {
  const handler = handlerWith({ list: async () => ({}) });
  const res = makeResponse();
  await handler(makeRequest({ headers: {} }), res);
  assert.equal(res.state.status, 403);
  assert.equal(decode(res).error.code, 'FORBIDDEN');
});

test('rejects a request that fails signed-peer admission', async () => {
  const handler = handlerWith({ list: async () => ({}) }, () => ({ rejection: 'bad-peer' }));
  const res = makeResponse();
  await handler(makeRequest({ headers: { [HEADER]: '1' } }), res);
  assert.equal(res.state.status, 401);
  assert.equal(decode(res).error.code, 'UNAUTHENTICATED');
});

test('serves the snapshot on authenticated GET with safe headers', async () => {
  const snapshot = { revision: 'abc', servers: [], external: [] };
  const handler = handlerWith({ list: async () => snapshot });
  const res = makeResponse();
  await handler(makeRequest({ headers: { [HEADER]: '1' } }), res);
  assert.equal(res.state.status, 200);
  assert.deepEqual(decode(res).value, snapshot);
  assert.equal(res.state.headers['cache-control'], 'no-store');
  assert.equal(res.state.headers['x-content-type-options'], 'nosniff');
});

test('rejects non-GET/POST methods', async () => {
  const handler = handlerWith({ list: async () => ({}) });
  const res = makeResponse();
  await handler(makeRequest({ method: 'PUT', headers: { [HEADER]: '1' } }), res);
  assert.equal(res.state.status, 405);
  assert.equal(decode(res).error.code, 'METHOD_NOT_ALLOWED');
});

test('requires a JSON content type for POST', async () => {
  const handler = handlerWith({ analyze: async () => ({}) });
  const res = makeResponse();
  await handler(
    makeRequest({ method: 'POST', headers: { [HEADER]: '1', 'content-type': 'text/plain' }, body: { action: 'analyze' } }),
    res,
  );
  assert.equal(res.state.status, 415);
  assert.equal(decode(res).error.code, 'CONTENT_TYPE');
});

test('rejects invalid JSON bodies', async () => {
  const handler = handlerWith({ analyze: async () => ({}) });
  const res = makeResponse();
  await handler(makeRequest({ method: 'POST', headers: baseHeaders, body: '{not json' }), res);
  assert.equal(res.state.status, 400);
  assert.equal(decode(res).error.code, 'INVALID_REQUEST');
});

test('rejects unknown actions', async () => {
  const handler = handlerWith({ analyze: async () => ({}) });
  const res = makeResponse();
  await handler(makeRequest({ method: 'POST', headers: baseHeaders, body: { action: 'drop-database' } }), res);
  assert.equal(res.state.status, 400);
  assert.equal(decode(res).error.code, 'INVALID_REQUEST');
});

test('dispatches a known action and returns its value', async () => {
  const handler = handlerWith({
    analyze: async (body) => ({ normalized: null, echoAction: body.action }),
  });
  const res = makeResponse();
  await handler(makeRequest({ method: 'POST', headers: baseHeaders, body: { action: 'analyze' } }), res);
  assert.equal(res.state.status, 200);
  assert.equal(decode(res).value.echoAction, 'analyze');
});

test('maps ManagerError to its status and code without leaking the message', async () => {
  const handler = handlerWith({
    analyze: async () => {
      throw new ManagerError('NOT_FOUND', 404);
    },
  });
  const res = makeResponse();
  await handler(makeRequest({ method: 'POST', headers: baseHeaders, body: { action: 'analyze' } }), res);
  assert.equal(res.state.status, 404);
  assert.deepEqual(decode(res).error, { code: 'NOT_FOUND' });
});

test('maps validation-style errors by code only', async () => {
  const failure = new Error('secret value sk-live-should-not-leak');
  failure.code = 'NAME_INVALID';
  const handler = handlerWith({
    create: async () => {
      throw failure;
    },
  });
  const res = makeResponse();
  await handler(makeRequest({ method: 'POST', headers: baseHeaders, body: { action: 'create' } }), res);
  assert.equal(res.state.status, 400);
  assert.equal(decode(res).error.code, 'NAME_INVALID');
  assert.ok(!res.state.body.includes('sk-live-should-not-leak'));
});

test('maps unknown failures to OPERATION_FAILED without diagnostics', async () => {
  const handler = handlerWith({
    list: async () => {
      throw new Error('internal path /Users/secret');
    },
  });
  const res = makeResponse();
  await handler(makeRequest({ headers: { [HEADER]: '1' } }), res);
  assert.equal(res.state.status, 500);
  assert.deepEqual(decode(res).error, { code: 'OPERATION_FAILED' });
  assert.ok(!res.state.body.includes('/Users/secret'));
});

test('rejects bodies above the 1 MiB limit', async () => {
  const handler = handlerWith({ analyze: async () => ({}) });
  const big = 'x'.repeat(1024 * 1024 + 16);
  const res = makeResponse();
  await handler(makeRequest({ method: 'POST', headers: baseHeaders, body: { action: 'analyze', text: big } }), res);
  assert.equal(res.state.status, 413);
  assert.equal(decode(res).error.code, 'BODY_TOO_LARGE');
});
