import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_DIR, ProjectPathError, projectTarget, writeProjectCopy } from '../lib/project.js';

async function withProject(run) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-visual-studio-project-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const DOC = '<!doctype html><html><body><p>visual</p></body></html>';

test('projectTarget stays inside the session project', () => {
  const target = projectTarget('/Users/example/project', 'diagram-abc-1234', 2);
  assert.equal(target.root, '/Users/example/project');
  assert.equal(target.relativeDir, join(PROJECT_DIR, 'diagram-abc-1234'));
  assert.equal(target.relativeFile, join(PROJECT_DIR, 'diagram-abc-1234', 'v2.html'));
  assert.ok(target.file.startsWith('/Users/example/project/artifacts/visuals/'));
});

test('projectTarget rejects unsafe input', () => {
  for (const [cwd, id, rev, code] of [
    ['', 'diagram-abc-1234', 1, 'PROJECT_CWD_UNAVAILABLE'],
    ['relative/dir', 'diagram-abc-1234', 1, 'PROJECT_CWD_INVALID'],
    ['/tmp/project', '../escape', 1, 'PROJECT_ARTIFACT_INVALID'],
    ['/tmp/project', 'diagram-abc-1234', 0, 'PROJECT_REV_INVALID'],
    ['/tmp/project', 'diagram-abc-1234', 1.5, 'PROJECT_REV_INVALID'],
  ]) {
    assert.throws(() => projectTarget(cwd, id, rev), (error) => {
      assert.ok(error instanceof ProjectPathError);
      assert.equal(error.code, code);
      return true;
    });
  }
});

test('writeProjectCopy writes the version and its metadata', async () => {
  await withProject(async (root) => {
    const written = await writeProjectCopy({
      cwd: root,
      artifactId: 'mockup-xyz-9999',
      rev: 3,
      title: 'Мокап заявки',
      module: 'mockup',
      html: DOC,
    });
    assert.equal(written.relativeFile, join(PROJECT_DIR, 'mockup-xyz-9999', 'v3.html'));
    const html = await readFile(written.file, 'utf8');
    assert.equal(html, DOC);
    const info = await stat(join(root, PROJECT_DIR, 'mockup-xyz-9999', 'meta.json'));
    assert.ok(info.isFile());
    const meta = JSON.parse(await readFile(join(root, PROJECT_DIR, 'mockup-xyz-9999', 'meta.json'), 'utf8'));
    assert.equal(meta.artifactId, 'mockup-xyz-9999');
    assert.equal(meta.rev, 3);
    assert.equal(meta.module, 'mockup');
    assert.equal(meta.title, 'Мокап заявки');
    assert.equal(meta.source, 'dsh-visual-studio');
  });
});

test('a second version lands beside the first one', async () => {
  await withProject(async (root) => {
    const first = await writeProjectCopy({ cwd: root, artifactId: 'diagram-abc-1234', rev: 1, title: 'Схема', module: 'diagram', html: DOC });
    const second = await writeProjectCopy({ cwd: root, artifactId: 'diagram-abc-1234', rev: 2, title: 'Схема', module: 'diagram', html: `${DOC}\n<!-- v2 -->` });
    assert.notEqual(first.file, second.file);
    assert.match(await readFile(second.file, 'utf8'), /v2/);
    assert.equal((await readFile(first.file, 'utf8')), DOC);
  });
});
