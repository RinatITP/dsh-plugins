/**
 * Browser-safe projections for dsh-mcp-guard.
 *
 * The browser never receives env/header values, full argv, command arguments
 * or secret-looking strings. It receives names, counts, risk codes and
 * tool-name attribution only.
 */
import { basename } from 'node:path';
import { looksSecret } from './security.js';

const LEVEL_ORDER = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** Highest risk level in a list, or null. */
export function highestRiskLevel(risk) {
  let best = null;
  for (const item of risk ?? []) {
    const level = item?.level;
    if (!(level in LEVEL_ORDER)) continue;
    if (best === null || LEVEL_ORDER[level] > LEVEL_ORDER[best]) best = level;
  }
  return best;
}

/** True when the list contains `high` or `critical`. */
export function requiresAcknowledgement(risk) {
  const level = highestRiskLevel(risk);
  return level === 'high' || level === 'critical';
}

/** True when any env/header value or argv item looks like a credential. */
export function clientHasSecrets(client) {
  if (!client || typeof client !== 'object') return false;
  for (const [key, value] of Object.entries(client.env ?? {})) {
    if (looksSecret(key, value)) return true;
  }
  for (const [key, value] of Object.entries(client.headers ?? {})) {
    if (looksSecret(key, value)) return true;
  }
  for (const arg of client.args ?? []) {
    if (looksSecret('', arg)) return true;
  }
  if (typeof client.url === 'string' && looksSecret('', client.url)) return true;
  return false;
}

/** Safe display endpoint: command basename for stdio, URL origin for HTTP. */
export function safeEndpoint(client) {
  if (!client || typeof client !== 'object') return null;
  if (client.transport === 'stdio') {
    if (typeof client.command !== 'string' || !client.command) return null;
    return basename(client.command);
  }
  if (client.transport === 'streamable-http') {
    if (typeof client.url !== 'string') return null;
    try {
      const url = new URL(client.url);
      return url.origin;
    } catch {
      return null;
    }
  }
  return null;
}

/** Sorted keys of a string map (values are never projected). */
export function keysOf(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return [];
  return Object.keys(map).sort();
}

/**
 * One managed server row for the settings list.
 * @param {{ enabled?: boolean, client?: object, allowPlainHttp?: boolean }} row
 * @param {{ tools?: string[], lastCheck?: object|null, risk?: object[] }} extra
 */
export function projectServer(row, { tools = [], lastCheck = null, risk = [] } = {}) {
  const client = row?.client && typeof row.client === 'object' ? row.client : {};
  return {
    serverName: typeof client.serverName === 'string' ? client.serverName : '',
    transport: client.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    enabled: row?.enabled === true,
    source: 'managed',
    endpoint: safeEndpoint(client),
    argumentCount: Array.isArray(client.args) ? client.args.length : 0,
    envKeys: keysOf(client.env),
    headerKeys: keysOf(client.headers),
    hasSecrets: clientHasSecrets(client),
    allowPlainHttp: row?.allowPlainHttp === true,
    toolCount: tools.length,
    tools: [...tools].sort(),
    risk: Array.isArray(risk) ? risk : [],
    highestRisk: highestRiskLevel(risk),
    timeoutMs: typeof client.toolCallTimeoutMs === 'number' ? client.toolCallTimeoutMs : 60000,
    reconnect: {
      enabled: client.reconnect?.enabled !== false,
      maxAttempts: typeof client.reconnect?.maxAttempts === 'number' ? client.reconnect.maxAttempts : 10,
    },
    failOnStartupError: client.failOnStartupError === true,
    maxInstructionBytes: typeof client.maxInstructionBytes === 'number' ? client.maxInstructionBytes : 32768,
    lastCheck: lastCheck && typeof lastCheck === 'object' ? lastCheck : null,
  };
}

/** One read-only external MCP row (owned by another plugin or the user). */
export function projectExternal(entry) {
  const config = entry?.options?.config ?? {};
  const name = typeof config.serverName === 'string' ? config.serverName : null;
  return {
    serverName: name ?? '(unresolved)',
    transport: config.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
    enabled: entry?.options?.disabled !== true,
    source: 'external',
  };
}

/**
 * Attribute `mcp__<server>__<tool>` schemas to known server names. Longest
 * matching name wins so `foo__bar` is not misread as server `foo`.
 */
export function projectToolMap(schemas, knownNames) {
  const names = [...new Set((knownNames ?? []).filter((name) => typeof name === 'string' && name))]
    .sort((a, b) => b.length - a.length);
  const byServer = {};
  let total = 0;
  for (const schema of schemas ?? []) {
    const name = schema?.name;
    if (typeof name !== 'string' || !name.startsWith('mcp__')) continue;
    total += 1;
    const owner = names.find((serverName) => name.startsWith(`mcp__${serverName}__`));
    if (!owner) continue;
    (byServer[owner] ??= []).push(name);
  }
  return { total, byServer };
}

/** Remove env/header values from a client config for exported JSON. */
export function redactClient(client) {
  const copy = structuredClone(client ?? {});
  if (copy.env && typeof copy.env === 'object') {
    copy.env = Object.fromEntries(Object.keys(copy.env).map((key) => [key, `\${${key}}`]));
  }
  if (copy.headers && typeof copy.headers === 'object') {
    copy.headers = Object.fromEntries(Object.keys(copy.headers).map((key) => [key, `\${${key}}`]));
  }
  return copy;
}
