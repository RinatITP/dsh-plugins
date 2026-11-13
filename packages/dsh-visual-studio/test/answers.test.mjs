import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AnswersError, createAnswersStore } from '../lib/answers.js';

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-visual-studio-answers-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('answers are addressed by session and turn', async () => {
  await withStore(async (root) => {
    const store = createAnswersStore({ answersFile: join(root, 'answers.json') });
    await store.record({
      sessionId: 'session-abc-123',
      turn: 2,
      callId: 'call-1',
      title: 'Что берём в работу?',
      submitted: true,
      changed: 1,
      selections: [
        { title: 'Ассистенты', label: 'Берём', changed: false },
        { title: 'Агенты', label: 'Не берём', changed: true },
      ],
    });
    await store.record({ sessionId: 'session-abc-123', turn: 3, callId: 'call-2', title: 'Другое', submitted: true, changed: 0, selections: [] });

    const turn2 = await store.list({ sessionId: 'session-abc-123', turn: 2 });
    assert.equal(turn2.length, 1);
    assert.equal(turn2[0].title, 'Что берём в работу?');
    assert.equal(turn2[0].changed, 1);
    assert.equal(turn2[0].selections[1].label, 'Не берём');
    const turn3 = await store.list({ sessionId: 'session-abc-123', turn: 3 });
    assert.equal(turn3.length, 1);
    assert.equal(turn3[0].title, 'Другое');
    assert.deepEqual(await store.list({ sessionId: 'other-session-1', turn: 2 }), []);
  });
});

test('answers survive a reload of the store', async () => {
  await withStore(async (root) => {
    const file = join(root, 'answers.json');
    const first = createAnswersStore({ answersFile: file });
    await first.record({ sessionId: 'session-abc-123', turn: 4, callId: 'call-9', title: 'План', submitted: false, changed: 0, selections: [] });

    const second = createAnswersStore({ answersFile: file });
    const records = await second.list({ sessionId: 'session-abc-123', turn: 4 });
    assert.equal(records.length, 1);
    assert.equal(records[0].submitted, false);
    const raw = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.answers[0].callId, 'call-9');
  });
});

test('answers validate coordinates and never grow without bound', async () => {
  await withStore(async (root) => {
    const store = createAnswersStore({ answersFile: join(root, 'answers.json') });
    await assert.rejects(store.record({ sessionId: '', turn: 1, callId: 'c' }), (error) => error instanceof AnswersError && error.code === 'INVALID_SESSION');
    await assert.rejects(store.record({ sessionId: 'session-abc-123', turn: 0, callId: 'c' }), (error) => error.code === 'INVALID_TURN');
    await assert.rejects(store.record({ sessionId: 'session-abc-123', turn: 1, callId: '' }), (error) => error.code === 'INVALID_CALL');
    await assert.rejects(store.list({ sessionId: 'bad', turn: 1 }), (error) => error.code === 'INVALID_SESSION');
    for (let index = 0; index < 1010; index += 1) {
      await store.record({ sessionId: 'session-abc-123', turn: 1, callId: `call-${index}`, title: 't', submitted: true, changed: 0, selections: [] });
    }
    const all = await store.list({ sessionId: 'session-abc-123', turn: 1 });
    assert.ok(all.length <= 1000);
    assert.equal(all.at(-1).callId, 'call-1009');
  });
});
