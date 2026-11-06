/**
 * Import planner/executor tests over an isolated home directory.
 */
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
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
  const base = await mkdtemp(path.join(os.tmpdir(), 'dsh-curator-import-'));
  const home = path.join(base, 'home');
  const dshSkills = path.join(home, '.dsh', 'skills');
  const agentsSkills = path.join(home, '.agents', 'skills');
  const project = path.join(base, 'project');
  const projectSkills = path.join(project, '.dsh', 'skills');
  const externalHome = path.join(base, 'external-home');
  const externalSkills = path.join(externalHome, 'skills');
  const customRoot = path.join(base, 'custom-skills');
  await mkdir(dshSkills, { recursive: true });
  await mkdir(agentsSkills, { recursive: true });
  await mkdir(projectSkills, { recursive: true });
  await mkdir(externalSkills, { recursive: true });
  await mkdir(customRoot, { recursive: true });

  const config = {
    dshHome: path.join(home, '.dsh'),
    agentsHome: path.join(home, '.agents'),
    bundledSkillDir: path.join(base, 'no-bundled-dir'),
    externalSources: { ...DISABLED_EXTERNALS, claude: { path: externalHome } },
    customSources: [{ label: 'Custom library', path: customRoot }],
  };
  const catalog = createCatalog({
    config: () => config,
    projectRoots: () => [{ path: project, label: 'Demo' }],
    env: {},
    home,
  });
  return { base, home, dshSkills, agentsSkills, project, projectSkills, externalSkills, customRoot, catalog };
}

async function seedSkill(root, folder, name, description = 'Use this when importing in a test.') {
  const dir = path.join(root, folder);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'SKILL.md'),
    ['---', `name: ${name}`, `description: ${description}`, '---', '', '# Body', '', 'Do it.', ''].join('\n'),
    'utf8',
  );
  return dir;
}

async function cleanup(env) {
  await rm(env.base, { recursive: true, force: true });
}

test('scan plans external candidates for the user target', async () => {
  const env = await makeEnv();
  try {
    await seedSkill(env.externalSkills, 'claude-skill', 'claude-skill');
    await seedSkill(env.customRoot, 'custom-skill', 'custom-skill');
    const plan = await env.catalog.importScan({ target: 'user', mode: 'copy' });
    assert.equal(plan.target, 'user');
    assert.equal(plan.targetRoot, env.dshSkills);
    const candidates = plan.candidates;
    assert.equal(candidates.length, 2);
    const claude = candidates.find((item) => item.name === 'claude-skill');
    assert.equal(claude.skipReason, null);
    assert.equal(claude.targetPath, path.join(env.dshSkills, 'claude-skill'));
    assert.ok(claude.sourceLabelKey === 'source.claude');
    assert.equal(plan.counts.importable, 2);
  } finally {
    await cleanup(env);
  }
});

test('copy import creates an independent copy and refreshes the catalog', async () => {
  const env = await makeEnv();
  try {
    const sourceDir = await seedSkill(env.externalSkills, 'copied-skill', 'copied-skill');
    await mkdir(path.join(sourceDir, 'references'), { recursive: true });
    await writeFile(path.join(sourceDir, 'references', 'guide.md'), '# Guide\n', 'utf8');
    const snapshot = await env.catalog.snapshot({ force: true });
    const plan = await env.catalog.importScan({ target: 'user' });
    const candidate = plan.candidates.find((item) => item.name === 'copied-skill');
    const result = await env.catalog.importApply({
      confirm: true,
      revision: snapshot.revision,
      target: 'user',
      mode: 'copy',
      ids: [candidate.id],
    });
    assert.equal(result.counts.imported, 1);
    const targetDir = path.join(env.dshSkills, 'copied-skill');
    assert.match(await readFile(path.join(targetDir, 'SKILL.md'), 'utf8'), /copied-skill/);
    assert.equal(await readFile(path.join(targetDir, 'references', 'guide.md'), 'utf8'), '# Guide\n');
    const targetInfo = await lstat(targetDir);
    assert.equal(targetInfo.isSymbolicLink(), false);
    const updated = await env.catalog.snapshot({ force: true });
    assert.ok(updated.skills.some((item) => item.name === 'copied-skill' && item.writable === true));
  } finally {
    await cleanup(env);
  }
});

test('symlink import links to the source directory', async () => {
  const env = await makeEnv();
  try {
    const sourceDir = await seedSkill(env.externalSkills, 'linked-skill', 'linked-skill');
    const snapshot = await env.catalog.snapshot({ force: true });
    const plan = await env.catalog.importScan({ target: 'user', mode: 'symlink' });
    const candidate = plan.candidates.find((item) => item.name === 'linked-skill');
    const result = await env.catalog.importApply({
      confirm: true,
      revision: snapshot.revision,
      target: 'user',
      mode: 'symlink',
      ids: [candidate.id],
    });
    assert.equal(result.counts.imported, 1);
    const targetPath = path.join(env.dshSkills, 'linked-skill');
    const targetInfo = await lstat(targetPath);
    assert.equal(targetInfo.isSymbolicLink(), true);
    assert.equal(await readlink(targetPath), sourceDir);
  } finally {
    await cleanup(env);
  }
});

test('existing target names are skipped, never overwritten', async () => {
  const env = await makeEnv();
  try {
    await seedSkill(env.externalSkills, 'shared-skill', 'shared-skill');
    const existing = await seedSkill(env.dshSkills, 'shared-skill', 'shared-skill');
    const before = await readFile(path.join(existing, 'SKILL.md'), 'utf8');
    const snapshot = await env.catalog.snapshot({ force: true });
    const plan = await env.catalog.importScan({ target: 'user' });
    const candidate = plan.candidates.find((item) => item.name === 'shared-skill');
    assert.equal(candidate.skipReason, 'TARGET_EXISTS');
    const result = await env.catalog.importApply({
      confirm: true,
      revision: snapshot.revision,
      target: 'user',
      mode: 'copy',
      ids: [candidate.id],
    });
    assert.equal(result.counts.skipped, 1);
    assert.equal(result.results[0].code, 'TARGET_EXISTS');
    assert.equal(await readFile(path.join(existing, 'SKILL.md'), 'utf8'), before);
  } finally {
    await cleanup(env);
  }
});

test('invalid names are not importable', async () => {
  const env = await makeEnv();
  try {
    await seedSkill(env.externalSkills, 'Bad Folder', 'Bad Name');
    const plan = await env.catalog.importScan({ target: 'user' });
    const candidate = plan.candidates.find((item) => item.sourceKey === 'claude');
    assert.equal(candidate.skipReason, 'INVALID_NAME');
    const snapshot = await env.catalog.snapshot({ force: true });
    const result = await env.catalog.importApply({
      confirm: true,
      revision: snapshot.revision,
      target: 'user',
      mode: 'copy',
      ids: [candidate.id],
    });
    assert.equal(result.counts.skipped, 1);
  } finally {
    await cleanup(env);
  }
});

test('duplicate names across sources resolve to one importable candidate', async () => {
  const env = await makeEnv();
  try {
    await seedSkill(env.externalSkills, 'same-name', 'same-name');
    await seedSkill(env.customRoot, 'same-name', 'same-name');
    const plan = await env.catalog.importScan({ target: 'user' });
    const candidates = plan.candidates.filter((item) => item.name === 'same-name');
    assert.equal(candidates.length, 2);
    assert.equal(candidates.filter((item) => item.skipReason === null).length, 1);
    assert.equal(candidates.filter((item) => item.skipReason === 'NAME_TAKEN').length, 1);
  } finally {
    await cleanup(env);
  }
});

test('flat markdown skills import as .md files', async () => {
  const env = await makeEnv();
  try {
    await writeFile(
      path.join(env.agentsSkills, 'flat-import.md'),
      '---\nname: flat-import\ndescription: Use this when importing a flat skill.\n---\n\nBody.\n',
      'utf8',
    );
    const snapshot = await env.catalog.snapshot({ force: true });
    const plan = await env.catalog.importScan({ target: 'user' });
    const candidate = plan.candidates.find((item) => item.name === 'flat-import');
    assert.equal(candidate.isFlat, true);
    assert.equal(candidate.targetPath, path.join(env.dshSkills, 'flat-import.md'));
    const result = await env.catalog.importApply({
      confirm: true,
      revision: snapshot.revision,
      target: 'user',
      mode: 'copy',
      ids: [candidate.id],
    });
    assert.equal(result.counts.imported, 1);
    assert.match(await readFile(path.join(env.dshSkills, 'flat-import.md'), 'utf8'), /flat-import/);
  } finally {
    await cleanup(env);
  }
});

test('project target imports into the configured workspace root', async () => {
  const env = await makeEnv();
  try {
    await seedSkill(env.externalSkills, 'project-import', 'project-import');
    const snapshot = await env.catalog.snapshot({ force: true });
    const plan = await env.catalog.importScan({ target: 'project', workspacePath: env.project });
    assert.equal(plan.targetRoot, env.projectSkills);
    const candidate = plan.candidates.find((item) => item.name === 'project-import');
    const result = await env.catalog.importApply({
      confirm: true,
      revision: snapshot.revision,
      target: 'project',
      workspacePath: env.project,
      mode: 'copy',
      ids: [candidate.id],
    });
    assert.equal(result.counts.imported, 1);
    assert.match(await readFile(path.join(env.projectSkills, 'project-import', 'SKILL.md'), 'utf8'), /project-import/);
  } finally {
    await cleanup(env);
  }
});

test('import requires confirmation, a revision and a non-empty selection', async () => {
  const env = await makeEnv();
  try {
    const snapshot = await env.catalog.snapshot({ force: true });
    await assert.rejects(
      () => env.catalog.importApply({ revision: snapshot.revision, target: 'user', ids: ['x'], mode: 'copy' }),
      (error) => error.code === 'CONFIRM_REQUIRED',
    );
    await assert.rejects(
      () => env.catalog.importApply({ confirm: true, revision: 'stale', target: 'user', ids: ['x'], mode: 'copy' }),
      (error) => error.code === 'STALE_REVISION',
    );
    await assert.rejects(
      () => env.catalog.importApply({ confirm: true, revision: snapshot.revision, target: 'user', ids: [], mode: 'copy' }),
      (error) => error.code === 'SELECTION_EMPTY',
    );
  } finally {
    await cleanup(env);
  }
});
