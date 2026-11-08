import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStore, visualStudioHome, parseRevision, MAX_VERSIONS_PER_ARTIFACT } from '../lib/store.js';

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-visual-studio-'));
  try {
    const paths = visualStudioHome({ env: { DSH_HOME: root }, home: root });
    const store = createStore(paths);
    await run({ store, paths, root });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const DOC = '<!doctype html><html><body><p>ok</p></body></html>';

test('publishes a new artifact and stores the first version', async () => {
  await withStore(async ({ store, paths }) => {
    const artifact = await store.publish({ title: 'Схема процесса', module: 'diagram', html: DOC });
    assert.match(artifact.id, /^diagram-/);
    assert.equal(artifact.rev, 1);
    assert.equal(artifact.versions.length, 1);
    const stored = await readFile(join(paths.artifacts, artifact.id, 'v1.html'), 'utf8');
    assert.equal(stored, DOC);
    const snapshot = await store.ensureReady();
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.artifacts[0].title, 'Схема процесса');
  });
});

test('a second publish of the same title becomes version 2', async () => {
  await withStore(async ({ store }) => {
    const first = await store.publish({ title: 'Мокап заявки', module: 'mockup', html: DOC });
    const second = await store.publish({ title: 'Мокап заявки', module: 'mockup', html: `${DOC}\n<!-- v2 -->` });
    assert.equal(second.id, first.id);
    assert.equal(second.rev, 2);
    assert.equal(second.versions.length, 2);
    const v1 = await store.readVersion(second.id, 1);
    const v2 = await store.readVersion(second.id, 2);
    assert.equal(v1.html, DOC);
    assert.match(v2.html, /v2/);
    const latest = await store.readVersion(second.id);
    assert.equal(latest.rev, 2);
  });
});

test('rejects unknown ids and revisions without touching the disk', async () => {
  await withStore(async ({ store }) => {
    assert.equal(await store.readVersion('../../etc/passwd'), undefined);
    assert.equal(await store.readVersion('missing-id'), undefined);
    const artifact = await store.publish({ title: 'x', module: 'chart', html: DOC });
    assert.equal(await store.readVersion(artifact.id, 99), undefined);
    assert.equal(await store.get('missing-id'), undefined);
  });
});

test('keeps only the newest versions per artifact', async () => {
  await withStore(async ({ store, paths }) => {
    let artifact;
    for (let index = 1; index <= MAX_VERSIONS_PER_ARTIFACT + 2; index += 1) {
      artifact = await store.publish({ title: 'Граф', module: 'diagram', html: `${DOC}\n<!-- ${index} -->` });
    }
    assert.equal(artifact.versions.length, MAX_VERSIONS_PER_ARTIFACT);
    assert.equal(artifact.rev, MAX_VERSIONS_PER_ARTIFACT + 2);
    assert.equal(await store.readVersion(artifact.id, 1), undefined);
    const kept = await store.readVersion(artifact.id, artifact.rev);
    assert.ok(kept.html.includes(`<!-- ${artifact.rev} -->`));
    const file = await readFile(join(paths.artifacts, artifact.id, `v${artifact.rev}.html`), 'utf8');
    assert.match(file, new RegExp(`<!-- ${artifact.rev} -->`));
  });
});

test('catalog survives a reload from disk', async () => {
  await withStore(async ({ store, paths }) => {
    const artifact = await store.publish({ title: 'Переживает рестарт', module: 'interactive', html: DOC });
    const second = createStore(paths);
    const snapshot = await second.ensureReady();
    assert.equal(snapshot.revision, 1);
    assert.equal(snapshot.artifacts.length, 1);
    assert.equal(snapshot.artifacts[0].id, artifact.id);
    assert.equal(snapshot.artifacts[0].rev, 1);
  });
});

test('parseRevision accepts positive integers only', () => {
  assert.equal(parseRevision(undefined), undefined);
  assert.equal(parseRevision(''), undefined);
  assert.equal(parseRevision('3'), 3);
  assert.equal(parseRevision('0'), null);
  assert.equal(parseRevision('-1'), null);
  assert.equal(parseRevision('1.5'), null);
  assert.equal(parseRevision('abc'), null);
});
