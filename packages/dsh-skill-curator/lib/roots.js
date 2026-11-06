/**
 * Known skill roots on this computer.
 *
 * The DSH loader itself reads five default roots (project `.dsh`, project
 * `.agents`, custom, user `.dsh`, user `.agents`) plus the bundled skill
 * directory. This module adds the known external agent homes so the studio can
 * show them read-only, and keeps every path resolution in one place.
 *
 * Nothing here touches the filesystem: existence is checked by discovery.
 */
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';

const EXTERNAL_AGENTS = [
  {
    key: 'claude',
    agent: 'claude',
    labelKey: 'source.claude',
    home: ['.claude'],
    env: 'DSH_CLAUDE_HOME',
    subdir: 'skills',
    depth: 1,
  },
  {
    key: 'codex',
    agent: 'codex',
    labelKey: 'source.codex',
    home: ['.codex'],
    env: 'DSH_CODEX_HOME',
    subdir: 'skills',
    depth: 1,
    systemSubdir: '.system',
  },
  {
    key: 'hermes',
    agent: 'hermes',
    labelKey: 'source.hermes',
    home: ['.hermes'],
    env: 'DSH_HERMES_HOME',
    subdir: 'skills',
    depth: 2,
  },
  {
    key: 'zcode',
    agent: 'zcode',
    labelKey: 'source.zcode',
    home: ['.zcode'],
    env: 'DSH_ZCODE_HOME',
    subdir: 'skills',
    depth: 1,
  },
  {
    key: 'cursor',
    agent: 'cursor',
    labelKey: 'source.cursor',
    home: ['.cursor'],
    env: 'DSH_CURSOR_HOME',
    subdir: 'skills',
    depth: 1,
  },
  {
    key: 'gemini',
    agent: 'gemini',
    labelKey: 'source.gemini',
    home: ['.gemini'],
    env: 'DSH_GEMINI_HOME',
    roots: [['skills'], ['config', 'skills']],
    depth: 1,
  },
  {
    key: 'kimi',
    agent: 'kimi',
    labelKey: 'source.kimi',
    home: ['.kimi-code'],
    env: 'DSH_KIMI_HOME',
    subdir: 'skills',
    depth: 1,
  },
  {
    key: 'opencode',
    agent: 'opencode',
    labelKey: 'source.opencode',
    home: ['.config', 'opencode'],
    env: 'DSH_OPENCODE_HOME',
    subdir: 'skills',
    depth: 1,
  },
];

const SOURCE_ORDER = {
  'dsh-user': 10,
  'dsh-agents': 20,
  project: 30,
  bundled: 40,
  claude: 50,
  codex: 60,
  hermes: 70,
  zcode: 80,
  cursor: 90,
  gemini: 100,
  kimi: 110,
  opencode: 120,
  custom: 200,
};

function expandEnvironment(text, env) {
  return String(text).replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (_match, braced, plain) => {
    const name = braced ?? plain;
    return typeof env[name] === 'string' ? env[name] : '';
  });
}

/** Expand `~`, environment variables and resolve to an absolute normalized path. */
export function expandPath(input, { home = homedir(), env = process.env } = {}) {
  if (typeof input !== 'string' || input.trim() === '') return null;
  let text = input.trim();
  if (text === '~') text = home;
  else if (text.startsWith('~/') || text.startsWith('~\\')) text = join(home, text.slice(2));
  const placeholder = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;
  let match;
  while ((match = placeholder.exec(text)) !== null) {
    const name = match[1] ?? match[2];
    if (typeof env[name] !== 'string' || env[name] === '') return null;
  }
  text = expandEnvironment(text, env);
  if (text.includes('$')) return null;
  if (!isAbsolute(text)) return null;
  return normalize(resolve(text));
}

function sourceOrder(key) {
  return SOURCE_ORDER[key] ?? 500;
}

function makeSource(partial) {
  return {
    key: partial.key,
    kind: partial.kind,
    agent: partial.agent ?? partial.kind,
    labelKey: partial.labelKey ?? null,
    label: partial.label ?? null,
    path: partial.path,
    readOnly: partial.readOnly !== false,
    writable: partial.writable === true,
    depth: partial.depth ?? 1,
    flat: partial.flat === true,
    systemSubdir: partial.systemSubdir ?? null,
    scope: partial.scope ?? 'user',
    order: sourceOrder(partial.key),
  };
}

/** Locate the bundled skill directory shipped with the desktop app. */
export function detectBundledSkillDir({ execPath = process.execPath, env = process.env } = {}) {
  const configured = expandPath(env.DSH_BUNDLED_SKILL_DIR, { env });
  if (configured !== null) return configured;
  const marker = `${normalize(execPath)}`;
  if (/DeepSeek Harness(?:\.app)?$/i.test(marker) || /DeepSeek Harness/i.test(marker)) {
    const resources = resolve(dirname(marker), '..', 'Resources');
    const candidate = join(resources, 'runtime', 'office-skills');
    return candidate;
  }
  return null;
}

/**
 * Build the ordered source descriptors for one snapshot.
 *
 * @param {object} [options]
 * @param {NodeJS.ProcessEnv} [options.env]
 * @param {string} [options.home]
 * @param {string} [options.execPath]
 * @param {object} [options.config] plugin configuration from the Loader entry
 * @param {Array<{path: string, label?: string}>} [options.projectRoots]
 */
export function buildSources({
  env = process.env,
  home = homedir(),
  execPath = process.execPath,
  config = {},
  projectRoots = [],
} = {}) {
  const dshHome = expandPath(config.dshHome, { home, env }) ?? expandPath(env.DSH_HOME, { home, env }) ?? join(home, '.dsh');
  const agentsHome = expandPath(config.agentsHome, { home, env })
    ?? expandPath(env.DSH_AGENTS_HOME, { home, env })
    ?? join(home, '.agents');

  const sources = [
    makeSource({
      key: 'dsh-user',
      kind: 'dsh-user',
      agent: 'dsh',
      labelKey: 'source.dshUser',
      path: join(dshHome, 'skills'),
      readOnly: false,
      writable: true,
      flat: true,
      scope: 'user',
    }),
    makeSource({
      key: 'dsh-agents',
      kind: 'dsh-agents',
      agent: 'dsh',
      labelKey: 'source.dshAgents',
      path: join(agentsHome, 'skills'),
      readOnly: false,
      writable: true,
      flat: true,
      scope: 'user',
    }),
  ];

  for (const project of projectRoots) {
    const projectPath = expandPath(project?.path, { home, env });
    if (projectPath === null) continue;
    sources.push(makeSource({
      key: `project:${projectPath}`,
      kind: 'project',
      agent: 'dsh',
      labelKey: 'source.project',
      label: typeof project.label === 'string' ? project.label : null,
      path: join(projectPath, '.dsh', 'skills'),
      readOnly: true,
      writable: false,
      flat: true,
      scope: 'project',
    }));
  }

  const bundled = expandPath(config.bundledSkillDir, { home, env }) ?? detectBundledSkillDir({ execPath, env });
  if (bundled !== null) {
    sources.push(makeSource({
      key: 'bundled',
      kind: 'bundled',
      agent: 'dsh',
      labelKey: 'source.bundled',
      path: bundled,
      readOnly: true,
      scope: 'user',
    }));
  }

  const configuredSources = config.externalSources && typeof config.externalSources === 'object'
    ? config.externalSources
    : {};
  for (const definition of EXTERNAL_AGENTS) {
    const override = configuredSources[definition.key];
    if (override === false) continue;
    const overrideHome = override && typeof override === 'object' ? expandPath(override.path, { home, env }) : null;
    const baseHome = overrideHome ?? expandPath(env[definition.env], { home, env }) ?? join(home, ...definition.home);
    const roots = definition.roots
      ? definition.roots.map((segments) => join(baseHome, ...segments))
      : [join(baseHome, definition.subdir)];
    const overridePath = overrideHome === null ? null : join(baseHome, definition.subdir ?? 'skills');
    const path = overridePath ?? roots[0];
    if (definition.roots && overridePath === null) {
      // Antigravity/Gemini exposes two plausible roots; add a second descriptor.
      sources.push(makeSource({
        key: definition.key,
        kind: 'external',
        agent: definition.agent,
        labelKey: definition.labelKey,
        path: roots[0],
        readOnly: true,
        depth: definition.depth,
        scope: 'user',
      }));
      sources.push(makeSource({
        key: `${definition.key}:config`,
        kind: 'external',
        agent: definition.agent,
        labelKey: definition.labelKey,
        path: roots[1],
        readOnly: true,
        depth: definition.depth,
        scope: 'user',
      }));
      continue;
    }
    sources.push(makeSource({
      key: definition.key,
      kind: 'external',
      agent: definition.agent,
      labelKey: definition.labelKey,
      path,
      readOnly: true,
      depth: definition.depth,
      systemSubdir: definition.systemSubdir ?? null,
      scope: 'user',
    }));
  }

  const customSources = Array.isArray(config.customSources) ? config.customSources : [];
  for (const [index, custom] of customSources.entries()) {
    const customPath = expandPath(custom?.path, { home, env });
    if (customPath === null) continue;
    const label = typeof custom?.label === 'string' && custom.label.trim() !== ''
      ? custom.label.trim()
      : `custom-${index + 1}`;
    sources.push(makeSource({
      key: `custom:${label}`,
      kind: 'custom',
      agent: 'custom',
      label,
      path: customPath,
      readOnly: custom?.readOnly !== false,
      depth: Number.isInteger(custom?.depth) && custom.depth === 2 ? 2 : 1,
      flat: custom?.flat === true,
      scope: 'user',
    }));
  }

  sources.sort((left, right) => left.order - right.order || left.path.localeCompare(right.path));
  return sources;
}

export { EXTERNAL_AGENTS, SOURCE_ORDER };
