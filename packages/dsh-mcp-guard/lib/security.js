/**
 * dsh-mcp-guard — pure security primitives.
 *
 * This module is deliberately side-effect free: no filesystem, no process
 * spawning, no network, no Loader expressions. Everything here is a pure
 * function of its arguments so the Host, the tests and an auditor can reason
 * about it without a DSH runtime.
 *
 * Secret values are treated as radioactive: they may be inspected, but they
 * are never returned, never echoed in errors and never placed into risk
 * `params` (see `analyzeServer` / `scrubRiskParams`).
 */

/** Allowed MCP server name (also the `<serverName>` namespace of mcp__ tools). */
export const SERVER_NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** Allowed env var key: 1..128 chars, starts with a letter or underscore. */
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;

/** RFC 7230 token — the only shape accepted for HTTP header names. */
export const HEADER_NAME_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/**
 * A key whose *name* implies a credential. The contract fixes this exact
 * pattern; it is intentionally permissive (substring match) because a false
 * positive only adds a "secret" badge / a medium risk warning.
 */
export const SECRET_KEY_RE =
  /(api[_-]?key|token|secret|passw|pwd|authorization|bearer|private[_-]?key|credential|cookie|session)/i;

/** Keys that would pollute prototypes if assigned through a plain object. */
export const UNSAFE_OBJECT_KEYS = Object.freeze(['__proto__', 'prototype', 'constructor']);

/** Cordis Loader expression marker; such configs can never be persisted. */
export const EXPRESSION_KEY = '__jsExpr';

/**
 * Environment variables that can steer *how* the child process executes
 * (dynamic linker, module resolution, shell hooks). Hard-blocked, always.
 */
export const BLOCKED_ENV_KEYS = Object.freeze([
  'NODE_OPTIONS',
  'NODE_PATH',
  'PATH',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONSTARTUP',
  'LD_PRELOAD',
  'LD_LIBRARY_PATH',
  'BASH_ENV',
  'ENV',
  'SHELLOPTS',
  'PERL5OPT',
  'RUBYOPT',
  'JAVA_TOOL_OPTIONS',
  '_JAVA_OPTIONS',
  'JDK_JAVA_OPTIONS',
  'GIT_SSH_COMMAND',
  'SSH_ASKPASS',
  'COMSPEC',
  'PSMODULEPATH',
]);

/** Prefixes of hard-blocked env keys (case-insensitive). */
export const BLOCKED_ENV_PREFIXES = Object.freeze(['DYLD_', 'DSH_']);

/** Structured limits, mirrored by the contract. */
export const LIMITS = Object.freeze({
  maxServers: 100,
  maxBodyBytes: 1024 * 1024,
  maxNameLength: 32,
  maxCommandLength: 4096,
  maxArgs: 64,
  maxArgLength: 4096,
  maxEnv: 64,
  maxEnvKeyLength: 128,
  maxEnvValueLength: 8192,
  maxHeaders: 64,
  maxHeaderValueLength: 8192,
  maxCwdLength: 4096,
  toolCallTimeoutMs: Object.freeze({ min: 1000, max: 600000, default: 60000 }),
  maxInstructionBytes: Object.freeze({ min: 1, max: 1048576, default: 32768 }),
  reconnect: Object.freeze({
    minDelayMs: 1,
    maxDelayMs: 2147483647,
    minAttempts: 1,
    maxAttempts: 100,
    defaultEnabled: true,
    defaultInitialDelayMs: 500,
    defaultMaxDelayMs: 30000,
    defaultMaxAttempts: 10,
  }),
});

/** Risk severity order, most severe first. */
export const RISK_LEVELS = Object.freeze(['critical', 'high', 'medium', 'low', 'info']);

const LEVEL_RANK = new Map(RISK_LEVELS.map((level, index) => [level, index]));

function riskDef(level) {
  return Object.freeze({ level });
}

/**
 * Complete risk catalog from the contract. Keys are the stable wire codes the
 * Client localizes; values expose the minimum severity this module assigns.
 * There is intentionally no `critical` code: critical findings are hard
 * blocks and are reported as validation errors, not as overridable risks.
 */
export const RISK_CODES = Object.freeze({
  'risk.localExecution': riskDef('info'),
  'risk.remoteEndpoint': riskDef('info'),
  'risk.packageRunnerAutoInstall': riskDef('high'),
  'risk.packageRunnerUnpinned': riskDef('medium'),
  'risk.shellInterpreter': riskDef('high'),
  'risk.codeEvalFlag': riskDef('high'),
  'risk.elevatedCommand': riskDef('high'),
  'risk.plainHttpLoopback': riskDef('info'),
  'risk.plainHttpAllowlisted': riskDef('high'),
  'risk.secretInArgs': riskDef('medium'),
  'risk.envSecretLiteral': riskDef('medium'),
  'risk.namespaceAmbiguous': riskDef('low'),
  'risk.cwdSystemRoot': riskDef('medium'),
  'risk.timeoutLong': riskDef('low'),
  'risk.reconnectDisabled': riskDef('low'),
});

const TEXT_ENCODER = new TextEncoder();

/* ------------------------------------------------------------------------- */
/* Small shared guards                                                       */
/* ------------------------------------------------------------------------- */

/** True for a non-null, non-array object (a plain JSON object in practice). */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Safe own-property check that never consults the prototype chain. */
export function hasOwn(value, key) {
  return isPlainObject(value) && Object.hasOwn(value, key);
}

/** UTF-8 byte length without allocating a Buffer (works in any V8 runtime). */
export function byteLength(text) {
  if (typeof text !== 'string') return 0;
  if (text.length * 3 <= 1024 * 1024 && /^[\u0000-\u007f]*$/.test(text)) return text.length;
  return TEXT_ENCODER.encode(text).byteLength;
}

/**
 * Strip anything that could carry a value out of a diagnostic path. Paths are
 * machine-generated; this is a belt-and-braces guard so a malformed path can
 * never smuggle a secret into an error message.
 */
export function sanitizePath(path) {
  if (typeof path !== 'string' || path === '') return '';
  const cleaned = path.replace(/[^A-Za-z0-9_.\[\]-]/g, '?').slice(0, 160);
  return cleaned
    .split('.')
    .map((segment) => {
      const bare = segment.replace(/[[\]]/g, '');
      if (bare === '' || !looksSecret('', bare)) return segment;
      return segment.replace(/[A-Za-z0-9_+-]{8,}/g, '?');
    })
    .join('.');
}

/** Sanitize one path segment (field names, keys). */
export function sanitizePathSegment(segment) {
  if (typeof segment !== 'string') return '?';
  if (/^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/.test(segment)) {
    return looksSecret('', segment) ? '?' : segment;
  }
  if (/^\d+$/.test(segment)) return segment;
  return '?';
}

/**
 * Value-free validation error. `.code` is a stable contract error code,
 * `.path` locates the offending field. Neither ever contains a value.
 */
export class ValidationError extends Error {
  /**
   * @param {string} code Stable contract code, e.g. `STDIO_COMMAND_INVALID`.
   * @param {string} [path] Field path, e.g. `env[2].key`.
   */
  constructor(code, path = '') {
    const safeCode = typeof code === 'string' && code ? code : 'FIELD_UNKNOWN';
    const safePath = sanitizePath(path);
    super(safePath ? `${safeCode} at ${safePath}` : safeCode);
    this.name = 'ValidationError';
    this.code = safeCode;
    this.path = safePath;
  }
}

/* ------------------------------------------------------------------------- */
/* argsText tokenizer — shell-like, never evaluates anything                 */
/* ------------------------------------------------------------------------- */

const WHITESPACE_RE = /[ \t\n\r\v\f]/;

/**
 * Split the Form `argsText` field into argv entries with POSIX-shell-like
 * quoting rules, without a shell and without any expansion:
 *
 * - unquoted whitespace separates arguments;
 * - `'…'` groups literally, quotes are removed;
 * - `"…"` groups, quotes are removed;
 * - `\` escapes the next character outside single quotes;
 * - `''` / `""` produce an empty argv entry;
 * - unbalanced quotes and NUL bytes are rejected.
 *
 * @param {string} text
 * @returns {string[]}
 * @throws {ValidationError} with code `STDIO_ARGS_INVALID`
 */
export function parseArgsText(text) {
  if (typeof text !== 'string') throw new ValidationError('STDIO_ARGS_INVALID', 'argsText');
  /** @type {string[]} */
  const out = [];
  let current = '';
  let hasCurrent = false;
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\u0000') throw new ValidationError('STDIO_ARGS_INVALID', 'argsText');
    if (ch === '\\' && !inSingle) {
      const next = text[i + 1];
      if (next === undefined) throw new ValidationError('STDIO_ARGS_INVALID', 'argsText');
      current += next;
      hasCurrent = true;
      i += 2;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      else current += ch;
      i += 1;
      continue;
    }
    if (inDouble) {
      if (ch === '"') inDouble = false;
      else current += ch;
      i += 1;
      continue;
    }
    if (ch === "'") {
      inSingle = true;
      hasCurrent = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      hasCurrent = true;
      i += 1;
      continue;
    }
    if (WHITESPACE_RE.test(ch)) {
      if (hasCurrent) {
        out.push(current);
        current = '';
        hasCurrent = false;
      }
      i += 1;
      continue;
    }
    current += ch;
    hasCurrent = true;
    i += 1;
  }
  if (inSingle || inDouble) throw new ValidationError('STDIO_ARGS_INVALID', 'argsText');
  if (hasCurrent) out.push(current);
  return out;
}

/* ------------------------------------------------------------------------- */
/* Host/URL predicates                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Loopback detection for plaintext HTTP allowance. Accepts `localhost`,
 * `*.localhost` (with an optional trailing root dot), the whole 127.0.0.0/8
 * range and IPv6 `::1` (bracketed hostnames come straight from `URL`).
 *
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLoopbackHost(hostname) {
  if (typeof hostname !== 'string') return false;
  let host = hostname.trim().toLowerCase();
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
  if (host === '') return false;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host === 'localhost' || host === 'localhost.') return true;
  if (host.endsWith('.localhost') || host.endsWith('.localhost.')) return true;
  const match = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  return [match[1], match[2], match[3]].every((part) => Number(part) <= 255);
}

/** True when the env/header value is an indirection placeholder, not a literal. */
export function isSecretReference(value) {
  if (typeof value !== 'string' || value === '') return false;
  if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(value)) return true;
  if (/\$\{[A-Za-z_][A-Za-z0-9_]*\}/.test(value)) return true;
  if (/^!!js(?:\s|$)/.test(value)) return true;
  return false;
}

/* ------------------------------------------------------------------------- */
/* Secret detection                                                          */
/* ------------------------------------------------------------------------- */

const VALUE_SECRET_PATTERNS = Object.freeze([
  // OpenAI-style: sk-..., sk-proj-..., rk-..., pk-...
  /(?:^|[^A-Za-z0-9])(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}(?![A-Za-z0-9_-])/,
  // GitHub tokens
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  // Slack tokens / webhooks
  /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/,
  /\bhooks\.slack\.com\/services\/[A-Za-z0-9/]{20,}\b/,
  // AWS access key ids
  /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16}\b/,
  // HTTP bearer credential
  /^Bearer\s+\S{8,}$/i,
  // PEM private key material
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  // JWT (header.payload.signature)
  /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/,
  // Credentials embedded in a URL
  /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/\s:@]+:[^/\s@]+@/,
]);

const BASE64ISH_RE = /^[A-Za-z0-9+/_-]{32,}={0,2}$/;

/**
 * Heuristic secret detection.
 *
 * A value is considered secret-shaped when the key name implies a credential
 * or the value matches a known credential format (API keys, provider tokens,
 * bearer credentials, JWTs, private key blocks, credential-bearing URLs and
 * long base64-ish strings). `key` may be `''` for positional argv tokens.
 *
 * @param {string} key
 * @param {unknown} value
 * @returns {boolean}
 */
export function looksSecret(key, value) {
  if (typeof key === 'string' && key !== '' && SECRET_KEY_RE.test(key)) return true;
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (candidate === '') return false;
  for (const pattern of VALUE_SECRET_PATTERNS) {
    if (pattern.test(candidate)) return true;
  }
  if (BASE64ISH_RE.test(candidate) && /\d/.test(candidate) && /[A-Za-z]/.test(candidate)) {
    return true;
  }
  return false;
}

/**
 * Scan a normalized (or raw) client config for secret material.
 * Returns locations only — never values — so the result is safe to project.
 *
 * @param {unknown} client
 * @returns {{hasSecrets: boolean, envKeys: string[], headerKeys: string[], argvIndices: number[]}}
 */
export function scanSecrets(client) {
  const result = { hasSecrets: false, envKeys: [], headerKeys: [], argvIndices: [] };
  if (!isPlainObject(client)) return result;

  if (isPlainObject(client.env)) {
    for (const [key, value] of Object.entries(client.env)) {
      if (!looksSecret(key, value)) continue;
      result.hasSecrets = true;
      result.envKeys.push(sanitizePathSegment(key));
    }
  }
  if (isPlainObject(client.headers)) {
    for (const [key, value] of Object.entries(client.headers)) {
      if (!looksSecret(key, value)) continue;
      result.hasSecrets = true;
      result.headerKeys.push(sanitizePathSegment(key));
    }
  }
  if (Array.isArray(client.args)) {
    client.args.forEach((argument, index) => {
      if (typeof argument !== 'string') return;
      const pair = splitKeyValueArgument(argument);
      const secret = pair ? looksSecret(pair.key, pair.value) : looksSecret('', argument);
      if (!secret) return;
      result.hasSecrets = true;
      result.argvIndices.push(index);
    });
  }
  return result;
}

/** Split `KEY=value` argv entries (used for positional env assignments). */
function splitKeyValueArgument(argument) {
  if (typeof argument !== 'string') return null;
  const index = argument.indexOf('=');
  if (index <= 0) return null;
  const key = argument.slice(0, index);
  if (!ENV_KEY_RE.test(key)) return null;
  return { key, value: argument.slice(index + 1) };
}

/* ------------------------------------------------------------------------- */
/* Risk analysis                                                             */
/* ------------------------------------------------------------------------- */

const SHELL_COMMANDS = new Set([
  'sh',
  'bash',
  'zsh',
  'dash',
  'ksh',
  'mksh',
  'oksh',
  'fish',
  'csh',
  'tcsh',
  'ash',
  'busybox',
  'pwsh',
  'powershell',
  'cmd',
  'osascript',
  'osacompile',
  'expect',
  'wscript',
  'cscript',
  'mshta',
]);

const ELEVATED_COMMANDS = new Set(['sudo', 'su', 'doas', 'pkexec', 'runas', 'gosu']);

const EVAL_FLAGS_BY_FAMILY = Object.freeze({
  shell: Object.freeze(['-c', '--command']),
  powershell: Object.freeze(['-c', '-command', '--command', '-e', '-encodedcommand', '--eval']),
  cmd: Object.freeze(['/c', '/k', '/r']),
  osascript: Object.freeze(['-e', '--eval']),
  python: Object.freeze(['-c', '--command']),
  node: Object.freeze(['-e', '--eval', '-p', '--print']),
  deno: Object.freeze(['eval', '-e', '--eval']),
  bun: Object.freeze(['-e', '--eval', '-p', '--print']),
  perl: Object.freeze(['-e']),
  ruby: Object.freeze(['-e']),
  php: Object.freeze(['-r']),
  lua: Object.freeze(['-e']),
  expect: Object.freeze(['-c']),
});

const PACKAGE_RUNNERS = new Set(['npx', 'bunx', 'pnpx', 'uvx']);

const MOVING_TAGS = new Set([
  'latest',
  'next',
  'beta',
  'canary',
  'nightly',
  'dev',
  'stable',
  'rc',
  'alpha',
  'experimental',
  'insiders',
]);

/** POSIX absolute roots that should never be a server working directory. */
const CWD_SYSTEM_ROOTS = new Set([
  '/',
  '/Applications',
  '/Library',
  '/System',
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib64',
  '/opt',
  '/private',
  '/proc',
  '/root',
  '/sbin',
  '/sys',
  '/tmp',
  '/usr',
  '/var',
]);

/** Windows roots that should never be a server working directory. */
const CWD_SYSTEM_ROOTS_WIN = new Set([
  'c:/',
  'c:/windows',
  'c:/windows/system32',
  'c:/windows/syswow64',
  'c:/program files',
  'c:/program files (x86)',
  'c:/programdata',
]);

/** Canonical, safe display strings for matched system roots. */
const CWD_SYSTEM_ROOT_LABELS = new Map([
  ['c:/', 'c:/'],
  ['c:/windows', 'c:/windows'],
  ['c:/windows/system32', 'c:/windows/system32'],
  ['c:/windows/syswow64', 'c:/windows/syswow64'],
  ['c:/program files', 'c:/program files'],
  ['c:/program files (x86)', 'c:/program files (x86)'],
  ['c:/programdata', 'c:/programdata'],
]);

/** Extract a lowercased executable basename, stripping Windows scripts/ext. */
function commandBaseName(command) {
  if (typeof command !== 'string') return null;
  const trimmed = command.trim();
  if (trimmed === '') return null;
  const parts = trimmed.split(/[\\/]/);
  const raw = parts[parts.length - 1] ?? '';
  const base = raw.toLowerCase().replace(/\.(exe|cmd|bat|com|ps1)$/, '');
  if (base === '') return null;
  return { raw, base };
}

/** A command/package token is shown only when it cannot itself be a secret. */
function safeParamName(name) {
  if (typeof name !== 'string' || name === '') return 'unknown';
  if (!/^[A-Za-z0-9._+@-]{1,64}$/.test(name)) return 'unknown';
  if (looksSecret('', name)) return 'unknown';
  return name;
}

function safeHostname(hostname) {
  if (typeof hostname !== 'string' || hostname === '') return null;
  if (!/^[A-Za-z0-9._:\-[\]]{1,253}$/.test(hostname)) return null;
  if (looksSecret('', hostname)) return null;
  return hostname;
}

function interpreterFamily(base) {
  if (SHELL_COMMANDS.has(base)) {
    if (base === 'pwsh' || base === 'powershell') return 'powershell';
    if (base === 'cmd') return 'cmd';
    if (base === 'osascript' || base === 'osacompile') return 'osascript';
    if (base === 'expect') return 'expect';
    return 'shell';
  }
  if (base === 'python' || /^python3(?:\.\d+)?$/.test(base)) return 'python';
  if (base === 'node' || base === 'nodejs') return 'node';
  if (base === 'deno') return 'deno';
  if (base === 'bun') return 'bun';
  if (base === 'perl') return 'perl';
  if (base === 'ruby') return 'ruby';
  if (base === 'php') return 'php';
  if (base === 'lua' || base === 'luajit') return 'lua';
  return null;
}

/** Return the canonical eval flag that makes this interpreter execute a string. */
function findEvalFlag(base, args) {
  const family = interpreterFamily(base);
  if (!family) return null;
  const flags = EVAL_FLAGS_BY_FAMILY[family];
  if (!flags || !Array.isArray(args)) return null;
  for (const argument of args) {
    if (typeof argument !== 'string') continue;
    const lowered = argument.toLowerCase();
    for (const flag of flags) {
      if (lowered === flag) return flag;
    }
    if (family === 'shell' && /^-[A-Za-z]*c[A-Za-z]*$/.test(argument)) return '-c';
    if (family === 'cmd' && /^\/(?:c|k|r)$/i.test(argument)) return argument.toLowerCase();
  }
  return null;
}

function isPathLikeSpec(spec) {
  if (typeof spec !== 'string' || spec === '') return false;
  return (
    spec.startsWith('.') ||
    spec.startsWith('/') ||
    spec.startsWith('~') ||
    /^file:/i.test(spec) ||
    /^git[+:]|^github:|^gitlab:|^bitbucket:/i.test(spec) ||
    /^https?:/i.test(spec) ||
    /^[A-Za-z]:[\\/]/.test(spec)
  );
}

/** Extract the package spec from a package-runner argv tail. */
function findPackageSpec(tail) {
  if (!Array.isArray(tail) || tail.length === 0) return null;
  const takesValue = new Set([
    '-p',
    '--package',
    '-c',
    '--call',
    '--registry',
    '--cache',
    '--prefix',
    '--userconfig',
    '--node-options',
    '--node-arg',
    '--loglevel',
  ]);
  for (let i = 0; i < tail.length; i += 1) {
    const argument = tail[i];
    if (typeof argument !== 'string') continue;
    if (argument === '-p' || argument === '--package') {
      const value = tail[i + 1];
      return typeof value === 'string' && value !== '' ? value : null;
    }
    if (argument.startsWith('-')) {
      if (takesValue.has(argument)) i += 1;
      continue;
    }
    return argument;
  }
  return null;
}

function packageNameFromSpec(spec) {
  if (typeof spec !== 'string' || spec === '') return null;
  const at = spec.lastIndexOf('@');
  const name = at > 0 ? spec.slice(0, at) : spec;
  if (!/^(@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/.test(name)) return null;
  return name;
}

/**
 * Exact-version only. `latest`, dist-tags and semver ranges are treated as
 * unpinned: a medium risk is a warning, so erring on the strict side is safe.
 */
function isPinnedSpec(spec) {
  if (typeof spec !== 'string') return false;
  const at = spec.lastIndexOf('@');
  if (at <= 0) return false;
  const version = spec.slice(at + 1);
  if (version === '' || MOVING_TAGS.has(version.toLowerCase())) return false;
  return /^v?\d+(?:\.\d+)*(?:[-+][A-Za-z0-9.-]+)?$/.test(version);
}

/** Detect package-runner executions and their auto-install / pinning posture. */
function packageRunnerRisks(client, add) {
  const command = commandBaseName(client.command);
  if (!command) return;
  const args = Array.isArray(client.args) ? client.args : [];
  const base = command.base;

  let runnerLabel = null;
  let tail = null;
  if (PACKAGE_RUNNERS.has(base)) {
    runnerLabel = base;
    tail = args;
  } else if (base === 'pnpm' && args[0] === 'dlx') {
    runnerLabel = 'pnpm dlx';
    tail = args.slice(1);
  } else if (base === 'yarn' && args[0] === 'dlx') {
    runnerLabel = 'yarn dlx';
    tail = args.slice(1);
  } else if (base === 'npm' && args[0] === 'exec') {
    runnerLabel = 'npm exec';
    tail = args.slice(1);
  } else if (base === 'pipx' && args[0] === 'run') {
    runnerLabel = 'pipx run';
    tail = args.slice(1);
  } else if (base === 'uv' && args[0] === 'tool' && args[1] === 'run') {
    runnerLabel = 'uv tool run';
    tail = args.slice(2);
  }
  if (runnerLabel === null) return;

  const spec = findPackageSpec(tail);
  const localSpec = isPathLikeSpec(spec);
  const explicitYes = Array.isArray(tail) && tail.some((item) => item === '-y' || item === '--yes');
  const noInstall = Array.isArray(tail) && tail.includes('--no-install');
  let autoInstall;
  if (explicitYes) autoInstall = true;
  else if (base === 'npx') autoInstall = !noInstall;
  else autoInstall = true;

  if (autoInstall && !localSpec) add('risk.packageRunnerAutoInstall', { command: runnerLabel });

  if (spec !== null && !localSpec && !isPinnedSpec(spec)) {
    const packageName = packageNameFromSpec(spec);
    add('risk.packageRunnerUnpinned', packageName ? { package: packageName } : {});
  }
}

/** Positional credentials in argv (`--token=…`, bare token values). */
function secretArgRisks(args, add) {
  if (!Array.isArray(args)) return;
  args.forEach((argument, index) => {
    if (typeof argument !== 'string') return;
    const pair = splitKeyValueArgument(argument);
    if (pair) {
      if (!looksSecret(pair.key, pair.value)) return;
      add('risk.secretInArgs', ENV_KEY_RE.test(pair.key) ? { name: pair.key } : { index });
      return;
    }
    if (looksSecret('', argument)) add('risk.secretInArgs', { index });
  });
}

/** Secret-shaped literals in env/header records (placeholders are fine). */
function literalSecretRisks(record, kind, add) {
  if (!isPlainObject(record)) return;
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== 'string' || value === '') continue;
    if (isSecretReference(value)) continue;
    if (!looksSecret(key, value)) continue;
    const safeKey =
      kind === 'env' ? (ENV_KEY_RE.test(key) ? key : '') : HEADER_NAME_RE.test(key) ? key : '';
    add('risk.envSecretLiteral', safeKey ? { key: safeKey } : {});
  }
}

/** Normalize a cwd for comparison against the known system roots. */
function normalizeCwdForRisk(cwd) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return null;
  let normalized = cwd.trim().replace(/\\/g, '/');
  normalized = normalized.replace(/\/+/g, '/');
  if (normalized.length > 1) normalized = normalized.replace(/\/+$/, '');
  if (normalized === '') normalized = '/';
  if (/^[a-z]:$/.test(normalized)) normalized += '/';
  return normalized;
}

function cwdRisk(cwd, add) {
  const normalized = normalizeCwdForRisk(cwd);
  if (normalized === null) return;
  if (CWD_SYSTEM_ROOTS.has(normalized)) {
    add('risk.cwdSystemRoot', { root: normalized });
    return;
  }
  const lowered = normalized.toLowerCase();
  if (CWD_SYSTEM_ROOTS_WIN.has(lowered)) {
    add('risk.cwdSystemRoot', { root: CWD_SYSTEM_ROOT_LABELS.get(lowered) ?? lowered });
    return;
  }
  if (/^[a-z]:\/$/.test(lowered)) add('risk.cwdSystemRoot', { root: `${lowered.slice(0, 2)}/` });
}

function timeoutRisk(timeoutMs, add) {
  if (!Number.isInteger(timeoutMs)) return;
  if (timeoutMs > LIMITS.toolCallTimeoutMs.max) add('risk.timeoutLong', { timeoutMs });
}

function reconnectRisk(reconnect, add) {
  if (!isPlainObject(reconnect)) return;
  if (reconnect.enabled === false) add('risk.reconnectDisabled', {});
}

function namespaceRisk(serverName, add) {
  if (typeof serverName !== 'string' || !serverName.includes('__')) return;
  add('risk.namespaceAmbiguous', SERVER_NAME_RE.test(serverName) ? { name: serverName } : {});
}

/** Collect secret values so risk params can be scrubbed as a last line of defence. */
function collectSecretValues(source) {
  const values = new Set();
  const consider = (key, value) => {
    if (typeof value !== 'string' || value.length < 4) return;
    if (isSecretReference(value)) return;
    if (!looksSecret(key, value)) return;
    values.add(value);
  };
  if (isPlainObject(source.env)) {
    for (const [key, value] of Object.entries(source.env)) consider(key, value);
  }
  if (isPlainObject(source.headers)) {
    for (const [key, value] of Object.entries(source.headers)) consider(key, value);
  }
  if (Array.isArray(source.args)) {
    for (const argument of source.args) {
      if (typeof argument !== 'string') continue;
      consider('', argument);
      const pair = splitKeyValueArgument(argument);
      if (pair) consider(pair.key, pair.value);
    }
  }
  return [...values];
}

/** Replace any risk params that would echo a detected secret value. */
function scrubRiskParams(risks, secretValues) {
  if (secretValues.length === 0) return risks;
  return risks.map((risk) => {
    const serialized = JSON.stringify(risk.params ?? {});
    for (const secret of secretValues) {
      if (serialized.includes(secret)) return { ...risk, params: {} };
    }
    return risk;
  });
}

/**
 * Analyze a normalized MCP client config and return contract `Risk` objects.
 *
 * The function never throws: malformed input is treated as *more* dangerous
 * (`blocked: true`) rather than trusted. Risk `params` only ever contain safe
 * names (command basenames, package names, header/env key names, hosts, a
 * timeout number or a system-root label) — never a secret value.
 *
 * @param {unknown} client Normalized official client config.
 * @param {{allowPlainHttp?: boolean, hasSecrets?: boolean}} [opts]
 * @returns {{risk: Array<{level: string, code: string, params: object}>, blocked: boolean}}
 */
export function analyzeServer(client, opts = {}) {
  const source = isPlainObject(client) ? client : {};
  const allowPlainHttp = opts?.allowPlainHttp === true;
  // Kept in the signature per the contract; the scan below recomputes it so a
  // stale flag can never silence a finding.
  void opts?.hasSecrets;

  /** @type {Array<{level: string, code: string, params: object}>} */
  const risks = [];
  const add = (code, params = {}) => {
    const definition = RISK_CODES[code];
    if (!definition) return;
    risks.push({ level: definition.level, code, params: params ?? {} });
  };

  const transport = source.transport;
  const isStdio = transport === 'stdio';
  const isHttp = transport === 'streamable-http';

  let parsedUrl = null;
  if (isHttp && typeof source.url === 'string') {
    try {
      parsedUrl = new URL(source.url);
    } catch {
      parsedUrl = null;
    }
  }

  if (isStdio) {
    const command = commandBaseName(source.command);
    add('risk.localExecution', command ? { command: safeParamName(command.base) } : {});

    packageRunnerRisks(source, add);

    if (command) {
      if (SHELL_COMMANDS.has(command.base)) {
        add('risk.shellInterpreter', { command: safeParamName(command.base) });
      }
      const evalFlag = findEvalFlag(command.base, source.args);
      if (evalFlag) add('risk.codeEvalFlag', { command: safeParamName(command.base), flag: evalFlag });
      if (ELEVATED_COMMANDS.has(command.base)) {
        add('risk.elevatedCommand', { command: safeParamName(command.base) });
      }
    }

    secretArgRisks(source.args, add);
    cwdRisk(source.cwd, add);
    literalSecretRisks(source.env, 'env', add);
  } else if (isHttp) {
    const hostname = parsedUrl ? safeHostname(parsedUrl.hostname) : null;
    add('risk.remoteEndpoint', hostname ? { host: hostname } : {});
    if (parsedUrl && parsedUrl.protocol === 'http:') {
      if (isLoopbackHost(parsedUrl.hostname)) {
        add('risk.plainHttpLoopback', hostname ? { host: hostname } : {});
      } else {
        add('risk.plainHttpAllowlisted', hostname ? { host: hostname } : {});
      }
    }
    literalSecretRisks(source.headers, 'headers', add);
  }

  namespaceRisk(source.serverName, add);
  timeoutRisk(source.toolCallTimeoutMs, add);
  reconnectRisk(source.reconnect, add);

  const safeRisks = scrubRiskParams(risks, collectSecretValues(source));

  let blocked = safeRisks.some((risk) => risk.level === 'critical');
  // Fail closed: a config that is not even a valid transport cannot be
  // cleared for enabling, and non-loopback plaintext HTTP requires the
  // row-level allow flag (validation reports it as HTTP_PLAINTEXT_BLOCKED too).
  if (!isStdio && !isHttp) blocked = true;
  if (
    isHttp &&
    parsedUrl &&
    parsedUrl.protocol === 'http:' &&
    !isLoopbackHost(parsedUrl.hostname) &&
    !allowPlainHttp
  ) {
    blocked = true;
  }
  return { risk: safeRisks, blocked };
}

/* ------------------------------------------------------------------------- */
/* Severity aggregation                                                      */
/* ------------------------------------------------------------------------- */

/**
 * Highest severity among risks, or `null` when the list is empty.
 * Accepts a single Risk or an array.
 *
 * @param {unknown} risks
 * @returns {string|null}
 */
export function highestRisk(risks) {
  const list = Array.isArray(risks) ? risks : risks ? [risks] : [];
  let best = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const risk of list) {
    if (!isPlainObject(risk)) continue;
    const rank = LEVEL_RANK.get(risk.level);
    if (rank === undefined || rank >= bestRank) continue;
    best = risk.level;
    bestRank = rank;
  }
  return best;
}

/**
 * Contract `blocked`: true when validation errors exist or any risk is
 * `critical` (hard blocks are errors, so the second clause is a safety net).
 *
 * @param {unknown} risks
 * @param {unknown} [errors]
 * @returns {boolean}
 */
export function isBlocked(risks, errors) {
  if (Array.isArray(errors) && errors.length > 0) return true;
  return highestRisk(risks) === 'critical';
}
