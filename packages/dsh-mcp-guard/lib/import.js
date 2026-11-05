/**
 * dsh-mcp-guard — strict `mcpServers` JSON import and redacted export.
 *
 * Import is fail-loud and preview-only: it never launches a command, never
 * connects and never expands an expression. A single malformed server rejects
 * the whole document (no silent partial imports), every failure carries a
 * stable `ImportError.code`, and no raw JSON / field value is ever echoed.
 */

import {
  ENV_KEY_RE,
  HEADER_NAME_RE,
  LIMITS,
  SERVER_NAME_RE,
  UNSAFE_OBJECT_KEYS,
  byteLength,
  hasOwn,
  isPlainObject,
  sanitizePathSegment,
} from './security.js';
import { validateClient } from './validate.js';

/** Fixed, value-free messages. Never interpolate caller data here. */
const IMPORT_MESSAGES = Object.freeze({
  IMPORT_INPUT_INVALID: 'Import input must be a JSON string.',
  IMPORT_TOO_LARGE: 'Import exceeds the 1 MiB limit.',
  IMPORT_JSON_INVALID: 'Import must contain valid JSON.',
  IMPORT_UNSAFE_KEY: 'Import contains a prohibited object key.',
  IMPORT_DUPLICATE_KEY: 'Import contains a duplicate object key.',
  IMPORT_SHAPE: 'Import must contain exactly one mcpServers object.',
  IMPORT_TOO_MANY_SERVERS: 'Import exceeds the 100 server limit.',
  IMPORT_NAME_INVALID: 'Server names must be 1-32 letters, digits, underscores or hyphens.',
  IMPORT_NAME_CONFLICT: 'An imported server name already exists.',
  IMPORT_SERVER_INVALID: 'Each server entry must be a JSON object.',
  IMPORT_UNKNOWN_FIELD: 'Import contains a field that is not supported.',
  IMPORT_TYPE_INVALID: 'Server type is unsupported or cannot be inferred.',
  IMPORT_TRANSPORT_CONFLICT: 'stdio and HTTP fields cannot be combined.',
  IMPORT_URL_INVALID: 'HTTP servers require a valid HTTP(S) URL.',
  IMPORT_COMMAND_INVALID: 'stdio servers require a single non-empty command.',
  IMPORT_ARGS_INVALID: 'Arguments must be an array of strings.',
  IMPORT_ENV_INVALID: 'Environment must map names to string values.',
  IMPORT_HEADERS_INVALID: 'Headers must map valid header names to string values.',
  IMPORT_CWD_INVALID: 'Working directory must be a non-empty absolute path.',
});

/**
 * Import failure with a stable contract code. The message is a fixed constant
 * and `.path` is a sanitized field path; neither contains a value.
 */
export class ImportError extends Error {
  /**
   * @param {string} code Stable `IMPORT_*` contract code.
   * @param {string} [path] Sanitized field path.
   */
  constructor(code, path = '') {
    const safeCode = hasOwn(IMPORT_MESSAGES, code) ? code : 'IMPORT_INPUT_INVALID';
    const safePath =
      typeof path === 'string' && path !== ''
        ? path.replace(/[^A-Za-z0-9_.\[\]-]/g, '?').slice(0, 200)
        : '';
    super(safePath ? `${safeCode} at ${safePath}` : safeCode);
    this.name = 'ImportError';
    this.code = safeCode;
    this.path = safePath;
  }
}

/** Import field allowlist for one `mcpServers` entry. */
const IMPORT_FIELDS = new Set(['type', 'url', 'headers', 'command', 'args', 'env', 'cwd']);
const STDIO_FIELDS = Object.freeze(['command', 'args', 'env', 'cwd']);
const HTTP_FIELDS = Object.freeze(['url', 'headers']);
const TYPE_VALUES = Object.freeze({
  stdio: 'stdio',
  http: 'streamable-http',
  'streamable-http': 'streamable-http',
});

const VALIDATION_IMPORT_CODES = Object.freeze({
  NAME_INVALID: 'IMPORT_NAME_INVALID',
  NAME_CONFLICT: 'IMPORT_NAME_CONFLICT',
  TRANSPORT_INVALID: 'IMPORT_TYPE_INVALID',
  STDIO_COMMAND_REQUIRED: 'IMPORT_COMMAND_INVALID',
  STDIO_COMMAND_INVALID: 'IMPORT_COMMAND_INVALID',
  STDIO_ARGS_INVALID: 'IMPORT_ARGS_INVALID',
  STDIO_CWD_INVALID: 'IMPORT_CWD_INVALID',
  STDIO_ENV_INVALID: 'IMPORT_ENV_INVALID',
  ENV_EXECUTION_OVERRIDE: 'IMPORT_ENV_INVALID',
  TOO_MANY_ENV: 'IMPORT_ENV_INVALID',
  HTTP_URL_REQUIRED: 'IMPORT_URL_INVALID',
  HTTP_URL_INVALID: 'IMPORT_URL_INVALID',
  HTTP_PLAINTEXT_BLOCKED: 'IMPORT_URL_INVALID',
  HTTP_HEADERS_INVALID: 'IMPORT_HEADERS_INVALID',
  TOO_MANY_HEADERS: 'IMPORT_HEADERS_INVALID',
  FIELD_UNKNOWN: 'IMPORT_UNKNOWN_FIELD',
  EXPRESSION_UNSUPPORTED: 'IMPORT_SERVER_INVALID',
  TIMEOUT_INVALID: 'IMPORT_SERVER_INVALID',
  RECONNECT_INVALID: 'IMPORT_SERVER_INVALID',
  MAX_INSTRUCTION_INVALID: 'IMPORT_SERVER_INVALID',
});

function codeForValidationError(error) {
  if (!isPlainObject(error) || typeof error.code !== 'string') return 'IMPORT_SERVER_INVALID';
  const mapped = VALIDATION_IMPORT_CODES[error.code];
  if (mapped) return mapped;
  if (error.code === 'VALUE_TOO_LONG') {
    const path = typeof error.path === 'string' ? error.path : '';
    if (path.startsWith('env')) return 'IMPORT_ENV_INVALID';
    if (path.startsWith('headers')) return 'IMPORT_HEADERS_INVALID';
    if (path.startsWith('args')) return 'IMPORT_ARGS_INVALID';
    if (path.startsWith('command')) return 'IMPORT_COMMAND_INVALID';
  }
  return 'IMPORT_SERVER_INVALID';
}

function joinPath(path, key) {
  const segment = sanitizePathSegment(key);
  return path === '' ? segment : `${path}.${segment}`;
}

/**
 * Token-level scan of valid JSON text. `JSON.parse` silently keeps the last
 * duplicate member, so this separate pass walks the token stream and rejects:
 * - duplicate object keys at any depth (`IMPORT_DUPLICATE_KEY`),
 * - `__proto__` / `prototype` / `constructor` keys at any depth
 *   (`IMPORT_UNSAFE_KEY`), before any value is ever materialized.
 *
 * The scan is iterative and linear: no recursion limit, no catastrophic regex.
 *
 * @param {string} text Valid JSON text (already accepted by `JSON.parse`).
 */
function scanJsonTokens(text) {
  /** @type {Array<Set<string>|null>} */
  const stack = [];
  let index = 0;
  const length = text.length;
  while (index < length) {
    const code = text.charCodeAt(index);
    if (code === 34 /* '"' */) {
      const start = index;
      index += 1;
      while (index < length) {
        const inner = text.charCodeAt(index);
        if (inner === 92 /* '\\' */) {
          index += 2;
          continue;
        }
        index += 1;
        if (inner === 34) break;
      }
      const tokenEnd = index;
      let probe = tokenEnd;
      while (probe < length) {
        const next = text.charCodeAt(probe);
        if (next === 32 || next === 9 || next === 10 || next === 13) probe += 1;
        else break;
      }
      if (text.charCodeAt(probe) === 58 /* ':' */) {
        const key = JSON.parse(text.slice(start, tokenEnd));
        if (UNSAFE_OBJECT_KEYS.includes(key)) throw new ImportError('IMPORT_UNSAFE_KEY');
        const keys = stack[stack.length - 1];
        if (keys) {
          if (keys.has(key)) throw new ImportError('IMPORT_DUPLICATE_KEY');
          keys.add(key);
        }
      }
      continue;
    }
    if (code === 123 /* '{' */) {
      stack.push(new Set());
      index += 1;
      continue;
    }
    if (code === 91 /* '[' */) {
      stack.push(null);
      index += 1;
      continue;
    }
    if (code === 125 /* '}' */ || code === 93 /* ']' */) {
      stack.pop();
      index += 1;
      continue;
    }
    index += 1;
  }
}

function readExistingNames(existingNames) {
  if (existingNames === undefined || existingNames === null) return [];
  if (!Array.isArray(existingNames)) throw new ImportError('IMPORT_INPUT_INVALID');
  const names = [];
  for (const name of existingNames) {
    if (typeof name !== 'string') throw new ImportError('IMPORT_INPUT_INVALID');
    names.push(name);
  }
  return names;
}

/** Build the official-shape raw client for one imported entry, fail-loud. */
function serverToRawClient(serverName, source, basePath) {
  if (!isPlainObject(source)) throw new ImportError('IMPORT_SERVER_INVALID', basePath);

  for (const key of Object.keys(source)) {
    if (!IMPORT_FIELDS.has(key)) {
      throw new ImportError('IMPORT_UNKNOWN_FIELD', joinPath(basePath, key));
    }
  }

  const hasStdio = STDIO_FIELDS.some((field) => hasOwn(source, field));
  const hasHttp = HTTP_FIELDS.some((field) => hasOwn(source, field));

  let transport;
  if (hasOwn(source, 'type')) {
    const declared = source.type;
    if (typeof declared !== 'string' || !hasOwn(TYPE_VALUES, declared)) {
      throw new ImportError('IMPORT_TYPE_INVALID', joinPath(basePath, 'type'));
    }
    transport = TYPE_VALUES[declared];
    if (transport === 'stdio' && hasHttp) {
      throw new ImportError('IMPORT_TRANSPORT_CONFLICT', basePath);
    }
    if (transport !== 'stdio' && hasStdio) {
      throw new ImportError('IMPORT_TRANSPORT_CONFLICT', basePath);
    }
  } else if (hasStdio && hasHttp) {
    throw new ImportError('IMPORT_TRANSPORT_CONFLICT', basePath);
  } else if (hasStdio) {
    transport = 'stdio';
  } else if (hasHttp) {
    transport = 'streamable-http';
  } else {
    throw new ImportError('IMPORT_TYPE_INVALID', basePath);
  }

  /** @type {Record<string, unknown>} */
  const raw = { serverName, transport };

  if (transport === 'stdio') {
    if (!hasOwn(source, 'command') || typeof source.command !== 'string') {
      throw new ImportError('IMPORT_COMMAND_INVALID', joinPath(basePath, 'command'));
    }
    const command = source.command;
    if (command.trim() === '' || /[\u0000\r\n]/.test(command)) {
      throw new ImportError('IMPORT_COMMAND_INVALID', joinPath(basePath, 'command'));
    }
    // A pasted command line ("npx -y pkg") is a configuration bug: argv must
    // be split by the user, never by us. Reject only the unambiguous case.
    if (!hasOwn(source, 'args') && /\s/.test(command.trim())) {
      throw new ImportError('IMPORT_COMMAND_INVALID', joinPath(basePath, 'command'));
    }
    raw.command = command;

    if (hasOwn(source, 'args')) {
      if (!Array.isArray(source.args)) {
        throw new ImportError('IMPORT_ARGS_INVALID', joinPath(basePath, 'args'));
      }
      raw.args = [...source.args];
    }
    if (hasOwn(source, 'env')) {
      if (!isPlainObject(source.env)) {
        throw new ImportError('IMPORT_ENV_INVALID', joinPath(basePath, 'env'));
      }
      raw.env = Object.fromEntries(Object.entries(source.env));
    }
    if (hasOwn(source, 'cwd')) {
      if (typeof source.cwd !== 'string' || source.cwd === '') {
        throw new ImportError('IMPORT_CWD_INVALID', joinPath(basePath, 'cwd'));
      }
      raw.cwd = source.cwd;
    }
    return raw;
  }

  if (!hasOwn(source, 'url') || typeof source.url !== 'string' || source.url === '') {
    throw new ImportError('IMPORT_URL_INVALID', joinPath(basePath, 'url'));
  }
  raw.url = source.url;
  if (hasOwn(source, 'headers')) {
    if (!isPlainObject(source.headers)) {
      throw new ImportError('IMPORT_HEADERS_INVALID', joinPath(basePath, 'headers'));
    }
    raw.headers = Object.fromEntries(Object.entries(source.headers));
  }
  return raw;
}

/**
 * Strictly parse an `mcpServers` JSON document into normalized client configs.
 *
 * @param {unknown} text Raw JSON text from the import modal.
 * @param {string[]} [existingNames] Names already used by managed/external servers.
 * @returns {{servers: object[], count: number}}
 * @throws {ImportError}
 */
export function parseImport(text, existingNames = []) {
  if (typeof text !== 'string') throw new ImportError('IMPORT_INPUT_INVALID');
  if (text.length > LIMITS.maxBodyBytes || byteLength(text) > LIMITS.maxBodyBytes) {
    throw new ImportError('IMPORT_TOO_LARGE');
  }
  const occupiedNames = readExistingNames(existingNames);

  /** @type {unknown} */
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    throw new ImportError('IMPORT_JSON_INVALID');
  }

  scanJsonTokens(text);

  if (
    !isPlainObject(root) ||
    Object.keys(root).length !== 1 ||
    !hasOwn(root, 'mcpServers') ||
    !isPlainObject(root.mcpServers)
  ) {
    throw new ImportError('IMPORT_SHAPE');
  }

  const entries = Object.entries(root.mcpServers);
  if (entries.length > LIMITS.maxServers) throw new ImportError('IMPORT_TOO_MANY_SERVERS');

  const occupied = new Set(occupiedNames);
  /** @type {object[]} */
  const servers = [];
  for (const [serverName, source] of entries) {
    const basePath = joinPath('mcpServers', serverName);
    if (!SERVER_NAME_RE.test(serverName)) throw new ImportError('IMPORT_NAME_INVALID', basePath);
    if (occupied.has(serverName)) throw new ImportError('IMPORT_NAME_CONFLICT', basePath);
    occupied.add(serverName);

    const raw = serverToRawClient(serverName, source, basePath);
    try {
      servers.push(validateClient(raw, { allowPlainHttp: false }));
    } catch (error) {
      const code = codeForValidationError(error);
      const path = typeof error?.path === 'string' && error.path !== '' ? `${basePath}.${error.path}` : basePath;
      throw new ImportError(code, path);
    }
  }
  return { servers, count: servers.length };
}

/* ------------------------------------------------------------------------- */
/* Export                                                                    */
/* ------------------------------------------------------------------------- */

/** Redacted placeholder for a stored env/header value. */
function placeholderFor(key) {
  return `\${${key}}`;
}

function maskRecord(record, keyPattern) {
  const pairs = [];
  for (const key of Object.keys(record)) {
    if (typeof key !== 'string' || !keyPattern.test(key)) continue;
    pairs.push([key, placeholderFor(key)]);
  }
  return Object.fromEntries(pairs);
}

/**
 * Export managed rows as an importable `mcpServers` document.
 *
 * Env and header values are removed and replaced by `"${KEY}"` placeholders
 * (plus a `redacted: true` marker for the caller's UI). This is a
 * backup/migration aid, explicitly not a secret backup.
 *
 * @param {Array<{client: object, allowPlainHttp?: boolean}>} rows
 * @returns {{json: string, redacted: true}}
 */
export function exportServers(rows) {
  if (!Array.isArray(rows)) throw new ImportError('IMPORT_INPUT_INVALID');
  /** @type {Record<string, object>} */
  const mcpServers = {};
  for (const row of rows) {
    if (!isPlainObject(row) || !isPlainObject(row.client)) {
      throw new ImportError('IMPORT_SERVER_INVALID');
    }
    const client = row.client;
    if (typeof client.serverName !== 'string' || !SERVER_NAME_RE.test(client.serverName)) {
      throw new ImportError('IMPORT_NAME_INVALID');
    }
    if (hasOwn(mcpServers, client.serverName)) throw new ImportError('IMPORT_DUPLICATE_KEY');

    /** @type {Record<string, unknown>} */
    const entry = {};
    if (client.transport === 'stdio') {
      if (typeof client.command !== 'string' || client.command === '') {
        throw new ImportError('IMPORT_COMMAND_INVALID');
      }
      entry.type = 'stdio';
      entry.command = client.command;
      if (Array.isArray(client.args) && client.args.length > 0) entry.args = [...client.args];
      if (isPlainObject(client.env) && Object.keys(client.env).length > 0) {
        entry.env = maskRecord(client.env, ENV_KEY_RE);
      }
      if (typeof client.cwd === 'string' && client.cwd !== '') entry.cwd = client.cwd;
    } else if (client.transport === 'streamable-http') {
      if (typeof client.url !== 'string' || client.url === '') {
        throw new ImportError('IMPORT_URL_INVALID');
      }
      entry.type = 'streamable-http';
      entry.url = client.url;
      if (isPlainObject(client.headers) && Object.keys(client.headers).length > 0) {
        entry.headers = maskRecord(client.headers, HEADER_NAME_RE);
      }
    } else {
      throw new ImportError('IMPORT_TYPE_INVALID');
    }
    mcpServers[client.serverName] = entry;
  }
  const json = `${JSON.stringify({ mcpServers }, null, 2)}\n`;
  return { json, redacted: true };
}

/* ------------------------------------------------------------------------- */
/* JSON-tab projection                                                       */
/* ------------------------------------------------------------------------- */

/**
 * Project a stored client back to an `mcpServers` entry for the JSON tab.
 * Values are write-only: env/header values are masked as empty strings and
 * only their key names are shown. Returns `null` for a non-client value.
 *
 * @param {unknown} client
 * @returns {object|null}
 */
export function clientToEntry(client) {
  if (!isPlainObject(client) || typeof client.serverName !== 'string') return null;
  /** @type {Record<string, unknown>} */
  const entry = {};
  if (client.transport === 'stdio') {
    entry.type = 'stdio';
    if (typeof client.command === 'string') entry.command = client.command;
    if (Array.isArray(client.args) && client.args.length > 0) entry.args = [...client.args];
    if (isPlainObject(client.env) && Object.keys(client.env).length > 0) {
      entry.env = Object.fromEntries(
        Object.keys(client.env)
          .filter((key) => ENV_KEY_RE.test(key))
          .map((key) => [key, '']),
      );
    }
    if (typeof client.cwd === 'string' && client.cwd !== '') entry.cwd = client.cwd;
    return entry;
  }
  if (client.transport === 'streamable-http') {
    entry.type = 'streamable-http';
    if (typeof client.url === 'string') entry.url = client.url;
    if (isPlainObject(client.headers) && Object.keys(client.headers).length > 0) {
      entry.headers = Object.fromEntries(
        Object.keys(client.headers)
          .filter((key) => HEADER_NAME_RE.test(key))
          .map((key) => [key, '']),
      );
    }
    return entry;
  }
  return null;
}
