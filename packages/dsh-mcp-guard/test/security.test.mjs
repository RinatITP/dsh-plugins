/**
 * Tests for lib/security.js and lib/validate.js.
 *
 * Pure Node built-ins only: `node --test`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIMITS,
  RISK_CODES,
  RISK_LEVELS,
  SERVER_NAME_RE,
  ValidationError,
  analyzeServer,
  highestRisk,
  isBlocked,
  isLoopbackHost,
  isSecretReference,
  looksSecret,
  parseArgsText,
  scanSecrets,
} from '../lib/security.js';
import {
  checkHttpUrl,
  mergeKeepEntries,
  normalizeDraft,
  resolveDraftEntries,
  validateClient,
} from '../lib/validate.js';

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

function riskCodes(result) {
  return result.risk.map((entry) => entry.code);
}

function assertNoSecretInSerialized(value, secrets, label) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false, `${label} leaked a secret value`);
  }
}

const draftStdio = (overrides = {}) => ({
  serverName: 'github',
  transport: 'stdio',
  command: 'npx',
  argsText: '-y\n@modelcontextprotocol/server-github',
  ...overrides,
});

const draftHttp = (overrides = {}) => ({
  serverName: 'web',
  transport: 'streamable-http',
  url: 'https://mcp.example.com/mcp',
  ...overrides,
});

/* ------------------------------------------------------------------------- */
/* constants / errors                                                        */
/* ------------------------------------------------------------------------- */

test('SERVER_NAME_RE matches the contract alphabet and length', () => {
  assert.equal(SERVER_NAME_RE.test('github'), true);
  assert.equal(SERVER_NAME_RE.test('a'), true);
  assert.equal(SERVER_NAME_RE.test('A_b-9'), true);
  assert.equal(SERVER_NAME_RE.test('a'.repeat(32)), true);
  assert.equal(SERVER_NAME_RE.test(''), false);
  assert.equal(SERVER_NAME_RE.test('a b'), false);
  assert.equal(SERVER_NAME_RE.test('a.b'), false);
  assert.equal(SERVER_NAME_RE.test('a/b'), false);
  assert.equal(SERVER_NAME_RE.test('a'.repeat(33)), false);
  assert.equal(SERVER_NAME_RE.test('__proto__'), true, 'regex alone; proto keys are rejected separately');
});

test('LIMITS mirrors the contract numbers', () => {
  assert.equal(LIMITS.maxServers, 100);
  assert.equal(LIMITS.maxBodyBytes, 1024 * 1024);
  assert.equal(LIMITS.maxNameLength, 32);
  assert.equal(LIMITS.maxCommandLength, 4096);
  assert.equal(LIMITS.maxArgs, 64);
  assert.equal(LIMITS.maxArgLength, 4096);
  assert.equal(LIMITS.maxEnv, 64);
  assert.equal(LIMITS.maxEnvValueLength, 8192);
  assert.equal(LIMITS.maxHeaders, 64);
  assert.equal(LIMITS.maxHeaderValueLength, 8192);
  assert.deepEqual({ ...LIMITS.toolCallTimeoutMs }, { min: 1000, max: 600000, default: 60000 });
  assert.deepEqual({ ...LIMITS.maxInstructionBytes }, { min: 1, max: 1048576, default: 32768 });
  assert.equal(LIMITS.reconnect.maxAttempts, 100);
  assert.equal(LIMITS.reconnect.maxDelayMs, 2147483647);
});

test('RISK_CODES catalog is complete and well formed', () => {
  const expected = [
    'risk.localExecution',
    'risk.remoteEndpoint',
    'risk.packageRunnerAutoInstall',
    'risk.packageRunnerUnpinned',
    'risk.shellInterpreter',
    'risk.codeEvalFlag',
    'risk.elevatedCommand',
    'risk.plainHttpLoopback',
    'risk.plainHttpAllowlisted',
    'risk.secretInArgs',
    'risk.envSecretLiteral',
    'risk.namespaceAmbiguous',
    'risk.cwdSystemRoot',
    'risk.timeoutLong',
    'risk.reconnectDisabled',
  ];
  assert.deepEqual(Object.keys(RISK_CODES).sort(), [...expected].sort());
  for (const code of expected) {
    assert.ok(RISK_LEVELS.includes(RISK_CODES[code].level), `${code} has an unknown level`);
  }
  assert.equal(RISK_CODES['risk.packageRunnerAutoInstall'].level, 'high');
  assert.equal(RISK_CODES['risk.localExecution'].level, 'info');
});

test('ValidationError carries a stable code and a sanitized path only', () => {
  const withPath = new ValidationError('STDIO_COMMAND_INVALID', 'command');
  assert.ok(withPath instanceof Error);
  assert.equal(withPath.name, 'ValidationError');
  assert.equal(withPath.code, 'STDIO_COMMAND_INVALID');
  assert.equal(withPath.path, 'command');
  assert.equal(withPath.message, 'STDIO_COMMAND_INVALID at command');

  const bare = new ValidationError('NAME_INVALID');
  assert.equal(bare.path, '');
  assert.equal(bare.message, 'NAME_INVALID');

  const secret = 'ghp_' + 'z'.repeat(30);
  const sanitized = new ValidationError('FIELD_UNKNOWN', `env.${secret}`);
  assert.equal(sanitized.message.includes(secret), false, 'path must be sanitized');
});

/* ------------------------------------------------------------------------- */
/* parseArgsText                                                             */
/* ------------------------------------------------------------------------- */

test('parseArgsText splits plain whitespace and newlines', () => {
  assert.deepEqual(parseArgsText('-y pkg'), ['-y', 'pkg']);
  assert.deepEqual(parseArgsText('-y\npkg'), ['-y', 'pkg']);
  assert.deepEqual(parseArgsText('-y\r\npkg'), ['-y', 'pkg']);
  assert.deepEqual(parseArgsText('  a\t\tb  '), ['a', 'b']);
  assert.deepEqual(parseArgsText(''), []);
  assert.deepEqual(parseArgsText('   \n\t '), []);
});

test('parseArgsText groups and removes single and double quotes', () => {
  assert.deepEqual(parseArgsText(`--flag "a b" 'c d'`), ['--flag', 'a b', 'c d']);
  assert.deepEqual(parseArgsText(`"a'b" 'a"b'`), [`a'b`, 'a"b']);
  assert.deepEqual(parseArgsText('""'), ['']);
  assert.deepEqual(parseArgsText("''"), ['']);
  assert.deepEqual(parseArgsText('a""b'), ['ab']);
  assert.deepEqual(parseArgsText(`"  "`), ['  ']);
});

test('parseArgsText handles backslash escapes outside single quotes', () => {
  assert.deepEqual(parseArgsText('a\\ b'), ['a b']);
  assert.deepEqual(parseArgsText('"a\\"b"'), ['a"b']);
  assert.deepEqual(parseArgsText('"a\\\\b"'), ['a\\b']);
  assert.deepEqual(parseArgsText('\\"x\\"'), ['"x"']);
  assert.deepEqual(parseArgsText("'a\\ b'"), ['a\\ b'], 'backslash is literal inside single quotes');
  assert.deepEqual(parseArgsText('C:\\temp\\x'), ['C:tempx'], 'backslash escapes the next char');
});

test('parseArgsText rejects unbalanced quotes, dangling escapes and NUL', () => {
  expectCode(() => parseArgsText(`"unbalanced`), 'STDIO_ARGS_INVALID', 'argsText');
  expectCode(() => parseArgsText(`'unbalanced`), 'STDIO_ARGS_INVALID', 'argsText');
  expectCode(() => parseArgsText('dangling\\'), 'STDIO_ARGS_INVALID', 'argsText');
  expectCode(() => parseArgsText('a\u0000b'), 'STDIO_ARGS_INVALID', 'argsText');
  expectCode(() => parseArgsText(42), 'STDIO_ARGS_INVALID', 'argsText');
  expectCode(() => parseArgsText(null), 'STDIO_ARGS_INVALID', 'argsText');
});

/* ------------------------------------------------------------------------- */
/* isLoopbackHost                                                            */
/* ------------------------------------------------------------------------- */

test('isLoopbackHost accepts exactly the loopback space', () => {
  for (const host of [
    'localhost',
    'LOCALHOST',
    'localhost.',
    'app.localhost',
    'app.localhost.',
    '127.0.0.1',
    '127.5.5.5',
    '127.255.255.254',
    '::1',
    '[::1]',
    '0:0:0:0:0:0:0:1',
  ]) {
    assert.equal(isLoopbackHost(host), true, `${host} should be loopback`);
  }
  for (const host of [
    'example.com',
    '10.0.0.1',
    '192.168.1.1',
    '0.0.0.0',
    '169.254.169.254',
    '127.0.0.256',
    'evillocalhost',
    'localhost.evil.com',
    '',
    null,
    undefined,
  ]) {
    assert.equal(isLoopbackHost(host), false, `${String(host)} should not be loopback`);
  }
});

/* ------------------------------------------------------------------------- */
/* looksSecret / isSecretReference / scanSecrets                             */
/* ------------------------------------------------------------------------- */

test('looksSecret detects credential-shaped keys', () => {
  for (const key of [
    'API_KEY',
    'apiKey',
    'api-key',
    'GITHUB_TOKEN',
    'client_secret',
    'PASSWORD',
    'DB_PWD',
    'Authorization',
    'bearer',
    'PRIVATE_KEY',
    'credential',
    'COOKIE',
    'SESSION',
  ]) {
    assert.equal(looksSecret(key, 'ordinary'), true, `${key} should look secret`);
  }
  assert.equal(looksSecret('GITHUB_TOKEN', ''), true, 'key classification alone is enough');
  assert.equal(looksSecret('PATH', 'x'), false);
  assert.equal(looksSecret('MODEL', 'deepseek-chat'), false);
});

test('looksSecret detects credential-shaped values', () => {
  const values = [
    'sk-' + 'a1'.repeat(12),
    'ghp_' + 'A1'.repeat(12),
    'xoxb-' + '1'.repeat(12) + '-abcdef',
    'AKIA' + 'A1'.repeat(8),
    'Bearer ' + 'abc123XYZ'.repeat(2),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
    '-----BEGIN RSA PRIVATE KEY-----',
    'AbCdEf0123456789AbCdEf0123456789',
    'https://user:pass@example.com/path',
    'hooks.slack.com/services/T000/B000/abcdefghijklmnop',
  ];
  for (const value of values) {
    assert.equal(looksSecret('', value), true, `${value} should look secret`);
  }
  for (const value of [
    'hello',
    'https://example.com/path',
    'npx',
    '@modelcontextprotocol/server-github',
    'production',
    '/usr/local/bin/node',
    '0123456789',
    '',
  ]) {
    assert.equal(looksSecret('', value), false, `${value} should not look secret`);
  }
});

test('isSecretReference recognises indirections, not literals', () => {
  assert.equal(isSecretReference('${GITHUB_TOKEN}'), true);
  assert.equal(isSecretReference('Bearer ${MCP_TOKEN}'), true);
  assert.equal(isSecretReference('!!js process.env.MCP_TOKEN'), true);
  assert.equal(isSecretReference('ghp_' + 'a'.repeat(30)), false);
  assert.equal(isSecretReference(''), false);
  assert.equal(isSecretReference(null), false);
});

test('scanSecrets reports locations only and never values', () => {
  const envSecret = 'ghp_' + 'e'.repeat(30);
  const headerSecret = 'Bearer ' + 'h'.repeat(20);
  const argSecret = 'sk-' + 'a'.repeat(24);
  const client = {
    transport: 'stdio',
    command: 'node',
    args: ['server.js', `--api-key=${argSecret}`],
    env: { GITHUB_TOKEN: envSecret, MODEL: 'deepseek-chat' },
    headers: { Authorization: headerSecret },
  };
  const result = scanSecrets(client);
  assert.equal(result.hasSecrets, true);
  assert.deepEqual(result.envKeys, ['GITHUB_TOKEN']);
  assert.deepEqual(result.headerKeys, ['Authorization']);
  assert.deepEqual(result.argvIndices, [1]);
  assertNoSecretInSerialized(result, [envSecret, headerSecret, argSecret], 'scanSecrets');

  assert.equal(scanSecrets({ transport: 'stdio', command: 'node', args: ['a.js'] }).hasSecrets, false);
  assert.equal(scanSecrets(null).hasSecrets, false);
});

/* ------------------------------------------------------------------------- */
/* analyzeServer — one explicit case per risk code                            */
/* ------------------------------------------------------------------------- */

test('risk.localExecution: stdio runs a local program', () => {
  const result = analyzeServer({ transport: 'stdio', command: '/usr/local/bin/node', args: ['s.js'] });
  const risk = result.risk.find((entry) => entry.code === 'risk.localExecution');
  assert.ok(risk);
  assert.equal(risk.level, 'info');
  assert.deepEqual(risk.params, { command: 'node' });
  assert.equal(result.blocked, false);
});

test('risk.remoteEndpoint: HTTP transport', () => {
  const result = analyzeServer({ transport: 'streamable-http', url: 'https://mcp.example.com/v1' });
  const risk = result.risk.find((entry) => entry.code === 'risk.remoteEndpoint');
  assert.ok(risk);
  assert.equal(risk.level, 'info');
  assert.deepEqual(risk.params, { host: 'mcp.example.com' });
});

test('risk.packageRunnerAutoInstall and risk.packageRunnerUnpinned', () => {
  const npx = analyzeServer({ transport: 'stdio', command: 'npx', args: ['-y', '@scope/pkg'] });
  assert.equal(riskCodes(npx).includes('risk.packageRunnerAutoInstall'), true);
  assert.equal(riskCodes(npx).includes('risk.packageRunnerUnpinned'), true);
  assert.equal(
    npx.risk.find((entry) => entry.code === 'risk.packageRunnerAutoInstall').level,
    'high',
  );

  const pinned = analyzeServer({
    transport: 'stdio',
    command: 'npx',
    args: ['--no-install', 'pkg@1.2.3'],
  });
  assert.equal(riskCodes(pinned).includes('risk.packageRunnerAutoInstall'), false);
  assert.equal(riskCodes(pinned).includes('risk.packageRunnerUnpinned'), false);

  const movingTag = analyzeServer({ transport: 'stdio', command: 'bunx', args: ['pkg@latest'] });
  assert.equal(riskCodes(movingTag).includes('risk.packageRunnerAutoInstall'), true);
  assert.equal(riskCodes(movingTag).includes('risk.packageRunnerUnpinned'), true);

  const dlx = analyzeServer({ transport: 'stdio', command: 'pnpm', args: ['dlx', 'tool'] });
  assert.equal(riskCodes(dlx).includes('risk.packageRunnerAutoInstall'), true);
  assert.equal(riskCodes(dlx).includes('risk.packageRunnerUnpinned'), true);

  const localPath = analyzeServer({ transport: 'stdio', command: 'npx', args: ['./local-tool'] });
  assert.equal(riskCodes(localPath).includes('risk.packageRunnerAutoInstall'), false);
  assert.equal(riskCodes(localPath).includes('risk.packageRunnerUnpinned'), false);
});

test('risk.shellInterpreter and risk.codeEvalFlag', () => {
  const shell = analyzeServer({ transport: 'stdio', command: '/bin/bash', args: ['script.sh'] });
  assert.equal(shell.risk.find((entry) => entry.code === 'risk.shellInterpreter').level, 'high');

  const evalShell = analyzeServer({ transport: 'stdio', command: 'bash', args: ['-c', 'echo hi'] });
  const evalRisk = evalShell.risk.find((entry) => entry.code === 'risk.codeEvalFlag');
  assert.equal(evalRisk.level, 'high');
  assert.deepEqual(evalRisk.params, { command: 'bash', flag: '-c' });

  const combined = analyzeServer({ transport: 'stdio', command: 'bash', args: ['-lc', 'echo hi'] });
  assert.equal(riskCodes(combined).includes('risk.codeEvalFlag'), true);

  const nodeEval = analyzeServer({ transport: 'stdio', command: 'node', args: ['-e', '1'] });
  assert.equal(riskCodes(nodeEval).includes('risk.codeEvalFlag'), true);

  const pwsh = analyzeServer({ transport: 'stdio', command: 'pwsh', args: ['-Command', 'whoami'] });
  assert.equal(riskCodes(pwsh).includes('risk.codeEvalFlag'), true);

  const notInterpreter = analyzeServer({ transport: 'stdio', command: 'git', args: ['-c', 'core.x=1'] });
  assert.equal(riskCodes(notInterpreter).includes('risk.codeEvalFlag'), false);
});

test('risk.elevatedCommand: sudo / su / doas', () => {
  for (const command of ['sudo', '/usr/bin/sudo', 'doas', 'su']) {
    const result = analyzeServer({ transport: 'stdio', command, args: ['x'] });
    const risk = result.risk.find((entry) => entry.code === 'risk.elevatedCommand');
    assert.ok(risk, `${command} should be elevated`);
    assert.equal(risk.level, 'high');
  }
});

test('risk.plainHttpLoopback and risk.plainHttpAllowlisted', () => {
  const loopback = analyzeServer(
    { transport: 'streamable-http', url: 'http://127.0.0.1:3000/mcp' },
    { allowPlainHttp: false },
  );
  const loopbackRisk = loopback.risk.find((entry) => entry.code === 'risk.plainHttpLoopback');
  assert.ok(loopbackRisk);
  assert.equal(loopbackRisk.level, 'info');
  assert.equal(loopback.blocked, false, 'loopback plaintext is allowed');

  const allowlisted = analyzeServer(
    { transport: 'streamable-http', url: 'http://192.168.1.10:8080/mcp' },
    { allowPlainHttp: true },
  );
  const allowRisk = allowlisted.risk.find((entry) => entry.code === 'risk.plainHttpAllowlisted');
  assert.ok(allowRisk);
  assert.equal(allowRisk.level, 'high');
  assert.equal(allowlisted.blocked, false);

  const notAllowlisted = analyzeServer(
    { transport: 'streamable-http', url: 'http://192.168.1.10:8080/mcp' },
    { allowPlainHttp: false },
  );
  assert.equal(riskCodes(notAllowlisted).includes('risk.plainHttpAllowlisted'), true);
  assert.equal(notAllowlisted.blocked, true, 'non-loopback plaintext without the allow flag is a hard block');
});

test('risk.secretInArgs: credential-shaped argv values', () => {
  const secret = 'sk-' + 'a'.repeat(24);
  const result = analyzeServer({
    transport: 'stdio',
    command: 'node',
    args: ['server.js', `--api-key=${secret}`, 'GITHUB_TOKEN=ghp_' + 'b'.repeat(30)],
  });
  const risks = result.risk.filter((entry) => entry.code === 'risk.secretInArgs');
  assert.equal(risks.length, 2);
  assert.equal(risks[0].level, 'medium');
  assert.deepEqual(risks[0].params, { index: 1 });
  assert.deepEqual(risks[1].params, { name: 'GITHUB_TOKEN' });
  assertNoSecretInSerialized(result, [secret, 'ghp_' + 'b'.repeat(30)], 'secretInArgs');
});

test('risk.envSecretLiteral: literal secrets in env/headers, not references', () => {
  const envSecret = 'ghp_' + 'c'.repeat(30);
  const headerSecret = 'Bearer ' + 'd'.repeat(20);
  const result = analyzeServer({
    transport: 'streamable-http',
    url: 'https://mcp.example.com',
    headers: { Authorization: headerSecret },
  });
  const headerRisk = result.risk.find((entry) => entry.code === 'risk.envSecretLiteral');
  assert.ok(headerRisk);
  assert.deepEqual(headerRisk.params, { key: 'Authorization' });

  const envResult = analyzeServer({
    transport: 'stdio',
    command: 'node',
    env: { GITHUB_TOKEN: envSecret },
  });
  const envRisk = envResult.risk.find((entry) => entry.code === 'risk.envSecretLiteral');
  assert.ok(envRisk);
  assert.deepEqual(envRisk.params, { key: 'GITHUB_TOKEN' });

  const references = analyzeServer({
    transport: 'stdio',
    command: 'node',
    env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' },
    headers: { Authorization: 'Bearer ${MCP_TOKEN}' },
  });
  assert.equal(riskCodes(references).includes('risk.envSecretLiteral'), false);
  assertNoSecretInSerialized(result, [headerSecret], 'envSecretLiteral');
});

test('risk.namespaceAmbiguous: name contains __', () => {
  const result = analyzeServer({ transport: 'stdio', command: 'node', serverName: 'my__server' });
  const risk = result.risk.find((entry) => entry.code === 'risk.namespaceAmbiguous');
  assert.ok(risk);
  assert.equal(risk.level, 'low');
  assert.deepEqual(risk.params, { name: 'my__server' });
});

test('risk.cwdSystemRoot: POSIX and Windows system roots', () => {
  for (const cwd of ['/', '/etc', '/etc/', '/usr', '/System', 'C:\\Windows', 'C:\\Windows\\', 'c:\\']) {
    const result = analyzeServer({ transport: 'stdio', command: 'node', cwd });
    const risk = result.risk.find((entry) => entry.code === 'risk.cwdSystemRoot');
    assert.ok(risk, `${cwd} should be a system root`);
    assert.equal(risk.level, 'medium');
  }
  const safe = analyzeServer({ transport: 'stdio', command: 'node', cwd: '/Users/rinat/project' });
  assert.equal(riskCodes(safe).includes('risk.cwdSystemRoot'), false);
});

test('risk.timeoutLong: per-call timeout above 10 minutes', () => {
  const result = analyzeServer({
    transport: 'stdio',
    command: 'node',
    toolCallTimeoutMs: 900000,
  });
  const risk = result.risk.find((entry) => entry.code === 'risk.timeoutLong');
  assert.ok(risk);
  assert.equal(risk.level, 'low');
  assert.deepEqual(risk.params, { timeoutMs: 900000 });

  const normal = analyzeServer({ transport: 'stdio', command: 'node', toolCallTimeoutMs: 600000 });
  assert.equal(riskCodes(normal).includes('risk.timeoutLong'), false);
});

test('risk.reconnectDisabled: reconnect turned off', () => {
  const result = analyzeServer({
    transport: 'stdio',
    command: 'node',
    reconnect: { enabled: false, maxAttempts: 10 },
  });
  const risk = result.risk.find((entry) => entry.code === 'risk.reconnectDisabled');
  assert.ok(risk);
  assert.equal(risk.level, 'low');
  assert.equal(riskCodes(analyzeServer({ transport: 'stdio', command: 'node', reconnect: { enabled: true } })).includes('risk.reconnectDisabled'), false);
});

test('every RISK_CODES entry is produced by at least one fixture', () => {
  const fixtures = [
    [{ transport: 'stdio', command: 'node', args: ['server.js'] }, {}],
    [{ transport: 'streamable-http', url: 'https://mcp.example.com' }, {}],
    [{ transport: 'streamable-http', url: 'http://127.0.0.1:3000/mcp' }, {}],
    [{ transport: 'streamable-http', url: 'http://192.168.1.10:8080/mcp' }, { allowPlainHttp: true }],
    [{ transport: 'stdio', command: 'npx', args: ['-y', '@scope/pkg'] }, {}],
    [{ transport: 'stdio', command: 'npx', args: ['--no-install', '@scope/pkg'] }, {}],
    [{ transport: 'stdio', command: 'bash', args: ['-c', 'x'] }, {}],
    [{ transport: 'stdio', command: 'sudo', args: ['x'] }, {}],
    [
      {
        transport: 'stdio',
        command: 'node',
        args: [`--api-key=sk-${'a'.repeat(24)}`],
        env: { API_KEY: `sk-${'b'.repeat(24)}` },
        headers: { Authorization: `Bearer ${'c'.repeat(20)}` },
      },
      {},
    ],
    [
      {
        transport: 'stdio',
        command: 'node',
        serverName: 'a__b',
        cwd: '/etc',
        toolCallTimeoutMs: 900000,
        reconnect: { enabled: false },
      },
      {},
    ],
  ];
  const seen = new Set();
  for (const [client, opts] of fixtures) {
    for (const risk of analyzeServer(client, opts).risk) seen.add(risk.code);
  }
  assert.deepEqual([...seen].sort(), Object.keys(RISK_CODES).sort());
});

test('analyzeServer fails closed on unknown transports and never throws', () => {
  const broken = analyzeServer(null);
  assert.deepEqual(broken.risk, []);
  assert.equal(broken.blocked, true);

  const unknownTransport = analyzeServer({ transport: 'sse', url: 'https://x.example' });
  assert.equal(unknownTransport.blocked, true);
});

test('analyzeServer never echoes secret values into risk params', () => {
  const envSecret = 'ghp_' + 'e'.repeat(30);
  const headerSecret = 'Bearer ' + 'f'.repeat(20);
  const argSecret = 'sk-' + 'g'.repeat(24);
  const client = {
    transport: 'stdio',
    command: 'npx',
    args: [`--token=${argSecret}`],
    env: { GITHUB_TOKEN: envSecret },
  };
  const result = analyzeServer(client, { allowPlainHttp: false, hasSecrets: true });
  assertNoSecretInSerialized(result, [envSecret, headerSecret, argSecret], 'analyzeServer');

  const httpResult = analyzeServer({
    transport: 'streamable-http',
    url: 'https://mcp.example.com',
    headers: { Authorization: headerSecret },
  });
  assertNoSecretInSerialized(httpResult, [headerSecret], 'analyzeServer(http)');
});

test('highestRisk and isBlocked aggregate severity', () => {
  assert.equal(highestRisk([]), null);
  assert.equal(highestRisk({ level: 'medium', code: 'risk.x', params: {} }), 'medium');
  assert.equal(
    highestRisk([
      { level: 'info', code: 'risk.a', params: {} },
      { level: 'high', code: 'risk.b', params: {} },
      { level: 'low', code: 'risk.c', params: {} },
    ]),
    'high',
  );
  assert.equal(
    highestRisk([
      { level: 'critical', code: 'risk.a', params: {} },
      { level: 'high', code: 'risk.b', params: {} },
    ]),
    'critical',
  );
  assert.equal(highestRisk(null), null);
  assert.equal(highestRisk([{ level: 'nope' }]), null);

  assert.equal(isBlocked([], []), false);
  assert.equal(isBlocked([], [{ code: 'NAME_INVALID', path: '' }]), true);
  assert.equal(isBlocked([{ level: 'high', code: 'risk.x', params: {} }], []), false);
  assert.equal(isBlocked([{ level: 'critical', code: 'risk.x', params: {} }], []), true);
});

test('validate re-exports the same severity helpers', () => {
  assert.equal(typeof mergeKeepEntries, 'function');
});

/* ------------------------------------------------------------------------- */
/* normalizeDraft — happy paths                                              */
/* ------------------------------------------------------------------------- */

test('normalizeDraft: stdio draft becomes a normalized client', () => {
  const { client, allowPlainHttp, hasSecrets } = normalizeDraft(draftStdio());
  assert.deepEqual(client, {
    serverName: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    toolCallTimeoutMs: 60000,
    reconnect: { enabled: true, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 10 },
    failOnStartupError: false,
    maxInstructionBytes: 32768,
  });
  assert.equal(allowPlainHttp, false);
  assert.equal(hasSecrets, false);
  assert.equal(Object.isFrozen(client), false);
});

test('normalizeDraft: drops empty optional fields and materializes arguments', () => {
  const { client } = normalizeDraft({
    serverName: 'fs',
    transport: 'stdio',
    command: 'node',
    argsText: 'server.js',
    cwd: '/Users/rinat/project',
  });
  assert.deepEqual(client.args, ['server.js']);
  assert.equal(client.cwd, '/Users/rinat/project');
  assert.equal('env' in client, false);

  const empty = normalizeDraft({
    serverName: 'fs',
    transport: 'stdio',
    command: 'node',
    argsText: '',
    cwd: '',
    env: [],
  }).client;
  assert.equal('args' in empty, false);
  assert.equal('cwd' in empty, false);
  assert.equal('env' in empty, false);
  assert.equal(JSON.stringify(empty).includes('null'), false);
});

test('normalizeDraft: applies form tunables', () => {
  const { client } = normalizeDraft(
    draftStdio({
      timeoutMs: 120000,
      reconnectEnabled: false,
      reconnectAttempts: 3,
      failOnStartupError: true,
      maxInstructionBytes: 1024,
    }),
  );
  assert.equal(client.toolCallTimeoutMs, 120000);
  assert.deepEqual(client.reconnect, {
    enabled: false,
    initialDelayMs: 500,
    maxDelayMs: 30000,
    maxAttempts: 3,
  });
  assert.equal(client.failOnStartupError, true);
  assert.equal(client.maxInstructionBytes, 1024);
});

test('normalizeDraft: http draft with https URL and headers', () => {
  const { client, allowPlainHttp, hasSecrets } = normalizeDraft(
    draftHttp({ headers: [{ key: 'Authorization', value: 'Bearer abcdefgh' }] }),
  );
  assert.equal(client.transport, 'streamable-http');
  assert.equal(client.url, 'https://mcp.example.com/mcp');
  assert.deepEqual(client.headers, { Authorization: 'Bearer abcdefgh' });
  assert.equal('command' in client, false);
  assert.equal(allowPlainHttp, false);
  assert.equal(hasSecrets, true);
});

test('normalizeDraft: loopback plaintext HTTP is allowed, non-loopback needs the flag', () => {
  const loopback = normalizeDraft(draftHttp({ url: 'http://127.0.0.1:3000/mcp' }));
  assert.equal(loopback.client.url, 'http://127.0.0.1:3000/mcp');
  assert.equal(loopback.allowPlainHttp, false);

  const blocked = () => normalizeDraft(draftHttp({ url: 'http://192.168.1.10:8080/mcp' }));
  expectCode(blocked, 'HTTP_PLAINTEXT_BLOCKED', 'url');

  const allowed = normalizeDraft(
    draftHttp({ url: 'http://192.168.1.10:8080/mcp', allowPlainHttp: true }),
  );
  assert.equal(allowed.client.url, 'http://192.168.1.10:8080/mcp');
  assert.equal(allowed.allowPlainHttp, true);
});

test('normalizeDraft: keep semantics resolve stored secrets', () => {
  const existingClient = {
    serverName: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: { GITHUB_TOKEN: 'ghp_' + 'k'.repeat(30) },
    toolCallTimeoutMs: 90000,
    reconnect: { enabled: true, initialDelayMs: 750, maxDelayMs: 45000, maxAttempts: 4 },
  };
  const { client, hasSecrets } = normalizeDraft(
    {
      serverName: 'github',
      transport: 'stdio',
      command: 'npx',
      argsText: '-y pkg',
      env: [
        { key: 'GITHUB_TOKEN', keep: true },
        { key: 'MODE', value: 'readonly' },
      ],
    },
    { existingClient },
  );
  assert.equal(client.env.GITHUB_TOKEN, existingClient.env.GITHUB_TOKEN);
  assert.equal(client.env.MODE, 'readonly');
  assert.equal(hasSecrets, true);
  // Unrelated stored tunables survive an edit that cannot express them.
  assert.equal(client.reconnect.initialDelayMs, 750);
  assert.equal(client.reconnect.maxDelayMs, 45000);
});

test('normalizeDraft: keep without a stored value is unavailable (create rejects keep)', () => {
  expectCode(
    () =>
      normalizeDraft({
        serverName: 'x',
        transport: 'stdio',
        command: 'node',
        env: [{ key: 'TOKEN', keep: true }],
      }),
    'SECRET_KEEP_UNAVAILABLE',
    'env[0].key',
  );
  expectCode(
    () =>
      normalizeDraft(
        {
          serverName: 'x',
          transport: 'stdio',
          command: 'node',
          env: [{ key: 'TOKEN', keep: true }],
        },
        { existingClient: { serverName: 'x', transport: 'stdio', command: 'node', env: {} } },
      ),
    'SECRET_KEEP_UNAVAILABLE',
    'env[0].key',
  );
});

/* ------------------------------------------------------------------------- */
/* normalizeDraft — hard rules                                               */
/* ------------------------------------------------------------------------- */

test('normalizeDraft: name rules', () => {
  expectCode(() => normalizeDraft(draftStdio({ serverName: '' })), 'NAME_INVALID', 'serverName');
  expectCode(() => normalizeDraft(draftStdio({ serverName: 'bad name' })), 'NAME_INVALID', 'serverName');
  expectCode(() => normalizeDraft(draftStdio({ serverName: undefined })), 'NAME_INVALID', 'serverName');
  expectCode(
    () => normalizeDraft(draftStdio({ serverName: 'x' }), { existingNames: ['x'] }),
    'NAME_CONFLICT',
    'serverName',
  );
  // Re-saving the same row (update) is not a conflict.
  const sameRow = normalizeDraft(
    draftStdio({ serverName: 'x' }),
    { existingClient: { serverName: 'x', transport: 'stdio', command: 'npx' }, existingNames: ['x'] },
  );
  assert.equal(sameRow.client.serverName, 'x');
  // Capacity is enforced when the batch would exceed maxServers.
  const full = Array.from({ length: LIMITS.maxServers }, (_, index) => `s${index}`);
  expectCode(
    () => normalizeDraft(draftStdio({ serverName: 'new' }), { existingNames: full }),
    'TOO_MANY_SERVERS',
    'serverName',
  );
});

test('normalizeDraft: transport and unknown fields', () => {
  expectCode(() => normalizeDraft(draftStdio({ transport: 'sse' })), 'TRANSPORT_INVALID', 'transport');
  expectCode(() => normalizeDraft({ serverName: 'x' }), 'TRANSPORT_INVALID', 'transport');
  expectCode(() => normalizeDraft(draftStdio({ evil: true })), 'FIELD_UNKNOWN', 'evil');
  expectCode(() => normalizeDraft(draftStdio({ allowPlainHttp: 'yes' })), 'FIELD_UNKNOWN', 'allowPlainHttp');
  expectCode(() => normalizeDraft(null), 'FIELD_UNKNOWN', 'draft');
  expectCode(() => normalizeDraft('draft'), 'FIELD_UNKNOWN', 'draft');
});

test('normalizeDraft: command rules', () => {
  expectCode(() => normalizeDraft(draftStdio({ command: '' })), 'STDIO_COMMAND_REQUIRED', 'command');
  expectCode(() => normalizeDraft(draftStdio({ command: undefined })), 'STDIO_COMMAND_REQUIRED', 'command');
  expectCode(() => normalizeDraft(draftStdio({ command: 42 })), 'STDIO_COMMAND_INVALID', 'command');
  expectCode(() => normalizeDraft(draftStdio({ command: '   ' })), 'STDIO_COMMAND_INVALID', 'command');
  expectCode(() => normalizeDraft(draftStdio({ command: 'node\nx' })), 'STDIO_COMMAND_INVALID', 'command');
  expectCode(() => normalizeDraft(draftStdio({ command: 'a\u0000b' })), 'STDIO_COMMAND_INVALID', 'command');
  expectCode(
    () => normalizeDraft(draftStdio({ command: 'x'.repeat(LIMITS.maxCommandLength + 1) })),
    'STDIO_COMMAND_INVALID',
    'command',
  );
});

test('normalizeDraft: args rules', () => {
  expectCode(() => normalizeDraft(draftStdio({ argsText: 42 })), 'STDIO_ARGS_INVALID', 'argsText');
  expectCode(() => normalizeDraft(draftStdio({ argsText: '"unbalanced' })), 'STDIO_ARGS_INVALID', 'argsText');
  expectCode(
    () => normalizeDraft(draftStdio({ argsText: Array.from({ length: LIMITS.maxArgs + 1 }, () => 'a').join(' ') })),
    'STDIO_ARGS_INVALID',
    'args',
  );
  expectCode(
    () => normalizeDraft(draftStdio({ argsText: `"${'a'.repeat(LIMITS.maxArgLength + 1)}"` })),
    'STDIO_ARGS_INVALID',
    'args[0]',
  );
});

test('normalizeDraft: cwd rules', () => {
  expectCode(() => normalizeDraft(draftStdio({ cwd: 'relative/path' })), 'STDIO_CWD_INVALID', 'cwd');
  expectCode(() => normalizeDraft(draftStdio({ cwd: '/tmp/\u0000x' })), 'STDIO_CWD_INVALID', 'cwd');
  expectCode(() => normalizeDraft(draftStdio({ cwd: 42 })), 'STDIO_CWD_INVALID', 'cwd');
  assert.equal(normalizeDraft(draftStdio({ cwd: '/absolute/path' })).client.cwd, '/absolute/path');
});

test('normalizeDraft: env shape, key, value and denylist rules', () => {
  expectCode(() => normalizeDraft(draftStdio({ env: {} })), 'STDIO_ENV_INVALID', 'env');
  expectCode(() => normalizeDraft(draftStdio({ env: [null] })), 'STDIO_ENV_INVALID', 'env[0]');
  expectCode(() => normalizeDraft(draftStdio({ env: [{ value: 'x' }] })), 'STDIO_ENV_INVALID', 'env[0].key');
  expectCode(
    () => normalizeDraft(draftStdio({ env: [{ key: '1BAD', value: 'x' }] })),
    'STDIO_ENV_INVALID',
    'env[0].key',
  );
  expectCode(
    () => normalizeDraft(draftStdio({ env: [{ key: '__proto__', value: 'x' }] })),
    'STDIO_ENV_INVALID',
    'env[0].key',
  );
  expectCode(
    () => normalizeDraft(draftStdio({ env: [{ key: 'X', value: 42 }] })),
    'STDIO_ENV_INVALID',
    'env[0].value',
  );
  expectCode(
    () => normalizeDraft(draftStdio({ env: [{ key: 'X', value: 'a\u0000b' }] })),
    'STDIO_ENV_INVALID',
    'env[0].value',
  );
  expectCode(
    () =>
      normalizeDraft(
        draftStdio({
          env: [
            { key: 'DUP', value: 'a' },
            { key: 'DUP', value: 'b' },
          ],
        }),
      ),
    'STDIO_ENV_INVALID',
    'env[1].key',
  );
  expectCode(
    () => normalizeDraft(draftStdio({ env: [{ key: 'X', value: 'a', evil: 'b' }] })),
    'FIELD_UNKNOWN',
    'env[0].evil',
  );
  expectCode(
    () => normalizeDraft(draftStdio({ env: [{ key: 'X', value: 'v', keep: true }] })),
    'STDIO_ENV_INVALID',
    'env[0]',
  );
  expectCode(
    () => normalizeDraft(draftStdio({ env: [{ key: 'X', keep: false }] })),
    'STDIO_ENV_INVALID',
    'env[0].keep',
  );
});

test('normalizeDraft: execution-influencing env keys are hard-blocked', () => {
  for (const key of [
    'PATH',
    'NODE_OPTIONS',
    'NODE_PATH',
    'PYTHONPATH',
    'LD_PRELOAD',
    'DYLD_INSERT_LIBRARIES',
    'BASH_ENV',
    'ENV',
    'SHELLOPTS',
    'PERL5OPT',
    'RUBYOPT',
    'JAVA_TOOL_OPTIONS',
    'GIT_SSH_COMMAND',
    'SSH_ASKPASS',
    'COMSPEC',
    'PSModulePath',
    'DSH_CONFIG',
    '__jsExpr',
  ]) {
    expectCode(
      () => normalizeDraft(draftStdio({ env: [{ key, value: 'x' }] })),
      'ENV_EXECUTION_OVERRIDE',
      'env[0].key',
    );
  }
});

test('normalizeDraft: prototype header names are rejected', () => {
  expectCode(
    () => normalizeDraft(draftHttp({ headers: [{ key: '__proto__', value: 'x' }] })),
    'HTTP_HEADERS_INVALID',
    'headers[0].key',
  );
});

test('normalizeDraft: env limits', () => {
  const tooMany = Array.from({ length: LIMITS.maxEnv + 1 }, (_, index) => ({
    key: `K${index}`,
    value: 'v',
  }));
  expectCode(() => normalizeDraft(draftStdio({ env: tooMany })), 'TOO_MANY_ENV', 'env');

  const tooLong = [{ key: 'K', value: 'a'.repeat(LIMITS.maxEnvValueLength + 1) }];
  expectCode(() => normalizeDraft(draftStdio({ env: tooLong })), 'VALUE_TOO_LONG', 'env[0].value');
});

test('normalizeDraft: header rules and limits', () => {
  expectCode(() => normalizeDraft(draftHttp({ headers: {} })), 'HTTP_HEADERS_INVALID', 'headers');
  expectCode(
    () => normalizeDraft(draftHttp({ headers: [{ key: 'bad name', value: 'v' }] })),
    'HTTP_HEADERS_INVALID',
    'headers[0].key',
  );
  expectCode(
    () => normalizeDraft(draftHttp({ headers: [{ key: 'constructor', value: 'v' }] })),
    'HTTP_HEADERS_INVALID',
    'headers[0].key',
  );
  expectCode(
    () => normalizeDraft(draftHttp({ headers: [{ key: 'X-Test', value: 'a\r\nb' }] })),
    'HTTP_HEADERS_INVALID',
    'headers[0].value',
  );
  expectCode(
    () =>
      normalizeDraft(
        draftHttp({
          headers: [
            { key: 'X-Test', value: 'a' },
            { key: 'x-test', value: 'b' },
          ],
        }),
      ),
    'HTTP_HEADERS_INVALID',
    'headers[1].key',
  );
  expectCode(
    () =>
      normalizeDraft(
        draftHttp({
          headers: [{ key: 'X-Long', value: 'a'.repeat(LIMITS.maxHeaderValueLength + 1) }],
        }),
      ),
    'VALUE_TOO_LONG',
    'headers[0].value',
  );
  const tooMany = Array.from({ length: LIMITS.maxHeaders + 1 }, (_, index) => ({
    key: `X-H${index}`,
    value: 'v',
  }));
  expectCode(() => normalizeDraft(draftHttp({ headers: tooMany })), 'TOO_MANY_HEADERS', 'headers');
});

test('normalizeDraft: URL rules', () => {
  expectCode(() => normalizeDraft(draftHttp({ url: '' })), 'HTTP_URL_REQUIRED', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: undefined })), 'HTTP_URL_REQUIRED', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 42 })), 'HTTP_URL_INVALID', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 'ftp://example.com' })), 'HTTP_URL_INVALID', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 'not a url' })), 'HTTP_URL_INVALID', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 'https://user:pass@example.com/mcp' })), 'HTTP_URL_INVALID', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 'https://@example.com/mcp' })), 'HTTP_URL_INVALID', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 'https://example.com/mcp#frag' })), 'HTTP_URL_INVALID', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 'https://example.com /mcp' })), 'HTTP_URL_INVALID', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 'https://example.com\\mcp' })), 'HTTP_URL_INVALID', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 'https://example.com/mcp\u0000' })), 'HTTP_URL_INVALID', 'url');
  expectCode(() => normalizeDraft(draftHttp({ url: 'http://192.168.1.10/mcp' })), 'HTTP_PLAINTEXT_BLOCKED', 'url');
  // https to any host is always allowed
  assert.equal(normalizeDraft(draftHttp({ url: 'https://internal.example:8443/mcp?x=1' })).client.url, 'https://internal.example:8443/mcp?x=1');
});

test('normalizeDraft: numeric ranges', () => {
  expectCode(() => normalizeDraft(draftStdio({ timeoutMs: 999 })), 'TIMEOUT_INVALID', 'timeoutMs');
  expectCode(() => normalizeDraft(draftStdio({ timeoutMs: 600001 })), 'TIMEOUT_INVALID', 'timeoutMs');
  expectCode(() => normalizeDraft(draftStdio({ timeoutMs: 1500.5 })), 'TIMEOUT_INVALID', 'timeoutMs');
  expectCode(() => normalizeDraft(draftStdio({ timeoutMs: '60000' })), 'TIMEOUT_INVALID', 'timeoutMs');
  expectCode(() => normalizeDraft(draftStdio({ reconnectAttempts: 0 })), 'RECONNECT_INVALID', 'reconnectAttempts');
  expectCode(() => normalizeDraft(draftStdio({ reconnectAttempts: 101 })), 'RECONNECT_INVALID', 'reconnectAttempts');
  expectCode(() => normalizeDraft(draftStdio({ reconnectEnabled: 'yes' })), 'RECONNECT_INVALID', 'reconnectEnabled');
  expectCode(() => normalizeDraft(draftStdio({ maxInstructionBytes: 0 })), 'MAX_INSTRUCTION_INVALID', 'maxInstructionBytes');
  expectCode(
    () => normalizeDraft(draftStdio({ maxInstructionBytes: LIMITS.maxInstructionBytes.max + 1 })),
    'MAX_INSTRUCTION_INVALID',
    'maxInstructionBytes',
  );
  expectCode(() => normalizeDraft(draftStdio({ failOnStartupError: 'yes' })), 'FIELD_UNKNOWN', 'failOnStartupError');
});

test('normalizeDraft: update cannot rename the server', () => {
  expectCode(
    () =>
      normalizeDraft(draftStdio({ serverName: 'renamed' }), {
        existingClient: { serverName: 'original', transport: 'stdio', command: 'npx' },
      }),
    'NAME_INVALID',
    'serverName',
  );
  // Omitting the name (or repeating it) is how an edit looks like.
  assert.equal(
    normalizeDraft(draftStdio({ serverName: 'original' }), {
      existingClient: { serverName: 'original', transport: 'stdio', command: 'npx' },
    }).client.serverName,
    'original',
  );
  assert.equal(
    normalizeDraft(draftStdio({ serverName: undefined }), {
      existingClient: { serverName: 'original', transport: 'stdio', command: 'npx' },
    }).client.serverName,
    'original',
  );
});

test('normalizeDraft: update preserves stored tunables the form omits', () => {
  const existingClient = {
    serverName: 'github',
    transport: 'stdio',
    command: 'npx',
    toolCallTimeoutMs: 91000,
    reconnect: { enabled: false, initialDelayMs: 750, maxDelayMs: 45000, maxAttempts: 4 },
    failOnStartupError: true,
    maxInstructionBytes: 4096,
  };
  const { client } = normalizeDraft(
    { serverName: 'github', transport: 'stdio', command: 'npx' },
    { existingClient },
  );
  assert.equal(client.toolCallTimeoutMs, 91000);
  assert.equal(client.maxInstructionBytes, 4096);
  assert.equal(client.failOnStartupError, true);
  assert.deepEqual(client.reconnect, {
    enabled: false,
    initialDelayMs: 750,
    maxDelayMs: 45000,
    maxAttempts: 4,
  });
});

test('normalizeDraft: Loader expressions are rejected', () => {
  expectCode(
    () =>
      normalizeDraft(
        draftStdio({
          env: [{ key: 'TOKEN', value: { __jsExpr: 'process.env.GITHUB_TOKEN' } }],
        }),
      ),
    'EXPRESSION_UNSUPPORTED',
    'env[0].value.__jsExpr',
  );
  expectCode(
    () => normalizeDraft(draftHttp({ url: { __jsExpr: '`https://${host}`' } })),
    'EXPRESSION_UNSUPPORTED',
    'url.__jsExpr',
  );
  expectCode(
    () => normalizeDraft(draftStdio({ argsText: 'x', extra: { __jsExpr: 'boom' } })),
    'EXPRESSION_UNSUPPORTED',
    'extra.__jsExpr',
  );
});

test('normalizeDraft: error messages never echo secret values', () => {
  const secret = 'ghp_' + 's'.repeat(30);
  const error = expectCode(
    () =>
      normalizeDraft(
        draftStdio({
          env: [{ key: 'BAD KEY', value: secret }],
        }),
      ),
    'STDIO_ENV_INVALID',
  );
  assert.equal(error.message.includes(secret), false);
  assert.equal(error.path.includes(secret), false);

  const argsError = expectCode(
    () => normalizeDraft(draftStdio({ argsText: `"${secret}` })),
    'STDIO_ARGS_INVALID',
  );
  assert.equal(argsError.message.includes(secret), false);
});

/* ------------------------------------------------------------------------- */
/* resolveDraftEntries                                                       */
/* ------------------------------------------------------------------------- */

test('resolveDraftEntries resolves values and keeps', () => {
  const resolved = resolveDraftEntries(
    [{ key: 'A', value: 'one' }, { key: 'B', keep: true }],
    { B: 'two' },
  );
  assert.deepEqual(resolved, [
    { key: 'A', value: 'one' },
    { key: 'B', value: 'two' },
  ]);
  assert.deepEqual(resolveDraftEntries(undefined, {}), []);
  assert.deepEqual(resolveDraftEntries(null, {}), []);
});

test('resolveDraftEntries enforces its shape and keep contract', () => {
  expectCode(() => resolveDraftEntries('nope', {}), 'STDIO_ENV_INVALID', 'env');
  expectCode(() => resolveDraftEntries([{ key: 'A' }], {}), 'STDIO_ENV_INVALID', 'env[0]');
  expectCode(() => resolveDraftEntries([{ key: 'A', keep: true }], {}), 'SECRET_KEEP_UNAVAILABLE', 'env[0].key');
  expectCode(() => resolveDraftEntries([{ key: 'A', value: 'x', keep: true }], {}), 'STDIO_ENV_INVALID', 'env[0]');
  expectCode(
    () =>
      resolveDraftEntries([{ key: 'A', value: 'x' }, { key: 'A', value: 'y' }], {}),
    'STDIO_ENV_INVALID',
    'env[1].key',
  );
  expectCode(
    () =>
      resolveDraftEntries([{ key: 'A' }], {}, { code: 'HTTP_HEADERS_INVALID', path: 'headers' }),
    'HTTP_HEADERS_INVALID',
    'headers[0]',
  );
});

/* ------------------------------------------------------------------------- */
/* validateClient                                                            */
/* ------------------------------------------------------------------------- */

test('validateClient: normalizes the official shape', () => {
  const client = validateClient({
    serverName: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: { GITHUB_TOKEN: 'x' },
    toolCallTimeoutMs: 120000,
    reconnect: { enabled: true, initialDelayMs: 1000, maxDelayMs: 60000, maxAttempts: 2 },
    failOnStartupError: true,
    maxInstructionBytes: 512,
  });
  assert.deepEqual(client, {
    serverName: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', 'pkg'],
    env: { GITHUB_TOKEN: 'x' },
    toolCallTimeoutMs: 120000,
    reconnect: { enabled: true, initialDelayMs: 1000, maxDelayMs: 60000, maxAttempts: 2 },
    failOnStartupError: true,
    maxInstructionBytes: 512,
  });
  assert.equal(JSON.stringify(client).includes('null'), false);
});

test('validateClient: drops empty optional fields', () => {
  const client = validateClient({
    serverName: 'fs',
    transport: 'stdio',
    command: 'node',
    args: [],
    env: {},
    cwd: '',
  });
  assert.equal('args' in client, false);
  assert.equal('env' in client, false);
  assert.equal('cwd' in client, false);
  assert.equal(validateClient({
    serverName: 'web',
    transport: 'streamable-http',
    url: 'https://example.com/mcp',
    headers: {},
  }).headers, undefined);
});

test('validateClient: rejects the contract violations', () => {
  expectCode(() => validateClient(null), 'FIELD_UNKNOWN', 'client');
  expectCode(() => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', extra: 1 }), 'FIELD_UNKNOWN', 'extra');
  expectCode(() => validateClient({ serverName: 'bad name', transport: 'stdio', command: 'n' }), 'NAME_INVALID', 'serverName');
  expectCode(() => validateClient({ serverName: 'x', transport: 'sse', command: 'n' }), 'TRANSPORT_INVALID', 'transport');
  expectCode(() => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', url: 'https://x.example' }), 'TRANSPORT_INVALID', 'url');
  expectCode(() => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', args: '-y pkg' }), 'STDIO_ARGS_INVALID', 'args');
  expectCode(() => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', cwd: 'relative' }), 'STDIO_CWD_INVALID', 'cwd');
  expectCode(() => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', env: { PATH: '/x' } }), 'ENV_EXECUTION_OVERRIDE', 'env.PATH');
  expectCode(() => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', env: { A: 42 } }), 'STDIO_ENV_INVALID', 'env.A');
  expectCode(() => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', env: { A: { keep: true } } }), 'STDIO_ENV_INVALID', 'env.A');
  expectCode(
    () => validateClient({ serverName: 'x', transport: 'streamable-http', url: 'http://192.168.0.1/mcp' }),
    'HTTP_PLAINTEXT_BLOCKED',
    'url',
  );
  expectCode(
    () => validateClient({ serverName: 'x', transport: 'streamable-http', url: 'https://x.example', headers: { 'X-Test': 'a\r\nb' } }),
    'HTTP_HEADERS_INVALID',
    'headers.X-Test',
  );
  expectCode(
    () => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', toolCallTimeoutMs: 10 }),
    'TIMEOUT_INVALID',
    'toolCallTimeoutMs',
  );
  expectCode(
    () => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', reconnect: { enabled: 'yes' } }),
    'RECONNECT_INVALID',
    'reconnect.enabled',
  );
  expectCode(
    () => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', reconnect: { retries: 2 } }),
    'FIELD_UNKNOWN',
    'reconnect.retries',
  );
  expectCode(
    () => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', maxInstructionBytes: 0 }),
    'MAX_INSTRUCTION_INVALID',
    'maxInstructionBytes',
  );
  expectCode(
    () => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', env: { A: [{ __jsExpr: 'x' }] } }),
    'EXPRESSION_UNSUPPORTED',
  );
});

test('validateClient: prototype keys and __jsExpr records are hard blocks', () => {
  const protoEnv = JSON.parse('{"__proto__":"x"}');
  expectCode(
    () => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', env: protoEnv }),
    'STDIO_ENV_INVALID',
    'env.__proto__',
  );
  const protoHeaders = JSON.parse('{"constructor":"x"}');
  expectCode(
    () =>
      validateClient({
        serverName: 'x',
        transport: 'streamable-http',
        url: 'https://x.example',
        headers: protoHeaders,
      }),
    'HTTP_HEADERS_INVALID',
    'headers.constructor',
  );
  // A record member literally named __jsExpr is an env name, not a Loader
  // expression marker: the env denylist reports it, not EXPRESSION_UNSUPPORTED.
  const exprEnv = JSON.parse('{"__jsExpr":"process.env.X"}');
  expectCode(
    () => validateClient({ serverName: 'x', transport: 'stdio', command: 'n', env: exprEnv }),
    'ENV_EXECUTION_OVERRIDE',
    'env.__jsExpr',
  );
});

test('validateClient: allowPlainHttp option widens only non-loopback plaintext', () => {
  const client = validateClient(
    { serverName: 'lan', transport: 'streamable-http', url: 'http://192.168.1.20:9000/mcp' },
    { allowPlainHttp: true },
  );
  assert.equal(client.url, 'http://192.168.1.20:9000/mcp');
});

test('checkHttpUrl accepts official shapes and canonicalizes decisions', () => {
  assert.equal(checkHttpUrl('https://example.com/mcp'), 'https://example.com/mcp');
  assert.equal(checkHttpUrl('http://localhost:3000/mcp'), 'http://localhost:3000/mcp');
  assert.equal(checkHttpUrl('http://[::1]:3000/mcp'), 'http://[::1]:3000/mcp');
  assert.equal(checkHttpUrl('http://127.1:3000/mcp'), 'http://127.1:3000/mcp');
  expectCode(() => checkHttpUrl('http://10.0.0.5/mcp'), 'HTTP_PLAINTEXT_BLOCKED', 'url');
});

/* ------------------------------------------------------------------------- */
/* draft <-> client consistency                                              */
/* ------------------------------------------------------------------------- */

test('normalizeDraft and validateClient agree on the normalized shape', () => {
  const draftResult = normalizeDraft(
    draftStdio({
      argsText: '-y "pkg with space"',
      cwd: '/Users/rinat/project',
      env: [{ key: 'MODE', value: 'dev' }],
    }),
  );
  const clientResult = validateClient(draftResult.client);
  assert.deepEqual(clientResult, draftResult.client);
});
