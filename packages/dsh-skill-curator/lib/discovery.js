/**
 * Read-only discovery of skill bundles across every known root.
 *
 * One skill is either a directory bundle (`<name>/SKILL.md`) or a flat markdown
 * file (`<name>.md`) inside a root. Hermes keeps one extra level of category
 * directories (`<root>/<category>/<name>/SKILL.md`); Codex keeps system skills
 * under `<root>/.system/<name>/SKILL.md`.
 *
 * The scanner never writes, never follows symlinks while walking (it resolves
 * one entry per candidate only), and reports every unreadable or malformed
 * entry through diagnostics instead of failing the whole snapshot.
 */
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, realpath, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, sep } from 'node:path';
import { splitFrontmatter } from './frontmatter.js';
import { countLines, diagnoseSkill, summarize } from './validate.js';

export const SKILL_FILE = 'SKILL.md';
export const LIMITS = {
  maxSkills: 2000,
  maxEntriesPerSource: 4000,
  maxSkillFileBytes: 512 * 1024,
  maxTreeEntries: 400,
  maxFileReadBytes: 1024 * 1024,
};

const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  '.hub',
  '.bundled_manifest',
  'index-cache',
]);

const DSH_PRECEDENCE = {
  project: 100,
  'dsh-user': 400,
  'dsh-agents': 500,
  bundled: 600,
};

function isIgnoredName(name) {
  if (typeof name !== 'string') return false;
  if (name === '.system') return false;
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.');
}

async function safeLstat(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')) return null;
    throw error;
  }
}

async function safeStat(path) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

async function pathIsDirectory(path) {
  const info = await safeStat(path);
  return info !== null && info.isDirectory();
}

function skillId(absolutePath) {
  return createHash('sha256').update(absolutePath).digest('hex').slice(0, 16);
}

function readOnlyReason(source) {
  if (source.writable) return null;
  if (source.kind === 'bundled') return 'BUNDLED';
  if (source.kind === 'project') return 'PROJECT';
  if (source.kind === 'external' || source.kind === 'custom') return 'EXTERNAL';
  return 'READ_ONLY';
}

function systemFlagFor(source, entryName) {
  return source.systemSubdir !== null && entryName === source.systemSubdir;
}

/**
 * Scan one root. Returns the source-level summary plus every discovered skill.
 *
 * @param {ReturnType<import('./roots.js').buildSources>[number]} source
 */
export async function scanSource(source, options = {}) {
  const { maxSkillFileBytes = LIMITS.maxSkillFileBytes } = options;
  const summary = {
    key: source.key,
    kind: source.kind,
    agent: source.agent,
    labelKey: source.labelKey,
    label: source.label,
    path: source.path,
    scope: source.scope,
    readOnly: source.readOnly,
    writable: source.writable,
    readOnlyReason: readOnlyReason(source),
    exists: false,
    skillCount: 0,
    systemCount: 0,
    error: null,
    truncated: false,
  };
  const skills = [];
  const skipped = [];
  const rootInfo = await safeLstat(source.path).catch(() => null);
  if (rootInfo === null) {
    summary.exists = false;
    return { summary, skills, skipped };
  }
  if (!rootInfo.isDirectory() && !rootInfo.isSymbolicLink()) {
    summary.exists = true;
    summary.error = 'SOURCE_NOT_DIRECTORY';
    return { summary, skills, skipped };
  }
  const rootIsDirectory = rootInfo.isDirectory() ? true : await pathIsDirectory(source.path);
  summary.exists = true;
  if (!rootIsDirectory) {
    summary.error = 'SOURCE_NOT_DIRECTORY';
    return { summary, skills, skipped };
  }

  let entries;
  try {
    entries = await readdir(source.path, { withFileTypes: true });
  } catch {
    summary.error = 'SOURCE_UNREADABLE';
    return { summary, skills, skipped };
  }
  entries = entries
    .filter((entry) => !isIgnoredName(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (entries.length > LIMITS.maxEntriesPerSource) {
    summary.truncated = true;
    entries = entries.slice(0, LIMITS.maxEntriesPerSource);
  }

  for (const entry of entries) {
    if (skills.length >= LIMITS.maxSkills) {
      summary.truncated = true;
      break;
    }
    const entryPath = join(source.path, entry.name);
    const entryIsDirectory = entry.isDirectory()
      || (entry.isSymbolicLink() && await pathIsDirectory(entryPath));

    if (source.systemSubdir !== null && entry.name === source.systemSubdir && entryIsDirectory) {
      const systemSkills = await scanSystemSubdir(entryPath, source, {
        maxSkillFileBytes,
      });
      for (const skill of systemSkills.skills) {
        skill.system = true;
        skills.push(skill);
      }
      skipped.push(...systemSkills.skipped);
      continue;
    }

    if (entryIsDirectory) {
      const bundle = await readBundle(entryPath, source, { category: null, system: false, maxSkillFileBytes });
      if (bundle) {
        skills.push(bundle);
        continue;
      }
      if (source.depth > 1) {
        const nested = await scanCategory(entryPath, entry.name, source, { maxSkillFileBytes });
        skills.push(...nested.skills);
        skipped.push(...nested.skipped);
        if (nested.skills.length === 0 && nested.skipped.length === 0) {
          skipped.push({ name: entry.name, reason: 'NO_SKILL_FILE' });
        }
        continue;
      }
      skipped.push({ name: entry.name, reason: 'NO_SKILL_FILE' });
      continue;
    }

    if (source.flat && entry.isFile() && extname(entry.name).toLowerCase() === '.md' && entry.name !== SKILL_FILE) {
      const flat = await readFlat(entryPath, source, { maxSkillFileBytes });
      if (flat) skills.push(flat);
      else skipped.push({ name: entry.name, reason: 'UNREADABLE' });
    }
  }

  summary.skillCount = skills.length;
  summary.systemCount = skills.filter((skill) => skill.system === true).length;
  return { summary, skills, skipped };
}

async function scanSystemSubdir(directory, source, options) {
  const skills = [];
  const skipped = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return { skills, skipped: [{ name: source.systemSubdir ?? '.system', reason: 'UNREADABLE' }] };
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (isIgnoredName(entry.name)) continue;
    const entryPath = join(directory, entry.name);
    const entryIsDirectory = entry.isDirectory()
      || (entry.isSymbolicLink() && await pathIsDirectory(entryPath));
    if (!entryIsDirectory) continue;
    const bundle = await readBundle(entryPath, source, {
      category: source.systemSubdir,
      system: true,
      maxSkillFileBytes: options.maxSkillFileBytes,
    });
    if (bundle) skills.push(bundle);
    else skipped.push({ name: entry.name, reason: 'NO_SKILL_FILE' });
  }
  return { skills, skipped };
}

async function scanCategory(directory, categoryName, source, options, depth = 1) {
  const skills = [];
  const skipped = [];
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return { skills, skipped: [{ name: categoryName, reason: 'UNREADABLE' }] };
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (isIgnoredName(entry.name)) continue;
    const entryPath = join(directory, entry.name);
    const entryIsDirectory = entry.isDirectory()
      || (entry.isSymbolicLink() && await pathIsDirectory(entryPath));
    if (!entryIsDirectory) continue;
    const bundle = await readBundle(entryPath, source, {
      category: categoryName,
      system: false,
      maxSkillFileBytes: options.maxSkillFileBytes,
    });
    if (bundle) {
      skills.push(bundle);
      continue;
    }
    if (depth < 3) {
      const nested = await scanCategory(entryPath, categoryName, source, options, depth + 1);
      skills.push(...nested.skills);
      skipped.push(...nested.skipped);
      continue;
    }
    skipped.push({ name: `${categoryName}/${entry.name}`, reason: 'NO_SKILL_FILE' });
  }
  return { skills, skipped };
}

async function readSkillDocument(filePath, { maxBytes }) {
  const info = await safeLstat(filePath);
  if (info === null || !info.isFile()) return null;
  const truncated = info.size > maxBytes;
  const buffer = await readFile(filePath, { encoding: 'utf8' }).catch(() => null);
  if (buffer === null) return null;
  const content = truncated ? buffer.slice(0, maxBytes) : buffer;
  return { content, truncated, size: info.size, mtimeMs: info.mtimeMs };
}

async function readBundle(directory, source, { category, system, maxSkillFileBytes }) {
  const skillFile = join(directory, SKILL_FILE);
  const document = await readSkillDocument(skillFile, { maxBytes: maxSkillFileBytes }).catch(() => null);
  if (document === null) return null;
  const dirName = basename(directory);
  const linkInfo = await safeLstat(directory).catch(() => null);
  const isSymlink = linkInfo !== null && linkInfo.isSymbolicLink();
  let symlinkTarget = null;
  if (isSymlink) {
    symlinkTarget = await readlink(directory).catch(() => null);
    if (symlinkTarget === null) symlinkTarget = '';
  }
  const frontmatter = splitFrontmatter(document.content);
  const body = truncatedBody(frontmatter.body, document.truncated);
  const diagnostics = diagnoseSkill({
    frontmatter,
    body,
    dirName,
    isFlat: false,
    isSymlink,
    symlinkTarget,
  });
  diagnostics.diagnostics = diagnostics.diagnostics.slice(0, 20);
  if (document.truncated) {
    diagnostics.diagnostics.push({
      code: 'file-too-large',
      severity: 'warn',
      params: { bytes: document.size, maxBytes: maxSkillFileBytes },
    });
  }
  const fileCount = await countFiles(directory).catch(() => 0);
  return {
    id: skillId(skillFile),
    name: diagnostics.name || dirName,
    description: diagnostics.description,
    displayName: diagnostics.name || dirName,
    path: skillFile,
    skillDir: directory,
    relativePath: relative(source.path, directory),
    sourceKey: source.key,
    sourceKind: source.kind,
    agent: source.agent,
    scope: source.scope,
    readOnly: source.readOnly,
    readOnlyReason: readOnlyReason(source),
    writable: source.writable === true,
    category,
    system,
    isFlat: false,
    isSymlink,
    symlinkTarget,
    invocation: diagnostics.invocation,
    diagnostics: diagnostics.diagnostics,
    bodyLines: diagnostics.bodyLines,
    bodyBytes: diagnostics.bodyBytes,
    sizeBytes: document.size,
    mtimeMs: document.mtimeMs,
    fileCount,
    truncated: document.truncated,
  };
}

async function readFlat(filePath, source, { maxSkillFileBytes }) {
  const document = await readSkillDocument(filePath, { maxBytes: maxSkillFileBytes }).catch(() => null);
  if (document === null) return null;
  const frontmatter = splitFrontmatter(document.content);
  const body = truncatedBody(frontmatter.body, document.truncated);
  const diagnostics = diagnoseSkill({
    frontmatter,
    body,
    dirName: basename(filePath, extname(filePath)),
    isFlat: true,
  });
  return {
    id: skillId(filePath),
    name: diagnostics.name || basename(filePath, extname(filePath)),
    description: diagnostics.description,
    displayName: diagnostics.name || basename(filePath, extname(filePath)),
    path: filePath,
    skillDir: resolve(filePath, '..'),
    relativePath: relative(source.path, filePath),
    sourceKey: source.key,
    sourceKind: source.kind,
    agent: source.agent,
    scope: source.scope,
    readOnly: source.readOnly,
    readOnlyReason: readOnlyReason(source),
    writable: source.writable === true,
    category: null,
    system: false,
    isFlat: true,
    isSymlink: false,
    symlinkTarget: null,
    invocation: diagnostics.invocation,
    diagnostics: diagnostics.diagnostics.slice(0, 20),
    bodyLines: diagnostics.bodyLines,
    bodyBytes: diagnostics.bodyBytes,
    sizeBytes: document.size,
    mtimeMs: document.mtimeMs,
    fileCount: 1,
    truncated: document.truncated,
  };
}

function truncatedBody(body, truncated) {
  if (!truncated) return body;
  return `${body}\n\n[skill-file-truncated]`;
}

async function countFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (isIgnoredName(entry.name)) continue;
    count += 1;
  }
  return count;
}

function dedupeByRealPath(skills) {
  const seen = new Map();
  for (const skill of skills) {
    const key = skill.path;
    if (!seen.has(key)) seen.set(key, skill);
  }
  return [...seen.values()];
}

function applyNameRelations(skills) {
  const byName = new Map();
  for (const skill of skills) {
    const key = skill.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(skill);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    const dshGroup = group.filter((skill) => DSH_PRECEDENCE[skill.sourceKind] !== undefined);
    let winner = null;
    for (const skill of dshGroup) {
      if (winner === null || DSH_PRECEDENCE[skill.sourceKind] < DSH_PRECEDENCE[winner.sourceKind]) {
        winner = skill;
      }
    }
    for (const skill of group) {
      if (skill !== winner) {
        skill.duplicateName = true;
        if (winner !== null && DSH_PRECEDENCE[skill.sourceKind] !== undefined) {
          skill.shadowed = true;
          skill.shadowedBy = winner.id;
        }
      }
    }
  }
}

/**
 * Scan every source and return the catalog.
 *
 * @param {Array<object>} sources descriptors from buildSources()
 * @param {object} [options]
 * @param {AbortSignal} [options.signal]
 * @param {(code: string) => void} [options.log]
 */
export async function scanCatalog(sources, options = {}) {
  const { signal, log = () => {} } = options;
  const sourceResults = [];
  const skills = [];
  const skipped = [];
  for (const source of sources) {
    if (signal?.aborted) break;
    let result;
    try {
      result = await scanSource(source, options);
    } catch (error) {
      log('SOURCE_SCAN_FAILED');
      result = {
        summary: {
          key: source.key,
          kind: source.kind,
          agent: source.agent,
          labelKey: source.labelKey,
          label: source.label,
          path: source.path,
          scope: source.scope,
          readOnly: source.readOnly,
          writable: source.writable,
          readOnlyReason: readOnlyReason(source),
          exists: true,
          skillCount: 0,
          systemCount: 0,
          error: 'SOURCE_UNREADABLE',
          truncated: false,
        },
        skills: [],
        skipped: [],
      };
    }
    sourceResults.push(result.summary);
    skills.push(...result.skills);
    for (const item of result.skipped.slice(0, 50)) skipped.push({ sourceKey: source.key, ...item });
  }

  const deduped = dedupeByRealPath(skills);
  applyNameRelations(deduped);
  const diagnostics = deduped.map((skill) => skill.diagnostics);
  const summary = summarize(diagnostics);
  const complete = sourceResults.every((source) => source.error === null);
  const revision = createHash('sha256')
    .update(JSON.stringify(deduped.map((skill) => [skill.id, skill.name, skill.mtimeMs, skill.sizeBytes, skill.description, skill.invocation])))
    .digest('hex');
  return {
    revision,
    generatedAt: new Date().toISOString(),
    complete,
    sources: sourceResults,
    skills: deduped.sort((left, right) => left.name.localeCompare(right.name) || left.sourceKey.localeCompare(right.sourceKey)),
    skipped,
    summary: { ...summary, skills: deduped.length, sources: sourceResults.filter((source) => source.exists).length },
  };
}

/** Convert one internal skill record into the browser-facing projection. */
export function projectSkill(skill) {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    sourceKey: skill.sourceKey,
    sourceKind: skill.sourceKind,
    agent: skill.agent,
    scope: skill.scope,
    category: skill.category,
    system: skill.system === true,
    readOnly: skill.readOnly,
    readOnlyReason: skill.readOnlyReason,
    writable: skill.writable === true,
    path: skill.path,
    relativePath: skill.relativePath,
    isFlat: skill.isFlat,
    isSymlink: skill.isSymlink,
    symlinkTarget: skill.symlinkTarget,
    invocation: skill.invocation,
    diagnostics: skill.diagnostics,
    duplicateName: skill.duplicateName === true,
    shadowed: skill.shadowed === true,
    shadowedBy: skill.shadowedBy ?? null,
    bodyLines: skill.bodyLines,
    bodyBytes: skill.bodyBytes,
    sizeBytes: skill.sizeBytes,
    mtimeMs: skill.mtimeMs,
    fileCount: skill.fileCount,
    truncated: skill.truncated === true,
  };
}

/**
 * Read one skill's SKILL.md plus its immediate and nested resource tree.
 * Paths are validated against the skill directory before any read.
 */
export async function readSkillDetail(skill, options = {}) {
  const { maxFileBytes = LIMITS.maxFileReadBytes, maxTreeEntries = LIMITS.maxTreeEntries } = options;
  const content = await readFile(skill.path, 'utf8').catch(() => null);
  if (content === null) {
    return { ok: false, code: 'SKILL_UNREADABLE' };
  }
  const truncated = Buffer.byteLength(content, 'utf8') > maxFileBytes;
  const files = skill.isFlat
    ? [{ relativePath: basename(skill.path), kind: 'file', size: Buffer.byteLength(content, 'utf8') }]
    : await listSkillTree(skill.skillDir, { maxEntries: maxTreeEntries });
  return {
    ok: true,
    skill: projectSkill(skill),
    frontmatter: splitFrontmatter(truncated ? content.slice(0, maxFileBytes) : content),
    content: truncated ? content.slice(0, maxFileBytes) : content,
    truncated,
    files,
  };
}

/** List a skill directory (depth 3, bounded). */
export async function listSkillTree(skillDir, { maxEntries = LIMITS.maxTreeEntries } = {}) {
  const files = [];
  async function walk(directory, depth) {
    if (files.length >= maxEntries) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = entries.filter((entry) => !isIgnoredName(entry.name)).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of sorted) {
      if (files.length >= maxEntries) return;
      const fullPath = join(directory, entry.name);
      const relativePath = relative(skillDir, fullPath);
      let isDirectory = entry.isDirectory();
      if (entry.isSymbolicLink()) {
        isDirectory = await pathIsDirectory(fullPath);
      }
      if (isDirectory) {
        files.push({ relativePath, kind: 'directory', size: 0 });
        if (depth < 3) await walk(fullPath, depth + 1);
        continue;
      }
      const info = await safeLstat(fullPath);
      files.push({
        relativePath,
        kind: 'file',
        size: info?.size ?? 0,
      });
    }
  }
  await walk(skillDir, 1);
  return files;
}

/** Read one resource file of a skill after a traversal-safe path check. */
export async function readSkillFile(skill, relativePath, { maxBytes = LIMITS.maxFileReadBytes } = {}) {
  if (typeof relativePath !== 'string' || relativePath === '' || relativePath.includes('\0')) {
    return { ok: false, code: 'PATH_INVALID' };
  }
  if (skill.isFlat === true) {
    if (relativePath !== basename(skill.path)) return { ok: false, code: 'PATH_OUTSIDE_SKILL' };
    const flatInfo = await safeLstat(skill.path);
    if (flatInfo === null || !flatInfo.isFile()) return { ok: false, code: 'FILE_NOT_FOUND' };
    const flatBuffer = await readFile(skill.path).catch(() => null);
    if (flatBuffer === null) return { ok: false, code: 'FILE_UNREADABLE' };
    const flatText = flatBuffer.toString('utf8');
    return {
      ok: true,
      binary: false,
      size: flatBuffer.length,
      truncated: flatBuffer.length > maxBytes,
      content: flatBuffer.length > maxBytes ? flatText.slice(0, maxBytes) : flatText,
    };
  }
  const base = resolve(skill.skillDir);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + sep)) {
    return { ok: false, code: 'PATH_OUTSIDE_SKILL' };
  }
  const info = await safeLstat(target);
  if (info === null || !info.isFile()) return { ok: false, code: 'FILE_NOT_FOUND' };
  const buffer = await readFile(target).catch(() => null);
  if (buffer === null) return { ok: false, code: 'FILE_UNREADABLE' };
  const binary = buffer.subarray(0, 8192).includes(0);
  if (binary) return { ok: true, binary: true, size: buffer.length, content: null };
  const text = buffer.toString('utf8');
  const truncated = buffer.length > maxBytes;
  return {
    ok: true,
    binary: false,
    size: buffer.length,
    truncated,
    content: truncated ? text.slice(0, maxBytes) : text,
  };
}

export { DSH_PRECEDENCE, countLines };
