import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeAskSpec,
  normalizeAskAnswer,
  normalizePublish,
  SpecError,
} from '../lib/spec.js';

function expectCode(fn, code) {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof SpecError, 'expected SpecError');
    assert.equal(error.code, code);
    return true;
  });
}

function row(overrides = {}) {
  return {
    title: 'Промптинг I: режимы и формула',
    note: '4 из 5',
    detail: '120 минут в сентябре',
    actions: [{ label: 'Оставить' }, { label: 'Сжать 20' }, { label: 'Убрать', tone: 'muted' }],
    ...overrides,
  };
}

test('normalizes a widget spec and assigns ids/defaults', () => {
  const spec = normalizeAskSpec({ title: 'Донор: Прогресс', metric: { value: '360', label: 'минут из 390' }, rows: [row(), row({ title: 'Второй блок' })] });
  assert.equal(spec.rows.length, 2);
  assert.equal(spec.rows[0].id, 'r1');
  assert.equal(spec.rows[0].actions.length, 3);
  assert.equal(spec.rows[0].actions[0].id, 'a1');
  assert.equal(spec.rows[0].defaultAction, 'a1');
  assert.equal(spec.submitLabel, 'Отправить выбор');
  assert.equal(spec.metric.value, '360');
});

test('rejects structurally invalid specs', () => {
  expectCode(() => normalizeAskSpec(null), 'INVALID_SPEC');
  expectCode(() => normalizeAskSpec({ rows: [row()] }), 'MISSING_TITLE');
  expectCode(() => normalizeAskSpec({ title: 'x', rows: [] }), 'MISSING_ROWS');
  expectCode(() => normalizeAskSpec({ title: 'x', rows: [row({ actions: [{ label: 'one' }] })] }), 'MISSING_ACTIONS');
  expectCode(() => normalizeAskSpec({ title: 'x', rows: [row({ actions: [{ label: 'a' }, { label: 'b' }, { label: 'c' }, { label: 'd' }, { label: 'e' }] })] }), 'TOO_MANY_ACTIONS');
  expectCode(() => normalizeAskSpec({ title: 'x', rows: [row({ id: 'same' }), row({ id: 'same' })] }), 'DUPLICATE_ROW_ID');
  expectCode(() => normalizeAskSpec({ title: 'x'.repeat(200), rows: [row()] }), 'FIELD_TOO_LONG');
});

test('normalizes a complete answer and counts changes', () => {
  const spec = normalizeAskSpec({ title: 'x', rows: [row(), row({ title: 'B' })] });
  const answer = normalizeAskAnswer(spec, {
    selections: [
      { rowId: 'r1', actionId: 'a2' },
      { rowId: 'r2', actionId: 'a1' },
    ],
  });
  assert.equal(answer.changed, 1);
  assert.equal(answer.selections[0].label, 'Сжать 20');
  assert.equal(answer.selections[1].title, 'B');
});

test('rejects incomplete or unknown answers', () => {
  const spec = normalizeAskSpec({ title: 'x', rows: [row(), row({ title: 'B' })] });
  expectCode(() => normalizeAskAnswer(spec, {}), 'MISSING_SELECTIONS');
  expectCode(() => normalizeAskAnswer(spec, { selections: [{ rowId: 'r1', actionId: 'a1' }] }), 'INCOMPLETE_SELECTIONS');
  expectCode(() => normalizeAskAnswer(spec, { selections: [{ rowId: 'nope', actionId: 'a1' }, { rowId: 'r2', actionId: 'a1' }] }), 'UNKNOWN_ROW');
  expectCode(() => normalizeAskAnswer(spec, { selections: [{ rowId: 'r1', actionId: 'zzz' }, { rowId: 'r2', actionId: 'a1' }] }), 'UNKNOWN_ACTION');
});

test('accepts one self-contained document and rejects external resources', () => {
  const good = normalizePublish({
    title: 'Схема процесса',
    module: 'diagram',
    html: '<!doctype html><html><head><style>body{color:#111}</style></head><body><svg></svg></body></html>',
  });
  assert.equal(good.module, 'diagram');
  assert.ok(good.bytes > 0);

  expectCode(() => normalizePublish({ title: 'x', module: 'diagram', html: 'not html' }), 'INVALID_HTML');
  for (const html of [
    '<!doctype html><html><script src="https://cdn.example.com/a.js"></script></html>',
    '<!doctype html><html><link rel="stylesheet" href="https://fonts.example.com/x.css"></html>',
    '<!doctype html><html><img src="http://example.com/a.png"></html>',
    '<!doctype html><html><style>@import url("https://x.example.com/a.css");</style></html>',
    '<!doctype html><html><script>fetch("https://api.example.com")</script></html>',
  ]) {
    expectCode(() => normalizePublish({ title: 'x', module: 'mockup', html }), 'EXTERNAL_RESOURCE');
  }
});

test('rejects unknown modules and oversized visuals', () => {
  expectCode(() => normalizePublish({ title: 'x', module: 'video', html: '<!doctype html><html></html>' }), 'MISSING_MODULE');
  const huge = `<!doctype html><html><body>${'x'.repeat(600 * 1024)}</body></html>`;
  expectCode(() => normalizePublish({ title: 'x', module: 'chart', html: huge }), 'HTML_TOO_LARGE');
});

test('SpecError carries a stable code', () => {
  try {
    normalizeAskSpec({});
    assert.fail('expected throw');
  } catch (error) {
    assert.ok(error instanceof SpecError);
    assert.equal(error.code, 'MISSING_TITLE');
  }
});
