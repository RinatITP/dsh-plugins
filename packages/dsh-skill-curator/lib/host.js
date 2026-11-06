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

  const catalog = createCatalog({
    config: readConfig,
    projectRoots: () => {
      const configured = readConfig().projectRoots;
      return Array.isArray(configured) ? configured : [];
    },
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
