/**
 * Host half of dsh-mcp-guard.
 *
 * Responsibilities:
 *  - serve the loopback management API used by the settings page;
 *  - persist the managed server list through the official configEditor
 *    (never by rewriting the profile patch by hand);
 *  - mount every enabled server as a child plugin of the official
 *    `@deepseek-ai/dsh-mcp-client` (connection, reconnect, tool registration
 *    and teardown stay owned by the official client).
 */
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ManagerError } from './errors.js';
import { createManager } from './manager.js';
import { createHandler, ROUTE } from './http.js';
import { externalRowClient, projectExternalRows, readRows } from './config.js';
import { scanSources } from './discovery.js';

export const name = 'dsh-mcp-guard';

/** Required Host services; the plugin stays inactive without them. */
export const inject = ['webServer', 'configEditor', 'connection'];

/** Services that are nice to have but not required for the management plane. */
function optional(ctx, serviceName) {
  try {
    return ctx.get(serviceName);
  } catch {
    return undefined;
  }
}

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export async function apply(ctx) {
  const editor = ctx.configEditor;
  // `ctx.fiber.entry` is the Loader entry this fiber runs; the entry wrappers
  // returned by `editor.entries()` are not identity-equal to it on every host
  // version, so fall back to the fiber uid when the direct reference is absent.
  const ownEntry = () => {
    const direct = ctx.fiber?.entry;
    if (direct?.options) return direct;
    const uid = ctx.fiber?.uid;
    return editor
      .entries()
      .find((entry) => entry.fiber === ctx.fiber || (uid !== undefined && entry.fiber?.uid === uid));
  };

  const readRaw = () => {
    const entry = ownEntry();
    if (!entry) throw new ManagerError('CONFIGURATION_UNAVAILABLE', 503);
    return structuredClone(entry.options.config ?? {});
  };

  const editRaw = (change) => {
    const entry = ownEntry();
    if (!entry) return Promise.reject(new ManagerError('CONFIGURATION_UNAVAILABLE', 503));
    return editor.edit(entry, (current) => change(current));
  };

  const external = () => projectExternalRows(editor.entries());

  const externalClient = (patchId) => externalRowClient(editor.entries(), patchId);

  /** Disable/enable an external MCP row through the official plugin manager. */
  const setExternalEnabled = async (patchId, enabled) => {
    const manager = optional(ctx, 'pluginManager');
    if (!manager || typeof manager.listPlugins !== 'function' || typeof manager.setPluginEnabled !== 'function') {
      throw new ManagerError('EXTERNAL_UNAVAILABLE', 503);
    }
    const plugins = await manager.listPlugins();
    const info = (plugins ?? []).find(
      (plugin) => plugin?.moduleName === '@deepseek-ai/dsh-mcp-client'
        && (plugin.patchId === patchId || String(plugin.entryId ?? '') === `include:${patchId}`),
    );
    if (!info) throw new ManagerError('EXTERNAL_UNAVAILABLE', 404);
    const result = await manager.setPluginEnabled(info.entryId, enabled);
    if (result?.application !== 'applied') throw new ManagerError('EXTERNAL_DISABLE_FAILED', 500);
  };

  /** Read-only scan of well-known MCP configuration files on this computer. */
  const discover = async () => {
    const home = process.env.HOME || homedir();
    const dshHome = process.env.DSH_HOME || join(home, '.dsh');
    const workspaces = [];
    const registry = optional(ctx, 'workspaceRegistry');
    if (registry && typeof registry.list === 'function') {
      try {
        for (const workspace of registry.list() ?? []) {
          const candidate = workspace?.path ?? workspace?.directory ?? workspace?.root ?? workspace?.dir ?? workspace?.cwd;
          if (typeof candidate === 'string' && candidate !== '') workspaces.push(candidate);
        }
      } catch {
        // A workspace-registry error only narrows discovery; never fail the scan.
      }
    }
    if (workspaces.length === 0) {
      try {
        workspaces.push(process.cwd());
      } catch {
        // Ignore; no workspace candidates.
      }
    }
    return scanSources({ home, dshHome, workspaces });
  };
  const toolSchemas = () => {
    const tools = optional(ctx, 'tools');
    if (!tools || typeof tools.schemas !== 'function') return [];
    try {
      return tools.schemas();
    } catch {
      return [];
    }
  };

  const checkConnection = async (serverName) => {
    const tools = optional(ctx, 'tools');
    if (!tools || typeof tools.execute !== 'function') {
      throw new ManagerError('CHECK_UNAVAILABLE', 503);
    }
    const result = await tools.execute({
      calls: [
        {
          type: 'tool-call',
          id: randomUUID(),
          name: 'list_mcp_resources',
          arguments: JSON.stringify({ server: serverName }),
        },
      ],
      signal: AbortSignal.timeout(10000),
    });
    const outcome = result?.results?.[0]?.result;
    return outcome?.isError === false;
  };

  let officialClient = null;
  try {
    officialClient = await import('@deepseek-ai/dsh-mcp-client');
  } catch {
    ctx.logger?.warn?.('dsh-mcp-guard: @deepseek-ai/dsh-mcp-client is unavailable; management is read-only for connections');
  }

  const manager = createManager({
    readRaw,
    editRaw,
    external,
    externalClient,
    setExternalEnabled,
    discover,
    toolSchemas,
    checkConnection,
    officialClient: officialClient !== null,
    profileName: process.env.DSH_PROFILE ?? null,
  });

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE,
      handler: createHandler({
        manager,
        admit: (req) => ctx.connection.admit(req),
        log: (code) => ctx.logger?.warn?.(`dsh-mcp-guard: ${code}`),
      }),
    }),
  );

  if (officialClient === null) return;

  // Mount enabled servers. Children are spawned in the background: a dead
  // server must not delay the settings page (the official client owns its own
  // connection timeout and reconnect policy).
  let rows;
  try {
    rows = readRows(readRaw());
  } catch (error) {
    if (error instanceof ManagerError) return;
    throw error;
  }
  const externalNames = new Set(external().map((row) => row.serverName).filter(Boolean));
  for (const row of rows) {
    if (!row.enabled || row.invalid || !row.client) continue;
    const client = row.client;
    if (typeof client.serverName !== 'string') continue;
    if (externalNames.has(client.serverName)) {
      ctx.logger?.warn?.(`dsh-mcp-guard: skipped "${client.serverName}" because another MCP entry already uses that name`);
      continue;
    }
    try {
      const fiber = ctx.plugin(officialClient, { ...client, failOnStartupError: false });
      Promise.resolve(fiber).catch(() => {
        ctx.logger?.warn?.(`dsh-mcp-guard: MCP server "${client.serverName}" failed to activate`);
      });
    } catch {
      ctx.logger?.warn?.(`dsh-mcp-guard: MCP server "${client.serverName}" could not be mounted`);
    }
  }
}
