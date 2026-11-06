/**
 * Controller tests for dsh-mcp-guard with a fake profile adapter.
 *
 * These exercise the Host contract end to end at the manager level: revision
 * guards, confirmations, fail-closed saves, secret write-only semantics,
 * enable acknowledgement, import/export and tool attribution.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createManager, resetManagerState } from '../lib/manager.js';

function harness({ servers = [], external = [], schemas = [], check = async () => true, officialClient = true } = {}) {
  const state = { config: { servers: structuredClone(servers) }, edits: 0 };
  const manager = createManager({
    readRaw: async () => structuredClone(state.config),
    editRaw: async (change) => {
      state.config = change(structuredClone(state.config));
      state.edits += 1;
    },
    external: () => structuredClone(external),
    toolSchemas: () => schemas,
    checkConnection: check,
    officialClient,
    profileName: 'test-profile',
    now: () => '2026-11-06T00:00:00.000Z',
  });
  return { manager, state };
}

const stdioDraft = (overrides = {}) => ({
  serverName: 'alpha',
  transport: 'stdio',
  command: 'node',
  argsText: 'server.mjs --flag value',
  cwd: '',
  env: [],
  headers: [],
  timeoutMs: 60000,
  reconnectEnabled: true,
  reconnectAttempts: 10,
  failOnStartupError: false,
  maxInstructionBytes: 32768,
  allowPlainHttp: false,
  ...overrides,
});

const storedStdio = (overrides = {}) => ({
  enabled: true,
  client: {
    serverName: 'alpha',
    transport: 'stdio',
    command: 'node',
    args: ['server.mjs'],
    toolCallTimeoutMs: 60000,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
    failOnStartupError: false,
    maxInstructionBytes: 32768,
    ...overrides,
  },
});

test.beforeEach(() => resetManagerState());

test('list projects managed servers with execution coordinates but without env/header values', async () => {
  const { manager } = harness({
    servers: [
      {
        enabled: true,
        client: {
          serverName: 'alpha',
          transport: 'stdio',
          command: '/usr/local/bin/node',
          args: ['--token', 'sk-live-DEADBEEFDEADBEEF'],
          env: { GITHUB_TOKEN: 'sk-live-DEADBEEFDEADBEEF', PLAIN: 'value' },
          toolCallTimeoutMs: 90000,
          reconnect: { enabled: false, maxAttempts: 3 },
        },
      },
      { enabled: false, client: { serverName: 'bravo', transport: 'streamable-http', url: 'https://example.com/mcp' } },
    ],
    external: [{ serverName: 'manual', transport: 'stdio', enabled: false }],
    schemas: [
      { name: 'mcp__alpha__search' },
      { name: 'mcp__alpha__fetch' },
      { name: 'mcp__other__x' },
      { name: 'plain_tool' },
    ],
  });
  const view = await manager.list();
  assert.match(view.revision, /^[0-9a-f]{64}$/);
  assert.equal(view.servers.length, 2);
  const alpha = view.servers.find((server) => server.serverName === 'alpha');
  assert.equal(alpha.enabled, true);
  assert.equal(alpha.endpoint, 'node');
  assert.equal(alpha.hasSecrets, true);
  assert.deepEqual(alpha.envKeys, ['GITHUB_TOKEN', 'PLAIN']);
  assert.equal(alpha.toolCount, 2);
  assert.deepEqual(alpha.tools, ['mcp__alpha__fetch', 'mcp__alpha__search']);
  assert.equal(alpha.timeoutMs, 90000);
  assert.equal(alpha.reconnect.enabled, false);
  assert.equal(alpha.argumentCount, 2);
  assert.equal(alpha.highestRisk, 'medium');
  // Execution coordinates are visible to the authenticated settings UI.
  assert.equal(alpha.command, '/usr/local/bin/node');
  assert.deepEqual(alpha.args, ['--token', 'sk-live-DEADBEEFDEADBEEF']);
  assert.equal(alpha.cwd, '');
  const bravo = view.servers.find((server) => server.serverName === 'bravo');
  assert.equal(bravo.endpoint, 'https://example.com');
  assert.equal(bravo.url, 'https://example.com/mcp');
  assert.equal(view.external[0].source, 'external');
  assert.deepEqual(view.tools.byServer.alpha.sort(), ['mcp__alpha__fetch', 'mcp__alpha__search']);
  // Env/header VALUES never appear in the browser projection.
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes('GITHUB_TOKEN":'));
  assert.ok(!serialized.includes('PLAIN":'));
  assert.ok(!serialized.includes('sk-live-DEADBEEFDEADBEEF"') || alpha.risk.some((item) => item.code === 'risk.secretInArgs'));
  assert.equal(view.profileName, 'test-profile');
});

test('analyze normalizes a draft and reports risks without throwing', async () => {
  const { manager } = harness();
  const result = await manager.analyze({ draft: stdioDraft({ command: 'npx', argsText: '-y some-mcp-package' }) });
  assert.equal(result.errors.length, 0);
  assert.equal(result.normalized.serverName, 'alpha');
  assert.deepEqual(result.argv, ['npx', '-y', 'some-mcp-package']);
  assert.equal(result.blocked, false);
  const codes = result.risk.map((item) => item.code);
  assert.ok(codes.includes('risk.packageRunnerAutoInstall'));
  assert.ok(codes.includes('risk.localExecution'));
});

test('analyze returns a stable error code for an invalid draft', async () => {
  const { manager } = harness();
  const result = await manager.analyze({ draft: stdioDraft({ serverName: 'bad name' }) });
  assert.equal(result.blocked, true);
  assert.equal(result.normalized, null);
  assert.equal(result.errors[0].code, 'NAME_INVALID');
  assert.equal(result.errors[0].path, 'serverName');
});

test('analyze detects a name conflict with managed and external names', async () => {
  const { manager } = harness({
    servers: [storedStdio()],
    external: [{ serverName: 'taken', transport: 'stdio', enabled: true }],
  });
  const managed = await manager.analyze({ draft: stdioDraft({ serverName: 'alpha' }) });
  assert.equal(managed.errors[0].code, 'NAME_CONFLICT');
  const external = await manager.analyze({ draft: stdioDraft({ serverName: 'taken' }) });
  assert.equal(external.errors[0].code, 'NAME_CONFLICT');
});

test('create requires confirmation and the current revision', async () => {
  const { manager, state } = harness();
  const snapshot = await manager.list();
  await assert.rejects(manager.create({ draft: stdioDraft(), revision: snapshot.revision }), /CONFIRM_REQUIRED/);
  await assert.rejects(
    manager.create({ draft: stdioDraft(), revision: 'stale', confirm: true }),
    /STALE_CONFIGURATION/,
  );
  const saved = await manager.create({ draft: stdioDraft(), revision: snapshot.revision, confirm: true });
  assert.deepEqual(saved, { saved: true });
  assert.equal(state.config.servers.length, 1);
  assert.equal(state.config.servers[0].enabled, false);
  assert.equal(state.config.servers[0].client.serverName, 'alpha');
  assert.equal(state.edits, 1);
});

test('create rejects a duplicate name and plaintext non-loopback HTTP', async () => {
  const { manager } = harness({ servers: [storedStdio()] });
  const snapshot = await manager.list();
  await assert.rejects(
    manager.create({ draft: stdioDraft(), revision: snapshot.revision, confirm: true }),
    /NAME_CONFLICT/,
  );
  const httpDraft = {
    serverName: 'remote',
    transport: 'streamable-http',
    url: 'http://192.168.1.20:8080/mcp',
    headers: [],
    allowPlainHttp: false,
    timeoutMs: 60000,
    reconnectEnabled: true,
    reconnectAttempts: 10,
    failOnStartupError: false,
    maxInstructionBytes: 32768,
  };
  await assert.rejects(
    manager.create({ draft: httpDraft, revision: snapshot.revision, confirm: true }),
    /HTTP_PLAINTEXT_BLOCKED/,
  );
});

test('update keeps stored secret values with keep entries and saves disabled', async () => {
  const { manager, state } = harness({
    servers: [
      {
        enabled: true,
        client: {
          serverName: 'alpha',
          transport: 'stdio',
          command: 'node',
          args: ['old.mjs'],
          env: { TOKEN: 'super-secret-value' },
        },
      },
    ],
  });
  const snapshot = await manager.list();
  assert.equal(snapshot.servers[0].enabled, true);
  const saved = await manager.update({
    serverName: 'alpha',
    revision: snapshot.revision,
    confirm: true,
    draft: stdioDraft({
      command: 'node',
      argsText: 'new.mjs',
      env: [{ key: 'TOKEN', keep: true }],
    }),
  });
  assert.deepEqual(saved, { saved: true });
  const row = state.config.servers[0];
  assert.equal(row.enabled, false);
  assert.equal(row.client.env.TOKEN, 'super-secret-value');
  assert.deepEqual(row.client.args, ['new.mjs']);
  const view = await manager.list();
  assert.equal(view.servers[0].hasSecrets, true);
  assert.ok(!JSON.stringify(view).includes('super-secret-value'));
});

test('update refuses to rename a server', async () => {
  const { manager } = harness({ servers: [storedStdio()] });
  const snapshot = await manager.list();
  await assert.rejects(
    manager.update({
      serverName: 'alpha',
      revision: snapshot.revision,
      confirm: true,
      draft: stdioDraft({ serverName: 'renamed' }),
    }),
    /NAME_INVALID/,
  );
});

test('toggle requires risk acknowledgement and confirms before enabling', async () => {
  const { manager, state } = harness({
    servers: [
      {
        enabled: false,
        client: {
          serverName: 'risky',
          transport: 'stdio',
          command: 'npx',
          args: ['-y', 'some-mcp-package'],
        },
      },
    ],
  });
  let snapshot = await manager.list();
  await assert.rejects(
    manager.toggle({ serverName: 'risky', enabled: true, revision: snapshot.revision, confirm: true }),
    /RISK_ACK_REQUIRED/,
  );
  const enabled = await manager.toggle({
    serverName: 'risky',
    enabled: true,
    revision: snapshot.revision,
    confirm: true,
    acknowledgeRisk: true,
  });
  assert.deepEqual(enabled, { saved: true });
  snapshot = await manager.list();
  assert.equal(state.config.servers[0].enabled, true);
  assert.equal(snapshot.audit[0].action, 'enable');
  const disabled = await manager.toggle({
    serverName: 'risky',
    enabled: false,
    revision: snapshot.revision,
    confirm: true,
  });
  assert.deepEqual(disabled, { saved: true });
  assert.equal(state.config.servers[0].enabled, false);
});

test('executionPreview exposes the exact argv, keys and risks but no values', async () => {
  const { manager } = harness({
    servers: [
      {
        enabled: false,
        client: {
          serverName: 'alpha',
          transport: 'stdio',
          command: 'node',
          args: ['server.mjs', '--token=sk-live-0123456789abcdefghijkl'],
          env: { API_TOKEN: 'sk-live-VALUE' },
        },
      },
    ],
  });
  const preview = await manager.executionPreview({ serverName: 'alpha' });
  assert.deepEqual(preview.argv, ['node', 'server.mjs', '--token=sk-live-0123456789abcdefghijkl']);
  assert.deepEqual(preview.envKeys, ['API_TOKEN']);
  assert.ok(preview.risk.some((item) => item.code === 'risk.secretInArgs'));
  assert.ok(!JSON.stringify(preview.risk).includes('sk-live-VALUE'));
});

test('remove deletes one row and refuses unknown names', async () => {
  const { manager, state } = harness({ servers: [storedStdio()] });
  const snapshot = await manager.list();
  await assert.rejects(
    manager.remove({ serverName: 'missing', revision: snapshot.revision, confirm: true }),
    /NOT_FOUND/,
  );
  const result = await manager.remove({ serverName: 'alpha', revision: snapshot.revision, confirm: true });
  assert.deepEqual(result, { saved: true });
  assert.equal(state.config.servers.length, 0);
  assert.equal(snapshot.audit.length, 0);
  const after = await manager.list();
  assert.equal(after.audit[0].action, 'remove');
});

test('check records a last check only for enabled servers', async () => {
  const { manager } = harness({
    servers: [storedStdio()],
    check: async (name) => name === 'alpha',
  });
  const snapshot = await manager.list();
  const result = await manager.check({ serverName: 'alpha', revision: snapshot.revision });
  assert.deepEqual(result, { successful: true, at: '2026-11-06T00:00:00.000Z', method: 'resources/list' });
  const after = await manager.list();
  assert.equal(after.servers[0].lastCheck.successful, true);
  assert.equal(after.audit[0].action, 'check');
});

test('previewImport returns errors instead of throwing, import saves disabled rows', async () => {
  const { manager, state } = harness();
  const bad = await manager.previewImport({ text: '{oops' });
  assert.equal(bad.count, 0);
  assert.equal(bad.errors[0].code, 'IMPORT_JSON_INVALID');

  const imported = await manager.previewImport({
    text: JSON.stringify({ mcpServers: { local: { command: 'node', args: ['server.mjs'] } } }),
  });
  assert.equal(imported.count, 1);
  assert.equal(imported.servers[0].serverName, 'local');
  const snapshot = await manager.list();
  const saved = await manager.importServers({ text: JSON.stringify({ mcpServers: { local: { command: 'node' } } }), revision: snapshot.revision, confirm: true });
  assert.deepEqual(saved, { saved: true });
  assert.equal(state.config.servers[0].enabled, false);
});

test('export is redacted and importable', async () => {
  const { manager } = harness({
    servers: [
      {
        enabled: true,
        client: {
          serverName: 'alpha',
          transport: 'stdio',
          command: 'node',
          env: { TOKEN: 'super-secret-value' },
        },
      },
    ],
  });
  const result = await manager.export();
  assert.equal(result.redacted, true);
  assert.equal(typeof result.json, 'string');
  assert.ok(!result.json.includes('super-secret-value'));
  assert.ok(result.json.includes('${TOKEN}'));
  const parsed = JSON.parse(result.json);
  assert.equal(parsed.mcpServers.alpha.env.TOKEN, '${TOKEN}');
});

test('mutations serialize and reject stale revisions', async () => {
  const { manager } = harness();
  const first = await manager.list();
  const second = await manager.list();
  assert.equal(first.revision, second.revision);
  await manager.create({ draft: stdioDraft(), revision: first.revision, confirm: true });
  await assert.rejects(
    manager.create({ draft: stdioDraft({ serverName: 'beta' }), revision: first.revision, confirm: true }),
    /STALE_CONFIGURATION/,
  );
});
