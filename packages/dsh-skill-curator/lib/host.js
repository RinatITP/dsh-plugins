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
import { installLiveProvider } from './live.js';
import { readSettings } from './settings.js';
import { skillCuratorHome } from './state.js';

export const name = 'dsh-skill-curator';

/** Required Host services; the plugin stays inactive without them. */
export const inject = ['webServer', 'connection', 'skills'];

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

  const liveRef = { invalidate: () => {} };
  const settingsLoader = () => readSettings(skillCuratorHome({ config: readConfig() }));
  let catalog;
  catalog = createCatalog({
    config: readConfig,
    projectRoots,
    log,
    onLiveChanged: () => liveRef.invalidate(),
  });
  const liveCatalog = (force) => catalog.rawCatalog(force);
  const live = installLiveProvider(ctx, { getSettings: settingsLoader, loadCatalog: liveCatalog });
  liveRef.invalidate = live.invalidate;
  ctx.effect(() => live.dispose, 'dsh-skill-curator: live skill provider');

  if (readConfig().creatorTool !== false && ctx.tools && typeof ctx.tools.register === 'function') {
    ctx.effect(
      () => ctx.tools.register({
        name: 'skill_curator_create',
        description: 'Create a new DeepSeek Harness skill (SKILL.md plus optional references/scripts files) in a writable DSH skill root. Use only when the user explicitly asks to create or save a reusable skill.',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Skill name in kebab-case; it becomes the directory name.' },
            description: { type: 'string', description: 'What the skill does and when to use it (routing description).' },
            body: { type: 'string', description: 'Markdown instructions for the skill body.' },
            scope: { type: 'string', enum: ['user', 'agents', 'project'], description: 'Where to create the skill.' },
            workspacePath: { type: 'string', description: 'Required for project scope: the workspace directory.' },
            files: {
              type: 'array',
              description: 'Optional modular resources (references/, scripts/, assets/).',
              items: {
                type: 'object',
                properties: { path: { type: 'string' }, content: { type: 'string' } },
                required: ['path', 'content'],
                additionalProperties: false,
              },
            },
          },
          required: ['name', 'description', 'body'],
          additionalProperties: false,
        },
        output: {
          schema: { type: 'object' },
          render: (_args, value) => [{
            type: 'text',
            text: value && value.ok === false
              ? `Skill creation failed${typeof value.code === 'string' ? ` (${value.code})` : ''}.`
              : `Created skill ${value?.name ?? ''} at ${value?.path ?? ''}`,
          }],
        },
        async execute(args) {
          const snapshot = await catalog.snapshot({ force: true });
          const result = await catalog.createSkill({
            confirm: true,
            revision: snapshot.revision,
            scope: args.scope === 'agents' || args.scope === 'project' ? args.scope : 'user',
            workspacePath: typeof args.workspacePath === 'string' ? args.workspacePath : undefined,
            name: args.name,
            description: args.description,
            body: args.body,
            files: args.files,
          });
          return { ok: true, name: result.skill?.name ?? args.name, path: result.path };
        },
        presentCall(args) {
          return {
            card: 'generic',
            title: 'Create skill',
            kind: 'edit',
            rawInput: args && args.name ? String(args.name) : undefined,
          };
        },
      }),
      'dsh-skill-curator: create-skill tool',
    );
    if (typeof ctx.on === 'function') {
      ctx.on('tools/pre-execute', (exec, next) => {
        if (exec && exec.name === 'skill_curator_create') {
          return Promise.resolve({ kind: 'ask', reason: 'Create a new skill under a writable DSH skill root' });
        }
        return next();
      });
    }
  }

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
