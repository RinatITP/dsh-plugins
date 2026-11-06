/**
 * Mutation engine tests over an isolated home directory.
 *
 * Every test builds its own `~/.dsh`, `~/.agents`, project and external roots
 * under the OS temp dir, so nothing here touches the developer's real skills.
 */
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createCatalog } from '../lib/catalog.js';

const DISABLED_EXTERNALS = {
  claude: false,
  codex: false,
  hermes: false,
  zcode: false,
  cursor: false,
  gemini: false,
  kimi: false,
  opencode: false,
};

async function makeEnv() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'dsh-curator-mut-'));
  const home = path.join(base, 'home');
  const dshSkills = path.join(home, '.dsh', 'skills');
  const agentsSkills = path.join(home, '.agents', 'skills');
  const project = path.join(base, 'project');
  const projectSkills = path.join(project, '.dsh', 'skills');
  const externalHome = path.join(base, 'external-home');
  const externalSkills = path.join(externalHome, 'skills');
  await mkdir(dshSkills, { recursive: true });
  await mkdir(agentsSkills, { recursive: true });
  await mkdir(projectSkills, { recursive: true });
  await mkdir(externalSkills, { recursive: true });

  const config = {
    dshHome: path.join(home, '.dsh'),
    agentsHome: path.join(home, '.agents'),
    bundledSkillDir: path.join(base, 'no-bundled-dir'),
    externalSources: { ...DISABLED_EXTERNALS, claude: { path: externalHome } },
  };
  const catalog = createCatalog({
    config: () => config,
    projectRoots: () => [{ path: project, label: 'Demo' }],
    env: {},
    home,
  });
  return {
    base,
    home,
    dshSkills,
    agentsSkills,
    project,
    projectSkills,
    externalSkills,
    catalog,
    managerHome: path.join(home, '.dsh', 'skill-curator'),
  };
}

async function seedSkill(root, name, description = 'Use this when the test needs a seeded skill.') {
  const dir = path.join(root, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', `# ${name}`, '', 'Do the thing.', ''].join('\n'),
    'utf8',
  );
  return dir;
}

async function seedFlat(root, name) {
  const file = path.join(root, `${name}.md`);
  await writeFile(
    file,
    ['---', `name: ${name}`, 'description: Use this when the test needs a flat skill.', '---', '', 'Flat body.', ''].join('\n'),
    'utf8',
  );
  return file;
}

async function cleanup(env) {
  await rm(env.base, { recursive: true, force: true });
}

test('create → save → toggle → resource → trash → restore on the user root', async () => {
  const env = await makeEnv();
  try {
    const snapshot = await env.catalog.snapshot();
    const created = await env.catalog.createSkill({
      confirm: true,
      revision: snapshot.revision,
      scope: 'user',
      name: 'demo-skill',
      description: 'Use this when the user asks for a demo skill.',
      body: '# Demo\n\nDo the demo.',
      files: [{ path: 'references/guide.md', content: '# Guide\n' }],
    });
    assert.ok(created.skill, 'created skill is projected');
    const skillPath = created.skill.path;
    assert.equal(created.skill.name, 'demo-skill');
    assert.match(await readFile(skillPath, 'utf8'), /Do the demo\./);
    assert.equal(await readFile(path.join(path.dirname(skillPath), 'references', 'guide.md'), 'utf8'), '# Guide\n');

    const original = await readFile(skillPath, 'utf8');
    const saved = await env.catalog.saveSkill({
      confirm: true,
      revision: created.revision,
      id: created.skill.id,
      content: original.replace('Do the demo.', 'Do the demo better.'),
    });
    assert.match(await readFile(skillPath, 'utf8'), /Do the demo better\./);
    const backups = await readdir(path.join(env.managerHome, 'backups'));
    assert.ok(backups.length >= 1, 'a backup directory exists');

    const toggled = await env.catalog.toggleSkill({
      confirm: true,
      revision: saved.revision,
      id: created.skill.id,
      modelInvocable: false,
      userInvocable: false,
    });
    const disabledText = await readFile(skillPath, 'utf8');
    assert.match(disabledText, /^disable-model-invocation: true$/m);
    assert.match(disabledText, /^user-invocable: false$/m);
    assert.equal(toggled.skill.invocation.modelInvocable, false);
    assert.equal(toggled.skill.invocation.userInvocable, false);

    const enabled = await env.catalog.toggleSkill({
      confirm: true,
      revision: toggled.revision,
      id: created.skill.id,
      modelInvocable: true,
      userInvocable: true,
    });
    const enabledText = await readFile(skillPath, 'utf8');
    assert.doesNotMatch(enabledText, /disable-model-invocation/);
    assert.doesNotMatch(enabledText, /user-invocable/);

    const written = await env.catalog.writeFile({
      confirm: true,
      revision: enabled.revision,
      id: created.skill.id,
      path: 'references/notes.md',
      content: '# Notes\n',
    });
    assert.equal(await readFile(path.join(path.dirname(skillPath), 'references', 'notes.md'), 'utf8'), '# Notes\n');

    const removed = await env.catalog.removeSkill({
      confirm: true,
      revision: written.revision,
      id: created.skill.id,
    });
    assert.ok(removed.trash.id);
    await assert.rejects(() => readFile(skillPath, 'utf8'), /ENOENT/);

    const trash = await env.catalog.listTrash();
    assert.equal(trash.items.length, 1);
    assert.equal(trash.items[0].name, 'demo-skill');

    await env.catalog.restoreTrash({ confirm: true, id: trash.items[0].id });
    assert.match(await readFile(skillPath, 'utf8'), /Do the demo better\./);
    const afterRestore = await env.catalog.listTrash();
    assert.equal(afterRestore.items.length, 0);
  } finally {
    await cleanup(env);
  }
});

test('mutations require confirmation, a fresh revision and valid frontmatter', async () => {
  const env = await makeEnv();
  try {
    const dir = await seedSkill(env.dshSkills, 'guarded-skill');
    const snapshot = await env.catalog.snapshot();
    const skill = snapshot.skills.find((item) => item.name === 'guarded-skill');
    const content = await readFile(path.join(dir, 'SKILL.md'), 'utf8');

    await assert.rejects(
      () => env.catalog.saveSkill({ revision: snapshot.revision, id: skill.id, content }),
      (error) => error.code === 'CONFIRM_REQUIRED',
    );
    await assert.rejects(
      () => env.catalog.saveSkill({ confirm: true, revision: 'stale', id: skill.id, content }),
      (error) => error.code === 'STALE_REVISION',
    );
    await assert.rejects(
      () => env.catalog.saveSkill({
        confirm: true,
        revision: snapshot.revision,
        id: skill.id,
        content: '---\nname: Bad Name\ndescription: Broken\n---\n\nBody\n',
      }),
      (error) => error.code === 'VALIDATION_FAILED'
        && Array.isArray(error.details.diagnostics)
        && error.details.diagnostics.length > 0,
    );
  } finally {
    await cleanup(env);
  }
});

test('external read-only skills reject every mutation', async () => {
  const env = await makeEnv();
  try {
    const dir = await seedSkill(env.externalSkills, 'external-skill');
    const snapshot = await env.catalog.snapshot({ force: true });
    const skill = snapshot.skills.find((item) => item.name === 'external-skill');
    assert.equal(skill.readOnly, true);
    assert.equal(skill.writable, false);
    const content = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
    await assert.rejects(
      () => env.catalog.saveSkill({ confirm: true, revision: snapshot.revision, id: skill.id, content }),
      (error) => error.code === 'READ_ONLY_SKILL',
    );
    await assert.rejects(
      () => env.catalog.removeSkill({ confirm: true, revision: snapshot.revision, id: skill.id }),
      (error) => error.code === 'READ_ONLY_SKILL',
    );
  } finally {
    await cleanup(env);
  }
});

test('symlinked skills are protected from writes', async () => {
  const env = await makeEnv();
  try {
    const outside = path.join(env.base, 'outside');
    const realDir = await seedSkill(outside, 'linked-skill');
    await symlink(realDir, path.join(env.dshSkills, 'linked-skill'));
    const snapshot = await env.catalog.snapshot({ force: true });
    const skill = snapshot.skills.find((item) => item.name === 'linked-skill');
    assert.equal(skill.isSymlink, true);
    const content = await readFile(path.join(realDir, 'SKILL.md'), 'utf8');
    await assert.rejects(
      () => env.catalog.saveSkill({ confirm: true, revision: snapshot.revision, id: skill.id, content }),
      (error) => error.code === 'SYMLINK_READ_ONLY',
    );
  } finally {
    await cleanup(env);
  }
});

test('flat markdown skills can be toggled, trashed and restored', async () => {
  const env = await makeEnv();
  try {
    const file = await seedFlat(env.dshSkills, 'flat-skill');
    const snapshot = await env.catalog.snapshot({ force: true });
    const skill = snapshot.skills.find((item) => item.name === 'flat-skill');
    assert.equal(skill.isFlat, true);
    const toggled = await env.catalog.toggleSkill({
      confirm: true,
      revision: snapshot.revision,
      id: skill.id,
      modelInvocable: false,
      userInvocable: false,
    });
    assert.match(await readFile(file, 'utf8'), /^disable-model-invocation: true$/m);

    const removed = await env.catalog.removeSkill({
      confirm: true,
      revision: toggled.revision,
      id: skill.id,
    });
    assert.equal(removed.trash.isFlat, true);
    await assert.rejects(() => readFile(file, 'utf8'), /ENOENT/);
    const trash = await env.catalog.listTrash();
    assert.equal(trash.items.length, 1);
    await env.catalog.restoreTrash({ confirm: true, id: trash.items[0].id });
    assert.match(await readFile(file, 'utf8'), /^disable-model-invocation: true$/m);
  } finally {
    await cleanup(env);
  }
});

test('project scope creates skills under the configured workspace root', async () => {
  const env = await makeEnv();
  try {
    const snapshot = await env.catalog.snapshot({ force: true });
    const created = await env.catalog.createSkill({
      confirm: true,
      revision: snapshot.revision,
      scope: 'project',
      workspacePath: env.project,
      name: 'project-skill',
      description: 'Use this when the project needs its own skill.',
      body: '# Project skill\n\nBody.',
    });
    assert.ok(created.skill);
    assert.ok(created.skill.path.startsWith(path.join(env.projectSkills, 'project-skill')));
    const updated = await env.catalog.snapshot({ force: true });
    assert.ok(updated.skills.some((item) => item.name === 'project-skill' && item.scope === 'project'));
  } finally {
    await cleanup(env);
  }
});

test('create rejects collisions and invalid names', async () => {
  const env = await makeEnv();
  try {
    await seedSkill(env.dshSkills, 'taken-skill');
    const snapshot = await env.catalog.snapshot({ force: true });
    await assert.rejects(
      () => env.catalog.createSkill({
        confirm: true,
        revision: snapshot.revision,
        scope: 'user',
        name: 'taken-skill',
        description: 'Use this when testing collisions with an existing skill.',
        body: 'Body',
      }),
      (error) => error.code === 'TARGET_EXISTS',
    );
    await assert.rejects(
      () => env.catalog.createSkill({
        confirm: true,
        revision: snapshot.revision,
        scope: 'user',
        name: 'Bad Name',
        description: 'Use this when testing invalid names for a skill.',
        body: 'Body',
      }),
      (error) => error.code === 'SKILL_NAME_INVALID',
    );
  } finally {
    await cleanup(env);
  }
});
