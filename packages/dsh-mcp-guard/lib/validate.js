/**
 * dsh-mcp-guard — draft/raw → normalized official MCP client config.
 *
 * Two entry points share one validation core:
 *
 * - `normalizeDraft(draft, opts)` — the Form payload (`argsText`, env/header
 *   entry arrays with `keep` semantics, draft-level timeout/reconnect fields).
 * - `validateClient(raw, opts)` — the official `@deepseek-ai/dsh-mcp-client`
 *   config shape (`args: string[]`, env/header records), used to normalize
 *   imported and externally read configs.
 *
 * Rules are fail-closed and never echo values: every failure is a
 * `ValidationError` carrying a stable code and a sanitized field path.
 */

import { isAbsolute as isAbsolutePath } from 'node:path';

import {
  BLOCKED_ENV_KEYS,
  BLOCKED_ENV_PREFIXES,
  ENV_KEY_RE,
  EXPRESSION_KEY,
  HEADER_NAME_RE,
  LIMITS,
  SERVER_NAME_RE,
  UNSAFE_OBJECT_KEYS,
  ValidationError,
  byteLength,
  hasOwn,
  highestRisk,
  isBlocked,
  isLoopbackHost,
  isPlainObject,
  parseArgsText,
  sanitizePathSegment,
  scanSecrets,
} from './security.js';

export { highestRisk, isBlocked };
export { ValidationError };

/* ------------------------------------------------------------------------- */
/* Shared field guards                                                       */
/* ------------------------------------------------------------------------- */

const DRAFT_FIELDS = new Set([
  'serverName',
  'transport',
  'command',
  'argsText',
  'cwd',
  'url',
  'env',
  'headers',
  'timeoutMs',
  'reconnectEnabled',
  'reconnectAttempts',
  'failOnStartupError',
  'maxInstructionBytes',
  'allowPlainHttp',
]);

const CLIENT_FIELDS = new Set([
  'serverName',
  'transport',
  'command',
  'args',
  'env',
  'cwd',
  'url',
  'headers',
  'toolCallTimeoutMs',
  'reconnect',
  'failOnStartupError',
  'maxInstructionBytes',
]);

const RECONNECT_FIELDS = new Set(['enabled', 'initialDelayMs', 'maxDelayMs', 'maxAttempts']);

const STDIO_ONLY_FIELDS = ['command', 'args', 'env', 'cwd'];
const HTTP_ONLY_FIELDS = ['url', 'headers'];

function joinPath(path, key) {
  const segment = typeof key === 'number' ? `[${key}]` : sanitizePathSegment(key);
  if (path === '') return segment;
  return segment.startsWith('[') ? `${path}${segment}` : `${path}.${segment}`;
}

/**
 * Reject Cordis Loader expression markers (`{ __jsExpr: … }`) anywhere in the
 * config. `env`/`headers` *records* are data maps, so their keys are not
 * treated as markers (a blocked env key named `__jsExpr` is reported by the
 * env denylist instead), but marker objects used as *values* are rejected.
 */
function assertNoExpressions(root) {
  if (!isPlainObject(root) && !Array.isArray(root)) return;
  /** @type {Array<{value: unknown, path: string}>} */
  const stack = [{ value: root, path: '' }];
  while (stack.length > 0) {
    const frame = stack.pop();
    if (frame === undefined) continue;
    const { value, path } = frame;
    if (Array.isArray(value)) {
      for (let index = value.length - 1; index >= 0; index -= 1) {
        stack.push({ value: value[index], path: joinPath(path, index) });
      }
      continue;
    }
    if (!isPlainObject(value)) continue;
    if (hasOwn(value, EXPRESSION_KEY)) {
      throw new ValidationError(
        'EXPRESSION_UNSUPPORTED',
        path === '' ? EXPRESSION_KEY : `${path}.${EXPRESSION_KEY}`,
      );
    }
    for (const key of Object.keys(value).reverse()) {
      const child = value[key];
      const childPath = joinPath(path, key);
      if ((key === 'env' || key === 'headers') && isPlainObject(child)) {
        for (const recordKey of Object.keys(child).reverse()) {
          stack.push({ value: child[recordKey], path: joinPath(childPath, recordKey) });
        }
        continue;
      }
      stack.push({ value: child, path: childPath });
    }
  }
}

/** True when an env key may steer execution and must be hard-blocked. */
export function isBlockedEnvKey(key) {
  if (typeof key !== 'string') return false;
  const lowered = key.toLowerCase();
  if (lowered === EXPRESSION_KEY.toLowerCase()) return true;
  for (const blocked of BLOCKED_ENV_KEYS) {
    if (lowered === blocked.toLowerCase()) return true;
  }
  for (const prefix of BLOCKED_ENV_PREFIXES) {
    if (lowered.startsWith(prefix.toLowerCase())) return true;
  }
  return false;
}

function assertServerName(value, path = 'serverName') {
  if (typeof value !== 'string' || !SERVER_NAME_RE.test(value)) {
    throw new ValidationError('NAME_INVALID', path);
  }
  return value;
}

function validateCommand(value) {
  if (value === undefined || value === null || value === '') {
    throw new ValidationError('STDIO_COMMAND_REQUIRED', 'command');
  }
  if (typeof value !== 'string') throw new ValidationError('STDIO_COMMAND_INVALID', 'command');
  if (value.length > LIMITS.maxCommandLength) {
    throw new ValidationError('STDIO_COMMAND_INVALID', 'command');
  }
  if (/[\u0000\r\n]/.test(value) || value.trim() === '') {
    throw new ValidationError('STDIO_COMMAND_INVALID', 'command');
  }
  return value;
}

function validateArgsArray(value) {
  if (!Array.isArray(value)) throw new ValidationError('STDIO_ARGS_INVALID', 'args');
  if (value.length > LIMITS.maxArgs) throw new ValidationError('STDIO_ARGS_INVALID', 'args');
  const args = [];
  for (let index = 0; index < value.length; index += 1) {
    const argument = value[index];
    if (typeof argument !== 'string') {
      throw new ValidationError('STDIO_ARGS_INVALID', `args[${index}]`);
    }
    if (argument.length > LIMITS.maxArgLength || argument.includes('\u0000')) {
      throw new ValidationError('STDIO_ARGS_INVALID', `args[${index}]`);
    }
    args.push(argument);
  }
  return args;
}

function validateCwd(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string') throw new ValidationError('STDIO_CWD_INVALID', 'cwd');
  if (value.length > LIMITS.maxCwdLength) throw new ValidationError('STDIO_CWD_INVALID', 'cwd');
  if (/[\u0000\r\n]/.test(value)) throw new ValidationError('STDIO_CWD_INVALID', 'cwd');
  if (!isAbsolutePath(value)) throw new ValidationError('STDIO_CWD_INVALID', 'cwd');
  return value;
}

/* ------------------------------------------------------------------------- */
/* env / headers keep resolution                                             */
/* ------------------------------------------------------------------------- */

/**
 * Resolve Form env/header entries, applying `keep` semantics against the
 * stored (existing) record. Returns `{key, value}` pairs with values
 * materialized; it never returns a stored secret to the caller's output other
 * than inside the normalized config the caller explicitly asked for.
 *
 * @param {unknown} entries Draft entry array: `{key, value}` or `{key, keep:true}`.
 * @param {unknown} existingRecord Stored env/headers record (values are strings).
 * @param {{code?: string, path?: string}} [opts]
 * @returns {Array<{key: string, value: string}>}
 */
export function resolveDraftEntries(entries, existingRecord, opts = {}) {
  const code = typeof opts?.code === 'string' ? opts.code : 'STDIO_ENV_INVALID';
  const basePath = typeof opts?.path === 'string' ? opts.path : 'env';
  if (entries === undefined || entries === null) return [];
  if (!Array.isArray(entries)) throw new ValidationError(code, basePath);
  const stored = isPlainObject(existingRecord) ? existingRecord : {};
  const seen = new Set();
  const resolved = [];
  entries.forEach((entry, index) => {
    const path = `${basePath}[${index}]`;
    if (!isPlainObject(entry)) throw new ValidationError(code, path);
    for (const key of Object.keys(entry)) {
      if (key !== 'key' && key !== 'value' && key !== 'keep') {
        throw new ValidationError('FIELD_UNKNOWN', joinPath(path, key));
      }
    }
    const key = entry.key;
    if (typeof key !== 'string' || key === '') throw new ValidationError(code, joinPath(path, 'key'));
    if (seen.has(key)) throw new ValidationError(code, joinPath(path, 'key'));
    seen.add(key);

    const hasValue = hasOwn(entry, 'value');
    const hasKeep = hasOwn(entry, 'keep');
    if (hasValue && hasKeep) throw new ValidationError(code, path);
    let value;
    if (hasKeep) {
      if (entry.keep !== true) throw new ValidationError(code, joinPath(path, 'keep'));
      if (!hasOwn(stored, key) || typeof stored[key] !== 'string') {
        throw new ValidationError('SECRET_KEEP_UNAVAILABLE', joinPath(path, 'key'));
      }
      value = stored[key];
    } else if (hasValue) {
      if (typeof entry.value !== 'string') throw new ValidationError(code, joinPath(path, 'value'));
      value = entry.value;
    } else {
      throw new ValidationError(code, path);
    }
    resolved.push({ key, value });
  });
  return resolved;
}

/** Backwards-compatible alias used by early Host drafts of this contract. */
export const mergeKeepEntries = resolveDraftEntries;

function validateEnvEntries(entries, existingRecord) {
  const resolved = resolveDraftEntries(entries, existingRecord, {
    code: 'STDIO_ENV_INVALID',
    path: 'env',
  });
  if (resolved.length > LIMITS.maxEnv) throw new ValidationError('TOO_MANY_ENV', 'env');
  const record = new Map();
  resolved.forEach(({ key, value }, index) => {
    const path = `env[${index}]`;
    if (!ENV_KEY_RE.test(key)) throw new ValidationError('STDIO_ENV_INVALID', joinPath(path, 'key'));
    if (UNSAFE_OBJECT_KEYS.includes(key)) {
      throw new ValidationError('STDIO_ENV_INVALID', joinPath(path, 'key'));
    }
    if (isBlockedEnvKey(key)) throw new ValidationError('ENV_EXECUTION_OVERRIDE', joinPath(path, 'key'));
    if (value.length > LIMITS.maxEnvValueLength) {
      throw new ValidationError('VALUE_TOO_LONG', joinPath(path, 'value'));
    }
    if (value.includes('\u0000')) throw new ValidationError('STDIO_ENV_INVALID', joinPath(path, 'value'));
    record.set(key, value);
  });
  return record;
}

function validateHeaderEntries(entries, existingRecord) {
  const resolved = resolveDraftEntries(entries, existingRecord, {
    code: 'HTTP_HEADERS_INVALID',
    path: 'headers',
  });
  if (resolved.length > LIMITS.maxHeaders) throw new ValidationError('TOO_MANY_HEADERS', 'headers');
  const record = new Map();
  const seenNames = new Set();
  resolved.forEach(({ key, value }, index) => {
    const path = `headers[${index}]`;
    if (!HEADER_NAME_RE.test(key)) throw new ValidationError('HTTP_HEADERS_INVALID', joinPath(path, 'key'));
    if (UNSAFE_OBJECT_KEYS.includes(key.toLowerCase())) {
      throw new ValidationError('HTTP_HEADERS_INVALID', joinPath(path, 'key'));
    }
    const lowered = key.toLowerCase();
    if (seenNames.has(lowered)) throw new ValidationError('HTTP_HEADERS_INVALID', joinPath(path, 'key'));
    seenNames.add(lowered);
    if (value.length > LIMITS.maxHeaderValueLength) {
      throw new ValidationError('VALUE_TOO_LONG', joinPath(path, 'value'));
    }
    if (/[\u0000\r\n]/.test(value)) throw new ValidationError('HTTP_HEADERS_INVALID', joinPath(path, 'value'));
    record.set(key, value);
  });
  return record;
}

function validateEnvRecord(value) {
  if (value === undefined || value === null) return new Map();
  if (!isPlainObject(value)) throw new ValidationError('STDIO_ENV_INVALID', 'env');
  const keys = Object.keys(value);
  if (keys.length > LIMITS.maxEnv) throw new ValidationError('TOO_MANY_ENV', 'env');
  const record = new Map();
  for (const key of keys) {
    const path = joinPath('env', key);
    const entryValue = value[key];
    if (!ENV_KEY_RE.test(key)) throw new ValidationError('STDIO_ENV_INVALID', path);
    if (UNSAFE_OBJECT_KEYS.includes(key)) throw new ValidationError('STDIO_ENV_INVALID', path);
    if (isBlockedEnvKey(key)) throw new ValidationError('ENV_EXECUTION_OVERRIDE', path);
    if (typeof entryValue !== 'string') throw new ValidationError('STDIO_ENV_INVALID', path);
    if (entryValue.length > LIMITS.maxEnvValueLength) {
      throw new ValidationError('VALUE_TOO_LONG', path);
    }
    if (entryValue.includes('\u0000')) throw new ValidationError('STDIO_ENV_INVALID', path);
    record.set(key, entryValue);
  }
  return record;
}

function validateHeaderRecord(value) {
  if (value === undefined || value === null) return new Map();
  if (!isPlainObject(value)) throw new ValidationError('HTTP_HEADERS_INVALID', 'headers');
  const keys = Object.keys(value);
  if (keys.length > LIMITS.maxHeaders) throw new ValidationError('TOO_MANY_HEADERS', 'headers');
  const record = new Map();
  const seenNames = new Set();
  for (const key of keys) {
    const path = joinPath('headers', key);
    const entryValue = value[key];
    if (!HEADER_NAME_RE.test(key)) throw new ValidationError('HTTP_HEADERS_INVALID', path);
    if (UNSAFE_OBJECT_KEYS.includes(key.toLowerCase())) {
      throw new ValidationError('HTTP_HEADERS_INVALID', path);
    }
    const lowered = key.toLowerCase();
    if (seenNames.has(lowered)) throw new ValidationError('HTTP_HEADERS_INVALID', path);
    seenNames.add(lowered);
    if (typeof entryValue !== 'string') throw new ValidationError('HTTP_HEADERS_INVALID', path);
    if (entryValue.length > LIMITS.maxHeaderValueLength) {
      throw new ValidationError('VALUE_TOO_LONG', path);
    }
    if (/[\u0000\r\n]/.test(entryValue)) throw new ValidationError('HTTP_HEADERS_INVALID', path);
    record.set(key, entryValue);
  }
  return record;
}

/* ------------------------------------------------------------------------- */
/* URL validation                                                            */
/* ------------------------------------------------------------------------- */

/**
 * Validate a streamable-http URL:
 * - must parse as an absolute URL;
 * - `https:` always allowed, `http:` only for loopback hosts or when the row
 *   is explicitly allowlisted (`allowPlainHttp: true`);
 * - no userinfo (even empty), fragment, whitespace, backslash or control chars.
 *
 * @param {unknown} rawUrl
 * @param {{allowPlainHttp?: boolean}} [opts]
 * @returns {string} the original URL string (validated, not rewritten)
 */
export function checkHttpUrl(rawUrl, opts = {}) {
  const allowPlainHttp = opts?.allowPlainHttp === true;
  if (rawUrl === undefined || rawUrl === null || rawUrl === '') {
    throw new ValidationError('HTTP_URL_REQUIRED', 'url');
  }
  if (typeof rawUrl !== 'string') throw new ValidationError('HTTP_URL_INVALID', 'url');
  if (byteLength(rawUrl) > 4096) throw new ValidationError('HTTP_URL_INVALID', 'url');
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(rawUrl)) throw new ValidationError('HTTP_URL_INVALID', 'url');
  if (/[\s\\]/.test(rawUrl)) throw new ValidationError('HTTP_URL_INVALID', 'url');
  if (rawUrl.includes('#')) throw new ValidationError('HTTP_URL_INVALID', 'url');

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new ValidationError('HTTP_URL_INVALID', 'url');
  }

  // Reject userinfo even when it is empty (`http://@host`), because WHATWG
  // normalizes the `@` away before we can inspect `username`/`password`.
  const schemeIndex = rawUrl.indexOf('://');
  const authority =
    schemeIndex >= 0 ? rawUrl.slice(schemeIndex + 3).split(/[/?#]/, 1)[0] : '';
  if (authority.includes('@')) throw new ValidationError('HTTP_URL_INVALID', 'url');
  if (parsed.username !== '' || parsed.password !== '') {
    throw new ValidationError('HTTP_URL_INVALID', 'url');
  }
  if (parsed.hostname === '') throw new ValidationError('HTTP_URL_INVALID', 'url');

  if (parsed.protocol === 'https:') return rawUrl;
  if (parsed.protocol === 'http:') {
    if (isLoopbackHost(parsed.hostname)) return rawUrl;
    if (allowPlainHttp) return rawUrl;
    throw new ValidationError('HTTP_PLAINTEXT_BLOCKED', 'url');
  }
  throw new ValidationError('HTTP_URL_INVALID', 'url');
}

/* ------------------------------------------------------------------------- */
/* Numeric / tunable normalization                                           */
/* ------------------------------------------------------------------------- */

function readInteger(value, fallback, code, path, min, max) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(code, path);
  }
  return value;
}

function readBoolean(value, fallback, code, path) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'boolean') throw new ValidationError(code, path);
  return value;
}

function normalizeReconnect(sizeSource, rawReconnect, defaults) {
  const reconnect = {
    enabled: typeof defaults.enabled === 'boolean' ? defaults.enabled : true,
    initialDelayMs: defaults.initialDelayMs,
    maxDelayMs: defaults.maxDelayMs,
    maxAttempts: defaults.maxAttempts,
  };
  if (isPlainObject(rawReconnect)) {
    for (const key of Object.keys(rawReconnect)) {
      if (!RECONNECT_FIELDS.has(key)) throw new ValidationError('FIELD_UNKNOWN', joinPath('reconnect', key));
    }
    reconnect.enabled = readBoolean(
      rawReconnect.enabled,
      reconnect.enabled,
      'RECONNECT_INVALID',
      'reconnect.enabled',
    );
    reconnect.initialDelayMs = readInteger(
      rawReconnect.initialDelayMs,
      defaults.initialDelayMs,
      'RECONNECT_INVALID',
      'reconnect.initialDelayMs',
      LIMITS.reconnect.minDelayMs,
      LIMITS.reconnect.maxDelayMs,
    );
    reconnect.maxDelayMs = readInteger(
      rawReconnect.maxDelayMs,
      defaults.maxDelayMs,
      'RECONNECT_INVALID',
      'reconnect.maxDelayMs',
      LIMITS.reconnect.minDelayMs,
      LIMITS.reconnect.maxDelayMs,
    );
    reconnect.maxAttempts = readInteger(
      rawReconnect.maxAttempts,
      defaults.maxAttempts,
      'RECONNECT_INVALID',
      'reconnect.maxAttempts',
      LIMITS.reconnect.minAttempts,
      LIMITS.reconnect.maxAttempts,
    );
  } else if (rawReconnect !== undefined && rawReconnect !== null) {
    throw new ValidationError('RECONNECT_INVALID', 'reconnect');
  }
  if (sizeSource.enabled !== undefined && sizeSource.enabled !== null) {
    reconnect.enabled = readBoolean(sizeSource.enabled, true, 'RECONNECT_INVALID', 'reconnectEnabled');
  }
  return reconnect;
}

function buildDraftTunables(draft, existingClient) {
  const existingReconnect = isPlainObject(existingClient?.reconnect) ? existingClient.reconnect : {};
  const existingTimeout =
    Number.isInteger(existingClient?.toolCallTimeoutMs) &&
    existingClient.toolCallTimeoutMs >= LIMITS.toolCallTimeoutMs.min &&
    existingClient.toolCallTimeoutMs <= LIMITS.toolCallTimeoutMs.max
      ? existingClient.toolCallTimeoutMs
      : LIMITS.toolCallTimeoutMs.default;
  const existingInstructionBytes =
    Number.isInteger(existingClient?.maxInstructionBytes) &&
    existingClient.maxInstructionBytes >= LIMITS.maxInstructionBytes.min &&
    existingClient.maxInstructionBytes <= LIMITS.maxInstructionBytes.max
      ? existingClient.maxInstructionBytes
      : LIMITS.maxInstructionBytes.default;
  const defaults = {
    enabled: typeof existingReconnect.enabled === 'boolean' ? existingReconnect.enabled : true,
    initialDelayMs:
      Number.isInteger(existingReconnect.initialDelayMs) &&
      existingReconnect.initialDelayMs >= LIMITS.reconnect.minDelayMs &&
      existingReconnect.initialDelayMs <= LIMITS.reconnect.maxDelayMs
        ? existingReconnect.initialDelayMs
        : LIMITS.reconnect.defaultInitialDelayMs,
    maxDelayMs:
      Number.isInteger(existingReconnect.maxDelayMs) &&
      existingReconnect.maxDelayMs >= LIMITS.reconnect.minDelayMs &&
      existingReconnect.maxDelayMs <= LIMITS.reconnect.maxDelayMs
        ? existingReconnect.maxDelayMs
        : LIMITS.reconnect.defaultMaxDelayMs,
    maxAttempts:
      Number.isInteger(existingReconnect.maxAttempts) &&
      existingReconnect.maxAttempts >= LIMITS.reconnect.minAttempts &&
      existingReconnect.maxAttempts <= LIMITS.reconnect.maxAttempts
        ? existingReconnect.maxAttempts
        : LIMITS.reconnect.defaultMaxAttempts,
  };
  const reconnect = normalizeReconnect(
    { enabled: draft.reconnectEnabled },
    undefined,
    defaults,
  );
  reconnect.maxAttempts = readInteger(
    draft.reconnectAttempts,
    defaults.maxAttempts,
    'RECONNECT_INVALID',
    'reconnectAttempts',
    LIMITS.reconnect.minAttempts,
    LIMITS.reconnect.maxAttempts,
  );
  return {
    toolCallTimeoutMs: readInteger(
      draft.timeoutMs,
      existingTimeout,
      'TIMEOUT_INVALID',
      'timeoutMs',
      LIMITS.toolCallTimeoutMs.min,
      LIMITS.toolCallTimeoutMs.max,
    ),
    reconnect,
    failOnStartupError: readBoolean(
      draft.failOnStartupError,
      typeof existingClient?.failOnStartupError === 'boolean'
        ? existingClient.failOnStartupError
        : false,
      'FIELD_UNKNOWN',
      'failOnStartupError',
    ),
    maxInstructionBytes: readInteger(
      draft.maxInstructionBytes,
      existingInstructionBytes,
      'MAX_INSTRUCTION_INVALID',
      'maxInstructionBytes',
      LIMITS.maxInstructionBytes.min,
      LIMITS.maxInstructionBytes.max,
    ),
  };
}

function buildClientTunables(raw) {
  const reconnect = normalizeReconnect(
    {},
    raw.reconnect,
    {
      initialDelayMs: LIMITS.reconnect.defaultInitialDelayMs,
      maxDelayMs: LIMITS.reconnect.defaultMaxDelayMs,
      maxAttempts: LIMITS.reconnect.defaultMaxAttempts,
    },
  );
  return {
    toolCallTimeoutMs: readInteger(
      raw.toolCallTimeoutMs,
      LIMITS.toolCallTimeoutMs.default,
      'TIMEOUT_INVALID',
      'toolCallTimeoutMs',
      LIMITS.toolCallTimeoutMs.min,
      LIMITS.toolCallTimeoutMs.max,
    ),
    reconnect,
    failOnStartupError: readBoolean(
      raw.failOnStartupError,
      false,
      'FIELD_UNKNOWN',
      'failOnStartupError',
    ),
    maxInstructionBytes: readInteger(
      raw.maxInstructionBytes,
      LIMITS.maxInstructionBytes.default,
      'MAX_INSTRUCTION_INVALID',
      'maxInstructionBytes',
      LIMITS.maxInstructionBytes.min,
      LIMITS.maxInstructionBytes.max,
    ),
  };
}

/** Convert a Map of env/header pairs into a plain own-property record. */
function toRecord(map) {
  return Object.fromEntries(map.entries());
}

/* ------------------------------------------------------------------------- */
/* Draft normalization                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Normalize the Form draft into an official client config.
 *
 * @param {unknown} draft
 * @param {{existingClient?: object, existingNames?: string[]}} [opts]
 * @returns {{client: object, allowPlainHttp: boolean, hasSecrets: boolean}}
 * @throws {ValidationError}
 */
export function normalizeDraft(draft, opts = {}) {
  const options = opts ?? {};
  if (!isPlainObject(draft)) throw new ValidationError('FIELD_UNKNOWN', 'draft');
  assertNoExpressions(draft);

  for (const key of Object.keys(draft)) {
    if (!DRAFT_FIELDS.has(key)) throw new ValidationError('FIELD_UNKNOWN', joinPath('', key));
  }

  const existingClient = isPlainObject(options.existingClient) ? options.existingClient : undefined;

  let serverName = draft.serverName;
  if ((serverName === undefined || serverName === null || serverName === '') && existingClient) {
    serverName = existingClient.serverName;
  }
  assertServerName(serverName);
  // `update` cannot rename a row; a mismatching name is always a bug or an
  // attempt to smuggle a second identity past the uniqueness check.
  if (
    existingClient &&
    typeof existingClient.serverName === 'string' &&
    draft.serverName !== undefined &&
    draft.serverName !== null &&
    draft.serverName !== '' &&
    draft.serverName !== existingClient.serverName
  ) {
    throw new ValidationError('NAME_INVALID', 'serverName');
  }

  const existingNamesOption = options.existingNames;
  if (existingNamesOption !== undefined && existingNamesOption !== null) {
    if (!Array.isArray(existingNamesOption) && !(existingNamesOption instanceof Set)) {
      throw new ValidationError('FIELD_UNKNOWN', 'existingNames');
    }
    const existingNames = [...existingNamesOption];
    const ownName = existingClient?.serverName;
    for (const name of existingNames) {
      if (typeof name !== 'string') throw new ValidationError('FIELD_UNKNOWN', 'existingNames');
      if (name !== ownName && name === serverName) {
        throw new ValidationError('NAME_CONFLICT', 'serverName');
      }
    }
    const isExistingRow = typeof ownName === 'string' && ownName === serverName;
    if (!isExistingRow && existingNames.length >= LIMITS.maxServers) {
      throw new ValidationError('TOO_MANY_SERVERS', 'serverName');
    }
  }

  const transport = draft.transport;
  if (transport !== 'stdio' && transport !== 'streamable-http') {
    throw new ValidationError('TRANSPORT_INVALID', 'transport');
  }

  let allowPlainHttp = false;
  if (draft.allowPlainHttp !== undefined && draft.allowPlainHttp !== null) {
    if (typeof draft.allowPlainHttp !== 'boolean') {
      throw new ValidationError('FIELD_UNKNOWN', 'allowPlainHttp');
    }
    allowPlainHttp = draft.allowPlainHttp;
  }

  /** @type {Record<string, unknown>} */
  const client = { serverName, transport };

  if (transport === 'stdio') {
    client.command = validateCommand(draft.command);

    let args = [];
    if (draft.argsText !== undefined && draft.argsText !== null) {
      if (typeof draft.argsText !== 'string') {
        throw new ValidationError('STDIO_ARGS_INVALID', 'argsText');
      }
      args = validateArgsArray(parseArgsText(draft.argsText));
    }
    if (args.length > 0) client.args = args;

    const cwd = validateCwd(draft.cwd);
    if (cwd !== undefined) client.cwd = cwd;

    const env = validateEnvEntries(draft.env, existingClient?.env);
    if (env.size > 0) client.env = toRecord(env);
  } else {
    client.url = checkHttpUrl(draft.url, { allowPlainHttp });
    const headers = validateHeaderEntries(draft.headers, existingClient?.headers);
    if (headers.size > 0) client.headers = toRecord(headers);
  }

  Object.assign(client, buildDraftTunables(draft, existingClient));

  const hasSecrets = scanSecrets(client).hasSecrets;
  return { client, allowPlainHttp, hasSecrets };
}

/* ------------------------------------------------------------------------- */
/* Official client config validation                                         */
/* ------------------------------------------------------------------------- */

/**
 * Validate and normalize the official client config shape. Optional empty
 * values are dropped; reconnect/timeout/instruction defaults are materialized
 * so the persisted canonical state is deterministic.
 *
 * @param {unknown} raw
 * @param {{allowPlainHttp?: boolean}} [opts]
 * @returns {object} normalized client config
 * @throws {ValidationError}
 */
export function validateClient(raw, opts = {}) {
  const options = opts ?? {};
  if (!isPlainObject(raw)) throw new ValidationError('FIELD_UNKNOWN', 'client');
  assertNoExpressions(raw);

  for (const key of Object.keys(raw)) {
    if (!CLIENT_FIELDS.has(key)) throw new ValidationError('FIELD_UNKNOWN', joinPath('', key));
  }

  const serverName = assertServerName(raw.serverName);
  const transport = raw.transport;
  if (transport !== 'stdio' && transport !== 'streamable-http') {
    throw new ValidationError('TRANSPORT_INVALID', 'transport');
  }

  // Transport conflicts are rejected rather than silently dropped: a config
  // mixing stdio and HTTP fields is ambiguous, and ambiguity is a security bug.
  const foreignFields = transport === 'stdio' ? HTTP_ONLY_FIELDS : STDIO_ONLY_FIELDS;
  for (const field of foreignFields) {
    if (hasOwn(raw, field)) throw new ValidationError('TRANSPORT_INVALID', field);
  }

  /** @type {Record<string, unknown>} */
  const client = { serverName, transport };

  if (transport === 'stdio') {
    client.command = validateCommand(raw.command);

    if (raw.args !== undefined && raw.args !== null) {
      const args = validateArgsArray(raw.args);
      if (args.length > 0) client.args = args;
    }

    const cwd = validateCwd(raw.cwd);
    if (cwd !== undefined) client.cwd = cwd;

    const env = validateEnvRecord(raw.env);
    if (env.size > 0) client.env = toRecord(env);
  } else {
    client.url = checkHttpUrl(raw.url, { allowPlainHttp: options.allowPlainHttp === true });
    const headers = validateHeaderRecord(raw.headers);
    if (headers.size > 0) client.headers = toRecord(headers);
  }

  Object.assign(client, buildClientTunables(raw));
  return client;
}
