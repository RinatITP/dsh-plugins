/**
 * Persisted-state helpers for dsh-mcp-guard.
 *
 * The plugin's whole configuration lives in its own Loader row
 * (`config.servers`), persisted by the official configEditor. This module
 * keeps reading tolerant (a damaged row must not take the settings page down)
 * and keeps writes minimal.
 */
import { createHash } from 'node:crypto';

export const MAX_SERVERS = 100;
export const MAX_BODY_BYTES = 1024 * 1024;

/** Raw `servers` array from a plugin config object (always an array). */
export function rawServers(rawConfig) {
  const value = rawConfig?.servers;
  return Array.isArray(value) ? value : [];
}

/** Stable revision over the raw managed rows. */
export function revisionOf(rawConfig) {
  return createHash('sha256').update(JSON.stringify({ servers: rawServers(rawConfig) })).digest('hex');
}

/**
 * Lenient read of managed rows for projection. Invalid rows are kept with
 * `invalid: true` so the settings page can show them instead of failing.
 */
export function readRows(rawConfig) {
  const rows = [];
  for (const row of rawServers(rawConfig)) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      rows.push({ enabled: false, client: null, allowPlainHttp: false, invalid: true });
      continue;
    }
    const client = row.client && typeof row.client === 'object' && !Array.isArray(row.client) ? row.client : null;
    rows.push({
      enabled: row.enabled === true,
      client,
      allowPlainHttp: row.allowPlainHttp === true,
      invalid: client === null,
      original: row,
    });
  }
  return rows;
}

/** Stored row for one normalized server config (disabled by default). */
export function storedRow(client, allowPlainHttp = false) {
  const row = { enabled: false, client };
  if (allowPlainHttp) row.allowPlainHttp = true;
  return row;
}

/** Replace/append a stored row by server name. */
export function upsertRow(rows, row) {
  const serverName = row?.client?.serverName;
  const index = rows.findIndex((item) => item?.client?.serverName === serverName);
  if (index === -1) return [...rows, row];
  const next = rows.slice();
  next[index] = row;
  return next;
}

/** Names of managed rows (valid ones only). */
export function managedNames(rows) {
  const names = new Set();
  for (const row of rows) {
    if (typeof row?.client?.serverName === 'string') names.add(row.client.serverName);
  }
  return names;
}

/**
 * External MCP row identities currently declared in the profile. Includes
 * disabled rows because a disabled namespace still reserves its name.
 */
export function projectExternalRows(entries) {
  const result = [];
  for (const entry of entries ?? []) {
    if (entry?.options?.name !== '@deepseek-ai/dsh-mcp-client') continue;
    const config = entry.options.config ?? {};
    const serverName = typeof config.serverName === 'string' ? config.serverName : null;
    result.push({
      serverName,
      transport: config.transport === 'streamable-http' ? 'streamable-http' : 'stdio',
      enabled: entry.options.disabled !== true,
    });
  }
  return result;
}
