/**
 * Discovery scans only allowlisted, well-known configuration files and returns
 * raw `mcpServers` entries for the manager to validate. These tests use a
 * throwaway HOME so no user file is touched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSources, findSource } from '../lib/discovery.js';

async function makeHome() {
  const home = await mkdtemp(join(tmpdir(), 'dsh-mcp-guard-discovery-'));
  return home;
}

async function writeJson(path, value) {
  await mkdir(join(path, '..'), { recursive: true }).catch(() => {});
  await writeFile(path, JSON.stringify(value, null, 2));
}

test('scans Cursor, Claude Code, VS Code and project files', async (t) => {
  const home = await makeHome();
  const dshHome = join(home, '.dsh');
  const workspace = join(home, 'work', 'project');
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(workspace, { recursive: true });

  await writeJson(join(home, '.cursor', 'mcp.json'), {
    mcpServers: {
      cursorServer: { command: 'node', args: ['cursor.mjs'], env: { API_TOKEN: 'secret-value' } },
    },
  });
  await writeJson(join(home, '.claude.json'), {
    mcpServers: { claudeGlobal: { command: 'node', args: ['global.mjs'] } },
    projects: {
      [workspace]: {
        mcpServers: { claudeProject: { command: 'node', args: ['project.mjs'] } },
      },
    },
  });
  await writeJson(join(dshHome, 'mcp.json'), {
    mcpServers: { dshServer: { command: 'node', args: ['dsh.mjs'] } },
  });
  await writeJson(join(workspace, '.vscode', 'mcp.json'), {
    servers: { vscodeServer: { command: 'node', args: ['vscode.mjs'] } },
  });
  await writeJson(join(workspace, '.mcp.json'), {
    mcpServers: { projectServer: { command: 'node', args: ['p.mjs'] } },
  });

  const sources = await scanSources({ home, dshHome, workspaces: [workspace] });
  const byKind = Object.fromEntries(sources.map((source) => [source.kind, source]));

  assert.ok(byKind.cursor);
  assert.deepEqual(byKind.cursor.servers.map((item) => item.serverName), ['cursorServer']);
  assert.equal(byKind.cursor.servers[0].entry.env.API_TOKEN, 'secret-value');
  assert.ok(byKind['claude-code']);
  assert.deepEqual(byKind['claude-code'].servers.map((item) => item.serverName).sort(), ['claudeGlobal', 'claudeProject']);
  const projectEntry = byKind['claude-code'].servers.find((item) => item.serverName === 'claudeProject');
  assert.equal(projectEntry.scope, workspace);
  assert.ok(byKind.dsh);
  assert.ok(byKind['project-vscode']);
  assert.deepEqual(byKind['project-vscode'].servers.map((item) => item.serverName), ['vscodeServer']);
  assert.ok(byKind['project-claude']);
  assert.equal(findSource(sources, byKind.cursor.id), byKind.cursor);
  assert.equal(findSource(sources, 'missing'), null);
});

test('skips missing and empty configuration files', async (t) => {
  const home = await makeHome();
  t.after(() => rm(home, { recursive: true, force: true }));
  const sources = await scanSources({ home, dshHome: join(home, '.dsh'), workspaces: [join(home, 'none')] });
  assert.deepEqual(sources, []);

  await writeJson(join(home, '.cursor', 'mcp.json'), { mcpServers: {} });
  assert.deepEqual(await scanSources({ home, dshHome: join(home, '.dsh'), workspaces: [] }), []);
});

test('reports invalid JSON as a source error instead of throwing', async (t) => {
  const home = await makeHome();
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(join(home, '.cursor'), { recursive: true });
  await writeFile(join(home, '.cursor', 'mcp.json'), '{ not json');
  const sources = await scanSources({ home, dshHome: join(home, '.dsh'), workspaces: [] });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].kind, 'cursor');
  assert.equal(sources[0].error, 'SOURCE_INVALID_JSON');
});

test('returns an empty list without a home directory', async () => {
  assert.deepEqual(await scanSources({ home: '' }), []);
});
