/**
 * Live provider and settings-store tests.
 */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createLiveProvider, LIVE_RANK } from '../lib/live.js';
import {
  defaultSettings,
  normalizeSettings,
  readSettings,
  setLiveSource,
  settingsPath,
} from '../lib/settings.js';
import { ensureHome, skillCuratorHome } from '../lib/state.js';
import { splitFrontmatter } from '../lib/frontmatter.js';

async function makeHome() {
  const base = await mkdtemp(path.join(os.tmpdir(), 'dsh-curator-live-'));
  const paths = await ensureHome(skillCuratorHome({ config: { dshHome: path.join(base, '.dsh') } }));
  return { base, paths };
}

function fakeSkill(overrides = {}) {
  return {
    id: 'id-1',
    name: 'live-skill',
    description: 'A skill available live.',
    path: '/tmp/skills/live-skill/SKILL.md',
    skillDir: '/tmp/skills/live-skill',
    isFlat: false,
    readOnly: true,
    sourceKey: 'claude',
    diagnostics: [],
    ...overrides,
  };
}

function fakeCatalog(skills) {
  return {
    revision: 'rev',
    skills,
    sources: [{ key: 'claude', readOnly: true }],
  };
}

test('settings default, normalize and persist one live source', async () => {
  const { base, paths } = await makeHome();
  try {
    assert.deepEqual(defaultSettings(), { version: 1, liveSources: {} });
    assert.deepEqual(normalizeSettings({ version: 1, liveSources: { claude: true, bad: 'yes', 'x y': true } }), {
      version: 1,
      liveSources: { claude: true },
    });
    assert.deepEqual(await readSettings(paths), defaultSettings());

    const config = { dshHome: path.join(base, '.dsh') };
    const settings = await setLiveSource(config, 'claude', true);
    assert.equal(settings.liveSources.claude, true);
    const stored = JSON.parse(await readFile(settingsPath(paths), 'utf8'));
    assert.equal(stored.liveSources.claude, true);
    const audit = await readFile(path.join(paths.root, 'audit.jsonl'), 'utf8');
    assert.match(audit, /live-enable/);

    const disabled = await setLiveSource(config, 'claude', false);
    assert.deepEqual(disabled.liveSources, {});
    await assert.rejects(() => setLiveSource(config, 'bad key', true), (error) => error.code === 'SOURCE_KEY_INVALID');
    await assert.rejects(() => setLiveSource(config, 'claude', 'yes'), (error) => error.code === 'ENABLED_INVALID');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('live provider exposes only enabled read-only skills with a lower rank', async () => {
  const skills = [
    fakeSkill(),
    fakeSkill({ id: 'id-2', name: 'other-skill', sourceKey: 'zcode' }),
    fakeSkill({ id: 'id-3', name: 'Local Skill', sourceKey: 'claude' }),
    fakeSkill({ id: 'id-4', name: 'writable-skill', sourceKey: 'claude', readOnly: false, writable: true }),
  ];
  const provider = createLiveProvider({
    getSettings: async () => ({ liveSources: { claude: true } }),
    loadCatalog: async () => fakeCatalog(skills),
  });
  const candidates = await provider.list();
  assert.equal(candidates.length, 1);
  const candidate = candidates[0];
  assert.equal(candidate.name, 'live-skill');
  assert.equal(candidate.rank, LIVE_RANK);
  assert.equal(candidate.provider, 'skill-curator-live');
  assert.equal(candidate.source, 'live:claude');
  assert.deepEqual(candidate.invocation, { modelInvocable: true, userInvocable: false });
  assert.equal(candidate.locator.path, '/tmp/skills/live-skill/SKILL.md');
});

test('live provider returns no candidates when nothing is enabled', async () => {
  const provider = createLiveProvider({
    getSettings: async () => ({ liveSources: {} }),
    loadCatalog: async () => fakeCatalog([fakeSkill()]),
  });
  assert.deepEqual(await provider.list(), []);
});

test('live provider loads the external body and rejects a renamed skill', async () => {
  const base = await mkdtemp(path.join(os.tmpdir(), 'dsh-curator-live-body-'));
  try {
    const skillDir = path.join(base, 'live-skill');
    const { mkdir, writeFile } = await import('node:fs/promises');
    await mkdir(skillDir, { recursive: true });
    const file = path.join(skillDir, 'SKILL.md');
    await writeFile(file, '---\nname: live-skill\ndescription: Live body.\n---\n\nBody text.\n', 'utf8');
    const skill = fakeSkill({ path: file, skillDir });
    const provider = createLiveProvider({
      getSettings: async () => ({ liveSources: { claude: true } }),
      loadCatalog: async () => fakeCatalog([skill]),
    });
    const [candidate] = await provider.list();
    const definition = await provider.get(candidate);
    assert.equal(definition.content, 'Body text.');
    assert.equal(definition.name, 'live-skill');
    assert.equal(definition.metadata.live, true);
    const renamed = { ...candidate, name: 'another-name' };
    assert.equal(await provider.get(renamed), undefined);
    assert.equal(await provider.get({ ...candidate, locator: { path: path.join(base, 'missing.md') } }), undefined);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('frontmatter name drives the live candidate name', () => {
  const document = splitFrontmatter('---\nname: live-skill\ndescription: D\n---\nBody');
  assert.equal(document.data.name, 'live-skill');
});
