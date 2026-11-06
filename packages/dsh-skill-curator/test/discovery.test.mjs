/**
 * Discovery tests over a synthetic multi-root tree.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanCatalog, readSkillDetail, readSkillFile, scanSource } from '../lib/discovery.js';
import { buildSources } from '../lib/roots.js';

async function makeRoot() {
  return mkdtemp(path.join(os.tmpdir(), 'dsh-curator-test-'));
}

async function writeSkill(root, relativeDir, frontmatter, body = 'Do the thing.') {
  const dir = path.join(root, relativeDir);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'SKILL.md'), ['---', ...frontmatter, '---', '', body, ''].join('\n'), 'utf8');
}

function source(key, root, overrides = {}) {
  return {
    key,
    kind: overrides.kind ?? 'external',
    agent: overrides.agent ?? 'custom',
    labelKey: overrides.labelKey ?? null,
    label: overrides.label ?? null,
    path: root,
    readOnly: overrides.readOnly !== false,
    writable: overrides.writable === true,
    depth: overrides.depth ?? 1,
    flat: overrides.flat === true,
    systemSubdir: overrides.systemSubdir ?? null,
    scope: overrides.scope ?? 'user',
    order: overrides.order ?? 100,
    readOnlyReason: null,
  };
}

test('scans bundle, flat, nested category and system skills', async () => {
  const root = await makeRoot();
  try {
    await writeSkill(root, 'bundle-skill', ['name: bundle-skill', 'description: A bundled skill for tests.']);
    await writeFile(path.join(root, 'flat-skill.md'), '---\nname: flat-skill\ndescription: Flat markdown skill.\n---\nBody\n', 'utf8');
    await writeSkill(root, 'category/nested-skill', ['name: nested-skill', 'description: Nested category skill.']);
    await writeSkill(root, 'category/deeper-1/deeper-2/deep-skill', ['name: deep-skill', 'description: Deeply nested skill.']);
    await mkdir(path.join(root, 'not-a-skill'), { recursive: true });
    await mkdir(path.join(root, '.hidden'), { recursive: true });

    const result = await scanSource(source('hermes', root, { depth: 2, kind: 'external' }));
    assert.equal(result.summary.exists, true);
    assert.equal(result.summary.error, null);
    const names = result.skills.map((skill) => skill.name).sort();
    assert.deepEqual(names, ['bundle-skill', 'deep-skill', 'nested-skill']);
    const nested = result.skills.find((skill) => skill.name === 'nested-skill');
    assert.equal(nested.category, 'category');
    assert.equal(nested.readOnly, true);
    assert.ok(result.skipped.some((item) => item.name === 'not-a-skill' && item.reason === 'NO_SKILL_FILE'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('marks Codex system skills and flat markdown inside DSH roots', async () => {
  const root = await makeRoot();
  try {
    await writeSkill(root, 'user-skill', ['name: user-skill', 'description: User skill.']);
    await writeSkill(root, '.system/system-skill', ['name: system-skill', 'description: System skill.']);
    const result = await scanSource(source('codex', root, { kind: 'external', systemSubdir: '.system' }));
    assert.equal(result.summary.skillCount, 2);
    assert.equal(result.summary.systemCount, 1);
    const system = result.skills.find((skill) => skill.name === 'system-skill');
    assert.equal(system.system, true);
    assert.equal(system.category, '.system');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detects symlinked skill directories and broken symlinks', async () => {
  const root = await makeRoot();
  const outside = await makeRoot();
  try {
    await writeSkill(outside, 'linked', ['name: linked', 'description: Linked skill.']);
    await symlink(path.join(outside, 'linked'), path.join(root, 'linked'));
    await symlink(path.join(outside, 'missing'), path.join(root, 'broken'));
    const result = await scanSource(source('zcode', root, { kind: 'external' }));
    const linked = result.skills.find((skill) => skill.name === 'linked');
    assert.equal(linked.isSymlink, true);
    assert.ok(linked.symlinkTarget.includes('linked'));
    assert.ok(linked.diagnostics.some((item) => item.code === 'symlink'));
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('scanCatalog marks shadowed duplicates inside the DSH catalog', async () => {
  const userRoot = await makeRoot();
  const projectRoot = await makeRoot();
  try {
    await writeSkill(userRoot, 'shared-skill', ['name: shared-skill', 'description: User copy of the skill.']);
    await writeSkill(projectRoot, 'shared-skill', ['name: shared-skill', 'description: Project copy of the skill.']);
    const sources = [
      source('dsh-user', userRoot, { kind: 'dsh-user', agent: 'dsh', writable: true, readOnly: false, flat: true, order: 10 }),
      source('project', projectRoot, { kind: 'project', agent: 'dsh', scope: 'project', flat: true, order: 30 }),
    ];
    const catalog = await scanCatalog(sources);
    assert.equal(catalog.complete, true);
    assert.equal(catalog.skills.length, 2);
    const project = catalog.skills.find((skill) => skill.sourceKind === 'project');
    const user = catalog.skills.find((skill) => skill.sourceKind === 'dsh-user');
    assert.equal(project.shadowed, undefined);
    assert.equal(user.shadowed, true);
    assert.equal(user.shadowedBy, project.id);
    assert.equal(catalog.summary.skills, 2);
  } finally {
    await rm(userRoot, { recursive: true, force: true });
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test('scanCatalog keeps going when a source root does not exist', async () => {
  const root = await makeRoot();
  try {
    await writeSkill(root, 'only-skill', ['name: only-skill', 'description: Only skill.']);
    const catalog = await scanCatalog([
      source('missing', path.join(root, 'does-not-exist'), { kind: 'external' }),
      source('present', root, { kind: 'external' }),
    ]);
    assert.equal(catalog.complete, true);
    assert.equal(catalog.skills.length, 1);
    assert.equal(catalog.sources.find((item) => item.key === 'missing').exists, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('detail returns SKILL.md and a bounded file tree; readFile rejects traversal', async () => {
  const root = await makeRoot();
  try {
    await writeSkill(root, 'detail-skill', ['name: detail-skill', 'description: Detail skill.']);
    await mkdir(path.join(root, 'detail-skill', 'references'), { recursive: true });
    await writeFile(path.join(root, 'detail-skill', 'references', 'guide.md'), '# Guide\n', 'utf8');
    await writeFile(path.join(root, 'detail-skill', 'notes.txt'), 'notes', 'utf8');
    const result = await scanSource(source('custom', root, { kind: 'external' }));
    const skill = result.skills[0];
    const detail = await readSkillDetail(skill);
    assert.equal(detail.ok, true);
    assert.ok(detail.content.includes('detail-skill'));
    const files = detail.files.map((entry) => entry.relativePath);
    assert.ok(files.includes('SKILL.md'));
    assert.ok(files.includes('notes.txt'));
    assert.ok(files.includes(path.join('references', 'guide.md')));

    const guide = await readSkillFile(skill, path.join('references', 'guide.md'));
    assert.equal(guide.ok, true);
    assert.equal(guide.content, '# Guide\n');

    const outside = await readSkillFile(skill, '../outside.md');
    assert.equal(outside.ok, false);
    assert.equal(outside.code, 'PATH_OUTSIDE_SKILL');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('buildSources accepts projectRoots from configuration', () => {
  const sources = buildSources({
    home: '/home/tester',
    env: {},
    execPath: '/opt/node',
    projectRoots: [{ path: '/srv/demo', label: 'Demo' }],
  });
  const project = sources.find((item) => item.kind === 'project');
  assert.equal(project.writable, false);
  assert.equal(project.path, '/srv/demo/.dsh/skills');
});
