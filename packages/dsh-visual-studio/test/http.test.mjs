import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, visualStudioHome } from '../lib/store.js';
import { createAskRegistry } from '../lib/ask.js';
import { createRoutes } from '../lib/http.js';
import { normalizeAskSpec } from '../lib/spec.js';

function fakeRes() {
  const state = { status: 0, headers: {}, body: '' };
  return {
    state,
    writeHead(status, headers) {
      state.status = status;
      state.headers = headers ?? {};
      return this;
    },
    end(chunk) {
      state.body = chunk === undefined ? '' : String(chunk);
    },
  };
}

function getRequest(url, headers = {}) {
  return { method: 'GET', url, headers };
}

function postRequest(url, headers, body) {
  const payload = Buffer.from(JSON.stringify(body), 'utf8');
  return {
    method: 'POST',
    url,
    headers: { 'content-type': 'application/json', ...headers },
    async *[Symbol.asyncIterator]() {
      yield payload;
    },
  };
}

async function withRoutes(run, admit = () => ({ peer: { id: 'peer' } })) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-visual-studio-http-'));
  try {
    const store = createStore(visualStudioHome({ env: { DSH_HOME: root }, home: root }));
    const asks = createAskRegistry({ timeoutMs: 5000 });
    const routes = createRoutes({ store, asks, previewKey: 'secret-key', admit });
    await run({ store, asks, routes, root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const DOC = '<!doctype html><html><body><p>ok</p></body></html>';

test('manifest requires the intent header and admission and returns the capability key', async () => {
  await withRoutes(async ({ store, routes }) => {
    await store.publish({ title: 'Схема', module: 'diagram', html: DOC });
    const manifestRoute = routes['/plugins/dsh-visual-studio/manifest'];
    const noHeader = fakeRes();
    await manifestRoute(getRequest('/plugins/dsh-visual-studio/manifest'), noHeader);
    assert.equal(noHeader.state.status, 403);

    const ok = fakeRes();
    await manifestRoute(getRequest('/plugins/dsh-visual-studio/manifest', { 'x-dsh-visual-studio': '1' }), ok);
    assert.equal(ok.state.status, 200);
    const value = JSON.parse(ok.state.body).value;
    assert.equal(value.previewKey, 'secret-key');
    assert.equal(value.artifacts.length, 1);
  });
});

test('artifact route serves HTML with the capability key and rejects a bare request', async () => {
  // No admission: only the capability key opens the artifact route.
  await withRoutes(async ({ store, routes }) => {
    const artifact = await store.publish({ title: 'Схема', module: 'diagram', html: DOC });
    const route = routes['/plugins/dsh-visual-studio/artifact'];
    const query = `?id=${artifact.id}&rev=1`;

    const denied = fakeRes();
    await route(getRequest(`/plugins/dsh-visual-studio/artifact${query}`), denied);
    assert.equal(denied.state.status, 403);

    const ok = fakeRes();
    await route(getRequest(`/plugins/dsh-visual-studio/artifact${query}&k=secret-key`), ok);
    assert.equal(ok.state.status, 200);
    assert.match(ok.state.headers['content-type'], /text\/html/);
    assert.match(ok.state.headers['content-security-policy'], /sandbox allow-scripts/);
    assert.equal(ok.state.body, DOC);

    const download = fakeRes();
    await route(getRequest(`/plugins/dsh-visual-studio/artifact${query}&k=secret-key&download=1`), download);
    assert.equal(download.state.status, 200);
    assert.match(download.state.headers['content-disposition'], /filename\*=UTF-8''/);
  }, () => ({}));
});

test('an admitted peer may read an artifact without the key', async () => {
  await withRoutes(async ({ store, routes }) => {
    const artifact = await store.publish({ title: 'Схема', module: 'diagram', html: DOC });
    const route = routes['/plugins/dsh-visual-studio/artifact'];
    const ok = fakeRes();
    await route(getRequest(`/plugins/dsh-visual-studio/artifact?id=${artifact.id}&rev=1`), ok);
    assert.equal(ok.state.status, 200);
  });
});

test('widget answers resolve the pending call and reject stale call ids', async () => {
  await withRoutes(async ({ asks, routes }) => {
    const spec = normalizeAskSpec({
      title: 'Выбор',
      rows: [{ title: 'Блок', actions: [{ label: 'Оставить' }, { label: 'Убрать' }] }],
    });
    const waiting = asks.open({ callId: 'call-1', spec });
    const route = routes['/plugins/dsh-visual-studio/ask'];
    const request = postRequest('/plugins/dsh-visual-studio/ask', { 'x-dsh-visual-studio': '1' }, {
      callId: 'call-1',
      selections: [{ rowId: 'r1', actionId: 'a2' }],
    });
    const res = fakeRes();
    await route(request, res);
    assert.equal(res.state.status, 200);
    const answer = await waiting;
    assert.equal(answer.submitted, true);
    assert.equal(answer.changed, 1);

    const stale = fakeRes();
    await route(postRequest('/plugins/dsh-visual-studio/ask', { 'x-dsh-visual-studio': '1' }, {
      callId: 'call-1',
      selections: [{ rowId: 'r1', actionId: 'a1' }],
    }), stale);
    assert.equal(stale.state.status, 409);
  });
});

test('ask route requires the intent header and a JSON body', async () => {
  await withRoutes(async ({ routes }) => {
    const route = routes['/plugins/dsh-visual-studio/ask'];
    const noHeader = fakeRes();
    await route(postRequest('/plugins/dsh-visual-studio/ask', {}, { callId: 'x' }), noHeader);
    assert.equal(noHeader.state.status, 403);

    const wrongType = fakeRes();
    await route({ method: 'POST', url: '/plugins/dsh-visual-studio/ask', headers: { 'x-dsh-visual-studio': '1', 'content-type': 'text/plain' } }, wrongType);
    assert.equal(wrongType.state.status, 415);
  });
});
