/**
 * Catalog facade used by the HTTP layer: one cached read-only snapshot plus
 * detail/file reads. No mutation exists in this stage — the Client renders a
 * read-only library, and write actions will be added behind explicit
 * confirmation in the next stage.
 */
import { buildSources } from './roots.js';
import { LIMITS, projectSkill, readSkillDetail, readSkillFile, scanCatalog } from './discovery.js';
import { CuratorError } from './errors.js';
import { createMutations } from './mutations.js';

/** Capabilities advertised to the Client. */
export const CAPABILITIES = Object.freeze({
  read: true,
  write: true,
  edit: true,
  create: true,
  trash: true,
  import: false,
  projectScope: true,
  overlayToggle: false,
  liveSources: false,
});

const SNAPSHOT_TTL_MS = 1500;

function normalizeConfig(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function projectSource(source) {
  return {
    key: source.key,
    kind: source.kind,
    agent: source.agent,
    labelKey: source.labelKey,
    label: source.label,
    path: source.path,
    scope: source.scope,
    readOnly: source.readOnly,
    readOnlyReason: source.readOnlyReason,
    writable: source.writable === true,
    exists: source.exists,
    skillCount: source.skillCount,
    systemCount: source.systemCount,
    error: source.error,
    truncated: source.truncated,
  };
}

/**
 * @param {object} deps
 * @param {() => object} deps.config plugin configuration reader
 * @param {() => Array<{path: string, label?: string}>} [deps.projectRoots]
 */
export function createCatalog({ config = () => ({}), projectRoots = () => [], log = () => {}, env = undefined, home = undefined } = {}) {
  let cache = null;
  let inflight = null;

  async function load(force = false) {
    const now = Date.now();
    if (!force && cache !== null && now - cache.at < SNAPSHOT_TTL_MS) return cache.catalog;
    if (inflight !== null) return inflight;
    inflight = (async () => {
      const normalized = normalizeConfig(config());
      const sourceOptions = { config: normalized, projectRoots: projectRoots() };
      if (env !== undefined) sourceOptions.env = env;
      if (home !== undefined) sourceOptions.home = home;
      const sources = buildSources(sourceOptions);
      const catalog = await scanCatalog(sources, { log });
      cache = { at: Date.now(), catalog };
      return catalog;
    })();
    try {
      return await inflight;
    } finally {
      inflight = null;
    }
  }

  function invalidate() {
    cache = null;
  }

  function findSkill(catalog, id) {
    if (typeof id !== 'string' || id === '') throw new CuratorError('SKILL_ID_REQUIRED', 400);
    const skill = catalog.skills.find((candidate) => candidate.id === id);
    if (!skill) throw new CuratorError('SKILL_NOT_FOUND', 404);
    return skill;
  }

  const mutations = createMutations({
    config,
    loadCatalog: load,
    invalidate,
  });

  return {
    invalidate,

    /** Browser-facing snapshot. */
    async snapshot(body = {}) {
      const catalog = await load(body?.force === true);
      return {
        revision: catalog.revision,
        generatedAt: catalog.generatedAt,
        complete: catalog.complete,
        capabilities: { ...CAPABILITIES },
        limits: {
          maxSkills: LIMITS.maxSkills,
          maxSkillFileBytes: LIMITS.maxSkillFileBytes,
          maxFileReadBytes: LIMITS.maxFileReadBytes,
        },
        summary: catalog.summary,
        sources: catalog.sources.map(projectSource),
        skills: catalog.skills.map(projectSkill),
        skipped: catalog.skipped,
      };
    },

    /** One skill with SKILL.md body and a bounded file tree. */
    async detail(body = {}) {
      const catalog = await load(false);
      const skill = findSkill(catalog, body.id);
      const detail = await readSkillDetail(skill);
      if (!detail.ok) throw new CuratorError(detail.code ?? 'SKILL_UNREADABLE', 404);
      return {
        skill: detail.skill,
        content: detail.content,
        truncated: detail.truncated,
        bodyStartLine: detail.frontmatter.bodyStartLine,
        frontmatter: {
          ok: detail.frontmatter.ok,
          reason: detail.frontmatter.reason,
          warnings: detail.frontmatter.warnings,
        },
        files: detail.files,
      };
    },

    /** Read one resource file of a skill (traversal-safe). */
    async readFile(body = {}) {
      const catalog = await load(false);
      const skill = findSkill(catalog, body.id);
      const result = await readSkillFile(skill, body.path);
      if (!result.ok) {
        const status = result.code === 'PATH_OUTSIDE_SKILL' ? 403 : 404;
        throw new CuratorError(result.code, status);
      }
      return result;
    },

    validateDraft: (body) => mutations.validateDraft(body),
    saveSkill: (body) => mutations.saveSkill(body),
    writeFile: (body) => mutations.writeFile(body),
    toggleSkill: (body) => mutations.toggleSkill(body),
    createSkill: (body) => mutations.createSkill(body),
    removeSkill: (body) => mutations.removeSkill(body),
    listTrash: (body) => mutations.listTrash(body),
    restoreTrash: (body) => mutations.restoreTrash(body),
  };
}
