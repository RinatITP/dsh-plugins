/**
 * Plugin-owned operational storage under `<dshHome>/skill-curator/`:
 * backups, trash, audit trail and the paths every mutation uses.
 *
 * Nothing here writes skill content: backups copy files that already exist,
 * trash moves whole skill entries, and the audit trail stores value-free
 * metadata only (never SKILL.md bodies or sercrets).
 */
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { expandPath } from './roots.js';

const AUDIT_MAX_BYTES = 1024 * 1024;

/** Resolve every plugin-owned path for a given configuration. */
export function skillCuratorHome({ config = {}, env = process.env, home = homedir() } = {}) {
  const dshHome = expandPath(config.dshHome, { home, env })
    ?? expandPath(env.DSH_HOME, { home, env })
    ?? join(home, '.dsh');
  const root = join(dshHome, 'skill-curator');
  return {
    root,
    backups: join(root, 'backups'),
    trash: join(root, 'trash'),
    audit: join(root, 'audit.jsonl'),
  };
}

/** Create the plugin directories with owner-only permissions. */
export async function ensureHome(paths) {
  await mkdir(paths.backups, { recursive: true, mode: 0o700 });
  await mkdir(paths.trash, { recursive: true, mode: 0o700 });
  return paths;
}

/** Sortable, collision-resistant identifier for backups and trash entries. */
export function timestampId() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${randomUUID().slice(0, 8)}`;
}

/** Append one value-free audit record, rotating the log when it grows. */
export async function appendAudit(paths, entry) {
  try {
    await ensureHome(paths);
    const info = await stat(paths.audit).catch(() => null);
    if (info !== null && info.size >= AUDIT_MAX_BYTES) {
      await rename(paths.audit, `${paths.audit}.1`).catch(() => {});
    }
    const record = {
      at: new Date().toISOString(),
      ...entry,
    };
    await appendFile(paths.audit, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Audit is best-effort and must never fail a user action.
  }
}

/** Keep at most `max` entries in a backup/trash directory (oldest removed). */
export async function pruneDirectories(directory, max = 200) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  const names = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort();
  if (names.length <= max) return;
  for (const name of names.slice(0, names.length - max)) {
    await rm(join(directory, name), { recursive: true, force: true }).catch(() => {});
  }
}

/** Read one JSON metadata file, returning null for invalid or missing files. */
export async function readJsonFile(file) {
  const text = await readFile(file, 'utf8').catch(() => null);
  if (text === null) return null;
  try {
    const value = JSON.parse(text);
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
