/**
 * Unit tests for root discovery and path expansion.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSources, detectBundledSkillDir, expandPath } from '../lib/roots.js';

const HOME = '/home/tester';
const ENV = { DSH_HOME: '/home/tester/.dsh' };

test('builds the default source order with read/write flags', () => {
  const sources = buildSources({ home: HOME, env: ENV, execPath: '/opt/not-dsh/node' });
  const keys = sources.map((source) => source.key);
  assert.deepEqual(keys.slice(0, 2), ['dsh-user', 'dsh-agents']);
  assert.ok(keys.includes('bundled') === false, 'no bundled dir for a non-Desktop executable');
  const user = sources.find((source) => source.key === 'dsh-user');
  assert.equal(user.path, '/home/tester/.dsh/skills');
  assert.equal(user.writable, true);
  assert.equal(user.readOnly, false);
  const claude = sources.find((source) => source.key === 'claude');
  assert.equal(claude.path, '/home/tester/.claude/skills');
  assert.equal(claude.readOnly, true);
  const codex = sources.find((source) => source.key === 'codex');
  assert.equal(codex.systemSubdir, '.system');
  const hermes = sources.find((source) => source.key === 'hermes');
  assert.equal(hermes.depth, 2);
});

test('honours environment overrides and the agents home', () => {
  const sources = buildSources({
    home: HOME,
    env: {
      DSH_HOME: '/srv/dsh',
      DSH_AGENTS_HOME: '/srv/agents',
      DSH_CLAUDE_HOME: '/srv/claude',
      DSH_HERMES_HOME: '/srv/hermes',
    },
    execPath: '/opt/not-dsh/node',
  });
  assert.equal(sources.find((source) => source.key === 'dsh-user').path, '/srv/dsh/skills');
  assert.equal(sources.find((source) => source.key === 'dsh-agents').path, '/srv/agents/skills');
  assert.equal(sources.find((source) => source.key === 'claude').path, '/srv/claude/skills');
  assert.equal(sources.find((source) => source.key === 'hermes').path, '/srv/hermes/skills');
});

test('disabled external agents disappear and custom sources are appended', () => {
  const sources = buildSources({
    home: HOME,
    env: ENV,
    execPath: '/opt/not-dsh/node',
    config: {
      externalSources: { claude: false, codex: { path: '/custom/codex-home' } },
      customSources: [{ label: 'My library', path: '/srv/skills' }, { label: 'bad', path: 'relative' }],
      projectRoots: [{ path: '/srv/project', label: 'Demo' }],
    },
    projectRoots: [{ path: '/srv/project', label: 'Demo' }],
  });
  const keys = sources.map((source) => source.key);
  assert.ok(!keys.includes('claude'));
  assert.equal(sources.find((source) => source.key === 'codex').path, '/custom/codex-home/skills');
  const custom = sources.find((source) => source.key === 'custom:My library');
  assert.equal(custom.path, '/srv/skills');
  assert.equal(custom.readOnly, true);
  assert.ok(!keys.includes('custom:bad'));
  const project = sources.find((source) => source.kind === 'project');
  assert.equal(project.path, '/srv/project/.dsh/skills');
  assert.equal(project.writable, false);
});

test('expandPath expands tilde, environment variables and rejects relative input', () => {
  assert.equal(expandPath('~/skills', { home: HOME, env: {} }), '/home/tester/skills');
  assert.equal(expandPath('$HOME/skills', { home: HOME, env: { HOME } }), '/home/tester/skills');
  assert.equal(expandPath('${HOME}/skills', { home: HOME, env: { HOME } }), '/home/tester/skills');
  assert.equal(expandPath('   ', { home: HOME, env: {} }), null);
  assert.equal(expandPath('relative/path', { home: HOME, env: {} }), null);
  assert.equal(expandPath('$MISSING/skills', { home: HOME, env: {} }), null);
});

test('detectBundledSkillDir prefers the environment and understands the Desktop layout', () => {
  assert.equal(
    detectBundledSkillDir({ execPath: '/opt/node', env: { DSH_BUNDLED_SKILL_DIR: '/srv/bundled' } }),
    '/srv/bundled',
  );
  assert.equal(
    detectBundledSkillDir({
      execPath: '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
      env: {},
    }),
    '/Applications/DeepSeek Harness.app/Contents/Resources/runtime/office-skills',
  );
  assert.equal(detectBundledSkillDir({ execPath: '/usr/bin/node', env: {} }), null);
});
