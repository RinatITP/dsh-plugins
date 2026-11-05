/**
 * Tests for lib/import.js (strict mcpServers import, redacted export, JSON-tab
 * projection). Pure Node built-ins only: `node --test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ImportError, clientToEntry, exportServers, parseImport } from '../lib/import.js';
import { LIMITS, analyzeServer } from '../lib/security.js';

/* ------------------------------------------------------------------------- */
/* helpers                                                                   */
/* ------------------------------------------------------------------------- */

function expectCode(fn, code, path) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof Error, `expected an Error, got ${String(error)}`);
    assert.equal(error.code, code, `expected ${code}, got ${error.code} (${error.message})`);
    if (path !== undefined) assert.equal(error.path, path, `unexpected path for ${code}`);
    return error;
  }
  assert.fail(`expected ${code}, but nothing was thrown`);
}

function document(servers) {
  return JSON.stringify({ mcpServers: servers });
}

function assertNoSecrets(value, secrets, label) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `${label} leaked a secret value`);
  }
}

/* ------------------------------------------------------------------------- */
/* parseImport — happy paths                                                 */
/* ------------------------------------------------------------------------- */

test('parseImport: mixed document yields normalized client configs', () => {
  const text = `{
    "mcpServers": {
      "github": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": { "GITHUB_TOKEN": "ghp_${'a'.repeat(30)}" }
      },
      "web": {
        "type": "http",
        "url": "https://mcp.example.com/mcp",
        "headers": { "Authorization": "Bearer ${'b'.repeat(20)}" }
      },
      "local": {
        "type": "streamable-http",
        "url": "http://127.0.0.1:3000/mcp"
      }
    }
  }`;
  const { servers, count } = parseImport(text);
  assert.equal(count, 3);
  assert.deepEqual(servers.map((server) => server.serverName), ['github', 'web', 'local']);
  assert.equal(servers[0].transport, 'stdio');
  assert.deepEqual(servers[0].args, ['-y', '@modelcontextprotocol/server-github']);
  assert.equal(servers[0].env.GITHUB_TOKEN.startsWith('ghp_'), true);
  assert.equal(servers[1].transport, 'streamable-http');
  assert.equal(servers[1].url, 'https://mcp.example.com/mcp');
  assert.equal(servers[2].transport, 'streamable-http');
  assert.equal(servers[2].url, 'http://127.0.0.1:3000/mcp');
  // Defaults are materialized so the persisted canonical state is deterministic.
  for (const server of servers) {
    assert.equal(server.toolCallTimeoutMs, 60000);
    assert.deepEqual(server.reconnect, {
      enabled: true,
      initialDelayMs: 500,
      maxDelayMs: 30000,
      maxAttempts: 10,
    });
    assert.equal(server.failOnStartupError, false);
    assert.equal(server.maxInstructionBytes, 32768);
  }
});

test('parseImport: transport inference and type mapping', () => {
  assert.equal(parseImport(document({ a: { command: 'node' } })).servers[0].transport, 'stdio');
  assert.equal(
    parseImport(document({ a: { url: 'https://example.com/mcp' } })).servers[0].transport,
    'streamable-http',
  );
  assert.equal(
    parseImport(document({ a: { type: 'http', url: 'https://example.com/mcp' } })).servers[0]
      .transport,
    'streamable-http',
  );
  assert.equal(
    parseImport(document({ a: { type: 'stdio', command: 'node' } })).servers[0].transport,
    'stdio',
  );
});

test('parseImport: empty mcpServers is valid and does not mutate input', () => {
  assert.deepEqual(parseImport('{"mcpServers":{}}'), { servers: [], count: 0 });
  const text = document({ a: { command: 'node', args: ['x'] } });
  const first = parseImport(text);
  const second = parseImport(text);
  assert.deepEqual(first, second);
});

test('parseImport: existing names produce conflicts; loopback plaintext is allowed', () => {
  expectCode(
    () => parseImport(document({ github: { command: 'node' } }), ['github']),
    'IMPORT_NAME_CONFLICT',
    'mcpServers.github',
  );
  assert.equal(
    parseImport(document({ other: { command: 'node' } }), ['github']).count,
    1,
  );
  const loopback = parseImport(document({ lan: { url: 'http://localhost:3000/mcp' } }));
  assert.equal(loopback.servers[0].url, 'http://localhost:3000/mcp');
});

/* ------------------------------------------------------------------------- */
/* parseImport — one case per import error code                              */
/* ------------------------------------------------------------------------- */

test('IMPORT_INPUT_INVALID: non-string input or invalid existing names', () => {
  expectCode(() => parseImport(42), 'IMPORT_INPUT_INVALID');
  expectCode(() => parseImport(undefined), 'IMPORT_INPUT_INVALID');
  expectCode(() => parseImport(null), 'IMPORT_INPUT_INVALID');
  expectCode(() => parseImport(document({ a: { command: 'n' } }), 'github'), 'IMPORT_INPUT_INVALID');
  expectCode(() => parseImport(document({ a: { command: 'n' } }), [42]), 'IMPORT_INPUT_INVALID');
});

test('IMPORT_TOO_LARGE: 1 MiB limit by characters and by UTF-8 bytes', () => {
  expectCode(() => parseImport(' '.repeat(LIMITS.maxBodyBytes + 1)), 'IMPORT_TOO_LARGE');
  expectCode(() => parseImport('é'.repeat(LIMITS.maxBodyBytes / 2 + 1)), 'IMPORT_TOO_LARGE');
});

test('IMPORT_JSON_INVALID: malformed JSON', () => {
  expectCode(() => parseImport('{'), 'IMPORT_JSON_INVALID');
  expectCode(() => parseImport('not json'), 'IMPORT_JSON_INVALID');
  expectCode(() => parseImport(''), 'IMPORT_JSON_INVALID');
  expectCode(() => parseImport('{"mcpServers":{}} trailing'), 'IMPORT_JSON_INVALID');
});

test('IMPORT_UNSAFE_KEY: prototype keys at any depth', () => {
  const proto = '{"mcpServers":{"a":{"command":"n","env":{"__proto__":"x"}}}}';
  expectCode(() => parseImport(proto), 'IMPORT_UNSAFE_KEY');
  const constructor = '{"mcpServers":{"a":{"command":"n","headers":{"constructor":"x"}}}}';
  expectCode(() => parseImport(constructor), 'IMPORT_UNSAFE_KEY');
  const nested = '{"mcpServers":{"a":{"command":"n","env":{"ok":{"prototype":{"x":1}}}}}}';
  expectCode(() => parseImport(nested), 'IMPORT_UNSAFE_KEY');
  // A server literally named `constructor` is rejected by the same rule.
  expectCode(() => parseImport(document({ constructor: { command: 'n' } })), 'IMPORT_UNSAFE_KEY');
});

test('IMPORT_DUPLICATE_KEY: duplicate JSON keys at any depth', () => {
  expectCode(
    () => parseImport('{"mcpServers":{"a":{"command":"x"},"a":{"command":"y"}}}'),
    'IMPORT_DUPLICATE_KEY',
  );
  expectCode(
    () => parseImport('{"mcpServers":{"a":{"command":"x","env":{"K":"1","K":"2"}}}}'),
    'IMPORT_DUPLICATE_KEY',
  );
  expectCode(() => parseImport('{"mcpServers":{},"mcpServers":{}}'), 'IMPORT_DUPLICATE_KEY');
});

test('IMPORT_SHAPE: exactly one mcpServers object is required', () => {
  expectCode(() => parseImport('[]'), 'IMPORT_SHAPE');
  expectCode(() => parseImport('"mcpServers"'), 'IMPORT_SHAPE');
  expectCode(() => parseImport('{"servers":{}}'), 'IMPORT_SHAPE');
  expectCode(() => parseImport('{"mcpServers":[]}'), 'IMPORT_SHAPE');
  expectCode(() => parseImport('{"mcpServers":"x"}'), 'IMPORT_SHAPE');
  expectCode(() => parseImport('{"mcpServers":{},"extra":{}}'), 'IMPORT_SHAPE');
  expectCode(() => parseImport('{}'), 'IMPORT_SHAPE');
});

test('IMPORT_TOO_MANY_SERVERS: more than 100 entries', () => {
  const servers = {};
  for (let index = 0; index < LIMITS.maxServers + 1; index += 1) {
    servers[`s${index}`] = { command: 'node' };
  }
  expectCode(() => parseImport(document(servers)), 'IMPORT_TOO_MANY_SERVERS');
});

test('IMPORT_NAME_INVALID: malformed or oversized server names', () => {
  expectCode(() => parseImport(document({ 'bad name': { command: 'n' } })), 'IMPORT_NAME_INVALID');
  expectCode(() => parseImport(document({ ['a'.repeat(33)]: { command: 'n' } })), 'IMPORT_NAME_INVALID');
  expectCode(() => parseImport(document({ 'a.b': { command: 'n' } })), 'IMPORT_NAME_INVALID');
});

test('IMPORT_NAME_CONFLICT: name already used (including within one document)', () => {
  expectCode(
    () => parseImport(document({ github: { command: 'n' } }), ['github']),
    'IMPORT_NAME_CONFLICT',
    'mcpServers.github',
  );
});

test('IMPORT_SERVER_INVALID: entry is not an object', () => {
  expectCode(() => parseImport(document({ a: 42 })), 'IMPORT_SERVER_INVALID', 'mcpServers.a');
  expectCode(() => parseImport(document({ a: null })), 'IMPORT_SERVER_INVALID', 'mcpServers.a');
  expectCode(() => parseImport(document({ a: ['node'] })), 'IMPORT_SERVER_INVALID', 'mcpServers.a');
});

test('IMPORT_UNKNOWN_FIELD: field outside the allowlist', () => {
  expectCode(
    () => parseImport(document({ a: { command: 'n', disabled: true } })),
    'IMPORT_UNKNOWN_FIELD',
    'mcpServers.a.disabled',
  );
  expectCode(
    () => parseImport(document({ a: { command: 'n', timeout: 5000 } })),
    'IMPORT_UNKNOWN_FIELD',
    'mcpServers.a.timeout',
  );
});

test('IMPORT_TYPE_INVALID: unknown or uninferable transport', () => {
  expectCode(() => parseImport(document({ a: {} })), 'IMPORT_TYPE_INVALID', 'mcpServers.a');
  expectCode(() => parseImport(document({ a: { type: 'sse', command: 'n' } })), 'IMPORT_TYPE_INVALID', 'mcpServers.a.type');
  expectCode(() => parseImport(document({ a: { type: 42, command: 'n' } })), 'IMPORT_TYPE_INVALID', 'mcpServers.a.type');
});

test('IMPORT_TRANSPORT_CONFLICT: stdio and HTTP fields mixed', () => {
  expectCode(
    () => parseImport(document({ a: { command: 'n', url: 'https://h.example' } })),
    'IMPORT_TRANSPORT_CONFLICT',
    'mcpServers.a',
  );
  expectCode(
    () => parseImport(document({ a: { type: 'stdio', url: 'https://h.example' } })),
    'IMPORT_TRANSPORT_CONFLICT',
    'mcpServers.a',
  );
  expectCode(
    () => parseImport(document({ a: { type: 'http', command: 'n' } })),
    'IMPORT_TRANSPORT_CONFLICT',
    'mcpServers.a',
  );
  expectCode(
    () => parseImport(document({ a: { command: 'n', headers: { 'X-A': 'b' } } })),
    'IMPORT_TRANSPORT_CONFLICT',
    'mcpServers.a',
  );
});

test('IMPORT_URL_INVALID: URL rules carried over from validation', () => {
  expectCode(
    () => parseImport(document({ a: { type: 'http' } })),
    'IMPORT_URL_INVALID',
    'mcpServers.a.url',
  );
  expectCode(
    () => parseImport(document({ a: { url: 'http://192.168.1.10/mcp' } })),
    'IMPORT_URL_INVALID',
    'mcpServers.a.url',
  );
  expectCode(
    () => parseImport(document({ a: { url: 'https://user:pass@example.com/mcp' } })),
    'IMPORT_URL_INVALID',
    'mcpServers.a.url',
  );
  expectCode(
    () => parseImport(document({ a: { url: 'https://example.com/mcp#fragment' } })),
    'IMPORT_URL_INVALID',
    'mcpServers.a.url',
  );
  expectCode(
    () => parseImport(document({ a: { url: 'ftp://example.com/mcp' } })),
    'IMPORT_URL_INVALID',
    'mcpServers.a.url',
  );
  expectCode(
    () => parseImport(document({ a: { url: 42 } })),
    'IMPORT_URL_INVALID',
    'mcpServers.a.url',
  );
});

test('IMPORT_COMMAND_INVALID: command rules', () => {
  expectCode(() => parseImport(document({ a: { type: 'stdio' } })), 'IMPORT_COMMAND_INVALID', 'mcpServers.a.command');
  expectCode(() => parseImport(document({ a: { command: '' } })), 'IMPORT_COMMAND_INVALID', 'mcpServers.a.command');
  expectCode(() => parseImport(document({ a: { command: '   ' } })), 'IMPORT_COMMAND_INVALID', 'mcpServers.a.command');
  expectCode(() => parseImport(document({ a: { command: 42 } })), 'IMPORT_COMMAND_INVALID', 'mcpServers.a.command');
  expectCode(() => parseImport(document({ a: { command: 'node\nserver.js' } })), 'IMPORT_COMMAND_INVALID', 'mcpServers.a.command');
  // A pasted command line is rejected instead of being split heuristically.
  expectCode(() => parseImport(document({ a: { command: 'npx -y pkg' } })), 'IMPORT_COMMAND_INVALID', 'mcpServers.a.command');
  expectCode(
    () => parseImport(document({ a: { command: 'x'.repeat(LIMITS.maxCommandLength + 1) } })),
    'IMPORT_COMMAND_INVALID',
    'mcpServers.a.command',
  );
});

test('IMPORT_ARGS_INVALID: argv must be an array of strings', () => {
  expectCode(() => parseImport(document({ a: { command: 'n', args: '-y pkg' } })), 'IMPORT_ARGS_INVALID', 'mcpServers.a.args');
  expectCode(
    () => parseImport(document({ a: { command: 'n', args: [42] } })),
    'IMPORT_ARGS_INVALID',
    'mcpServers.a.args[0]',
  );
  expectCode(
    () => parseImport(document({ a: { command: 'n', args: Array.from({ length: LIMITS.maxArgs + 1 }, () => 'a') } })),
    'IMPORT_ARGS_INVALID',
    'mcpServers.a.args',
  );
  expectCode(
    () => parseImport(document({ a: { command: 'n', args: ['a'.repeat(LIMITS.maxArgLength + 1)] } })),
    'IMPORT_ARGS_INVALID',
    'mcpServers.a.args[0]',
  );
  // Empty argv is fine and gets dropped from the normalized config.
  assert.equal('args' in parseImport(document({ a: { command: 'n', args: [] } })).servers[0], false);
});

test('IMPORT_ENV_INVALID: env must be a string record without execution overrides', () => {
  expectCode(() => parseImport(document({ a: { command: 'n', env: [] } })), 'IMPORT_ENV_INVALID', 'mcpServers.a.env');
  expectCode(() => parseImport(document({ a: { command: 'n', env: { A: 42 } } })), 'IMPORT_ENV_INVALID', 'mcpServers.a.env.A');
  expectCode(() => parseImport(document({ a: { command: 'n', env: { PATH: '/x' } } })), 'IMPORT_ENV_INVALID', 'mcpServers.a.env.PATH');
  expectCode(() => parseImport(document({ a: { command: 'n', env: { '1BAD': 'x' } } })), 'IMPORT_ENV_INVALID', 'mcpServers.a.env.1BAD');
  expectCode(
    () => parseImport(document({ a: { command: 'n', env: { A: 'x'.repeat(LIMITS.maxEnvValueLength + 1) } } })),
    'IMPORT_ENV_INVALID',
    'mcpServers.a.env.A',
  );
  const tooMany = {};
  for (let index = 0; index < LIMITS.maxEnv + 1; index += 1) tooMany[`K${index}`] = 'v';
  expectCode(() => parseImport(document({ a: { command: 'n', env: tooMany } })), 'IMPORT_ENV_INVALID', 'mcpServers.a.env');
});

test('IMPORT_HEADERS_INVALID: header token/value rules', () => {
  expectCode(() => parseImport(document({ a: { url: 'https://h.example', headers: [] } })), 'IMPORT_HEADERS_INVALID', 'mcpServers.a.headers');
  expectCode(
    () => parseImport(document({ a: { url: 'https://h.example', headers: { 'bad name': 'v' } } })),
    'IMPORT_HEADERS_INVALID',
    'mcpServers.a.headers.?',
  );
  expectCode(
    () => parseImport(document({ a: { url: 'https://h.example', headers: { 'X-Test': 'a\r\nb' } } })),
    'IMPORT_HEADERS_INVALID',
    'mcpServers.a.headers.X-Test',
  );
  expectCode(
    () => parseImport(document({ a: { url: 'https://h.example', headers: { 'X-Test': 42 } } })),
    'IMPORT_HEADERS_INVALID',
    'mcpServers.a.headers.X-Test',
  );
});

test('IMPORT_CWD_INVALID: working directory must be a non-empty absolute path', () => {
  expectCode(() => parseImport(document({ a: { command: 'n', cwd: 'relative' } })), 'IMPORT_CWD_INVALID', 'mcpServers.a.cwd');
  expectCode(() => parseImport(document({ a: { command: 'n', cwd: '' } })), 'IMPORT_CWD_INVALID', 'mcpServers.a.cwd');
  expectCode(() => parseImport(document({ a: { command: 'n', cwd: 42 } })), 'IMPORT_CWD_INVALID', 'mcpServers.a.cwd');
  expectCode(() => parseImport(document({ a: { command: 'n', cwd: '/tmp\u0000x' } })), 'IMPORT_CWD_INVALID', 'mcpServers.a.cwd');
});

test('ImportError keeps a fixed message and never echoes values', () => {
  const error = new ImportError('IMPORT_UNKNOWN_FIELD', 'mcpServers.a.evil');
  assert.ok(error instanceof Error);
  assert.equal(error.name, 'ImportError');
  assert.equal(error.code, 'IMPORT_UNKNOWN_FIELD');
  assert.equal(error.path, 'mcpServers.a.evil');
  assert.equal(error.message, 'IMPORT_UNKNOWN_FIELD at mcpServers.a.evil');
  assert.equal(new ImportError('NOPE').code, 'IMPORT_INPUT_INVALID');
  const bare = new ImportError('IMPORT_JSON_INVALID');
  assert.equal(bare.message, 'IMPORT_JSON_INVALID');
  assert.equal(bare.path, '');
});

test('import errors never echo secrets from the input', () => {
  const secret = 'ghp_' + 'q'.repeat(30);
  const envError = expectCode(
    () => parseImport(document({ a: { command: 'n', env: { 'BAD KEY': secret } } })),
    'IMPORT_ENV_INVALID',
  );
  assert.equal(JSON.stringify(envError).includes(secret), false);
  const commandError = expectCode(
    () => parseImport(document({ a: { command: secret, url: 'https://h.example' } })),
    'IMPORT_TRANSPORT_CONFLICT',
  );
  assert.equal(JSON.stringify(commandError).includes(secret), false);
  const argsError = expectCode(
    () => parseImport(document({ a: { command: 'n', args: secret } })),
    'IMPORT_ARGS_INVALID',
  );
  assert.equal(JSON.stringify(argsError).includes(secret), false);
});

/* ------------------------------------------------------------------------- */
/* exportServers                                                             */
/* ------------------------------------------------------------------------- */

const ENV_SECRET = 'ghp_' + 'e'.repeat(30);
const HEADER_SECRET = 'Bearer ' + 'h'.repeat(20);

const exportRows = () => [
  {
    client: {
      serverName: 'github',
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      cwd: '/Users/rinat/project',
      env: { GITHUB_TOKEN: ENV_SECRET, MODE: 'readonly' },
    },
    allowPlainHttp: false,
  },
  {
    client: {
      serverName: 'web',
      transport: 'streamable-http',
      url: 'https://mcp.example.com/mcp',
      headers: { Authorization: HEADER_SECRET },
    },
    allowPlainHttp: false,
  },
];

test('exportServers: redacts every env/header value into "${KEY}" placeholders', () => {
  const { json, redacted } = exportServers(exportRows());
  assert.equal(redacted, true);
  assert.equal(typeof json, 'string');
  assert.equal(json.includes(ENV_SECRET), false);
  assert.equal(json.includes(HEADER_SECRET), false);
  assert.equal(json.includes('"${GITHUB_TOKEN}"'), true);
  assert.equal(json.includes('"${MODE}"'), true);
  assert.equal(json.includes('"${Authorization}"'), true);
  assert.equal(/^\s*\/\//m.test(json), false, 'export must be plain JSON without comments');

  const parsed = JSON.parse(json);
  assert.deepEqual(Object.keys(parsed), ['mcpServers']);
  assert.deepEqual(parsed.mcpServers.github, {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', MODE: '${MODE}' },
    cwd: '/Users/rinat/project',
  });
  assert.deepEqual(parsed.mcpServers.web, {
    type: 'streamable-http',
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: '${Authorization}' },
  });
  assert.equal('allowPlainHttp' in parsed.mcpServers.web, false);
});

test('exportServers: output round-trips through parseImport with placeholders', () => {
  const { json } = exportServers(exportRows());
  const { servers, count } = parseImport(json);
  assert.equal(count, 2);
  assert.equal(servers[0].env.GITHUB_TOKEN, '${GITHUB_TOKEN}');
  assert.equal(servers[0].args[0], '-y');
  assert.equal(servers[1].headers.Authorization, '${Authorization}');
  // And the round-tripped document exports again unchanged.
  const again = exportServers(servers.map((client) => ({ client })));
  assert.equal(again.json, json);
});

test('exportServers: empty rows export an empty mcpServers document', () => {
  const { json } = exportServers([]);
  assert.deepEqual(JSON.parse(json), { mcpServers: {} });
});

test('exportServers: malformed rows are rejected with import codes', () => {
  expectCode(() => exportServers('nope'), 'IMPORT_INPUT_INVALID');
  expectCode(() => exportServers([null]), 'IMPORT_SERVER_INVALID');
  expectCode(() => exportServers([{ client: 42 }]), 'IMPORT_SERVER_INVALID');
  expectCode(
    () => exportServers([{ client: { serverName: 'bad name', transport: 'stdio', command: 'n' } }]),
    'IMPORT_NAME_INVALID',
  );
  expectCode(
    () =>
      exportServers([
        { client: { serverName: 'x', transport: 'stdio', command: 'n' } },
        { client: { serverName: 'x', transport: 'stdio', command: 'n' } },
      ]),
    'IMPORT_DUPLICATE_KEY',
  );
  expectCode(
    () => exportServers([{ client: { serverName: 'x', transport: 'sse', command: 'n' } }]),
    'IMPORT_TYPE_INVALID',
  );
  expectCode(
    () => exportServers([{ client: { serverName: 'x', transport: 'stdio' } }]),
    'IMPORT_COMMAND_INVALID',
  );
  expectCode(
    () => exportServers([{ client: { serverName: 'x', transport: 'streamable-http' } }]),
    'IMPORT_URL_INVALID',
  );
});

/* ------------------------------------------------------------------------- */
/* clientToEntry                                                             */
/* ------------------------------------------------------------------------- */

test('clientToEntry: masks env/header values but keeps keys and argv', () => {
  const [stdioRow, httpRow] = exportRows();
  const stdioEntry = clientToEntry(stdioRow.client);
  assert.deepEqual(stdioEntry, {
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_TOKEN: '', MODE: '' },
    cwd: '/Users/rinat/project',
  });
  assertNoSecrets(stdioEntry, [ENV_SECRET], 'clientToEntry(stdio)');

  const httpEntry = clientToEntry(httpRow.client);
  assert.deepEqual(httpEntry, {
    type: 'streamable-http',
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: '' },
  });
  assertNoSecrets(httpEntry, [HEADER_SECRET], 'clientToEntry(http)');

  assert.equal(clientToEntry(null), null);
  assert.equal(clientToEntry({}), null);
  assert.equal(clientToEntry({ transport: 'stdio', command: 'n' }), null, 'serverName is required');
  assert.equal(clientToEntry({ serverName: 'x', transport: 'sse' }), null);
});

test('clientToEntry: entries are copies and round-trip through parseImport', () => {
  const [stdioRow] = exportRows();
  const entry = clientToEntry(stdioRow.client);
  entry.args.push('extra');
  entry.env.GITHUB_TOKEN = 'leak';
  assert.equal(stdioRow.client.args.includes('extra'), false, 'must not mutate the source client');
  // Masked values are accepted by the same import path (they are just strings).
  const { servers } = parseImport(document({ github: entry }));
  assert.equal(servers[0].serverName, 'github');
});

/* ------------------------------------------------------------------------- */
/* import → analyze integration                                              */
/* ------------------------------------------------------------------------- */

test('imported secrets are flagged but never surfaced in analysis output', () => {
  const { servers } = parseImport(
    document({
      github: {
        command: 'npx',
        args: ['-y', '@modelcontextprotocol/server-github'],
        env: { GITHUB_TOKEN: ENV_SECRET },
      },
      web: {
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: HEADER_SECRET },
      },
    }),
  );
  const analysis = servers.map((client) => {
    const result = analyzeServer(client, { allowPlainHttp: false });
    return { serverName: client.serverName, ...result };
  });
  assert.equal(analysis[0].risk.some((risk) => risk.code === 'risk.envSecretLiteral'), true);
  assert.equal(analysis[1].risk.some((risk) => risk.code === 'risk.envSecretLiteral'), true);
  assert.equal(analysis[0].risk.some((risk) => risk.code === 'risk.packageRunnerAutoInstall'), true);
  assertNoSecrets(analysis, [ENV_SECRET, HEADER_SECRET], 'import→analyze');
});
