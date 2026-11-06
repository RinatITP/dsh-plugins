/**
 * Write engine for dsh-skill-curator.
 *
 * Every mutation is a user gesture: HTTP requires `confirm: true`, a matching
 * catalog revision, a writable source, and a non-symlink bundle entirely inside
 * that source. Writes are atomic, the previous content is backed up first, and
 * deletions move whole skill entries into the plugin's trash directory.
 *
 * No mutation writes outside `~/.dsh/skills`, `~/.agents/skills` or a
 * configured project `.dsh/skills` root; external agent roots stay read-only.
 */
import { randomUUID } from 'node:crypto';
import { cp, copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { CuratorError } from './errors.js';
import { splitFrontmatter, setFrontmatterFields, scalarField } from './frontmatter.js';
import { diagnoseSkill, MAX_DESCRIPTION_LENGTH, NAME_PATTERN, MAX_NAME_LENGTH } from './validate.js';
import { projectSkill } from './discovery.js';
import {
  appendAudit,
  ensureHome,
  pruneDirectories,
  readJsonFile,
  skillCuratorHome,
  timestampId,
} from './state.js';

export const WRITE_LIMITS = {
  maxSkillBytes: 512 * 1024,
  maxResourceBytes: 512 * 1024,
  maxBackups: 200,
  maxTrash: 200,
  maxCreateFiles: 32,
};

const RESOURCE_PATH = /^(references|scripts|assets)(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;
const TRASH_ID = /^[0-9TZ-]+-[a-f0-9]{8}$/;

function isInside(root, target) {
  const base = resolve(root);
  const candidate = resolve(target);
  return candidate === base || candidate.startsWith(base + sep);
}

function findSkill(catalog, id) {
  if (typeof id !== 'string' || id === '') throw new CuratorError('SKILL_ID_REQUIRED', 400);
  const skill = catalog.skills.find((candidate) => candidate.id === id);
  if (!skill) throw new CuratorError('SKILL_NOT_FOUND', 404);
  return skill;
}

function findSource(catalog, skill) {
  const source = catalog.sources.find((candidate) => candidate.key === skill.sourceKey);
  if (!source) throw new CuratorError('SOURCE_NOT_FOUND', 404);
  return source;
}

function requireConfirm(body) {
  if (body?.confirm !== true) throw new CuratorError('CONFIRM_REQUIRED', 400);
}

function requireRevision(body, catalog) {
  if (typeof body?.revision !== 'string' || body.revision === '') {
    throw new CuratorError('REVISION_REQUIRED', 400);
  }
  if (body.revision !== catalog.revision) throw new CuratorError('STALE_REVISION', 409);
}

function requireContent(body, limit) {
  if (typeof body?.content !== 'string') throw new CuratorError('INVALID_CONTENT', 400);
  if (Buffer.byteLength(body.content, 'utf8') > limit) throw new CuratorError('CONTENT_TOO_LARGE', 413);
  return body.content;
}

function writableSkill(catalog, id) {
  const skill = findSkill(catalog, id);
  const source = findSource(catalog, skill);
  if (source.writable !== true) throw new CuratorError('READ_ONLY_SKILL', 403);
  if (!isInside(source.path, skill.path)) throw new CuratorError('PATH_OUTSIDE_ROOTS', 403);
  if (skill.isSymlink) throw new CuratorError('SYMLINK_READ_ONLY', 403);
  if (!skill.isFlat && !isInside(source.path, skill.skillDir)) {
    throw new CuratorError('PATH_OUTSIDE_ROOTS', 403);
  }
  return { skill, source };
}

function validateContent(content, { dirName, isFlat }) {
  const frontmatter = splitFrontmatter(content);
  const result = diagnoseSkill({ frontmatter, body: frontmatter.body, dirName, isFlat });
  const errors = result.diagnostics.filter((item) => item.severity === 'error');
  return { frontmatter, result, errors };
}

function assertValidContent(content, options) {
  const checked = validateContent(content, options);
  if (checked.errors.length > 0) {
    throw new CuratorError('VALIDATION_FAILED', 422, {
      details: { diagnostics: checked.errors.slice(0, 20) },
    });
  }
  return checked;
}

async function atomicWriteFile(target, content, mode) {
  const directory = dirname(target);
  const temp = join(directory, `.${basename(target)}.tmp-${randomUUID()}`);
  await writeFile(temp, content, { encoding: 'utf8', mode: mode ?? 0o600 });
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
}

async function movePath(source, target) {
  try {
    await rename(source, target);
    return;
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error;
  }
  await cp(source, target, { recursive: true, errorOnExist: true, force: false });
  await rm(source, { recursive: true, force: true });
}

/** Copy the current skill file into a fresh backup directory. */
async function backupSkillFile(paths, skill) {
  const itemDir = join(paths.backups, timestampId());
  const payload = join(itemDir, 'payload');
  await mkdir(payload, { recursive: true, mode: 0o700 });
  const info = await lstat(skill.path).catch(() => null);
  if (info === null || !info.isFile()) throw new CuratorError('SKILL_UNREADABLE', 404);
  await copyFile(skill.path, join(payload, 'SKILL.md'));
  if (!skill.isFlat) {
    for (const relativePath of ['references', 'scripts', 'assets']) {
      const sourceDir = join(skill.skillDir, relativePath);
      const sourceInfo = await lstat(sourceDir).catch(() => null);
      if (sourceInfo !== null && sourceInfo.isDirectory()) {
        await cp(sourceDir, join(payload, relativePath), { recursive: true, force: false });
      }
    }
  }
  await writeFile(join(itemDir, 'meta.json'), `${JSON.stringify({
    at: new Date().toISOString(),
    name: skill.name,
    sourceKey: skill.sourceKey,
    skillFile: skill.path,
    mode: info.mode & 0o777,
  }, null, 2)}\n`, 'utf8');
  await pruneDirectories(paths.backups, WRITE_LIMITS.maxBackups);
  return itemDir;
}

async function persistSkillContent({ paths, skill, content, action }) {
  const info = await lstat(skill.path).catch(() => null);
  if (info === null || !info.isFile()) throw new CuratorError('SKILL_UNREADABLE', 404);
  await backupSkillFile(paths, skill);
  await atomicWriteFile(skill.path, content, info.mode & 0o777);
  await appendAudit(paths, { action, name: skill.name, sourceKey: skill.sourceKey });
}

async function assertNoSymlinkComponents(base, target) {
  const relativePath = relative(resolve(base), resolve(target));
  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new CuratorError('PATH_OUTSIDE_SKILL', 403);
  }
  const segments = relativePath.split(sep);
  let current = resolve(base);
  for (const segment of segments) {
    current = join(current, segment);
    const info = await lstat(current).catch(() => null);
    if (info !== null && info.isSymbolicLink()) throw new CuratorError('SYMLINK_PATH', 403);
  }
  return segments;
}

function buildSkillDocument({ name, description, body }) {
  return [
    '---',
    `name: ${name}`,
    `description: ${JSON.stringify(description)}`,
    '---',
    '',
    String(body ?? '').trimEnd(),
    '',
  ].join('\n');
}

/**
 * @param {object} deps
 * @param {() => object} deps.config plugin configuration reader
 * @param {(force?: boolean) => Promise<object>} deps.loadCatalog cached/forced catalog loader
 * @param {() => void} deps.invalidate invalidate the catalog cache
 */
export function createMutations({ config = () => ({}), loadCatalog, invalidate }) {
  const pathsFor = () => skillCuratorHome({ config: config() ?? {} });

  async function freshCatalog() {
    invalidate();
    return loadCatalog(true);
  }

  async function findFreshSkill(id) {
    const catalog = await freshCatalog();
    return { catalog, skill: findSkill(catalog, id) };
  }

  return {
    /** Validate a draft without writing it. */
    async validateDraft(body = {}) {
      const content = requireContent(body, WRITE_LIMITS.maxSkillBytes);
      const catalog = await loadCatalog(false);
      let dirName = '';
      let isFlat = false;
      if (typeof body.id === 'string' && body.id !== '') {
        const current = catalog.skills.find((candidate) => candidate.id === body.id);
        if (current) {
          isFlat = current.isFlat;
          dirName = current.isFlat ? basename(current.path, '.md') : basename(current.skillDir);
        }
      }
      const checked = validateContent(content, { dirName, isFlat });
      return {
        ok: true,
        name: scalarField(checked.frontmatter.data, 'name'),
        description: scalarField(checked.frontmatter.data, 'description'),
        diagnostics: checked.result.diagnostics,
        invocation: checked.result.invocation,
        bodyLines: checked.result.bodyLines,
        bodyBytes: checked.result.bodyBytes,
      };
    },

    /** Replace SKILL.md after validation, with a backup and revision guard. */
    async saveSkill(body = {}) {
      requireConfirm(body);
      const catalog = await loadCatalog(true);
      requireRevision(body, catalog);
      const { skill } = writableSkill(catalog, body.id);
      const content = requireContent(body, WRITE_LIMITS.maxSkillBytes);
      const checked = assertValidContent(content, {
        dirName: skill.isFlat ? basename(skill.path, '.md') : basename(skill.skillDir),
        isFlat: skill.isFlat,
      });
      if (checked.result.name !== skill.name) throw new CuratorError('NAME_CHANGE_UNSUPPORTED', 422);
      const paths = await ensureHome(pathsFor());
      await persistSkillContent({ paths, skill, content, action: 'save' });
      const { catalog: fresh, skill: updated } = await findFreshSkill(body.id);
      return { revision: fresh.revision, skill: projectSkill(updated) };
    },

    /** Write one resource file inside a bundle (references/scripts/assets). */
    async writeFile(body = {}) {
      requireConfirm(body);
      const catalog = await loadCatalog(true);
      requireRevision(body, catalog);
      const { skill } = writableSkill(catalog, body.id);
      if (skill.isFlat) throw new CuratorError('RESOURCE_NOT_SUPPORTED', 422);
      const relativePath = typeof body.path === 'string' ? body.path.replace(/\\/g, '/') : '';
      if (relativePath === 'SKILL.md' || relativePath === '') throw new CuratorError('PATH_INVALID', 400);
      if (!RESOURCE_PATH.test(relativePath)) throw new CuratorError('PATH_NOT_ALLOWED', 422);
      const content = requireContent(body, WRITE_LIMITS.maxResourceBytes);
      const segments = await assertNoSymlinkComponents(skill.skillDir, join(skill.skillDir, relativePath));
      const target = join(skill.skillDir, ...segments);
      const info = await lstat(target).catch(() => null);
      if (info !== null && !info.isFile()) throw new CuratorError('PATH_NOT_FILE', 422);
      const paths = await ensureHome(pathsFor());
      if (info !== null) await backupSkillFile(paths, skill);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await atomicWriteFile(target, content, info !== null ? info.mode & 0o777 : 0o600);
      await appendAudit(paths, { action: 'write-file', name: skill.name, sourceKey: skill.sourceKey, file: relativePath });
      const { catalog: fresh } = await findFreshSkill(body.id);
      return { revision: fresh.revision, path: relativePath };
    },

    /** Enable or disable model/user invocation for a writable skill. */
    async toggleSkill(body = {}) {
      requireConfirm(body);
      const catalog = await loadCatalog(true);
      requireRevision(body, catalog);
      const { skill } = writableSkill(catalog, body.id);
      const current = await readFile(skill.path, 'utf8').catch(() => null);
      if (current === null) throw new CuratorError('SKILL_UNREADABLE', 404);
      const modelInvocable = typeof body.modelInvocable === 'boolean'
        ? body.modelInvocable
        : !skill.invocation.modelInvocable;
      const userInvocable = typeof body.userInvocable === 'boolean'
        ? body.userInvocable
        : !skill.invocation.userInvocable;
      const edited = setFrontmatterFields(current, {
        'disable-model-invocation': modelInvocable ? null : true,
        'user-invocable': userInvocable ? null : false,
      });
      if (!edited.ok) throw new CuratorError('FRONTMATTER_UNSUPPORTED', 422);
      assertValidContent(edited.text, {
        dirName: skill.isFlat ? basename(skill.path, '.md') : basename(skill.skillDir),
        isFlat: skill.isFlat,
      });
      const paths = await ensureHome(pathsFor());
      await persistSkillContent({ paths, skill, content: edited.text, action: modelInvocable && userInvocable ? 'enable' : 'disable' });
      const { catalog: fresh, skill: updated } = await findFreshSkill(body.id);
      return { revision: fresh.revision, skill: projectSkill(updated) };
    },

    /** Create a new skill in a writable user/agents/project root. */
    async createSkill(body = {}) {
      requireConfirm(body);
      const catalog = await loadCatalog(true);
      if (typeof body.revision === 'string' && body.revision !== '' && body.revision !== catalog.revision) {
        throw new CuratorError('STALE_REVISION', 409);
      }
      const scope = body.scope === 'agents' ? 'agents' : body.scope === 'project' ? 'project' : 'user';
      let source;
      if (scope === 'project') {
        const workspacePath = typeof body.workspacePath === 'string' ? body.workspacePath : '';
        if (workspacePath === '' || !isAbsolute(workspacePath)) throw new CuratorError('INVALID_TARGET', 400);
        const expected = resolve(join(workspacePath, '.dsh', 'skills'));
        source = catalog.sources.find((candidate) => candidate.kind === 'project' && resolve(candidate.path) === expected);
        if (!source) throw new CuratorError('PROJECT_NOT_CONFIGURED', 404);
      } else {
        const kind = scope === 'agents' ? 'dsh-agents' : 'dsh-user';
        source = catalog.sources.find((candidate) => candidate.kind === kind);
        if (!source) throw new CuratorError('TARGET_NOT_FOUND', 404);
      }
      if (source.writable !== true) throw new CuratorError('READ_ONLY_TARGET', 403);

      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      const skillBody = typeof body.body === 'string' ? body.body : '';
      if (!NAME_PATTERN.test(name) || name.length > MAX_NAME_LENGTH) {
        throw new CuratorError('SKILL_NAME_INVALID', 422);
      }
      if (description === '' || description.length > MAX_DESCRIPTION_LENGTH) {
        throw new CuratorError('SKILL_DESCRIPTION_INVALID', 422);
      }
      if (skillBody.trim() === '') throw new CuratorError('SKILL_BODY_EMPTY', 422);
      if (Buffer.byteLength(skillBody, 'utf8') > WRITE_LIMITS.maxSkillBytes) {
        throw new CuratorError('CONTENT_TOO_LARGE', 413);
      }

      const content = buildSkillDocument({ name, description, body: skillBody });
      assertValidContent(content, { dirName: name, isFlat: false });

      const targetDir = join(source.path, name);
      const existing = await lstat(targetDir).catch(() => null);
      if (existing !== null) throw new CuratorError('TARGET_EXISTS', 409);

      const files = Array.isArray(body.files) ? body.files : [];
      if (files.length > WRITE_LIMITS.maxCreateFiles) throw new CuratorError('TOO_MANY_FILES', 413);
      for (const file of files) {
        if (!file || typeof file.path !== 'string' || !RESOURCE_PATH.test(file.path.replace(/\\/g, '/'))) {
          throw new CuratorError('PATH_NOT_ALLOWED', 422);
        }
        if (typeof file.content !== 'string' || Buffer.byteLength(file.content, 'utf8') > WRITE_LIMITS.maxResourceBytes) {
          throw new CuratorError('CONTENT_TOO_LARGE', 413);
        }
      }

      await ensureHome(pathsFor());
      const tempDir = join(source.path, `.curator-tmp-${randomUUID()}`);
      await mkdir(tempDir, { recursive: true, mode: 0o700 });
      try {
        await writeFile(join(tempDir, 'SKILL.md'), content, { encoding: 'utf8', mode: 0o600 });
        for (const file of files) {
          const relativePath = file.path.replace(/\\/g, '/');
          const target = join(tempDir, ...relativePath.split('/'));
          await mkdir(dirname(target), { recursive: true, mode: 0o700 });
          await writeFile(target, file.content, { encoding: 'utf8', mode: 0o600 });
        }
        await rename(tempDir, targetDir);
      } catch (error) {
        await rm(tempDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      const paths = await ensureHome(pathsFor());
      await appendAudit(paths, { action: 'create', name, sourceKey: source.key });
      const fresh = await freshCatalog();
      const createdPath = join(targetDir, 'SKILL.md');
      const created = fresh.skills.find((candidate) => resolve(candidate.path) === resolve(createdPath));
      return {
        revision: fresh.revision,
        skill: created ? projectSkill(created) : null,
        path: createdPath,
      };
    },

    /** Move a writable skill into the plugin trash (never delete content). */
    async removeSkill(body = {}) {
      requireConfirm(body);
      const catalog = await loadCatalog(true);
      requireRevision(body, catalog);
      const { skill } = writableSkill(catalog, body.id);
      const paths = await ensureHome(pathsFor());
      const id = timestampId();
      const itemDir = join(paths.trash, id);
      await mkdir(itemDir, { recursive: true, mode: 0o700 });
      const payload = join(itemDir, 'payload');
      try {
        if (skill.isFlat) {
          await mkdir(payload, { recursive: true, mode: 0o700 });
          await movePath(skill.path, join(payload, basename(skill.path)));
        } else {
          await movePath(skill.skillDir, payload);
        }
      } catch (error) {
        await rm(itemDir, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      const metadata = {
        id,
        at: new Date().toISOString(),
        name: skill.name,
        sourceKey: skill.sourceKey,
        scope: skill.scope,
        originalPath: skill.isFlat ? skill.path : skill.skillDir,
        isFlat: skill.isFlat,
      };
      await writeFile(join(itemDir, 'metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      await pruneDirectories(paths.trash, WRITE_LIMITS.maxTrash);
      await appendAudit(paths, { action: 'trash', name: skill.name, sourceKey: skill.sourceKey });
      const fresh = await freshCatalog();
      return { revision: fresh.revision, trash: metadata };
    },

    /** List trash entries, newest first. */
    async listTrash() {
      const paths = await ensureHome(pathsFor());
      const entries = await readdir(paths.trash, { withFileTypes: true }).catch(() => []);
      const items = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || !TRASH_ID.test(entry.name)) continue;
        const metadata = await readJsonFile(join(paths.trash, entry.name, 'metadata.json'));
        if (metadata === null) continue;
        items.push({
          id: entry.name,
          at: metadata.at ?? null,
          name: typeof metadata.name === 'string' ? metadata.name : '',
          sourceKey: typeof metadata.sourceKey === 'string' ? metadata.sourceKey : '',
          scope: typeof metadata.scope === 'string' ? metadata.scope : '',
          originalPath: typeof metadata.originalPath === 'string' ? metadata.originalPath : '',
          isFlat: metadata.isFlat === true,
        });
      }
      items.sort((left, right) => String(right.id).localeCompare(String(left.id)));
      return { items };
    },

    /** Restore one trash entry to its original writable location. */
    async restoreTrash(body = {}) {
      requireConfirm(body);
      const id = typeof body.id === 'string' ? body.id : '';
      if (!TRASH_ID.test(id)) throw new CuratorError('TRASH_ID_INVALID', 400);
      const paths = await ensureHome(pathsFor());
      const itemDir = join(paths.trash, id);
      const metadata = await readJsonFile(join(itemDir, 'metadata.json'));
      if (metadata === null) throw new CuratorError('TRASH_NOT_FOUND', 404);
      if (typeof metadata.originalPath !== 'string' || metadata.originalPath === '') {
        throw new CuratorError('TRASH_INVALID', 500);
      }
      const catalog = await loadCatalog(true);
      const target = resolve(metadata.originalPath);
      const source = catalog.sources.find((candidate) => candidate.writable === true && isInside(candidate.path, target));
      if (!source) throw new CuratorError('READ_ONLY_TARGET', 403);
      const existing = await lstat(target).catch(() => null);
      if (existing !== null) throw new CuratorError('TARGET_EXISTS', 409);
      const payload = join(itemDir, 'payload');
      const payloadSource = metadata.isFlat === true ? join(payload, basename(target)) : payload;
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await movePath(payloadSource, target);
      await rm(itemDir, { recursive: true, force: true }).catch(() => {});
      await appendAudit(paths, { action: 'restore', name: metadata.name ?? '', sourceKey: source.key });
      const fresh = await freshCatalog();
      return { revision: fresh.revision };
    },

  };
}
