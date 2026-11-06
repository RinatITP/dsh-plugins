/**
 * Import planner and executor.
 *
 * Import is a deliberate user gesture: the Client shows the plan (source
 * candidate, target path, skip reason) first, then calls `importApply` with
 * `confirm: true` and the current catalog revision. The Host re-scans and
 * re-plans, so a stale plan or a target that appeared meanwhile is reported
 * instead of overwritten.
 *
 * Two modes are supported and both are explicit:
 *  - `copy`    — an independent snapshot of the skill directory (default);
 *  - `symlink` — a live link to the source directory (kept in sync with the
 *                external agent, breaks when the source moves).
 *
 * Nothing is overwritten: an existing target name is skipped with a stable code.
 */
import { copyFile, cp, lstat, mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { platform } from 'node:process';
import { CuratorError } from './errors.js';
import { MAX_NAME_LENGTH, NAME_PATTERN } from './validate.js';
import { findTargetSource, isInside } from './targets.js';
import { appendAudit, ensureHome, skillCuratorHome } from './state.js';

export const IMPORT_LIMITS = {
  maxSelection: 200,
  maxCandidateBytes: 32 * 1024 * 1024,
};

const MODES = new Set(['copy', 'symlink']);

function requireConfirm(body) {
  if (body?.confirm !== true) throw new CuratorError('CONFIRM_REQUIRED', 400);
}

function requireRevision(body, catalog) {
  if (typeof body?.revision !== 'string' || body.revision === '') {
    throw new CuratorError('REVISION_REQUIRED', 400);
  }
  if (body.revision !== catalog.revision) throw new CuratorError('STALE_REVISION', 409);
}

function importName(skill) {
  const candidate = skill.isFlat ? basename(skill.path, '.md') : basename(skill.skillDir);
  const fromFrontmatter = typeof skill.name === 'string' && skill.name !== '' ? skill.name : '';
  if (NAME_PATTERN.test(fromFrontmatter) && fromFrontmatter.length <= MAX_NAME_LENGTH) return fromFrontmatter;
  if (NAME_PATTERN.test(candidate) && candidate.length <= MAX_NAME_LENGTH) return candidate;
  return null;
}

function targetEntryName(skill, name) {
  return skill.isFlat ? `${name}.md` : name;
}

async function existingEntries(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return new Set(entries.map((entry) => entry.name.toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Build the import plan for one target.
 *
 * @param {object} catalog raw scanned catalog
 * @param {object} body { target, workspacePath, mode }
 */
export async function buildImportPlan(catalog, body = {}) {
  const scope = body.target === 'agents' ? 'agents' : body.target === 'project' ? 'project' : 'user';
  const source = findTargetSource(catalog, { scope, workspacePath: body.workspacePath });
  if (source.writable !== true) throw new CuratorError('READ_ONLY_TARGET', 403);
  const targetRoot = source.path;
  const existing = await existingEntries(targetRoot);
  const sourceOrder = new Map(catalog.sources.map((item, index) => [item.key, index]));

  const candidates = [];
  for (const skill of catalog.skills) {
    if (skill.sourceKey === source.key) continue;
    const name = importName(skill);
    const sourcePath = skill.isFlat ? skill.path : skill.skillDir;
    let skipReason = null;
    let targetPath = '';
    if (name === null) {
      skipReason = 'INVALID_NAME';
    } else {
      targetPath = join(targetRoot, targetEntryName(skill, name));
      if (isInside(targetRoot, skill.path)) skipReason = 'ALREADY_IN_TARGET';
      else if (existing.has(targetEntryName(skill, name).toLowerCase())) skipReason = 'TARGET_EXISTS';
    }
    candidates.push({
      id: skill.id,
      name: name ?? skill.name,
      description: skill.description,
      sourceKey: skill.sourceKey,
      sourceKind: skill.sourceKind,
      sourceLabelKey: sourceLabelKeyFor(catalog, skill.sourceKey),
      sourceLabel: sourceLabelFor(catalog, skill.sourceKey),
      sourcePath,
      sourceRelativePath: skill.relativePath,
      isFlat: skill.isFlat,
      isSymlinkSource: skill.isSymlink,
      targetPath,
      skipReason,
      diagnostics: (skill.diagnostics || [])
        .filter((item) => item.severity === 'error')
        .map((item) => item.code)
        .slice(0, 10),
      sizeBytes: skill.sizeBytes,
    });
  }

  candidates.sort((left, right) => (
    (sourceOrder.get(left.sourceKey) ?? 999) - (sourceOrder.get(right.sourceKey) ?? 999)
    || left.name.localeCompare(right.name)
  ));
  const claimed = new Map();
  for (const candidate of candidates) {
    if (candidate.skipReason !== null) continue;
    const key = basename(candidate.targetPath).toLowerCase();
    if (claimed.has(key)) candidate.skipReason = 'NAME_TAKEN';
    else claimed.set(key, candidate.id);
  }

  const groups = [];
  for (const catalogSource of catalog.sources) {
    const groupCandidates = candidates.filter((candidate) => candidate.sourceKey === catalogSource.key);
    if (groupCandidates.length === 0) continue;
    groups.push({
      key: catalogSource.key,
      kind: catalogSource.kind,
      agent: catalogSource.agent,
      labelKey: catalogSource.labelKey,
      label: catalogSource.label,
      path: catalogSource.path,
      readOnly: catalogSource.readOnly,
      candidates: groupCandidates,
    });
  }

  const importable = candidates.filter((candidate) => candidate.skipReason === null).length;
  return {
    target: scope,
    targetKey: source.key,
    targetRoot,
    mode: body.mode === 'symlink' ? 'symlink' : 'copy',
    candidates,
    groups,
    counts: {
      discovered: candidates.length,
      importable,
      skipped: candidates.length - importable,
    },
    limits: { maxSelection: IMPORT_LIMITS.maxSelection, maxCandidateBytes: IMPORT_LIMITS.maxCandidateBytes },
  };
}

function sourceLabelKeyFor(catalog, sourceKey) {
  const source = catalog.sources.find((item) => item.key === sourceKey);
  return source?.labelKey ?? null;
}

function sourceLabelFor(catalog, sourceKey) {
  const source = catalog.sources.find((item) => item.key === sourceKey);
  return source?.label ?? null;
}

/**
 * @param {object} deps
 * @param {() => object} deps.config
 * @param {(force?: boolean) => Promise<object>} deps.loadCatalog
 * @param {() => void} deps.invalidate
 */
export function createImports({ config = () => ({}), loadCatalog, invalidate }) {
  return {
    /** Read-only import plan for one target. */
    async scan(body = {}) {
      const catalog = await loadCatalog(true);
      return buildImportPlan(catalog, body);
    },

    /** Execute a selected subset of the plan. Never overwrites. */
    async apply(body = {}) {
      requireConfirm(body);
      const mode = body.mode === 'symlink' ? 'symlink' : 'copy';
      if (!MODES.has(mode)) throw new CuratorError('INVALID_MODE', 400);
      const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === 'string' && id !== '') : [];
      if (ids.length === 0) throw new CuratorError('SELECTION_EMPTY', 400);
      if (ids.length > IMPORT_LIMITS.maxSelection) throw new CuratorError('SELECTION_TOO_LARGE', 413);

      const catalog = await loadCatalog(true);
      requireRevision(body, catalog);
      const plan = await buildImportPlan(catalog, { ...body, mode });
      const byId = new Map(plan.candidates.map((candidate) => [candidate.id, candidate]));
      await mkdir(plan.targetRoot, { recursive: true, mode: 0o700 });
      const paths = await ensureHome(skillCuratorHome({ config: config() ?? {} }));
      const results = [];
      const created = [];

      try {
        for (const id of ids) {
          const candidate = byId.get(id);
          if (!candidate) {
            results.push({ id, status: 'skipped', code: 'NOT_FOUND' });
            continue;
          }
          if (candidate.skipReason !== null) {
            results.push({ id, name: candidate.name, status: 'skipped', code: candidate.skipReason });
            continue;
          }
          const existingTarget = await lstat(candidate.targetPath).catch(() => null);
          if (existingTarget !== null) {
            results.push({ id, name: candidate.name, status: 'skipped', code: 'TARGET_EXISTS' });
            continue;
          }
          const sourceInfo = await lstat(candidate.sourcePath).catch(() => null);
          if (sourceInfo === null) {
            results.push({ id, name: candidate.name, status: 'failed', code: 'SOURCE_MISSING' });
            continue;
          }
          try {
            if (mode === 'symlink') {
              const type = candidate.isFlat ? 'file' : (platform === 'win32' ? 'junction' : 'dir');
              await symlink(candidate.sourcePath, candidate.targetPath, type);
            } else if (candidate.isFlat) {
              await copyFile(candidate.sourcePath, candidate.targetPath);
            } else {
              await cp(candidate.sourcePath, candidate.targetPath, {
                recursive: true,
                errorOnExist: true,
                force: false,
              });
            }
            created.push(candidate.targetPath);
            results.push({ id, name: candidate.name, status: 'imported', targetPath: candidate.targetPath });
            await appendAudit(paths, {
              action: 'import',
              name: candidate.name,
              sourceKey: candidate.sourceKey,
              mode,
            });
          } catch (error) {
            const code = error && error.code === 'EEXIST' ? 'TARGET_EXISTS' : 'IMPORT_FAILED';
            results.push({ id, name: candidate.name, status: 'failed', code });
          }
        }
      } catch (error) {
        for (const path of created.reverse()) {
          await rm(path, { recursive: true, force: true }).catch(() => {});
        }
        throw error;
      }

      invalidate();
      const fresh = await loadCatalog(true);
      const imported = results.filter((item) => item.status === 'imported').length;
      return {
        revision: fresh.revision,
        mode,
        targetKey: plan.targetKey,
        targetRoot: plan.targetRoot,
        results,
        counts: {
          imported,
          skipped: results.filter((item) => item.status === 'skipped').length,
          failed: results.filter((item) => item.status === 'failed').length,
        },
      };
    },
  };
}

export { importName, targetEntryName };
