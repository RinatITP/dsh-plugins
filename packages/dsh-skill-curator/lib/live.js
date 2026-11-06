/**
 * Live skill provider.
 *
 * When the user switches a read-only external source to "live", its skills are
 * exposed to the DSH skill registry without copying or symlinking anything: the
 * provider reads the external `SKILL.md` on every load, so the catalog follows
 * the source and stays read-only.
 *
 * Candidates use rank 350, which sits between the shipped `custom` root (300)
 * and `user-dsh` (400): user and project skills still win a duplicate name, while
 * live external skills appear in the model catalog. Live skills are model-only
 * (not injected into the slash menu) to keep that menu focused on local skills.
 */
import { readFile } from 'node:fs/promises';
import { splitFrontmatter } from './frontmatter.js';

export const LIVE_RANK = 350;
export const LIVE_PROVIDER_NAME = 'skill-curator-live';
const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * @param {object} deps
 * @param {() => Promise<object>} deps.getSettings
 * @param {(force?: boolean) => Promise<object>} deps.loadCatalog
 */
export function createLiveProvider({ getSettings, loadCatalog }) {
  const provider = {
    name: LIVE_PROVIDER_NAME,
    async list() {
      const settings = await getSettings();
      const enabled = settings && settings.liveSources ? settings.liveSources : {};
      const keys = Object.keys(enabled).filter((key) => enabled[key] === true);
      if (keys.length === 0) return [];
      const catalog = await loadCatalog(false);
      const candidates = [];
      for (const skill of catalog.skills) {
        if (skill.readOnly !== true) continue;
        if (!Object.prototype.hasOwnProperty.call(enabled, skill.sourceKey)) continue;
        if (typeof skill.name !== 'string' || !NAME_PATTERN.test(skill.name)) continue;
        candidates.push({
          name: skill.name,
          description: skill.description || '',
          invocation: { modelInvocable: true, userInvocable: false },
          provider: LIVE_PROVIDER_NAME,
          source: `live:${skill.sourceKey}`,
          rank: LIVE_RANK,
          locator: {
            id: skill.id,
            path: skill.path,
            skillDir: skill.skillDir,
            isFlat: skill.isFlat,
            sourceKey: skill.sourceKey,
          },
          resourceBase: { kind: 'directory', path: skill.skillDir },
          path: skill.path,
          metadata: { live: true, readOnly: true, sourceKey: skill.sourceKey },
        });
      }
      return candidates;
    },
    async get(candidate) {
      const locator = candidate && candidate.locator;
      if (!locator || typeof locator.path !== 'string' || locator.path === '') return undefined;
      const raw = await readFile(locator.path, 'utf8').catch(() => null);
      if (raw === null) return undefined;
      const document = splitFrontmatter(raw);
      const declared = typeof document.data?.name === 'string' ? document.data.name.trim() : '';
      if (declared !== candidate.name) return undefined;
      return {
        name: candidate.name,
        description: candidate.description,
        invocation: candidate.invocation,
        provider: candidate.provider,
        source: candidate.source,
        resourceBase: candidate.resourceBase,
        path: candidate.path,
        metadata: candidate.metadata,
        content: document.body.trim(),
      };
    },
  };
  return provider;
}

/**
 * Register the provider on the Host skill registry.
 *
 * @returns {{dispose: () => void, invalidate: () => void}}
 */
export function installLiveProvider(ctx, deps) {
  const noop = { dispose: () => {}, invalidate: () => {} };
  if (!ctx || !ctx.skills || typeof ctx.skills.registerProvider !== 'function') return noop;
  let invalidate = null;
  const dispose = ctx.skills.registerProvider((control) => {
    invalidate = typeof control.invalidate === 'function' ? control.invalidate : null;
    return createLiveProvider(deps);
  });
  return {
    dispose: typeof dispose === 'function' ? dispose : () => {},
    invalidate: () => {
      if (typeof invalidate === 'function') invalidate();
    },
  };
}
