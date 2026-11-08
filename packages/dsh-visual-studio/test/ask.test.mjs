import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAskRegistry } from '../lib/ask.js';
import { normalizeAskSpec, normalizeAskAnswer } from '../lib/spec.js';

function spec() {
  return normalizeAskSpec({
    title: 'Выбор блоков',
    rows: [
      { title: 'Блок 1', actions: [{ label: 'Оставить' }, { label: 'Убрать' }] },
      { title: 'Блок 2', actions: [{ label: 'Оставить' }, { label: 'Убрать' }] },
    ],
  });
}

test('an answered widget resolves with the submitted selection', async () => {
  const registry = createAskRegistry({ timeoutMs: 5000 });
  const widget = spec();
  const waiting = registry.open({ callId: 'call-1', spec: widget });
  assert.equal(registry.size, 1);
  const answer = normalizeAskAnswer(widget, {
    selections: [
      { rowId: 'r1', actionId: 'a1' },
      { rowId: 'r2', actionId: 'a2' },
    ],
  });
  assert.equal(registry.submit('call-1', answer), true);
  const resolved = await waiting;
  assert.equal(resolved.submitted, true);
  assert.equal(resolved.changed, 1);
  assert.equal(registry.size, 0);
});

test('a duplicate call id is refused', () => {
  const registry = createAskRegistry({ timeoutMs: 5000 });
  const first = registry.open({ callId: 'call-x', spec: spec() });
  assert.throws(() => registry.open({ callId: 'call-x', spec: spec() }), /already pending/);
  registry.dispose();
  return first;
});

test('submitting an unknown call id reports false', () => {
  const registry = createAskRegistry({ timeoutMs: 5000 });
  assert.equal(registry.submit('nope', {}), false);
});

test('a timeout resolves the widget as timed out', async () => {
  const registry = createAskRegistry({ timeoutMs: 5 });
  const resolved = await registry.open({ callId: 'call-timeout', spec: spec() });
  assert.equal(resolved.submitted, false);
  assert.equal(resolved.timedOut, true);
  assert.equal(registry.size, 0);
});

test('aborting the tool call resolves the widget as aborted', async () => {
  const registry = createAskRegistry({ timeoutMs: 5000 });
  const controller = new AbortController();
  const waiting = registry.open({ callId: 'call-abort', spec: spec(), signal: controller.signal });
  controller.abort();
  const resolved = await waiting;
  assert.equal(resolved.submitted, false);
  assert.equal(resolved.aborted, true);
});

test('dispose resolves every waiter as aborted', async () => {
  const registry = createAskRegistry({ timeoutMs: 5000 });
  const first = registry.open({ callId: 'a', spec: spec() });
  const second = registry.open({ callId: 'b', spec: spec() });
  registry.dispose();
  const values = await Promise.all([first, second]);
  assert.deepEqual(values.map((value) => value.aborted), [true, true]);
  assert.equal(registry.size, 0);
});

test('pendingFor exposes the spec for a live call only', () => {
  const registry = createAskRegistry({ timeoutMs: 5000 });
  const widget = spec();
  registry.open({ callId: 'live', spec: widget });
  assert.equal(registry.pendingFor('live')?.spec.title, 'Выбор блоков');
  assert.equal(registry.pendingFor('other'), undefined);
  registry.dispose();
});
