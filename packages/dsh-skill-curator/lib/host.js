/**
 * Host half of dsh-skill-curator.
 *
 * Responsibilities (stage 1):
 *  - serve one authenticated loopback route used by the settings page;
 *  - scan the known skill roots read-only and return a bounded snapshot;
 *  - serve one SKILL.md detail and traversal-safe resource reads.
 *
 * No file is written by this stage. Write/import actions arrive only after the
 * documented confirmation policy is implemented.
 */
import { createCatalog } from './catalog.js';
import { createHandler, ROUTE } from './http.js';

export const name = 'dsh-skill-curator';

/** Required Host services; the plugin stays inactive without them. */
export const inject = ['webServer', 'connection'];

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export async function apply(ctx) {
  const readConfig = () => {
    const entry = ctx.fiber?.entry;
    const config = entry?.options?.config;
    return config !== null && typeof config === 'object' && !Array.isArray(config) ? config : {};
  };

  const log = (code) => {
    try {
      ctx.logger?.debug?.(`[dsh-skill-curator] ${code}`);
    } catch {
      // Diagnostics are best-effort and value-free.
    }
  };

  const projectRoots = () => {
    const roots = new Map();
    const add = (value, label) => {
      if (typeof value !== 'string' || value.trim() === '') return;
      const path = value.trim();
      if (!roots.has(path)) {
        roots.set(path, { path, ...(typeof label === 'string' && label !== '' ? { label } : {}) });
      }
    };
    const config = readConfig();
    if (Array.isArray(config.projectRoots)) {
      for (const item of config.projectRoots) {
        if (item !== null && typeof item === 'object') add(item.path, item.label);
        else add(item);
      }
    }
    try {
      const registry = typeof ctx.get === 'function' ? ctx.get('workspaceRegistry') : undefined;
      if (registry && typeof registry.list === 'function') {
        for (const item of registry.list() ?? []) add(item?.path ?? item?.cwd, item?.name);
      }
    } catch {
      // Workspace registry is optional.
    }
    try {
      const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined;
      if (sessions && typeof sessions.list === 'function') {
        for (const session of sessions.list() ?? []) {
          add(session?.header?.cwd, session?.header?.title ?? session?.title);
        }
      }
    } catch {
      // Sessions are optional; they only widen project-root discovery.
    }
    return [...roots.values()].slice(0, 12);
  };

  const catalog = createCatalog({
    config: readConfig,
    projectRoots,
    log,
  });

  const handler = createHandler({
    manager: catalog,
    admit: (req) => ctx.connection.admit(req),
    log,
  });

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }),
    'dsh-skill-curator: catalog route',
  );
}
